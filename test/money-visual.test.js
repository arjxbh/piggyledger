'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { breakdown, cashDiagram, balanceChart } = require('../public/js/money-visual');

test('bills and coins add up exactly for every cent through $200', () => {
  for (let cents = 0; cents <= 20000; cents++) {
    assert.equal(breakdown(cents).reduce((total, item) => total + item.value * item.count, 0), cents);
  }
  assert.deepEqual(breakdown(4187).map(item => [item.value, item.count]), [[2000, 2], [100, 1], [25, 3], [10, 1], [1, 2]]);
});

test('zero and negative balances describe what the pictures mean', () => {
  assert.equal(breakdown(0).length, 0);
  assert.match(cashDiagram(0), /no bills or coins/);
  assert.match(cashDiagram(-1234), /Amount owed.*\$12\.34/s);
  assert.equal(breakdown(-1234).reduce((sum, item) => sum + item.count * item.value, 0), 1234);
});

test('large balances keep bounded pictures and accurate denomination counts', () => {
  const diagram = cashDiagram(100000000);
  assert.equal((diagram.match(/<svg/g) || []).length, 4);
  assert.match(diagram, /10000 × \$100 bill/);
  assert.match(diagram, /\$1000000\.00/);
  for (const invalid of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => breakdown(invalid), TypeError);
  }
});

test('bar chart uses one shared scale, escapes names, and handles negative and empty balances', () => {
  const chart = balanceChart([{ name: '<Sam>', balance: 1000 }, { name: 'Jo', balance: -1000 }]);
  assert.match(chart, /&lt;Sam&gt;/);
  assert.match(chart, /left:50%;width:50%/);
  assert.match(chart, /left:0%;width:50%/);
  assert.match(balanceChart([{ name: 'Zero', balance: 0 }]), /width:0%/);
  assert.doesNotMatch(chart, /NaN|Infinity/);
  assert.match(balanceChart([]), /No children yet/);
});
