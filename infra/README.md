# PiggyLedger AWS deployment

This CDK stack deploys PiggyLedger to one Amazon Linux 2023 EC2 instance in
`us-east-1` by default. The application is packaged from the repository and
installed on first boot and updated in place by an SSM State Manager
association on later deployments.

## Prerequisites

- AWS CLI credentials configured for the target account
- Node.js 20 or newer
- AWS CDK CLI (`npm install -g aws-cdk`)
- CDK bootstrapped in the target region: `cdk bootstrap aws://ACCOUNT/us-east-1`
- An optional EC2 key pair if SSH access is desired; SSM is enabled by default

The deploying identity needs permissions to create the CDK bootstrap assets,
VPC, EC2 instance, IAM role, security group, EBS volume, SSM association, and
SSM parameters. It also needs `ec2:DescribeAvailabilityZones` for synthesis.

## Deploy

```bash
cd infra
npm install
export CDK_DEFAULT_REGION=us-east-1
export KEY_PAIR_NAME=your-existing-key-pair   # optional; omit for SSM-only access
npm run deploy
```

The output includes the instance public IP and the application URL. The stack
opens HTTP port 80 only to redirect requests to HTTPS and opens HTTPS port 443
for Caddy, which obtains and renews Let's Encrypt certificates automatically
for `piggyledger.net` and `www.piggyledger.net`. Node listens on port 3000
behind the reverse proxy, and administration is available through AWS Systems
Manager Session Manager.

Each deployment updates the application through an SSM association, preserves
`data/db.json`, restores the environment from Parameter Store, and restarts the
service. It does not replace the EC2 instance, so existing certificate and
ledger data remain in place.

On first boot, the instance generates the application session secret and shared
access token as standard `SecureString` parameters in AWS Systems Manager
Parameter Store. Later deployments reuse those values and set `SESSION_SECRET`
and `ACCESS_TOKEN` in the application's environment. Standard parameters have
no storage charge. Retrieve the access token from
`/piggyledger/PiggyLedgerStack/access-token` in Parameter Store when creating a
login link; the token value is not included in CloudFormation outputs or boot
logs.

Retrieve the access token with the AWS CLI:

```bash
aws ssm get-parameter \
  --name /piggyledger/PiggyLedgerStack/access-token \
  --with-decryption \
  --query Parameter.Value \
  --output text \
  --region us-east-1
```

## Important limitations

The existing `data/db.json` is deployed as the initial data file and remains
on the instance's EBS volume. The stack does not currently configure backups.
