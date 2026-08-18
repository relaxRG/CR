import { WineInventoryItem, WineManualPurchase } from "./types";

export type WineLedgerSortKey =
  | "category"
  | "name"
  | "openingQty"
  | "openingUnitCost"
  | "openingCost"
  | "purchaseQty"
  | "purchaseCost"
  | "consumeQty"
  | "consumeCost"
  | "closingQty"
  | "closingUnitCost"
  | "closingCost";

export type WinePurchaseSortKey = "date" | "supplier" | "name" | "quantity" | "unitPrice" | "amount";
export type SortDirection = "asc" | "desc";

export interface SortState<Key extends string> {
  key: Key;
  direction: SortDirection;
}

const WINE_TYPE_ORDER = [
  "red", "white", "rose", "sparkling", "sweet", "fortified", "natural", "other",
];

function normalized(value: string | null | undefined): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function wineTypeRank(value: string): number {
  const key = normalized(value);
  const found = WINE_TYPE_ORDER.findIndex((candidate) => key.includes(candidate));
  return found < 0 ? WINE_TYPE_ORDER.length : found;
}

export function compareWineTypes(left: string, right: string): number {
  const rankDelta = wineTypeRank(left) - wineTypeRank(right);
  return rankDelta || left.localeCompare(right, "zh-Hans-CN");
}

export function toggleSort<Key extends string>(
  current: SortState<Key>,
  key: Key,
): SortState<Key> {
  return current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: key === "category" || key === "name" || key === "date" ? "asc" : "desc" };
}

function ledgerValue(item: WineInventoryItem, key: WineLedgerSortKey): number | string {
  switch (key) {
    case "category": return item.wineType || "其他";
    case "name": return item.name;
    case "openingQty": return item.initQty;
    case "openingUnitCost": return item.initUnitCost;
    case "openingCost": return item.initCost;
    case "purchaseQty": return item.purchaseQty;
    case "purchaseCost": return item.purchaseCost;
    case "consumeQty": return item.consumeBottles;
    case "consumeCost": return item.consumeQty;
    case "closingQty": return item.actualEndQty ?? item.endQty;
    case "closingUnitCost": return item.unitCost;
    case "closingCost": return (item.actualEndQty ?? item.endQty) * item.unitCost;
  }
}

export function applyWineLedgerView(
  items: WineInventoryItem[],
  query: string,
  supplier: string | null,
  type: string | null,
  sort: SortState<WineLedgerSortKey>,
): WineInventoryItem[] {
  const normalizedQuery = normalized(query);
  const filtered = items.filter((item) => {
    if (supplier && item.supplier !== supplier) return false;
    if (type && item.wineType !== type) return false;
    if (!normalizedQuery) return true;
    return [item.name, item.supplier, item.wineType].some((value) => normalized(value).includes(normalizedQuery));
  });

  const multiplier = sort.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => {
    if (sort.key === "category") return multiplier * compareWineTypes(left.wineType || "其他", right.wineType || "其他");
    const leftValue = ledgerValue(left, sort.key);
    const rightValue = ledgerValue(right, sort.key);
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return multiplier * leftValue.localeCompare(rightValue, "zh-Hans-CN");
    }
    return multiplier * (Number(leftValue) - Number(rightValue));
  });
}

function purchaseValue(item: WineManualPurchase, key: WinePurchaseSortKey): number | string {
  switch (key) {
    case "date": return item.date;
    case "supplier": return item.supplier;
    case "name": return item.productName;
    case "quantity": return item.quantity;
    case "unitPrice": return item.unitPrice;
    case "amount": return item.amount;
  }
}

export function applyWinePurchaseView(
  purchases: WineManualPurchase[],
  query: string,
  supplier: string | null,
  sort: SortState<WinePurchaseSortKey>,
): WineManualPurchase[] {
  const normalizedQuery = normalized(query);
  const filtered = purchases.filter((purchase) => {
    if (supplier && purchase.supplier !== supplier) return false;
    if (!normalizedQuery) return true;
    return [purchase.productName, purchase.supplier, purchase.date, purchase.notes]
      .some((value) => normalized(value).includes(normalizedQuery));
  });
  const multiplier = sort.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => {
    const leftValue = purchaseValue(left, sort.key);
    const rightValue = purchaseValue(right, sort.key);
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return multiplier * leftValue.localeCompare(rightValue, "zh-Hans-CN");
    }
    return multiplier * (Number(leftValue) - Number(rightValue));
  });
}

export function collectWineTypes(items: WineInventoryItem[]): string[] {
  return Array.from(new Set(items.map((item) => item.wineType.trim()).filter(Boolean))).sort(compareWineTypes);
}

export function getWineSupplierNames(
  items: WineInventoryItem[],
  purchases: WineManualPurchase[],
  bottleSuppliers: string[],
): string[] {
  return Array.from(new Set([
    ...items.map((item) => item.supplier),
    ...purchases.map((purchase) => purchase.supplier),
    ...bottleSuppliers,
  ].map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}
