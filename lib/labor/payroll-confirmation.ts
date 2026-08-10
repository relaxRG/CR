/**
 * 确认发薪状态机 Store
 *
 * 状态流转：
 *   DRAFT → confirmPayroll() → FROZEN
 *   FROZEN → enterAdjustMode() → ADJUSTING
 *   ADJUSTING → confirmAdjustment() → FROZEN
 *   FROZEN → revokeConfirmation() → DRAFT（撤销确认）
 *   ADJUSTING → cancelAdjustment() → FROZEN（取消调整）
 */

import { useCallback, useMemo, useRef, useEffect } from "react";
import { createContext, useContext } from "react";
import type {
  MonthlyConfirmation,
  PayrollConfirmationStatus,
  PayrollAdjustment,
  AdjustmentSettleMethod,
  PaySlip,
  Employee,
} from "./types";

// ─── 差额计算引擎 ─────────────────────────────────────────────────────────────

export interface AdjustmentDiff {
  employeeId: string;
  employeeName: string;
  amount: number;
  details: string;
  breakdown: {
    field: string;
    label: string;
    before: number;
    after: number;
    diff: number;
  }[];
}

/**
 * 计算所有员工的差额
 * 对比当前 PaySlip 与 frozenSnapshot，返回有差异的员工列表
 */
export function calculateAdjustments(
  employees: Employee[],
  getPaySlip: (employeeId: string, month: string) => PaySlip | undefined,
  month: string,
): AdjustmentDiff[] {
  const diffs: AdjustmentDiff[] = [];

  for (const emp of employees) {
    const slip = getPaySlip(emp.id, month);
    if (!slip?.frozenSnapshot) continue;

    const snap = slip.frozenSnapshot;
    const breakdown: AdjustmentDiff["breakdown"] = [];

    // 逐字段对比
    const fields: Array<{ field: keyof typeof snap; label: string }> = [
      { field: "attendanceSalary", label: "考勤工资" },
      { field: "mealAllowance", label: "餐补" },
      { field: "transportAllowance", label: "交通补贴" },
      { field: "otherAllowance", label: "其他补贴" },
      { field: "performanceBonus", label: "绩效奖金" },
      { field: "socialInsuranceDeduction", label: "社保扣除" },
      { field: "housingFundDeduction", label: "公积金扣除" },
      { field: "advanceAmount", label: "预支" },
    ];

    for (const { field, label } of fields) {
      const before = snap[field] ?? 0;
      const after = (slip as any)[field] ?? 0;
      if (Math.abs(after - before) > 0.01) {
        breakdown.push({ field, label, before, after, diff: Math.round((after - before) * 100) / 100 });
      }
    }

    // 总差额 = 新 finalSalary - 原 finalSalary
    const totalDiff = Math.round(((slip.finalSalary ?? 0) - snap.finalSalary) * 100) / 100;
    if (Math.abs(totalDiff) < 0.01 && breakdown.length === 0) continue;

    diffs.push({
      employeeId: emp.id,
      employeeName: emp.code || emp.realName,
      amount: totalDiff,
      details: breakdown.map((b) => `${b.label}: ¥${b.before} → ¥${b.after}`).join("；"),
      breakdown,
    });
  }

  return diffs;
}

// ─── 快照生成 ─────────────────────────────────────────────────────────────────

/**
 * 为单个 PaySlip 生成 frozenSnapshot
 */
export function buildFrozenSnapshot(slip: PaySlip): PaySlip["frozenSnapshot"] {
  return {
    grossSalary: slip.grossSalary ?? 0,
    finalSalary: slip.finalSalary ?? 0,
    attendanceSalary: slip.attendanceSalary ?? 0,
    mealAllowance: slip.mealAllowance ?? 0,
    transportAllowance: slip.transportAllowance ?? 0,
    otherAllowance: slip.otherAllowance ?? 0,
    performanceBonus: slip.performanceBonus ?? 0,
    socialInsuranceDeduction: slip.socialInsuranceDeduction ?? 0,
    housingFundDeduction: slip.housingFundDeduction ?? 0,
    advanceAmount: slip.advanceAmount ?? 0,
  };
}

// ─── 状态机操作 ─────────────────────────────────────────────────────────────────

export interface PayrollConfirmationActions {
  /** 获取某月的确认状态 */
  getStatus: (month: string) => PayrollConfirmationStatus;
  /** 获取某月的完整确认记录 */
  getConfirmation: (month: string) => MonthlyConfirmation | null;
  /** 某月是否已锁定（FROZEN 或 ADJUSTING 都算锁定，只有 ADJUSTING 时才允许写入） */
  isMonthLocked: (month: string) => boolean;
  /** 某月是否允许写入（DRAFT 或 ADJUSTING） */
  isMonthWritable: (month: string) => boolean;
  /** 确认发薪（DRAFT → FROZEN） */
  confirmPayroll: (month: string, employees: Employee[], getPaySlip: (eid: string, m: string) => PaySlip | undefined) => void;
  /** 进入调整模式（FROZEN → ADJUSTING） */
  enterAdjustMode: (month: string) => void;
  /** 确认调整（ADJUSTING → FROZEN），返回差额列表 */
  confirmAdjustment: (month: string, diffs: AdjustmentDiff[], settleMethod: AdjustmentSettleMethod) => PayrollAdjustment[];
  /** 取消调整（ADJUSTING → FROZEN，丢弃修改） */
  cancelAdjustment: (month: string) => void;
  /** 撤销确认（FROZEN → DRAFT） */
  revokeConfirmation: (month: string) => void;
  /** 标记差额已处理 */
  settleAdjustment: (month: string, adjustmentId: string, method: AdjustmentSettleMethod, settledInMonth: string) => void;
  /** 获取某月未处理的差额列表 */
  getPendingAdjustments: (month: string) => PayrollAdjustment[];
}

// ─── 差额分摊逻辑 ─────────────────────────────────────────────────────────────

/**
 * 将差额分摊到下月薪资
 * 在 buildPaySlipDraft 中调用，自动将上月未处理差额计入本月
 */
export function getAdjustmentForMonth(
  confirmations: MonthlyConfirmation[],
  employeeId: string,
  currentMonth: string,
): number {
  // 计算上月
  const [y, m] = currentMonth.split("-").map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

  const prevConf = confirmations.find((c) => c.month === prevMonth);
  if (!prevConf) return 0;

  // 汇总该员工在上月的所有未处理差额（settleMethod = "next_month"）
  return prevConf.adjustments
    .filter((a) => a.employeeId === employeeId && !a.settled && a.settleMethod === "next_month")
    .reduce((sum, a) => sum + a.amount, 0);
}
