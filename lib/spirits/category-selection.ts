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
