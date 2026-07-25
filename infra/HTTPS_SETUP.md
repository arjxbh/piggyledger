# HTTPS setup for PiggyLedger on EC2

This document describes how to enable HTTPS for the PiggyLedger app running on the EC2 instance provisioned by the CDK stack in `infra/`.

Summary
- Fast, low-cost option: Use Let's Encrypt + `certbot` on the EC2 instance (recommended).
- Requirements: domain DNS pointed at the instance's Elastic IP and port 80/443 open in the instance security group.

Prerequisites
1. You own the domain (e.g. `piggyledger.net`) and have an A record pointing to the Elastic IP. See your domain registrar DNS page.
2. The EC2 instance is running and Nginx is serving the app on port 80.
3. Security group inbound rules allow at least port 80 from the internet. For HTTPS also allow port 443.

Quick checklist
- [ ] DNS A record for `@` -> `ELASTIC_IP`
- [ ] DNS CNAME or A record for `www` -> `@` or `ELASTIC_IP`
- [ ] Security group rules: HTTP (80) and HTTPS (443) allowed
- [ ] Nginx active and proxying to `127.0.0.1:3000`

Commands to run on the instance (Amazon Linux / RHEL family)

1. Update the Nginx server_name (replace domain):

```bash
sudo bash -lc 'cat > /etc/nginx/conf.d/piggyledger.conf <<'EOF'
server {
    listen 80;
    server_name piggyledger.net www.piggyledger.net;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF'

sudo nginx -t && sudo systemctl reload nginx
```

2. Install Certbot (Nginx plugin) and request a certificate:

```bash
sudo yum install -y certbot python3-certbot-nginx
sudo certbot --nginx -d piggyledger.net -d www.piggyledger.net --non-interactive --agree-tos -m youremail@example.com
```

- `certbot` will obtain the cert and update Nginx config to serve HTTPS, and will default to creating a renewal cron/systemd timer.

3. Test HTTPS and redirect (curl):

```bash
curl -I https://piggyledger.net
curl -I http://piggyledger.net   # should redirect to https if certbot enabled redirect
```

4. Confirm automatic renewal (Certbot creates a systemd timer or cron job). Test renewal dry-run:

```bash
sudo certbot renew --dry-run
```

Security-hardening recommendations
- In `server.js` enable secure cookies when running under HTTPS by setting `cookie.secure = true` for sessions and `app.set('trust proxy', 1)` if Nginx terminates TLS.

Example (Node/Express):

```js
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*24*30, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));
```

- Ensure `SESSION_SECRET` is set (the CDK stack already provisions a Secrets Manager secret the instance reads).
- Consider enabling HTTP Strict Transport Security (HSTS) by adding a header in Nginx:

```
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

Updating the CDK to open port 443

If you want the CDK to open port 443 automatically, update the security group rule in `infra/lib/piggyledger-stack.ts` (already used for port 80) to include:

```ts
securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from anywhere');
```

Then redeploy the stack:

```bash
cd infra
npm run deploy
```

Automating Certbot via CDK userData (optional)

You can also install `certbot` from the CDK `userData` script and run the certbot command there, but certbot requires DNS to be propagated for domain validation. For simplicity, running certbot manually once on the instance after DNS points at the Elastic IP is recommended.

Troubleshooting
- If `certbot` cannot validate the domain, double-check that the domain's A record resolves to the Elastic IP and that HTTP (80) is reachable.
- Use `sudo nginx -t` to check config syntax and `sudo journalctl -u nginx -b` to inspect logs.

If you want I can:
- add the `securityGroup` change to the CDK stack and synth/deploy it for you, or
- run the exact certbot commands on the instance via SSM if you give me approval to proceed.

---

Document created at `infra/HTTPS_SETUP.md`.
