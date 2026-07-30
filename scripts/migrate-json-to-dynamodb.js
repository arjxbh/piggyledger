'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../lib/db');

function loadJson(jsonPath) {
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  for (const key of ['users', 'chores', 'ledger']) {
    if (!Array.isArray(data[key])) throw new Error(`${key} must be an array`);
  }
  if (!Number.isInteger(data.nextId) || data.nextId < 1) {
    throw new Error('nextId must be a positive integer');
  }

  const ids = new Set();
  for (const entity of [...data.users, ...data.chores, ...data.ledger]) {
    if (!Number.isInteger(entity.id)) throw new Error('Every imported record must have an integer id');
    if (ids.has(entity.id)) throw new Error(`Duplicate record id ${entity.id} in JSON database`);
    ids.add(entity.id);
  }
  const highestId = ids.size ? Math.max(...ids) : 0;
  if (data.nextId <= highestId) {
    throw new Error(`nextId must be greater than the highest record id (${highestId})`);
  }
  return data;
}

async function main() {
  const familyName = String(process.env.MIGRATION_FAMILY_NAME || '').trim();
  const email = db.normalizeEmail(process.env.MIGRATION_EMAIL);
  if (!familyName) throw new Error('MIGRATION_FAMILY_NAME is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('MIGRATION_EMAIL must be a valid parent email address');
  }

  const jsonPath = path.resolve(
    process.env.MIGRATION_JSON_PATH || path.join(__dirname, '..', 'data', 'db.json')
  );
  const data = loadJson(jsonPath);
  const existingFamily = await db.firstFamily();
  if (existingFamily) {
    throw new Error(
      `DynamoDB already contains family ${existingFamily.id} (${existingFamily.name}); migration was not run`
    );
  }

  const familyId = await db.importFamily({ familyName, email, data });
  const access = await db.createAccessToken(familyId, 90 * 24 * 60 * 60, 'persistent');
  console.log(JSON.stringify({
    tableName: process.env.DYNAMODB_TABLE_NAME,
    jsonPath,
    familyId,
    familyName,
    email,
    importedCounts: {
      users: data.users.length,
      chores: data.chores.length,
      ledger: data.ledger.length
    },
    loginUrl: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/login.html?access_token=${access.token}`,
    expiresAt: access.expiresAt
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
