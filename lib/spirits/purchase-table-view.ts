import type { SpiritPurchaseRecord } from "./types";

export type SupplierPurchaseSortKey = "name" | "quantity" | "unitPrice" | "amount" | "group";
export type SupplierPurchaseSortDirection = "asc" | "desc";

export interface SupplierPurchaseTableFilters {
  nameQuery: string;
  quantityMin: string;
  quantityMax: string;
  unitPriceMin: string;
  unitPriceMax: string;
  amountMin: string;
  amountMax: string;
  groups: string[];
  onlyUnassignedGroup: boolean;
}

export interface SupplierPurchaseTableView {
  sort: { key: SupplierPurchaseSortKey; direction: SupplierPurchaseSortDirection } | null;
  filters: SupplierPurchaseTableFilters;
}

export const EMPTY_SUPPLIER_PURCHASE_FILTERS: SupplierPurchaseTableFilters = {
  nameQuery: "",
  quantityMin: "",
  quantityMax: "",
  unitPriceMin: "",
  unitPriceMax: "",
  amountMin: "",
  amountMax: "",
  groups: [],
  onlyUnassignedGroup: false,
};

export const DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW: SupplierPurchaseTableView = {
  sort: null,
  filters: EMPTY_SUPPLIER_PURCHASE_FILTERS,
};

export interface SupplierPurchaseTableRow extends SpiritPurchaseRecord {
  displayName: string;
  displayGroup: string;
}

function withinRange(value: number, min: string, max: string) {
  const parsedMin = min.trim() === "" ? null : Number(min);
  const parsedMax = max.trim() === "" ? null : Number(max);
  if (parsedMin !== null && (!Number.isFinite(parsedMin) || value < parsedMin)) return false;
  if (parsedMax !== null && (!Number.isFinite(parsedMax) || value > parsedMax)) return false;
  return true;
}

export function hasSupplierPurchaseTableFilters(filters: SupplierPurchaseTableFilters) {
  return Boolean(
    filters.nameQuery.trim() || filters.quantityMin.trim() || filters.quantityMax.trim()
      || filters.unitPriceMin.trim() || filters.unitPriceMax.trim()
      || filters.amountMin.trim() || filters.amountMax.trim()
      || filters.groups.length || filters.onlyUnassignedGroup,
  );
}

export function applySupplierPurchaseTableView(
  rows: SupplierPurchaseTableRow[],
  view: SupplierPurchaseTableView,
) {
  const query = view.filters.nameQuery.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    const group = row.displayGroup.trim();
    if (query && !row.displayName.toLocaleLowerCase().includes(query)) return false;
    if (!withinRange(row.quantity, view.filters.quantityMin, view.filters.quantityMax)) return false;
    if (!withinRange(row.unitPrice, view.filters.unitPriceMin, view.filters.unitPriceMax)) return false;
    if (!withinRange(row.amount, view.filters.amountMin, view.filters.amountMax)) return false;
    if (view.filters.onlyUnassignedGroup && group) return false;
    if (view.filters.groups.length > 0 && !view.filters.groups.includes(group)) return false;
    return true;
  });

  if (!view.sort) return filtered;
  const multiplier = view.sort.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => {
    const key = view.sort!.key;
    if (key === "name") return multiplier * left.displayName.localeCompare(right.displayName, "zh-Hans-CN");
    if (key === "group") return multiplier * left.displayGroup.localeCompare(right.displayGroup, "zh-Hans-CN");
    return multiplier * (left[key] - right[key]);
  });
}
