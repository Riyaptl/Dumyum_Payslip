// Payslip PDF, laid out like the Zoho payslip Accounts uses today.
const path = require('path');
const PDFDocument = require('pdfkit');
const { amountInWords } = require('./words');

const FONT_R = path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf');
const FONT_B = path.join(__dirname, '..', 'fonts', 'DejaVuSans-Bold.ttf');

const GREY = '#6b6b6b';
const DARK = '#222222';
const LINE = '#b9bccf';
const GREEN = '#2e7d32';
const GREEN_BG = '#e8f8ec';
const PANEL_BG = '#f4f5f8';

const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const days = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function dotted(doc, x1, y, x2, color) {
  doc.save().lineWidth(0.6).strokeColor(color || LINE).dash(1.2, { space: 2.2 })
    .moveTo(x1, y).lineTo(x2, y).stroke().undash().restore();
}

function drawSlip(doc, slip, settings) {
  const { calc, emp, monthLabel } = slip;
  const L = 40;
  const R = 555;
  let y = 42;

  doc.registerFont('R', FONT_R);
  doc.registerFont('B', FONT_B);

  // Header
  doc.font('B').fontSize(16).fillColor(DARK).text(settings.company_name, L, y, { width: 340 });
  const nameH = doc.heightOfString(settings.company_name, { width: 340 });
  doc.font('R').fontSize(8).fillColor(GREY).text(settings.company_address, L, y + nameH + 3, { width: 340 });
  doc.font('R').fontSize(9).fillColor(GREY).text('Payslip For the Month', 380, y + 2, { width: R - 380, align: 'right' });
  doc.font('B').fontSize(13).fillColor(DARK).text(monthLabel, 380, y + 17, { width: R - 380, align: 'right' });

  y = 112;
  doc.save().lineWidth(0.8).strokeColor(LINE).moveTo(L, y).lineTo(R, y).stroke().restore();

  // Employee summary (left)
  y += 18;
  doc.font('B').fontSize(8).fillColor(GREY).text('EMPLOYEE SUMMARY', L, y);
  const rows = [
    ['Employee Name', emp.name],
    ['Employee ID', emp.emp_code],
    ['Pay Period', monthLabel],
    ['Pay Date', fmtDate(slip.pay_date)],
  ];
  let ry = y + 22;
  for (const [k, v] of rows) {
    doc.font('R').fontSize(9).fillColor(GREY).text(k, L, ry, { width: 100 });
    doc.fillColor(DARK).text(': ' + (v || ''), L + 105, ry, { width: 190 });
    ry += 21;
  }

  // Net pay box (right)
  const bx = 325, by = y - 4, bw = R - bx, bh = 132;
  doc.save().roundedRect(bx, by, bw, bh, 7).lineWidth(0.8).strokeColor(LINE).stroke().restore();
  doc.save().roundedRect(bx, by, bw, 70, 7).fill(GREEN_BG).restore();
  doc.save().rect(bx + 1, by + 62, bw - 2, 8).fill(GREEN_BG).restore();
  doc.save().rect(bx + 12, by + 14, 2.5, 42).fill('#66bb6a').restore();
  doc.font('R').fontSize(20).fillColor('#111').text(money(calc.net), bx + 24, by + 14, { width: bw - 30 });
  doc.font('R').fontSize(9).fillColor(GREEN).text('Total Net Pay', bx + 24, by + 42);
  dotted(doc, bx + 12, by + 70, bx + bw - 12);
  doc.font('R').fontSize(9).fillColor(GREY).text('Paid Days', bx + 16, by + 84);
  doc.fillColor(DARK).text(': ' + days(calc.paidDays), bx + 100, by + 84);
  doc.fillColor(GREY).text('LOP Days', bx + 16, by + 106);
  doc.fillColor(DARK).text(': ' + days(calc.lopDays), bx + 100, by + 106);

  // Second block
  y = 286;
  dotted(doc, L, y - 14, R);
  const info = [
    [['Designation', emp.designation], ['Department', emp.department]],
    [['Paid Leaves', days(emp.pl)], ['Total Working Days', days(emp.working_days)]],
    [['Leave Without Pay', days(emp.lwp)], ['Inactive days', days(emp.inactive_days)]],
  ];
  let iy = y;
  for (const [a, b] of info) {
    doc.font('R').fontSize(9.5).fillColor(GREY).text(a[0], L + 4, iy, { width: 110 });
    doc.fillColor(DARK).text(': ' + (a[1] || ''), L + 118, iy, { width: 170 });
    doc.fillColor(GREY).text(b[0], 325, iy, { width: 120 });
    doc.fillColor(DARK).text(': ' + (b[1] || ''), 450, iy, { width: R - 450 });
    iy += 24;
  }

  // Earnings and deductions
  const ty = 380;
  const earnings = [['Basic', calc.basic], ['TADA', calc.tada]];
  if (calc.incentive > 0) earnings.push(['Incentive', calc.incentive]);
  if (calc.reimbursement > 0) earnings.push(['Reimbursement', calc.reimbursement]);
  const deductions = [['Non-Payable Days Deduction', calc.nonPayable], ['TADA Deduction', calc.tadaDeduction]];
  if (calc.penalty > 0) deductions.push(['Late / Uninformed Penalty', calc.penalty]);
  const n = Math.max(earnings.length, deductions.length);
  const th = 38 + n * 22 + 34;

  doc.save().roundedRect(L, ty, R - L, th, 7).lineWidth(0.8).strokeColor(LINE).stroke().restore();
  const midX = 286;
  doc.font('B').fontSize(8.5).fillColor(DARK);
  doc.text('EARNINGS', L + 14, ty + 14);
  doc.text('AMOUNT', midX - 98, ty + 14, { width: 84, align: 'right' });
  doc.text('DEDUCTIONS', midX + 14, ty + 14);
  doc.text('AMOUNT', R - 98, ty + 14, { width: 84, align: 'right' });
  dotted(doc, L + 14, ty + 30, midX - 14);
  dotted(doc, midX + 14, ty + 30, R - 14);

  let cy = ty + 40;
  for (let i = 0; i < n; i++) {
    doc.font('R').fontSize(9).fillColor(DARK);
    if (earnings[i]) {
      doc.text(earnings[i][0], L + 14, cy);
      doc.text(money(earnings[i][1]), midX - 98, cy, { width: 84, align: 'right' });
    }
    if (deductions[i]) {
      doc.text(deductions[i][0], midX + 14, cy, { width: 150, lineBreak: false });
      doc.text(money(deductions[i][1]), R - 98, cy, { width: 84, align: 'right' });
    }
    cy += 22;
  }

  const fy = ty + th - 34;
  doc.save().rect(L + 1, fy, R - L - 2, 33).fill(PANEL_BG).restore();
  doc.font('B').fontSize(9).fillColor(DARK);
  doc.text('Gross Earnings', L + 14, fy + 12);
  doc.text(money(calc.gross), midX - 98, fy + 12, { width: 84, align: 'right' });
  doc.text('Total Deductions', midX + 14, fy + 12);
  doc.text(money(calc.totalDeductions), R - 98, fy + 12, { width: 84, align: 'right' });

  // Net payable
  const ny = ty + th + 22;
  doc.save().roundedRect(L, ny, R - L, 48, 7).lineWidth(0.8).strokeColor(LINE).stroke().restore();
  doc.save().rect(R - 150, ny + 1, 149, 46).fill(GREEN_BG).restore();
  doc.font('B').fontSize(10).fillColor('#111').text('TOTAL NET PAYABLE', L + 14, ny + 12);
  doc.font('R').fontSize(8).fillColor(GREY).text('Gross Earnings - Total Deductions', L + 14, ny + 28);
  doc.font('B').fontSize(11).fillColor('#111').text(money(calc.net), R - 150, ny + 17, { width: 136, align: 'right' });

  const label = 'Amount In Words : ';
  const words = amountInWords(calc.net);
  doc.font('R').fontSize(8.5);
  const wl = doc.widthOfString(label);
  const ww = doc.widthOfString(words);
  const wx = R - wl - ww;
  doc.fillColor(GREY).text(label, wx, ny + 66, { lineBreak: false });
  doc.fillColor(DARK).text(words, wx + wl, ny + 66, { lineBreak: false });
  doc.save().lineWidth(0.8).strokeColor(LINE).moveTo(L, ny + 92).lineTo(R, ny + 92).stroke().restore();

    // Incentive details: only when an incentive is paid
  let footY = ny + 118;
  if (calc.incentive > 0) {
    const sy = ny + 108;
    doc.save().roundedRect(L, sy, R - L, 58, 7).lineWidth(0.8).strokeColor(LINE).stroke().restore();
    doc.font('B').fontSize(8.5).fillColor(DARK).text('INCENTIVE DETAILS', L + 14, sy + 10);
    const colW = (R - L - 28) / 5;
    const pct = (v) => String(Math.round((Number(v) || 0) * 100) / 100) + ' %';
    const items = [
      ['Sales Target', money(Number(slip.emp.sales_target) || 0)],
      ['Sales Achieved', money(Number(slip.emp.sales_achieved) || 0)],
      ['Target Achieved', pct(slip.emp.target_achieved)],
      ['Incentive % Applied', pct(slip.emp.incentive_pct)],
      ['Incentive', money(calc.incentive)],
    ];
    items.forEach(([lab, val], i) => {
      const x = L + 14 + i * colW;
      doc.font('R').fontSize(8).fillColor(GREY).text(lab, x, sy + 26, { width: colW - 8, lineBreak: false });
      doc.font('B').fontSize(10).fillColor(DARK).text(val, x, sy + 38, { width: colW - 8, lineBreak: false });
    });
    footY = sy + 58 + 26;
  }
  doc.font('R').fontSize(7.5).fillColor(GREY)
    .text('-- This is a system-generated document. --', L, footY, { width: R - L, align: 'center' });

}

function renderSlips(res, slips, filename, settings) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: filename } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  slips.forEach((s, i) => {
    if (i > 0) doc.addPage();
    drawSlip(doc, s, settings);
  });
  doc.end();
}

module.exports = { renderSlips };
