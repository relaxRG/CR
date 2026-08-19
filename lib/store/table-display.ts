import { roundMoney } from "@/lib/finance/money";

/** 门店 Excel 台账的统一视觉尺度。 */
export const STORE_TABLE_METRICS = {
  /** 手机台账优先保证单行可扫读；平板和桌面由列宽扩张而不是无意义放大行高。 */
  headerHeight: 36,
  rowHeight: 44,
  groupHeight: 34,
  summaryHeaderHeight: 38,
  summaryRowHeight: 38,
  summaryTotalHeight: 40,
  nameFontSize: 13,
  bodyFontSize: 12,
  numericFontSize: 12.5,
} as const;

export type StoreTableViewport = "phone" | "tablet" | "desktop";

export function getStoreTableViewport(width: number): StoreTableViewport {
  if (width >= 1024) return "desktop";
  if (width >= 640) return "tablet";
  return "phone";
}

export type ResponsiveColumn = {
  key: string;
  width: number;
  flexWeight?: number;
};

/**
 * 在桌面宽度把剩余空间按列权重分配；手机和平板始终保留最小可读宽度并允许横向浏览。
 */
export function expandStoreTableColumns<Column extends ResponsiveColumn>(columns: Column[], availableWidth: number): Column[] {
  const baseWidth = columns.reduce((total, column) => total + column.width, 0);
  if (getStoreTableViewport(availableWidth) !== "desktop" || availableWidth <= baseWidth) return columns;
  const totalWeight = columns.reduce((total, column) => total + (column.flexWeight ?? 1), 0);
  const extra = availableWidth - baseWidth;
  return columns.map((column) => ({
    ...column,
    width: Math.round(column.width + extra * ((column.flexWeight ?? 1) / totalWeight)),
  }));
}

export function formatStoreQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export function formatStoreMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `¥${roundMoney(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatStorePercentage(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}%`;
}
