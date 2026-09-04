'use strict';

process.env.NODE_ENV = 'test';
process.env.DYNAMODB_TABLE_NAME = 'unit-test-table';
process.env.SESSION_SECRET = 'unit-test-session-secret-with-enough-entropy';

const assert = require('node:assert/strict');
const { after, before, beforeEach, test } = require('node:test');
const bcrypt = require('bcryptjs');

const db = require('../lib/db');
const email = require('../lib/email');
const app = require('../server');

const familyId = 'family-1';
const familyToken = 'valid-family-link';
let data;
let tokens;
let verification;
let sentSignup;
let sentAccess;
let sentMoneyRequests;
let signupEmailReservations;
let server;
let baseUrl;

function initialData() {
  return {
    family: { id: familyId, name: 'Test Family', email: 'parent@example.com' },
    nextId: 20,
    users: [
      { id: 1, name: 'Pat', role: 'adult', email: 'parent@example.com', secretHash: bcrypt.hashSync('adult-password', 4), color: '#111111' },
      { id: 2, name: 'Sam', role: 'kid', secretHash: bcrypt.hashSync('1234', 4), color: '#222222' },
      { id: 3, name: 'Jo', role: 'kid', secretHash: bcrypt.hashSync('5678', 4), color: '#333333' }
    ],
    chores: [
      { id: 10, title: 'Shared chore', value: 2, assignedTo: null, repeatable: false, status: 'pending' },
      { id: 11, title: 'Sam chore', value: 3, assignedTo: 2, repeatable: false, status: 'pending' },
      { id: 12, title: 'Jo chore', value: 4, assignedTo: 3, repeatable: true, status: 'pending', completionCount: 0 }
    ],
    ledger: [
      { id: 13, kidId: 2, amount: 5, reason: 'Allowance', type: 'adjustment', date: '2026-01-01T12:00:00.000Z', createdBy: 1, createdByName: 'Pat' },
      { id: 14, kidId: 2, amount: -1, reason: 'Snack', type: 'adjustment', date: '2026-01-03T12:00:00.000Z', createdBy: 1, createdByName: 'Pat' },
      { id: 15, kidId: 3, amount: 7, reason: 'Gift', type: 'adjustment', date: '2026-01-02T12:00:00.000Z', createdBy: 1, createdByName: 'Pat' }
    ],
    moneyRequests: []
  };
}

function installFakes() {
  db.normalizeEmail = value => String(value || '').trim().toLowerCase();
  db.nextId = value => value.nextId++;
  db.read = async id => id === familyId ? data : null;
  db.mutate = async (id, change) => {
    assert.equal(id, familyId);
    return change(data);
  };
  db.resolveAccessToken = async token => tokens.get(token) || null;
  db.createAccessToken = async (id, lifetimeSeconds, kind, options = {}) => {
    const token = `${kind}-token-${tokens.size}`;
    const expiresAt = new Date(Date.now() + lifetimeSeconds * 1000).toISOString();
    tokens.set(token, { familyId: id, kind, userId: options.userId, expiresAt: Math.floor(Date.parse(expiresAt) / 1000) });
    return { token, expiresAt };
  };
  db.deleteAccessToken = async token => tokens.delete(token);
  db.putSignupVerification = async details => {
    verification = { ...details, token: 'verify-token', tokenHash: 'verify-hash' };
    return { token: verification.token, expiresAt: new Date(Date.now() + 1800000).toISOString() };
  };
  db.reserveSignupEmailSend = async address => {
    if (signupEmailReservations.has(address)) return false;
    signupEmailReservations.add(address);
    return true;
  };
  db.getSignupVerification = async token => token === 'verify-token' ? verification : null;
  db.createFamily = async details => {
    assert.equal(details.verificationHash, 'verify-hash');
    return { familyId, userId: 1 };
  };
  db.familiesForEmail = async address => address === 'parent@example.com'
    ? [{ familyId, familyName: 'Test Family', userId: 1 }]
    : [];
  email.sendSignupVerification = async (to, token) => sentSignup.push({ to, token });
  email.sendAccessLinks = async (to, links) => sentAccess.push({ to, links });
  email.sendMoneyRequest = async (to, request) => sentMoneyRequests.push({ to, request });
}

