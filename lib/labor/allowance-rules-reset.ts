import type { Employee, PaySlip } from "./types";

/** 仅本版本及之后由新表单创建的补贴规则可被保留。 */
export const CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION = 1;

export function needsHistoricalAllowanceRulesReset(
  employee: Pick<Employee, "allowanceRulesSchemaVersion">
): boolean {
  return employee.allowanceRulesSchemaVersion !== CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION;
}

/**
 * 用户已明确选择“不迁移，删除所有历史补贴规则”。
 * 该函数不识别标签、不推断类型、不保留旧金额，只将历史规则清空并写入当前版本标记。
 */
export function resetHistoricalAllowanceRules<T extends Pick<Employee, "allowanceRulesSchemaVersion" | "allowanceRules">>(
  employee: T
): T & Pick<Employee, "allowanceRulesSchemaVersion" | "allowanceRules"> {
  return {
    ...employee,
    allowanceRulesSchemaVersion: CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION,
    allowanceRules: undefined,
  };
}

/**
 * 历史规则被清空后，DRAFT薪资单不能继续携带已删除规则的开关或人工金额明细。
 * 有当前规则时才保留控制字段；空规则时显式返回 undefined 以触发持久化删除。
 */
export function getActiveAllowanceControls(
  employee: Pick<Employee, "allowanceRules">,
  existing: Pick<PaySlip, "allowanceOverrides" | "allowanceDetails"> | null | undefined,
): Pick<PaySlip, "allowanceOverrides" | "allowanceDetails"> {
  if (!(employee.allowanceRules?.length)) {
    return { allowanceOverrides: undefined, allowanceDetails: undefined };
  }
  return {
    allowanceOverrides: existing?.allowanceOverrides,
    allowanceDetails: existing?.allowanceDetails,
  };
}
