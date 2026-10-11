/* Shared, cent-exact money pictures for parent and child pages. */
(function (root) {
  'use strict';
  const denominations = [
    { value: 10000, label: '$100 bill', kind: 'bill' },
    { value: 5000, label: '$50 bill', kind: 'bill' },
    { value: 2000, label: '$20 bill', kind: 'bill' },
    { value: 1000, label: '$10 bill', kind: 'bill' },
    { value: 500, label: '$5 bill', kind: 'bill' },
    { value: 100, label: '$1 bill', kind: 'bill' },
    { value: 25, label: 'Quarter', kind: 'coin' },
    { value: 10, label: 'Dime', kind: 'coin' },
    { value: 5, label: 'Nickel', kind: 'coin' },
    { value: 1, label: 'Penny', kind: 'coin' }
  ];
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = cents => `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
  function breakdown(cents) {
    if (!Number.isSafeInteger(cents)) throw new TypeError('Balance must be a safe integer number of cents');
    let remaining = Math.abs(cents);
    return denominations.flatMap(item => {
      const count = Math.floor(remaining / item.value);
      remaining %= item.value;
      return count ? [{ ...item, count }] : [];
    });
  }
  function picture(item) {
    if (item.kind === 'bill') {
      const dollars = item.value / 100;
      return `<svg class="cash-bill" viewBox="0 0 160 76" aria-hidden="true"><rect x="2" y="2" width="156" height="72" rx="7"/><rect class="bill-border" x="8" y="8" width="144" height="60" rx="4"/><ellipse class="bill-seal" cx="80" cy="38" rx="29" ry="24"/><text x="80" y="46" text-anchor="middle">$${dollars}</text><text class="bill-corner" x="17" y="25">${dollars}</text><text class="bill-corner" x="143" y="61" text-anchor="end">${dollars}</text></svg>`;
    }
    return `<svg class="cash-coin coin-${item.value}" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="37"/><circle class="coin-rim" cx="40" cy="40" r="31"/><text x="40" y="47" text-anchor="middle">${item.value}¢</text></svg>`;
  }
  function cashDiagram(cents) {
    const items = breakdown(cents);
    if (cents === 0) return '<p class="cash-zero">$0.00 — no bills or coins yet.</p>';
    const groups = items.map(item => `<li class="cash-group">
      <div class="cash-pictures">${Array.from({ length: Math.min(item.count, 4) }, () => picture(item)).join('')}</div>
      <div class="cash-denomination">${item.count} × ${item.label}</div>
      <div class="cash-subtotal">${money(item.value * item.count)}</div>
    </li>`).join('');
    return `${cents < 0 ? '<p class="cash-debt">This balance is below zero. These pictures show how much is owed.</p>' : ''}
      <ul class="cash-denominations" aria-label="${cents < 0 ? 'Amount owed' : 'Bills and coins'}: ${money(Math.abs(cents))}">${groups}</ul>
      <p class="cash-total">${cents < 0 ? 'Amount owed' : 'Adds up to'} <strong>${money(Math.abs(cents))}</strong></p>
      ${items.some(item => item.count > 4) ? '<p class="muted cash-note">Pictures show up to four of each kind. Use the count for the full amount.</p>' : ''}`;
  }
  function balanceChart(balances) {
    if (!balances.length) return '<p class="empty">No children yet. Add a child in the People tab to compare balances.</p>';
    const amounts = balances.map(b => b.balance);
    amounts.forEach(breakdown);
    const low = Math.min(0, ...amounts);
    const high = Math.max(0, ...amounts);
    const range = high - low || 1;
    const zero = -low / range * 100;
    return `<p class="muted chart-scale">Shared scale: ${money(low)} to ${money(high)}</p><ul class="balance-bars" aria-label="Current balance by child">${balances.map(b => {
      const width = Math.abs(b.balance) / range * 100;
      const left = b.balance < 0 ? zero - width : zero;
      return `<li class="balance-bar-row"><span class="balance-bar-name">${escape(b.name)}</span><strong class="balance-bar-amount">${money(b.balance)}</strong><div class="balance-bar-track" aria-hidden="true"><span class="balance-bar-zero" style="left:${zero}%"></span><span class="balance-bar-fill ${b.balance < 0 ? 'is-negative' : ''}" style="left:${left}%;width:${width}%"></span></div></li>`;
    }).join('')}</ul>`;
  }
  const api = { breakdown, cashDiagram, balanceChart };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MoneyVisual = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