class ApiClient {
  constructor(token = familyToken) {
    this.token = token;
    this.cookie = '';
  }

  async request(path, { method = 'GET', body, token = this.token } = {}) {
    const headers = {};
    if (token) headers['X-Access-Token'] = token;
    if (this.cookie) headers.Cookie = this.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';', 1)[0];
    const text = await response.text();
    let value = text;
    if ((response.headers.get('content-type') || '').includes('application/json')) value = JSON.parse(text);
    return { status: response.status, headers: response.headers, body: value };
  }

  async login(userId = 1, secret = 'adult-password') {
    const response = await this.request('/api/login', { method: 'POST', body: { userId, secret } });
    assert.equal(response.status, 200);
    this.token = response.body.sessionToken;
    return response;
  }
}

async function adultClient() {
  const client = new ApiClient();
  await client.login();
  return client;
}

async function kidClient(id = 2, pin = '1234') {
  const client = new ApiClient();
  await client.login(id, pin);
  return client;
}

before(() => new Promise((resolve, reject) => {
  server = app.listen(0, '127.0.0.1', error => {
    if (error) return reject(error);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

beforeEach(() => {
  data = initialData();
  tokens = new Map([[familyToken, { familyId, kind: 'qr-family', expiresAt: 2000000000 }]]);
  verification = {
    familyName: 'New Family', parentName: 'Alex', email: 'alex@example.com',
    secretHash: 'hash', token: 'verify-token', tokenHash: 'verify-hash'
  };
  sentSignup = [];
  sentAccess = [];
  sentMoneyRequests = [];
  signupEmailReservations = new Set();
  installFakes();
});

test('GET /api/health is public', async () => {
  const result = await new ApiClient(null).request('/api/health');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
});

test('protected endpoints require a valid family link', async () => {
  const result = await new ApiClient(null).request('/api/users/public');
  assert.equal(result.status, 401);
  assert.equal(result.body.code, 'ACCESS_TOKEN_INVALID');
});

test('GET /api/access-token/status validates and describes links', async () => {
  const valid = await new ApiClient().request('/api/access-token/status');
  assert.equal(valid.status, 200);
  assert.equal(valid.body.familyId, familyId);
  assert.equal(valid.body.kind, 'qr-family');
  assert.equal(valid.body.loginMode, 'choose-user');
  assert.match(valid.body.expiresAt, /^\d{4}-/);
  const invalid = await new ApiClient('bad').request('/api/access-token/status');
  assert.equal(invalid.status, 401);
});

test('POST /api/signup validates input and sends verification email', async () => {
  const client = new ApiClient(null);
  assert.equal((await client.request('/api/signup', { method: 'POST', body: {} })).status, 400);
  assert.equal((await client.request('/api/signup', { method: 'POST', body: {
    familyName: 'New', parentName: 'Alex', email: 'alex@example.com', password: 'short'
  } })).status, 400);
  const result = await client.request('/api/signup', { method: 'POST', body: {
    familyName: ' New Family ', parentName: ' Alex ', email: ' ALEX@example.com ', password: 'long-password'
  } });
  assert.equal(result.status, 202);
  assert.deepEqual(sentSignup, [{ to: 'alex@example.com', token: 'verify-token' }]);
  assert.equal(verification.familyName, 'New Family');
  assert.ok(await bcrypt.compare('long-password', verification.secretHash));

  const repeated = await client.request('/api/signup', { method: 'POST', body: {
    familyName: 'Another Family', parentName: 'Another Alex', email: 'alex@example.com', password: 'another-long-password'
  } });
  assert.equal(repeated.status, 202);
  assert.equal(sentSignup.length, 1);
});

test('GET /api/signup/verify handles expired and valid requests', async () => {
  const client = new ApiClient(null);
  const expired = await client.request('/api/signup/verify?token=bad');
  assert.equal(expired.status, 302);
  assert.equal(expired.headers.get('location'), '/signup.html?status=expired');
  const valid = await client.request('/api/signup/verify?token=verify-token');
  assert.equal(valid.status, 302);
  assert.match(valid.headers.get('location'), /^\/login\.html\?access_token=email-token-/);
});

test('POST /api/access/request does not reveal accounts and emails known families', async () => {
  const client = new ApiClient(null);
  const unknown = await client.request('/api/access/request', { method: 'POST', body: { email: 'nobody@example.com' } });
  assert.equal(unknown.status, 202);
  assert.equal(sentAccess.length, 0);
  const known = await client.request('/api/access/request', { method: 'POST', body: { email: 'PARENT@example.com' } });
  assert.equal(known.status, 202);
  assert.equal(known.body.message, unknown.body.message);
  assert.equal(sentAccess[0].to, 'parent@example.com');
  assert.equal(sentAccess[0].links[0].familyName, 'Test Family');
  assert.match(sentAccess[0].links[0].url, /access_token=email-token-/);
});

test('GET /api/users/public returns only safe profile fields', async () => {
  const result = await new ApiClient().request('/api/users/public');
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body[0]).sort(), ['color', 'id', 'name', 'role']);
});

test('POST /api/login rejects unknown users and bad secrets, then creates a session', async () => {
  const client = new ApiClient();
  assert.equal((await client.request('/api/login', { method: 'POST', body: { userId: 99, secret: 'x' } })).status, 401);
  assert.equal((await client.request('/api/login', { method: 'POST', body: { userId: 1, secret: 'wrong' } })).status, 401);
  const login = await client.login();
  assert.equal(login.body.user.name, 'Pat');
  assert.match(login.body.sessionToken, /^session-token-/);
  const me = await client.request('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, 1);
});

test('POST /api/session/exchange signs in the user scoped by email or child QR', async () => {
  tokens.set('email-link', { familyId, kind: 'email', userId: 1, expiresAt: 2000000000 });
  const adult = new ApiClient('email-link');
  const adultResult = await adult.request('/api/session/exchange', { method: 'POST' });
  assert.equal(adultResult.status, 200);
  assert.equal(adultResult.body.user.id, 1);
  assert.match(adultResult.body.sessionToken, /^session-token-/);
  assert.equal(tokens.has('email-link'), false);

  tokens.set('child-link', { familyId, kind: 'qr-child', userId: 2, expiresAt: 2000000000 });
  const child = new ApiClient('child-link');
  const childResult = await child.request('/api/session/exchange', { method: 'POST' });
  assert.equal(childResult.status, 200);
  assert.equal(childResult.body.user.id, 2);
  child.token = childResult.body.sessionToken;
  assert.equal((await child.request('/api/me')).body.user.id, 2);
});

test('POST /api/logout destroys the session', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/logout', { method: 'POST' })).status, 200);
  assert.equal((await client.request('/api/me')).status, 401);
});

test('GET /api/me requires a login and a current user', async () => {
  assert.equal((await new ApiClient().request('/api/me')).status, 401);
  const client = await adultClient();
  data.users = data.users.filter(user => user.id !== 1);
  assert.equal((await client.request('/api/me')).status, 401);
});

test('GET /api/users is adult-only and includes adult email', async () => {
  assert.equal((await (await kidClient()).request('/api/users')).status, 403);
  const result = await (await adultClient()).request('/api/users');
  assert.equal(result.status, 200);
  assert.equal(result.body[0].email, 'parent@example.com');
  assert.equal(result.body[1].email, undefined);
});

test('POST /api/users validates and creates kid and adult profiles', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/users', { method: 'POST', body: {} })).status, 400);
  assert.equal((await client.request('/api/users', { method: 'POST', body: { name: 'Lee', role: 'kid', secret: '12' } })).status, 400);
  assert.equal((await client.request('/api/users', { method: 'POST', body: { name: 'Lee', role: 'other', secret: '1234' } })).status, 400);
  assert.equal((await client.request('/api/users', { method: 'POST', body: { name: 'Lee', role: 'adult', secret: 'password' } })).status, 400);
  assert.equal((await client.request('/api/users', { method: 'POST', body: { name: 'Lee', role: 'adult', secret: 'password', email: 'parent@example.com' } })).status, 409);
  const kid = await client.request('/api/users', { method: 'POST', body: { name: 'Lee', role: 'kid', secret: '9999' } });
  assert.equal(kid.status, 201);
  assert.ok(await bcrypt.compare('9999', data.users.at(-1).secretHash));
  const adult = await client.request('/api/users', { method: 'POST', body: { name: 'Ari', role: 'adult', secret: 'new-password', email: 'ARI@example.com' } });
  assert.equal(adult.status, 201);
  assert.equal(adult.body.email, 'ari@example.com');
});

test('PUT /api/users/:id/email handles every result and updates adults', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/users/1/email', { method: 'PUT', body: { email: 'bad' } })).status, 400);
  assert.equal((await client.request('/api/users/99/email', { method: 'PUT', body: { email: 'x@example.com' } })).status, 404);
  assert.equal((await client.request('/api/users/2/email', { method: 'PUT', body: { email: 'x@example.com' } })).status, 400);
  data.users.push({ id: 4, name: 'Other', role: 'adult', email: 'other@example.com', secretHash: 'x' });
  assert.equal((await client.request('/api/users/4/email', { method: 'PUT', body: { email: 'parent@example.com' } })).status, 409);
  const result = await client.request('/api/users/4/email', { method: 'PUT', body: { email: 'NEW@example.com' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.email, 'new@example.com');
});

test('PUT /api/users/:id/secret validates and changes login secrets', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/users/2/secret', { method: 'PUT', body: {} })).status, 400);
  assert.equal((await client.request('/api/users/99/secret', { method: 'PUT', body: { secret: '1234' } })).status, 404);
  assert.equal((await client.request('/api/users/2/secret', { method: 'PUT', body: { secret: '12' } })).status, 400);
  assert.equal((await client.request('/api/users/2/secret', { method: 'PUT', body: { secret: '4321' } })).status, 200);
  assert.ok(await bcrypt.compare('4321', data.users.find(user => user.id === 2).secretHash));
});

test('DELETE /api/users/:id prevents self-delete and removes another user', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/users/1', { method: 'DELETE' })).status, 400);
  assert.equal((await client.request('/api/users/3', { method: 'DELETE' })).status, 200);
  assert.equal(data.users.some(user => user.id === 3), false);
});

test('POST /api/access-token creates family and passwordless child QR links', async () => {
  assert.equal((await (await kidClient()).request('/api/access-token', { method: 'POST' })).status, 403);
  const client = await adultClient();
  const family = await client.request('/api/access-token', { method: 'POST', body: {} });
  assert.equal(family.status, 201);
  assert.match(family.body.accessToken, /^qr-family-token-/);
  const child = await client.request('/api/access-token', { method: 'POST', body: { userId: 2 } });
  assert.equal(child.status, 201);
  assert.match(child.body.accessToken, /^qr-child-token-/);
  assert.equal(tokens.get(child.body.accessToken).userId, 2);
  assert.equal((await client.request('/api/access-token', { method: 'POST', body: { userId: 1 } })).status, 400);
});

test('kids create money requests that notify adults and appear in the ledger', async () => {
  const kid = await kidClient();
  assert.equal((await kid.request('/api/money-requests', { method: 'POST', body: { kind: 'other', amount: 500 } })).status, 400);
  assert.equal((await kid.request('/api/money-requests', { method: 'POST', body: { kind: 'withdrawal', amount: 500 } })).status, 400);

  const result = await kid.request('/api/money-requests', { method: 'POST', body: { kind: 'deposit', amount: 500 } });
  assert.equal(result.status, 201);
  assert.equal(result.body.status, 'pending');
  assert.equal(data.moneyRequests.length, 1);
  assert.equal(data.ledger.at(-1).moneyRequestId, result.body.id);
  assert.equal(data.ledger.at(-1).amount, 0);
  assert.deepEqual(sentMoneyRequests.map(message => message.to), ['parent@example.com']);
  assert.equal(sentMoneyRequests[0].request.kidName, 'Sam');

  const own = await kid.request('/api/money-requests');
  assert.equal(own.body.length, 1);
  const otherKid = await kidClient(3, '5678');
  assert.equal((await otherKid.request('/api/money-requests')).body.length, 0);
  assert.equal((await (await adultClient()).request('/api/money-requests')).body.length, 1);
});

test('adults approve or deny money requests and record each resolution', async () => {
  data.moneyRequests.push(
    { id: 16, kidId: 2, kidName: 'Sam', kind: 'withdrawal', amount: null, status: 'pending', createdAt: '2026-01-04T12:00:00.000Z' },
    { id: 17, kidId: 2, kidName: 'Sam', kind: 'deposit', amount: 200, status: 'pending', createdAt: '2026-01-04T13:00:00.000Z' }
  );
  const adult = await adultClient();
  assert.equal((await adult.request('/api/money-requests/16/resolve', { method: 'POST', body: { decision: 'approved' } })).status, 400);

  const approved = await adult.request('/api/money-requests/16/resolve', {
    method: 'POST', body: { decision: 'approved', amount: 3 }
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.entry.amount, -3);
  assert.equal(approved.body.request.amount, 3);
  assert.equal((await adult.request('/api/money-requests/16/resolve', { method: 'POST', body: { decision: 'denied' } })).status, 409);

  const denied = await adult.request('/api/money-requests/17/resolve', {
    method: 'POST', body: { decision: 'denied' }
  });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.entry.amount, 0);
  assert.equal(denied.body.request.status, 'denied');
  assert.match(data.ledger.at(-1).reason, /denied/i);
});

test('GET /api/chores requires login and filters chores for kids', async () => {
  assert.equal((await new ApiClient().request('/api/chores')).status, 401);
  const adult = await (await adultClient()).request('/api/chores');
  assert.equal(adult.body.length, 3);
  const kid = await (await kidClient()).request('/api/chores');
  assert.deepEqual(kid.body.map(chore => chore.id), [10, 11]);
});

test('POST /api/chores validates and creates a complete chore record', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/chores', { method: 'POST', body: { title: '', value: 0 } })).status, 400);
  const result = await client.request('/api/chores', { method: 'POST', body: { title: 'Read', value: 1.5, assignedTo: 2, repeatable: true } });
  assert.equal(result.status, 201);
  assert.equal(result.body.status, 'pending');
  assert.equal(result.body.repeatable, true);
  assert.equal(result.body.completionCount, 0);
});

