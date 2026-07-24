import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as s3assets from 'aws-cdk-lib/aws-s3-assets';
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

    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    });

    appAsset.bucket.grantRead(role);
    const sessionSecret = new secretsmanager.Secret(this, 'SessionSecret', {
      description: 'PiggyLedger Express session secret',
      generateSecretString: { passwordLength: 64, excludePunctuation: false },
    });
    sessionSecret.grantRead(role);

    const userData = ec2.UserData.forLinux({ shebang: '#!/bin/bash -xe' });

    userData.addCommands(
      'yum update -y',
      'yum install -y git aws-cli nginx openssl unzip',
      'curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -',
      'yum install -y nodejs npm',
      'mkdir -p /opt/piggyledger',
      `aws s3 cp "s3://${appAsset.s3BucketName}/${appAsset.s3ObjectKey}" /tmp/piggyledger.tgz`,
      'unzip -q /tmp/piggyledger.tgz -d /opt/piggyledger',
      'cd /opt/piggyledger',
      'npm install --omit=dev',
      'cat > /opt/piggyledger/.env <<EOF',
      'NODE_ENV=production',
      `SESSION_SECRET=$(aws secretsmanager get-secret-value --secret-id ${sessionSecret.secretArn} --query SecretString --output text)`,
      'PORT=3000',
      'EOF',
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
      'cat > /etc/nginx/conf.d/piggyledger.conf <<EOF',
      'server {',
      '    listen 80;',
      '    server_name _;',
      '    location / {',
      '        proxy_pass http://127.0.0.1:3000;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '    }',
      '}',
      'EOF',
      'systemctl enable --now nginx',
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
      associatePublicIpAddress: true,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(20, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
    });

    new cdk.CfnOutput(this, 'PublicIp', {
      value: instance.instancePublicIp,
      description: 'Public IP address of the EC2 instance',
    });

    new cdk.CfnOutput(this, 'AppUrl', {
      value: `http://${instance.instancePublicIp}`,
      description: 'URL for the deployed PiggyLedger application',
    });
  }
}
