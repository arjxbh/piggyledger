const colorFor = (name) => {
  const palette = ['#3E7FBF', '#E8A33D', '#2E9E85', '#E15A46', '#8B6FD6', '#C4801F'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[hash];
};

const initials = (name) => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

let currentUser = null;
let pin = '';
let qrStream = null;
let qrScanning = false;

function getAccessToken() {
  return localStorage.getItem('piggyledger_access_token');
}

function accessHeaders() {
  const token = getAccessToken();
  return token ? { 'X-Access-Token': token } : {};
}

function setLoginSubtitle(text) {
  const subtitle = document.getElementById('subtitle');
  if (subtitle) subtitle.textContent = text;
}

function setAccessControls(hasAccess) {
  document.getElementById('loginEntry').classList.toggle('hidden', hasAccess);
  document.getElementById('switchFamilyBtn').classList.toggle('hidden', !hasAccess);
}

function updateAccessTokenStatus() {
  const token = getAccessToken();
  setAccessControls(Boolean(token));
  if (token) {
    setLoginSubtitle('Choose your name to sign in.');
  } else {
    setLoginSubtitle('Ask a parent for your QR code.');
  }
}

function parseAccessTokenFromUrlSearch(search) {
  return new URLSearchParams(search).get('access_token');
}

async function accessTokenStatus(token) {
  if (!token) return null;
  try {
    const response = await fetch('/api/access-token/status', {
      headers: { 'X-Access-Token': token }
    });
    return response.ok ? response.json() : null;
  } catch (error) {
    return null;
  }
}

async function handleNewAccessToken(token) {
  const currentToken = getAccessToken();
  const [incoming, current] = await Promise.all([
    accessTokenStatus(token),
    accessTokenStatus(currentToken)
  ]);
  if (!incoming) {
    setAccessControls(Boolean(current));
    setLoginSubtitle(current ? 'Choose your name to sign in.' : 'That QR code or link has expired. Ask your parent for a new one.');
    return false;
  }

  const keepCurrent = current &&
    current.familyId === incoming.familyId &&
    Date.parse(current.expiresAt) >= Date.parse(incoming.expiresAt);
  if (!keepCurrent) {
    localStorage.setItem('piggyledger_access_token', token);
  }
  setAccessControls(true);
  await fetchWithToken('/api/logout', { method: 'POST' });
  setLoginSubtitle(
    keepCurrent
      ? 'You’re ready. Choose your name to sign in.'
      : 'You’re ready. Choose your name to sign in.'
  );
  return true;
}

function clearAccessToken() {
  localStorage.removeItem('piggyledger_access_token');
  setAccessControls(false);
}

async function fetchWithToken(url, options = {}) {
  options.headers = { ...(options.headers || {}), ...accessHeaders() };
  return fetch(url, options);
}

async function loadProfiles() {
  const grid = document.getElementById('profileGrid');
  setLoginSubtitle('Loading profiles…');

  try {
    const res = await fetchWithToken('/api/users/public');
    if (!res.ok) {
      grid.innerHTML = '';
      if (res.status === 401) {
        clearAccessToken();
        setLoginSubtitle('Ask a parent for a new QR code. Adults can sign in below.');
      } else {
        setLoginSubtitle('Unable to load profiles. Please try again.');
      }
      return false;
    }

    const users = await res.json();
    setLoginSubtitle('Choose your name to sign in.');

    if (users.length === 0) {
      grid.innerHTML = `<div class="empty">No profiles yet.</div>`;
      return true;
    }

    grid.innerHTML = users.map(u => `
      <button class="profile-tile" data-id="${u.id}" data-role="${u.role}" data-name="${u.name}" style="border:none;">
        <div class="avatar" style="background:${colorFor(u.name)}">${initials(u.name)}</div>
        <div class="name">${u.name}</div>
        <div class="role">${u.role === 'adult' ? 'Adult' : 'Kid'}</div>
      </button>
    `).join('');

    grid.querySelectorAll('.profile-tile').forEach(tile => {
      tile.addEventListener('click', () => selectProfile(tile));
    });
    return true;
  } catch (err) {
    grid.innerHTML = '';
    setLoginSubtitle('Unable to load profiles. Check your connection and try again.');
    return false;
  }
}

async function init() {
  const urlToken = parseAccessTokenFromUrlSearch(window.location.search);
  if (urlToken) {
    history.replaceState(null, '', window.location.pathname);
    await handleNewAccessToken(urlToken);
  } else {
    updateAccessTokenStatus();
  }

  // If already logged in, go straight to the right dashboard
  try {
    const meRes = await fetchWithToken('/api/me');
    if (meRes.ok) {
      const { user } = await meRes.json();
      location.href = user.role === 'adult' ? '/adult.html' : '/kid.html';
      return;
    }
  } catch (e) { /* not logged in, continue */ }

  await loadProfiles();
}

function selectProfile(tile) {
  currentUser = { id: Number(tile.dataset.id), role: tile.dataset.role, name: tile.dataset.name };
  pin = '';
  document.getElementById('profileGrid').classList.add('hidden');
  document.getElementById('authPanel').classList.remove('hidden');
  document.getElementById('authName').textContent = currentUser.name;
  document.getElementById('errorMsg').textContent = '';

  if (currentUser.role === 'adult') {
    document.getElementById('passwordBlock').classList.remove('hidden');
    document.getElementById('pinBlock').classList.add('hidden');
    document.getElementById('passwordInput').value = '';
    document.getElementById('passwordInput').focus();
  } else {
    document.getElementById('pinBlock').classList.remove('hidden');
    document.getElementById('passwordBlock').classList.add('hidden');
    renderPin();
  }
}

function renderPin() {
  const display = document.getElementById('pinDisplay');
  display.innerHTML = [0, 1, 2, 3].map(i => `<div class="pin-dot ${i < pin.length ? 'filled' : ''}"></div>`).join('');

  const pad = document.getElementById('pinPad');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  pad.innerHTML = keys.map(k => {
    if (k === 'clear') return `<button data-key="clear" class="wide">Clear</button>`;
    if (k === 'back') return `<button data-key="back" class="wide">&larr;</button>`;
    return `<button data-key="${k}">${k}</button>`;
  }).join('');

  pad.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => onPinKey(btn.dataset.key));
  });
}

