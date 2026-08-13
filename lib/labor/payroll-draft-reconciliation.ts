import type { Employee, GlobalPayrollSettings, PaySlip } from "./types";

const MONEY_FIELDS: Array<keyof PaySlip> = [
  "attendanceDays", "attendanceSalary",
  "mealAllowance", "transportAllowance", "otherAllowance",
  "workKPIBonus", "revenueKPIBonus", "rewardPenalty",
  "grossSalary", "socialInsuranceDeduction", "housingFundDeduction", "incomeTax",
  "finalSalary", "employerSocialInsurance", "employerHousingFund", "totalEmployerCost",
];

/**
 * 草稿薪资重建的年度累计税输入唯一入口。
 * 只读取同一员工、同一自然年、当前月之前的薪资单，禁止跨员工或跨月污染。
 */
export function getDraftPayrollCumulativeTaxInputs(
  employee: Employee,
  month: string,
  paySlips: PaySlip[],
  globalSettings?: GlobalPayrollSettings,
): { cumulativeIncome: number; cumulativeTaxPaid: number } {
  const taxConfig = employee.incomeTax ?? globalSettings?.defaultIncomeTax;
  const yearPrefix = `${month.slice(0, 4)}-`;
  const previousSlips = paySlips.filter((slip) =>
    slip.employeeId === employee.id && slip.month.startsWith(yearPrefix) && slip.month < month,
  );
  const cumulativeIncome = previousSlips.reduce((sum, slip) => sum + Math.max(0,
    slip.grossSalary - (slip.socialInsuranceDeduction ?? 0) - (slip.housingFundDeduction ?? 0)
      - (taxConfig?.threshold ?? 5000) - (taxConfig?.specialDeductions ?? 0),
  ), 0);
  const cumulativeTaxPaid = previousSlips.reduce((sum, slip) => sum + (slip.incomeTax ?? 0), 0);
  return { cumulativeIncome, cumulativeTaxPaid };
}

/**
 * 只比较由草稿结算引擎拥有的数值字段。allowanceDetails的calculatedAt不是业务差异，
 * 不得据此触发无限写回。
 */
export function hasDraftPayrollReconciliationDelta(current: PaySlip, next: PaySlip): boolean {
  return MONEY_FIELDS.some((field) =>
    Math.abs(Number(current[field] ?? 0) - Number(next[field] ?? 0)) >= 0.005,
  );
}
