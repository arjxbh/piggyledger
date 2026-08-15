'use strict';

const crypto = require('crypto');
const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  paginateScan,
  TransactWriteCommand
} = require('@aws-sdk/lib-dynamodb');

const TABLE_NAME = process.env.DYNAMODB_TABLE_NAME;
if (!TABLE_NAME) {
  throw new Error('DYNAMODB_TABLE_NAME is required');
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const familyPk = familyId => `FAMILY#${familyId}`;
const tokenPk = tokenHash => `TOKEN#${tokenHash}`;
const emailPk = email => `EMAIL#${normalizeEmail(email)}`;
const verificationPk = tokenHash => `VERIFY#${tokenHash}`;
const rateLimitPk = (scope, value) => `RATE#${scope}#${hashToken(value)}`;
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const normalizeEmail = email => String(email || '').trim().toLowerCase();
const newId = () => crypto.randomUUID();
const epochSeconds = date => Math.floor(date.getTime() / 1000);

function stripKeys(item) {
  if (!item) return item;
  const { PK, SK, entityType, version, expiresAt, ...record } = item;
  return record;
}

function recordKey(type, id) {
  return `${type.toUpperCase()}#${id}`;
}

function defaultData(family) {
  return {
    family: stripKeys(family),
    users: [],
    chores: [],
    ledger: [],
    moneyRequests: [],
    nextId: family?.nextId || 1
  };
}

async function read(familyId) {
  const items = [];
  let cursor;
  do {
    const result = await client.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': familyPk(familyId) },
      ConsistentRead: true,
      ExclusiveStartKey: cursor
    }));
    items.push(...(result.Items || []));
    cursor = result.LastEvaluatedKey;
  } while (cursor);

  const meta = items.find(item => item.SK === 'META');
  if (!meta) return null;

  const data = defaultData(meta);
  for (const item of items) {
    if (item.entityType === 'user') data.users.push(stripKeys(item));
    if (item.entityType === 'chore') data.chores.push(stripKeys(item));
    if (item.entityType === 'ledger') data.ledger.push(stripKeys(item));
    if (item.entityType === 'money-request') data.moneyRequests.push(stripKeys(item));
  }
  const firstAdult = data.users
    .filter(user => user.role === 'adult')
    .sort((a, b) => a.id - b.id)[0];
  if (firstAdult && !data.users.some(user => user.role === 'adult' && user.email) && meta.email) {
    firstAdult.email = normalizeEmail(meta.email);
  }
  Object.defineProperty(data, '_version', { value: meta.version || 0, enumerable: false });
  return data;
}

function nextId(data) {
  const id = data.nextId;
  data.nextId += 1;
  return id;
}

function mapRecords(data) {
  const records = new Map();
  for (const [type, values] of [
    ['user', data.users],
    ['chore', data.chores],
    ['ledger', data.ledger],
    ['money-request', data.moneyRequests || []]
  ]) {
    for (const value of values) {
      records.set(recordKey(type, value.id), { ...value, entityType: type });
    }
  }
  return records;
}

function stable(value) {
  return JSON.stringify(value, Object.keys(value).sort());
}

function adultEmails(users) {
  const emails = new Map();
  for (const user of users.filter(value => value.role === 'adult' && value.email)) {
    const email = normalizeEmail(user.email);
    if (emails.has(email)) throw new Error('Adult email addresses must be unique within a family');
    user.email = email;
    emails.set(email, user);
  }
  return emails;
}

