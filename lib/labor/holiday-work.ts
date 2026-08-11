import type { HolidayConfig, ShiftEntry, SpecialStatus } from "./types";

export interface HolidayWorkInfo {
  /** 与 PaySlip.holidayBonusAllocation 兼容的稳定 key 片段。 */
  allocationKeyPart: string;
  name: string;
  multiplier: number;
}

/**
 * 判断一条排班是否产生“节假日上班拿钱/换休”决策。
 *
 * 规则：必须实际工作（普通班次有正工时，或特殊状态标记 countAsAttendance）；当节假日
 * 配置存在时其 multiplier 优先于特殊状态的默认倍率；已有节日特殊状态仍保留原有 key，
 * 从而不破坏历史薪资单的换休选择。
 */
export function getHolidayWorkInfo(
  shift: ShiftEntry,
  specialStatus: SpecialStatus | undefined,
  holidayConfig: HolidayConfig | null,
): HolidayWorkInfo | null {
  const isWorking = specialStatus
    ? specialStatus.countAsAttendance
    : typeof shift.hoursValue === "number" && shift.hoursValue > 0;
  if (!isWorking) return null;

  const multiplier = holidayConfig?.multiplier
    ?? (specialStatus?.isHoliday ? specialStatus.salaryMultiplier : 1);
  if (multiplier <= 1) return null;

  return {
    allocationKeyPart: specialStatus?.isHoliday
      ? specialStatus.id
      : `holiday_${holidayConfig?.id ?? "configured"}`,
    name: holidayConfig?.name ?? specialStatus?.name ?? "节假日上班",
    multiplier,
  };
}

export function getHolidayAllocationKey(employeeId: string, date: string, allocationKeyPart: string): string {
  return `${employeeId}_${date}_${allocationKeyPart}`;
}
