# Shared host HTTPS outage - October 11, 2026

CloudFormation replaced PiggyLedger's EC2 instance at 15:08 UTC. The Elastic IP
3.213.149.40 moved from i-040c79cd1bd3d6733 (terminated) to
i-012bd0886415b823d. PiggyLedger's deployment followed the replacement, but the
MidlifeMotorClubStack and KaedamaStack SSM associations retained the old target.
The replacement had no neighboring site files or Caddy snippets. PiggyLedger
also briefly returned a TLS internal error while Caddy obtained certificates.

Recovery used CloudFormation change sets named restore-shared-host-20261011.
Each changed only SiteDeployment.Properties.Targets to the new instance ID,
without replacing resources or changing IAM policies or deployed asset versions.
Both stacks completed successfully and installed their existing releases.
The neighboring scripts/deploy.sh files were updated to the new instance ID and
passed bash syntax checks.

Verified at 15:15 UTC: all three apex sites returned HTTPS 200 with certificate
validation enabled; all three www hosts returned 301 to their own apex; GET on
Kaedama's quote API returned its expected 405.

Future host replacements require retargeting and redeploying both neighboring
sites. Their deployment scripts currently use a fixed instance ID. Review CDK
diffs for EC2 replacement before applying PiggyLedger infrastructure changes.
This recovery restored application releases and routing; it did not recover or
verify any quote files that existed only on the terminated host's local disk.

## Review and prevention

The previous instance used ami-0b2c9d1f3edcfd709; the replacement used
ami-03c3da4cfa8e8943a. The stack resolved a moving public SSM latest-AMI
parameter. An ordinary deployment therefore picked up an OS image change that
required replacing EC2. The deployment entry point disabled CDK approval, and
there was no AWS stack policy blocking replacement. The neighbor deployments
used the old physical instance ID. All three sites shared the resulting blast
radius. Production release validation did not enforce preservation of the host
or successful public HTTPS checks for all dependent services.

Safeguards added:

- Pin the production image in CDK and the deployed template to the running AMI.
- Preserve the existing bootstrap asset and UserData exactly so application
  asset changes do not stop/start EC2 through a UserData update.
- Install an AWS-side stack policy denying replacement/deletion of EC2, EIP,
  networking, instance IAM resources, and the DynamoDB table.
- Enable stack termination protection, including in the CDK app.
- Replace unchecked deployment with preparation and inspection of the exact
  CloudFormation change set. Application releases permit only non-replacing
  changes to the application association, its asset policy, and CDK metadata.
- Verify stack policy, dependent SSM targets, public HTTPS, redirects, quote API,
  and preservation of the physical host ID during application deployment.
- Discover the live instance and role in both neighboring deployment scripts.
- Record mandatory production and approved-migration rules in all three
  repositories' AGENTS.md files.

These controls prevent the reviewed failure path, but they are not a highly
available architecture. The three services still share one host. Future OS or
host migrations must preserve local data, stage all services and TLS before
traffic moves, retain the old host for rollback, and receive explicit approval.
No application/UI changes were deployed as part of this safeguards review.
