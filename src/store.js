require('./env');
// Data access. Two interchangeable backends with the same methods:
//  - SQLite file (default, for your PC or a server)
//  - MongoDB, used when MONGODB_URI is set (for free hosting on Render with a free MongoDB Atlas cluster)
const crypto = require('crypto');

const TYPED_COLS = ['working_days', 'inactive_days', 'present', 'lwp', 'half_days', 'pl', 'reserved',
  'late_count', 'uninformed_count', 'incentive', 'sales_target', 'sales_achieved', 'target_achieved', 'incentive_pct'];
const ENTRY_COLS = TYPED_COLS.concat(['basic', 'tada']);
const EMP_COLS = ['emp_code', 'name', 'designation', 'department', 'joining_date', 'leaving_date', 'basic', 'tada', 'active'];
const dupError = (what) => Object.assign(new Error(`${what} already exists`), { code: 'DUP' });

const DEFAULTS = {
  company_name: 'Dumyum Chocolates Pvt Ltd',
  company_address: 'D-203, Sampad Prime, Sargasan Cross Road, Sargasan, Gandhinagar - 382421\nAhmedabad, 382421 India',
  default_late_penalty_days: '0',
  default_uninformed_penalty_days: '0',
};

// =====================================================================================
// SQLite
// =====================================================================================
function sqliteStore() {
  const { db, init } = require('./db');
  const isDup = (e) => /UNIQUE/i.test(String(e.message));
  const SLIP_SQL = `
    SELECT e.*, emp.emp_code, emp.name, emp.designation, emp.department, emp.joining_date, emp.leaving_date
    FROM monthly_entries e JOIN employees emp ON emp.id = e.employee_id`;
  return {
    kind: 'sqlite',
    init,
    close: async () => db.close(),

    async userByName(name) { return db.get('SELECT * FROM users WHERE username = ?', [name]); },
    async userCount() { return Number((await db.get('SELECT COUNT(*) AS c FROM users')).c); },
    async saveUser(name, hash) {
      await db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)
        ON CONFLICT (username) DO UPDATE SET password_hash = excluded.password_hash`, [name, hash]);
    },

    async getSettings() {
      const out = {};
      for (const r of await db.all('SELECT key, value FROM settings')) if (!r.key.startsWith('_')) out[r.key] = r.value;
      return out;
    },
    async saveSettings(vals) {
      await db.tx(async (t) => {
        for (const [k, v] of Object.entries(vals)) {
          await t.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [k, v]);
        }
      });
    },
    async sessionSecret() {
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
        ['_session_secret', crypto.randomBytes(32).toString('hex')]);
      return (await db.get('SELECT value FROM settings WHERE key = ?', ['_session_secret'])).value;
    },

    async listEmployees() { return db.all('SELECT * FROM employees ORDER BY emp_code'); },
    async getEmployee(id) { return (await db.get('SELECT * FROM employees WHERE id = ?', [id])) || null; },
    async insertEmployee(e) {
      try {
        const r = await db.get(`INSERT INTO employees (${EMP_COLS.join(', ')}) VALUES (${EMP_COLS.map(() => '?').join(', ')}) RETURNING id`,
          EMP_COLS.map((c) => e[c]));
        return this.getEmployee(r.id);
      } catch (err) { throw isDup(err) ? dupError(e.emp_code) : err; }
    },
    async updateEmployee(id, e) {
      try {
        await db.run(`UPDATE employees SET ${EMP_COLS.map((c) => c + '=?').join(', ')} WHERE id=?`, [...EMP_COLS.map((c) => e[c]), id]);
        return this.getEmployee(id);
      } catch (err) { throw isDup(err) ? dupError(e.emp_code) : err; }
    },
    async deleteEmployee(id) { await db.run('DELETE FROM employees WHERE id = ?', [id]); },
    async entryCount(id) { return Number((await db.get('SELECT COUNT(*) AS c FROM monthly_entries WHERE employee_id = ?', [id])).c); },
    async seedEmployees(list) {
      let added = 0;
      await db.tx(async (t) => {
        for (const e of list) {
          const r = await t.run(`INSERT INTO employees (${EMP_COLS.join(', ')}) VALUES (${EMP_COLS.map(() => '?').join(', ')})
            ON CONFLICT (emp_code) DO NOTHING`, EMP_COLS.map((c) => e[c]));
          added += r.changes;
        }
      });
      return added;
    },

    async getMonthConfigRow(month) { return (await db.get('SELECT * FROM month_config WHERE month = ?', [month])) || null; },
    async monthEmployees(month) {
      return db.all(`SELECT * FROM employees WHERE active = 1
        OR id IN (SELECT employee_id FROM monthly_entries WHERE month = ?) ORDER BY emp_code`, [month]);
    },
    async monthEntries(month) { return db.all('SELECT * FROM monthly_entries WHERE month = ?', [month]); },
    async getEntry(empId, month) {
      return (await db.get('SELECT * FROM monthly_entries WHERE employee_id = ? AND month = ?', [empId, month])) || null;
    },
    async saveMonth(cfg, rows) {
      await db.tx(async (t) => {
        await t.run(`INSERT INTO month_config (month, working_days, late_penalty_days, uninformed_penalty_days, pay_date)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (month) DO UPDATE SET working_days=excluded.working_days, late_penalty_days=excluded.late_penalty_days,
            uninformed_penalty_days=excluded.uninformed_penalty_days, pay_date=excluded.pay_date`,
          [cfg.month, cfg.working_days, cfg.late_penalty_days, cfg.uninformed_penalty_days, cfg.pay_date]);
        const sql = `INSERT INTO monthly_entries (employee_id, month, ${ENTRY_COLS.join(', ')}, updated_at)
          VALUES (?, ?, ${ENTRY_COLS.map(() => '?').join(', ')}, ?)
          ON CONFLICT (employee_id, month) DO UPDATE SET ${TYPED_COLS.map((f) => `${f}=excluded.${f}`).join(', ')},
            updated_at = excluded.updated_at`;
        for (const v of rows) await t.run(sql, [v.employee_id, v.month, ...ENTRY_COLS.map((f) => v[f]), new Date().toISOString()]);
      });
    },
    async refreshRates(month) {
      const r = await db.run(`UPDATE monthly_entries SET
          basic = (SELECT basic FROM employees WHERE employees.id = monthly_entries.employee_id),
          tada = (SELECT tada FROM employees WHERE employees.id = monthly_entries.employee_id),
          updated_at = ? WHERE month = ?`, [new Date().toISOString(), month]);
      return r.changes;
    },
    async deleteEntry(month, empId) { await db.run('DELETE FROM monthly_entries WHERE month = ? AND employee_id = ?', [month, empId]); },

    // Joined rows (entry + employee details) for one month, one employee in a month, or everything
    async slipRows({ month, employeeId } = {}) {
      if (month && employeeId != null) {
        const r = await db.get(SLIP_SQL + ' WHERE e.month = ? AND e.employee_id = ?', [month, employeeId]);
        return r ? [r] : [];
      }
      if (month) return db.all(SLIP_SQL + ' WHERE e.month = ? ORDER BY emp.emp_code', [month]);
      return db.all(SLIP_SQL + ' ORDER BY e.month, emp.emp_code');
    },
  };
}

// =====================================================================================
// MongoDB (Atlas free cluster)
// =====================================================================================
function mongoStore() {
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000, maxPoolSize: 5 });
  let d; // database handle
  const strip = (doc) => { if (!doc) return null; const { _id, ...rest } = doc; return rest; };
  const isDup = (e) => e && e.code === 11000;
  const nextId = async (name) => {
    const r = await d.collection('counters').findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' });
    return (r && r.value ? r.value : r).seq;
  };
  const num = (v) => (v === null || v === undefined ? v : Number(v));

  return {
    kind: 'mongodb',
    async init() {
      await client.connect();
      d = client.db(process.env.MONGODB_DB || undefined); // database name comes from the URI unless overridden
      await d.collection('users').createIndex({ username: 1 }, { unique: true });
      await d.collection('employees').createIndex({ emp_code: 1 }, { unique: true });
      await d.collection('employees').createIndex({ id: 1 }, { unique: true });
      await d.collection('entries').createIndex({ employee_id: 1, month: 1 }, { unique: true });
      await d.collection('entries').createIndex({ month: 1 });
      for (const [k, v] of Object.entries(DEFAULTS)) {
        await d.collection('settings').updateOne({ _id: k }, { $setOnInsert: { value: v } }, { upsert: true });
      }
    },
    close: async () => client.close(),

    async userByName(name) { return strip(await d.collection('users').findOne({ username: name })) ; },
    async userCount() { return d.collection('users').countDocuments({}); },
    async saveUser(name, hash) {
      const existing = await d.collection('users').findOne({ username: name });
      if (existing) await d.collection('users').updateOne({ username: name }, { $set: { password_hash: hash } });
      else await d.collection('users').insertOne({ id: await nextId('users'), username: name, password_hash: hash });
    },

    async getSettings() {
      const out = {};
      for (const r of await d.collection('settings').find({}).toArray()) if (!String(r._id).startsWith('_')) out[r._id] = r.value;
      return out;
    },
    async saveSettings(vals) {
      for (const [k, v] of Object.entries(vals)) await d.collection('settings').updateOne({ _id: k }, { $set: { value: v } }, { upsert: true });
    },
    async sessionSecret() {
      await d.collection('settings').updateOne({ _id: '_session_secret' },
        { $setOnInsert: { value: crypto.randomBytes(32).toString('hex') } }, { upsert: true });
      return (await d.collection('settings').findOne({ _id: '_session_secret' })).value;
    },

    async listEmployees() { return (await d.collection('employees').find({}).sort({ emp_code: 1 }).toArray()).map(strip); },
    async getEmployee(id) { return strip(await d.collection('employees').findOne({ id })); },
    async insertEmployee(e) {
      try {
        const doc = { id: await nextId('employees'), ...Object.fromEntries(EMP_COLS.map((c) => [c, e[c]])) };
        await d.collection('employees').insertOne(doc);
        return strip(doc);
      } catch (err) { throw isDup(err) ? dupError(e.emp_code) : err; }
    },
    async updateEmployee(id, e) {
      try {
        await d.collection('employees').updateOne({ id }, { $set: Object.fromEntries(EMP_COLS.map((c) => [c, e[c]])) });
        return this.getEmployee(id);
      } catch (err) { throw isDup(err) ? dupError(e.emp_code) : err; }
    },
    async deleteEmployee(id) { await d.collection('employees').deleteOne({ id }); },
    async entryCount(id) { return d.collection('entries').countDocuments({ employee_id: id }); },
    async seedEmployees(list) {
      let added = 0;
      for (const e of list) {
        if (await d.collection('employees').findOne({ emp_code: e.emp_code })) continue;
        await this.insertEmployee(e);
        added++;
      }
      return added;
    },

    async getMonthConfigRow(month) {
      const r = await d.collection('month_config').findOne({ _id: month });
      return r ? { month, working_days: r.working_days, late_penalty_days: r.late_penalty_days,
        uninformed_penalty_days: r.uninformed_penalty_days, pay_date: r.pay_date } : null;
    },
    async monthEmployees(month) {
      const ids = (await d.collection('entries').find({ month }).toArray()).map((x) => x.employee_id);
      const all = await this.listEmployees();
      return all.filter((e) => e.active === 1 || ids.includes(e.id));
    },
    async monthEntries(month) { return (await d.collection('entries').find({ month }).toArray()).map(strip); },
    async getEntry(empId, month) { return strip(await d.collection('entries').findOne({ employee_id: empId, month })); },
    async saveMonth(cfg, rows) {
      await d.collection('month_config').updateOne({ _id: cfg.month }, { $set: {
        working_days: cfg.working_days, late_penalty_days: cfg.late_penalty_days,
        uninformed_penalty_days: cfg.uninformed_penalty_days, pay_date: cfg.pay_date } }, { upsert: true });
      const now = new Date().toISOString();
      for (const v of rows) {
        const typed = Object.fromEntries(TYPED_COLS.map((f) => [f, v[f]]));
        await d.collection('entries').updateOne({ employee_id: v.employee_id, month: v.month },
          { $set: { ...typed, updated_at: now },
            $setOnInsert: { employee_id: v.employee_id, month: v.month, basic: v.basic, tada: v.tada } }, { upsert: true });
      }
    },
    async refreshRates(month) {
      const emps = new Map((await this.listEmployees()).map((e) => [e.id, e]));
      const entries = await d.collection('entries').find({ month }).toArray();
      let n = 0;
      for (const en of entries) {
        const emp = emps.get(en.employee_id);
        if (!emp) continue;
        await d.collection('entries').updateOne({ _id: en._id }, { $set: { basic: emp.basic, tada: emp.tada, updated_at: new Date().toISOString() } });
        n++;
      }
      return n;
    },
    async deleteEntry(month, empId) { await d.collection('entries').deleteOne({ month, employee_id: empId }); },

    async slipRows({ month, employeeId } = {}) {
      const q = {};
      if (month) q.month = month;
      if (employeeId != null) q.employee_id = employeeId;
      const entries = (await d.collection('entries').find(q).toArray()).map(strip);
      const emps = new Map((await this.listEmployees()).map((e) => [e.id, e]));
      const rows = [];
      for (const en of entries) {
        const emp = emps.get(en.employee_id);
        if (!emp) continue;
        rows.push({ ...en, emp_code: emp.emp_code, name: emp.name, designation: emp.designation, department: emp.department,
          joining_date: emp.joining_date, leaving_date: emp.leaving_date });
      }
      rows.sort((a, b) => (a.month === b.month ? (a.emp_code < b.emp_code ? -1 : 1) : (a.month < b.month ? -1 : 1)));
      return rows;
    },
  };
}

const store = process.env.MONGODB_URI ? mongoStore() : sqliteStore();
module.exports = { store, num: Number };
