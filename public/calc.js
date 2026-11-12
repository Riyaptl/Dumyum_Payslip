/*
 * Salary calculation rules. Single source of truth, used by the server
 * (payslip PDF, Excel export) and by the browser (live preview in the grid).
 *
 * Rules (confirmed by Accounts):
 *  - Per-day basic  = Basic / working days, rounded to nearest rupee (half up)
 *  - Per-day TADA   = TADA / 30 (fixed), rounded to nearest rupee (half up)
 *  - Basic deduction = per-day basic x (inactive + LWP + 0.5 x half days)
 *  - TADA deduction  = per-day TADA  x (inactive + LWP)   (half days do not touch TADA)
 *  - Penalty         = per-day basic x (late x late_days + uninformed x uninformed_days)
 *  - Gross = Basic + TADA + Incentive ; Net = Gross - all deductions
 *  - PL and Reserved are stored only, they do not change the calculation
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  function round(n, dp) {
    const f = Math.pow(10, dp || 0);
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  function compute(e) {
    const basic = num(e.basic);
    const tada = num(e.tada);
    const workingDays = num(e.working_days);
    const inactive = num(e.inactive_days);
    const lwp = num(e.lwp);
    const half = num(e.half_days);
    const late = num(e.late_count);
    const unin = num(e.uninformed_count);
    const incentive = num(e.incentive);
    const reimbursement = num(e.reimbursement);
    const latePen = num(e.late_penalty_days);
    const uninPen = num(e.uninformed_penalty_days);

    const valid = workingDays > 0;
    const perDayBasic = valid ? round(basic / workingDays, 0) : 0;
    const perDayTada = round(tada / 30, 0);

    const lopDays = inactive + lwp + 0.5 * half;
    const tadaLopDays = inactive + lwp;
    const penaltyDays = late * latePen + unin * uninPen;

    const nonPayable = round(perDayBasic * lopDays, 2);
    const tadaDeduction = round(perDayTada * tadaLopDays, 2);
    const penalty = round(perDayBasic * penaltyDays, 2);

    const gross = round(basic + tada + incentive + reimbursement, 2);
    const totalDeductions = round(nonPayable + tadaDeduction + penalty, 2);
    const net = round(gross - totalDeductions, 2);

    return {
      valid,
      perDayBasic,
      perDayTada,
      lopDays,
      tadaLopDays,
      paidDays: valid ? workingDays - lopDays : 0,
      penaltyDays,
      basic: round(basic, 2),
      tada: round(tada, 2),
      incentive: round(incentive, 2),
      reimbursement: round(reimbursement, 2),
      nonPayable,
      tadaDeduction,
      penalty,
      gross,
      totalDeductions,
      net,
    };
  }

  return { compute, round, num };
});
