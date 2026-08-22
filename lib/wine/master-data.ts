import {
  WineBottle,
  WineInventoryCategory,
  WineManualPurchase,
  WineMonthlySnapshot,
  WineSupplierProfile,
} from "./types";

const CATEGORY_COLORS = ["#64748B", "#2563EB", "#059669", "#D97706", "#7C3AED", "#DB2777"];

export interface WineMasterDataSources {
  bottles: WineBottle[];
  snapshots: WineMonthlySnapshot[];
  purchases: WineManualPurchase[];
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function uniqueNamedValues(values: string[]): string[] {
  const known = new Set<string>();
  return values.filter((value) => {
    const display = value.trim();
    const key = normalized(display);
    if (!key || known.has(key)) return false;
    known.add(key);
    return true;
  });
}

/**
 * 从已经存在的葡萄酒档案、月度库存快照及采购流水中提取可见主数据。
 * 仅补入缺失档案：用户已编辑的名称、别名、排序、颜色和归档状态均不覆盖；
 * 历史记录继续保留自己的文字快照，改名或归档不会改变已发生的采购事实。
 */
export function hydrateWineMasterData(
  existing: { suppliers: WineSupplierProfile[]; categories: WineInventoryCategory[] },
  sources: WineMasterDataSources,
  input: { now: string; nextId: () => string },
): { suppliers: WineSupplierProfile[]; categories: WineInventoryCategory[] } {
  const supplierNames = uniqueNamedValues([
    ...sources.bottles.map((bottle) => bottle.supplier),
    ...sources.snapshots.flatMap((snapshot) => [
      ...snapshot.items.map((item) => item.supplier),
      ...snapshot.purchaseOrders.map((purchase) => purchase.supplier),
    ]),
    ...sources.purchases.map((purchase) => purchase.supplier),
  ]);
  const categoryNames = uniqueNamedValues([
    ...sources.snapshots.flatMap((snapshot) => snapshot.items.map((item) => item.category ?? item.wineType)),
    ...sources.purchases.map((purchase) => purchase.category ?? ""),
  ]);

  const knownSuppliers = new Set(existing.suppliers.map((supplier) => normalized(supplier.name)));
  const knownCategories = new Set(existing.categories.map((category) => normalized(category.name)));
  const suppliers = [...existing.suppliers];
  const categories = [...existing.categories];

  supplierNames.forEach((name) => {
    const key = normalized(name);
    if (knownSuppliers.has(key)) return;
    suppliers.push({
      id: input.nextId(),
      name,
      aliases: [],
      sortOrder: suppliers.length,
      archived: false,
      createdAt: input.now,
      updatedAt: input.now,
    });
    knownSuppliers.add(key);
  });

  categoryNames.forEach((name) => {
    const key = normalized(name);
    if (knownCategories.has(key)) return;
    categories.push({
      id: input.nextId(),
      name,
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
      sortOrder: categories.length,
      archived: false,
      createdAt: input.now,
      updatedAt: input.now,
    });
    knownCategories.add(key);
  });

  return { suppliers, categories };
}

/** 仅活动档案用于录入选择；历史供应商和分类由其文本快照继续显示。 */
export function activeWineMasterData<T extends { archived: boolean; sortOrder: number }>(profiles: T[]): T[] {
  return profiles.filter((profile) => !profile.archived).sort((left, right) => left.sortOrder - right.sortOrder);
}
