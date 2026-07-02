const colorFor = (name) => {
  const palette = ['#3E7FBF', '#E8A33D', '#2E9E85', '#E15A46', '#8B6FD6', '#C4801F'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[hash];
};

const initials = (name) => name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

let currentUser = null;
let pin = '';

async function init() {
  // If already logged in, go straight to the right dashboard
  try {
    const meRes = await fetch('/api/me');
    if (meRes.ok) {
      const { user } = await meRes.json();
      location.href = user.role === 'adult' ? '/adult.html' : '/kid.html';
      return;
    }
  } catch (e) { /* not logged in, continue */ }

  const res = await fetch('/api/users/public');
  const users = await res.json();
  const grid = document.getElementById('profileGrid');

  if (users.length === 0) {
    grid.innerHTML = `<div class="empty">No profiles yet.</div>`;
    return;
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
  const res = await fetch('/api/login', {
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

init();