async function mutate(familyId, fn, { syncAdultEmails = false } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const before = await read(familyId);
    if (!before) throw new Error('Family not found');
    const beforeRecords = mapRecords(before);
    const data = structuredClone(before);
    const result = await fn(data);
    const afterRecords = mapRecords(data);

    const transaction = [{
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: familyPk(familyId),
          SK: 'META',
          entityType: 'family',
          id: familyId,
          name: before.family.name,
          email: before.family.email,
          createdAt: before.family.createdAt,
          nextId: data.nextId,
          version: before._version + 1
        },
        ConditionExpression: '#version = :version',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':version': before._version }
      }
    }];

    for (const [key, value] of afterRecords) {
      const previous = beforeRecords.get(key);
      if (!previous || stable(previous) !== stable(value)) {
        transaction.push({
          Put: {
            TableName: TABLE_NAME,
            Item: { PK: familyPk(familyId), SK: key, ...value }
          }
        });
      }
    }
    for (const key of beforeRecords.keys()) {
      if (!afterRecords.has(key)) {
        transaction.push({
          Delete: { TableName: TABLE_NAME, Key: { PK: familyPk(familyId), SK: key } }
        });
      }
    }

    if (syncAdultEmails) {
      const beforeEmails = adultEmails(before.users);
      const afterEmails = adultEmails(data.users);
      for (const [email, user] of afterEmails) {
        const previous = beforeEmails.get(email);
        if (!previous || previous.id !== user.id) {
          transaction.push({
            Put: {
              TableName: TABLE_NAME,
              Item: {
                PK: emailPk(email),
                SK: familyPk(familyId),
                entityType: 'email-family',
                familyId,
                familyName: before.family.name,
                email,
                userId: user.id,
                createdAt: new Date().toISOString()
              }
            }
          });
        }
      }
      for (const email of beforeEmails.keys()) {
        if (!afterEmails.has(email)) {
          transaction.push({
            Delete: {
              TableName: TABLE_NAME,
              Key: { PK: emailPk(email), SK: familyPk(familyId) }
            }
          });
        }
      }
    }

    if (transaction.length > 100) {
      throw new Error('This change affects too many records at once');
    }

    try {
      await client.send(new TransactWriteCommand({ TransactItems: transaction }));
      return result;
    } catch (error) {
      if (error.name !== 'TransactionCanceledException' || attempt === 3) throw error;
    }
  }
}

async function createFamily({ familyName, parentName, email, secretHash, verificationHash }) {
  const familyId = newId();
  const userId = 1;
  const now = new Date().toISOString();
  const normalizedEmail = normalizeEmail(email);
  const transaction = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: familyPk(familyId),
          SK: 'META',
          entityType: 'family',
          id: familyId,
          name: familyName,
          email: normalizedEmail,
          createdAt: now,
          nextId: 2,
          version: 0
        },
        ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: familyPk(familyId),
          SK: recordKey('user', userId),
          entityType: 'user',
          id: userId,
          name: parentName,
          role: 'adult',
          email: normalizedEmail,
          secretHash,
          color: '#5B7FDE',
          createdAt: now
        }
      }
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: emailPk(normalizedEmail),
          SK: familyPk(familyId),
          entityType: 'email-family',
          familyId,
          familyName,
          email: normalizedEmail,
          userId,
          createdAt: now
        }
      }
    }
  ];

  if (verificationHash) {
    transaction.push({
      Delete: {
        TableName: TABLE_NAME,
        Key: { PK: verificationPk(verificationHash), SK: 'REQUEST' },
        ConditionExpression: 'attribute_exists(PK)'
      }
    });
  }

  await client.send(new TransactWriteCommand({ TransactItems: transaction }));
  return { familyId, userId };
}

async function createAccessToken(familyId, lifetimeSeconds, kind, { userId } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + lifetimeSeconds * 1000);
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: tokenPk(hashToken(token)),
      SK: 'TOKEN',
      entityType: 'access-token',
      familyId,
      kind,
      userId,
      createdAt: now.toISOString(),
      expiresAt: epochSeconds(expires)
    }
  }));
  return { token, expiresAt: expires.toISOString() };
}

async function resolveAccessToken(token) {
  if (!token) return null;
  const result = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: tokenPk(hashToken(token)), SK: 'TOKEN' },
    ConsistentRead: true
  }));
  if (!result.Item || result.Item.expiresAt <= epochSeconds(new Date())) return null;
  return {
    familyId: result.Item.familyId,
    kind: result.Item.kind,
    userId: result.Item.userId,
    expiresAt: result.Item.expiresAt
  };
}

async function deleteAccessToken(token) {
  if (!token) return;
  await client.send(new DeleteCommand({
    TableName: TABLE_NAME,
    Key: { PK: tokenPk(hashToken(token)), SK: 'TOKEN' }
  }));
}

async function putSignupVerification(details, lifetimeSeconds) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + lifetimeSeconds * 1000);
  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      PK: verificationPk(hashToken(token)),
      SK: 'REQUEST',
      entityType: 'signup-verification',
      ...details,
      createdAt: new Date().toISOString(),
      expiresAt: epochSeconds(expires)
    }
  }));
  return { token, expiresAt: expires.toISOString() };
}

