/**
 * tests/schedule-engine-audit.test.ts
 *
 * 排班引擎全面审计测试（2026-08 审计产出）
 *
 * Suite A: 节假日配置倍率实际进入考勤计算
 * Suite B: 普通班次在节假日配置日期上也触发倍率工资
 * Suite C: 跨月日期守卫（schedule-guards.ts）
 * Suite D: 节假日换休不计薪（holiday-pay.ts）
 * Suite E: 快照代入前锁定校验
 * Suite F: 批量删除跨月日期守卫
 * Suite G: 考勤计算器月份隔离（empShifts 过滤）
 * Suite H: 兼职员工不受节假日倍率影响
 * Suite I: 2025 人社部工资折算标准（21.75 计薪天数）
 */

import { describe, it, expect } from "vitest";
import { calculateAttendanceFromShifts } from "../lib/labor/attendance-calculator";
import { canWriteScheduleDates, getNonWritableScheduleMonths, monthFromScheduleDate } from "../lib/labor/schedule-guards";
import { applyHolidayRestAllocation, getHolidayRestBonus } from "../lib/labor/holiday-pay";
import { getHolidayAllocationKey, getHolidayWorkInfo } from "../lib/labor/holiday-work";
import type { Employee, ShiftEntry, SpecialStatus } from "../lib/labor/types";
import { calcAttendanceBaseSalary, calcDailyRate, DEFAULT_SPECIAL_STATUSES, getAttendanceBaseSalary } from "../lib/labor/types";

// ─── 测试夹具 ─────────────────────────────────────────────────────────────────

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-001",
    code: "A01",
    realName: "张三",
    phone: "",
    dept: "front",
    type: "fulltime",
    baseSalary: 6000,
    restDaysPerMonth: 8,
    hourlyRate: 30,
    overtimeHourlyRate: 45,
    notes: "",
    active: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeShift(date: string, hours: number, specialStatusId?: string): ShiftEntry {
  return {
    employeeId: "emp-001",
    date,
    shift: "晚班",
    hoursValue: hours,
    specialStatusId,
  };
}

const MONTH = "2026-07";
const DAYS_IN_MONTH = 31;
const REST_DAYS = 8;
const EXPECTED_ATTENDANCE = DAYS_IN_MONTH - REST_DAYS; // 23 天
const DAILY_RATE = Math.round((6000 / (DAYS_IN_MONTH - REST_DAYS)) * 100) / 100;

// ─── Suite A: 节假日配置倍率实际进入考勤计算 ──────────────────────────────────

describe("Suite A：节假日配置倍率进入考勤计算", () => {
  it("A1. 节假日上班特殊状态（ss_holiday）触发 holidayBonus", () => {
    const shifts: ShiftEntry[] = [
      { ...makeShift("2026-07-01", 7), specialStatusId: "ss_holiday" },
    ];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    // ss_holiday salaryMultiplier=3, 额外 (3-1)=2 倍日薪
    const expectedBonus = Math.round(DAILY_RATE * 2 * 100) / 100;
    expect(result.holidayBonus).toBeCloseTo(expectedBonus, 1);
    expect(result.holidayWorkDays).toBe(1);
  });

  it("A2. 节假日配置（HolidayDayRule）在普通班次上触发倍率工资", () => {
    const shifts: ShiftEntry[] = [makeShift("2026-07-01", 7)];
    const holidayDays = [{ date: "2026-07-01", multiplier: 3 }];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
      holidayDays,
    });
    const expectedBonus = Math.round(DAILY_RATE * 2 * 100) / 100;
    expect(result.holidayBonus).toBeCloseTo(expectedBonus, 1);
    expect(result.holidayWorkDays).toBe(1);
  });

  it("A3. 节假日配置倍率覆盖特殊状态默认倍率（配置优先）", () => {
    const shifts: ShiftEntry[] = [
      { ...makeShift("2026-07-01", 7), specialStatusId: "ss_holiday" },
    ];
    // 配置倍率 2x，特殊状态默认 3x
    const holidayDays = [{ date: "2026-07-01", multiplier: 2 }];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
      holidayDays,
    });
    // 配置倍率 2x 优先：额外 (2-1)=1 倍日薪
    const expectedBonus = Math.round(DAILY_RATE * 1 * 100) / 100;
    expect(result.holidayBonus).toBeCloseTo(expectedBonus, 1);
  });

  it("A4. 无节假日配置时 holidayBonus=0（普通班次不触发）", () => {
    const shifts: ShiftEntry[] = [makeShift("2026-07-01", 7)];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    expect(result.holidayBonus).toBe(0);
    expect(result.holidayWorkDays).toBeUndefined();
  });

  it("A5. 多个节假日配置日期累加 holidayBonus", () => {
    const shifts: ShiftEntry[] = [
      makeShift("2026-07-01", 7),
      makeShift("2026-07-02", 7),
    ];
    const holidayDays = [
      { date: "2026-07-01", multiplier: 3 },
      { date: "2026-07-02", multiplier: 2 },
    ];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
      holidayDays,
    });
    const bonus1 = Math.round(DAILY_RATE * 2 * 100) / 100;
    const bonus2 = Math.round(DAILY_RATE * 1 * 100) / 100;
    expect(result.holidayBonus).toBeCloseTo(bonus1 + bonus2, 1);
    expect(result.holidayWorkDays).toBe(2);
  });
});