function onPinKey(key) {
  if (key === 'clear') { pin = ''; renderPin(); return; }
  if (key === 'back') { pin = pin.slice(0, -1); renderPin(); return; }
  if (pin.length >= 4) return;
  pin += key;
  renderPin();
  if (pin.length === 4) attemptLogin(pin);
}

async function attemptLogin(secret) {
  const res = await fetchWithToken('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: currentUser.id, secret })
  });
  if (res.ok) {
    const { user } = await res.json();
    location.href = user.role === 'adult' ? '/adult.html' : '/kid.html';
  } else {
    const { error } = await res.json();
    document.getElementById('errorMsg').textContent = error || 'Login failed';
    pin = '';
    renderPin();
  }
}

function startQrScan() {
  const video = document.getElementById('qrVideo');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;

  qrScanning = true;
  document.getElementById('scanModal').classList.remove('hidden');

  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    .then(stream => {
      qrStream = stream;
      video.srcObject = stream;
      video.play();
      scanFrame();
    })
    .catch(() => {
      alert('The camera did not work. Ask a parent for help.');
      stopQrScan();
    });

  function scanFrame() {
    if (!qrScanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data) {
        try {
          const url = new URL(code.data);
          const accessToken = url.searchParams.get('access_token');
          if (accessToken) {
            stopQrScan();
            handleNewAccessToken(accessToken).then(accepted => {
              if (accepted) loadProfiles();
            });
            return;
          }
        } catch (err) {
          // ignore invalid QR code data
        }
      }
    }
    requestAnimationFrame(scanFrame);
  }
}

function stopQrScan() {
  qrScanning = false;
  const video = document.getElementById('qrVideo');
  if (qrStream) {
    qrStream.getTracks().forEach(track => track.stop());
    qrStream = null;
  }
  video.pause();
  video.srcObject = null;
  document.getElementById('scanModal').classList.add('hidden');
}

document.getElementById('passwordSubmit').addEventListener('click', () => {
  const val = document.getElementById('passwordInput').value;
  if (!val) return;
  attemptLogin(val);
});
document.getElementById('passwordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('passwordSubmit').click();
});
document.getElementById('backBtn').addEventListener('click', () => {
  document.getElementById('authPanel').classList.add('hidden');
  document.getElementById('profileGrid').classList.remove('hidden');
  document.getElementById('errorMsg').textContent = '';
});
document.getElementById('scanTokenBtn').addEventListener('click', () => startQrScan());
document.getElementById('stopScanBtn').addEventListener('click', () => stopQrScan());
document.getElementById('cancelScanBtn').addEventListener('click', () => stopQrScan());
document.getElementById('emailAccessBtn').addEventListener('click', async () => {
  const email = document.getElementById('accessEmail').value.trim();
  const status = document.getElementById('emailAccessStatus');
  if (!email) {
    status.textContent = 'Type your email.';
    return;
  }

  const button = document.getElementById('emailAccessBtn');
  button.disabled = true;
  status.textContent = 'Sending your sign-in link...';
  try {
    const response = await fetch('/api/access/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const body = await response.json();
    status.textContent = response.ok
      ? 'Check your email for your sign-in link.'
      : (body.error || 'We could not send the link. Try again.');
  } catch (error) {
    status.textContent = 'We could not send the link. Try again.';
  } finally {
    button.disabled = false;
  }
});
document.getElementById('accessEmail').addEventListener('keydown', event => {
  if (event.key === 'Enter') document.getElementById('emailAccessBtn').click();
});
document.getElementById('switchFamilyBtn').addEventListener('click', async () => {
  clearAccessToken();
  try {
    await fetch('/api/logout', { method: 'POST' });
  } finally {
    location.href = '/';
  }
});

init();
