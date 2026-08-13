import { describe, expect, it } from "vitest";
import { ALLOWANCE_PRESETS, createAllowanceRule } from "../lib/labor/allowance-rule-factory";
import { CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION, resetHistoricalAllowanceRules } from "../lib/labor/allowance-rules-reset";
import { getPayrollExtrasGrandTotal, settlePayrollExtras } from "../lib/labor/payroll-extras";
import type { Employee } from "../lib/labor/types";

function wangqiWithNewMealRule(): Employee {
  return {
    id: "wangqi", code: "WQ", realName: "王琪", phone: "", dept: "front", type: "fulltime",
    baseSalary: 0, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 0, notes: "", active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    allowanceRulesSchemaVersion: CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION,
    allowanceRules: [{ ...createAllowanceRule("meal", ALLOWANCE_PRESETS.meal), amount: 15 }],
    revenueKPIRules: [{
      id: "store-revenue", name: "店铺营业额", source: "total_revenue", payMode: "highest", calcType: "fixed", enabled: true,
      tiers: [{ id: "280k", threshold: 280000, amount: 500, sortOrder: 1 }],
    }],
  };
}

describe("王琪：清空历史补贴规则后的新结算闭环", () => {
  it("先直接删除所有历史补贴规则，再由新表单重新创建餐补；零出勤只保留业绩绩效", () => {
    const historicalEmployee = {
      id: "wangqi",
      allowanceRules: [{ id: "legacy-meal", type: "custom_fixed", label: "餐补", amount: 15, unit: "per_day", enabled: true }],
    } as any;
    const reset = resetHistoricalAllowanceRules(historicalEmployee);
    expect(reset.allowanceRules).toBeUndefined();
    expect(reset.allowanceRulesSchemaVersion).toBe(CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION);

    const settlement = settlePayrollExtras(wangqiWithNewMealRule(), "2026-08", 0, {
      revenueActuals: { "store-revenue": 280000 },
    });

    expect(settlement.mealAllowance).toBe(0);
    expect(settlement.workKPIBonus).toBe(0);
    expect(settlement.revenueKPIBonus).toBe(500);
    expect(settlement.performanceTotal).toBe(500);
    expect(getPayrollExtrasGrandTotal(settlement)).toBe(500);
  });

  it("营业额未达¥280,000门槛时，重新创建的餐补在零出勤下也不能产生旧金额", () => {
    const settlement = settlePayrollExtras(wangqiWithNewMealRule(), "2026-08", 0, {
      revenueActuals: { "store-revenue": 279999 },
    });
    expect(settlement.mealAllowance).toBe(0);
    expect(settlement.revenueKPIBonus).toBe(0);
    expect(getPayrollExtrasGrandTotal(settlement)).toBe(0);
  });
});
