import type { SpiritPurchaseRecord } from "./types";

export type SupplierPurchaseSortKey = "category" | "name" | "quantity" | "unitPrice" | "amount" | "group";
export type SupplierPurchaseSortDirection = "asc" | "desc";

export interface SupplierPurchaseTableFilters {
  nameQuery: string;
  nameKeys: string[];
  onlyUnmatchedNames: boolean;
  quantityMin: string;
  quantityMax: string;
  unitPriceMin: string;
  unitPriceMax: string;
  amountMin: string;
  amountMax: string;
  /** 当月进货表中的展示分类；多选时与其他列筛选取交集。 */
  categories: string[];
  onlyUnassignedCategory: boolean;
  groups: string[];
  onlyUnassignedGroup: boolean;
}

export interface SupplierPurchaseTableView {
  sort: { key: SupplierPurchaseSortKey; direction: SupplierPurchaseSortDirection } | null;
  filters: SupplierPurchaseTableFilters;
}

export const EMPTY_SUPPLIER_PURCHASE_FILTERS: SupplierPurchaseTableFilters = {
  nameQuery: "",
  nameKeys: [],
  onlyUnmatchedNames: false,
  quantityMin: "",
  quantityMax: "",
  unitPriceMin: "",
  unitPriceMax: "",
  amountMin: "",
  amountMax: "",
  categories: [],
  onlyUnassignedCategory: false,
  groups: [],
  onlyUnassignedGroup: false,
};

export const DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW: SupplierPurchaseTableView = {
  sort: null,
  filters: EMPTY_SUPPLIER_PURCHASE_FILTERS,
};

export interface SupplierPurchaseTableRow extends SpiritPurchaseRecord {
  /** 匹配酒款使用 itemId；未匹配行使用规范化原始名，切换语言后保持稳定。 */
  nameKey: string;
  /** 是否已关联到酒款档案，不能以中英文名是否缺失代替。 */
  isMatched: boolean;
  /** 同时包含中文、英文与原始Excel名，文本筛选不受显示语言影响。 */
  searchableName: string;
  displayName: string;
  /** 与库存管理一致的展示分类：已关联酒款优先，其次保留采购快照。 */
  displayCategory: string;
  /** 分类管理入口的唯一权威顺序；未分类固定排在所有已管理分类之后。 */
  categoryOrder: number;
  displayGroup: string;
}

export interface SupplierPurchaseNameOption {
  key: string;
  label: string;
  /** 聚合后的中英文及原始Excel名称，供面板跨语言搜索。 */
  searchableName: string;
  count: number;
  isMatched: boolean;
}

export function collectSupplierPurchaseNameOptions(rows: SupplierPurchaseTableRow[]): SupplierPurchaseNameOption[] {
  const options = new Map<string, SupplierPurchaseNameOption>();
  for (const row of rows) {
    const current = options.get(row.nameKey);
    if (current) {
      current.count += 1;
      current.searchableName = `${current.searchableName} ${row.searchableName}`;
    } else options.set(row.nameKey, { key: row.nameKey, label: row.displayName, searchableName: row.searchableName, count: 1, isMatched: row.isMatched });
  }
  return [...options.values()].sort((left, right) => left.label.localeCompare(right.label, "zh-Hans-CN"));
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
    filters.nameQuery.trim() || filters.nameKeys.length || filters.onlyUnmatchedNames || filters.quantityMin.trim() || filters.quantityMax.trim()
      || filters.unitPriceMin.trim() || filters.unitPriceMax.trim()
      || filters.amountMin.trim() || filters.amountMax.trim()
      || filters.categories.length || filters.onlyUnassignedCategory
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
    const category = row.displayCategory.trim();
    if (query && !row.searchableName.toLocaleLowerCase().includes(query)) return false;
    if (view.filters.nameKeys.length > 0 && !view.filters.nameKeys.includes(row.nameKey)) return false;
    if (view.filters.onlyUnmatchedNames && row.isMatched) return false;
    if (!withinRange(row.quantity, view.filters.quantityMin, view.filters.quantityMax)) return false;
    if (!withinRange(row.unitPrice, view.filters.unitPriceMin, view.filters.unitPriceMax)) return false;
    if (!withinRange(row.amount, view.filters.amountMin, view.filters.amountMax)) return false;
    if (view.filters.onlyUnassignedCategory && category && category !== "未分类") return false;
    if (view.filters.categories.length > 0 && !view.filters.categories.includes(category)) return false;
    if (view.filters.onlyUnassignedGroup && group) return false;
    if (view.filters.groups.length > 0 && !view.filters.groups.includes(group)) return false;
    return true;
  });

  if (!view.sort) return filtered;
  const multiplier = view.sort.direction === "asc" ? 1 : -1;
  return [...filtered].sort((left, right) => {
    const key = view.sort!.key;
    if (key === "name") return multiplier * left.displayName.localeCompare(right.displayName, "zh-Hans-CN");
    if (key === "category") {
      const byManagedOrder = left.categoryOrder - right.categoryOrder;
      return multiplier * (byManagedOrder || left.displayCategory.localeCompare(right.displayCategory, "zh-Hans-CN"));
    }
    if (key === "group") return multiplier * left.displayGroup.localeCompare(right.displayGroup, "zh-Hans-CN");
    return multiplier * (left[key] - right[key]);
  });
}
