export const MEITUAN_APP_HISTORY_MONTHS = 12;
/** 美团官方日账单接口公开的单次日期跨度上限。 */
export const MEITUAN_OFFICIAL_MAX_QUERY_DAYS = 7;
/** 美团官方日账单接口公开的可查询历史窗口上限。 */
export const MEITUAN_OFFICIAL_LOOKBACK_DAYS = 90;

export interface MeituanBillFetchBatch {
  source: "meituan-openapi" | "file-import";
  month: string;
  startDate: string;
  endDate: string;
  reason?: "OUTSIDE_OFFICIAL_LOOKBACK";
}

function asUtcDay(value: string | Date): Date {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`无效日期：${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function dateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function firstDayOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/**
 * Cocktail R 保留最近 12 个自然月；其中超过美团官方 90 天查询窗口的日期不会伪装成 API 可同步，
 * 而是明确要求从美团管家导出文件导入。
 */
export function buildMeituanAnnualImportPlan(input: {
  today: string | Date;
  historyMonths?: number;
  officialLookbackDays?: number;
  maxQueryDays?: number;
}): MeituanBillFetchBatch[] {
  const today = asUtcDay(input.today);
  const historyMonths = input.historyMonths ?? MEITUAN_APP_HISTORY_MONTHS;
  const officialLookbackDays = input.officialLookbackDays ?? MEITUAN_OFFICIAL_LOOKBACK_DAYS;
  const maxQueryDays = input.maxQueryDays ?? MEITUAN_OFFICIAL_MAX_QUERY_DAYS;
  if (!Number.isInteger(historyMonths) || historyMonths < 1) throw new Error("保留月份必须为正整数");
  if (!Number.isInteger(maxQueryDays) || maxQueryDays < 1) throw new Error("单次查询天数必须为正整数");

  const startMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - historyMonths + 1, 1));
  const officialStart = addDays(today, -officialLookbackDays + 1);
  const batches: MeituanBillFetchBatch[] = [];

  for (let cursor = startMonth; cursor <= today; ) {
    const month = monthString(cursor);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const periodEnd = monthEnd < today ? monthEnd : today;
    let batchStart = cursor;
    while (batchStart <= periodEnd) {
      const unrestrictedEnd = addDays(batchStart, maxQueryDays - 1);
      const batchEnd = unrestrictedEnd < periodEnd ? unrestrictedEnd : periodEnd;
      if (batchStart < officialStart) {
        // 将完全位于官方窗口外的连续区间折叠为一个人工文件导入批次，减少用户操作。
        const fileEnd = batchEnd < addDays(officialStart, -1) ? batchEnd : addDays(officialStart, -1);
        batches.push({
          source: "file-import",
          month,
          startDate: dateString(batchStart),
          endDate: dateString(fileEnd),
          reason: "OUTSIDE_OFFICIAL_LOOKBACK",
        });
        batchStart = addDays(fileEnd, 1);
      } else {
        batches.push({ source: "meituan-openapi", month, startDate: dateString(batchStart), endDate: dateString(batchEnd) });
        batchStart = addDays(batchEnd, 1);
      }
    }
    cursor = firstDayOfMonth(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)));
  }

  return batches;
}

export function isMeituanMonthWithinAppHistory(month: string, today: string | Date, historyMonths = MEITUAN_APP_HISTORY_MONTHS): boolean {
  const normalized = String(month).match(/^(\d{4})-(\d{2})$/);
  if (!normalized) return false;
  const target = new Date(Date.UTC(Number(normalized[1]), Number(normalized[2]) - 1, 1));
  const todayDate = asUtcDay(today);
  const earliest = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() - historyMonths + 1, 1));
  return target >= earliest && target <= firstDayOfMonth(todayDate);
}
