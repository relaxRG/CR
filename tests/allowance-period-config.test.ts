import { describe, expect, it } from "vitest";
import {
  normalizeAllowanceRuleForSave,
  validateAllowanceRulesForSave,
} from "../lib/labor/allowance-rule-config";
import { settlePayrollExtras } from "../lib/labor/payroll-extras";
import { shouldPayAllowanceThisMonth, type AllowanceRule, type Employee } from "../lib/labor/types";

function fixedRule(overrides: Partial<AllowanceRule>): AllowanceRule {
  return {
    id: "company-allowance",
    type: "custom_fixed",
    label: "公司补贴",
    amount: 3000,
    unit: "per_quarter",
    enabled: true,
    ...overrides,
  };
}

function employee(rule: AllowanceRule): Employee {
  return {
    id: "emp-1", code: "E1", realName: "测试员工", phone: "", dept: "front", type: "fulltime",
    baseSalary: 0, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 0, notes: "", active: true,
    createdAt: "2026-01-01T00:00:00.000Z", allowanceRules: [rule],
  };
}

describe("季度和年度补贴配置与结算边界", () => {
  it("自然季度补贴仅在季度末进入实际薪资结算", () => {
    const rule = fixedRule({ unit: "per_quarter", periodMode: "natural", amount: 3000 });
    expect(shouldPayAllowanceThisMonth(rule, "2026-02")).toBe(false);
    expect(shouldPayAllowanceThisMonth(rule, "2026-03")).toBe(true);
    expect(settlePayrollExtras(employee(rule), "2026-02", 0).otherAllowance).toBe(0);
    expect(settlePayrollExtras(employee(rule), "2026-03", 0).otherAllowance).toBe(3000);
  });

  it("自然年度补贴仅在12月进入实际薪资结算", () => {
    const rule = fixedRule({ unit: "per_year", periodMode: "natural", amount: 12000 });
    expect(shouldPayAllowanceThisMonth(rule, "2026-11")).toBe(false);
    expect(shouldPayAllowanceThisMonth(rule, "2026-12")).toBe(true);
    expect(settlePayrollExtras(employee(rule), "2026-12", 0).otherAllowance).toBe(12000);
  });

  it("滚动季度可跨年：2026-11生效后于2027-01、2027-04发放", () => {
    const rule = fixedRule({ unit: "per_quarter", periodMode: "rolling", effectiveMonth: "2026-11" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-12")).toBe(false);
    expect(shouldPayAllowanceThisMonth(rule, "2027-01")).toBe(true);
    expect(shouldPayAllowanceThisMonth(rule, "2027-04")).toBe(true);
  });

  it("滚动年度可跨年：2026-02生效后于2027-01及每12个月发放", () => {
    const rule = fixedRule({ unit: "per_year", periodMode: "rolling", effectiveMonth: "2026-02", amount: 12000 });
    expect(shouldPayAllowanceThisMonth(rule, "2027-01")).toBe(true);
    expect(shouldPayAllowanceThisMonth(rule, "2027-02")).toBe(false);
    expect(shouldPayAllowanceThisMonth(rule, "2028-01")).toBe(true);
  });

  it("滚动季度或年度缺少有效生效月时禁止保存", () => {
    expect(validateAllowanceRulesForSave([fixedRule({ periodMode: "rolling", effectiveMonth: undefined })])).toContain("生效月");
    expect(validateAllowanceRulesForSave([fixedRule({ unit: "per_year", periodMode: "rolling", effectiveMonth: "2026-13" })])).toContain("YYYY-MM");
  });

  it("保存时固定预设单位不可被错误改写，普通月度补贴会清除无效周期字段", () => {
    expect(normalizeAllowanceRuleForSave(fixedRule({ type: "meal_per_day", unit: "per_year", periodMode: "rolling", effectiveMonth: "2026-01" }))).toMatchObject({
      type: "meal_per_day", unit: "per_day", periodMode: undefined, effectiveMonth: undefined,
    });
    expect(normalizeAllowanceRuleForSave(fixedRule({ type: "transport_fixed", unit: "per_quarter", periodMode: "rolling", effectiveMonth: "2026-01" }))).toMatchObject({
      type: "transport_fixed", unit: "per_month", periodMode: undefined, effectiveMonth: undefined,
    });
    expect(normalizeAllowanceRuleForSave(fixedRule({ unit: "per_month", periodMode: "rolling", effectiveMonth: "2026-01" }))).toMatchObject({
      unit: "per_month", periodMode: undefined, effectiveMonth: undefined,
    });
  });
});
