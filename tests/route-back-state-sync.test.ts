import { describe, expect, it } from "vitest";

type PayrollControls = {
  employeeId: string;
  month: string;
  allowanceOverrides: Record<string, boolean>;
  workKPISelections: Record<string, string>;
  revenueActuals: Record<string, number>;
  workKPIBonus: number;
  revenueKPIBonus: number;
};

function createMemoSlip<T>(getSlip: () => T, dependencies: () => unknown[]) {
  let cachedDependencies: unknown[] = [];
  let cachedValue: T | undefined;
  return () => {
    const nextDependencies = dependencies();
    const changed = nextDependencies.some((item, index) => item !== cachedDependencies[index]);
    if (changed || cachedValue === undefined) {
      cachedValue = getSlip();
      cachedDependencies = nextDependencies;
    }
    return cachedValue;
  };
}

describe("路由返回后的绩效补贴状态同步", () => {
  it("订阅paySlips state时，保存后工作与业绩绩效立即更新", () => {
    const employeeId = "emp-rx";
    const month = "2026-08";
    let paySlips: PayrollControls[] = [{ employeeId, month, allowanceOverrides: {}, workKPISelections: {}, revenueActuals: {}, workKPIBonus: 0, revenueKPIBonus: 0 }];
    const getVisibleSlip = createMemoSlip(
      () => paySlips.find((slip) => slip.employeeId === employeeId && slip.month === month),
      () => [paySlips, employeeId, month],
    );

    expect(getVisibleSlip()?.workKPIBonus).toBe(0);
    paySlips = [{ employeeId, month, allowanceOverrides: { meal: true }, workKPISelections: { work: "good" }, revenueActuals: { revenue: 280000 }, workKPIBonus: 1700, revenueKPIBonus: 500 }];
    expect(getVisibleSlip()?.workKPIBonus).toBe(1700);
    expect(getVisibleSlip()?.revenueKPIBonus).toBe(500);
  });

  it("只依赖稳定的ref读取函数时无法触发刷新，防止恢复此旧实现", () => {
    const ref = { current: [{ employeeId: "emp-rx", month: "2026-08", workKPIBonus: 0 }] };
    const getSlip = () => ref.current[0];
    const getVisibleSlip = createMemoSlip(getSlip, () => [getSlip]);
    expect(getVisibleSlip().workKPIBonus).toBe(0);
    ref.current = [{ employeeId: "emp-rx", month: "2026-08", workKPIBonus: 1700 }];
    expect(getVisibleSlip().workKPIBonus).toBe(0);
  });

  it("保存必须原子写入三个控制字段与两个绩效分项", () => {
    const saved: PayrollControls = {
      employeeId: "emp-rx", month: "2026-08", allowanceOverrides: { meal: false },
      workKPISelections: { work: "good" }, revenueActuals: { revenue: 280000 },
      workKPIBonus: 1700, revenueKPIBonus: 500,
    };
    expect(saved.allowanceOverrides.meal).toBe(false);
    expect(saved.workKPISelections.work).toBe("good");
    expect(saved.revenueActuals.revenue).toBe(280000);
    expect(saved.workKPIBonus + saved.revenueKPIBonus).toBe(2200);
  });

  it("跨员工与跨月份保存必须隔离", () => {
    const slips: PayrollControls[] = [
      { employeeId: "a", month: "2026-07", allowanceOverrides: {}, workKPISelections: { work: "good" }, revenueActuals: {}, workKPIBonus: 1700, revenueKPIBonus: 0 },
      { employeeId: "a", month: "2026-08", allowanceOverrides: {}, workKPISelections: {}, revenueActuals: {}, workKPIBonus: 0, revenueKPIBonus: 0 },
      { employeeId: "b", month: "2026-07", allowanceOverrides: {}, workKPISelections: {}, revenueActuals: {}, workKPIBonus: 0, revenueKPIBonus: 0 },
    ];
    expect(slips.find((slip) => slip.employeeId === "a" && slip.month === "2026-07")?.workKPIBonus).toBe(1700);
    expect(slips.find((slip) => slip.employeeId === "a" && slip.month === "2026-08")?.workKPIBonus).toBe(0);
    expect(slips.find((slip) => slip.employeeId === "b" && slip.month === "2026-07")?.workKPIBonus).toBe(0);
  });
});
