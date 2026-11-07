const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');

const { store } = require('./store');
const { MONTH_RE, getMonthConfig, getSlip, getSlipsForMonth, getAllSlips } = require('./slips');
const { renderSlips } = require('./pdf');
const { buildWorkbook } = require('./export');

const PORT = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => (sessionMw ? sessionMw(req, res, next) : res.status(503).json({ error: 'Starting up, try again.' })));

// ---- Helpers ----
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
};
const bad = (msg, status) => Object.assign(new Error(msg), { status: status || 400 });

function numField(v, name, { min = 0, max = 1e9 } = {}) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} must be a number between ${min} and ${max}.`);
  return n;
}
function dateField(v, name) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} is not a valid date.`);
  return v;
}
function monthParam(m) {
  if (!MONTH_RE.test(m)) throw bad('Invalid month. Use YYYY-MM.');
  return m;
}

// ---- Auth ----
const attempts = new Map();
app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip;
  const rec = attempts.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - rec.t > 15 * 60 * 1000) { rec.n = 0; rec.t = Date.now(); }
  if (rec.n >= 10) throw bad('Too many attempts. Try again in 15 minutes.', 429);
  const { username, password } = req.body || {};
  const user = await store.userByName(String(username || ''));
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    rec.n++; attempts.set(ip, rec);
    throw bad('Wrong username or password.', 401);
  }
  attempts.delete(ip);
  req.session = { uid: user.id, username: user.username };
  res.json({ username: user.username });
}));
app.post('/api/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  if (req.session && req.session.uid) return res.json({ username: req.session.username });
  res.status(401).json({ error: 'Not logged in' });
});

// Everything below needs a login. Mutating calls also need the custom header (CSRF guard).
app.use('/api', (req, res, next) => {
  if (!req.session || !req.session.uid) return res.status(401).json({ error: 'Not logged in' });
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'fetch') return res.status(403).json({ error: 'Forbidden' });
  next();
});

// ---- Settings ----
app.get('/api/settings', wrap(async (req, res) => res.json(await store.getSettings())));
app.put('/api/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const company_name = String(b.company_name || '').trim();
  if (!company_name) throw bad('Company name is required.');
  const vals = {
    company_name,
    company_address: String(b.company_address || '').trim(),
    default_late_penalty_days: String(numField(b.default_late_penalty_days, 'Late penalty days', { max: 31 })),
    default_uninformed_penalty_days: String(numField(b.default_uninformed_penalty_days, 'Uninformed penalty days', { max: 31 })),
  };
  await store.saveSettings(vals);
  res.json(await store.getSettings());
}));

// ---- Employees ----
function parseEmployee(b) {
  const emp_code = String(b.emp_code || '').trim();
  const name = String(b.name || '').trim();
  if (!emp_code) throw bad('Employee ID is required.');
  if (!name) throw bad('Name is required.');
  const joining_date = dateField(b.joining_date, 'Joining date');
  const leaving_date = dateField(b.leaving_date, 'Leaving date');
  if (joining_date && leaving_date && leaving_date < joining_date) throw bad('Leaving date is before joining date.');
  return {
    emp_code, name,
    designation: String(b.designation || '').trim(),
    department: String(b.department || 'Sales').trim() || 'Sales',
    joining_date, leaving_date,
    basic: numField(b.basic, 'Basic'),
    tada: numField(b.tada, 'TADA'),
    active: b.active === 0 || b.active === false ? 0 : 1,
  };
}
const dupMsg = (e, code) => { if (e.code === 'DUP') throw bad(`Employee ID ${code} already exists.`); throw e; };

app.get('/api/employees', wrap(async (req, res) => res.json(await store.listEmployees())));
app.post('/api/employees', wrap(async (req, res) => {
  const e = parseEmployee(req.body || {});
  try { res.json(await store.insertEmployee(e)); } catch (err) { dupMsg(err, e.emp_code); }
}));
app.put('/api/employees/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!(await store.getEmployee(id))) throw bad('Employee not found.', 404);
  const e = parseEmployee(req.body || {});
  try { res.json(await store.updateEmployee(id, e)); } catch (err) { dupMsg(err, e.emp_code); }
}));
app.delete('/api/employees/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (await store.entryCount(id)) throw bad('This employee has saved months. Mark them inactive instead of deleting.');
  await store.deleteEmployee(id);
  res.json({ ok: true });
}));

// ---- Monthly entries ----
// Typed by Accounts each month. Basic and TADA are NOT here: they come from the Employees tab.
const ENTRY_FIELDS = ['working_days', 'inactive_days', 'present', 'lwp', 'half_days', 'pl', 'reserved',
  'late_count', 'uninformed_count', 'incentive'];
const RATE_FIELDS = ['basic', 'tada'];

