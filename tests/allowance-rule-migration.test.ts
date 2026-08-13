import { describe, expect, it } from "vitest";
import {
  migrateAllowanceRule,
  migrateAllowanceRules,
  needsAllowanceRulesMigration,
} from "../lib/labor/allowance-rule-migration";

describe("历史补贴规则迁移", () => {
  it("为旧餐补补齐按天单位，并保持餐补类型", () => {
    const migrated = migrateAllowanceRule({ id: "meal", type: "meal_per_day", label: "餐补", amount: 15, enabled: true });
    expect(migrated).toMatchObject({ type: "meal_per_day", unit: "per_day", periodMode: undefined, effectiveMonth: undefined });
  });

  it("将旧快捷按钮错误创建的custom_fixed餐补和交通补贴提升为正确预设类型", () => {
    const [meal, transport] = migrateAllowanceRules([
      { id: "meal", type: "custom_fixed", label: "餐补", amount: 15, unit: "per_day", enabled: true },
      { id: "transport", type: "custom_fixed", label: "交通补贴", amount: 200, unit: "per_month", enabled: true },
    ])!;
    expect(meal).toMatchObject({ type: "meal_per_day", unit: "per_day" });
    expect(transport).toMatchObject({ type: "transport_fixed", unit: "per_month" });
  });

  it("公司补贴和其他自定义固定补贴不会因名称以外的推断而被错误重分类", () => {
    const company = migrateAllowanceRule({ id: "company", type: "custom_fixed", label: "公司补贴", amount: 2500, unit: "per_month", enabled: true });
    expect(company).toMatchObject({ type: "custom_fixed", unit: "per_month", label: "公司补贴" });
  });

  it("缺失type或unit的历史交通补贴可由清晰名称安全恢复", () => {
    const migrated = migrateAllowanceRule({ id: "transport", label: "交通补贴", amount: "200" });
    expect(migrated).toMatchObject({ type: "transport_fixed", unit: "per_month", amount: 200, enabled: true });
  });

  it("历史季度年度规则保留有效滚动生效月，非周期规则清除无效周期字段", () => {
    const rollingQuarter = migrateAllowanceRule({
      id: "quarter", type: "custom_fixed", label: "公司季度补贴", amount: 3000,
      unit: "per_quarter", periodMode: "rolling", effectiveMonth: "2026-11", enabled: true,
    });
    expect(rollingQuarter).toMatchObject({ unit: "per_quarter", periodMode: "rolling", effectiveMonth: "2026-11" });

    const monthly = migrateAllowanceRule({
      id: "monthly", type: "custom_fixed", label: "公司补贴", amount: 2500,
      unit: "per_month", periodMode: "rolling", effectiveMonth: "2026-11", enabled: true,
    });
    expect(monthly).toMatchObject({ unit: "per_month", periodMode: undefined, effectiveMonth: undefined });
  });

  it("无效类型、单位、金额和周期字段会安全净化为可结算规则", () => {
    const migrated = migrateAllowanceRule({
      id: "legacy", type: "unknown", label: "其他补贴", amount: "not-a-number",
      unit: "weekly", periodMode: "invalid", effectiveMonth: "2026-13",
    });
    expect(migrated).toMatchObject({ type: "custom_fixed", unit: "per_month", amount: 0, periodMode: undefined, effectiveMonth: undefined, enabled: true });
  });

  it("迁移检测只在历史字段与规范化结果不同时触发持久化写回", () => {
    const canonical = [{ id: "company", type: "custom_fixed", label: "公司补贴", amount: 2500, unit: "per_month", enabled: true }];
    const legacy = [{ id: "transport", type: "custom_fixed", label: "交通补贴", amount: 200, unit: "per_month", enabled: true }];
    expect(needsAllowanceRulesMigration(canonical)).toBe(false);
    expect(needsAllowanceRulesMigration(legacy)).toBe(true);
  });
});
