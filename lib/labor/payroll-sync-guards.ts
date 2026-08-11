import type { PayrollConfirmationStatus } from "./types";

/**
 * 自动同步与月度锁定的唯一权限口径。
 *
 * DRAFT：尚未确认的实时月份，可随排班、人员、预支、调休、节假日和配置变化自动重算。
 * ADJUSTING：已确认后进入差额调整，允许受控重算以生成调整前的当前草稿。
 * FROZEN：已确认发薪，禁止任何自动写入，历史结算只允许通过调整流程处理。
 */
export function shouldAutoSyncPayrollMonth(status: PayrollConfirmationStatus): boolean {
  return status === "draft" || status === "adjusting";
}

/** 仅用于可读的诊断和测试输出。 */
export function describePayrollAutoSync(status: PayrollConfirmationStatus): string {
  switch (status) {
    case "draft":
      return "自动重算：草稿月份";
    case "adjusting":
      return "自动重算：调整中月份";
    case "frozen":
      return "不自动重算：已冻结月份";
  }
}