app.get('/api/month/:month', wrap(async (req, res) => {
  const month = monthParam(req.params.month);
  const config = await getMonthConfig(month);
  const employees = await store.monthEmployees(month);
  const entries = {};
  for (const e of await store.monthEntries(month)) entries[e.employee_id] = e;
  res.json({
    config,
    rows: employees.map((emp) => ({ employee: emp, entry: entries[emp.id] || null })),
  });
}));

app.put('/api/month/:month', wrap(async (req, res) => {
  const month = monthParam(req.params.month);
  const b = req.body || {};
  const c = b.config || {};
  const cfg = {
    month,
    working_days: c.working_days === '' || c.working_days == null ? null : numField(c.working_days, 'Working days', { max: 31 }),
    late_penalty_days: numField(c.late_penalty_days, 'Late penalty days', { max: 31 }),
    uninformed_penalty_days: numField(c.uninformed_penalty_days, 'Uninformed penalty days', { max: 31 }),
    pay_date: dateField(c.pay_date, 'Pay date'),
  };
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const clean = [];
  for (const r of rows) {
    const emp = await store.getEmployee(Number(r.employee_id));
    if (!emp) throw bad('Unknown employee in the sheet.');
    const v = { employee_id: emp.id, month };
    for (const f of ENTRY_FIELDS) {
      const max = f === 'incentive' ? 1e9 : 31;
      v[f] = numField(r[f], `${emp.name}: ${f.replace(/_/g, ' ')}`, { max });
    }
    if (!(v.working_days > 0)) throw bad(`${emp.name}: working days is required.`);
    // Basic and TADA: a month that is already saved keeps its own copy; a new one copies from the employee.
    const existing = await store.getEntry(emp.id, month);
    if (existing) { v.basic = existing.basic; v.tada = existing.tada; }
    else { v.basic = emp.basic; v.tada = emp.tada; }
    clean.push(v);
  }

  await store.saveMonth(cfg, clean);
  res.json({ saved: clean.length });
}));

// Copy the current Basic and TADA from the Employees tab into every saved row of this month.
app.post('/api/month/:month/refresh-rates', wrap(async (req, res) => {
  const month = monthParam(req.params.month);
  const updated = await store.refreshRates(month);
  res.json({ updated });
}));

app.delete('/api/month/:month/entry/:employeeId', wrap(async (req, res) => {
  const month = monthParam(req.params.month);
  await store.deleteEntry(month, Number(req.params.employeeId));
  res.json({ ok: true });
}));

// ---- PDF payslips ----
app.get('/api/payslip/:month/:employeeId.pdf', wrap(async (req, res) => {
  const month = monthParam(req.params.month);
  const slip = await getSlip(month, Number(req.params.employeeId));
  if (!slip) throw bad('No saved entry for this employee and month. Save the month first.', 404);
  const safe = slip.emp.emp_code.replace(/[^A-Za-z0-9_-]/g, '_');
  renderSlips(res, [slip], `Payslip_${safe}_${month}.pdf`, await store.getSettings());
}));

// ---- Excel export ----
app.get('/api/export.xlsx', async (req, res) => {
  try {
    const m = String(req.query.month || '');
    let slips, name;
    if (m === 'all') { slips = await getAllSlips(); name = 'attendance-all-months'; }
    else { monthParam(m); slips = await getSlipsForMonth(m); name = 'attendance-' + m; }
    const wb = await buildWorkbook(slips, m === 'all' ? 'All months' : m);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Export failed.' });
  }
});

// ---- Frontend ----
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Start ----
// Cookie signing needs the database (secret lives there), so the session middleware is installed
// before the routes by wrapping setup in start(). Routes above are registered first but only
// reached after the middleware below, so we mount a lazy session handler.
let sessionMw;
async function start() {
  await store.init();
  sessionMw = cookieSession({
    name: 'payslip_session',
    keys: [await store.sessionSecret()],
    maxAge: 12 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === 'true',
  });
  // If ADMIN_USERNAME and ADMIN_PASSWORD are set (in .env or on the host), they are applied on every start,
  // so changing them and restarting is all it takes to reset the login.
  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;
  if (envUser && envPass) {
    if (envPass.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
    await store.saveUser(envUser, bcrypt.hashSync(envPass, 10));
    console.log(`Login ready for "${envUser}" (from ADMIN_USERNAME / ADMIN_PASSWORD).`);
  } else if ((await store.userCount()) === 0) {
    const password = crypto.randomBytes(6).toString('hex');
    await store.saveUser('accounts', bcrypt.hashSync(password, 10));
    console.log('\n=== First run: login created ===\nUsername: accounts\nPassword: ' + password + '\n================================\n');
  }
  return app;
}

if (require.main === module) {
  start().then(() => {
    app.listen(PORT, () => console.log(`Payslip app running on http://localhost:${PORT} (${store.kind})`));
  }).catch((err) => { console.error('Failed to start:', err.message); process.exit(1); });
}
module.exports = { app, start };