async function reserveSignupEmailSend(email, {
  cooldownSeconds = 15 * 60,
  dailyLimit = 3
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  const nowSeconds = epochSeconds(now);
  const day = now.toISOString().slice(0, 10);
  const tomorrow = new Date(`${day}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);

  try {
    await client.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              PK: rateLimitPk('signup-email', normalizedEmail),
              SK: 'COOLDOWN',
              entityType: 'rate-limit',
              nextAllowedAt: nowSeconds + cooldownSeconds,
              expiresAt: nowSeconds + cooldownSeconds
            },
            ConditionExpression: 'attribute_not_exists(PK) OR nextAllowedAt <= :now',
            ExpressionAttributeValues: { ':now': nowSeconds }
          }
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: { PK: rateLimitPk('signup-email', normalizedEmail), SK: `DAY#${day}` },
            UpdateExpression: 'ADD #count :one SET entityType = :type, expiresAt = :expiresAt',
            ConditionExpression: 'attribute_not_exists(#count) OR #count < :dailyLimit',
            ExpressionAttributeNames: { '#count': 'count' },
            ExpressionAttributeValues: {
              ':one': 1,
              ':type': 'rate-limit',
              ':expiresAt': epochSeconds(tomorrow),
              ':dailyLimit': dailyLimit
            }
          }
        }
      ]
    }));
    return true;
  } catch (error) {
    if (error.name === 'TransactionCanceledException') return false;
    throw error;
  }
}

async function getSignupVerification(token) {
  const tokenHash = hashToken(token || '');
  const result = await client.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { PK: verificationPk(tokenHash), SK: 'REQUEST' },
    ConsistentRead: true
  }));
  if (!result.Item || result.Item.expiresAt <= epochSeconds(new Date())) return null;
  return { ...stripKeys(result.Item), tokenHash };
}

async function familiesForEmail(email) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': emailPk(email) },
    ConsistentRead: true
  }));
  return (result.Items || []).map(stripKeys);
}

async function firstFamily() {
  const families = [];
  const paginator = paginateScan({ client }, {
    TableName: TABLE_NAME,
    FilterExpression: 'SK = :meta AND entityType = :family',
    ExpressionAttributeValues: {
      ':meta': 'META',
      ':family': 'family'
    },
    ProjectionExpression: 'PK, SK, id, #name, email, createdAt, nextId, version',
    ExpressionAttributeNames: { '#name': 'name' },
    ConsistentRead: true
  });

  for await (const page of paginator) {
    families.push(...(page.Items || []));
  }

  families.sort((a, b) => {
    const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    return created || String(a.id).localeCompare(String(b.id));
  });
  return families[0] ? stripKeys(families[0]) : null;
}

async function importFamily({ familyId = newId(), familyName, email, data }) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();
  const firstAdult = data.users
    .filter(user => user.role === 'adult')
    .sort((a, b) => a.id - b.id)[0];
  if (!firstAdult) throw new Error('Migration data must contain at least one adult');
  firstAdult.email = normalizedEmail;
  const items = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: familyPk(familyId), SK: 'META', entityType: 'family',
          id: familyId, name: familyName, email: normalizedEmail,
          createdAt: now, nextId: data.nextId, version: 0
        },
        ConditionExpression: 'attribute_not_exists(PK)'
      }
    },
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          PK: emailPk(normalizedEmail), SK: familyPk(familyId),
          entityType: 'email-family', familyId, familyName,
          email: normalizedEmail, userId: firstAdult.id, createdAt: now
        }
      }
    },
    ...data.users.map(value => ({ Put: { TableName: TABLE_NAME, Item: {
      PK: familyPk(familyId), SK: recordKey('user', value.id), entityType: 'user', ...value
    } } })),
    ...data.chores.map(value => ({ Put: { TableName: TABLE_NAME, Item: {
      PK: familyPk(familyId), SK: recordKey('chore', value.id), entityType: 'chore', ...value
    } } })),
    ...data.ledger.map(value => ({ Put: { TableName: TABLE_NAME, Item: {
      PK: familyPk(familyId), SK: recordKey('ledger', value.id), entityType: 'ledger', ...value
    } } })),
    ...(data.moneyRequests || []).map(value => ({ Put: { TableName: TABLE_NAME, Item: {
      PK: familyPk(familyId), SK: recordKey('money-request', value.id), entityType: 'money-request', ...value
    } } }))
  ];
  if (items.length > 100) throw new Error('Migration has more than 100 records; split/batch migration is required');
  await client.send(new TransactWriteCommand({ TransactItems: items }));
  return familyId;
}

module.exports = {
  read,
  mutate,
  nextId,
  createFamily,
  createAccessToken,
  resolveAccessToken,
  deleteAccessToken,
  putSignupVerification,
  reserveSignupEmailSend,
  getSignupVerification,
  familiesForEmail,
  firstFamily,
  importFamily,
  normalizeEmail
};
