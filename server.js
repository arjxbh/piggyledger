const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');

const db = require('./lib/db');
const email = require('./lib/email');
const { requireLogin, requireAdult } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const QR_TOKEN_SECONDS = 10 * 60;
const PERSISTENT_TOKEN_SECONDS = 90 * 24 * 60 * 60;
const SIGNUP_TOKEN_SECONDS = 30 * 60;
const publicApiPaths = new Set([
  '/api/signup',
  '/api/signup/verify',
  '/api/access/request',
  '/api/access-token/status',
  '/api/health'
]);
const requestWindows = new Map();

function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    requestWindows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  return current.count <= maxRequests;
}

async function requireAccessToken(req, res, next) {
  if (publicApiPaths.has(req.path)) return next();
  if (req.session?.userId && req.session.familyId) {
    req.familyId = req.session.familyId;
    return next();
  }
  const token = String(req.headers['x-access-token'] || req.query.access_token || '').trim();
  const access = await db.resolveAccessToken(token);
  if (!access) return res.status(401).json({ error: 'Access token missing or expired', code: 'ACCESS_TOKEN_INVALID' });
  req.familyId = access.familyId;
  req.accessTokenKind = access.kind;
  return next();
}

app.set('trust proxy', 1);
app.use((req, res, next) => {
  if (isProduction && req.secure) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-a-real-deployment-' + crypto.randomBytes(8).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days - kids' tablets stay logged in
    sameSite: 'lax',
    secure: isProduction
  }
}));
app.get('/', (req, res) => {
  const accessToken = String(req.query.access_token || '').trim();
  if (accessToken) {
    return res.redirect(`/login.html?access_token=${encodeURIComponent(accessToken)}`);
  }
  if (req.session.userId) {
    return res.redirect(req.session.role === 'adult' ? '/adult.html' : '/kid.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(requireAccessToken);

// ---------- helpers ----------

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, color: u.color };
}

function managedUser(u) {
  return { ...publicUser(u), ...(u.role === 'adult' ? { email: u.email } : {}) };
}

function balanceForKid(data, kidId) {
  return data.ledger
    .filter(l => l.kidId === kidId)
    .reduce((sum, l) => sum + l.amount, 0);
}

// ---------- auth routes ----------

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/access-token/status', async (req, res) => {
  const token = String(req.headers['x-access-token'] || '').trim();
  const access = await db.resolveAccessToken(token);
  if (!access) {
    return res.status(401).json({ error: 'Access token missing or expired', code: 'ACCESS_TOKEN_INVALID' });
  }
  res.json({
    familyId: access.familyId,
    kind: access.kind,
    expiresAt: new Date(access.expiresAt * 1000).toISOString()
  });
});

app.post('/api/signup', async (req, res) => {
  if (!rateLimit(`signup:${req.ip}`, 5, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many signup attempts. Try again later.' });
  }
  const familyName = String(req.body.familyName || '').trim();
  const parentName = String(req.body.parentName || '').trim();
  const parentEmail = db.normalizeEmail(req.body.email);
  const password = String(req.body.password || '');
  if (!familyName || !parentName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) {
    return res.status(400).json({ error: 'Family name, parent name, and a valid email are required' });
  }
  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters' });
  }

  const verification = await db.putSignupVerification({
    familyName,
    parentName,
    email: parentEmail,
    secretHash: await bcrypt.hash(password, 12)
  }, SIGNUP_TOKEN_SECONDS);
  await email.sendSignupVerification(parentEmail, verification.token);
  res.status(202).json({ ok: true, message: 'Check your email to finish creating your family.' });
});

app.get('/api/signup/verify', async (req, res) => {
  const verification = await db.getSignupVerification(String(req.query.token || ''));
  if (!verification) {
    return res.redirect('/signup.html?status=expired');
  }
  try {
    const family = await db.createFamily({
      familyName: verification.familyName,
      parentName: verification.parentName,
      email: verification.email,
      secretHash: verification.secretHash,
      verificationHash: verification.tokenHash
    });
    const access = await db.createAccessToken(family.familyId, PERSISTENT_TOKEN_SECONDS, 'persistent');
    return res.redirect(`/login.html?access_token=${encodeURIComponent(access.token)}&welcome=1`);
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      return res.redirect('/signup.html?status=used');
    }
    throw error;
  }
});

