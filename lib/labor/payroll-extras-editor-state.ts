import { shouldPayAllowanceThisMonth, type Employee, type PaySlip } from "./types";

export interface PayrollExtrasEditorState {
  allowanceEnabled: Record<string, boolean>;
  workKPISelections: Record<string, string>;
  revenueActuals: Record<string, string>;
}

/**
 * 构建绩效补贴编辑页的唯一初始状态。
 *
 * 编辑页允许本地暂存用户操作；但当员工档案或薪资单异步到达时，必须以同一规则
 * 重新建立首次状态，避免餐补/交通补贴错误显示为未选或丢失已保存控制字段。
 */
export function buildPayrollExtrasEditorState(
  employee: Employee,
  month: string,
  slip: Pick<PaySlip, "allowanceOverrides" | "workKPISelections" | "revenueActuals"> | null | undefined,
): PayrollExtrasEditorState {
  const overrides = slip?.allowanceOverrides ?? {};
  const allowanceEnabled: Record<string, boolean> = {};

  for (const rule of employee.allowanceRules ?? []) {
    allowanceEnabled[rule.id] = rule.id in overrides
      ? overrides[rule.id]
      : rule.enabled !== false && shouldPayAllowanceThisMonth(rule, month);
  }

  return {
    allowanceEnabled,
    workKPISelections: { ...(slip?.workKPISelections ?? {}) },
    revenueActuals: Object.fromEntries(
      Object.entries(slip?.revenueActuals ?? {}).map(([id, value]) => [id, String(value)])
    ),
  };
}