// ─── Suite B: 普通班次在节假日配置日期上触发倍率工资 ─────────────────────────

describe("Suite B：普通班次节假日配置联动", () => {
  it("B1. 节假日配置 multiplier=1 时不触发额外工资", () => {
    const shifts: ShiftEntry[] = [makeShift("2026-07-01", 7)];
    const holidayDays = [{ date: "2026-07-01", multiplier: 1 }];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
      holidayDays,
    });
    expect(result.holidayBonus).toBe(0);
  });

  it("B2. 节假日配置日期无排班时不触发 holidayBonus", () => {
    const shifts: ShiftEntry[] = [makeShift("2026-07-05", 7)];
    const holidayDays = [{ date: "2026-07-01", multiplier: 3 }];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
      holidayDays,
    });
    expect(result.holidayBonus).toBe(0);
  });
});

// ─── Suite C: 跨月日期守卫 ───────────────────────────────────────────────────

describe("Suite C：schedule-guards 跨月日期守卫", () => {
  const isWritable = (month: string) => month === "2026-07";

  it("C1. 当月日期可写", () => {
    expect(canWriteScheduleDates(["2026-07-01", "2026-07-15"], isWritable)).toBe(true);
  });

  it("C2. 跨月日期不可写时返回 false", () => {
    expect(canWriteScheduleDates(["2026-07-01", "2026-06-30"], isWritable)).toBe(false);
  });

  it("C3. 纯跨月日期不可写", () => {
    expect(canWriteScheduleDates(["2026-06-28", "2026-06-29"], isWritable)).toBe(false);
  });

  it("C4. getNonWritableScheduleMonths 返回正确的锁定月份", () => {
    const locked = getNonWritableScheduleMonths(["2026-07-01", "2026-06-30", "2026-05-31"], isWritable);
    expect(locked).toEqual(["2026-05", "2026-06"]);
  });

  it("C5. monthFromScheduleDate 正确提取月份", () => {
    expect(monthFromScheduleDate("2026-07-15")).toBe("2026-07");
    expect(monthFromScheduleDate("2026-12-31")).toBe("2026-12");
  });

  it("C6. 全部当月日期时 getNonWritableScheduleMonths 返回空数组", () => {
    const locked = getNonWritableScheduleMonths(["2026-07-01", "2026-07-31"], isWritable);
    expect(locked).toEqual([]);
  });
});

// ─── Suite D: 节假日换休不计薪 ───────────────────────────────────────────────

