let me = null;
let requestKind = null;
let requestAmount = 0;
let needsAmountHelp = false;

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

function updateRequestAmount() {
  const total = document.getElementById('requestTotal');
  total.textContent = needsAmountHelp ? '?' : money(requestAmount);
  document.getElementById('sendMoneyRequestBtn').disabled = requestAmount === 0 && !needsAmountHelp;
  document.getElementById('requestMessage').textContent = needsAmountHelp
    ? 'Your parent will help choose the amount.'
    : requestAmount > 0 ? 'Tap another number to add more.' : '';
}

function openMoneyRequest(kind) {
  requestKind = kind;
  requestAmount = 0;
  needsAmountHelp = false;
  document.getElementById('moneyRequestTitle').textContent = kind === 'deposit'
    ? 'How much goes in?'
    : 'How much comes out?';
  document.getElementById('sendMoneyRequestBtn').textContent = 'Ask my parent';
  document.getElementById('moneyRequestModal').classList.remove('hidden');
  updateRequestAmount();
}

async function sendMoneyRequest() {
  const button = document.getElementById('sendMoneyRequestBtn');
  button.disabled = true;
  button.textContent = 'Sending...';
  const res = await fetchWithToken('/api/money-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: requestKind, amount: needsAmountHelp ? null : requestAmount })
  });
  const result = await res.json();
  if (!res.ok) {
    document.getElementById('requestMessage').textContent = result.error || 'Please try again.';
    button.textContent = 'Ask my parent';
    button.disabled = false;
    return;
  }

  document.getElementById('requestTotal').textContent = 'Sent!';
  document.getElementById('requestMessage').textContent = 'Your parent can check it now.';
  button.textContent = 'Done';
  await loadLedger();
  setTimeout(() => document.getElementById('moneyRequestModal').classList.add('hidden'), 900);
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
  localStorage.removeItem('piggyledger_access_token');
  location.href = '/login.html';
});

document.querySelectorAll('[data-money-kind]').forEach(button => {
  button.addEventListener('click', () => openMoneyRequest(button.dataset.moneyKind));
});

document.querySelectorAll('[data-add-amount]').forEach(button => {
  button.addEventListener('click', () => {
    needsAmountHelp = false;
    requestAmount += Number(button.dataset.addAmount);
    updateRequestAmount();
  });
});

document.getElementById('amountHelpBtn').addEventListener('click', () => {
  requestAmount = 0;
  needsAmountHelp = true;
  updateRequestAmount();
});

document.getElementById('amountClearBtn').addEventListener('click', () => {
  requestAmount = 0;
  needsAmountHelp = false;
  updateRequestAmount();
});

document.getElementById('cancelMoneyRequestBtn').addEventListener('click', () => {
  document.getElementById('moneyRequestModal').classList.add('hidden');
});

document.getElementById('sendMoneyRequestBtn').addEventListener('click', sendMoneyRequest);

init();
