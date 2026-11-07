const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'Month', key: 'month', width: 11 },
  { header: 'Emp ID', key: 'emp_code', width: 11 },
  { header: 'Name', key: 'name', width: 24 },
  { header: 'Designation', key: 'designation', width: 20 },
  { header: 'Department', key: 'department', width: 14 },
  { header: 'Joining Date', key: 'joining_date', width: 13 },
  { header: 'Leaving Date', key: 'leaving_date', width: 13 },
  { header: 'Working Days', key: 'working_days', width: 9, num: '0.##' },
  { header: 'Inactive Days', key: 'inactive_days', width: 9, num: '0.##' },
  { header: 'Present', key: 'present', width: 9, num: '0.##' },
  { header: 'LWP', key: 'lwp', width: 8, num: '0.##' },
  { header: 'Half Days', key: 'half_days', width: 9, num: '0.##' },
  { header: 'PL', key: 'pl', width: 8, num: '0.##' },
  { header: 'Reserved', key: 'reserved', width: 9, num: '0.##' },
  { header: 'Late', key: 'late_count', width: 8, num: '0.##' },
  { header: 'Uninformed', key: 'uninformed_count', width: 11, num: '0.##' },
  { header: 'Basic', key: 'basic', width: 12, num: '#,##0.00' },
  { header: 'TADA', key: 'tada', width: 12, num: '#,##0.00' },
  { header: 'Incentive', key: 'incentive', width: 12, num: '#,##0.00' },
  { header: 'Per Day Basic', key: 'perDayBasic', width: 12, num: '#,##0.00' },
  { header: 'Non-Payable Days Deduction', key: 'nonPayable', width: 15, num: '#,##0.00' },
  { header: 'TADA Deduction', key: 'tadaDeduction', width: 13, num: '#,##0.00' },
  { header: 'Late/Uninformed Penalty', key: 'penalty', width: 14, num: '#,##0.00' },
  { header: 'Gross Earnings', key: 'gross', width: 14, num: '#,##0.00' },
  { header: 'Total Deductions', key: 'totalDeductions', width: 14, num: '#,##0.00' },
  { header: 'Net Pay', key: 'net', width: 14, num: '#,##0.00' },
];

async function buildWorkbook(slips, title) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(title.slice(0, 31), { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  for (const s of slips) {
    const e = s.emp;
    ws.addRow({
      month: s.month, emp_code: e.emp_code, name: e.name, designation: e.designation,
      department: e.department, joining_date: e.joining_date || '', leaving_date: e.leaving_date || '',
      working_days: e.working_days, inactive_days: e.inactive_days, present: e.present, lwp: e.lwp,
      half_days: e.half_days, pl: e.pl, reserved: e.reserved, late_count: e.late_count,
      uninformed_count: e.uninformed_count, basic: s.calc.basic, tada: s.calc.tada,
      incentive: s.calc.incentive, perDayBasic: s.calc.perDayBasic, nonPayable: s.calc.nonPayable,
      tadaDeduction: s.calc.tadaDeduction, penalty: s.calc.penalty, gross: s.calc.gross,
      totalDeductions: s.calc.totalDeductions, net: s.calc.net,
    });
  }

  COLUMNS.forEach((c, i) => {
    if (c.num) ws.getColumn(i + 1).numFmt = c.num;
  });
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 32;
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B3F5C' } };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  ws.getColumn('net').font = { bold: true };
  return wb;
}

module.exports = { buildWorkbook };
