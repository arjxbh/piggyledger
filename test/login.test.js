'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../public/js/login.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');

function browser({ search = '', fetch, getUserMedia, decode } = {}) {
  const elements = new Map();
  const stored = new Map();
  const redirects = [];
  const frames = [];
  const alerts = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
          textContent: '', innerHTML: '',
          classList: {
            add: name => classes.add(name), remove: name => classes.delete(name),
            contains: name => classes.has(name),
            toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
          },
          addEventListener() {}, querySelectorAll: () => [],
          play: async () => {}, pause() {},
          readyState: 4, HAVE_ENOUGH_DATA: 4, videoWidth: 320, videoHeight: 240
        });
      }
      return elements.get(id);
    },
    createElement: () => ({ getContext: () => ({
      drawImage() {}, getImageData: () => ({ data: [], width: 320, height: 240 })
    }) })
  };
  const location = { search, pathname: '/login.html', replace: url => redirects.push(url) };
  const context = vm.createContext({
    document, window: { location }, location, history: { replaceState() {} },
    URL, URLSearchParams, fetch,
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    navigator: { mediaDevices: getUserMedia ? { getUserMedia } : undefined },
    requestAnimationFrame: fn => frames.push(fn), jsQR: decode,
    alert: message => alerts.push(message)
  });
  vm.runInContext(source, context);
  return { context, elements, stored, redirects, frames, alerts, run: code => vm.runInContext(code, context) };
}

const response = body => ({ ok: true, json: async () => body });

test('child QR URL exchanges once and stops login initialization after redirect', async () => {
  const calls = [];
  const page = browser({ search: '?access_token=test-child-link', fetch: async url => {
    calls.push(url);
    if (url === '/api/access-token/status') return response({ loginMode: 'passwordless' });
    if (url === '/api/session/exchange') return response({ user: { role: 'kid' }, sessionToken: 'test-session' });
    throw new Error('Unexpected request after exchange');
  } });
  await page.run('init()');
  assert.deepEqual(calls, ['/api/access-token/status', '/api/session/exchange']);
  assert.deepEqual(page.redirects, ['/kid.html']);
  assert.equal(page.stored.get('piggyledger_access_token'), 'test-session');
});

test('family QR URL loads profiles without reusing a previous user session', async () => {
  const calls = [];
  const page = browser({ search: '?access_token=test-family-link', fetch: async url => {
    calls.push(url);
    if (url === '/api/access-token/status') return response({ loginMode: 'choose-user' });
    if (url === '/api/users/public') return response([]);
    throw new Error('Previous session must not redirect a new family link');
  } });
  await page.run('init()');
  assert.deepEqual(calls, ['/api/access-token/status', '/api/users/public']);
  assert.deepEqual(page.redirects, []);
});

test('expired QR URL preserves the explanation without loading profiles', async () => {
  let requests = 0;
  const page = browser({ search: '?access_token=expired-test-link', fetch: async () => { requests++; return { ok: false }; } });
  await page.run('init()');
  assert.equal(requests, 1);
  assert.match(page.elements.get('subtitle').textContent, /expired/);
});

test('scanned child QR redirects without a forbidden profile request', async () => {
  const calls = [];
  const page = browser({ getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
    decode: () => ({ data: 'https://example.test/login.html?access_token=test-child-link' }),
    fetch: async url => {
      calls.push(url);
      return url === '/api/access-token/status'
        ? response({ loginMode: 'passwordless' })
        : response({ user: { role: 'kid' }, sessionToken: 'test-session' });
    }
  });
  await page.run('startQrScan()');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['/api/access-token/status', '/api/session/exchange']);
  assert.deepEqual(page.redirects, ['/kid.html']);
});

test('unsupported tablet camera shows an alternative without throwing', async () => {
  const page = browser();
  await page.run('startQrScan()');
  assert.match(page.elements.get('subtitle').textContent, /share the link/);
});

test('canceling while camera permission is pending releases the late stream', async () => {
  let resolveCamera;
  let stopped = 0;
  const page = browser({ getUserMedia: () => new Promise(resolve => { resolveCamera = resolve; }) });
  const started = page.run('startQrScan()');
  page.run('stopQrScan()');
  resolveCamera({ getTracks: () => [{ stop: () => stopped++ }] });
  await started;
  assert.equal(stopped, 1);
  assert.equal(page.elements.get('qrVideo').srcObject, null);
  assert.equal(page.frames.length, 0);
});

test('tablet video playback rejection closes the camera and reports failure', async () => {
  let stopped = 0;
  const page = browser({ getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) });
  page.context.document.getElementById('qrVideo').play = async () => { throw new Error('Playback blocked'); };
  await page.run('startQrScan()');
  assert.equal(stopped, 1);
  assert.equal(page.alerts.length, 1);
});
