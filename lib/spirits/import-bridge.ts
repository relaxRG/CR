import type { Bottle } from "@/lib/bottles/types";
import { resolveBottleForSupplierProductName } from "@/lib/bottles/supplier-channel-resolver";
import type { SpiritItem, SpiritPurchaseOrderItem, SpiritPurchaseRecord } from "./types";
import { normalizeSpiritSupplierAlias, resolveSpiritItemForSupplierName } from "./supplier-alias";

export type PendingSpiritPurchase = Omit<SpiritPurchaseRecord, "id" | "createdAt">;

const normalize = normalizeSpiritSupplierAlias;

export function findImportedPurchaseItem(order: SpiritPurchaseOrderItem, items: SpiritItem[], bottles: Bottle[] = []): SpiritItem | undefined {
  for (const name of [order.nameZh, order.nameEn, order.rawName]) {
    const bottleMatch = resolveBottleForSupplierProductName(bottles, order.supplier, name);
    if (bottleMatch) {
      const linkedItems = items.filter((item) => item.bottleId === bottleMatch.bottle.id);
      if (linkedItems.length === 1) return linkedItems[0];
      if (linkedItems.length > 1) return undefined;
    }
    const supplierMatch = resolveSpiritItemForSupplierName(items, order.supplier, name);
    if (supplierMatch) return supplierMatch.item;
  }

  const candidates = [order.nameZh, order.nameEn, order.rawName]
    .map(normalize)
    .filter((name) => name.length > 0);

  const exact = items.find((item) => {
    const names = [item.name, item.nameEn ?? ""].map(normalize);
    return candidates.some((candidate) => names.includes(candidate));
  });
  if (exact) return exact;

  const containing = items
    .map((item) => {
      const names = [item.name, item.nameEn ?? ""].map(normalize).filter(Boolean);
      const matchedLength = Math.max(
        0,
        ...candidates.flatMap((candidate) => names
          .filter((name) => name.length >= 3 && (candidate.includes(name) || name.includes(candidate)))
          .map((name) => Math.min(candidate.length, name.length))),
      );
      return { item, matchedLength };
    })
    .sort((a, b) => b.matchedLength - a.matchedLength)[0];

  return containing?.matchedLength >= 3 ? containing.item : undefined;
}

export function buildImportedPurchaseRecords(
  orders: SpiritPurchaseOrderItem[],
  items: SpiritItem[],
  fallbackMonth: string,
  source: PendingSpiritPurchase["source"] = "excel",
  bottles: Bottle[] = [],
): { records: PendingSpiritPurchase[]; unmatched: SpiritPurchaseOrderItem[] } {
  const records: PendingSpiritPurchase[] = [];
  const unmatched: SpiritPurchaseOrderItem[] = [];

  for (const order of orders) {
    const item = findImportedPurchaseItem(order, items, bottles);
    if (!item) unmatched.push(order);
    const month = /^\d{4}-\d{2}$/.test(order.date?.slice(0, 7) ?? "")
      ? order.date.slice(0, 7)
      : fallbackMonth;
    records.push({
      month,
      date: order.date,
      itemId: item?.id,
      rawName: order.rawName,
      unit: order.spec || item?.unit || "瓶",
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      amount: order.amount,
      supplier: order.supplier,
      group: item?.group,
      category: item?.category,
      source,
    });
  }

  return { records, unmatched };
}

export function dominantPurchaseMonth(orders: readonly { date: string }[], fallbackMonth: string): string {
  const counts = new Map<string, number>();
  const firstIndex = new Map<string, number>();
  orders.forEach((order, index) => {
    const month = /^\d{4}-\d{2}$/.test(order.date?.slice(0, 7) ?? "")
      ? order.date.slice(0, 7)
      : null;
    if (!month) return;
    counts.set(month, (counts.get(month) ?? 0) + 1);
    if (!firstIndex.has(month)) firstIndex.set(month, index);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (firstIndex.get(a[0]) ?? 0) - (firstIndex.get(b[0]) ?? 0))[0]?.[0]
    ?? fallbackMonth;
}

export function purchasesForMonth(
  existing: readonly SpiritPurchaseRecord[],
  pending: readonly PendingSpiritPurchase[],
  month: string,
): Array<SpiritPurchaseRecord | PendingSpiritPurchase> {
  return [...existing, ...pending].filter((purchase) => purchase.month === month);
}
