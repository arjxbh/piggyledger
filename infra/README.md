# PiggyLedger AWS deployment

The CDK stack runs the existing Express application on one small Amazon Linux
2023 EC2 instance and stores application data in an on-demand DynamoDB table.
The table uses AWS-managed encryption, TTL for expired access and verification
tokens, and a `RETAIN` removal policy.

## Prerequisites

- AWS CLI credentials for the target account
- Node.js 24 LTS
- AWS CDK bootstrapped in the target region
- A verified Amazon SES identity for `piggyledger.net`
- Amazon SES production access if mail must be sent to unverified recipients

The application sends from `no-reply@piggyledger.net`. Change
`SES_FROM_EMAIL` and the matching IAM identity ARN in
`lib/piggyledger-stack.ts` if another verified identity is used.

## Deploy

```bash
cd infra
npm install
export CDK_DEFAULT_REGION=us-east-1
export KEY_PAIR_NAME=your-existing-key-pair  # optional
npm run deploy
```

The stack keeps the current low-cost single-instance topology: no NAT gateway,
one public subnet, one Elastic IP, a `t3.micro`, and DynamoDB on-demand billing.
Caddy terminates HTTPS for `piggyledger.net`.

On first boot, the instance generates only the Express session secret in SSM
Parameter Store. Family access tokens are random, hashed before storage in
DynamoDB, and never placed in CloudFormation outputs or Parameter Store.

## Migrate the existing JSON family

Deploy the DynamoDB table first. Then run the migration once from a machine
with DynamoDB access:

```bash
export DYNAMODB_TABLE_NAME=table-name-from-cdk-output
export MIGRATION_FAMILY_NAME="The Smith family"
export MIGRATION_EMAIL=parent@example.com
export APP_BASE_URL=https://piggyledger.net
npm run migrate:ddb
```

The command expects an empty table, creates the first family, imports the JSON
users, chores, and ledger transactionally, and prints a 90-day login link. If
any family already exists, it exits without changing the table. A migration
requiring more than 100 transactional writes is also rejected without changing
the table.

## Email behavior

- Signup verification links expire after 30 minutes.
- QR access links expire after 10 minutes.
- Emailed access links expire after 90 days.
- DynamoDB TTL removes expired records asynchronously, while the application
  rejects them immediately based on their stored expiration time.

If `SES_FROM_EMAIL` is unset outside production, email content is written as a
structured development log entry.
