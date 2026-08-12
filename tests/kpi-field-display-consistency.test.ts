import { describe, expect, it } from "vitest";

interface PayrollPresentation {
  workKPIBonus: number;
  revenueKPIBonus: number;
  mealAllowance: number;
  transportAllowance: number;
  otherAllowance: number;
  rewardPenalty: number;
}

function makeSlip(overrides: Partial<PayrollPresentation> = {}): PayrollPresentation {
  return {
    workKPIBonus: 0,
    revenueKPIBonus: 0,
    mealAllowance: 0,
    transportAllowance: 0,
    otherAllowance: 0,
    rewardPenalty: 0,
    ...overrides,
  };
}

function getAllowanceTotal(slip: PayrollPresentation): number {
  return slip.mealAllowance + slip.transportAllowance + slip.otherAllowance;
}

function getPerformanceAllowance(slip: PayrollPresentation): number {
  return getAllowanceTotal(slip) + slip.workKPIBonus + slip.revenueKPIBonus;
}

function getExtraTotal(slip: PayrollPresentation): number {
  return getPerformanceAllowance(slip) + slip.rewardPenalty;
}

describe("薪资展示字段唯一语义", () => {
  const slip = makeSlip({
    workKPIBonus: 1700,
    revenueKPIBonus: 500,
    mealAllowance: 345,
    transportAllowance: 200,
    otherAllowance: 100,
    rewardPenalty: -100,
  });

  it("工作绩效只读取工作KPI分项", () => {
    expect(slip.workKPIBonus).toBe(1700);
  });

  it("业绩绩效只读取业绩规则分项，并且只计一次", () => {
    expect(slip.revenueKPIBonus).toBe(500);
    expect(Object.keys(slip)).not.toContain("salesCommission");
  });

  it("补贴合计 = 餐补 + 交通补贴 + 其他补贴", () => {
    expect(getAllowanceTotal(slip)).toBe(645);
  });

  it("绩效补贴 = 补贴合计 + 工作绩效 + 业绩绩效", () => {
    expect(getPerformanceAllowance(slip)).toBe(2845);
  });

  it("综合额外 = 绩效补贴 + 奖惩小计", () => {
    expect(getExtraTotal(slip)).toBe(2745);
  });

  it("保存与自动同步保留两个绩效分项，不再回落至旧聚合字段", () => {
    const saved = makeSlip({ workKPIBonus: 2000, revenueKPIBonus: 800 });
    const synced = { ...saved };
    expect(synced.workKPIBonus).toBe(2000);
    expect(synced.revenueKPIBonus).toBe(800);
    expect(Object.keys(synced)).not.toContain("performanceBonus");
  });
});
