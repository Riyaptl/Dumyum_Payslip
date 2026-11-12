// Database layer.
//  - Default: SQLite file (Node's built-in node:sqlite, Node 22.13+), stored in DATA_DIR. Best for your PC or a VPS.
// SQLite is used when MONGODB_URI is not set. See store.js for the MongoDB version.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function makeSqlite() {
  // Hide the one-time "SQLite is an experimental feature" notice.
  const origEmit = process.emit;
  process.emit = function (name, data, ...rest) {
    if (name === 'warning' && data && data.name === 'ExperimentalWarning' && /SQLite/i.test(data.message || '')) return false;
    return origEmit.call(this, name, data, ...rest);
  };
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const raw = new DatabaseSync(path.join(DATA_DIR, 'payroll.db'));
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');

  const api = {
    dialect: 'sqlite',
    async get(sql, p = []) { return raw.prepare(sql).get(...p); },
    async all(sql, p = []) { return raw.prepare(sql).all(...p); },
    async run(sql, p = []) { const r = raw.prepare(sql).run(...p); return { changes: Number(r.changes) }; },
    close() { raw.close(); },
  };
  // One transaction at a time (BEGIN ... COMMIT, ROLLBACK on error)
  let chain = Promise.resolve();
  api.tx = (fn) => {
    const next = chain.then(async () => {
      raw.exec('BEGIN');
      try {
        const result = await fn(api);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        try { raw.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
        throw err;
      }
    });
    chain = next.catch(() => {});
    return next;
  };
  return api;
}

const db = makeSqlite();

const ID = 'INTEGER PRIMARY KEY AUTOINCREMENT';
const NUM = 'REAL';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id ${ID},
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS employees (
    id ${ID},
    emp_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    designation TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT 'Sales',
    joining_date TEXT,
    leaving_date TEXT,
    basic ${NUM} NOT NULL DEFAULT 0,
    tada ${NUM} NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  // Month level values: default working days, penalty rules and pay date
  `CREATE TABLE IF NOT EXISTS month_config (
    month TEXT PRIMARY KEY,
    working_days ${NUM},
    late_penalty_days ${NUM} NOT NULL DEFAULT 0,
    uninformed_penalty_days ${NUM} NOT NULL DEFAULT 0,
    pay_date TEXT
  )`,
  // One row per employee per month. basic and tada are copied in when the month is first saved,
  // so editing an employee later never changes an old payslip.
  `CREATE TABLE IF NOT EXISTS monthly_entries (
    id ${ID},
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    month TEXT NOT NULL,
    working_days ${NUM} NOT NULL,
    inactive_days ${NUM} NOT NULL DEFAULT 0,
    present ${NUM} NOT NULL DEFAULT 0,
    lwp ${NUM} NOT NULL DEFAULT 0,
    half_days ${NUM} NOT NULL DEFAULT 0,
    pl ${NUM} NOT NULL DEFAULT 0,
    reserved ${NUM} NOT NULL DEFAULT 0,
    late_count ${NUM} NOT NULL DEFAULT 0,
    uninformed_count ${NUM} NOT NULL DEFAULT 0,
    incentive ${NUM} NOT NULL DEFAULT 0,
    sales_target ${NUM} NOT NULL DEFAULT 0,
    target_achieved ${NUM} NOT NULL DEFAULT 0,
    sales_achieved ${NUM} NOT NULL DEFAULT 0,
    incentive_pct ${NUM} NOT NULL DEFAULT 0,
    basic ${NUM} NOT NULL,
    tada ${NUM} NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (employee_id, month)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_entries_month ON monthly_entries(month)',
];

const DEFAULT_SETTINGS = {
  company_name: 'Dumyum Chocolates Pvt Ltd',
  company_address: 'D-203, Sampad Prime, Sargasan Cross Road, Sargasan, Gandhinagar - 382421\nAhmedabad, 382421 India',
  default_late_penalty_days: '0',
  default_uninformed_penalty_days: '0',
};

async function init() {
  for (const sql of SCHEMA) await db.run(sql);
  const have = (await db.all('PRAGMA table_info(monthly_entries)')).map((c) => c.name);
  for (const col of ['sales_target', 'target_achieved', 'sales_achieved', 'incentive_pct']) {
    if (!have.includes(col)) await db.run(`ALTER TABLE monthly_entries ADD COLUMN ${col} REAL NOT NULL DEFAULT 0`);
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
}

module.exports = { db, init, DEFAULT_SETTINGS, DATA_DIR };
