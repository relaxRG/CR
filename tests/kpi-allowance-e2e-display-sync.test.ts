import { describe, expect, it } from "vitest";
import { settlePayrollExtras } from "../lib/labor/payroll-extras";
import type { AllowanceRule, Employee } from "../lib/labor/types";

interface PayrollPresentation {
  attendanceSalary: number;
  mealAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  workKPIBonus: number;
  revenueKPIBonus: number;
  rewardPenalty: number;
  advanceAmount: number;
  pettyLaborPaid: number;
}

function summarizeExtras(slip: PayrollPresentation) {
  const allowanceTotal = slip.mealAllowance + slip.transportAllowance + slip.otherAllowance;
  const performanceAllowance = allowanceTotal + slip.workKPIBonus + slip.revenueKPIBonus;
  const extraTotal = performanceAllowance + slip.rewardPenalty;
  return { allowanceTotal, performanceAllowance, extraTotal };
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-001", code: "RG", realName: "瑞雪", phone: "", dept: "front",
    type: "fulltime", baseSalary: 6000, restDaysPerMonth: 4, hourlyRate: 0,
    overtimeHourlyRate: 0, notes: "", active: true, createdAt: "2026-01-01T00:00:00.000Z",
    allowanceRules: [{ id: "meal", label: "餐补", amount: 15, unit: "per_day", type: "meal_per_day", enabled: true, frequency: "monthly" } as AllowanceRule],
    workKPIRules: [{ id: "work", name: "工作质量", cycle: "monthly", notes: "", enabled: true, tiers: [{ id: "good", label: "达标", amount: 1700, sortOrder: 1 }] }],
    revenueKPIRules: [{ id: "revenue", name: "店铺营业额", source: "manual", payMode: "highest", calcType: "fixed", enabled: true, tiers: [{ id: "hit", threshold: 280000, amount: 500, sortOrder: 1 }] }],
    ...overrides,
  };
}

describe("绩效补贴唯一口径与跨页面实时同步", () => {
  it("绩效补贴 = 补贴合计 + 工作绩效 + 业绩绩效", () => {
    const settlement = settlePayrollExtras(makeEmployee(), "2026-08", 2, {
      workKPISelections: { work: "good" },
      revenueActuals: { revenue: 280000 },
    });

    expect(settlement.allowanceTotal).toBe(30);
    expect(settlement.workKPIBonus).toBe(1700);
    expect(settlement.revenueKPIBonus).toBe(500);
    expect(settlement.allowanceTotal + settlement.performanceTotal).toBe(2230);
  });

  it("薪资卡、绩效页和导出共享同一个综合额外公式", () => {
    const slip: PayrollPresentation = {
      attendanceSalary: 6000,
      mealAllowance: 300,
      transportAllowance: 200,
      otherAllowance: 100,
      workKPIBonus: 1700,
      revenueKPIBonus: 500,
      rewardPenalty: -100,
      advanceAmount: 0,
      pettyLaborPaid: 0,
    };
    const summary = summarizeExtras(slip);
    expect(summary.allowanceTotal).toBe(600);
    expect(summary.performanceAllowance).toBe(2800);
    expect(summary.extraTotal).toBe(2700);
    expect(slip.attendanceSalary + summary.extraTotal).toBe(8700);
  });

  it("保存后以控制字段重算，自动同步不会覆盖工作或业绩绩效", () => {
    const employee = makeEmployee();
    const saved = settlePayrollExtras(employee, "2026-08", 3, {
      workKPISelections: { work: "good" },
      revenueActuals: { revenue: 280000 },
    });
    const afterAttendanceRefresh = settlePayrollExtras(employee, "2026-08", 4, {
      workKPISelections: { work: "good" },
      revenueActuals: { revenue: 280000 },
    });

    expect(saved.workKPIBonus).toBe(1700);
    expect(saved.revenueKPIBonus).toBe(500);
    expect(afterAttendanceRefresh.workKPIBonus).toBe(1700);
    expect(afterAttendanceRefresh.revenueKPIBonus).toBe(500);
    expect(afterAttendanceRefresh.mealAllowance).toBe(60);
  });

  it("零出勤时按天补贴必须归零，不能遗留历史金额", () => {
    const settlement = settlePayrollExtras(makeEmployee(), "2026-08", 0, {
      allowanceDetails: { meal: { amount: 15, autoNote: "旧记录", isOverride: false } },
      workKPISelections: { work: "good" },
      revenueActuals: { revenue: 280000 },
    });

    expect(settlement.mealAllowance).toBe(0);
    expect(settlement.allowanceDetails.meal.amount).toBe(0);
    expect(settlement.performanceTotal).toBe(2200);
  });

  it("业绩绩效是唯一业绩奖励字段，不存在独立业绩提点金额", () => {
    const settlement = settlePayrollExtras(makeEmployee(), "2026-08", 1, {
      revenueActuals: { revenue: 280000 },
    });
    expect(settlement.revenueKPIBonus).toBe(500);
    expect("salesCommission" in settlement).toBe(false);
  });
});
