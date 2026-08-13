import {
  calcAllowance,
  calcRevenueKPIBonus,
  type Employee,
  type PaySlip,
  shouldPayAllowanceThisMonth,
} from "./types";
import { getAllowanceSettlementBucket, isDailyAllowanceRule } from "./allowance-rule-semantics";

export type PayrollExtrasControls = Pick<
  PaySlip,
  "allowanceOverrides" | "allowanceDetails" | "workKPISelections" | "revenueActuals"
>;

export interface PayrollExtrasSettlement {
  mealAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  allowanceTotal: number;
  allowanceDetails: NonNullable<PaySlip["allowanceDetails"]>;
  workKPIBonus: number;
  workKPIDetails: Record<string, { tierId?: string; amount: number }>;
  revenueKPIBonus: number;
  revenueKPIDetails: Record<string, { actual: number; amount: number }>;
  performanceTotal: number;
}

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * 月度绩效与补贴唯一结算入口。
 *
 * 所有薪资草稿、绩效编辑预览、绩效只读页和薪资统计卡都必须使用这一个函数，
 * 禁止在页面层分别重算或回退到已废弃的聚合字段。
 */
export function settlePayrollExtras(
  employee: Employee,
  month: string,
  attendanceDays: number,
  controls: PayrollExtrasControls = {},
): PayrollExtrasSettlement {
  const safeAttendanceDays = Number.isFinite(attendanceDays) && attendanceDays > 0
    ? attendanceDays
    : 0;
  const allowanceOverrides = controls.allowanceOverrides ?? {};
  const priorDetails = controls.allowanceDetails ?? {};
  const allowanceDetails: NonNullable<PaySlip["allowanceDetails"]> = {};
  let mealAllowance = 0;
  let transportAllowance = 0;
  let otherAllowance = 0;

  for (const rule of employee.allowanceRules ?? []) {
    if (!rule.enabled || !shouldPayAllowanceThisMonth(rule, month)) continue;
    if (rule.id in allowanceOverrides && !allowanceOverrides[rule.id]) continue;

    const isDaily = isDailyAllowanceRule(rule);
    const previous = priorDetails[rule.id];
    // 按天补贴绝不允许手动金额残留；固定补贴才允许明确的人工覆盖。
    const isOverride = !isDaily && previous?.isOverride === true;
    const calculated = calcAllowance(rule, safeAttendanceDays);
    const amount = isOverride ? (previous.amount ?? calculated.amount) : calculated.amount;

    allowanceDetails[rule.id] = {
      amount: roundMoney(amount),
      autoNote: calculated.autoNote,
      isOverride,
      calcBasis: isDaily
        ? { formula: "rate_x_days", rate: rule.amount, days: safeAttendanceDays, calculatedAt: Date.now() }
        : isOverride
          ? { formula: "override", calculatedAt: Date.now() }
          : { formula: "fixed", calculatedAt: Date.now() },
    };

    const bucket = getAllowanceSettlementBucket(rule);
    if (bucket === "transport") transportAllowance += amount;
    else if (bucket === "meal") mealAllowance += amount;
    else otherAllowance += amount;
  }

  let workKPIBonus = 0;
  const workKPIDetails: PayrollExtrasSettlement["workKPIDetails"] = {};
  for (const rule of employee.workKPIRules ?? []) {
    if (!rule.enabled) continue;
    const tierId = controls.workKPISelections?.[rule.id];
    const tier = rule.tiers.find((item) => item.id === tierId);
    const amount = tier?.amount ?? 0;
    workKPIDetails[rule.id] = { tierId, amount };
    workKPIBonus += amount;
  }

  let revenueKPIBonus = 0;
  const revenueKPIDetails: PayrollExtrasSettlement["revenueKPIDetails"] = {};
  for (const rule of employee.revenueKPIRules ?? []) {
    if (!rule.enabled) continue;
    const actual = controls.revenueActuals?.[rule.id] ?? 0;
    const amount = calcRevenueKPIBonus(rule, actual);
    revenueKPIDetails[rule.id] = { actual, amount };
    revenueKPIBonus += amount;
  }

  mealAllowance = roundMoney(mealAllowance);
  transportAllowance = roundMoney(transportAllowance);
  otherAllowance = roundMoney(otherAllowance);
  workKPIBonus = roundMoney(workKPIBonus);
  revenueKPIBonus = roundMoney(revenueKPIBonus);

  return {
    mealAllowance,
    transportAllowance,
    otherAllowance,
    allowanceTotal: roundMoney(mealAllowance + transportAllowance + otherAllowance),
    allowanceDetails,
    workKPIBonus,
    workKPIDetails,
    revenueKPIBonus,
    revenueKPIDetails,
    performanceTotal: roundMoney(workKPIBonus + revenueKPIBonus),
  };
}

/** 将薪资卡“综合额外”与应发公式保持为同一口径。 */
export function getPayrollExtrasGrandTotal(
  settlement: Pick<PayrollExtrasSettlement, "allowanceTotal" | "performanceTotal">,
  rewardPenalty: number = 0,
): number {
  return roundMoney(settlement.allowanceTotal + settlement.performanceTotal + rewardPenalty);
}
