export type LedgerSortKey =
  | "name" | "referencePrice" | "openingQty" | "openingUnitCost" | "openingCost"
  | "purchaseQty" | "purchaseCost" | "closingQty" | "closingUnitCost" | "closingCost"
  | "consumeQty" | "consumeCost" | "group";

export type LedgerSortDirection = "asc" | "desc";

export interface LedgerTableFilters {
  nameQuery: string;
  nameKeys: string[];
  groups: string[];
  onlyUnassignedGroup: boolean;
  ranges: Partial<Record<Exclude<LedgerSortKey, "name" | "group">, { min: string; max: string }>>;
}

export interface LedgerTableView {
  sort: { key: LedgerSortKey; direction: LedgerSortDirection } | null;
  filters: LedgerTableFilters;
}

export interface LedgerNameOption {
  key: string;
  label: string;
  searchableName: string;
  count: number;
}

export interface LedgerTableRow {
  id: string;
  nameKey: string;
  searchableName: string;
  displayName: string;
  group: string;
  referencePrice: number;
  openingQty: number;
  openingUnitCost: number;
  openingCost: number;
  purchaseQty: number;
  purchaseCost: number;
  closingQty: number;
  closingUnitCost: number;
  closingCost: number;
  consumeQty: number;
  consumeCost: number;
}

export const EMPTY_LEDGER_TABLE_FILTERS: LedgerTableFilters = {
  nameQuery: "",
  nameKeys: [],
  groups: [],
  onlyUnassignedGroup: false,
  ranges: {},
};

export const DEFAULT_LEDGER_TABLE_VIEW: LedgerTableView = {
  sort: null,
  filters: EMPTY_LEDGER_TABLE_FILTERS,
};

export function collectLedgerNameOptions(rows: LedgerTableRow[]): LedgerNameOption[] {
  const options = new Map<string, LedgerNameOption>();
  for (const row of rows) {
    const current = options.get(row.nameKey);
    if (current) {
      current.count += 1;
      current.searchableName = `${current.searchableName} ${row.searchableName}`;
    } else options.set(row.nameKey, { key: row.nameKey, label: row.displayName, searchableName: row.searchableName, count: 1 });
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
}

const NUMERIC_KEYS: Exclude<LedgerSortKey, "name" | "group">[] = [
  "referencePrice", "openingQty", "openingUnitCost", "openingCost", "purchaseQty", "purchaseCost",
  "closingQty", "closingUnitCost", "closingCost", "consumeQty", "consumeCost",
];

function inRange(value: number, range?: { min: string; max: string }) {
  if (!range) return true;
  const min = range.min.trim() === "" ? null : Number(range.min);
  const max = range.max.trim() === "" ? null : Number(range.max);
  if (min !== null && (!Number.isFinite(min) || value < min)) return false;
  if (max !== null && (!Number.isFinite(max) || value > max)) return false;
  return true;
}

export function hasLedgerTableFilters(filters: LedgerTableFilters) {
  return Boolean(
    filters.nameQuery.trim() || filters.nameKeys.length || filters.groups.length || filters.onlyUnassignedGroup
    || Object.values(filters.ranges).some((range) => range?.min.trim() || range?.max.trim()),
  );
}

export function applyLedgerTableView(rows: LedgerTableRow[], view: LedgerTableView) {
  const query = view.filters.nameQuery.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    if (query && !row.searchableName.toLocaleLowerCase().includes(query)) return false;
    if (view.filters.nameKeys.length && !view.filters.nameKeys.includes(row.nameKey)) return false;
    if (view.filters.onlyUnassignedGroup && row.group.trim()) return false;
    if (view.filters.groups.length && !view.filters.groups.includes(row.group)) return false;
    return NUMERIC_KEYS.every((key) => inRange(row[key], view.filters.ranges[key]));
  });

  if (!view.sort) return filtered;
  const multiplier = view.sort.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => {
    const key = view.sort!.key;
    if (key === "name") return multiplier * left.displayName.localeCompare(right.displayName, "zh-Hans-CN");
    if (key === "group") return multiplier * left.group.localeCompare(right.group, "zh-Hans-CN");
    return multiplier * (left[key] - right[key]);
  });
}

export function calculateLedgerTableTotals(rows: LedgerTableRow[]) {
  return rows.reduce((totals, row) => ({
    openingQty: totals.openingQty + row.openingQty,
    openingCost: totals.openingCost + row.openingCost,
    purchaseQty: totals.purchaseQty + row.purchaseQty,
    purchaseCost: totals.purchaseCost + row.purchaseCost,
    closingQty: totals.closingQty + row.closingQty,
    closingCost: totals.closingCost + row.closingCost,
    consumeQty: totals.consumeQty + row.consumeQty,
    consumeCost: totals.consumeCost + row.consumeCost,
  }), { openingQty: 0, openingCost: 0, purchaseQty: 0, purchaseCost: 0, closingQty: 0, closingCost: 0, consumeQty: 0, consumeCost: 0 });
}

export const LEDGER_TABLE_COLUMNS: LedgerSortKey[] = [
  "name", "referencePrice", "openingQty", "openingUnitCost", "openingCost", "purchaseQty", "purchaseCost",
  "closingQty", "closingUnitCost", "closingCost", "consumeQty", "consumeCost", "group",
];
