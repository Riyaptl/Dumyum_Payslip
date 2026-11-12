(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) el.append(kid);
    return el;
  }
  const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 2500);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Please log in again.'); }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  // ---------- login / shell ----------
  function showLogin() {
    $('app').hidden = true;
    $('login-screen').hidden = false;
  }
  async function showApp(username) {
    $('login-screen').hidden = true;
    $('app').hidden = false;
    $('who').textContent = username;
    const s = await api('GET', '/api/settings');
    $('brand-name').textContent = s.company_name;
    await loadMonth();
  }

  $('login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('login-error').textContent = '';
    const f = new FormData(ev.target);
    try {
      const r = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
      ev.target.reset();
      await showApp(r.username);
    } catch (err) { $('login-error').textContent = err.message; }
  });
  $('logout').addEventListener('click', async () => {
    await api('POST', '/api/logout', {}).catch(() => {});
    showLogin();
  });

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.tab !== 'month' && !confirmLeaveMonth()) return;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    for (const t of ['month', 'employees', 'settings']) $('tab-' + t).hidden = t !== b.dataset.tab;
    if (b.dataset.tab === 'employees') loadEmployees();
    if (b.dataset.tab === 'settings') loadSettings();
    if (b.dataset.tab === 'month') loadMonth();
  }));

  // ---------- monthly entry ----------
  const FIELDS = [
    ['basic', 'Basic', 'money'], ['tada', 'TADA', 'money'],
    ['working_days', 'Working days'], ['inactive_days', 'Inactive'], ['present', 'Present'],
    ['lwp', 'LWP'], ['half_days', 'Half'], ['pl', 'PL'], ['reserved', 'Reserved'],
    ['late_count', 'Late'], ['uninformed_count', 'Uninformed'], ['incentive', 'Incentive', 'money'],
    ['sales_target', 'Sales Target', 'money'], ['sales_achieved', 'Sales Achieved', 'money'],
    ['target_achieved', 'Target Achieved %'], ['incentive_pct', 'Incentive % Applied'],
  ];
  let state = { month: '', config: null, rows: [] };

  function defaultMonth() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1); // payroll is usually done for the previous month
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  const anyDirty = () => state.rows.some((r) => r.dirty) || configDirty;
  let configDirty = false;
  function confirmLeaveMonth() {
    return !anyDirty() || confirm('You have unsaved changes on this month. Leave without saving?');
  }

  function monthConfigFromInputs() {
    return {
      working_days: $('m-wd').value,
      late_penalty_days: $('m-late').value,
      uninformed_penalty_days: $('m-unin').value,
      pay_date: $('m-paydate').value,
    };
  }

  async function loadMonth(month) {
    state.month = month || state.month || defaultMonth();
    $('m-month').value = state.month;
    const data = await api('GET', '/api/month/' + state.month);
    state.config = data.config;
    $('m-wd').value = data.config.working_days ?? '';
    $('m-late').value = data.config.late_penalty_days;
    $('m-unin').value = data.config.uninformed_penalty_days;
    $('m-paydate').value = data.config.pay_date || '';
    configDirty = false;
    state.rows = data.rows.map(({ employee, entry }) => {
      const vals = {};
      for (const [k] of FIELDS) vals[k] = entry ? (entry[k] ?? '') : '';
      if (!entry) {
        vals.basic = employee.basic;
        vals.tada = employee.tada;
        vals.working_days = data.config.working_days ?? '';
      }
      // A saved month keeps its own Basic/TADA; flag it if the Employees tab has changed since
      const stale = !!entry && (Number(entry.basic) !== Number(employee.basic) || Number(entry.tada) !== Number(employee.tada));
      return { employee, saved: !!entry, dirty: false, stale, vals };
    });
    $('m-status').textContent = data.config.saved ? '' : 'New month, nothing saved yet.';
    renderGrid();
  }

  function rowCalc(row) {
    const c = monthConfigFromInputs();
    return Calc.compute({ ...row.vals, late_penalty_days: c.late_penalty_days, uninformed_penalty_days: c.uninformed_penalty_days });
  }

  function updateNet(row, tr) {
    const calc = rowCalc(row);
    const cell = tr.querySelector('.net');
    cell.textContent = calc.valid ? money(calc.net) : 'Enter working days';
    cell.classList.toggle('neg', calc.valid && calc.net < 0);
    cell.title = calc.valid
      ? `Gross ${money(calc.gross)}\nNon-payable days ${money(calc.nonPayable)}\nTADA deduction ${money(calc.tadaDeduction)}\nPenalty ${money(calc.penalty)}\nPaid days ${calc.paidDays}`
      : '';
    tr.classList.toggle('dirty', row.dirty);
    tr.classList.toggle('missing', row.dirty && !calc.valid);
  }

  function renderGrid() {
    const grid = $('grid');
    grid.replaceChildren();
    const head = h('tr', {},
      h('th', { class: 'sticky', text: 'Employee' }),
      ...FIELDS.map(([, label]) => h('th', { class: 'num', text: label })),
      h('th', { class: 'num', text: 'Net pay' }),
      h('th', { text: 'Status' }),
      h('th', { text: '' }));
    grid.append(h('thead', {}, head));
    const body = h('tbody');
    if (!state.rows.length) {
      body.append(h('tr', {}, h('td', { colspan: FIELDS.length + 4, class: 'muted', text: 'No employees yet. Add them in the Employees tab.' })));
    }
    state.rows.forEach((row, idx) => {
      const e = row.employee;
      const sub = [e.designation, e.joining_date ? 'Joined ' + fmtDate(e.joining_date) : '', e.leaving_date ? 'Left ' + fmtDate(e.leaving_date) : '']
        .filter(Boolean).join(' | ');
      const tr = h('tr', {});
      tr.append(h('td', { class: 'sticky name' }, h('strong', { text: e.name + ' (' + e.emp_code + ')' }), h('small', { text: sub })));
      FIELDS.forEach(([key, label, cls]) => {
        if (key === 'basic' || key === 'tada') {
          const td = h('td', { class: 'rate' + (row.stale ? ' stale' : '') }, money(row.vals[key]));
          if (row.stale) {
            td.append(h('small', { text: 'now ' + money(e[key]) }));
            td.title = 'The Employees tab has changed. Use "Refresh rates from Employees" to update this month.';
          }
          tr.append(td);
          return;
        }
        const input = h('input', { type: 'number', min: '0', step: ['basic', 'tada', 'incentive', 'sales_target', 'sales_achieved', 'target_achieved', 'incentive_pct'].includes(key) ? '0.01' : '0.5', 'aria-label': label + ' for ' + e.name, 'data-col': key, class: cls || '' });
        input.value = row.vals[key];
        input.addEventListener('input', () => { row.vals[key] = input.value; row.dirty = true; updateNet(row, tr); updateStatus(row, tr); });
        input.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          const next = body.children[idx + (ev.shiftKey ? -1 : 1)];
          const target = next && next.querySelector(`input[data-col="${key}"]`);
          if (target) { target.focus(); target.select(); }
        });
        tr.append(h('td', { class: 'num' }, input));
      });
      tr.append(h('td', { class: 'num net' }));
      tr.append(h('td', {}, h('span', { class: 'badge' })));
      const pdfBtn = h('button', { class: 'btn small', type: 'button', text: 'PDF', onclick: () => {
        if (!row.saved || row.dirty) { toast('Save the month first, then download the payslip.', true); return; }
        window.open(`/api/payslip/${state.month}/${e.id}.pdf`, '_blank');
      } });
      const clearBtn = h('button', { class: 'btn small danger', type: 'button', text: 'Remove', title: 'Delete the saved entry for this month', onclick: async () => {
        if (!row.saved) return;
        if (!confirm(`Remove ${e.name}'s saved entry for ${state.month}?`)) return;
        try { await api('DELETE', `/api/month/${state.month}/entry/${e.id}`); toast('Entry removed.'); await loadMonth(); } catch (err) { toast(err.message, true); }
      } });
      tr.append(h('td', {}, pdfBtn, ' ', row.saved ? clearBtn : ''));
      body.append(tr);
      updateNet(row, tr);
      updateStatus(row, tr);
    });
    grid.append(body);
  }

  function updateStatus(row, tr) {
    const b = tr.querySelector('.badge');
    if (!row.employee.active && !row.saved) { b.textContent = 'Inactive'; b.className = 'badge off'; return; }
    if (row.dirty) { b.textContent = 'Unsaved'; b.className = 'badge'; }
    else if (row.saved) { b.textContent = 'Saved'; b.className = 'badge saved'; }
    else { b.textContent = 'Empty'; b.className = 'badge'; }
  }

  function recalcAllRows() {
    const trs = $('grid').querySelectorAll('tbody tr');
    state.rows.forEach((row, i) => trs[i] && updateNet(row, trs[i]));
  }

  ['m-late', 'm-unin', 'm-paydate', 'm-wd'].forEach((id) => $(id).addEventListener('input', () => { configDirty = true; recalcAllRows(); }));

  $('m-month').addEventListener('change', async (ev) => {
    const v = ev.target.value;
    if (!v) return;
    if (!confirmLeaveMonth()) { ev.target.value = state.month; return; }
    try { await loadMonth(v); } catch (err) { toast(err.message, true); }
  });

  $('m-apply').addEventListener('click', () => {
    const wd = $('m-wd').value;
    if (!(Number(wd) > 0)) { toast('Type the working days for the month first.', true); return; }
    state.rows.forEach((r) => { r.vals.working_days = wd; r.dirty = true; });
    renderGrid();
  });

  $('m-save').addEventListener('click', async () => {
    const toSave = state.rows.filter((r) => r.saved || r.dirty);
    if (!toSave.length) { toast('Nothing to save.'); return; }
    const missing = toSave.find((r) => !(Number(r.vals.working_days) > 0));
    if (missing) { toast(`${missing.employee.name}: working days is required.`, true); return; }
    const payload = {
      config: monthConfigFromInputs(),
      rows: toSave.map((r) => {
        const { basic, tada, ...typed } = r.vals; // Basic and TADA are never sent from this screen
        return { employee_id: r.employee.id, ...typed };
      }),
    };
    try {
      const r = await api('PUT', '/api/month/' + state.month, payload);
      toast(`Saved ${r.saved} employee${r.saved === 1 ? '' : 's'} for ${state.month}.`);
      await loadMonth();
    } catch (err) { toast(err.message, true); }
  });

  $('m-refresh').addEventListener('click', async () => {
    if (anyDirty()) { toast('Save the month first, then refresh rates.', true); return; }
    if (!state.rows.some((r) => r.saved)) { toast('Nothing saved in this month yet.'); return; }
    if (!confirm(`Update Basic and TADA for every saved employee in ${state.month} from the Employees tab? Their payslips for this month will change.`)) return;
    try {
      const r = await api('POST', `/api/month/${state.month}/refresh-rates`, {});
      toast(`Updated ${r.updated} employee${r.updated === 1 ? '' : 's'}.`);
      await loadMonth();
    } catch (err) { toast(err.message, true); }
  });
  $('m-xlsx').addEventListener('click', () => { window.location.href = `/api/export.xlsx?month=${state.month}`; });
  $('m-xlsx-all').addEventListener('click', () => { window.location.href = '/api/export.xlsx?month=all'; });

  window.addEventListener('beforeunload', (ev) => { if (!$('app').hidden && anyDirty()) { ev.preventDefault(); ev.returnValue = ''; } });

  // ---------- employees ----------
  let employees = [];
  async function loadEmployees() {
    employees = await api('GET', '/api/employees');
    renderEmployees();
  }
  function renderEmployees() {
    const t = $('emp-table');
    t.replaceChildren();
    t.append(h('thead', {}, h('tr', {},
      ...['Emp ID', 'Name', 'Designation', 'Department', 'Joined', 'Left'].map((x) => h('th', { text: x })),
      h('th', { class: 'num', text: 'Basic' }), h('th', { class: 'num', text: 'TADA' }), h('th', { text: 'Status' }), h('th', { text: '' }))));
    const showInactive = $('e-show-inactive').checked;
    const body = h('tbody');
    const list = employees.filter((e) => e.active || showInactive);
    if (!list.length) body.append(h('tr', {}, h('td', { colspan: 10, class: 'muted', text: 'No employees to show.' })));
    for (const e of list) {
      body.append(h('tr', {},
        h('td', { text: e.emp_code }), h('td', { text: e.name }), h('td', { text: e.designation }), h('td', { text: e.department }),
        h('td', { text: fmtDate(e.joining_date) }), h('td', { text: fmtDate(e.leaving_date) }),
        h('td', { class: 'num', text: money(e.basic) }), h('td', { class: 'num', text: money(e.tada) }),
        h('td', {}, h('span', { class: 'badge ' + (e.active ? 'saved' : 'off'), text: e.active ? 'Active' : 'Inactive' })),
        h('td', {}, h('button', { class: 'btn small', text: 'Edit', onclick: () => openEmp(e) }))));
    }
    t.append(body);
  }
  $('e-show-inactive').addEventListener('change', renderEmployees);
  $('e-add').addEventListener('click', () => openEmp(null));

  let editingId = null;
  function openEmp(e) {
    editingId = e ? e.id : null;
    const f = $('emp-form');
    f.reset();
    $('emp-error').textContent = '';
    $('emp-dialog-title').textContent = e ? 'Edit employee' : 'Add employee';
    $('emp-delete').hidden = !e;
    if (e) {
      for (const k of ['emp_code', 'name', 'designation', 'department', 'joining_date', 'leaving_date', 'basic', 'tada']) f.elements[k].value = e[k] ?? '';
      f.elements.active.checked = !!e.active;
    }
    $('emp-dialog').showModal();
  }
  $('emp-cancel').addEventListener('click', () => $('emp-dialog').close());
  $('emp-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target.elements;
    const body = {};
    for (const k of ['emp_code', 'name', 'designation', 'department', 'joining_date', 'leaving_date', 'basic', 'tada']) body[k] = f[k].value;
    body.active = f.active.checked ? 1 : 0;
    try {
      if (editingId) await api('PUT', '/api/employees/' + editingId, body);
      else await api('POST', '/api/employees', body);
      $('emp-dialog').close();
      toast('Employee saved.');
      await loadEmployees();
    } catch (err) { $('emp-error').textContent = err.message; }
  });
  $('emp-delete').addEventListener('click', async () => {
    if (!confirm('Delete this employee permanently?')) return;
    try {
      await api('DELETE', '/api/employees/' + editingId);
      $('emp-dialog').close();
      toast('Employee deleted.');
      await loadEmployees();
    } catch (err) { $('emp-error').textContent = err.message; }
  });

  // ---------- settings ----------
  async function loadSettings() {
    const s = await api('GET', '/api/settings');
    const f = $('settings-form').elements;
    for (const k of ['company_name', 'company_address', 'default_late_penalty_days', 'default_uninformed_penalty_days']) f[k].value = s[k] ?? '';
  }
  $('settings-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target.elements;
    const body = {};
    for (const k of ['company_name', 'company_address', 'default_late_penalty_days', 'default_uninformed_penalty_days']) body[k] = f[k].value;
    try {
      const s = await api('PUT', '/api/settings', body);
      $('brand-name').textContent = s.company_name;
      toast('Settings saved.');
    } catch (err) { toast(err.message, true); }
  });

  // ---------- start ----------
  (async function init() {
    try {
      const me = await api('GET', '/api/me');
      await showApp(me.username);
    } catch (_) { showLogin(); }
  })();
})();
