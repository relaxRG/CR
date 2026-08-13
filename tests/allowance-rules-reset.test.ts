import { describe, expect, it } from "vitest";
import {
  CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION,
  getActiveAllowanceControls,
  needsHistoricalAllowanceRulesReset,
  resetHistoricalAllowanceRules,
} from "../lib/labor/allowance-rules-reset";

describe("历史补贴规则直接清空", () => {
  it("无版本历史员工的所有补贴规则都会直接删除，不执行类型推断或金额迁移", () => {
    const legacy = {
      id: "employee-1",
      allowanceRules: [
        { id: "meal", type: "custom_fixed", label: "餐补", amount: 15, unit: "per_day", enabled: true },
        { id: "transport", type: "custom_fixed", label: "交通补贴", amount: 200, unit: "per_month", enabled: true },
        { id: "company", type: "custom_fixed", label: "公司补贴", amount: 2500, unit: "per_month", enabled: true },
        { id: "legacy-formula", type: "custom_formula", label: "旧公式", amount: 999, unit: "per_year", enabled: true },
      ],
    } as any;

    expect(needsHistoricalAllowanceRulesReset(legacy)).toBe(true);
    expect(resetHistoricalAllowanceRules(legacy)).toMatchObject({
      allowanceRulesSchemaVersion: CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION,
      allowanceRules: undefined,
    });
  });

  it("当前版本标记的员工规则不会在后续加载时被重复清空", () => {
    const current = {
      id: "employee-2",
      allowanceRulesSchemaVersion: CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION,
      allowanceRules: [{ id: "new-company", type: "custom_fixed", label: "新公司补贴", amount: 2500, unit: "per_month", enabled: true }],
    } as any;

    expect(needsHistoricalAllowanceRulesReset(current)).toBe(false);
    expect(current.allowanceRules).toHaveLength(1);
  });

  it("空历史员工同样获得当前版本标记，避免每次加载重复写回", () => {
    const reset = resetHistoricalAllowanceRules({ id: "employee-3", allowanceRules: undefined } as any);
    expect(reset.allowanceRules).toBeUndefined();
    expect(reset.allowanceRulesSchemaVersion).toBe(CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION);
    expect(needsHistoricalAllowanceRulesReset(reset)).toBe(false);
  });

  it("规则清空后DRAFT薪资单的旧补贴开关和金额明细必须一起删除", () => {
    const controls = getActiveAllowanceControls(
      { allowanceRules: undefined },
      { allowanceOverrides: { legacyMeal: true }, allowanceDetails: { legacyMeal: { amount: 15, isOverride: true } } } as any,
    );
    expect(controls).toEqual({ allowanceOverrides: undefined, allowanceDetails: undefined });
  });

  it("新规则创建后仅保留其所属薪资单的当前控制字段", () => {
    const existing = { allowanceOverrides: { newMeal: false }, allowanceDetails: { newMeal: { amount: 0 } } } as any;
    expect(getActiveAllowanceControls({ allowanceRules: [{ id: "newMeal" }] } as any, existing)).toEqual(existing);
  });
});
