import type { Employee, MonthlyAttendance, ShiftEntry, SpecialStatus } from "./types";
import { calcAttendanceBaseSalary, calcDailyRate, getContractHoursForDate, getDaysInMonth, parseMonth } from "./types";
import { getCompOffSource, getOvertimeCompOffValidation } from "./comp-off-settlement";

function createAttendanceId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface HolidayDayRule {
  date: string;
  multiplier: number;
}

export interface CalculateAttendanceParams {
  employeeId: string;
  month: string;
  employee: Employee;
  shifts: ShiftEntry[];
  specialStatuses: SpecialStatus[];
  /** 已按员工适用范围过滤的节假日规则。 */
  holidayDays?: HolidayDayRule[];
  /** 用于保留同一员工同月既有考勤记录的稳定 ID、备注和日薪覆盖标记。 */
  existing?: MonthlyAttendance | null;
}

/**
 * 从排班记录派生单个员工单月考勤。
 *
 * 加班换休、余额休与节假日调休必须保持三个独立来源：
 * - 加班换休只占用本月真实加班；
 * - 调休余额/节假日调休只消费对应余额条目，不影响本月加班费；
 * - 原始加班只比较真实工作班次，不让“休息日”虚增标准工时并吞掉加班费。
 */
export function calculateAttendanceFromShifts({
  employeeId,
  month,
  employee,
  shifts,
  specialStatuses,
  holidayDays = [],
  existing,
}: CalculateAttendanceParams): MonthlyAttendance {
  const { year, month: monthNumber } = parseMonth(month);
  const daysInMonth = getDaysInMonth(year, monthNumber);
  const empShifts = shifts.filter((shift) => shift.employeeId === employeeId && shift.date.startsWith(month));
  const expectedAttendanceDays = Math.max(0, daysInMonth - (employee.restDaysPerMonth ?? 0));
  const overtimeHoursPerCompOff = employee.compOffRule?.hoursPerDay ?? 8;
  const holidayByDate = new Map(holidayDays.map((holiday) => [holiday.date, holiday]));

  const attendanceDates = new Set<string>();
  let totalHours = 0;
  let standardHours = 0;
  // 原始加班的分母仅包括真实工作班次；三种“休”都不能通过增加标准工时吞掉加班。
  let workedStandardHours = 0;
  let overtimeCompOffDays = 0;
  let balanceCompOffDays = 0;
  let holidayCompOffDays = 0;
  let holidayBonus = 0;
  let holidayWorkDays = 0;
  const specialStatusDeductions: MonthlyAttendance["specialStatusDeductions"] = {};

  const isParttime = employee.type === "parttime" || employee.type === "longterm_parttime";
  const dailyRate = calcDailyRate(employee.baseSalary, daysInMonth, employee.restDaysPerMonth ?? 0);

  const addSpecialDeduction = (status: SpecialStatus, amount: number) => {
    if (amount === 0) return;
    const current = specialStatusDeductions[status.id] ?? {
      count: 0,
      deduction: 0,
      name: status.name,
      multiplier: status.salaryMultiplier,
    };
    specialStatusDeductions[status.id] = {
      ...current,
      count: current.count + 1,
      deduction: current.deduction + amount,
    };
  };

  const addHolidayBonus = (date: string, fallbackMultiplier: number, isHolidayStatus: boolean) => {
    if (isParttime) return;
    const configuredHoliday = holidayByDate.get(date);
    const multiplier = configuredHoliday?.multiplier ?? fallbackMultiplier;
    const isHoliday = Boolean(configuredHoliday) || isHolidayStatus;
    if (!isHoliday || multiplier <= 1) return;

    holidayBonus += Math.round(dailyRate * (multiplier - 1) * 100) / 100;
    holidayWorkDays++;
  };

  for (const shift of empShifts) {
    const specialStatus = shift.specialStatusId
      ? specialStatuses.find((status) => status.id === shift.specialStatusId)
      : undefined;

    if (!specialStatus) {
      const hours = shift.hoursValue;
      if (typeof hours !== "number" || hours <= 0) continue;
      const contractHours = getContractHoursForDate(employee, shift.date);
      attendanceDates.add(shift.date);
      totalHours += hours;
      standardHours += contractHours;
      workedStandardHours += contractHours;
      addHolidayBonus(shift.date, 1, false);
      continue;
    }

    if (specialStatus.category === "comp_off") {
      const source = getCompOffSource(specialStatus.id);
      const contractHours = getContractHoursForDate(employee, shift.date);
      attendanceDates.add(shift.date);
      // 保持“实际出勤/标准工时”展示口径；但不纳入原始加班的标准工时分母。
      standardHours += contractHours;
      if (source === "overtime") overtimeCompOffDays++;
      else if (source === "balance") balanceCompOffDays++;
      else if (source === "holiday") holidayCompOffDays++;
      continue;
    }

    if (specialStatus.countAsAttendance) {
      const hours = shift.hoursValue;
      const contractHours = getContractHoursForDate(employee, shift.date);
      attendanceDates.add(shift.date);
      if (typeof hours === "number" && hours > 0) {
        totalHours += hours;
        workedStandardHours += contractHours;
      }
      standardHours += contractHours;

      if (!isParttime) {
        if (specialStatus.direction === "positive") {
          addHolidayBonus(shift.date, specialStatus.salaryMultiplier, Boolean(specialStatus.isHoliday));
        } else if (specialStatus.direction === "negative") {
          addSpecialDeduction(
            specialStatus,
            Math.round(specialStatus.salaryMultiplier * dailyRate * 100) / 100,
          );
        }
      }
      continue;
    }

    // 不算出勤的状态已由比例底薪自然扣除；只处理额外的正/负调整。
    if (isParttime) continue;
    if (specialStatus.direction === "negative") {
      addSpecialDeduction(
        specialStatus,
        Math.round((specialStatus.salaryMultiplier - 1) * dailyRate * 100) / 100,
      );
    } else if (specialStatus.direction === "positive") {
      addSpecialDeduction(
        specialStatus,
        -Math.round(specialStatus.salaryMultiplier * dailyRate * 100) / 100,
      );
    }
  }

  const attendanceDays = attendanceDates.size;
  const rawOvertimeHours = Math.max(0, totalHours - workedStandardHours);
  const overtimeCompOffHours = overtimeCompOffDays * overtimeHoursPerCompOff;
  const overtimeCompOff = getOvertimeCompOffValidation(rawOvertimeHours, overtimeCompOffHours);
  const paidOvertimeHours = Math.max(0, rawOvertimeHours - overtimeCompOff.appliedHours);
  const underRestDays = expectedAttendanceDays - attendanceDays;
  const totalSpecialDeduction = Object.values(specialStatusDeductions)
    .reduce((sum, detail) => sum + detail.deduction, 0);
  const overtimePay = Math.round(paidOvertimeHours * employee.overtimeHourlyRate * 100) / 100;

  // 全职比例底薪必须从同一日薪原始基数累计：日薪 × 实际出勤天数。
  const proportionalBaseSalary = isParttime
    ? undefined
    : calcAttendanceBaseSalary(dailyRate, attendanceDays, expectedAttendanceDays);

  let attendanceSalary: number;
  if (isParttime) {
    attendanceSalary = employee.parttimeMode === "daily"
      ? Math.round(attendanceDays * employee.baseSalary * 100) / 100
      : Math.round(totalHours * employee.overtimeHourlyRate * 100) / 100;
  } else {
    attendanceSalary = Math.round(((proportionalBaseSalary ?? 0) + overtimePay - totalSpecialDeduction + holidayBonus) * 100) / 100;
  }

  return {
    id: existing?.id ?? createAttendanceId(),
    employeeId,
    month,
    daysInMonth,
    attendanceDays,
    totalHours: Math.round(totalHours * 10) / 10,
    stdHours: Math.round(standardHours * 10) / 10,
    overtimeHours: Math.round(rawOvertimeHours * 10) / 10,
    overtimeCompOffDays,
    overtimeCompOffHours: Math.round(overtimeCompOff.appliedHours * 10) / 10,
    balanceCompOffDays,
    holidayCompOffDays,
    overtimeCompOffShortfallHours: overtimeCompOff.missingHours > 0 ? Math.round(overtimeCompOff.missingHours * 10) / 10 : undefined,
    paidOvertimeHours: Math.round(paidOvertimeHours * 10) / 10,
    expectedAttendanceDays,
    underRestDays,
    specialStatusDeductions,
    totalSpecialDeduction: Math.round(totalSpecialDeduction * 100) / 100,
    holidayBonus: Math.round(holidayBonus * 100) / 100,
    dailyRate,
    proportionalBaseSalary,
    overtimePay,
    attendanceSalary,
    notes: existing?.notes ?? "",
    overtimeAlertHours: rawOvertimeHours >= 4 ? Math.round(rawOvertimeHours * 10) / 10 : undefined,
    holidayWorkDays: holidayWorkDays > 0 ? holidayWorkDays : undefined,
  };
}