app.post('/api/access/request', async (req, res) => {
  const parentEmail = db.normalizeEmail(req.body.email);
  if (!rateLimit(`access:${req.ip}`, 10, 60 * 60 * 1000)) {
    return res.status(202).json({
      ok: true,
      message: 'If that email belongs to a family, an access link is on its way.'
    });
  }
  const families = await db.familiesForEmail(parentEmail);
  if (families.length > 0) {
    const links = await Promise.all(families.map(async family => {
      const access = await db.createAccessToken(family.familyId, PERSISTENT_TOKEN_SECONDS, 'persistent');
      return {
        familyName: family.familyName,
        url: `${email.appBaseUrl}/login.html?access_token=${encodeURIComponent(access.token)}`
      };
    }));
    await email.sendAccessLinks(parentEmail, links);
  }
  res.status(202).json({
    ok: true,
    message: 'If that email belongs to a family, an access link is on its way.'
  });
});

// List of profiles for the login screen (no secrets included)
app.get('/api/users/public', async (req, res) => {
  const data = await db.read(req.familyId);
  res.json(data.users.map(publicUser));
});

app.post('/api/login', async (req, res) => {
  const { userId, secret } = req.body;
  const data = await db.read(req.familyId);
  const user = data.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Unknown user' });

  const ok = bcrypt.compareSync(String(secret || ''), user.secretHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect password/PIN' });

  req.session.userId = user.id;
  req.session.familyId = req.familyId;
  req.session.role = user.role;
  req.session.name = user.name;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.familyId !== req.familyId) return res.status(401).json({ error: 'Not logged in' });
  const data = await db.read(req.familyId);
  const user = data.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: publicUser(user) });
});

// ---------- user management (adults only) ----------

app.get('/api/users', requireAdult, async (req, res) => {
  const data = await db.read(req.familyId);
  res.json(data.users.map(managedUser));
});

app.post('/api/users', requireAdult, async (req, res) => {
  const { name, role, secret, color } = req.body;
  const adultEmail = db.normalizeEmail(req.body.email);
  if (!name || !role || !secret) return res.status(400).json({ error: 'name, role, and secret are required' });
  if (!['adult', 'kid'].includes(role)) return res.status(400).json({ error: 'role must be adult or kid' });
  if (role === 'kid' && !/^\d{4}$/.test(String(secret))) {
    return res.status(400).json({ error: 'Kid PIN must be exactly 4 digits' });
  }
  if (role === 'adult' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adultEmail)) {
    return res.status(400).json({ error: 'A valid email is required for each adult' });
  }

  const user = await db.mutate(req.familyId, d => {
    if (role === 'adult' && d.users.some(u => u.role === 'adult' && db.normalizeEmail(u.email) === adultEmail)) {
      return 'duplicate-email';
    }
    const id = db.nextId(d);
    const u = {
      id,
      name,
      role,
      ...(role === 'adult' ? { email: adultEmail } : {}),
      secretHash: bcrypt.hashSync(String(secret), 10),
      color: color || '#5B7FDE',
      createdAt: new Date().toISOString()
    };
    d.users.push(u);
    return u;
  }, { syncAdultEmails: true });
  if (user === 'duplicate-email') {
    return res.status(409).json({ error: 'That email is already assigned to an adult in this family' });
  }
  res.status(201).json(managedUser(user));
});

app.put('/api/users/:id/email', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  const adultEmail = db.normalizeEmail(req.body.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adultEmail)) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  const result = await db.mutate(req.familyId, d => {
    const user = d.users.find(value => value.id === id);
    if (!user) return 'not-found';
    if (user.role !== 'adult') return 'not-adult';
    if (d.users.some(value =>
      value.id !== id &&
      value.role === 'adult' &&
      db.normalizeEmail(value.email) === adultEmail
    )) return 'duplicate-email';
    user.email = adultEmail;
    return user;
  }, { syncAdultEmails: true });
  if (result === 'not-found') return res.status(404).json({ error: 'User not found' });
  if (result === 'not-adult') return res.status(400).json({ error: 'Only adults have email addresses' });
  if (result === 'duplicate-email') {
    return res.status(409).json({ error: 'That email is already assigned to an adult in this family' });
  }
  res.json(managedUser(result));
});

app.put('/api/users/:id/secret', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  const { secret } = req.body;
  if (!secret) return res.status(400).json({ error: 'secret is required' });

  const result = await db.mutate(req.familyId, d => {
    const u = d.users.find(x => x.id === id);
    if (!u) return null;
    if (u.role === 'kid' && !/^\d{4}$/.test(String(secret))) return 'bad-pin';
    u.secretHash = bcrypt.hashSync(String(secret), 10);
    return u;
  });
  if (result === null) return res.status(404).json({ error: 'User not found' });
  if (result === 'bad-pin') return res.status(400).json({ error: 'Kid PIN must be exactly 4 digits' });
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: "You can't delete your own account while logged in" });
  await db.mutate(req.familyId, d => {
    d.users = d.users.filter(u => u.id !== id);
  }, { syncAdultEmails: true });
  res.json({ ok: true });
});