test('PUT and DELETE /api/chores/:id update missing, existing, and deleted chores', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/chores/99', { method: 'PUT', body: { title: 'No' } })).status, 404);
  const updated = await client.request('/api/chores/10', { method: 'PUT', body: { title: 'New title', value: 8, assignedTo: 2, repeatable: true } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.title, 'New title');
  assert.equal((await client.request('/api/chores/10', { method: 'DELETE' })).status, 200);
  assert.equal(data.chores.some(chore => chore.id === 10), false);
});

test('POST /api/chores/:id/complete validates targets and pays a kid', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/chores/99/complete', { method: 'POST', body: { kidId: 2 } })).status, 404);
  assert.equal((await client.request('/api/chores/10/complete', { method: 'POST', body: {} })).status, 400);
  assert.equal((await client.request('/api/chores/10/complete', { method: 'POST', body: { kidId: 1 } })).status, 400);
  const result = await client.request('/api/chores/10/complete', { method: 'POST', body: { kidId: 2 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.chore.status, 'done');
  assert.equal(result.body.entry.amount, 2);
  assert.equal(result.body.entry.createdByName, 'Pat');
  assert.equal((await client.request('/api/chores/10/complete', { method: 'POST', body: { kidId: 2 } })).status, 400);
});

test('repeatable chore completion remains open and tracks each completion', async () => {
  const client = await adultClient();
  const first = await client.request('/api/chores/12/complete', { method: 'POST', body: {} });
  const second = await client.request('/api/chores/12/complete', { method: 'POST', body: {} });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.chore.status, 'pending');
  assert.equal(second.body.chore.completionCount, 2);
});

