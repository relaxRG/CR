import { describe, expect, it } from "vitest";
import { buildPayrollExtrasEditorState } from "../lib/labor/payroll-extras-editor-state";
import type { AllowanceRule, Employee, PaySlip } from "../lib/labor/types";

function employeeWithRules(ruleIds: "two" | "three" = "two"): Employee {
  const rules: AllowanceRule[] = [
    { id: "meal", type: "meal_per_day" as const, label: "餐补", amount: 15, unit: "per_day" as const, enabled: true },
    { id: "transport", type: "transport_fixed" as const, label: "交通补贴", amount: 200, unit: "per_month" as const, enabled: true },
  ];
  if (ruleIds === "three") rules.push({ id: "company", type: "custom_fixed" as const, label: "公司补贴", amount: 2500, unit: "per_month" as const, enabled: true });
  return {
    id: "emp-1", code: "E1", realName: "测试员工", phone: "", dept: "front", type: "fulltime",
    baseSalary: 0, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 0, notes: "", active: true,
    createdAt: "2026-01-01T00:00:00.000Z", allowanceRules: rules,
  };
}

describe("补贴编辑状态初始化", () => {
  it("仅配置餐补和交通补贴时，只生成这两个开关且默认按规则启用", () => {
    const state = buildPayrollExtrasEditorState(employeeWithRules("two"), "2026-08", null);
    expect(state.allowanceEnabled).toEqual({ meal: true, transport: true });
    expect(state.workKPISelections).toEqual({});
    expect(state.revenueActuals).toEqual({});
  });

  it("异步加载已有薪资单后，已保存的补贴开关和绩效控制字段必须覆盖默认值", () => {
    const saved = {
      allowanceOverrides: { meal: false, transport: true },
      workKPISelections: { service: "good" },
      revenueActuals: { revenue: 280000 },
    } as Pick<PaySlip, "allowanceOverrides" | "workKPISelections" | "revenueActuals">;
    const state = buildPayrollExtrasEditorState(employeeWithRules("two"), "2026-08", saved);
    expect(state.allowanceEnabled).toEqual({ meal: false, transport: true });
    expect(state.workKPISelections).toEqual({ service: "good" });
    expect(state.revenueActuals).toEqual({ revenue: "280000" });
  });

  it("补贴编辑页不硬编码为两个项目：员工档案新增自定义固定补贴后必须一并显示并可控制", () => {
    const state = buildPayrollExtrasEditorState(employeeWithRules("three"), "2026-08", null);
    expect(state.allowanceEnabled).toEqual({ meal: true, transport: true, company: true });
  });
});
