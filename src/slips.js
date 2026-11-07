// Builds the full data for a payslip (inputs + calculated values) from stored rows.
const { store } = require('./store');
const Calc = require('../public/calc.js');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return MONTH_NAMES[m - 1] + ' ' + y;
}

async function getMonthConfig(month) {
  const row = await store.getMonthConfigRow(month);
  if (row) return { ...row, saved: true };
  const s = await store.getSettings();
  return {
    month,
    working_days: null,
    late_penalty_days: Number(s.default_late_penalty_days) || 0,
    uninformed_penalty_days: Number(s.default_uninformed_penalty_days) || 0,
    pay_date: null,
    saved: false,
  };
}

function toSlip(row, config) {
  const calc = Calc.compute({ ...row, late_penalty_days: config.late_penalty_days,
    uninformed_penalty_days: config.uninformed_penalty_days });
  return { month: row.month, monthLabel: monthLabel(row.month), pay_date: config.pay_date, emp: row, config, calc };
}

async function getSlip(month, employeeId) {
  const [row] = await store.slipRows({ month, employeeId });
  return row ? toSlip(row, await getMonthConfig(month)) : null;
}

async function getSlipsForMonth(month) {
  const config = await getMonthConfig(month);
  return (await store.slipRows({ month })).map((r) => toSlip(r, config));
}

async function getAllSlips() {
  const configs = {};
  const out = [];
  for (const r of await store.slipRows()) {
    if (!configs[r.month]) configs[r.month] = await getMonthConfig(r.month);
    out.push(toSlip(r, configs[r.month]));
  }
  return out;
}

module.exports = { MONTH_RE, monthLabel, getMonthConfig, getSlip, getSlipsForMonth, getAllSlips };