test('POST /api/chores/:id/reopen validates state and records a reversal', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/chores/99/reopen', { method: 'POST' })).status, 404);
  assert.equal((await client.request('/api/chores/10/reopen', { method: 'POST' })).status, 400);
  await client.request('/api/chores/10/complete', { method: 'POST', body: { kidId: 2 } });
  const result = await client.request('/api/chores/10/reopen', { method: 'POST' });
  assert.equal(result.status, 200);
  assert.equal(result.body.chore.status, 'pending');
  assert.equal(result.body.reversal.amount, -2);
  assert.equal(data.ledger.find(entry => entry.id === result.body.reversal.reversalOf).reversed, true);
});

test('GET /api/balance/:kidId calculates balances and protects other kids', async () => {
  const kid = await kidClient();
  const own = await kid.request('/api/balance/2');
  assert.deepEqual(own.body, { kidId: 2, balance: 4 });
  assert.equal((await kid.request('/api/balance/3')).status, 403);
  const adult = await (await adultClient()).request('/api/balance/3');
  assert.equal(adult.body.balance, 7);
});

test('GET /api/balances is adult-only and summarizes every kid', async () => {
  assert.equal((await (await kidClient()).request('/api/balances')).status, 403);
  const result = await (await adultClient()).request('/api/balances');
  assert.deepEqual(result.body, [
    { kidId: 2, name: 'Sam', balance: 4 },
    { kidId: 3, name: 'Jo', balance: 7 }
  ]);
});

