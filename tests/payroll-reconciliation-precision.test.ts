import { describe, expect, it } from "vitest";
import { calculateFinalSalary, calculateGrossSalary, reconcilePaySlip } from "@/lib/labor/payroll-reconciliation";
import { subtractMoney, sumMoney } from "@/lib/finance/money";

describe("薪资对账与按分金额运算", () => {
  it("截图口径：调休兑现必须单列解释实发金额", () => {
    const source = {
      attendanceSalary: 8927.5,
      mealAllowance: 405,
      transportAllowance: 0,
      otherAllowance: 0,
      workKPIBonus: 0,
      revenueKPIBonus: 0,
      rewardPenalty: 200,
      compOffCashOutSettlement: { source: "comp_off_event_ledger" as const, eventIds: ["cashout-29630"], amount: 296.3, verifiedAt: "2026-08-01T00:00:00.000Z" },
      socialInsuranceDeduction: 0,
      housingFundDeduction: 0,
      incomeTax: 0,
      advanceAmount: 0,
      pettyLaborPaid: 0,
      grossSalary: 9828.8,
      finalSalary: 9828.8,
    };

    expect(calculateGrossSalary(source)).toBe(9828.8);
    expect(calculateFinalSalary(source)).toBe(9828.8);
    expect(reconcilePaySlip(source).extrasTotal).toBe(901.3);
    expect(reconcilePaySlip(source).storedGrossVariance).toBe(0);
    expect(reconcilePaySlip(source).storedFinalVariance).toBe(0);
  });

  it("检测总额没有随调休兑现或奖惩重算而刷新的陈旧薪资单", () => {
    const reconciliation = reconcilePaySlip({
      attendanceSalary: 8000,
      mealAllowance: 405,
      transportAllowance: 0,
      otherAllowance: 0,
      workKPIBonus: 0,
      revenueKPIBonus: 0,
      rewardPenalty: 200,
      compOffCashOutSettlement: { source: "comp_off_event_ledger" as const, eventIds: ["cashout-29630"], amount: 296.3, verifiedAt: "2026-08-01T00:00:00.000Z" },
      socialInsuranceDeduction: 0,
      housingFundDeduction: 0,
      incomeTax: 0,
      advanceAmount: 0,
      pettyLaborPaid: 0,
      grossSalary: 8605,
      finalSalary: 8605,
    });
    expect(reconciliation.grossSalary).toBe(8901.3);
    expect(reconciliation.storedGrossVariance).toBe(-296.3);
    expect(reconciliation.storedFinalVariance).toBe(-296.3);
  });

  it("多笔小数累加、加减和负数扣款始终按分精确", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(Array.from({ length: 1_000 }, () => 0.01))).toBe(10);
    expect(sumMoney([38.56, -12.25, 1.5])).toBe(27.81);
    expect(subtractMoney(100, [0.1, 0.2, 38.56])).toBe(61.14);
  });
});

import { hasDraftPayrollReconciliationDelta } from "@/lib/labor/payroll-draft-reconciliation";

describe("薪资草稿重算触发器", () => {
  const baseSlip: any = {
    attendanceDays: 21,
    attendanceSalary: 8000,
    mealAllowance: 0,
    transportAllowance: 0,
    otherAllowance: 0,
    workKPIBonus: 0,
    revenueKPIBonus: 0,
    rewardPenalty: 0,
    compOffCashOutSettlement: undefined,
    grossSalary: 8000,
    socialInsuranceDeduction: 0,
    housingFundDeduction: 0,
    incomeTax: 0,
    advanceAmount: 0,
    pettyLaborPaid: 0,
    finalSalary: 8000,
    employerSocialInsurance: 0,
    employerHousingFund: 0,
    totalEmployerCost: 8000,
  };

  it("调休兑现与备用金人工已付任一变化都会触发草稿重算", () => {
    expect(hasDraftPayrollReconciliationDelta(baseSlip, { ...baseSlip, compOffCashOutSettlement: { source: "comp_off_event_ledger", eventIds: ["cashout-29630"], amount: 296.3, verifiedAt: "2026-08-01T00:00:00.000Z" } })).toBe(true);
    expect(hasDraftPayrollReconciliationDelta(baseSlip, { ...baseSlip, pettyLaborPaid: 12.25 })).toBe(true);
  });
});
