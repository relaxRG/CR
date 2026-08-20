import type { Employee, GlobalPayrollSettings, PaySlip } from "./types";
import { subtractMoney, sumMoney } from "@/lib/finance/money";
import { getCompOffCashOutSettlementAmount } from "./comp-off-cashout-settlement";

const MONEY_FIELDS: Array<keyof PaySlip> = [
  "attendanceDays", "attendanceSalary",
  "mealAllowance", "transportAllowance", "otherAllowance",
  "workKPIBonus", "revenueKPIBonus", "rewardPenalty",
  "grossSalary", "socialInsuranceDeduction", "housingFundDeduction", "incomeTax",
  "pettyLaborPaid",
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
  const cumulativeIncome = sumMoney(previousSlips.map((slip) => Math.max(0, subtractMoney(slip.grossSalary, [
    slip.socialInsuranceDeduction,
    slip.housingFundDeduction,
    taxConfig?.threshold ?? 5000,
    taxConfig?.specialDeductions ?? 0,
  ]))));
  const cumulativeTaxPaid = sumMoney(previousSlips.map((slip) => slip.incomeTax));
  return { cumulativeIncome, cumulativeTaxPaid };
}

/**
 * 只比较由草稿结算引擎拥有的数值字段。allowanceDetails的calculatedAt不是业务差异，
 * 不得据此触发无限写回。
 */
export function hasDraftPayrollReconciliationDelta(current: PaySlip, next: PaySlip): boolean {
  const moneyChanged = MONEY_FIELDS.some((field) =>
    Math.abs(subtractMoney(current[field] as number | undefined, [next[field] as number | undefined])) >= 0.01,
  );
  if (moneyChanged) return true;
  const currentSnapshot = current.compOffCashOutSettlement;
  const nextSnapshot = next.compOffCashOutSettlement;
  const idsChanged = (currentSnapshot?.eventIds ?? []).join("|") !== (nextSnapshot?.eventIds ?? []).join("|");
  return idsChanged || Math.abs(subtractMoney(getCompOffCashOutSettlementAmount(current), [getCompOffCashOutSettlementAmount(next)])) >= 0.01;
}
