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
      { field: "advanceAmount", label: "已预支" },
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
    // 已预支 = advanceAmount + pettyLaborPaid，快照两者均记录以支持差额对比
    pettyLaborPaid: slip.pettyLaborPaid ?? 0,
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

// ─── 单独补发单生成器 ─────────────────────────────────────────────────────────

/**
 * 单独补发单（与正常薪资流程完全隔离）
 *
 * 当管理者选择“单独补发”时，差额不计入任何月份的薪资单，
 * 而是生成一张独立的补发单，单独记录、单独付款、单独导出。
 */
export interface SeparatePaymentSlip {
  /** 唯一 ID */
  id: string;
  /** 关联的调整记录 ID */
  adjustmentId: string;
  /** 员工 ID */
  employeeId: string;
  /** 员工名称 */
  employeeName: string;
  /** 原始月份（差额产生的月份） */
  sourceMonth: string;
  /** 补发金额（正=补发，负=扣回） */
  amount: number;
  /** 差额明细 */
  details: string;
  /** 创建时间 */
  createdAt: number;
  /** 付款状态 */
  paymentStatus: "pending" | "paid";
  /** 付款时间 */
  paidAt?: number;
  /** 备注 */
  notes?: string;
}

/**
 * 从差额记录生成单独补发单
 *
 * 核心隔离原则：
 * 1. 补发单不修改任何月份的 PaySlip
 * 2. 补发单不计入 buildPaySlipDraft 的计算
 * 3. 补发单有独立的付款状态跟踪
 * 4. 补发单可单独导出（不混入月度报表）
 */
export function generateSeparatePaymentSlip(
  adjustment: PayrollAdjustment,
  sourceMonth: string,
): SeparatePaymentSlip {
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

/**
 * 批量生成补发单（当管理者选择“单独补发”时调用）
 *
 * 流程：
 * 1. calculateAdjustments() → 获取差额列表
 * 2. 用户选择 "separate" 方式
 * 3. 调用此函数生成补发单
 * 4. 补发单存入独立的 separatePayments 存储
 * 5. 差额记录标记为 settled + settleMethod = "separate"
 * 6. 补发单不影响任何月份的 PaySlip 数据
 */
export function generateSeparatePayments(
  adjustments: PayrollAdjustment[],
  sourceMonth: string,
): SeparatePaymentSlip[] {
  return adjustments
    .filter((a) => a.settleMethod === "separate" && !a.settled)
    .map((a) => generateSeparatePaymentSlip(a, sourceMonth));
}

/**
 * 验证“单独补发”的隔离性：
 *
 * getAdjustmentForMonth() 中的过滤条件：
 *   .filter(a => a.settleMethod === "next_month")  // 只包含 "next_month"
 *
 * 这意味着 settleMethod === "separate" 的差额永远不会被
 * getAdjustmentForMonth 读取，因此不会计入下月薪资。
 *
 * 隔离链路：
 *   separate 差额 → 不进入 getAdjustmentForMonth
 *                   → 不影响 buildPaySlipDraft
 *                   → 不影响任何月份的 finalSalary
 *                   → 独立存储在 separatePayments 中
 *                   → 独立付款、独立导出
 */

