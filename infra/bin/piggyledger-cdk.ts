#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PiggyLedgerStack } from '../lib/piggyledger-stack';
import * as path from 'path';

const app = new cdk.App();

new PiggyLedgerStack(app, 'PiggyLedgerStack', {
  terminationProtection: true,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  appPath: path.resolve(__dirname, '..', '..'),
  keyName: process.env.KEY_PAIR_NAME,
});
