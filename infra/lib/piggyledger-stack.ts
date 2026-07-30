import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

export interface PiggyLedgerStackProps extends cdk.StackProps {
  appPath: string;
  keyName?: string;
}

export class PiggyLedgerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PiggyLedgerStackProps) {
    super(scope, id, props);

    const appAsset = new s3assets.Asset(this, 'PiggyLedgerAppAsset', {
      path: props.appPath,
      exclude: [
        'infra/**',
        'node_modules/**',
        '.git/**',
        'cdk.out/**',
      ],
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc,
      allowAllOutbound: true,
      description: 'Minimal public access for PiggyLedger EC2 host',
    });

    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from anywhere');
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from anywhere');

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    appAsset.bucket.grantRead(role);
    const table = new dynamodb.Table(this, 'DataTable', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    table.grantReadWriteData(role);
    const emailIdentity = new ses.CfnEmailIdentity(this, 'EmailIdentity', {
      emailIdentity: 'piggyledger.net',
    });
    role.addToPolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: ['*'],
      conditions: {
        StringEquals: {
          'ses:FromAddress': 'no-reply@piggyledger.net',
        },
      },
    }));

    const parameterPrefix = `/piggyledger/${this.stackName}`;
    const sessionSecretParameter = `${parameterPrefix}/session-secret`;
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ssm:GetParameter',
        'ssm:PutParameter',
      ],
      resources: [
        this.formatArn({
          service: 'ssm',
          resource: 'parameter',
          resourceName: `piggyledger/${this.stackName}/*`,
        }),
      ],
    }));

    const userData = ec2.UserData.forLinux({ shebang: '#!/bin/bash -xe' });

    userData.addCommands(
      'yum update -y',
      'yum install -y git aws-cli openssl unzip dnf-plugins-core',
      'dnf copr enable -y @caddy/caddy epel-9-x86_64',
      'yum install -y caddy',
      'curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -',
      'yum install -y nodejs --disablerepo=amazonlinux --disablerepo=kernel-livepatch',
      'mkdir -p /opt/piggyledger',
      `aws s3 cp "s3://${appAsset.s3BucketName}/${appAsset.s3ObjectKey}" /tmp/piggyledger.tgz`,
      'unzip -q /tmp/piggyledger.tgz -d /opt/piggyledger',
      'cd /opt/piggyledger',
      'npm install --omit=dev',
      'set +x',
      `SESSION_SECRET_PARAMETER="${sessionSecretParameter}"`,
      'if ! aws ssm get-parameter --name "$SESSION_SECRET_PARAMETER" >/dev/null 2>&1; then aws ssm put-parameter --name "$SESSION_SECRET_PARAMETER" --type SecureString --tier Standard --value "$(openssl rand -hex 32)"; fi',
      'cat > /opt/piggyledger/.env <<EOF',
      'NODE_ENV=production',
      'SESSION_SECRET=$(aws ssm get-parameter --name "$SESSION_SECRET_PARAMETER" --with-decryption --query Parameter.Value --output text)',
      `DYNAMODB_TABLE_NAME=${table.tableName}`,
      'SES_FROM_EMAIL=no-reply@piggyledger.net',
      'APP_BASE_URL=https://piggyledger.net',
      'PORT=3000',
      'EOF',
      'chmod 600 /opt/piggyledger/.env',
      'set -x',
      'cat > /etc/systemd/system/piggyledger.service <<EOF',
      '[Unit]',
      'Description=PiggyLedger Node.js app',
      'After=network.target',
      '[Service]',
      'WorkingDirectory=/opt/piggyledger',
      'EnvironmentFile=/opt/piggyledger/.env',
      'ExecStart=/usr/bin/node server.js',
      'Restart=always',
      'RestartSec=5',
      'User=ec2-user',
      'Group=ec2-user',
      '[Install]',
      'WantedBy=multi-user.target',
      'EOF',
      'chown -R ec2-user:ec2-user /opt/piggyledger',
      'chmod 755 /opt/piggyledger',
      'systemctl daemon-reload',
      'systemctl enable --now piggyledger',
      "cat > /etc/caddy/Caddyfile <<'EOF'",
      'piggyledger.net, www.piggyledger.net {',
      '    reverse_proxy 127.0.0.1:3000',
      '    header Strict-Transport-Security "max-age=31536000; includeSubDomains"',
      '}',
      'EOF',
      'systemctl enable --now caddy',
    );

    const instance = new ec2.Instance(this, 'Instance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.X86_64,
      }),
      keyPair: props.keyName
        ? ec2.KeyPair.fromKeyPairName(this, 'KeyPair', props.keyName)
        : undefined,
      role,
      userData,
      userDataCausesReplacement: false,
      associatePublicIpAddress: false,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    const elasticIp = new ec2.CfnEIP(this, 'ElasticIp', {
      domain: 'vpc',
    });

    new ec2.CfnEIPAssociation(this, 'ElasticIpAssociation', {
      allocationId: elasticIp.attrAllocationId,
      instanceId: instance.instanceId,
    });

    const appDeployment = new ssm.CfnAssociation(this, 'AppDeployment', {
      name: 'AWS-RunShellScript',
      associationName: `${this.stackName}-app-deployment`,
      targets: [
        {
          key: 'InstanceIds',
          values: [instance.instanceId],
        },
      ],
      parameters: {
        commands: [
          'set -euo pipefail',
          'for attempt in {1..60}; do systemctl cat piggyledger >/dev/null 2>&1 && break; sleep 5; done',
          'test -f /etc/systemd/system/piggyledger.service',
          'mkdir -p /tmp/piggyledger-deploy',
          'rm -f /tmp/piggyledger-deploy/app.zip /tmp/piggyledger-deploy/db.json',
          'if test -f /opt/piggyledger/data/db.json; then cp /opt/piggyledger/data/db.json /tmp/piggyledger-deploy/db.json; fi',
          `aws s3 cp "s3://${appAsset.s3BucketName}/${appAsset.s3ObjectKey}" /tmp/piggyledger-deploy/app.zip`,
          'unzip -oq /tmp/piggyledger-deploy/app.zip -d /opt/piggyledger',
          'if test -f /tmp/piggyledger-deploy/db.json; then mkdir -p /opt/piggyledger/data && cp /tmp/piggyledger-deploy/db.json /opt/piggyledger/data/db.json; fi',
          'if ! node --version | grep -q "^v24\\."; then yum remove -y nodejs nodejs-npm nodejs-libs nodejs-docs nodejs-full-i18n || true; curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - && yum install -y nodejs --disablerepo=amazonlinux --disablerepo=kernel-livepatch; fi',
          'cd /opt/piggyledger && npm install --omit=dev',
          'set +x',
          `SESSION_SECRET_PARAMETER="${sessionSecretParameter}"`,
          'if ! aws ssm get-parameter --name "$SESSION_SECRET_PARAMETER" >/dev/null 2>&1; then aws ssm put-parameter --name "$SESSION_SECRET_PARAMETER" --type SecureString --tier Standard --value "$(openssl rand -hex 32)"; fi',
          `cat > /opt/piggyledger/.env <<EOF\nNODE_ENV=production\nSESSION_SECRET=$(aws ssm get-parameter --name "$SESSION_SECRET_PARAMETER" --with-decryption --query Parameter.Value --output text)\nDYNAMODB_TABLE_NAME=${table.tableName}\nSES_FROM_EMAIL=no-reply@piggyledger.net\nAPP_BASE_URL=https://piggyledger.net\nPORT=3000\nEOF`,
          'chown -R ec2-user:ec2-user /opt/piggyledger',
          'chmod 600 /opt/piggyledger/.env',
          'systemctl restart piggyledger',
          'systemctl is-active --quiet piggyledger',
        ],
      },
      waitForSuccessTimeoutSeconds: 600,
    });
    appDeployment.node.addDependency(instance);
    appDeployment.node.addDependency(role.node.findChild('DefaultPolicy'));

    new cdk.CfnOutput(this, 'ElasticIpOutput', {
      value: elasticIp.ref,
      description: 'Elastic IP address allocated to the EC2 instance',
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: 'https://piggyledger.net',
      description: 'URL for the deployed PiggyLedger application',
    });
    new cdk.CfnOutput(this, 'DataTableName', {
      value: table.tableName,
      description: 'DynamoDB table used by PiggyLedger',
    });
    [
      ['SesDkimName1', emailIdentity.attrDkimDnsTokenName1],
      ['SesDkimValue1', emailIdentity.attrDkimDnsTokenValue1],
      ['SesDkimName2', emailIdentity.attrDkimDnsTokenName2],
      ['SesDkimValue2', emailIdentity.attrDkimDnsTokenValue2],
      ['SesDkimName3', emailIdentity.attrDkimDnsTokenName3],
      ['SesDkimValue3', emailIdentity.attrDkimDnsTokenValue3],
    ].forEach(([id, value]) => {
      new cdk.CfnOutput(this, id, {
        value,
        description: 'Add this SES DKIM CNAME field to Squarespace DNS',
      });
    });
  }
}
