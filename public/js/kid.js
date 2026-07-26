let me = null;

function money(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const s = `$${(abs / 100).toFixed(2)}`;
  return negative ? `-${s}` : s;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function accessHeaders() {
  const token = localStorage.getItem('piggyledger_access_token');
  return token ? { 'X-Access-Token': token } : {};
}

async function fetchWithToken(url, options = {}) {
  options.headers = { ...(options.headers || {}), ...accessHeaders() };
  return fetch(url, options);
}

async function init() {
  const meRes = await fetchWithToken('/api/me');
  if (!meRes.ok) { location.href = '/login.html'; return; }
  const { user } = await meRes.json();
  if (user.role !== 'kid') { location.href = '/adult.html'; return; }
  me = user;

  document.getElementById('whoName').textContent = user.name;
  document.getElementById('greeting').textContent = `Hi, ${user.name}!`;

  await Promise.all([loadBalance(), loadChores(), loadLedger()]);
}

async function loadBalance() {
  const res = await fetchWithToken(`/api/balance/${me.id}`);
  const data = await res.json();
  document.getElementById('balanceAmt').textContent = money(data.balance);
}

async function loadChores() {
  const res = await fetchWithToken('/api/chores');
  const chores = await res.json();
  const list = document.getElementById('choreList');

  if (chores.length === 0) {
    list.innerHTML = `<div class="empty"><div class="big">🎉</div>No chores right now — nice!</div>`;
    return;
  }

  const rank = (c) => (c.repeatable ? 1 : (c.status === 'pending' ? 0 : 2));
  const sorted = [...chores].sort((a, b) => rank(a) - rank(b));

  list.innerHTML = sorted.map(c => {
    if (c.repeatable) {
      const lastLine = c.lastCompletedAt ? `Last done ${fmtDate(c.lastCompletedAt)}` : 'Anytime';
      return `
        <div class="ticket">
          <div class="stub">${money(c.value)}</div>
          <div class="body">
            <div>
              <div class="title">${c.title}</div>
              <div class="meta">${lastLine}</div>
            </div>
            <span class="chip repeatable">↻ Reusable</span>
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
            <div class="meta">${c.assignedTo ? 'Assigned to you' : 'Up for grabs'}</div>
          </div>
          <span class="chip ${c.status}">${c.status === 'done' ? 'Done' : 'To do'}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function loadLedger() {
  const res = await fetchWithToken('/api/ledger');
  const entries = await res.json();
  const body = document.getElementById('ledgerBody');
  if (entries.length === 0) {
    body.innerHTML = `<tr><td colspan="3" class="muted">No history yet.</td></tr>`;
    return;
  }
  body.innerHTML = entries.map(e => `
    <tr>
      <td>${fmtDate(e.date)}</td>
      <td>${e.reason}</td>
      <td class="amt ${e.amount >= 0 ? 'pos' : 'neg'}">${e.amount >= 0 ? '+' : ''}${money(e.amount)}</td>
    </tr>
  `).join('');
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetchWithToken('/api/logout', { method: 'POST' });
  location.href = '/login.html';
});

init();
