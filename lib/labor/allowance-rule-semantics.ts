import type { AllowanceRule } from "./types";

export type AllowanceSettlementBucket = "meal" | "transport" | "other";

/** 按天规则没有资格继承人工金额覆盖，必须基于实际出勤天数实时重算。 */
export function isDailyAllowanceRule(rule: AllowanceRule): boolean {
  return rule.unit === "per_day" || rule.type === "meal_per_day";
}

/** 唯一补贴分项分类：避免页面和结算引擎各自硬编码同一套类型判断。 */
export function getAllowanceSettlementBucket(rule: AllowanceRule): AllowanceSettlementBucket {
  if (rule.type === "transport_fixed") return "transport";
  if (isDailyAllowanceRule(rule)) return "meal";
  return "other";
}

/** 餐补和交通补贴是受保护业务预设；自定义固定补贴才允许选择周期。 */
export function isProtectedAllowancePreset(rule: AllowanceRule): boolean {
  return rule.type === "meal_per_day" || rule.type === "transport_fixed";
}
