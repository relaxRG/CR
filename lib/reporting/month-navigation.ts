import {
  clampInventoryMonth,
  deriveInventoryMonthBounds,
  normalizeInventoryMonth,
  type InventoryMonth as ReportMonth,
  type InventoryMonthBounds as ReportMonthBounds,
} from "@/lib/inventory-core/month-browser";

export type { ReportMonth, ReportMonthBounds };

/**
 * 将总月报、经营分析、账户及其支撑流水的原始月份统一转换为受限业务月份边界。
 * 接受 YYYY-MM、YYYY/MM、YYYY-MM-DD 与 YYYY年M月；最早/最晚业务月各留一个月缓冲。
 */
export function deriveReportMonthBounds(rawMonths: Array<string | null | undefined>): ReportMonthBounds {
  return deriveInventoryMonthBounds(rawMonths.map((month) => month?.replaceAll("/", "-") ?? month));
}

export function normalizeReportMonth(raw?: string | null): ReportMonth | null {
  return normalizeInventoryMonth(raw?.replaceAll("/", "-") ?? raw);
}

export function clampReportMonth(month: string | null | undefined, bounds: ReportMonthBounds): ReportMonth {
  return clampInventoryMonth(normalizeReportMonth(month) ?? month, bounds);
}

export function reportMonthHasData(rawMonths: Array<string | null | undefined>, month: ReportMonth): boolean {
  return rawMonths.some((candidate) => normalizeReportMonth(candidate) === month);
}
