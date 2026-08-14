export type ManagedInventoryCategory = {
  id: string;
  name: string;
  builtin: boolean;
  order: number;
};

export function moveInventoryCategory(
  categories: ManagedInventoryCategory[],
  id: string,
  direction: "up" | "down",
) {
  const ordered = [...categories].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name, "zh-Hans-CN"));
  const index = ordered.findIndex((category) => category.id === id);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return [] as Array<{ id: string; order: number }>;
  return [
    { id: ordered[index].id, order: ordered[targetIndex].order },
    { id: ordered[targetIndex].id, order: ordered[index].order },
  ];
}

export function canDeleteInventoryCategory(category: ManagedInventoryCategory, itemCount: number) {
  return !category.builtin && itemCount === 0;
}

export function requiresCategoryContentHandling(category: ManagedInventoryCategory, itemCount: number) {
  return !category.builtin && itemCount > 0;
}

export function normalizeCategoryMigrationTarget(targetCategory: string) {
  return targetCategory.trim(); // 空字符串表示系统“未分类”兜底状态。
}
