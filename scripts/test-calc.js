// Verifies the calculation engine against the real Oct 2026 Zoho payslip (Mansur Namakwala).
const assert = require('assert');
const { compute } = require('../public/calc.js');
const { amountInWords } = require('../src/words.js');

// Oct 2026: basic 22,000, TADA 6,000, 26 working days, 4 inactive, 2 LWP
const r = compute({
  basic: 22000, tada: 6000, working_days: 26, inactive_days: 4, lwp: 2,
  half_days: 0, late_count: 0, uninformed_count: 0, incentive: 0,
  late_penalty_days: 0, uninformed_penalty_days: 0,
});
assert.strictEqual(r.perDayBasic, 846);
assert.strictEqual(r.nonPayable, 5076);
assert.strictEqual(r.tadaDeduction, 1200);
assert.strictEqual(r.gross, 28000);
assert.strictEqual(r.totalDeductions, 6276);
assert.strictEqual(r.net, 21724);
assert.strictEqual(r.paidDays, 20);
assert.strictEqual(r.lopDays, 6);
assert.strictEqual(amountInWords(r.net), 'Indian Rupee Twenty-One Thousand Seven Hundred Twenty-Four Only');

// Half day touches basic only, TADA stays full
const h = compute({ basic: 26000, tada: 3000, working_days: 26, half_days: 2 });
assert.strictEqual(h.nonPayable, 1000);      // 1000 x 1 day
assert.strictEqual(h.tadaDeduction, 0);
assert.strictEqual(h.net, 28000);

// Penalty: 2 lates x 1 day + 1 uninformed x 3 days = 5 days of basic
const p = compute({ basic: 26000, tada: 0, working_days: 26, late_count: 2, uninformed_count: 1,
  late_penalty_days: 1, uninformed_penalty_days: 3 });
assert.strictEqual(p.penalty, 5000);
assert.strictEqual(p.net, 21000);

// Incentive adds to gross
const i = compute({ basic: 20000, tada: 0, working_days: 25, incentive: 3500 });
assert.strictEqual(i.gross, 23500);
assert.strictEqual(i.net, 23500);

// Words, lakh and paise
assert.strictEqual(amountInWords(125000.5), 'Indian Rupee One Lakh Twenty-Five Thousand and Fifty Paise Only');

// Working days missing: no crash, no deduction
const z = compute({ basic: 10000, tada: 0, working_days: 0, lwp: 2 });
assert.strictEqual(z.valid, false);
assert.strictEqual(z.nonPayable, 0);

console.log('All calculation tests passed.');
