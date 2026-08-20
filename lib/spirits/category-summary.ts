import type { SpiritItem, SpiritLedgerEntry } from "./types";
import { multiplyMoney, sumMoney } from "@/lib/finance/money";

/**
 * 烈酒分类月度汇总。
 * 数量字段继续服务库存与盘点；成本字段是总结、占比和导出的唯一金额事实来源。
 */
export interface SpiritCategorySummary {
  openingQty: number;
  purchaseQty: number;
  consumeQty: number;
  closingQty: number;
  openingCost: number;
  purchaseCost: number;
  consumeCost: number;
  closingCost: number;
}

function emptySummary(): SpiritCategorySummary {
  return {
    openingQty: 0,
    purchaseQty: 0,
    consumeQty: 0,
    closingQty: 0,
    openingCost: 0,
    purchaseCost: 0,
    consumeCost: 0,
    closingCost: 0,
  };
}

export function summarizeSpiritLedgerByCategory(
  items: readonly SpiritItem[],
  ledger: readonly SpiritLedgerEntry[],
): Record<string, SpiritCategorySummary> {
  const itemCategoryById = new Map(items.map((item) => [item.id, item.category]));
  const result: Record<string, SpiritCategorySummary> = {};

  for (const entry of ledger) {
    const category = itemCategoryById.get(entry.itemId);
    if (!category) continue;
    const summary = result[category] ?? (result[category] = emptySummary());
    summary.openingQty += entry.openingQty;
    summary.purchaseQty += entry.purchaseQty;
    summary.consumeQty += entry.consumeQty;
    summary.closingQty += entry.closingQty;
    summary.openingCost = sumMoney([summary.openingCost, multiplyMoney(entry.openingQty, entry.openingUnitCost)]);
    summary.purchaseCost = sumMoney([summary.purchaseCost, entry.purchaseCost]);
    summary.consumeCost = sumMoney([summary.consumeCost, multiplyMoney(entry.consumeQty, entry.closingUnitCost)]);
    summary.closingCost = sumMoney([summary.closingCost, entry.closingCost]);
  }

  return result;
}

export function sumSpiritCategoryCost(
  summaries: Record<string, SpiritCategorySummary>,
  field: "openingCost" | "purchaseCost" | "consumeCost" | "closingCost",
): number {
  return sumMoney(Object.values(summaries).map((summary) => summary[field]));
}
