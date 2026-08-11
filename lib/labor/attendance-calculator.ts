import type { Employee, MonthlyAttendance, ShiftEntry, SpecialStatus } from "./types";
import { calcDailyRate, getContractHoursForDate, getDaysInMonth, parseMonth } from "./types";

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
 * 此函数是排班→考勤→薪资链路的唯一计算入口。它不写入存储，因而可直接以真实生产
 * 逻辑覆盖节假日倍率、特殊状态、加班和跨月隔离测试，避免测试镜像与产品引擎漂移。
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
  const hoursPerCompOff = employee.compOffRule?.hoursPerDay ?? 8;
  const holidayByDate = new Map(holidayDays.map((holiday) => [holiday.date, holiday]));

  const attendanceDates = new Set<string>();
  let totalHours = 0;
  let standardHours = 0;
  let compOffCount = 0;
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
      attendanceDates.add(shift.date);
      totalHours += hours;
      standardHours += getContractHoursForDate(employee, shift.date);
      // 节假日配置不仅用于 UI 标记；普通班次在配置日期上工作时也必须进入倍率工资。
      addHolidayBonus(shift.date, 1, false);
      continue;
    }

    if (specialStatus.category === "comp_off") {
      // 调休日算出勤但没有实际工时；其余额消费由明确的调休余额工作流处理。
      compOffCount++;
      attendanceDates.add(shift.date);
      standardHours += getContractHoursForDate(employee, shift.date);
      continue;
    }

    if (specialStatus.countAsAttendance) {
      const hours = shift.hoursValue;
      attendanceDates.add(shift.date);
      if (typeof hours === "number" && hours > 0) totalHours += hours;
      standardHours += getContractHoursForDate(employee, shift.date);

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
  const rawOvertimeHours = Math.max(0, totalHours - standardHours);
  const compOffHoursUsed = compOffCount * hoursPerCompOff;
  const paidOvertimeHours = Math.max(0, rawOvertimeHours - compOffHoursUsed);
  const underRestDays = expectedAttendanceDays - attendanceDays;
  const totalSpecialDeduction = Object.values(specialStatusDeductions)
    .reduce((sum, detail) => sum + detail.deduction, 0);
  const overtimePay = Math.round(paidOvertimeHours * employee.overtimeHourlyRate * 100) / 100;

  let attendanceSalary: number;
  if (isParttime) {
    attendanceSalary = employee.parttimeMode === "daily"
      ? Math.round(attendanceDays * employee.baseSalary * 100) / 100
      : Math.round(totalHours * employee.overtimeHourlyRate * 100) / 100;
  } else {
    const proportionalBase = expectedAttendanceDays > 0 && attendanceDays > 0
      ? Math.round(employee.baseSalary * attendanceDays / expectedAttendanceDays * 100) / 100
      : 0;
    attendanceSalary = Math.round((proportionalBase + overtimePay - totalSpecialDeduction + holidayBonus) * 100) / 100;
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
    compOffCount,
    hoursPerCompOff,
    paidOvertimeHours: Math.round(paidOvertimeHours * 10) / 10,
    expectedAttendanceDays,
    underRestDays,
    specialStatusDeductions,
    totalSpecialDeduction: Math.round(totalSpecialDeduction * 100) / 100,
    holidayBonus: Math.round(holidayBonus * 100) / 100,
    dailyRate,
    dailyRateOverride: existing?.dailyRateOverride ?? false,
    overtimePay,
    attendanceSalary,
    notes: existing?.notes ?? "",
    overtimeAlertHours: rawOvertimeHours >= 4 ? Math.round(rawOvertimeHours * 10) / 10 : undefined,
    storedOvertimeHours: compOffHoursUsed > 0 ? Math.round(compOffHoursUsed * 10) / 10 : undefined,
    holidayWorkDays: holidayWorkDays > 0 ? holidayWorkDays : undefined,
  };
}
