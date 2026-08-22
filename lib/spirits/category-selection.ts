import type { SpiritItem, SpiritPurchaseRecord } from "@/lib/spirits/types";

export interface AtomicCategorySelectionResult {
  items: SpiritItem[];
  purchases: SpiritPurchaseRecord[];
}

/**
 * 采购详情快速选择分类时的唯一状态转换：库存主档与当前采购行必须同步更新。
 * 没有采购行 ID 的库存管理场景只更新酒款主档，不会触碰历史采购快照。
 */
export function applyAtomicSpiritCategorySelection(
  items: SpiritItem[],
  purchases: SpiritPurchaseRecord[],
  itemId: string,
  category: string,
  purchaseId?: string,
  updatedAt = new Date().toISOString(),
): AtomicCategorySelectionResult {
  const normalizedCategory = category.trim();
  return {
    items: items.map((item) => item.id === itemId
      ? { ...item, category: normalizedCategory, categorySource: "manual", updatedAt }
      : item),
    purchases: purchaseId
      ? purchases.map((purchase) => purchase.id === purchaseId
        ? { ...purchase, itemId, category: normalizedCategory }
        : purchase)
      : purchases,
  };
}

/**
 * 批量采购分类操作的唯一状态转换。仅更新所选采购行及其已关联的库存酒款；
 * 无关联酒款的采购保留为独立历史记录，不能凭空创建库存关联。
 */
export function applyAtomicSpiritBatchCategorySelection(
  items: SpiritItem[],
  purchases: SpiritPurchaseRecord[],
  purchaseIds: readonly string[],
  category: string,
  updatedAt = new Date().toISOString(),
): AtomicCategorySelectionResult {
  const selectedIds = new Set(purchaseIds);
  const normalizedCategory = category.trim();
  const relatedItemIds = new Set(
    purchases
      .filter((purchase) => selectedIds.has(purchase.id) && purchase.itemId)
      .map((purchase) => purchase.itemId!),
  );

  return {
    items: items.map((item) => relatedItemIds.has(item.id)
      ? { ...item, category: normalizedCategory, categorySource: "manual", updatedAt }
      : item),
    purchases: purchases.map((purchase) => selectedIds.has(purchase.id)
      ? { ...purchase, category: normalizedCategory }
      : purchase),
  };
}
