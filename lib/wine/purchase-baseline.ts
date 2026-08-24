export type WinePurchaseBaselineScope = "supplier" | "product";
export type WinePurchaseBaselineAction = "created" | "updated" | "deleted" | "archived";

export interface WinePurchaseBaseline {
  id: string;
  scope: WinePurchaseBaselineScope;
  subjectId: string;
  initialCumulativeAmount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface WinePurchaseBaselineAuditEntry {
  id: string;
  baselineId: string;
  action: WinePurchaseBaselineAction;
  previousAmount: number | null;
  nextAmount: number | null;
  reason: string;
  occurredAt: string;
  month: string;
}

export interface WinePurchaseBaselineArchive {
  id: string;
  month: string;
  closedAt: string;
  baselines: WinePurchaseBaseline[];
  auditEntries: WinePurchaseBaselineAuditEntry[];
}

export function validateWinePurchaseBaselineAmount(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return "初始累积金额必须是非负有限数字";
  return null;
}

export function createWinePurchaseBaseline(input: Omit<WinePurchaseBaseline, "deletedAt">, audit: Omit<WinePurchaseBaselineAuditEntry, "baselineId" | "action" | "previousAmount" | "nextAmount">) {
  const error = validateWinePurchaseBaselineAmount(input.initialCumulativeAmount);
  if (error) throw new Error(error);
  return {
    baseline: { ...input },
    audit: {
      ...audit,
      baselineId: input.id,
      action: "created" as const,
      previousAmount: null,
      nextAmount: input.initialCumulativeAmount,
    },
  };
}

export function updateWinePurchaseBaseline(
  baseline: WinePurchaseBaseline,
  nextAmount: number,
  audit: Omit<WinePurchaseBaselineAuditEntry, "baselineId" | "action" | "previousAmount" | "nextAmount">,
) {
  const error = validateWinePurchaseBaselineAmount(nextAmount);
  if (error) throw new Error(error);
  if (baseline.deletedAt) throw new Error("已删除的累积基线不可修改");
  return {
    baseline: { ...baseline, initialCumulativeAmount: nextAmount, updatedAt: audit.occurredAt },
    audit: {
      ...audit,
      baselineId: baseline.id,
      action: "updated" as const,
      previousAmount: baseline.initialCumulativeAmount,
      nextAmount,
    },
  };
}

export function deleteWinePurchaseBaseline(
  baseline: WinePurchaseBaseline,
  audit: Omit<WinePurchaseBaselineAuditEntry, "baselineId" | "action" | "previousAmount" | "nextAmount">,
) {
  if (baseline.deletedAt) throw new Error("累积基线已删除");
  return {
    baseline: { ...baseline, deletedAt: audit.occurredAt, updatedAt: audit.occurredAt },
    audit: {
      ...audit,
      baselineId: baseline.id,
      action: "deleted" as const,
      previousAmount: baseline.initialCumulativeAmount,
      nextAmount: null,
    },
  };
}

/** 月结时保存不可变副本，后续编辑新基线不会回写已归档月份。 */
export function archiveWinePurchaseBaselines(input: Omit<WinePurchaseBaselineArchive, "baselines" | "auditEntries"> & {
  baselines: readonly WinePurchaseBaseline[];
  auditEntries: readonly WinePurchaseBaselineAuditEntry[];
}): WinePurchaseBaselineArchive {
  return {
    id: input.id,
    month: input.month,
    closedAt: input.closedAt,
    baselines: input.baselines.map((baseline) => ({ ...baseline })),
    auditEntries: input.auditEntries.map((entry) => ({ ...entry })),
  };
}

export function resolveWineCumulativePurchaseAmount(realPurchaseAmount: number, baseline: WinePurchaseBaseline | undefined) {
  if (!Number.isFinite(realPurchaseAmount) || realPurchaseAmount < 0) throw new Error("真实累计进货金额必须是非负有限数字");
  return realPurchaseAmount + (baseline?.deletedAt ? 0 : baseline?.initialCumulativeAmount ?? 0);
}

/** 同一段系统启用前历史采购必须在供应商与酒款两个视角严格守恒。 */
export function reconcileWinePurchaseBaselineDimensions(baselines: readonly WinePurchaseBaseline[]) {
  const supplierInitialAmount = baselines
    .filter((baseline) => baseline.scope === "supplier" && !baseline.deletedAt)
    .reduce((sum, baseline) => sum + baseline.initialCumulativeAmount, 0);
  const productInitialAmount = baselines
    .filter((baseline) => baseline.scope === "product" && !baseline.deletedAt)
    .reduce((sum, baseline) => sum + baseline.initialCumulativeAmount, 0);
  const difference = supplierInitialAmount - productInitialAmount;
  return {
    supplierInitialAmount,
    productInitialAmount,
    difference,
    isBalanced: Math.abs(difference) < 0.000001,
  };
}

/** 月结前阻断未核对的双维度历史基线，避免把不平的历史金额归档为正式事实。 */
export function assertWinePurchaseBaselineDimensionsBalanced(baselines: readonly WinePurchaseBaseline[]) {
  const reconciliation = reconcileWinePurchaseBaselineDimensions(baselines);
  if (!reconciliation.isBalanced) {
    throw new Error(`供应商与酒款初始累计金额不一致，差额：${reconciliation.difference.toFixed(2)}`);
  }
  return reconciliation;
}
