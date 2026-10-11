# AWS Guidance
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.
## Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.

## Production safety - mandatory after the October 11, 2026 outage

- This EC2 host is shared production infrastructure for piggyledger.net,
  midlifemotor.club, and kaedamacycles.com. Treat every host, IAM, networking,
  Caddy, and infrastructure change as affecting all three services.
- A request to change or deploy application code does not authorize replacing,
  stopping, rebooting, terminating, or moving the shared host or Elastic IP.
- Before deployment, inspect the live stack, host ID, image ID, stack policy,
  all dependent SSM associations, and the exact CloudFormation change set.
  A CDK text diff alone is insufficient. Reject replacements, removals,
  conditional replacements, and EC2 modifications during application releases.
- Use the guarded npm run deploy path. Never use require-approval never,
  hotswap, express mode, direct unchecked change-set execution, or disable or
  override a production stack policy to get a release through.
- Pin production AMIs. Never use latest-image references. Keep boot UserData
  stable across application releases; deploy applications through SSM.
- Host replacement requires explicit approval for a concrete migration plan:
  stage all three services on a new host, preserve local quote data and TLS
  state, verify certificates and application health before traffic moves,
  keep the old host available for rollback, and retire it only after checks pass.
- Discover dependent host IDs and roles from the live PiggyLedger stack;
  never copy a previous physical instance ID into deployment scripts.
- Preserve the shared Caddy import and use the shared deployment lock. Validate
  configuration before reloading. Never rewrite another site's snippet.
- Before and after any production change, verify all three HTTPS apex sites,
  their www redirects, and Kaedama's quote service. Report completion only after
  CloudFormation and SSM have succeeded and these external checks pass.
- If a safety check fails, stop the deployment and investigate. Do not broaden
  scope or bypass protections. Preserve unrelated workspace changes.
