#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const stack = 'PiggyLedgerStack';
const region = 'us-east-1';
const account = '294281109519';
const sites = ['piggyledger.net', 'midlifemotor.club', 'kaedamacycles.com'];

function assertSafeChanges(changeSet) {
  if (changeSet.Status !== 'CREATE_COMPLETE' || changeSet.ExecutionStatus !== 'AVAILABLE') {
    throw new Error('Change set must be complete and available before execution.');
  }
  if (!Array.isArray(changeSet.Changes) || changeSet.Changes.length === 0) {
    throw new Error('No executable resource changes.');
  }
  const allowed = new Map([
    ['AppDeployment', 'AWS::SSM::Association'],
    ['InstanceRoleDefaultPolicy1531605C', 'AWS::IAM::Policy'],
    ['CDKMetadata', 'AWS::CDK::Metadata'],
  ]);
  for (const change of changeSet.Changes) {
    const r = change.ResourceChange;
    if (change.Type !== 'Resource' || !r || r.Action !== 'Modify' ||
        r.Replacement !== 'False' || allowed.get(r.LogicalResourceId) !== r.ResourceType) {
      throw new Error(`Blocked production change: ${JSON.stringify(r || change)}`);
    }
  }
}

async function verifySites() {
  for (const site of sites) {
    const response = await fetch(`https://${site}/`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    await response.body?.cancel();
    if (response.status !== 200) throw new Error(`${site}: expected HTTPS 200, got ${response.status}`);
    const www = await fetch(`https://www.${site}/`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    await www.body?.cancel();
    if (www.status !== 301 || www.headers.get('location') !== `https://${site}/`) {
      throw new Error(`${site}: incorrect www redirect`);
    }
  }
  const quote = await fetch('https://kaedamacycles.com/api/quotes', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  await quote.body?.cancel();
  if (quote.status !== 405) throw new Error(`Kaedama quote service: expected 405, got ${quote.status}`);
  const api = await fetch('https://piggyledger.net/api/health', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  await api.body?.cancel();
  if (api.status !== 200) throw new Error(`PiggyLedger API: expected 200, got ${api.status}`);
}

async function main(args) {
  // No forwarding arbitrary CDK flags: flags can bypass preparation or guards.
  const profile = [];
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--profile' || !args[1] || args[1].startsWith('-')) {
      throw new Error('Only --profile NAME is supported. Infrastructure changes need a separate reviewed plan.');
    }
    profile.push('--profile', args[1]);
  }
  const aws = (service, operation, rest = []) => JSON.parse(execFileSync('aws', [
    service, operation, '--region', region, ...profile, '--no-cli-pager', '--output', 'json', ...rest,
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
  const cdk = (rest) => execFileSync(resolve(__dirname, '../node_modules/.bin/cdk'), [
    ...rest, ...profile,
  ], { cwd: resolve(__dirname, '..'), stdio: 'inherit' });
  if (aws('sts', 'get-caller-identity').Account !== account) throw new Error('Wrong AWS account.');
  const policy = aws('cloudformation', 'get-stack-policy', ['--stack-name', stack]);
  const expected = JSON.parse(readFileSync(resolve(__dirname, '../production-stack-policy.json'), 'utf8'));
  if (!policy.StackPolicyBody || !isDeepStrictEqual(JSON.parse(policy.StackPolicyBody), expected)) {
    throw new Error('Production stack policy is missing or differs from the reviewed protection policy.');
  }
  const resources = aws('cloudformation', 'describe-stack-resources', ['--stack-name', stack]).StackResources;
  const host = resources.find(r => r.LogicalResourceId === 'InstanceC1063A87')?.PhysicalResourceId;
  if (!host) throw new Error('Shared host was not found.');
  const associations = aws('ssm', 'list-associations').Associations;
  for (const name of ['PiggyLedgerStack-app-deployment', 'MidlifeMotorClubStack-site-deployment', 'KaedamaStack-site-deployment']) {
    const a = associations.find(x => x.AssociationName === name);
    if (!a || !a.Targets?.some(t => t.Key === 'InstanceIds' && t.Values.length === 1 && t.Values[0] === host) ||
        a.Overview?.Status !== 'Success') throw new Error(`${name}: deployment target or health is incorrect.`);
  }
  await verifySites();
  execFileSync('npm', ['run', 'build'], { cwd: resolve(__dirname, '../..'), stdio: 'inherit' });
  const name = `guarded-release-${Date.now()}`;
  cdk(['synth', stack, '--quiet']);
  cdk(['diff', stack]);
  cdk(['deploy', stack, '--no-execute', '--change-set-name', name, '--require-approval', 'broadening']);
  const changeSet = aws('cloudformation', 'describe-change-set', ['--stack-name', stack, '--change-set-name', name]);
  assertSafeChanges(changeSet);
  console.log(JSON.stringify(changeSet.Changes, null, 2));
  // Execute the exact reviewed change set; never synthesize a second template.
  aws('cloudformation', 'execute-change-set', ['--stack-name', stack, '--change-set-name', name]);
  execFileSync('aws', ['cloudformation', 'wait', 'stack-update-complete', '--stack-name', stack,
    '--region', region, ...profile, '--no-cli-pager'], { stdio: 'inherit' });
  const after = aws('cloudformation', 'describe-stack-resource', ['--stack-name', stack, '--logical-resource-id', 'InstanceC1063A87']);
  if (after.StackResourceDetail.PhysicalResourceId !== host) throw new Error('Shared host changed unexpectedly.');
  await verifySites();
  console.log('Production release completed; shared host preserved and all three sites verified.');
}

module.exports = { assertSafeChanges, verifySites, main };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
