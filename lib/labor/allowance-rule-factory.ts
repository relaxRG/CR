import type { AllowanceRule, AllowanceType, AllowanceUnit } from "./types";

export interface AllowanceRulePreset {
  label: string;
  type: AllowanceType;
  unit: AllowanceUnit;
}

export const ALLOWANCE_PRESETS = {
  meal: { label: "餐补", type: "meal_per_day", unit: "per_day" },
  transport: { label: "交通补贴", type: "transport_fixed", unit: "per_month" },
} as const satisfies Record<string, AllowanceRulePreset>;

/**
 * 在员工档案中创建补贴规则。
 *
 * 预设必须保留自己的业务类型：交通补贴不能降级为 custom_fixed，
 * 否则虽然金额仍进入补贴合计，却会错误计入“其他补贴”而非“交通补贴”。
 */
export function createAllowanceRule(id: string, preset?: AllowanceRulePreset): AllowanceRule {
  return {
    id,
    type: preset?.type ?? "custom_fixed",
    label: preset?.label ?? "自定义补贴",
    amount: 0,
    unit: preset?.unit ?? "per_month",
    enabled: true,
  };
}
