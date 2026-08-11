/**
 * 排班写入守卫。
 *
 * 日历视图可以渲染相邻月日期，因此所有写操作必须按 `YYYY-MM-DD` 所属月份检查，
 * 绝不能只根据用户当前浏览的月份授权。
 */
export function monthFromScheduleDate(date: string): string {
  return date.slice(0, 7);
}

export function getNonWritableScheduleMonths(
  dates: readonly string[],
  isMonthWritable: (month: string) => boolean,
): string[] {
  return [...new Set(dates.map(monthFromScheduleDate))]
    .filter((month) => !isMonthWritable(month))
    .sort();
}

export function canWriteScheduleDates(
  dates: readonly string[],
  isMonthWritable: (month: string) => boolean,
): boolean {
  return getNonWritableScheduleMonths(dates, isMonthWritable).length === 0;
}
