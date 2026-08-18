/**
 * 将任意月报来源的月份文本归一为 YYYY-MM。
 * 仅接受真实自然月，避免 2026/07、2026-7 与 2026-07 被误判为不同月份。
 */
export function normalizeMonthlyReportMonth(value: string): string {
  const match = String(value ?? "").match(/(\d{4})[^\d]?(\d{1,2})/);
  if (!match) return "";
  const month = Number(match[2]);
  return Number.isInteger(month) && month >= 1 && month <= 12
    ? `${match[1]}-${String(month).padStart(2, "0")}`
    : "";
}

export interface MonthlyReportIdentity {
  rawMonth?: string;
  monthLabel?: string;
}

/**
 * 用新确认导入的月报替换同一业务月份的旧快照。
 * 无法识别月份的历史数据不会被误删，交由上层校验并拒绝归档。
 */
export function replaceMonthlyReportForBusinessMonth<T extends MonthlyReportIdentity>(
  current: T[],
  incoming: T,
): T[] {
  const incomingMonth = normalizeMonthlyReportMonth(incoming.rawMonth || incoming.monthLabel || "");
  if (!incomingMonth) return [incoming, ...current];
  return [
    incoming,
    ...current.filter((item) => normalizeMonthlyReportMonth(item.rawMonth || item.monthLabel || "") !== incomingMonth),
  ];
}
