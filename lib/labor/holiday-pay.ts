import type { MonthlyAttendance, PaySlip } from "./types";

/**
 * 计算已选择“换休”而不应现金支付的节假日补偿。
 *
 * 对 split 兼容：仅扣除 totalBonus 中未作为 cashAmount 支付的部分。这样无论来自
 * 手动生成还是排班自动同步，节假日的“拿钱/换休”选择都只由薪资单控制字段决定。
 */
export function getHolidayRestBonus(
  allocation?: PaySlip["holidayBonusAllocation"],
): number {
  if (!allocation) return 0;
  return Object.values(allocation).reduce((sum, item) => {
    if (!item || item.mode === "cash") return sum;
    const restAmount = Math.max(0, (item.totalBonus ?? 0) - (item.cashAmount ?? 0));
    return sum + restAmount;
  }, 0);
}

/**
 * 在不改变基础排班事实的前提下，将“换休”部分从本月节假日现金补偿中剔除。
 */
export function applyHolidayRestAllocation(
  attendance: MonthlyAttendance,
  allocation?: PaySlip["holidayBonusAllocation"],
): MonthlyAttendance {
  const requestedRestBonus = getHolidayRestBonus(allocation);
  const restBonus = Math.min(Math.max(0, attendance.holidayBonus), requestedRestBonus);
  if (restBonus === 0) return attendance;

  return {
    ...attendance,
    holidayBonus: Math.round((attendance.holidayBonus - restBonus) * 100) / 100,
    attendanceSalary: Math.round((attendance.attendanceSalary - restBonus) * 100) / 100,
  };
}
