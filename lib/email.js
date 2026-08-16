'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const fromEmail = process.env.MAILJET_FROM_EMAIL;
const mailjetSecretId = process.env.MAILJET_SECRET_ID;
const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const secretsManager = new SecretsManagerClient({});
let mailjetCredentialsPromise;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function getMailjetCredentials() {
  if (!mailjetCredentialsPromise) {
    mailjetCredentialsPromise = (async () => {
      if (!mailjetSecretId) throw new Error('MAILJET_SECRET_ID is required');
      const result = await secretsManager.send(new GetSecretValueCommand({ SecretId: mailjetSecretId }));
      if (!result.SecretString) throw new Error('Mailjet secret must contain a JSON SecretString');
      const credentials = JSON.parse(result.SecretString);
      if (!credentials.apiKey || !credentials.secretKey) {
        throw new Error('Mailjet secret must contain apiKey and secretKey');
      }
      return credentials;
    })().catch(error => {
      mailjetCredentialsPromise = undefined;
      throw error;
    });
  }
  return mailjetCredentialsPromise;
}

async function send({ to, subject, text, html }) {
  if (!fromEmail || !mailjetSecretId) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MAILJET_FROM_EMAIL and MAILJET_SECRET_ID are required in production');
    }
    console.log(JSON.stringify({ type: 'development-email', to, subject, text }));
    return;
  }

  const { apiKey, secretKey } = await getMailjetCredentials();
  const response = await fetch('https://api.mailjet.com/v3.1/send', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      Messages: [{
        From: { Email: fromEmail, Name: 'Piggy Ledger' },
        To: [{ Email: to }],
        Subject: subject,
        TextPart: text,
        HTMLPart: html
      }]
    }),
    signal: AbortSignal.timeout(10000)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.Messages?.[0]?.Status !== 'success') {
    const mailjetError = result?.Messages?.[0]?.Errors?.[0];
    const message = mailjetError?.ErrorMessage || `Mailjet request failed with status ${response.status}`;
    throw new Error(message);
  }
}

async function sendSignupVerification(to, token) {
  const url = `${appBaseUrl}/api/signup/verify?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: 'Verify your Piggy Ledger family',
    text: `Finish creating your Piggy Ledger family: ${url}\n\nThis link expires in 30 minutes.`,
    html: `<p>Finish creating your Piggy Ledger family:</p><p><a href="${escapeHtml(url)}">Verify email and create family</a></p><p>This link expires in 30 minutes.</p>`
  });
}

async function sendAccessLinks(to, links) {
  const textLinks = links.map(link => `${link.familyName}: ${link.url}`).join('\n\n');
  const htmlLinks = links.map(link => `<li><a href="${escapeHtml(link.url)}">${escapeHtml(link.familyName)}</a></li>`).join('');
  await send({
    to,
    subject: 'Your Piggy Ledger access link',
    text: `Use this link to sign in to your Piggy Ledger profile without a password. It expires in 30 minutes.\n\n${textLinks}`,
    html: `<p>Use a link below to sign in to your Piggy Ledger profile without a password. Each link expires in 30 minutes.</p><ul>${htmlLinks}</ul>`
  });
}

async function sendMoneyRequest(to, { kidName, kind, amount }) {
  const action = kind === 'deposit' ? 'deposit' : 'withdrawal';
  const amountText = amount === null ? 'an amount they need help choosing' : `$${(amount / 100).toFixed(2)}`;
  const dashboardUrl = `${appBaseUrl}/adult.html`;
  await send({
    to,
    subject: `${kidName} sent a ${action} request`,
    text: `${kidName} requested a ${action} of ${amountText}. Sign in to approve or deny it: ${dashboardUrl}`,
    html: `<p><strong>${escapeHtml(kidName)}</strong> requested a ${action} of ${escapeHtml(amountText)}.</p><p><a href="${escapeHtml(dashboardUrl)}">Open the family dashboard</a> to approve or deny it.</p>`
  });
}

module.exports = { sendSignupVerification, sendAccessLinks, sendMoneyRequest, appBaseUrl };
