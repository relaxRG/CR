export const INVENTORY_WORKSPACE_METRICS = {
  segmentHeight: 40,
  actionHeight: 40,
  contextHeight: 32,
  segmentRadius: 12,
  horizontalGap: 8,
  horizontalPadding: 12,
  phoneHeaderHeight: 36,
  phoneRowHeight: 44,
  tabletHeaderHeight: 38,
  tabletRowHeight: 46,
  desktopHeaderHeight: 40,
  desktopRowHeight: 48,
} as const;

/**
 * 工作台页签只保留文字。图标属于操作而不是结构导航，会在十类库存/店铺工作台中制造无意义的视觉噪声。
 */
export function inventoryTabLabel(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+\s*/u, "");
}

/**
 * 当前工作台已由全局月份确定年份，台账只展示月日以节约固定列宽度。
 * 输入、导出和编辑仍一律保留 ISO 年月日，不能丢失原始日期精度。
 */
export function formatInventoryMonthDay(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[2]}-${match[3]}` : value;
}

/**
 * 表头本身就是排序和筛选入口；不要再追加重复的下拉箭头符号。
 */
export function tableHeaderAccessibilityLabel(label: string, hasAdjustment = false): string {
  return hasAdjustment ? `${label}，已设置排序或筛选，点击调整` : `排序和筛选${label}`;
}

export const INVENTORY_WORKSPACE_TEN = [
  "spirits",
  "wine",
  "fruit",
  "food",
  "beer",
  "ice",
  "glassware",
  "tableware",
  "daily",
  "equipment",
] as const;

export type InventoryWorkspaceKind = typeof INVENTORY_WORKSPACE_TEN[number];

export function isInventoryWorkspaceKind(value: string): value is InventoryWorkspaceKind {
  return (INVENTORY_WORKSPACE_TEN as readonly string[]).includes(value);
}
