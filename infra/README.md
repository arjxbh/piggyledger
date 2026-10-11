# PiggyLedger AWS deployment

The CDK stack runs the existing Express application on one small Amazon Linux
2023 EC2 instance and stores application data in an on-demand DynamoDB table.
The table uses AWS-managed encryption, TTL for expired access and verification
tokens, and a `RETAIN` removal policy.

## Prerequisites

- AWS CLI credentials for the target account
- Node.js 24 LTS
- AWS CDK bootstrapped in the target region
- An active Mailjet account with `piggyledger.net` validated as a sending domain
- Mailjet SPF and DKIM records configured for `piggyledger.net`
- An AWS Secrets Manager secret named `piggyledger/mailjet`

Create the `piggyledger/mailjet` secret in the AWS Console using the JSON key/value
secret type. It must contain `apiKey` and `secretKey` fields populated from
Mailjet. Do not store either value in source control or pass the secret key as a
CDK context value. The application sends from `no-reply@piggyledger.net`.

## Deploy

```bash
cd infra
npm install
export CDK_DEFAULT_REGION=us-east-1
export KEY_PAIR_NAME=your-existing-key-pair  # optional
npm run deploy
```

Production deployment now prepares a CloudFormation change set, rejects every
replacement/removal and every shared-host modification, and executes only that
exact change set. Only the application association, its asset-read policy, and
CDK metadata can change through this path. It checks the installed stack policy,
all three SSM targets, and all three public sites before deployment, then checks
the host ID and public sites afterward. Only `--profile NAME` is accepted as an
optional deployment argument. Do not bypass this path with direct CDK deployment.

The production AMI is pinned to `ami-03c3da4cfa8e8943a`. First-boot application
asset selection is also frozen to preserve the live UserData exactly; current
application releases use the SSM association's asset. Updating the image or boot
script is a separate, explicitly approved shared-host migration. An AWS-side
stack policy in `production-stack-policy.json` blocks replacement/deletion of
the host, networking, instance role, and database even through direct CDK.
CloudFormation stack policies do not prevent direct EC2 API calls or stack
deletion; the mandatory production rules in `../AGENTS.md` cover those actions.

Run `npm test` in this directory for the production deployment gate tests.
The deployment guard intentionally refuses infrastructure changes; prepare and
review those separately with all dependent sites and data preservation included.

The stack keeps the current low-cost single-instance topology: no NAT gateway,
one public subnet, one Elastic IP, a `t3.micro`, and DynamoDB on-demand billing.
Caddy terminates HTTPS for `piggyledger.net`.

On first boot, the instance generates the Express session secret in SSM
Parameter Store. The instance role can read only the named Mailjet secret.
Family access tokens are random, hashed before storage in DynamoDB, and never
placed in CloudFormation outputs, Secrets Manager, or Parameter Store.

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
- Email, family QR, and child-specific QR entry links expire after 30 minutes.
- Browser session links issued after successful sign-in expire after 90 days.
- DynamoDB TTL removes expired records asynchronously, while the application
  rejects them immediately based on their stored expiration time.

If `MAILJET_FROM_EMAIL` or `MAILJET_SECRET_ID` is unset outside production,
email content is written as a structured development log entry.
