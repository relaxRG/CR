import type { WineManualPurchase } from "./types";

/**
 * 仅用于当月真实采购流水的投影完整性检查。
 * 供应商和酒款的独立历史期初累计不参与此核对。
 */
export function reconcileWineMonthlyPurchaseProjection(
  purchases: readonly WineManualPurchase[],
  month: string,
) {
  const monthPurchases = purchases.filter((purchase) => purchase.date.slice(0, 7) === month);
  const supplierAmount = monthPurchases.reduce((sum, purchase) => sum + purchase.amount, 0);
  const linkedProductAmount = monthPurchases
    .filter((purchase) => purchase.bottleId)
    .reduce((sum, purchase) => sum + purchase.amount, 0);
  const unresolved = monthPurchases
    .filter((purchase) => !purchase.bottleId)
    .map((purchase) => ({ id: purchase.id, supplier: purchase.supplier, productName: purchase.productName, amount: purchase.amount }));
  return {
    month,
    supplierAmount,
    linkedProductAmount,
    unresolvedAmount: unresolved.reduce((sum, purchase) => sum + purchase.amount, 0),
    unresolved,
    isFullyLinked: unresolved.length === 0,
  };
}