describe("Suite D：holiday-pay 节假日换休不计薪", () => {
  const baseAtt = {
    id: "att-001",
    employeeId: "emp-001",
    month: MONTH,
    daysInMonth: 31,
    attendanceDays: 20,
    totalHours: 140,
    stdHours: 140,
    overtimeHours: 0,
    compOffCount: 0,
    hoursPerCompOff: 8,
    paidOvertimeHours: 0,
    expectedAttendanceDays: 23,
    underRestDays: 3,
    specialStatusDeductions: {},
    totalSpecialDeduction: 0,
    holidayBonus: 500,
    dailyRate: 260.87,
    overtimePay: 0,
    attendanceSalary: 5000,
    notes: "",
  };

  it("D1. 无 holidayBonusAllocation 时考勤不变", () => {
    const result = applyHolidayRestAllocation(baseAtt);
    expect(result.holidayBonus).toBe(500);
    expect(result.attendanceSalary).toBe(5000);
  });

  it("D2. 全部选换休时 holidayBonus 清零", () => {
    const allocation = {
      key1: { date: "2026-07-01", name: "国庆", totalBonus: 500, cashAmount: 0, restDays: 1, mode: "rest" as const },
    };
    const result = applyHolidayRestAllocation(baseAtt, allocation);
    expect(result.holidayBonus).toBe(0);
    expect(result.attendanceSalary).toBe(4500);
  });

  it("D3. 部分选换休时 holidayBonus 按比例扣除", () => {
    const allocation = {
      key1: { date: "2026-07-01", name: "国庆", totalBonus: 300, cashAmount: 0, restDays: 1, mode: "rest" as const },
    };
    const result = applyHolidayRestAllocation(baseAtt, allocation);
    expect(result.holidayBonus).toBeCloseTo(200, 1);
    expect(result.attendanceSalary).toBeCloseTo(4700, 1);
  });

  it("D4. split 模式只扣除 (totalBonus - cashAmount)", () => {
    const allocation = {
      key1: { date: "2026-07-01", name: "国庆", totalBonus: 500, cashAmount: 200, restDays: 0, mode: "split" as const },
    };
    const result = applyHolidayRestAllocation(baseAtt, allocation);
    expect(result.holidayBonus).toBeCloseTo(200, 1);
    expect(result.attendanceSalary).toBeCloseTo(4700, 1);
  });

  it("D5. getHolidayRestBonus 正确计算换休总额", () => {
    const allocation = {
      k1: { date: "2026-07-01", name: "国庆", totalBonus: 300, cashAmount: 0, restDays: 1, mode: "rest" as const },
      k2: { date: "2026-07-02", name: "国庆", totalBonus: 200, cashAmount: 200, restDays: 0, mode: "cash" as const },
    };
    expect(getHolidayRestBonus(allocation)).toBeCloseTo(300, 1);
  });
});

// ─── Suite E: 快照代入前锁定校验 ─────────────────────────────────────────────

describe("Suite E：快照代入月度锁定校验", () => {
  it("E1. isMonthWritable=true 时允许代入", () => {
    const isWritable = (_month: string) => true;
    expect(canWriteScheduleDates(["2026-07-01"], isWritable)).toBe(true);
  });

  it("E2. isMonthWritable=false 时拒绝代入", () => {
    const isWritable = (_month: string) => false;
    expect(canWriteScheduleDates(["2026-07-01"], isWritable)).toBe(false);
  });
});

// ─── Suite F: 批量删除跨月日期守卫 ───────────────────────────────────────────

describe("Suite F：批量删除跨月日期守卫", () => {
  it("F1. 选中项全在当月时允许删除", () => {
    const isWritable = (month: string) => month === "2026-07";
    const dates = ["2026-07-01", "2026-07-15", "2026-07-31"];
    expect(canWriteScheduleDates(dates, isWritable)).toBe(true);
  });

  it("F2. 选中项包含上月已冻结日期时拒绝删除", () => {
    const isWritable = (month: string) => month === "2026-07";
    const dates = ["2026-07-01", "2026-06-30"];
    expect(canWriteScheduleDates(dates, isWritable)).toBe(false);
  });

  it("F3. 锁定月份列表包含所有受影响月份", () => {
    const isWritable = (month: string) => month === "2026-07";
    const dates = ["2026-07-01", "2026-06-30", "2026-05-15"];
    const locked = getNonWritableScheduleMonths(dates, isWritable);
    expect(locked).toContain("2026-06");
    expect(locked).toContain("2026-05");
    expect(locked).not.toContain("2026-07");
  });
});

// ─── Suite G: 考勤计算器月份隔离 ─────────────────────────────────────────────

describe("Suite G：考勤计算器月份隔离", () => {
  it("G1. 其他月份排班不计入当月出勤", () => {
    const shifts: ShiftEntry[] = [
      makeShift("2026-07-01", 7),
      { ...makeShift("2026-06-30", 7) }, // 上月
    ];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    expect(result.attendanceDays).toBe(1);
    expect(result.totalHours).toBeCloseTo(7, 1);
  });

  it("G2. 不同员工排班不计入当前员工出勤", () => {
    const shifts: ShiftEntry[] = [
      makeShift("2026-07-01", 7),
      { employeeId: "emp-002", date: "2026-07-02", shift: "晚班", hoursValue: 7 },
    ];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    expect(result.attendanceDays).toBe(1);
  });

  it("G3. 同一天多条排班记录只计一天出勤", () => {
    const shifts: ShiftEntry[] = [
      makeShift("2026-07-01", 7),
      { employeeId: "emp-001", date: "2026-07-01", shift: "午班", hoursValue: 5 },
    ];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: makeEmployee(),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    expect(result.attendanceDays).toBe(1);
    expect(result.totalHours).toBeCloseTo(12, 1);
  });
});

