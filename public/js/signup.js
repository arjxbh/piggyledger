'use strict';

const params = new URLSearchParams(location.search);
const initialStatus = params.get('status');
if (initialStatus === 'expired') {
  document.getElementById('signupError').textContent = 'That verification link expired. Please sign up again.';
}
if (initialStatus === 'used') {
  document.getElementById('signupError').textContent = 'That verification link was already used. Try logging in or request an access link.';
}

document.getElementById('signupBtn').addEventListener('click', async () => {
  const button = document.getElementById('signupBtn');
  const error = document.getElementById('signupError');
  const status = document.getElementById('signupStatus');
  const body = {
    familyName: document.getElementById('familyName').value.trim(),
    parentName: document.getElementById('parentName').value.trim(),
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value
  };
  error.textContent = '';
  status.textContent = '';
  button.disabled = true;
  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (!res.ok) {
      error.textContent = result.error || 'Unable to create family.';
      return;
    }
    status.textContent = result.message;
  } catch (requestError) {
    error.textContent = 'Unable to create family. Please try again.';
  } finally {
    button.disabled = false;
  }
});