app.post('/api/access-token', requireAdult, async (req, res) => {
  const access = await db.createAccessToken(req.familyId, QR_TOKEN_SECONDS, 'qr');
  res.status(201).json({ accessToken: access.token, expiresAt: access.expiresAt });
});

// ---------- chores ----------

app.get('/api/chores', requireLogin, async (req, res) => {
  const data = await db.read(req.familyId);
  let chores = data.chores;
  if (req.session.role === 'kid') {
    chores = chores.filter(c => c.assignedTo === null || c.assignedTo === req.session.userId);
  }
  res.json(chores);
});

app.post('/api/chores', requireAdult, async (req, res) => {
  const { title, value, assignedTo, repeatable } = req.body;
  if (!title || typeof value !== 'number' || value <= 0) {
    return res.status(400).json({ error: 'title and a positive numeric value are required' });
  }
  const chore = await db.mutate(req.familyId, d => {
    const id = db.nextId(d);
    const c = {
      id,
      title,
      value,
      assignedTo: assignedTo || null,
      repeatable: !!repeatable,
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedBy: null,
      completedFor: null,
      completionCount: 0,
      lastCompletedAt: null,
      lastCompletedBy: null,
      lastCompletedFor: null
    };
    d.chores.push(c);
    return c;
  });
  res.status(201).json(chore);
});

app.put('/api/chores/:id', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  const { title, value, assignedTo, repeatable } = req.body;
  const chore = await db.mutate(req.familyId, d => {
    const c = d.chores.find(x => x.id === id);
    if (!c) return null;
    if (title !== undefined) c.title = title;
    if (value !== undefined) c.value = value;
    if (assignedTo !== undefined) c.assignedTo = assignedTo;
    if (repeatable !== undefined) c.repeatable = !!repeatable;
    return c;
  });
  if (!chore) return res.status(404).json({ error: 'Chore not found' });
  res.json(chore);
});

app.delete('/api/chores/:id', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  await db.mutate(req.familyId, d => { d.chores = d.chores.filter(c => c.id !== id); });
  res.json({ ok: true });
});

// Mark a chore done -> creates a ledger entry for the kid who did it.
// Repeatable chores never lock into a "done" state - they can be completed
// again immediately, each time adding its own ledger entry.
app.post('/api/chores/:id/complete', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  const { kidId } = req.body; // required if chore.assignedTo is null

  const result = await db.mutate(req.familyId, d => {
    const c = d.chores.find(x => x.id === id);
    if (!c) return { error: 'not-found' };
    if (!c.repeatable && c.status === 'done') return { error: 'already-done' };

    const targetKid = c.assignedTo || kidId;
    if (!targetKid) return { error: 'need-kid' };
    const kid = d.users.find(u => u.id === targetKid && u.role === 'kid');
    if (!kid) return { error: 'bad-kid' };

    const now = new Date().toISOString();

    if (c.repeatable) {
      c.completionCount = (c.completionCount || 0) + 1;
      c.lastCompletedAt = now;
      c.lastCompletedBy = req.session.userId;
      c.lastCompletedFor = targetKid;
    } else {
      c.status = 'done';
      c.completedAt = now;
      c.completedBy = req.session.userId; // which adult marked it done
      c.completedFor = targetKid;         // which kid the money went to
    }

    const entry = {
      id: db.nextId(d),
      kidId: targetKid,
      amount: c.value,
      reason: `Chore: ${c.title}`,
      type: 'chore',
      choreId: c.id,
      reversed: false,
      date: now,
      createdBy: req.session.userId,
      createdByName: req.session.name
    };
    d.ledger.push(entry);
    return { chore: c, entry };
  });

  if (result.error === 'not-found') return res.status(404).json({ error: 'Chore not found' });
  if (result.error === 'already-done') return res.status(400).json({ error: 'Chore already marked done' });
  if (result.error === 'need-kid') return res.status(400).json({ error: 'This chore has no assigned kid - specify kidId' });
  if (result.error === 'bad-kid') return res.status(400).json({ error: 'Kid not found' });

  res.json(result);
});

