'use strict';

const emailInput = document.getElementById('homeAccessEmail');
const sendButton = document.getElementById('homeAccessBtn');
const status = document.getElementById('homeAccessStatus');
const accessTokenKey = 'piggyledger_access_token';

async function continueWithSavedAccess() {
  const token = localStorage.getItem(accessTokenKey);
  if (!token) return;

  try {
    const response = await fetch('/api/access-token/status', {
      headers: { 'X-Access-Token': token }
    });
    if (response.ok) {
      location.replace('/login.html');
      return;
    }
    if (response.status === 401) localStorage.removeItem(accessTokenKey);
  } catch (error) {
    // Keep the visitor on the homepage when access cannot be verified.
  }
}

async function requestAccessLink() {
  const email = emailInput.value.trim();
  if (!email) {
    status.textContent = 'Enter the email address associated with your family.';
    return;
  }

  sendButton.disabled = true;
  status.textContent = 'Sending your secure link...';
  try {
    const response = await fetch('/api/access/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const body = await response.json();
    status.textContent = body.message || (
      response.ok ? 'Check your email for your access link.' : 'Unable to send an access link.'
    );
  } catch (error) {
    status.textContent = 'Unable to send an access link. Please try again.';
  } finally {
    sendButton.disabled = false;
  }
}

sendButton.addEventListener('click', requestAccessLink);
emailInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') requestAccessLink();
});

continueWithSavedAccess();
