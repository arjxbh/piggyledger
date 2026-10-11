const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertSafeChanges, main } = require('../scripts/deploy-production.cjs');
const policy = require('../production-stack-policy.json');
function plan(resource = {}) {
  return { Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: [{
    Type: 'Resource', ResourceChange: {
      LogicalResourceId: 'AppDeployment', ResourceType: 'AWS::SSM::Association',
      Action: 'Modify', Replacement: 'False', ...resource,
    },
  }] };
}
test('application deployment can update without replacing resources', () => {
  assert.doesNotThrow(() => assertSafeChanges(plan()));
});
test('recorded production outage pattern: EC2 replacement is blocked', () => {
  assert.throws(() => assertSafeChanges(plan({ LogicalResourceId: 'InstanceC1063A87', ResourceType: 'AWS::EC2::Instance', Replacement: 'True' })), /Blocked/);
});
test('ambiguous replacements, deletions, renamed resources, and host modifications are blocked', () => {
  for (const r of [
    { Replacement: 'Conditional' }, { Replacement: undefined }, { Action: 'Remove' },
    { Action: 'Add', LogicalResourceId: 'NewHost' },
    { LogicalResourceId: 'InstanceC1063A87', ResourceType: 'AWS::EC2::Instance' },
    { LogicalResourceId: 'ElasticIp', ResourceType: 'AWS::EC2::EIP' },
    { LogicalResourceId: 'DataTable447BC44E', ResourceType: 'AWS::DynamoDB::Table' },
  ]) assert.throws(() => assertSafeChanges(plan(r)), /Blocked/);
});
test('an unready change set cannot execute', () => {
  assert.throws(() => assertSafeChanges({ ...plan(), Status: 'CREATE_IN_PROGRESS' }));
  assert.throws(() => assertSafeChanges({ ...plan(), ExecutionStatus: 'EXECUTE_COMPLETE' }));
  assert.throws(() => assertSafeChanges({ ...plan(), Changes: [] }));
});
test('arguments cannot bypass the deployment gate', async () => {
  await assert.rejects(main(['--hotswap']), /Only --profile/);
  await assert.rejects(main(['--require-approval', 'never']), /Only --profile/);
});
test('AWS-side policy protects hosts, addresses, roles, network, and durable data', () => {
  const deny = policy.Statement.find(s => s.Effect === 'Deny');
  assert.deepEqual(deny.Action, ['Update:Replace', 'Update:Delete']);
  for (const type of ['AWS::EC2::Instance', 'AWS::EC2::EIP', 'AWS::IAM::Role', 'AWS::DynamoDB::Table']) {
    assert.ok(deny.Condition.StringEquals.ResourceType.includes(type));
  }
});