// Undo the most recent completion of a chore. Keeps the audit trail intact
// by adding a reversal ledger entry rather than deleting history. For a
// one-time chore this also reopens it; a repeatable chore just stays
// available (it was never "closed" in the first place).
app.post('/api/chores/:id/reopen', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.mutate(req.familyId, d => {
    const c = d.chores.find(x => x.id === id);
    if (!c) return { error: 'not-found' };
    if (!c.repeatable && c.status !== 'done') return { error: 'not-done' };

    const candidates = d.ledger
      .filter(l => l.choreId === c.id && l.type === 'chore' && !l.reversed)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const originalEntry = candidates[0];
    if (!originalEntry) return { error: 'nothing-to-undo' };

    originalEntry.reversed = true;
    const reversal = {
      id: db.nextId(d),
      kidId: originalEntry.kidId,
      amount: -originalEntry.amount,
      reason: `Reversed: ${c.title}`,
      type: 'chore',
      choreId: c.id,
      reversed: false,
      reversalOf: originalEntry.id,
      date: new Date().toISOString(),
      createdBy: req.session.userId,
      createdByName: req.session.name
    };
    d.ledger.push(reversal);

    if (c.repeatable) {
      c.completionCount = Math.max(0, (c.completionCount || 0) - 1);
      const remaining = d.ledger
        .filter(l => l.choreId === c.id && l.type === 'chore' && !l.reversed && l.id !== reversal.id)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
      const stillLatest = remaining[0];
      c.lastCompletedAt = stillLatest ? stillLatest.date : null;
      c.lastCompletedFor = stillLatest ? stillLatest.kidId : null;
    } else {
      c.status = 'pending';
      c.completedAt = null;
      c.completedBy = null;
      c.completedFor = null;
    }
    return { chore: c, reversal };
  });

  if (result.error === 'not-found') return res.status(404).json({ error: 'Chore not found' });
  if (result.error === 'not-done') return res.status(400).json({ error: 'Chore is not currently done' });
  if (result.error === 'nothing-to-undo') return res.status(400).json({ error: 'No completion to undo' });
  res.json(result);
});

// ---------- balances & ledger (the audit trail) ----------

app.get('/api/balance/:kidId', requireLogin, async (req, res) => {
  const kidId = Number(req.params.kidId);
  if (req.session.role === 'kid' && req.session.userId !== kidId) {
    return res.status(403).json({ error: 'Not your balance' });
  }
  const data = await db.read(req.familyId);
  res.json({ kidId, balance: balanceForKid(data, kidId) });
});

app.get('/api/balances', requireAdult, async (req, res) => {
  const data = await db.read(req.familyId);
  const kids = data.users.filter(u => u.role === 'kid');
  res.json(kids.map(k => ({ kidId: k.id, name: k.name, balance: balanceForKid(data, k.id) })));
});

// Manual adjustment (allowance top-up, penalty, correction, etc.)
app.post('/api/ledger/adjust', requireAdult, async (req, res) => {
  const { kidId, amount, reason } = req.body;
  if (!kidId || typeof amount !== 'number' || amount === 0 || !reason) {
    return res.status(400).json({ error: 'kidId, non-zero numeric amount, and reason are required' });
  }
  const data = await db.read(req.familyId);
  const kid = data.users.find(u => u.id === kidId && u.role === 'kid');
  if (!kid) return res.status(400).json({ error: 'Kid not found' });

  const entry = await db.mutate(req.familyId, d => {
    const e = {
      id: db.nextId(d),
      kidId,
      amount,
      reason,
      type: 'adjustment',
      choreId: null,
      date: new Date().toISOString(),
      createdBy: req.session.userId,
      createdByName: req.session.name
    };
    d.ledger.push(e);
    return e;
  });
  res.status(201).json(entry);
});

// Full audit trail, filterable. Adults see everyone; kids see only their own.
app.get('/api/ledger', requireLogin, async (req, res) => {
  const data = await db.read(req.familyId);
  let entries = data.ledger;

  if (req.session.role === 'kid') {
    entries = entries.filter(l => l.kidId === req.session.userId);
  } else if (req.query.kidId) {
    entries = entries.filter(l => l.kidId === Number(req.query.kidId));
  }

  if (req.query.from) {
    const from = new Date(req.query.from).getTime();
    entries = entries.filter(l => new Date(l.date).getTime() >= from);
  }
  if (req.query.to) {
    const to = new Date(req.query.to).getTime() + 24 * 60 * 60 * 1000 - 1; // inclusive end of day
    entries = entries.filter(l => new Date(l.date).getTime() <= to);
  }
  if (req.query.reason) {
    const q = String(req.query.reason).toLowerCase();
    entries = entries.filter(l => l.reason.toLowerCase().includes(q));
  }

  entries = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(entries);
});

// ---------- fallback ----------

app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use((error, req, res, next) => {
  console.error(JSON.stringify({
    level: 'error',
    method: req.method,
    path: req.path,
    message: error.message,
    name: error.name
  }));
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: 'Unexpected server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Piggy Ledger running at http://localhost:${PORT}`);
    console.log(`On your local network, use this machine's IP address, e.g. http://192.168.1.X:${PORT}`);
  });
}

module.exports = app;
