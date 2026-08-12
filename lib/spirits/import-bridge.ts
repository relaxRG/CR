import type { SpiritItem, SpiritPurchaseOrderItem, SpiritPurchaseRecord } from "./types";

export type PendingSpiritPurchase = Omit<SpiritPurchaseRecord, "id" | "createdAt">;

const normalize = (value: string) => value
  .toLowerCase()
  .replace(/[（）()\[\]{}<>]/g, "")
  .replace(/[\s·・_\-/\\,，。:：]/g, "")
  .replace(/\d+(?:\.\d+)?(?:ml|cl|l|oz|瓶|箱|件|支|罐|袋|盒)/gi, "")
  .trim();

export function findImportedPurchaseItem(order: SpiritPurchaseOrderItem, items: SpiritItem[]): SpiritItem | undefined {
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
): { records: PendingSpiritPurchase[]; unmatched: SpiritPurchaseOrderItem[] } {
  const records: PendingSpiritPurchase[] = [];
  const unmatched: SpiritPurchaseOrderItem[] = [];

  for (const order of orders) {
    const item = findImportedPurchaseItem(order, items);
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

export function dominantPurchaseMonth(orders: readonly SpiritPurchaseOrderItem[], fallbackMonth: string): string {
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
