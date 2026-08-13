import type { AllowanceRule, AllowanceUnit } from "./types";

export const CUSTOM_ALLOWANCE_UNIT_OPTIONS: readonly AllowanceUnit[] = [
  "per_month",
  "per_quarter",
  "per_year",
];

export function isPeriodicAllowanceUnit(unit: AllowanceUnit): boolean {
  return unit === "per_quarter" || unit === "per_year";
}

export function isValidEffectiveMonth(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
}

/**
 * 把规则写入员工档案前的唯一规范化入口。
 *
 * 餐补和交通补贴是业务预设，其单位不可被错误改写；自定义固定补贴则允许
 * 按月、自然/滚动季度和自然/滚动年度发放。
 */
export function normalizeAllowanceRuleForSave(rule: AllowanceRule): AllowanceRule {
  if (rule.type === "meal_per_day") {
    return { ...rule, unit: "per_day", periodMode: undefined, effectiveMonth: undefined };
  }
  if (rule.type === "transport_fixed") {
    return { ...rule, unit: "per_month", periodMode: undefined, effectiveMonth: undefined };
  }
  if (!isPeriodicAllowanceUnit(rule.unit)) {
    return { ...rule, periodMode: undefined, effectiveMonth: undefined };
  }

  const periodMode = rule.periodMode ?? "natural";
  return {
    ...rule,
    periodMode,
    effectiveMonth: periodMode === "rolling" ? rule.effectiveMonth?.trim() : undefined,
  };
}

export function validateAllowanceRulesForSave(rules: AllowanceRule[]): string | null {
  for (const rule of rules) {
    if (!rule.label.trim()) return "请填写补贴名称";
    if (!Number.isFinite(rule.amount) || rule.amount < 0) return `“${rule.label}”金额必须为非负数`;

    if (isPeriodicAllowanceUnit(rule.unit) && (rule.periodMode ?? "natural") === "rolling") {
      if (!isValidEffectiveMonth(rule.effectiveMonth)) {
        return `“${rule.label}”为滚动${rule.unit === "per_quarter" ? "季度" : "年度"}补贴，请填写生效月（YYYY-MM）`;
      }
    }
  }
  return null;
}