// ─── Suite H: 兼职员工不受节假日倍率影响 ─────────────────────────────────────

describe("Suite H：兼职员工节假日豁免", () => {
  it("H1. 兼职员工节假日配置不触发 holidayBonus", () => {
    const parttimeEmp = makeEmployee({ type: "parttime", parttimeMode: "hourly" });
    const shifts: ShiftEntry[] = [makeShift("2026-07-01", 7)];
    const holidayDays = [{ date: "2026-07-01", multiplier: 3 }];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: parttimeEmp,
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
      holidayDays,
    });
    expect(result.holidayBonus).toBe(0);
  });

  it("H2. 兼职按小时结算工资不受 dailyRate 影响", () => {
    const parttimeEmp = makeEmployee({ type: "parttime", parttimeMode: "hourly", baseSalary: 0, overtimeHourlyRate: 50 });
    const shifts: ShiftEntry[] = [makeShift("2026-07-01", 8), makeShift("2026-07-02", 8)];
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: parttimeEmp,
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    expect(result.attendanceSalary).toBeCloseTo(800, 1);
  });
});

// ─── Suite I: 节假日决策识别 ─────────────────────────────────────────────────

describe("Suite I：节假日拿钱/换休决策识别", () => {
  const holidayStatus = DEFAULT_SPECIAL_STATUSES.find((status) => status.id === "ss_holiday")!;

  it("I1. 普通工作班次 + 节假日配置会进入拿钱/换休决策", () => {
    const info = getHolidayWorkInfo(
      makeShift("2026-07-01", 7),
      undefined,
      { id: "h-001", name: "国庆", dates: ["2026-07-01"], multiplier: 3, applicableEmployeeIds: [], notes: "" },
    );
    expect(info).toMatchObject({ allocationKeyPart: "holiday_h-001", name: "国庆", multiplier: 3 });
  });

  it("I2. 休假/无工时普通班次不进入节假日决策", () => {
    const info = getHolidayWorkInfo(
      { employeeId: "emp-001", date: "2026-07-01", shift: "晚班", hoursValue: null },
      undefined,
      { id: "h-001", name: "国庆", dates: ["2026-07-01"], multiplier: 3, applicableEmployeeIds: [], notes: "" },
    );
    expect(info).toBeNull();
  });

  it("I3. ss_holiday 保持历史特殊状态 ID 作为决策 key", () => {
    const info = getHolidayWorkInfo(makeShift("2026-07-01", 7, "ss_holiday"), holidayStatus, null);
    expect(info?.allocationKeyPart).toBe("ss_holiday");
    expect(info?.multiplier).toBe(3);
  });

  it("I4. 配置倍率优先于 ss_holiday 默认倍率", () => {
    const info = getHolidayWorkInfo(
      makeShift("2026-07-01", 7, "ss_holiday"),
      holidayStatus,
      { id: "h-002", name: "自定义节日", dates: ["2026-07-01"], multiplier: 2, applicableEmployeeIds: [], notes: "" },
    );
    expect(info?.multiplier).toBe(2);
  });

  it("I5. 决策 key 由 employee + date + stable part 组成", () => {
    expect(getHolidayAllocationKey("emp-001", "2026-07-01", "holiday_h-001"))
      .toBe("emp-001_2026-07-01_holiday_h-001");
  });
});

// ─── Suite J: 2025 人社部工资折算标准 ────────────────────────────────────────

describe("Suite J：2025 人社部工资折算标准（人社部发〔2025〕2号）", () => {
  it("I1. 月计薪天数 21.75 = (365-104)/12", () => {
    const monthlyPayDays = (365 - 104) / 12;
    expect(monthlyPayDays).toBeCloseTo(21.75, 2);
  });

  it("I2. 月制度工作日 20.67 = (365-104-13)/12", () => {
    const monthlyWorkDays = (365 - 104 - 13) / 12;
    expect(monthlyWorkDays).toBeCloseTo(20.67, 2);
  });

  it("I3. 日工资 = 月工资 / 21.75（含法定节假日）", () => {
    const monthSalary = 6000;
    const dailyWage = monthSalary / 21.75;
    expect(dailyWage).toBeCloseTo(275.86, 1);
  });

  it("I4. 小时工资 = 月工资 / (21.75 × 8)", () => {
    const monthSalary = 6000;
    const hourlyWage = monthSalary / (21.75 * 8);
    expect(hourlyWage).toBeCloseTo(34.48, 1);
  });

  it("I5. 考勤计算器的 dailyRate 使用实际月工作日（daysInMonth - restDays）", () => {
    const emp = makeEmployee({ baseSalary: 6000, restDaysPerMonth: 8 });
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: MONTH,
      employee: emp,
      shifts: [],
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    // 7月31天，休8天，工作日23天：6000/23 ≈ 260.87
    expect(result.dailyRate).toBeCloseTo(6000 / 23, 1);
  });
});

