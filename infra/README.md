# PiggyLedger AWS deployment

This CDK stack deploys PiggyLedger to one Amazon Linux 2023 EC2 instance in
`us-east-1` by default. The application is packaged from the repository and
installed by EC2 user data.

## Prerequisites

- AWS CLI credentials configured for the target account
- Node.js 20 or newer
- AWS CDK CLI (`npm install -g aws-cdk`)
- CDK bootstrapped in the target region: `cdk bootstrap aws://ACCOUNT/us-east-1`
- An optional EC2 key pair if SSH access is desired; SSM is enabled by default

The deploying identity needs permissions to create the CDK bootstrap assets,
VPC, EC2 instance, IAM role, security group, EBS volume, and Secrets Manager
secret. It also needs `ec2:DescribeAvailabilityZones` for synthesis.

## Deploy

```bash
cd infra
npm install
export CDK_DEFAULT_REGION=us-east-1
export KEY_PAIR_NAME=your-existing-key-pair   # optional; omit for SSM-only access
npm run deploy
```

The output includes the instance public IP and the application URL. The stack
opens only HTTP port 80 publicly. Node listens on localhost port 3000, and
administration is available through AWS Systems Manager Session Manager when
the AWS account has the SSM service enabled.

## Important limitations

This intentionally minimal deployment does not provision a domain or TLS
certificate. Do not use it for sensitive data over the public internet. For a
private family app, the safer low-maintenance option is to place it behind a
VPN or use a tunnel service; adding HTTPS requires a domain and certificate.

The existing `data/db.json` is deployed as the initial data file and remains
on the instance's EBS volume. The stack does not currently configure backups.