test('GET /api/leaderboard ranks kids by chore earnings and completions', async () => {
  data.ledger.push(
    { id: 16, kidId: 2, amount: 3, type: 'chore', choreId: 11, reversed: false },
    { id: 17, kidId: 3, amount: 4, type: 'chore', choreId: 12, reversed: false },
    { id: 18, kidId: 3, amount: 4, type: 'chore', choreId: 12, reversed: true },
    { id: 19, kidId: 2, amount: -3, type: 'chore', choreId: 11, reversed: false }
  );
  const kid = await kidClient();
  const result = await kid.request('/api/leaderboard');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.earned, [
    { kidId: 3, name: 'Jo', amount: 4, rank: 1 },
    { kidId: 2, name: 'Sam', amount: 3, rank: 2 }
  ]);
  assert.deepEqual(result.body.chores, [
    { kidId: 3, name: 'Jo', count: 1, rank: 1 },
    { kidId: 2, name: 'Sam', count: 1, rank: 2 }
  ]);
});

test('POST /api/ledger/adjust validates and records manual changes', async () => {
  const client = await adultClient();
  assert.equal((await client.request('/api/ledger/adjust', { method: 'POST', body: { kidId: 2, amount: 0, reason: '' } })).status, 400);
  assert.equal((await client.request('/api/ledger/adjust', { method: 'POST', body: { kidId: 99, amount: 2, reason: 'Test' } })).status, 400);
  const result = await client.request('/api/ledger/adjust', { method: 'POST', body: { kidId: 2, amount: 2.5, reason: 'Bonus' } });
  assert.equal(result.status, 201);
  assert.equal(result.body.type, 'adjustment');
  assert.equal(result.body.createdBy, 1);
});

test('GET /api/ledger limits kids and applies adult filters and sort order', async () => {
  const kid = await (await kidClient()).request('/api/ledger');
  assert.deepEqual(kid.body.map(entry => entry.id), [14, 13]);
  const adult = await (await adultClient()).request('/api/ledger?kidId=2&from=2026-01-02&to=2026-01-03&reason=snack');
  assert.deepEqual(adult.body.map(entry => entry.id), [14]);
});

test('API errors are returned as safe 500 responses', async () => {
  db.read = async () => { throw new Error('database details'); };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await new ApiClient().request('/api/users/public');
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Unexpected server error' });
  } finally {
    console.error = originalError;
  }
});
