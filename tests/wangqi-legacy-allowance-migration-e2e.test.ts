import { describe, expect, it } from "vitest";
import { migrateAllowanceRules } from "../lib/labor/allowance-rule-migration";
import { getPayrollExtrasGrandTotal, settlePayrollExtras } from "../lib/labor/payroll-extras";
import type { Employee } from "../lib/labor/types";

describe("王琪：历史补贴迁移后的薪资结算闭环", () => {
  it("旧custom_fixed餐补残留¥15在零出勤时必须清零，业绩绩效¥500完整进入综合额外", () => {
    const legacyAllowanceRules = [
      // 历史快捷按钮曾错误创建为 custom_fixed；历史薪资单还可能有手工 ¥15 覆盖。
      { id: "meal", type: "custom_fixed", label: "餐补", amount: 15, unit: "per_day", enabled: true },
    ];
    const employee: Employee = {
      id: "wangqi", code: "WQ", realName: "王琪", phone: "", dept: "front", type: "fulltime",
      baseSalary: 0, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 0, notes: "", active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      allowanceRules: migrateAllowanceRules(legacyAllowanceRules),
      revenueKPIRules: [{
        id: "store-revenue", name: "店铺营业额", source: "total_revenue", payMode: "highest", calcType: "fixed", enabled: true,
        tiers: [{ id: "280k", threshold: 280000, amount: 500, sortOrder: 1 }],
      }],
    };

    const settlement = settlePayrollExtras(employee, "2026-08", 0, {
      allowanceOverrides: { meal: true },
      allowanceDetails: { meal: { amount: 15, autoNote: "旧工资单残留", isOverride: true } },
      revenueActuals: { "store-revenue": 280000 },
    });

    expect(employee.allowanceRules?.[0]).toMatchObject({ type: "meal_per_day", unit: "per_day" });
    expect(settlement.mealAllowance).toBe(0);
    expect(settlement.allowanceDetails.meal).toMatchObject({ amount: 0, isOverride: false });
    expect(settlement.workKPIBonus).toBe(0);
    expect(settlement.revenueKPIBonus).toBe(500);
    expect(settlement.performanceTotal).toBe(500);
    expect(getPayrollExtrasGrandTotal(settlement)).toBe(500);
  });

  it("迁移后王琪营业额差一元未达门槛时，业绩绩效必须为零且不会复活旧餐补", () => {
    const employee: Employee = {
      id: "wangqi", code: "WQ", realName: "王琪", phone: "", dept: "front", type: "fulltime",
      baseSalary: 0, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 0, notes: "", active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      allowanceRules: migrateAllowanceRules([{ id: "meal", type: "custom_fixed", label: "餐补", amount: 15, unit: "per_day", enabled: true }]),
      revenueKPIRules: [{
        id: "store-revenue", name: "店铺营业额", source: "total_revenue", payMode: "highest", calcType: "fixed", enabled: true,
        tiers: [{ id: "280k", threshold: 280000, amount: 500, sortOrder: 1 }],
      }],
    };

    const settlement = settlePayrollExtras(employee, "2026-08", 0, { revenueActuals: { "store-revenue": 279999 } });
    expect(settlement.mealAllowance).toBe(0);
    expect(settlement.revenueKPIBonus).toBe(0);
    expect(getPayrollExtrasGrandTotal(settlement)).toBe(0);
  });
});
