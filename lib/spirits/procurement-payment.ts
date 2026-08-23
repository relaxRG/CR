import type { SpiritPurchaseRecord } from "./types";

export type SpiritProcurementPaymentSource = "petty_cash" | "direct";

/**
 * 付款是独立于采购成本的事实。它只结清某些采购行的应付款，绝不可再次写入库存成本。
 * 一笔备用金可对多条采购行分摊；同一采购行也可以有多笔付款。
 */
export interface SpiritProcurementPaymentAllocation {
  id: string;
  purchaseId: string;
  source: SpiritProcurementPaymentSource;
  amount: number;
  paidAt: string;
  paymentMethod: string;
  /** source=petty_cash 时必须指向实际备用金记录，避免凭空声明已付。 */
  pettyCashRecordId?: string;
  notes?: string;
}

export type SpiritProcurementPaymentStatus = "unpaid" | "partial" | "paid" | "overpaid";

export interface SpiritPurchasePaymentSummary {
  purchaseId: string;
  purchaseAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: SpiritProcurementPaymentStatus;
  /** 网络采购未关联备用金付款时显示待关联，而不是伪造已付。 */
  requiresPettyLink: boolean;
}

export function validateSpiritProcurementPaymentAllocation(allocation: SpiritProcurementPaymentAllocation): string | null {
  if (!allocation.id || !allocation.purchaseId) return "缺少付款或采购记录标识";
  if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) return "付款金额必须大于 0";
  if (!allocation.paidAt || !allocation.paymentMethod.trim()) return "缺少付款日期或方式";
  if (allocation.source === "petty_cash" && !allocation.pettyCashRecordId) return "备用金付款必须关联实际备用金记录";
  if (allocation.source === "direct" && allocation.pettyCashRecordId) return "直接付款不得附带备用金记录";
  return null;
}

/** 同一采购行的付款总额只用于付款状态，不回写 purchase.amount 或台账成本。 */
export function summarizeSpiritPurchasePayment(
  purchase: Pick<SpiritPurchaseRecord, "id" | "amount" | "supplier">,
  allocations: readonly SpiritProcurementPaymentAllocation[],
  channelType: "supplier" | "online",
): SpiritPurchasePaymentSummary {
  const paidAmount = allocations
    .filter((allocation) => allocation.purchaseId === purchase.id)
    .reduce((total, allocation) => total + allocation.amount, 0);
  const remainingAmount = Math.max(0, purchase.amount - paidAmount);
  const status: SpiritProcurementPaymentStatus = paidAmount <= 0
    ? "unpaid"
    : paidAmount < purchase.amount
      ? "partial"
      : paidAmount === purchase.amount
        ? "paid"
        : "overpaid";
  const hasPettyPayment = allocations.some((allocation) => allocation.purchaseId === purchase.id && allocation.source === "petty_cash" && Boolean(allocation.pettyCashRecordId));
  return {
    purchaseId: purchase.id,
    purchaseAmount: purchase.amount,
    paidAmount,
    remainingAmount,
    status,
    requiresPettyLink: channelType === "online" && purchase.amount > 0 && !hasPettyPayment,
  };
}

/**
 * 付款分摊集合必须只引用当前存在的采购行，且每笔需合法。超付保留为显式状态，不能静默截断。
 */
export function validateSpiritProcurementPaymentLedger(
  purchases: readonly Pick<SpiritPurchaseRecord, "id">[],
  allocations: readonly SpiritProcurementPaymentAllocation[],
): string[] {
  const purchaseIds = new Set(purchases.map((purchase) => purchase.id));
  const errors: string[] = [];
  for (const allocation of allocations) {
    const error = validateSpiritProcurementPaymentAllocation(allocation);
    if (error) errors.push(`${allocation.id || "未知付款"}：${error}`);
    if (!purchaseIds.has(allocation.purchaseId)) errors.push(`${allocation.id || "未知付款"}：引用的采购记录不存在`);
  }
  return errors;
}
