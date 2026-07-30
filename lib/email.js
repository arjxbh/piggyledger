'use strict';

const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');

const fromEmail = process.env.SES_FROM_EMAIL;
const appBaseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ses = new SESv2Client({});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function send({ to, subject, text, html }) {
  if (!fromEmail) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SES_FROM_EMAIL is required in production');
    }
    console.log(JSON.stringify({ type: 'development-email', to, subject, text }));
    return;
  }

  await ses.send(new SendEmailCommand({
    FromEmailAddress: fromEmail,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: text, Charset: 'UTF-8' },
          Html: { Data: html, Charset: 'UTF-8' }
        }
      }
    }
  }));
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
    text: `Use this link to access Piggy Ledger. It expires in 90 days.\n\n${textLinks}`,
    html: `<p>Use a link below to access Piggy Ledger. Each link expires in 90 days.</p><ul>${htmlLinks}</ul>`
  });
}

module.exports = { sendSignupVerification, sendAccessLinks, appBaseUrl };
