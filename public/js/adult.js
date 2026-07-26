let me = null;
let allUsers = [];
let allChores = [];

function getAccessToken() {
  const urlToken = new URLSearchParams(window.location.search).get('access_token');
  if (urlToken) {
    localStorage.setItem('piggyledger_access_token', urlToken);
    history.replaceState(null, '', window.location.pathname);
    return urlToken;
  }
  return localStorage.getItem('piggyledger_access_token');
}

function accessHeaders() {
  const token = getAccessToken();
  return token ? { 'X-Access-Token': token } : {};
}

async function fetchWithToken(url, options = {}) {
  options.headers = { ...(options.headers || {}), ...accessHeaders() };
  return fetch(url, options);
}

function toCents(dollarStr) {
  return Math.round(parseFloat(dollarStr) * 100);
}
function money(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const s = `$${(abs / 100).toFixed(2)}`;
  return negative ? `-${s}` : s;
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function colorFor(name) {
  const palette = ['#3E7FBF', '#E8A33D', '#2E9E85', '#E15A46', '#8B6FD6', '#C4801F'];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[hash];
}
function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
function kidName(id) {
  const k = allUsers.find(u => u.id === id);
  return k ? k.name : 'Unknown';
}

async function init() {
  const meRes = await fetchWithToken('/api/me');
  if (!meRes.ok) { location.href = '/login.html'; return; }
  const { user } = await meRes.json();
  if (user.role !== 'adult') { location.href = '/kid.html'; return; }
  me = user;
  document.getElementById('whoName').textContent = user.name;

  await loadUsers();
  await loadChores();
  await loadBalances();
  await loadAudit();
  wireUp();
}

// ---------- data loading ----------

async function loadUsers() {
  const res = await fetchWithToken('/api/users');
  allUsers = await res.json();

  const kids = allUsers.filter(u => u.role === 'kid');

  const assignSel = document.getElementById('choreAssign');
  assignSel.innerHTML = `<option value="">Anyone (up for grabs)</option>` +
    kids.map(k => `<option value="${k.id}">${k.name}</option>`).join('');

  const filterSel = document.getElementById('filterKid');
  filterSel.innerHTML = `<option value="">All kids</option>` +
    kids.map(k => `<option value="${k.id}">${k.name}</option>`).join('');

  renderPeople();
}

async function loadChores() {
  const res = await fetchWithToken('/api/chores');
  allChores = await res.json();
  renderChores();
}

async function loadBalances() {
  const res = await fetchWithToken('/api/balances');
  const balances = await res.json();
  renderKidGrid(balances);
}

async function loadAudit(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetchWithToken('/api/ledger' + (qs ? `?${qs}` : ''));
  const entries = await res.json();
  renderAudit(entries);
}

// ---------- rendering ----------

function renderChores() {
  const list = document.getElementById('choreList');
  if (allChores.length === 0) {
    list.innerHTML = `<div class="empty"><div class="big">🧺</div>No chores yet. Add one above.</div>`;
    return;
  }
  // Order: pending one-time chores first, then reusable chores, then completed one-time chores
  const rank = (c) => (c.repeatable ? 1 : (c.status === 'pending' ? 0 : 2));
  const sorted = [...allChores].sort((a, b) => rank(a) - rank(b) || b.id - a.id);

  list.innerHTML = sorted.map(c => {
    if (c.repeatable) {
      const lastLine = c.lastCompletedAt
        ? `Last done by ${kidName(c.lastCompletedFor)} · ${fmtDate(c.lastCompletedAt)} · completed ${c.completionCount} time${c.completionCount === 1 ? '' : 's'}`
        : 'Not completed yet';
      return `
        <div class="ticket">
          <div class="stub">${money(c.value)}</div>
          <div class="body">
            <div>
              <div class="title">${c.title}</div>
              <div class="meta">${c.assignedTo ? `Assigned to ${kidName(c.assignedTo)}` : 'Anyone'} · ${lastLine}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="chip repeatable">↻ Reusable</span>
              <button class="btn btn-mint btn-sm" data-complete="${c.id}">Mark done</button>
              ${c.completionCount > 0 ? `<button class="btn btn-ghost btn-sm" data-reopen="${c.id}">Undo last</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-delete-chore="${c.id}">Delete</button>
            </div>
          </div>
        </div>
      `;
    }
    return `
    <div class="ticket ${c.status === 'done' ? 'done' : ''}">
      <div class="stub">${money(c.value)}</div>
      <div class="body">
        <div>
          <div class="title">${c.title}</div>
          <div class="meta">
            ${c.assignedTo ? `Assigned to ${kidName(c.assignedTo)}` : (c.completedFor ? `Done by ${kidName(c.completedFor)}` : 'Anyone')}
            ${c.status === 'done' && c.completedAt ? ` · Completed ${fmtDate(c.completedAt)}` : ''}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="chip ${c.status}">${c.status === 'done' ? 'Done' : 'To do'}</span>
          ${c.status === 'pending'
            ? `<button class="btn btn-mint btn-sm" data-complete="${c.id}">Mark done</button>`
            : `<button class="btn btn-ghost btn-sm" data-reopen="${c.id}">Undo</button>`}
          <button class="btn btn-ghost btn-sm" data-delete-chore="${c.id}">Delete</button>
        </div>
      </div>
    </div>
  `;
  }).join('');

  list.querySelectorAll('[data-complete]').forEach(btn => {
    btn.addEventListener('click', () => onCompleteClick(Number(btn.dataset.complete)));
  });
  list.querySelectorAll('[data-reopen]').forEach(btn => {
    btn.addEventListener('click', () => onReopen(Number(btn.dataset.reopen)));
  });
  list.querySelectorAll('[data-delete-chore]').forEach(btn => {
    btn.addEventListener('click', () => onDeleteChore(Number(btn.dataset.deleteChore)));
  });
}

function renderKidGrid(balances) {
  const grid = document.getElementById('kidGrid');
  if (balances.length === 0) {
    grid.innerHTML = `<div class="empty"><div class="big">🐷</div>No kids added yet. Add one under the People tab.</div>`;
    return;
  }
  grid.innerHTML = balances.map(b => `
    <div class="kid-card" data-kid="${b.kidId}">
      <div class="avatar" style="background:${colorFor(b.name)}">${initials(b.name)}</div>
      <div class="name" style="margin-top:8px;">${b.name}</div>
      <div class="bal">${money(b.balance)}</div>
      <div class="muted" style="font-size:12px; margin-top:4px;">Tap to adjust</div>
    </div>
  `).join('');
  grid.querySelectorAll('.kid-card').forEach(card => {
    card.addEventListener('click', () => openAdjustModal(Number(card.dataset.kid)));
  });
}

function renderAudit(entries) {
  const body = document.getElementById('auditBody');
  if (entries.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="muted">No entries match.</td></tr>`;
    return;
  }
  body.innerHTML = entries.map(e => `
    <tr>
      <td>${fmtDate(e.date)}</td>
      <td>${kidName(e.kidId)}</td>
      <td>${e.reason}</td>
      <td class="muted">${e.createdByName || ''}</td>
      <td class="amt ${e.amount >= 0 ? 'pos' : 'neg'}">${e.amount >= 0 ? '+' : ''}${money(e.amount)}</td>
    </tr>
  `).join('');
}

function renderPeople() {
  const grid = document.getElementById('peopleGrid');
  grid.innerHTML = allUsers.map(u => `
    <div class="kid-card" style="cursor:default;">
      <div class="avatar" style="background:${colorFor(u.name)}">${initials(u.name)}</div>
      <div class="name" style="margin-top:8px;">${u.name}</div>
      <div class="muted" style="text-transform:uppercase; font-size:11.5px; margin-top:2px;">${u.role}</div>
      <div class="form-actions" style="margin-top:12px;">
        <button class="btn btn-ghost btn-sm" data-reset="${u.id}" data-role="${u.role}" data-name="${u.name}">Reset login</button>
        ${u.id !== me.id ? `<button class="btn btn-ghost btn-sm" data-remove="${u.id}">Remove</button>` : ''}
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', () => openResetModal(Number(btn.dataset.reset), btn.dataset.role, btn.dataset.name));
  });
  grid.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => onRemoveUser(Number(btn.dataset.remove)));
  });
}

// ---------- actions ----------

async function onCompleteClick(choreId) {
  const chore = allChores.find(c => c.id === choreId);
  if (chore.assignedTo) {
    await completeChore(choreId, null);
  } else {
    openPickKidModal(choreId);
  }
}

async function completeChore(choreId, kidId) {
  const res = await fetchWithToken(`/api/chores/${choreId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kidId })
  });
  if (!res.ok) {
    const { error } = await res.json();
    alert(error);
    return;
  }
  await Promise.all([loadChores(), loadBalances(), loadAudit()]);
}

async function onReopen(choreId) {
  if (!confirm('Undo this chore? This will reverse the money it earned.')) return;
  const res = await fetchWithToken(`/api/chores/${choreId}/reopen`, { method: 'POST' });
  if (!res.ok) { const { error } = await res.json(); alert(error); return; }
  await Promise.all([loadChores(), loadBalances(), loadAudit()]);
}

async function onDeleteChore(choreId) {
  if (!confirm('Delete this chore? (Its ledger history, if any, stays intact.)')) return;
  await fetchWithToken(`/api/chores/${choreId}`, { method: 'DELETE' });
  await loadChores();
}

async function onRemoveUser(userId) {
  if (!confirm('Remove this person? Their ledger history will be kept for the audit trail.')) return;
  const res = await fetchWithToken(`/api/users/${userId}`, { method: 'DELETE' });
  if (!res.ok) { const { error } = await res.json(); alert(error); return; }
  await loadUsers();
  await loadBalances();
}

// ---------- modals ----------

function openAdjustModal(kidId) {
  document.getElementById('adjustModal').dataset.kid = kidId;
  document.getElementById('adjustTitle').textContent = `Adjust ${kidName(kidId)}'s balance`;
  document.getElementById('adjustAmount').value = '';
  document.getElementById('adjustReason').value = '';
  document.getElementById('adjustModal').classList.remove('hidden');
}

function openPickKidModal(choreId) {
  const kids = allUsers.filter(u => u.role === 'kid');
  const sel = document.getElementById('pickKidSelect');
  sel.innerHTML = kids.map(k => `<option value="${k.id}">${k.name}</option>`).join('');
  document.getElementById('pickKidModal').dataset.chore = choreId;
  document.getElementById('pickKidModal').classList.remove('hidden');
}

function openResetModal(userId, role, name) {
  document.getElementById('resetModal').dataset.user = userId;
  document.getElementById('resetTitle').textContent = `Reset login for ${name}`;
  document.getElementById('resetLabel').textContent = role === 'kid' ? '4-digit PIN' : 'Password';
  document.getElementById('resetSecret').value = '';
  document.getElementById('resetModal').classList.remove('hidden');
}

function openChangePasswordModal() {
  document.getElementById('resetModal').dataset.user = me.id;
  document.getElementById('resetTitle').textContent = `Change your password`;
  document.getElementById('resetLabel').textContent = 'New password';
  document.getElementById('resetSecret').value = '';
  document.getElementById('resetModal').classList.remove('hidden');
}

async function openTokenModal() {
  const tokenRes = await fetchWithToken('/api/access-token');
  if (!tokenRes.ok) {
    alert('Access token not available');
    return;
  }
  const { accessToken } = await tokenRes.json();
  const shareUrl = `${window.location.origin}/login.html?access_token=${encodeURIComponent(accessToken)}`;
  document.getElementById('accessTokenValue').value = shareUrl;
  document.getElementById('qrcode').innerHTML = '';
  new QRCode(document.getElementById('qrcode'), {
    text: shareUrl,
    width: 220,
    height: 220,
    colorDark: '#000000',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
  document.getElementById('tokenModal').classList.remove('hidden');
}

function wireUp() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });

  document.getElementById('addChoreBtn').addEventListener('click', async () => {
    const title = document.getElementById('choreTitle').value.trim();
    const valueStr = document.getElementById('choreValue').value;
    const assignedTo = document.getElementById('choreAssign').value || null;
    const repeatable = document.getElementById('choreRepeatable').checked;
    if (!title || !valueStr) { alert('Please enter a title and a value.'); return; }
    const res = await fetchWithToken('/api/chores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, value: toCents(valueStr), assignedTo: assignedTo ? Number(assignedTo) : null, repeatable })
    });
    if (!res.ok) { const { error } = await res.json(); alert(error); return; }
    document.getElementById('choreTitle').value = '';
    document.getElementById('choreValue').value = '';
    document.getElementById('choreRepeatable').checked = false;
    await loadChores();
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetchWithToken('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });

  // adjust modal
  document.getElementById('adjustCancelBtn').addEventListener('click', () => {
    document.getElementById('adjustModal').classList.add('hidden');
  });
  document.getElementById('adjustSubmitBtn').addEventListener('click', async () => {
    const kidId = Number(document.getElementById('adjustModal').dataset.kid);
    const amountStr = document.getElementById('adjustAmount').value;
    const reason = document.getElementById('adjustReason').value.trim();
    if (!amountStr || !reason) { alert('Please enter an amount and a reason.'); return; }
    const res = await fetchWithToken('/api/ledger/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kidId, amount: toCents(amountStr), reason })
    });
    if (!res.ok) { const { error } = await res.json(); alert(error); return; }
    document.getElementById('adjustModal').classList.add('hidden');
    await Promise.all([loadBalances(), loadAudit()]);
  });
  document.getElementById('closeTokenBtn').addEventListener('click', () => {
    document.getElementById('tokenModal').classList.add('hidden');
  });

  // pick kid modal (for unassigned chore completion)
  document.getElementById('pickKidCancelBtn').addEventListener('click', () => {
    document.getElementById('pickKidModal').classList.add('hidden');
  });
  document.getElementById('pickKidSubmitBtn').addEventListener('click', async () => {
    const choreId = Number(document.getElementById('pickKidModal').dataset.chore);
    const kidId = Number(document.getElementById('pickKidSelect').value);
    document.getElementById('pickKidModal').classList.add('hidden');
    await completeChore(choreId, kidId);
  });

  // reset login modal
  document.getElementById('resetCancelBtn').addEventListener('click', () => {
    document.getElementById('resetModal').classList.add('hidden');
  });
  document.getElementById('resetSubmitBtn').addEventListener('click', async () => {
    const userId = Number(document.getElementById('resetModal').dataset.user);
    const secret = document.getElementById('resetSecret').value.trim();
    if (!secret) return;
    const res = await fetchWithToken(`/api/users/${userId}/secret`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret })
    });
    if (!res.ok) { const { error } = await res.json(); alert(error); return; }
    document.getElementById('resetModal').classList.add('hidden');
  });

  // role toggle affects the secret label/placeholder on the add-person form
  document.getElementById('showTokenBtn').addEventListener('click', () => {
    openTokenModal();
  });

  document.getElementById('changePasswordBtn').addEventListener('click', () => {
    openChangePasswordModal();
  });

  document.getElementById('newRole').addEventListener('change', (e) => {
    const isKid = e.target.value === 'kid';
    document.getElementById('newSecretLabel').textContent = isKid ? '4-digit PIN' : 'Password';
    document.getElementById('newSecret').placeholder = isKid ? '1234' : 'choose a password';
  });

  document.getElementById('addPersonBtn').addEventListener('click', async () => {
    const name = document.getElementById('newName').value.trim();
    const role = document.getElementById('newRole').value;
    const secret = document.getElementById('newSecret').value.trim();
    if (!name || !secret) { alert('Please enter a name and a PIN/password.'); return; }
    const res = await fetchWithToken('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, role, secret })
    });
    if (!res.ok) { const { error } = await res.json(); alert(error); return; }
    document.getElementById('newName').value = '';
    document.getElementById('newSecret').value = '';
    await loadUsers();
    await loadBalances();
    await loadChores();
  });

  // audit filters
  document.getElementById('filterBtn').addEventListener('click', () => {
    const params = {};
    const kid = document.getElementById('filterKid').value;
    const from = document.getElementById('filterFrom').value;
    const to = document.getElementById('filterTo').value;
    const reason = document.getElementById('filterReason').value.trim();
    if (kid) params.kidId = kid;
    if (from) params.from = from;
    if (to) params.to = to;
    if (reason) params.reason = reason;
    loadAudit(params);
  });
  document.getElementById('filterClearBtn').addEventListener('click', () => {
    document.getElementById('filterKid').value = '';
    document.getElementById('filterFrom').value = '';
    document.getElementById('filterTo').value = '';
    document.getElementById('filterReason').value = '';
    loadAudit();
  });
}

init();
