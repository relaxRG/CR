import type { MonthCloseArchive, PayrollAdjustment } from "./types";
import { sumMoney } from "@/lib/finance/money";

/** 与月度薪资单隔离的单独补发/扣回单。 */
export interface SeparatePaymentSlip {
  id: string;
  adjustmentId: string;
  employeeId: string;
  employeeName: string;
  sourceMonth: string;
  amount: number;
  details: string;
  createdAt: number;
  paymentStatus: "pending" | "paid";
  paidAt?: number;
  notes?: string;
}

export function generateSeparatePaymentSlip(adjustment: PayrollAdjustment, sourceMonth: string): SeparatePaymentSlip {
  return {
    id: `sep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    adjustmentId: adjustment.id,
    employeeId: adjustment.employeeId,
    employeeName: adjustment.employeeName,
    sourceMonth,
    amount: adjustment.amount,
    details: adjustment.details,
    createdAt: Date.now(),
    paymentStatus: "pending",
  };
}

export function generateSeparatePayments(adjustments: PayrollAdjustment[], sourceMonth: string): SeparatePaymentSlip[] {
  return adjustments
    .filter((adjustment) => adjustment.settleMethod === "separate" && !adjustment.settled)
    .map((adjustment) => generateSeparatePaymentSlip(adjustment, sourceMonth));
}

function previousMonth(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return value === 1 ? `${year - 1}-12` : `${year}-${String(value - 1).padStart(2, "0")}`;
}

/**
 * 只读取上一自然月当前正式归档版本中、明确选择“计入下月”的未结算差额。
 * 单独补发和人工处理永不混入下月正常薪资。
 */
export function getAdjustmentForMonth(
  archives: MonthCloseArchive[],
  employeeId: string,
  currentMonth: string,
): number {
  const archive = archives
    .filter((item) => item.month === previousMonth(currentMonth) && item.status === "frozen")
    .sort((a, b) => b.version - a.version)[0];
  if (!archive) return 0;
  return sumMoney(archive.adjustments
    .filter((adjustment) => adjustment.employeeId === employeeId && !adjustment.settled && adjustment.settleMethod === "next_month")
    .map((adjustment) => adjustment.amount));
}
