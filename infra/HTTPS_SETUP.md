# HTTPS setup for PiggyLedger on EC2

The CDK stack configures HTTPS automatically with Caddy and Let's Encrypt for
`piggyledger.net` and `www.piggyledger.net`.

## DNS prerequisites

- Point the root `A` record for `piggyledger.net` at the stack's `ElasticIpOutput`.
- Point `www` at the root domain with a `CNAME`, or create another `A` record
  using the same Elastic IP.
- Allow time for DNS changes to propagate.

The security group permits ports 80 and 443. Caddy uses port 80 for ACME
validation and redirects normal HTTP traffic to HTTPS. It obtains a certificate
when DNS reaches the instance and renews it automatically.

## Deploy

```bash
cd infra
npm install
export CDK_DEFAULT_REGION=us-east-1
npm run deploy
```

Application releases are applied in place through AWS Systems Manager State
Manager. The deployment preserves `data/db.json`, restores the secret
environment values from SSM Parameter Store, and restarts PiggyLedger without
replacing the instance.

An instance previously configured manually with Nginx and Certbot is left
unchanged by an in-place application deployment. Caddy becomes the standard
HTTPS setup if the stack creates a new instance.

## Verify

```bash
curl -I https://piggyledger.net
curl -I http://piggyledger.net
```

The HTTPS response should include:

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

The HTTP response should redirect to HTTPS.

On an instance provisioned with Caddy, inspect its status and certificate logs
through Session Manager:

```bash
sudo systemctl status caddy
sudo journalctl -u caddy --no-pager
```

Express trusts one local reverse proxy and marks production session cookies
`Secure`. The Node service is not exposed by the EC2 security group.
