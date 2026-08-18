import { describe, expect, it } from "vitest";
import { calculateAttendanceFromShifts } from "../lib/labor/attendance-calculator";
import {
  BALANCE_COMP_OFF_STATUS,
  HOLIDAY_COMP_OFF_STATUS,
  OVERTIME_COMP_OFF_STATUS,
  getCompOffSource,
  getExpiringCompOffEntries,
  getOvertimeCompOffValidation,
  isCompOffEntryExpired,
  planCompOffBalanceConsumption,
} from "../lib/labor/comp-off-settlement";
import { DEFAULT_SPECIAL_STATUSES, type CompOffBalanceEntry, type Employee, type ShiftEntry } from "../lib/labor/types";

const MONTH = "2026-08";

function makeEmployee(): Employee {
  return {
    id: "emp-comp-off", code: "CO01", realName: "调休测试", phone: "", dept: "front", type: "fulltime",
    baseSalary: 5600, stdHoursPerDay: 8, restDaysPerMonth: 8, hourlyRate: 30, overtimeHourlyRate: 50,
    notes: "", active: true, createdAt: "2026-01-01T00:00:00.000Z", compOffRule: { enabled: true, hoursPerDay: 8 },
  };
}

function shift(date: string, hours: number | null, specialStatusId?: string): ShiftEntry {
  return { employeeId: "emp-comp-off", date, shift: "晚班", hoursValue: hours, specialStatusId };
}

function balance(id: string, days: number, expiresMonth: string, source: "overtime" | "holiday" = "overtime"): CompOffBalanceEntry {
  return {
    id, employeeId: "emp-comp-off", earnedMonth: "2026-06", source, days, expiresMonth,
    status: "available", createdAt: `2026-06-${id.padStart(2, "0")}T00:00:00.000Z`, notes: "",
  };
}

describe("加班换休与调休余额：端到端结算", () => {
  it("43.5h 原始加班－4天加班换休(32h)＝11.5h 计费加班，并正常产生加班费", () => {
    const shifts: ShiftEntry[] = [];
    // 五个真实工作日：5 × 16.7h - 5 × 8h = 43.5h 原始加班。
    for (let day = 1; day <= 5; day++) shifts.push(shift(`${MONTH}-${String(day).padStart(2, "0")}`, 16.7));
    // 四天“加班换休”不应增加原始加班的标准工时分母。
    for (let day = 6; day <= 9; day++) shifts.push(shift(`${MONTH}-${String(day).padStart(2, "0")}`, null, OVERTIME_COMP_OFF_STATUS));

    const attendance = calculateAttendanceFromShifts({
      employeeId: "emp-comp-off", month: MONTH, employee: makeEmployee(), shifts, specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });

    expect(attendance.overtimeHours).toBe(43.5);
    expect(attendance.overtimeCompOffDays).toBe(4);
    expect(attendance.overtimeCompOffHours).toBe(32);
    expect(attendance.balanceCompOffDays).toBe(0);
    expect(attendance.holidayCompOffDays).toBe(0);
    expect(attendance.paidOvertimeHours).toBe(11.5);
    expect(attendance.overtimePay).toBe(575);
    expect(attendance.overtimeCompOffShortfallHours).toBeUndefined();
  });

  it("加班换休超出真实原始加班时产生短缺，排班保存前可以被阻止", () => {
    const check = getOvertimeCompOffValidation(11.5, 32);
    expect(check.isValid).toBe(false);
    expect(check.appliedHours).toBe(11.5);
    expect(check.missingHours).toBe(20.5);
  });

  it("余额休只消耗余额，不改变本月原始加班、计费加班和加班费", () => {
    const shifts: ShiftEntry[] = [];
    for (let day = 1; day <= 5; day++) shifts.push(shift(`${MONTH}-${String(day).padStart(2, "0")}`, 16.7));
    shifts.push(shift(`${MONTH}-06`, null, BALANCE_COMP_OFF_STATUS));

    const attendance = calculateAttendanceFromShifts({
      employeeId: "emp-comp-off", month: MONTH, employee: makeEmployee(), shifts, specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });

    expect(attendance.overtimeHours).toBe(43.5);
    expect(attendance.balanceCompOffDays).toBe(1);
    expect(attendance.overtimeCompOffDays).toBe(0);
    expect(attendance.paidOvertimeHours).toBe(43.5);
    expect(attendance.overtimePay).toBe(2175);
  });

  it("余额休按最早到期优先，可由两条 0.5 天余额拼成一个排班日", () => {
    const plan = planCompOffBalanceConsumption([
      balance("02", 0.5, "2026-09"),
      balance("01", 0.5, "2026-08"),
      balance("03", 1, "2026-10"),
    ], 1, "balance", MONTH);

    expect(plan.missingDays).toBe(0);
    expect(plan.allocations).toEqual([
      { entryId: "01", days: 0.5, source: "overtime", expiresMonth: "2026-08" },
      { entryId: "02", days: 0.5, source: "overtime", expiresMonth: "2026-09" },
    ]);
  });

  it("余额不足时不产生部分成功：计划明确返回缺口，排班入口应拒绝写入", () => {
    const plan = planCompOffBalanceConsumption([balance("01", 0.5, "2026-08")], 1, "balance", MONTH);
    expect(plan.availableDays).toBe(0.5);
    expect(plan.allocatedDays).toBe(0.5);
    expect(plan.missingDays).toBe(0.5);
  });

  it("到期月仍可排班使用；只有跨过到期月才过期，并在到期月列入兑现询问", () => {
    const entry = balance("01", 1, "2026-08");
    expect(isCompOffEntryExpired(entry, "2026-08")).toBe(false);
    expect(getExpiringCompOffEntries([entry], "emp-comp-off", "2026-08")).toEqual([entry]);
    expect(isCompOffEntryExpired(entry, "2026-09")).toBe(true);
  });

  it("三种调休状态必须映射到唯一来源，旧通用状态不再被结算器接受", () => {
    expect(getCompOffSource(OVERTIME_COMP_OFF_STATUS)).toBe("overtime");
    expect(getCompOffSource(BALANCE_COMP_OFF_STATUS)).toBe("balance");
    expect(getCompOffSource(HOLIDAY_COMP_OFF_STATUS)).toBe("holiday");
    expect(getCompOffSource("ss_comp_off")).toBeNull();
  });
});
