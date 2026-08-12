# Piggy Ledger

Piggy Ledger is a multi-family chore and allowance tracker. Adults manage
chores and balances; kids see their own chores, balance, and ledger history.
Every balance change is an immutable ledger entry.

## Current architecture

- Express and Node.js 24
- DynamoDB with one tenant partition per family
- Opaque family access tokens stored only as SHA-256 hashes
- Mailjet for signup verification and parent access links
- AWS CDK infrastructure in `infra/`

Access lifetimes are deliberately different:

- Email, family QR, and child-specific QR entry links: 30 minutes
- Browser session links issued after successful sign-in: 90 days
- Signup verification links: 30 minutes

The browser stores a successful access token in local storage. An expired token
is removed after the API rejects it, and a parent can request a fresh email
link without exposing whether an address is registered.

## Local development

Create or select a DynamoDB table with string partition and sort keys named
`PK` and `SK`, then run:

```bash
npm install
export DYNAMODB_TABLE_NAME=your-development-table
export APP_BASE_URL=http://localhost:3000
npm start
```

Leave `MAILJET_FROM_EMAIL` and `MAILJET_SECRET_ID` unset in development to log email links instead of
sending them. AWS credentials must allow reads and writes on the development
table.

Open `http://localhost:3000/signup.html` to create the first family. Copy the
verification URL from the development email log.

## Build and test

```bash
npm test
npm run build
```

`npm test` runs the API endpoint suite with Node's built-in test runner. It
uses in-memory database and email fakes, so it does not need AWS credentials or
contact DynamoDB or Mailjet.

`npm run build` always runs the API tests before compiling the CDK TypeScript.
A failing test stops the build. Front-end browser test recommendations are in
[docs/frontend-integration-tests.md](docs/frontend-integration-tests.md).

## Existing JSON migration

After deploying or creating the DynamoDB table:

```bash
export DYNAMODB_TABLE_NAME=your-table
export MIGRATION_FAMILY_NAME="The Smith family"
export MIGRATION_EMAIL=parent@example.com
export APP_BASE_URL=https://piggyledger.net
npm run migrate:ddb
```

The command expects DynamoDB to contain no families. It creates the first
family using the supplied name and parent email, imports `data/db.json`, and
prints a 90-day login link. It preserves password/PIN hashes, chores, and
ledger history. If any family already exists, it exits without changing the
table. Use `MIGRATION_JSON_PATH` to select a different JSON file.

## Deployment

See [infra/README.md](infra/README.md). The stack uses DynamoDB on-demand
billing and the existing single `t3.micro` host to keep idle costs low.

## Data model

Family-owned items use `PK = FAMILY#<familyId>` and sort keys such as `META`,
`USER#<id>`, `CHORE#<id>`, and `LEDGER#<id>`. Email-to-family records, hashed
access tokens, and hashed signup verification tokens use separate lookup
partitions. Every authenticated request resolves its access token to a
`familyId`, and the session must match that same family.
