import type { SpiritLedgerEntry } from "./types";

export function normalizeLegacySpiritLedger(entry: SpiritLedgerEntry): SpiritLedgerEntry {
  const expectedQty = Math.max(0, entry.openingQty + entry.purchaseQty - entry.closingQty);
  const legacyValue = Number.isFinite(entry.consumeQty) ? entry.consumeQty : 0;
  if (entry.consumeCost !== undefined) return entry;
  // 旧盘点导入曾把Excel“本期消耗成本”写进consumeQty。
  // 若数值不符合库存恒等式，保留为历史成本并用恒等式恢复瓶数。
  if (Math.abs(legacyValue - expectedQty) > 0.001) {
    return { ...entry, consumeQty: expectedQty, consumeCost: legacyValue };
  }
  return { ...entry, consumeCost: legacyValue * entry.closingUnitCost };
}
