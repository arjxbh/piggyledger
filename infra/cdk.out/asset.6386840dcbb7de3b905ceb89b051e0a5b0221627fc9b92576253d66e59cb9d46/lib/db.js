// Tiny file-based JSON "database".
// Good enough for a household app with a handful of users and low write volume.
// All writes go through a simple in-process queue so two requests can't
// clobber each other while writing to the same file.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function defaultData() {
  return {
    users: [],   // { id, name, role: 'adult'|'kid', username(adult)/pin-hash, secretHash, color, createdAt }
    chores: [],  // { id, title, value, assignedTo (userId|null), status: 'pending'|'done', createdAt, completedAt, completedBy }
    ledger: [],  // { id, kidId, amount, reason, type: 'chore'|'adjustment', chOreId?, date, createdBy, createdByName }
    nextId: 1
  };
}

function ensureDb() {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultData(), null, 2));
  }
}

function readRaw() {
  ensureDb();
  const text = fs.readFileSync(DB_PATH, 'utf8');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('db.json is corrupted: ' + e.message);
  }
}

function writeRaw(data) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function nextId(data) {
  const id = data.nextId;
  data.nextId += 1;
  return id;
}

// Every mutation (read -> modify -> write) is chained onto this single
// promise so requests are fully serialized end-to-end. That rules out lost
// updates if two people tap something at the same moment.
let queue = Promise.resolve();

// Run a synchronous mutation function against the current data, then persist.
// fn receives (data) and may mutate it / return a value.
function mutate(fn) {
  const task = queue.then(() => {
    const data = readRaw();
    const result = fn(data);
    writeRaw(data);
    return result;
  });
  // Keep the chain alive even if this task throws, so later tasks still run.
  queue = task.catch(() => {});
  return task;
}

function read() {
  return readRaw();
}

module.exports = { read, mutate, nextId, DB_PATH };
