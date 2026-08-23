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

/**
 * Excel 型库存表格的三端文字与行高令牌。
 *
 * 这不是把所有端强行放大为同一字号：iPhone 优先触控与单行可扫读，
 * iPad 和 Mac 在可用宽度增加时提升阅读舒适度。字体倍率变大时只增加
 * 文字和容器的最小高度；业务组件必须通过减少列、换行或详情入口适配，
 * 不得使用缩字或隐藏关键内容修复溢出。
 */
export interface StoreTableTypography {
  viewport: StoreTableViewport;
  nameFontSize: number;
  bodyFontSize: number;
  numericFontSize: number;
  headerFontSize: number;
  headerHeight: number;
  rowHeight: number;
  groupHeight: number;
}

export function resolveStoreTableTypography(width: number, fontScale = 1): StoreTableTypography {
  const viewport = getStoreTableViewport(width);
  const base = viewport === "phone"
    ? { name: 14, body: 13, numeric: 13, header: 13, headerHeight: 40, rowHeight: 48, groupHeight: 36 }
    : viewport === "tablet"
      ? { name: 15, body: 14, numeric: 14, header: 14, headerHeight: 42, rowHeight: 50, groupHeight: 38 }
      : { name: 15, body: 14, numeric: 14, header: 14, headerHeight: 44, rowHeight: 52, groupHeight: 40 };
  // 限制的是表格基础密度对辅助字体的加成，不是文字本身的可读性下限。
  // 超过该范围时由外层响应式布局改为更少的并列信息，避免断层和错位。
  const readableScale = Math.max(1, Math.min(Number.isFinite(fontScale) ? fontScale : 1, 1.35));
  const scaleText = (value: number) => Math.round(value * readableScale * 10) / 10;
  const fitHeight = (minimum: number, textSize: number, verticalPadding: number) => Math.max(minimum, Math.ceil(textSize * 1.45 + verticalPadding));
  const bodyFontSize = scaleText(base.body);
  const headerFontSize = scaleText(base.header);
  return {
    viewport,
    nameFontSize: scaleText(base.name),
    bodyFontSize,
    numericFontSize: scaleText(base.numeric),
    headerFontSize,
    headerHeight: fitHeight(base.headerHeight, headerFontSize, 18),
    rowHeight: fitHeight(base.rowHeight, bodyFontSize, 20),
    groupHeight: fitHeight(base.groupHeight, bodyFontSize, 14),
  };
}

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