// ─── Suite K: 比例底薪与日薪单一基数 ─────────────────────────────────────────

describe("Suite K：比例底薪统一为日薪 × 实际出勤天数", () => {
  it("K1. 日薪使用月底薪 ÷ 应出勤天数的原始精度，不提前截断为展示金额", () => {
    const dailyRate = calcDailyRate(10000, 30, 4);
    expect(dailyRate).toBeCloseTo(10000 / 26, 12);
    expect(dailyRate).not.toBe(384.62);
  });

  it("K2. 比例底薪 = 原始日薪 × 实际出勤天数，最终金额才保留两位小数", () => {
    const dailyRate = calcDailyRate(10000, 30, 4);
    const proportionalBase = calcAttendanceBaseSalary(dailyRate, 20, 26);
    expect(proportionalBase).toBe(7692.31);
    // 若误用展示后的 ¥384.62 再乘 20，会得到错误的 ¥7,692.40。
    expect(proportionalBase).not.toBe(Math.round(384.62 * 20 * 100) / 100);
  });

  it("K3. 全勤时比例底薪与月底薪严格闭环", () => {
    const dailyRate = calcDailyRate(10000, 30, 4);
    expect(calcAttendanceBaseSalary(dailyRate, 26, 26)).toBe(10000);
  });

  it("K4. 真实考勤引擎持久化比例底薪，供 UI 和导出直接读取", () => {
    const shifts = Array.from({ length: 20 }, (_, index) =>
      makeShift(`2026-04-${String(index + 1).padStart(2, "0")}`, 8)
    );
    const result = calculateAttendanceFromShifts({
      employeeId: "emp-001",
      month: "2026-04",
      employee: makeEmployee({ baseSalary: 10000, restDaysPerMonth: 4 }),
      shifts,
      specialStatuses: DEFAULT_SPECIAL_STATUSES,
    });
    expect(result.expectedAttendanceDays).toBe(26);
    expect(result.proportionalBaseSalary).toBe(7692.31);
    expect(getAttendanceBaseSalary(result)).toBe(7692.31);
  });

  it("K5. 历史考勤缺少比例底薪字段时，仅按已结算数据兼容读取，不改写历史金额", () => {
    const legacyAttendance = {
      attendanceDays: 20,
      expectedAttendanceDays: 26,
      attendanceSalary: 7800.31,
      overtimePay: 100,
      holidayBonus: 200,
      totalSpecialDeduction: 208,
    } as any;
    expect(getAttendanceBaseSalary(legacyAttendance)).toBe(7708.31);
  });
});


describe("Suite L：比例底薪异常边界与精度守卫", () => {
  it("L1. 只有 1 个应出勤日时，出勤 1 天比例底薪严格等于月底薪", () => {
    const dailyRate = calcDailyRate(8888.88, 31, 30);
    expect(dailyRate).toBe(8888.88);
    expect(calcAttendanceBaseSalary(dailyRate, 1, 1)).toBe(8888.88);
  });

  it("L2. 月休天数等于或超过自然月天数时，日薪与比例底薪均归零", () => {
    expect(calcDailyRate(8888.88, 30, 30)).toBe(0);
    expect(calcDailyRate(8888.88, 30, 31)).toBe(0);
    expect(calcAttendanceBaseSalary(0, 1, 0)).toBe(0);
  });

  it("L3. 非法底薪、非有限日薪或负出勤天数不会产生负工资或 NaN", () => {
    expect(calcDailyRate(-1, 30, 4)).toBe(0);
    expect(calcDailyRate(Number.NaN, 30, 4)).toBe(0);
    expect(calcDailyRate(Number.POSITIVE_INFINITY, 30, 4)).toBe(0);
    expect(calcAttendanceBaseSalary(Number.NaN, 20, 26)).toBe(0);
    expect(calcAttendanceBaseSalary(384.615, -1, 26)).toBe(0);
  });

  it("L4. 实际出勤超过常规应出勤天数时，仍按同一日薪累计且仅在最终金额取整", () => {
    const dailyRate = calcDailyRate(10000, 30, 4);
    expect(calcAttendanceBaseSalary(dailyRate, 27, 26)).toBe(10384.62);
  });
});
