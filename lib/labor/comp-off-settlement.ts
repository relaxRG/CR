import type { CompOffBalanceEntry, ShiftEntry } from "./types";

export type CompOffSource = "overtime" | "balance" | "holiday";

export interface CompOffBalanceAllocation {
  entryId: string;
  days: number;
  source: Exclude<CompOffSource, "balance">;
  expiresMonth: string;
}

export interface CompOffBalancePlan {
  requestedDays: number;
  availableDays: number;
  allocatedDays: number;
  missingDays: number;
  allocations: CompOffBalanceAllocation[];
}

export const OVERTIME_COMP_OFF_STATUS = "ss_comp_off_overtime";
export const BALANCE_COMP_OFF_STATUS = "ss_comp_off_balance";
export const HOLIDAY_COMP_OFF_STATUS = "ss_comp_off_holiday";

export function getCompOffSource(statusId?: string): CompOffSource | null {
  if (statusId === OVERTIME_COMP_OFF_STATUS) return "overtime";
  if (statusId === BALANCE_COMP_OFF_STATUS) return "balance";
  if (statusId === HOLIDAY_COMP_OFF_STATUS) return "holiday";
  return null;
}

export function isCompOffStatus(statusId?: string): boolean {
  return getCompOffSource(statusId) !== null;
}

export function getCompOffDemandDays(shifts: ShiftEntry[], source: CompOffSource): number {
  return shifts.filter((shift) => getCompOffSource(shift.specialStatusId) === source).length;
}

function supportsSource(entry: CompOffBalanceEntry, source: CompOffSource): boolean {
  return source === "balance" || entry.source === source;
}

/**
 * 以最早到期优先（FEFO）方式计划调休余额消费。
 * 该函数不写入存储；调用方在确认整个月的排班和薪资草稿后一次性提交计划，
 * 从而避免重复生成薪资单或编辑排班时重复扣除余额。
 */
export function planCompOffBalanceConsumption(
  entries: CompOffBalanceEntry[],
  requestedDays: number,
  source: CompOffSource,
  currentMonth: string,
): CompOffBalancePlan {
  const candidates = entries
    .filter((entry) => entry.status === "available" && entry.expiresMonth >= currentMonth)
    .filter((entry) => supportsSource(entry, source))
    .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth) || a.createdAt.localeCompare(b.createdAt));

  const availableDays = candidates.reduce((total, entry) => total + entry.days, 0);
  let remaining = Math.max(0, requestedDays);
  const allocations: CompOffBalanceAllocation[] = [];

  for (const entry of candidates) {
    if (remaining <= 0) break;
    const days = Math.min(entry.days, remaining);
    allocations.push({ entryId: entry.id, days, source: entry.source, expiresMonth: entry.expiresMonth });
    remaining -= days;
  }

  return {
    requestedDays,
    availableDays,
    allocatedDays: Math.max(0, requestedDays - remaining),
    missingDays: remaining,
    allocations,
  };
}

/** 到期月仍可用；只有跨过到期月且未处理的余额才视为已过期。 */
export function isCompOffEntryExpired(entry: CompOffBalanceEntry, currentMonth: string): boolean {
  return entry.status === "available" && entry.expiresMonth < currentMonth;
}

/** 返回当前月需要询问“兑换现金或到期作废”的条目；仅限本月到期且尚未使用的余额。 */
export function getExpiringCompOffEntries(entries: CompOffBalanceEntry[], employeeId: string, currentMonth: string): CompOffBalanceEntry[] {
  return entries
    .filter((entry) => entry.employeeId === employeeId && entry.status === "available" && entry.expiresMonth === currentMonth)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 使用当前月真实加班结余校验“加班换休”。
 * 调休余额或节假日调休不会进入该计算，也绝不影响本月加班费。
 */
export function getOvertimeCompOffValidation(rawOvertimeHours: number, requestedCompOffHours: number) {
  const availableHours = Math.max(0, rawOvertimeHours);
  const missingHours = Math.max(0, requestedCompOffHours - availableHours);
  return {
    availableHours,
    requestedCompOffHours,
    appliedHours: Math.min(availableHours, requestedCompOffHours),
    missingHours,
    isValid: missingHours === 0,
  };
}
