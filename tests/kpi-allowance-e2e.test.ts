import { describe, expect, it } from "vitest";
import { settlePayrollExtras } from "../lib/labor/payroll-extras";
import type { AllowanceRule, Employee, RevenueKPIRule, WorkKPIRule } from "../lib/labor/types";

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  const meal: AllowanceRule = { id: "meal", type: "meal_per_day", label: "餐补", amount: 30, unit: "per_day", enabled: true };
  const transport: AllowanceRule = { id: "transport", type: "transport_fixed", label: "交通补贴", amount: 200, unit: "per_month", enabled: true };
  const work: WorkKPIRule = { id: "work", name: "服务质量", cycle: "monthly", notes: "", enabled: true, tiers: [{ id: "excellent", label: "优秀", amount: 500, sortOrder: 1 }, { id: "unqualified", label: "不合格", amount: -200, sortOrder: 2 }] };
  const revenue: RevenueKPIRule = { id: "revenue", name: "月度营业额", source: "manual", tiers: [{ id: "first", threshold: 100000, amount: 300, sortOrder: 1 }, { id: "second", threshold: 200000, amount: 500, sortOrder: 2 }], payMode: "cumulative", calcType: "fixed", enabled: true };
  return {
    id: "emp-001", code: "E001", realName: "测试员工", phone: "", dept: "front", type: "fulltime",
    baseSalary: 6000, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 0, notes: "", active: true,
    createdAt: "2026-01-01T00:00:00.000Z", allowanceRules: [meal, transport], workKPIRules: [work], revenueKPIRules: [revenue],
    ...overrides,
  };
}

describe("绩效补贴唯一实时结算引擎", () => {
  it("默认规则按出勤结算补贴，工作绩效和业绩绩效分别结算", () => {
    const settlement = settlePayrollExtras(makeEmployee(), "2026-08", 26, {
      workKPISelections: { work: "excellent" },
      revenueActuals: { revenue: 200000 },
    });
    expect(settlement.mealAllowance).toBe(780);
    expect(settlement.transportAllowance).toBe(200);
    expect(settlement.allowanceTotal).toBe(980);
    expect(settlement.workKPIBonus).toBe(500);
    expect(settlement.revenueKPIBonus).toBe(800);
    expect(settlement.performanceTotal).toBe(1300);
  });

  it("手动取消补贴后只影响该补贴，不影响两个绩效分项", () => {
    const settlement = settlePayrollExtras(makeEmployee(), "2026-08", 26, {
      allowanceOverrides: { meal: false },
      workKPISelections: { work: "excellent" },
      revenueActuals: { revenue: 200000 },
    });
    expect(settlement.mealAllowance).toBe(0);
    expect(settlement.transportAllowance).toBe(200);
    expect(settlement.workKPIBonus).toBe(500);
    expect(settlement.revenueKPIBonus).toBe(800);
  });

  it("工作绩效负向档位只影响工作绩效，不会污染业绩绩效", () => {
    const settlement = settlePayrollExtras(makeEmployee(), "2026-08", 20, {
      workKPISelections: { work: "unqualified" },
      revenueActuals: { revenue: 200000 },
    });
    expect(settlement.workKPIBonus).toBe(-200);
    expect(settlement.revenueKPIBonus).toBe(800);
    expect(settlement.performanceTotal).toBe(600);
  });

  it("保存后考勤刷新只重算按天补贴，绩效控制字段保持不变", () => {
    const employee = makeEmployee();
    const controls = { workKPISelections: { work: "excellent" }, revenueActuals: { revenue: 200000 } };
    const before = settlePayrollExtras(employee, "2026-08", 26, controls);
    const after = settlePayrollExtras(employee, "2026-08", 0, controls);
    expect(before.mealAllowance).toBe(780);
    expect(after.mealAllowance).toBe(0);
    expect(after.workKPIBonus).toBe(500);
    expect(after.revenueKPIBonus).toBe(800);
  });

  it("业绩绩效是唯一业绩奖励结果，结算结果不产生第二个业绩金额", () => {
    const settlement = settlePayrollExtras(makeEmployee(), "2026-08", 1, { revenueActuals: { revenue: 200000 } });
    expect(settlement.revenueKPIBonus).toBe(800);
    expect(Object.keys(settlement)).toEqual(expect.arrayContaining(["revenueKPIBonus"]));
    expect(Object.keys(settlement)).not.toContain("salesCommission");
  });
});
