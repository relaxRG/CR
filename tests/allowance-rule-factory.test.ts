import { describe, expect, it } from "vitest";
import { ALLOWANCE_PRESETS, createAllowanceRule } from "../lib/labor/allowance-rule-factory";
import { settlePayrollExtras } from "../lib/labor/payroll-extras";
import type { Employee } from "../lib/labor/types";

function employeeWithRules(): Employee {
  return {
    id: "emp-1", code: "E1", realName: "测试员工", phone: "", dept: "front", type: "fulltime",
    baseSalary: 0, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 0, notes: "", active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    allowanceRules: [
      { ...createAllowanceRule("meal", ALLOWANCE_PRESETS.meal), amount: 15 },
      { ...createAllowanceRule("transport", ALLOWANCE_PRESETS.transport), amount: 200 },
      { ...createAllowanceRule("company"), label: "公司补贴", amount: 2500 },
    ],
  };
}

describe("员工档案补贴预设工厂", () => {
  it("餐补预设必须创建为按天餐补规则", () => {
    expect(createAllowanceRule("meal", ALLOWANCE_PRESETS.meal)).toMatchObject({
      type: "meal_per_day", label: "餐补", unit: "per_day", enabled: true,
    });
  });

  it("交通补贴预设必须创建为交通固定补贴，而非自定义固定补贴", () => {
    expect(createAllowanceRule("transport", ALLOWANCE_PRESETS.transport)).toMatchObject({
      type: "transport_fixed", label: "交通补贴", unit: "per_month", enabled: true,
    });
  });

  it("唯一结算引擎将餐补、交通补贴和公司补贴分别映射至正确薪资分项", () => {
    const extras = settlePayrollExtras(employeeWithRules(), "2026-08", 2);
    expect(extras.mealAllowance).toBe(30);
    expect(extras.transportAllowance).toBe(200);
    expect(extras.otherAllowance).toBe(2500);
    expect(extras.allowanceTotal).toBe(2730);
  });
});
