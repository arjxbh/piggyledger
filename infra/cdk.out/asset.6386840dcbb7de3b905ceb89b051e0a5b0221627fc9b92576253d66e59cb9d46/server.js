const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');

const db = require('./lib/db');
const { requireLogin, requireAdult } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me-in-a-real-deployment-' + crypto.randomBytes(8).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days - kids' tablets stay logged in
    sameSite: 'lax'
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, color: u.color };
}

function balanceForKid(data, kidId) {
  return data.ledger
    .filter(l => l.kidId === kidId)
    .reduce((sum, l) => sum + l.amount, 0);
}

function seedIfEmpty(data) {
  if (data.users.length === 0) {
    const adultId = db.nextId(data);
    data.users.push({
      id: adultId,
      name: 'Parent',
      role: 'adult',
      username: 'parent',
      secretHash: bcrypt.hashSync('changeme', 10),
      color: '#5B7FDE',
      createdAt: new Date().toISOString()
    });
  }
}

// ---------- auth routes ----------

// List of profiles for the login screen (no secrets included)
app.get('/api/users/public', async (req, res) => {
  const data = await db.mutate(d => { seedIfEmpty(d); return d; });
  res.json(data.users.map(publicUser));
});

app.post('/api/login', async (req, res) => {
  const { userId, secret } = req.body;
  const data = db.read();
  const user = data.users.find(u => u.id === userId);
  if (!user) return res.status(401).json({ error: 'Unknown user' });

  const ok = bcrypt.compareSync(String(secret || ''), user.secretHash);
  if (!ok) return res.status(401).json({ error: 'Incorrect password/PIN' });

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.name = user.name;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const data = db.read();
  const user = data.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  res.json({ user: publicUser(user) });
});

// ---------- user management (adults only) ----------

app.get('/api/users', requireAdult, (req, res) => {
  const data = db.read();
  res.json(data.users.map(publicUser));
});

app.post('/api/users', requireAdult, async (req, res) => {
  const { name, role, secret, color } = req.body;
  if (!name || !role || !secret) return res.status(400).json({ error: 'name, role, and secret are required' });
  if (!['adult', 'kid'].includes(role)) return res.status(400).json({ error: 'role must be adult or kid' });
  if (role === 'kid' && !/^\d{4}$/.test(String(secret))) {
    return res.status(400).json({ error: 'Kid PIN must be exactly 4 digits' });
  }

  const user = await db.mutate(d => {
    const id = db.nextId(d);
    const u = {
      id,
      name,
      role,
      secretHash: bcrypt.hashSync(String(secret), 10),
      color: color || '#5B7FDE',
      createdAt: new Date().toISOString()
    };
    d.users.push(u);
    return u;
  });
  res.status(201).json(publicUser(user));
});

app.put('/api/users/:id/secret', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  const { secret } = req.body;
  if (!secret) return res.status(400).json({ error: 'secret is required' });

  const result = await db.mutate(d => {
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
  await db.mutate(d => {
    d.users = d.users.filter(u => u.id !== id);
  });
  res.json({ ok: true });
});

// ---------- chores ----------

app.get('/api/chores', requireLogin, (req, res) => {
  const data = db.read();
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
  const chore = await db.mutate(d => {
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
  const chore = await db.mutate(d => {
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
  await db.mutate(d => { d.chores = d.chores.filter(c => c.id !== id); });
  res.json({ ok: true });
});

// Mark a chore done -> creates a ledger entry for the kid who did it.
// Repeatable chores never lock into a "done" state - they can be completed
// again immediately, each time adding its own ledger entry.
app.post('/api/chores/:id/complete', requireAdult, async (req, res) => {
  const id = Number(req.params.id);
  const { kidId } = req.body; // required if chore.assignedTo is null

  const result = await db.mutate(d => {
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
  const result = await db.mutate(d => {
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

app.get('/api/balance/:kidId', requireLogin, (req, res) => {
  const kidId = Number(req.params.kidId);
  if (req.session.role === 'kid' && req.session.userId !== kidId) {
    return res.status(403).json({ error: 'Not your balance' });
  }
  const data = db.read();
  res.json({ kidId, balance: balanceForKid(data, kidId) });
});

app.get('/api/balances', requireAdult, (req, res) => {
  const data = db.read();
  const kids = data.users.filter(u => u.role === 'kid');
  res.json(kids.map(k => ({ kidId: k.id, name: k.name, balance: balanceForKid(data, k.id) })));
});

// Manual adjustment (allowance top-up, penalty, correction, etc.)
app.post('/api/ledger/adjust', requireAdult, async (req, res) => {
  const { kidId, amount, reason } = req.body;
  if (!kidId || typeof amount !== 'number' || amount === 0 || !reason) {
    return res.status(400).json({ error: 'kidId, non-zero numeric amount, and reason are required' });
  }
  const data = db.read();
  const kid = data.users.find(u => u.id === kidId && u.role === 'kid');
  if (!kid) return res.status(400).json({ error: 'Kid not found' });

  const entry = await db.mutate(d => {
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
app.get('/api/ledger', requireLogin, (req, res) => {
  const data = db.read();
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

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
  console.log(`Allowance Tracker running at http://localhost:${PORT}`);
  console.log(`On your local network, use this machine's IP address, e.g. http://192.168.1.X:${PORT}`);
});
