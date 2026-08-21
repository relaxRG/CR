import type { SpiritItem, SpiritPurchaseRecord } from "@/lib/spirits/types";

/**
 * 当月进货表展示当前可维护的库存分类；无关联酒款时才回退到采购发生时快照。
 * 历史采购记录仍保留自身 category 字段，以支持无主档记录与归档审计。
 */
export function resolvePurchaseDisplayCategory(
  purchase: Pick<SpiritPurchaseRecord, "category">,
  item?: Pick<SpiritItem, "category"> | null,
) {
  return item?.category || purchase.category || "未分类";
}

/** 采购详情中选择分类时，同时将关联酒款与当前采购记录对齐到同一分类。 */
export function buildPurchaseCategorySelection(itemId: string, category: string) {
  return { itemId, category: category.trim() };
}
