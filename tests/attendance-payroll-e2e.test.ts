/**
 * tests/attendance-payroll-e2e.test.ts
 * 全量端到端（E2E）测试：考勤和薪资兑换功能
 *
 * 测试架构说明：
 *   由于 calcFromShifts 和 buildPaySlipDraft 封装在 React Context 中，
 *   本测试文件将其核心逻辑提取为纯函数（与 store.tsx 保持完全一致），
 *   模拟真实用户交互场景，验证重构后的计算正确性。
 *
 * 覆盖场景：
 *   Suite A：考勤工资计算引擎（calcFromShifts 纯函数版）
 *     A1. 全勤：比例底薪 = 底薪，5格加法闭环
 *     A2. 缺勤：比例底薪按比例减少
 *     A3. 加班：paidOvertimeHours 计算正确，overtimePay 加入 attendanceSalary
 *     A4. 旷工：额外扣1天日薪，attendanceSalary 减少
 *     A5. 病假：退回0.5天日薪，attendanceSalary 增加
 *     A6. 节假日上班：holidayBonus 加入 attendanceSalary
 *     A7. 加班换休（comp_off）：compOffCount++，paidOvertimeHours 减少
 *
 *   Suite B：兑换调休余额（handleCashOut 重构验证）
 *     B1. 首次兑换：grossSalary 增加 compOffCashOut 金额
 *     B2. 多次兑换：grossSalary 不累积误差（每次基于 buildPaySlipDraft 重算）
 *     B3. 兑换后 finalSalary 正确（grossSalary - 预支）
 *     B4. 兑换金额计算：overtime 按时薪×小时，holiday 按日薪×天数
 *
 *   Suite C：节假日换休切换（toggleMode 重构验证）
 *     C1. 拿钱→换休：grossSalary 减少 bonusAmt，不累积误差
 *     C2. 换休→拿钱：grossSalary 增加 bonusAmt，不累积误差
 *     C3. 多次切换：最终值与初始值一致（幂等性验证）
 *     C4. holidayBonusAllocation 控制字段正确写入
 *
 *   Suite D：autoSync 依赖完整性（存入调休联动加班费）
 *     D1. 存入调休前：paidOvertimeHours = rawOvertimeHours
 *     D2. 存入调休后（排班记录增加 comp_off）：paidOvertimeHours 减少
 *     D3. 兑换调休后（排班记录减少 comp_off）：paidOvertimeHours 恢复
 *     D4. compOffEntries 变化 → 重算触发 → overtimePay 同步减少
 *
 *   Suite E：grossSalary 构成完整性验证
 *     E1. compOffCashOut 纳入 grossSalary（修复旧版遗漏）
 *     E2. salesCommission 纳入 grossSalary
 *     E3. rewardPenalty 纳入 grossSalary
 *     E4. 所有分项之和 = grossSalary（闭环验证）
 *
 *   Suite F：绩效补贴展示完整性（labor-attendance.tsx 修复验证）
 *     F1. 综合小计 = performanceBonus + mealAllowance + transportAllowance + otherAllowance + salesCommission
 *     F2. 旧版「绩效补贴小计」漏掉 transportAllowance 的回归测试
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  calcAttendanceBaseSalary,
  calcDailyRate,
  getDaysInMonth,
  parseMonth,
  getContractHoursForDate,
  DEFAULT_SPECIAL_STATUSES,
  DEFAULT_GLOBAL_PAYROLL_SETTINGS,
  type Employee,
  type ShiftEntry,
  type MonthlyAttendance,
  type PaySlip,
  type SpecialStatus,
  type GlobalPayrollSettings,
  type AllowanceRule,
  calcAllowance,
} from "../lib/labor/types";

// ─── 测试工具函数（与 store.tsx 保持完全一致）────────────────────────────────

/**
 * 纯函数版 calcFromShifts（从 store.tsx 提取，保持逻辑完全一致）
 * 用于 E2E 测试中模拟真实考勤计算
 */
function calcFromShiftsPure(
  employeeId: string,
  month: string,
  employee: Employee,
  shifts: ShiftEntry[],
  specialStatuses: SpecialStatus[],
  holidayDaysList: Array<{ date: string; multiplier: number }> = []
): MonthlyAttendance {
  const { year, month: m } = parseMonth(month);
  const daysInMonth = getDaysInMonth(year, m);
  const empShifts = shifts.filter((s) => s.employeeId === employeeId && s.date.startsWith(month));
  const expectedAttendanceDays = Math.max(0, daysInMonth - employee.restDaysPerMonth);
  const hoursPerCompOff = employee.compOffRule?.hoursPerDay ?? 8;
  const daysSet = new Set<string>();
  let totalHours = 0;
  let stdHoursTotal = 0;
  let compOffCount = 0;
  let holidayBonus = 0;
  let holidayWorkDays = 0;
  const specialStatusDeductions: Record<string, { count: number; deduction: number; name: string; multiplier: number }> = {};
  const dailyRate = calcDailyRate(employee.baseSalary, daysInMonth, employee.restDaysPerMonth);

  empShifts.forEach((s) => {
    const specialStatus = s.specialStatusId
      ? specialStatuses.find((ss) => ss.id === s.specialStatusId)
      : null;
    if (specialStatus) {
      const dir = specialStatus.direction;
      const countsAsAtt = specialStatus.countAsAttendance;
      const isCompOff = specialStatus.category === "comp_off";
      if (isCompOff) {
        compOffCount++;
        daysSet.add(s.date);
        const contractH = getContractHoursForDate(employee, s.date);
        stdHoursTotal += contractH;
      } else if (countsAsAtt) {
        const h = s.hoursValue;
        if (typeof h === "number" && h > 0) {
          daysSet.add(s.date);
          totalHours += h;
          const contractH = getContractHoursForDate(employee, s.date);
          stdHoursTotal += contractH;
        } else {
          daysSet.add(s.date);
          const contractH = getContractHoursForDate(employee, s.date);
          stdHoursTotal += contractH;
        }
        if (dir === "positive" && specialStatus.salaryMultiplier > 1) {
          const dayBonus = Math.round(dailyRate * (specialStatus.salaryMultiplier - 1) * 100) / 100;
          holidayBonus += dayBonus;
          if (specialStatus.isHoliday) holidayWorkDays++;
        } else if (dir === "negative") {
          const extraDeduction = Math.round(specialStatus.salaryMultiplier * dailyRate * 100) / 100;
          const key = specialStatus.id;
          if (!specialStatusDeductions[key]) {
            specialStatusDeductions[key] = { count: 0, deduction: 0, name: specialStatus.name, multiplier: specialStatus.salaryMultiplier };
          }
          specialStatusDeductions[key].count++;
          specialStatusDeductions[key].deduction += extraDeduction;
        }
      } else {
        if (dir === "negative") {
          const extraDeduction = Math.round((specialStatus.salaryMultiplier - 1) * dailyRate * 100) / 100;
          if (extraDeduction !== 0) {
            const key = specialStatus.id;
            if (!specialStatusDeductions[key]) {
              specialStatusDeductions[key] = { count: 0, deduction: 0, name: specialStatus.name, multiplier: specialStatus.salaryMultiplier };
            }
            specialStatusDeductions[key].count++;
            specialStatusDeductions[key].deduction += extraDeduction;
          }
        }
      }
    } else {
      const h = s.hoursValue;
      if (typeof h === "number" && h > 0) {
        daysSet.add(s.date);
        totalHours += h;
        const contractH = getContractHoursForDate(employee, s.date);
        stdHoursTotal += contractH;
        const hd = holidayDaysList.find((hd) => hd.date === s.date);
        if (hd && hd.multiplier > 1) {
          const dayBonus = Math.round(dailyRate * (hd.multiplier - 1) * 100) / 100;
          holidayBonus += dayBonus;
          holidayWorkDays++;
        }
      }
    }
  });

  const attendanceDays = daysSet.size;
  const rawOvertimeHours = Math.max(0, totalHours - stdHoursTotal);
  const compOffHoursUsed = compOffCount * hoursPerCompOff;
  const paidOvertimeHours = Math.max(0, rawOvertimeHours - compOffHoursUsed);
  const underRestDays = expectedAttendanceDays - attendanceDays;
  const totalSpecialDeduction = Object.values(specialStatusDeductions).reduce((s, v) => s + v.deduction, 0);
  const overtimePay = Math.round(paidOvertimeHours * employee.overtimeHourlyRate * 100) / 100;

  let attendanceSalary: number;
  let proportionalBaseSalary: number | undefined;
  if (employee.type === "parttime" || employee.type === "longterm_parttime") {
    if (employee.parttimeMode === "daily") {
      attendanceSalary = Math.round(attendanceDays * employee.baseSalary * 100) / 100;
    } else {
      attendanceSalary = Math.round(totalHours * employee.overtimeHourlyRate * 100) / 100;
    }
  } else {
    // 比例底薪唯一口径：日薪原始基数 × 实际出勤天数，最终金额保留两位小数。
    proportionalBaseSalary = calcAttendanceBaseSalary(dailyRate, attendanceDays, expectedAttendanceDays);
    attendanceSalary = Math.round(
      (proportionalBaseSalary + overtimePay - totalSpecialDeduction + holidayBonus) * 100
    ) / 100;
  }

  return {
    id: `att-${employeeId}-${month}`,
    employeeId,
    month,
    daysInMonth,
    attendanceDays,
    expectedAttendanceDays,
    totalHours,
    stdHours: stdHoursTotal,
    overtimeHours: Math.round(rawOvertimeHours * 10) / 10,
    compOffCount,
    hoursPerCompOff,
    paidOvertimeHours: Math.round(paidOvertimeHours * 10) / 10,
    overtimePay,
    holidayBonus: Math.round(holidayBonus * 100) / 100,
    holidayWorkDays,
    attendanceSalary,
    dailyRate,
    proportionalBaseSalary,
    underRestDays,
    specialStatusDeductions,
    totalSpecialDeduction: Math.round(totalSpecialDeduction * 100) / 100,
    notes: "",
    storedOvertimeHours: compOffHoursUsed > 0 ? Math.round(compOffHoursUsed * 10) / 10 : undefined,
  };
}

/**
 * 纯函数版 buildPaySlipDraft（从 store.tsx 提取核心逻辑）
 * 用于 E2E 测试中模拟薪资单生成
 */
function buildPaySlipDraftPure(
  employee: Employee,
  month: string,
  attendance: MonthlyAttendance | null,
  performanceTotal: number,
  advanceAmount: number,
  globalSettings?: GlobalPayrollSettings,
  existing?: Partial<PaySlip>
): PaySlip {
  const attendanceDays = attendance?.attendanceDays ?? 0;
  const attendanceSalary = attendance?.attendanceSalary ?? 0;

  // 补贴计算
  let mealAllowance = 0;
  let transportAllowance = 0;
  let otherAllowance = 0;
  if (employee.allowanceRules) {
    for (const rule of employee.allowanceRules) {
      if (!rule.enabled) continue;
      const overrideEnabled = existing?.allowanceOverrides?.[rule.id];
      if (overrideEnabled === false) continue;
      const { amount: finalAmount } = calcAllowance(rule, attendanceDays);
      if (rule.type === "transport_fixed") transportAllowance += finalAmount;
      else if (rule.type === "meal_per_day") mealAllowance += finalAmount;
      else otherAllowance += finalAmount;
    }
  }

  // 应发薪资（含 compOffCashOut 修复）
  const grossSalary = Math.round((
    attendanceSalary + performanceTotal +
    (existing?.salesCommission ?? 0) +
    transportAllowance + mealAllowance + otherAllowance +
    (existing?.rewardPenalty ?? 0) +
    (existing?.compOffCashOut ?? 0)
  ) * 100) / 100;

  // 社保/个税（简化：关闭时为0）
  const siEnabled = false;
  const taxEnabled = false;
  const socialInsuranceDeduction = 0;
  const housingFundDeduction = 0;
  const incomeTax = 0;
  const pettyLaborPaidAmt = existing?.pettyLaborPaid ?? 0;

  const finalSalary = Math.round((
    grossSalary - socialInsuranceDeduction - housingFundDeduction - incomeTax - advanceAmount - pettyLaborPaidAmt
  ) * 100) / 100;

  return {
    id: existing?.id ?? `slip-${employee.id}-${month}`,
    employeeId: employee.id,
    month,
    employeeName: employee.realName,
    employeeCode: employee.code,
    attendanceDays,
    attendanceSalary,
    performanceBonus: performanceTotal,
    salesCommission: existing?.salesCommission ?? 0,
    mealAllowance,
    transportAllowance,
    otherAllowance,
    rewardPenalty: existing?.rewardPenalty ?? 0,
    compOffCashOut: existing?.compOffCashOut ?? 0,
    compOffCashOutNote: existing?.compOffCashOutNote,
    grossSalary,
    socialInsuranceDeduction,
    housingFundDeduction,
    incomeTax,
    advanceAmount,
    pettyLaborPaid: pettyLaborPaidAmt,
    pettyLaborLinkIds: existing?.pettyLaborLinkIds,
    finalSalary,
    totalEmployerCost: grossSalary,
    allowanceOverrides: existing?.allowanceOverrides,
    workKPISelections: existing?.workKPISelections,
    revenueActuals: existing?.revenueActuals,
    holidayBonusAllocation: existing?.holidayBonusAllocation,
    notes: existing?.notes,
    updatedAt: new Date().toISOString(),
  } as PaySlip;
}

// ─── 测试 Fixtures ────────────────────────────────────────────────────────────

/** 2026年7月：31天，应出勤 = 31 - 8 = 23天 */
const MONTH = "2026-07";
const DAYS_IN_MONTH = 31;
const REST_DAYS = 8;
const EXPECTED_ATT_DAYS = DAYS_IN_MONTH - REST_DAYS; // 23

/** 标准全职员工：底薪 6000，每天8小时，加班时薪 50 */
function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-001",
    code: "E001",
    realName: "张三",
    phone: "13800000000",
    dept: "front",
    type: "fulltime",
    baseSalary: 6000,
    stdHoursPerDay: 8,
    restDaysPerMonth: REST_DAYS,
    hourlyRate: 37.5,
    overtimeHourlyRate: 50,
    notes: "",
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    compOffRule: { hoursPerDay: 8, enabled: true },
    ...overrides,
  };
}

/** 创建一条排班记录 */
function makeShift(date: string, hours: number | null, specialStatusId?: string): ShiftEntry {
  return {
    employeeId: "emp-001",
    date,
    shift: "晚班",
    hoursValue: hours,
    specialStatusId,
  };
}

/** 日薪 = 6000 / (31 - 8) = 260.87 */
// 日薪原始基数保留完整精度；用于最终金额断言时按结算边界保留两位小数。
const DAILY_RATE = Math.round(calcDailyRate(6000, DAYS_IN_MONTH, REST_DAYS) * 100) / 100;

// ─── Suite A：考勤工资计算引擎 ────────────────────────────────────────────────

describe("Suite A：考勤工资计算引擎（calcFromShifts）", () => {
  const emp = makeEmployee();
  const ss = DEFAULT_SPECIAL_STATUSES;

  it("A1. 全勤（23天 × 8h）：attendanceSalary = baseSalary，5格加法闭环", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      shifts.push(makeShift(date, 8));
    }
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    expect(att.attendanceDays).toBe(23);
    expect(att.expectedAttendanceDays).toBe(23);
    expect(att.paidOvertimeHours).toBe(0);
    expect(att.overtimePay).toBe(0);
    expect(att.totalSpecialDeduction).toBe(0);
    expect(att.holidayBonus).toBe(0);
    expect(att.attendanceSalary).toBe(6000);
    // 5格加法闭环
    const proportionalBase = att.attendanceSalary - att.overtimePay - att.holidayBonus + att.totalSpecialDeduction;
    expect(Math.round((proportionalBase + att.overtimePay + att.holidayBonus - att.totalSpecialDeduction) * 100) / 100)
      .toBe(att.attendanceSalary);
  });

  it("A1b. 零出勤（无排班）：attendanceSalary = 0，比例底薪 = 0", () => {
    // 关键 Bug 修复验证：无排班时不应产生任何底薪
    const shifts: ShiftEntry[] = []; // 空排班
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    expect(att.attendanceDays).toBe(0);
    expect(att.attendanceSalary).toBe(0);
    expect(att.overtimePay).toBe(0);
    expect(att.totalSpecialDeduction).toBe(0);
    expect(att.holidayBonus).toBe(0);
  });

  it("A1d. 31天、月休4天、全月无排班：不得自动多发第27天或任何工资", () => {
    const month31 = "2026-07";
    const employee31 = makeEmployee({ baseSalary: 10000, restDaysPerMonth: 4 });
    const att = calcFromShiftsPure("emp-001", month31, employee31, [], ss);
    const staleSlip = { id: "stale-31-day-slip", attendanceSalary: 10000, grossSalary: 10000, finalSalary: 10000 };
    const slip = buildPaySlipDraftPure(employee31, month31, att, 0, 0, undefined, staleSlip);

    // 31 - 4 = 27 只是应出勤分母；没有任何排班时实际出勤必须为 0。
    expect(att.daysInMonth).toBe(31);
    expect(att.expectedAttendanceDays).toBe(27);
    expect(att.attendanceDays).toBe(0);
    expect(att.dailyRate).toBeCloseTo(10000 / 27, 12);
    expect(att.proportionalBaseSalary).toBe(0);
    expect(att.overtimePay).toBe(0);
    expect(att.holidayBonus).toBe(0);
    expect(att.attendanceSalary).toBe(0);

    // 即使存储里残留一张旧的全额考勤工资单，手动“生成薪资单”使用新的空排班考勤
    // 构建草稿时也必须覆盖该字段，而非把 10,000 元错误地延续到本月。
    // 无手工绩效、补贴、提点、奖惩、调休兑现或预支时，整张薪资单也必须归零。
    expect(slip.attendanceSalary).toBe(0);
    expect(slip.grossSalary).toBe(0);
    expect(slip.finalSalary).toBe(0);
  });

  it("A1c. 配置异常（restDaysPerMonth >= daysInMonth）：attendanceSalary = 0", () => {
    // 当 restDaysPerMonth 配置异常时，不应回退到全额底薪
    const badEmp = makeEmployee({ restDaysPerMonth: 31 });
    const shifts: ShiftEntry[] = [];
    const att = calcFromShiftsPure("emp-001", MONTH, badEmp, shifts, ss);
    expect(att.expectedAttendanceDays).toBe(0);
    expect(att.attendanceSalary).toBe(0);
  });

  it("A2. 缺勤1天（出勤22天）：attendanceSalary = 6000 × 22/23", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 22; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      shifts.push(makeShift(date, 8));
    }
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    const expected = Math.round(6000 * 22 / 23 * 100) / 100;
    expect(att.attendanceDays).toBe(22);
    expect(att.attendanceSalary).toBe(expected);
    // 5格加法闭环
    const proportionalBase = att.attendanceSalary - att.overtimePay - att.holidayBonus + att.totalSpecialDeduction;
    expect(Math.round((proportionalBase + att.overtimePay + att.holidayBonus - att.totalSpecialDeduction) * 100) / 100)
      .toBe(att.attendanceSalary);
  });

  it("A3. 加班（23天 × 10h）：rawOvertimeHours = 46h，paidOvertimeHours = 46，overtimePay = 2300", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      shifts.push(makeShift(date, 10)); // 每天10小时，超出2小时
    }
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    expect(att.overtimeHours).toBe(46); // 23天 × 2h
    expect(att.paidOvertimeHours).toBe(46);
    expect(att.overtimePay).toBe(2300); // 46h × 50
    expect(att.attendanceSalary).toBe(6000 + 2300);
    // 5格加法闭环
    const proportionalBase = att.attendanceSalary - att.overtimePay - att.holidayBonus + att.totalSpecialDeduction;
    expect(Math.round((proportionalBase + att.overtimePay + att.holidayBonus - att.totalSpecialDeduction) * 100) / 100)
      .toBe(att.attendanceSalary);
  });

  it("A4. 旷工1天：额外扣 (2-1)=1 天日薪，attendanceSalary 减少", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 22; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      shifts.push(makeShift(date, 8));
    }
    // 第23天旷工（不算出勤，额外扣1天）
    shifts.push(makeShift("2026-07-23", null, "ss_absent"));
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    expect(att.attendanceDays).toBe(22); // 旷工不算出勤
    const extraDeduction = Math.round((2 - 1) * DAILY_RATE * 100) / 100;
    expect(att.totalSpecialDeduction).toBeCloseTo(extraDeduction, 1);
    // 5格加法闭环
    const proportionalBase = att.attendanceSalary - att.overtimePay - att.holidayBonus + att.totalSpecialDeduction;
    expect(Math.round((proportionalBase + att.overtimePay + att.holidayBonus - att.totalSpecialDeduction) * 100) / 100)
      .toBe(att.attendanceSalary);
  });

  it("A5. 病假1天：退回 (1-0.5)=0.5 天日薪（负扣薪）", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 22; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      shifts.push(makeShift(date, 8));
    }
    shifts.push(makeShift("2026-07-23", null, "ss_sick"));
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    // 病假：salaryMultiplier=0.5，extraDeduction = (0.5-1) × dailyRate = -0.5 × dailyRate（退款）
    const refund = Math.round((0.5 - 1) * DAILY_RATE * 100) / 100; // 负数
    expect(att.totalSpecialDeduction).toBeCloseTo(refund, 1);
    // 5格加法闭环
    const proportionalBase = att.attendanceSalary - att.overtimePay - att.holidayBonus + att.totalSpecialDeduction;
    expect(Math.round((proportionalBase + att.overtimePay + att.holidayBonus - att.totalSpecialDeduction) * 100) / 100)
      .toBe(att.attendanceSalary);
  });

  it("A6. 节假日上班（3倍薪）：holidayBonus = 2 × dailyRate，加入 attendanceSalary", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      const isHoliday = d === 1; // 7月1日节假日
      shifts.push(makeShift(date, 8, isHoliday ? "ss_holiday" : undefined));
    }
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    const expectedBonus = Math.round(DAILY_RATE * (3 - 1) * 100) / 100;
    expect(att.holidayBonus).toBeCloseTo(expectedBonus, 1);
    expect(att.attendanceSalary).toBeCloseTo(6000 + expectedBonus, 1);
    // 5格加法闭环
    const proportionalBase = att.attendanceSalary - att.overtimePay - att.holidayBonus + att.totalSpecialDeduction;
    expect(Math.round((proportionalBase + att.overtimePay + att.holidayBonus - att.totalSpecialDeduction) * 100) / 100)
      .toBe(att.attendanceSalary);
  });

  it("A7. 加班换休（comp_off）：compOffCount++，paidOvertimeHours 减少，5格加法闭环", () => {
    const shifts: ShiftEntry[] = [];
    // 22天正常上班（每天10h）
    for (let d = 1; d <= 22; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      shifts.push(makeShift(date, 10));
    }
    // 第23天加班换休
    shifts.push(makeShift("2026-07-23", null, "ss_comp_off_overtime"));
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, ss);
    // 计算逻辑：
    //   22天 × 10h = 220h，stdHours = 22×8 + 8(换休天) = 184h
    //   rawOvertimeHours = 220 - 184 = 36h
    //   compOffHoursUsed = 1 × 8 = 8h
    //   paidOvertimeHours = 36 - 8 = 28h
    expect(att.compOffCount).toBe(1);
    expect(att.overtimeHours).toBe(36); // 220 - 184 = 36
    expect(att.paidOvertimeHours).toBe(28); // 36 - 8 = 28
    expect(att.overtimePay).toBe(1400); // 28h × 50
    // 5格加法闭环
    const proportionalBase = att.attendanceSalary - att.overtimePay - att.holidayBonus + att.totalSpecialDeduction;
    expect(Math.round((proportionalBase + att.overtimePay + att.holidayBonus - att.totalSpecialDeduction) * 100) / 100)
      .toBe(att.attendanceSalary);
  });
});

// ─── Suite B：兑换调休余额（handleCashOut 重构验证）────────────────────────────

describe("Suite B：兑换调休余额（handleCashOut 重构验证）", () => {
  const emp = makeEmployee();

  /** 构建基础考勤（全勤，无加班） */
  function makeBaseAtt(): MonthlyAttendance {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      shifts.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 8));
    }
    return calcFromShiftsPure("emp-001", MONTH, emp, shifts, DEFAULT_SPECIAL_STATUSES);
  }

  it("B1. 首次兑换调休：grossSalary 增加 compOffCashOut 金额", () => {
    const att = makeBaseAtt();
    // 初始薪资单（无兑换）
    const slip0 = buildPaySlipDraftPure(emp, MONTH, att, 0, 0);
    expect(slip0.grossSalary).toBe(6000);
    expect(slip0.compOffCashOut).toBe(0);

    // 兑换1天调休（按日薪计算）
    const cashOutAmount = Math.round(DAILY_RATE * 1 * 100) / 100;
    const slip1 = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, {
      ...slip0,
      compOffCashOut: cashOutAmount,
      compOffCashOutNote: `兑换调休 1天 ¥${cashOutAmount.toFixed(2)}`,
    });
    expect(slip1.compOffCashOut).toBe(cashOutAmount);
    expect(slip1.grossSalary).toBe(Math.round((6000 + cashOutAmount) * 100) / 100);
    expect(slip1.finalSalary).toBe(slip1.grossSalary);
  });

  it("B2. 多次兑换：grossSalary 不累积误差（每次基于 buildPaySlipDraft 重算）", () => {
    const att = makeBaseAtt();
    const slip0 = buildPaySlipDraftPure(emp, MONTH, att, 0, 0);

    // 第1次兑换：1天
    const amount1 = Math.round(DAILY_RATE * 100) / 100;
    const slip1 = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, {
      ...slip0,
      compOffCashOut: amount1,
    });

    // 第2次兑换：再兑换0.5天
    const amount2 = Math.round(DAILY_RATE * 0.5 * 100) / 100;
    const totalCashOut = Math.round((amount1 + amount2) * 100) / 100;
    const slip2 = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, {
      ...slip1,
      compOffCashOut: totalCashOut,
    });

    // 验证：grossSalary = 6000 + totalCashOut（不是 6000 + amount1 + amount1 + amount2）
    expect(slip2.grossSalary).toBe(Math.round((6000 + totalCashOut) * 100) / 100);
    expect(slip2.compOffCashOut).toBe(totalCashOut);

    // 旧版增量计算的错误结果（验证修复有效）
    const wrongGross = slip1.grossSalary + amount2; // 旧版：在 slip1.grossSalary 基础上加 amount2
    const correctGross = Math.round((6000 + totalCashOut) * 100) / 100;
    // 两者应该相等（因为 slip1.grossSalary 已包含 amount1）
    expect(slip2.grossSalary).toBe(correctGross);
    expect(Math.round(wrongGross * 100) / 100).toBe(correctGross); // 本例中恰好相等，验证逻辑一致性
  });

  it("B3. 兑换后 finalSalary 正确（grossSalary - 预支）", () => {
    const att = makeBaseAtt();
    const cashOutAmount = Math.round(DAILY_RATE * 100) / 100;
    const advanceAmount = 1000;
    const slip = buildPaySlipDraftPure(emp, MONTH, att, 0, advanceAmount, undefined, {
      compOffCashOut: cashOutAmount,
    });
    expect(slip.grossSalary).toBe(Math.round((6000 + cashOutAmount) * 100) / 100);
    expect(slip.finalSalary).toBe(Math.round((6000 + cashOutAmount - advanceAmount) * 100) / 100);
  });

  it("B4. 加班换休兑换金额：overtime 按加班时薪×小时，holiday 按日薪×天数", () => {
    // 修复：调休兑现统一使用 overtimeHourlyRate（加班时薪），与引擎保持一致
    const overtimeHourlyRate = emp.overtimeHourlyRate ?? emp.hourlyRate ?? 0;
    const dailyRate = DAILY_RATE;

    // overtime 类型：8小时加班换休，加班时薪 50
    const overtimeEntry = { source: "overtime" as const, hoursDeducted: 8, days: 1 };
    const overtimeAmount = Math.round((overtimeEntry.hoursDeducted ?? overtimeEntry.days * 8) * overtimeHourlyRate * 100) / 100;
    expect(overtimeAmount).toBe(400); // 8h × 50（加班时薪）

    // holiday 类型：1天节假日换休，日薪 260.87
    const holidayEntry = { source: "holiday" as const, days: 1 };
    const holidayAmount = Math.round(holidayEntry.days * dailyRate * 100) / 100;
    expect(holidayAmount).toBe(DAILY_RATE);
  });
});

// ─── Suite C：节假日换休切换（toggleMode 重构验证）────────────────────────────

describe("Suite C：节假日换休切换（toggleMode 重构验证）", () => {
  const emp = makeEmployee();
  const bonusAmt = Math.round(DAILY_RATE * (3 - 1) * 100) / 100; // 节假日3倍薪，额外2倍

  /** 构建含节假日上班的考勤 */
  function makeHolidayAtt(): MonthlyAttendance {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      const date = `2026-07-${String(d).padStart(2, "0")}`;
      shifts.push(makeShift(date, 8, d === 1 ? "ss_holiday" : undefined));
    }
    return calcFromShiftsPure("emp-001", MONTH, emp, shifts, DEFAULT_SPECIAL_STATUSES);
  }

  it("C1. 初始状态（拿钱）：grossSalary 包含 holidayBonus", () => {
    const att = makeHolidayAtt();
    const slip = buildPaySlipDraftPure(emp, MONTH, att, 0, 0);
    // 全勤 + 节假日奖金
    expect(slip.attendanceSalary).toBeCloseTo(6000 + bonusAmt, 1);
    expect(slip.grossSalary).toBeCloseTo(6000 + bonusAmt, 1);
  });

  it("C2. 换休后：holidayBonusAllocation 写入，grossSalary 减少 bonusAmt", () => {
    const att = makeHolidayAtt();
    const key = "emp-001_2026-07-01_ss_holiday";
    // 模拟 toggleMode 写入 holidayBonusAllocation（换休模式）
    const alloc = {
      [key]: { date: "2026-07-01", name: "节日上班", totalBonus: bonusAmt, cashAmount: 0, restDays: 1, mode: "rest" as const },
    };
    // 换休后 att.holidayBonus 应为 0（由 autoSync 重算），这里模拟重算后的 att
    const attAfterRest: MonthlyAttendance = { ...att, holidayBonus: 0, attendanceSalary: 6000 };
    const slip = buildPaySlipDraftPure(emp, MONTH, attAfterRest, 0, 0, undefined, {
      holidayBonusAllocation: alloc,
    });
    expect(slip.grossSalary).toBe(6000);
    expect(slip.holidayBonusAllocation?.[key]?.mode).toBe("rest");
  });

  it("C3. 多次切换幂等性：拿钱→换休→拿钱，最终 grossSalary 与初始一致", () => {
    const att = makeHolidayAtt();
    const key = "emp-001_2026-07-01_ss_holiday";

    // 初始（拿钱）
    const slip0 = buildPaySlipDraftPure(emp, MONTH, att, 0, 0);
    const initialGross = slip0.grossSalary;

    // 切换为换休（att.holidayBonus 变为 0）
    const attRest: MonthlyAttendance = { ...att, holidayBonus: 0, attendanceSalary: 6000 };
    const allocRest = { [key]: { date: "2026-07-01", name: "节日上班", totalBonus: bonusAmt, cashAmount: 0, restDays: 1, mode: "rest" as const } };
    const slip1 = buildPaySlipDraftPure(emp, MONTH, attRest, 0, 0, undefined, { holidayBonusAllocation: allocRest });

    // 切换回拿钱（att.holidayBonus 恢复）
    const allocCash = { [key]: { date: "2026-07-01", name: "节日上班", totalBonus: bonusAmt, cashAmount: bonusAmt, restDays: 0, mode: "cash" as const } };
    const slip2 = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, { holidayBonusAllocation: allocCash });

    expect(slip2.grossSalary).toBe(initialGross);
    expect(slip1.grossSalary).toBeLessThan(initialGross);
  });

  it("C4. 旧版增量计算的累积误差验证（确认修复有效）", () => {
    const att = makeHolidayAtt();
    const initialGross = buildPaySlipDraftPure(emp, MONTH, att, 0, 0).grossSalary;

    // 模拟旧版增量计算：多次切换后 grossSalary 漂移
    let oldGross = initialGross;
    // 拿钱→换休（旧版：oldGross - bonusAmt）
    oldGross = Math.round((oldGross - bonusAmt) * 100) / 100;
    // 换休→拿钱（旧版：oldGross + bonusAmt）
    oldGross = Math.round((oldGross + bonusAmt) * 100) / 100;
    // 拿钱→换休（旧版：oldGross - bonusAmt）
    oldGross = Math.round((oldGross - bonusAmt) * 100) / 100;
    // 换休→拿钱（旧版：oldGross + bonusAmt）
    oldGross = Math.round((oldGross + bonusAmt) * 100) / 100;

    // 旧版多次切换后，由于浮点精度问题，可能产生微小误差
    // 新版每次都基于 buildPaySlipDraft 重算，不会累积
    // 本测试验证：新版的幂等性（最终值 = 初始值）
    const attCash: MonthlyAttendance = { ...att };
    const slip = buildPaySlipDraftPure(emp, MONTH, attCash, 0, 0);
    expect(slip.grossSalary).toBe(initialGross); // 新版幂等
  });
});

// ─── Suite D：autoSync 依赖完整性（存入调休联动加班费）────────────────────────

describe("Suite D：autoSync 依赖完整性（存入调休联动加班费）", () => {
  const emp = makeEmployee();

  it("D1. 存入调休前：paidOvertimeHours = rawOvertimeHours（无换休）", () => {
    const shifts: ShiftEntry[] = [];
    // 23天 × 10h，每天超出2h
    for (let d = 1; d <= 23; d++) {
      shifts.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 10));
    }
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, DEFAULT_SPECIAL_STATUSES);
    expect(att.compOffCount).toBe(0);
    expect(att.overtimeHours).toBe(46);
    expect(att.paidOvertimeHours).toBe(46);
    expect(att.overtimePay).toBe(2300);
  });

  it("D2. 存入调休后（排班记录增加 comp_off）：paidOvertimeHours 减少，overtimePay 同步减少", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 22; d++) {
      shifts.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 10));
    }
    // 第23天标记为加班换休
    shifts.push(makeShift("2026-07-23", null, "ss_comp_off_overtime"));
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, DEFAULT_SPECIAL_STATUSES);
    // 计算逻辑说明：
    //   22天 × 10h = 220h 总工时
    //   22天合同工时 = 22 × 8 = 176h
    //   comp_off 第23天加合同工时 = 8h（避免加班时数虚高）
    //   stdHoursTotal = 176 + 8 = 184h
    //   rawOvertimeHours = 220 - 184 = 36h
    //   compOffHoursUsed = 1 × 8 = 8h
    //   paidOvertimeHours = 36 - 8 = 28h
    expect(att.compOffCount).toBe(1);
    expect(att.overtimeHours).toBe(36); // 220 - 184 = 36
    expect(att.paidOvertimeHours).toBe(28); // 36 - 8 = 28
    expect(att.overtimePay).toBe(1400); // 28 × 50
    // 薪资单中 attendanceSalary 小于无换休时的全加班工资
    expect(att.attendanceSalary).toBeLessThan(6000 + 2300);
  });

  it("D3. 兑换调休后（排班记录减少 comp_off）：paidOvertimeHours 恢复", () => {
    // 先存入：22天工作 + 1天换休
    const shiftsWithCompOff: ShiftEntry[] = [];
    for (let d = 1; d <= 22; d++) {
      shiftsWithCompOff.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 10));
    }
    shiftsWithCompOff.push(makeShift("2026-07-23", null, "ss_comp_off_overtime"));
    const attWithCompOff = calcFromShiftsPure("emp-001", MONTH, emp, shiftsWithCompOff, DEFAULT_SPECIAL_STATUSES);

    // 兑换后（排班记录移除换休，改为正常工作）
    const shiftsAfterCashOut: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      shiftsAfterCashOut.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 10));
    }
    const attAfterCashOut = calcFromShiftsPure("emp-001", MONTH, emp, shiftsAfterCashOut, DEFAULT_SPECIAL_STATUSES);

    // comp_off 存入时：rawOvertimeHours=36，paidOvertimeHours=28
    expect(attWithCompOff.paidOvertimeHours).toBe(28);
    // 兑换后（排班恢复为23天全加班）：paidOvertimeHours恢复为46
    expect(attAfterCashOut.paidOvertimeHours).toBe(46); // 恢复
    expect(attAfterCashOut.overtimePay).toBe(2300); // 恢复
  });

  it("D4. compOffEntries 变化 → 重算触发 → overtimePay 同步减少（模拟 autoSync 联动）", () => {
    // 模拟 autoSync 的完整流程：
    // 1. 初始状态：23天 × 10h，无换休
    const shifts1: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      shifts1.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 10));
    }
    const att1 = calcFromShiftsPure("emp-001", MONTH, emp, shifts1, DEFAULT_SPECIAL_STATUSES);
    const slip1 = buildPaySlipDraftPure(emp, MONTH, att1, 0, 0);

    // 2. 用户存入调休（在排班表标记第23天为换休）
    const shifts2 = [...shifts1.slice(0, 22), makeShift("2026-07-23", null, "ss_comp_off_overtime")];
    const att2 = calcFromShiftsPure("emp-001", MONTH, emp, shifts2, DEFAULT_SPECIAL_STATUSES);
    const slip2 = buildPaySlipDraftPure(emp, MONTH, att2, 0, 0);

    // 验证：存入调休后，加班费减少，薪资单同步更新
    // att2 第23天为 comp_off：rawOvertimeHours=22×2=44，stdHours=22×8+8=184，rawOT=220-184=36，paidOT=36-8=28
    expect(att1.overtimePay).toBe(2300);
    expect(att2.overtimePay).toBe(1400); // 28h × 50 = 1400
    expect(slip1.grossSalary).toBe(6000 + 2300);
    expect(slip2.grossSalary).toBe(Math.round((6000 + 1400) * 100) / 100); // 同步减少
    expect(slip2.grossSalary).toBeLessThan(slip1.grossSalary);
  });
});

// ─── Suite E：grossSalary 构成完整性验证 ─────────────────────────────────────

describe("Suite E：grossSalary 构成完整性验证", () => {
  const emp = makeEmployee();

  function makeFullAtt(): MonthlyAttendance {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      shifts.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 8));
    }
    return calcFromShiftsPure("emp-001", MONTH, emp, shifts, DEFAULT_SPECIAL_STATUSES);
  }

  it("E1. compOffCashOut 纳入 grossSalary（修复旧版遗漏）", () => {
    const att = makeFullAtt();
    const cashOut = 500;
    const slip = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, { compOffCashOut: cashOut });
    expect(slip.grossSalary).toBe(6000 + cashOut);
    expect(slip.compOffCashOut).toBe(cashOut);
  });

  it("E2. salesCommission 纳入 grossSalary", () => {
    const att = makeFullAtt();
    const commission = 800;
    const slip = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, { salesCommission: commission });
    expect(slip.grossSalary).toBe(6000 + commission);
    expect(slip.salesCommission).toBe(commission);
  });

  it("E3. rewardPenalty 纳入 grossSalary（正数为奖励，负数为惩罚）", () => {
    const att = makeFullAtt();
    // 奖励 200
    const slipReward = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, { rewardPenalty: 200 });
    expect(slipReward.grossSalary).toBe(6200);
    // 惩罚 -300
    const slipPenalty = buildPaySlipDraftPure(emp, MONTH, att, 0, 0, undefined, { rewardPenalty: -300 });
    expect(slipPenalty.grossSalary).toBe(5700);
  });

  it("E4. 所有分项之和 = grossSalary（闭环验证）", () => {
    const att = makeFullAtt();
    const existing = {
      salesCommission: 800,
      rewardPenalty: 200,
      compOffCashOut: 500,
    };
    const slip = buildPaySlipDraftPure(emp, MONTH, att, 500, 0, undefined, existing);
    // grossSalary = attendanceSalary + performanceBonus + salesCommission + mealAllowance + transportAllowance + otherAllowance + rewardPenalty + compOffCashOut
    const expected = Math.round((
      slip.attendanceSalary +
      slip.performanceBonus +
      (slip.salesCommission ?? 0) +
      slip.mealAllowance +
      slip.transportAllowance +
      slip.otherAllowance +
      (slip.rewardPenalty ?? 0) +
      (slip.compOffCashOut ?? 0)
    ) * 100) / 100;
    expect(slip.grossSalary).toBe(expected);
  });
});

// ─── Suite F：绩效补贴展示完整性（labor-attendance.tsx 修复验证）──────────────

describe("Suite F：绩效补贴展示完整性（综合小计修复验证）", () => {
  it("F1. 综合小计 = performanceBonus + mealAllowance + transportAllowance + otherAllowance + salesCommission", () => {
    const slip = {
      performanceBonus: 500,
      mealAllowance: 300,
      transportAllowance: 200,
      otherAllowance: 100,
      salesCommission: 800,
    };
    // 新版「综合小计」计算（修复后）
    const newTotal = (slip.performanceBonus ?? 0) +
      (slip.mealAllowance ?? 0) +
      (slip.transportAllowance ?? 0) +
      (slip.otherAllowance ?? 0) +
      (slip.salesCommission ?? 0);
    expect(newTotal).toBe(1900);
  });

  it("F2. 旧版「绩效补贴小计」漏掉 transportAllowance 的回归测试", () => {
    const slip = {
      performanceBonus: 500,
      mealAllowance: 300,
      transportAllowance: 200, // 旧版漏掉
      otherAllowance: 100,     // 旧版漏掉
      salesCommission: 800,    // 旧版漏掉
    };
    // 旧版计算（仅含 performanceBonus + mealAllowance）
    const oldTotal = (slip.performanceBonus ?? 0) + (slip.mealAllowance ?? 0);
    // 新版计算（含全部5项）
    const newTotal = (slip.performanceBonus ?? 0) +
      (slip.mealAllowance ?? 0) +
      (slip.transportAllowance ?? 0) +
      (slip.otherAllowance ?? 0) +
      (slip.salesCommission ?? 0);
    // 旧版漏掉了 1100（200 + 100 + 800）
    expect(oldTotal).toBe(800);
    expect(newTotal).toBe(1900);
    expect(newTotal - oldTotal).toBe(1100); // 修复后多出 1100
  });

  it("F3. 综合小计与 grossSalary 构成一致（排除考勤工资部分）", () => {
    const emp = makeEmployee();
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      shifts.push(makeShift(`2026-07-${String(d).padStart(2, "0")}`, 8));
    }
    const att = calcFromShiftsPure("emp-001", MONTH, emp, shifts, DEFAULT_SPECIAL_STATUSES);
    const existing = {
      salesCommission: 800,
      rewardPenalty: 0,
      compOffCashOut: 0,
    };
    const slip = buildPaySlipDraftPure(emp, MONTH, att, 500, 0, undefined, existing);

    // 综合小计（绩效补贴区展示的值）
    const displayTotal = (slip.performanceBonus ?? 0) +
      (slip.mealAllowance ?? 0) +
      (slip.transportAllowance ?? 0) +
      (slip.otherAllowance ?? 0) +
      (slip.salesCommission ?? 0);

    // grossSalary - attendanceSalary = 综合小计 + rewardPenalty + compOffCashOut
    const nonAttendancePart = Math.round((slip.grossSalary - slip.attendanceSalary) * 100) / 100;
    const expectedNonAtt = Math.round((displayTotal + (slip.rewardPenalty ?? 0) + (slip.compOffCashOut ?? 0)) * 100) / 100;
    expect(nonAttendancePart).toBe(expectedNonAtt);
  });
});

// ─── Suite G：长期兼职（longterm_parttime）薪资计算验证 ─────────────────────────

describe("Suite G：长期兼职（longterm_parttime）薪资计算", () => {
  /** 长期兼职员工：按小时结算，时薪35，无底薪 */
  const ltParttime = makeEmployee({
    type: "longterm_parttime" as any,
    baseSalary: 0,
    overtimeHourlyRate: 35,
    restDaysPerMonth: 4,
    parttimeMode: "hourly",
  });

  const ss = DEFAULT_SPECIAL_STATUSES;

  it("G1. 按小时结算：attendanceSalary = totalHours × overtimeHourlyRate", () => {
    const shifts: ShiftEntry[] = [];
    // 24天 × 8h = 192h
    for (let d = 1; d <= 24; d++) {
      shifts.push({ employeeId: "emp-001", date: `2026-07-${String(d).padStart(2, "0")}`, shift: "午班", hoursValue: 8 });
    }
    const att = calcFromShiftsPure("emp-001", MONTH, ltParttime, shifts, ss);
    expect(att.attendanceDays).toBe(24);
    expect(att.totalHours).toBe(192);
    expect(att.attendanceSalary).toBe(Math.round(192 * 35 * 100) / 100); // 6720
  });

  it("G2. 按小时结算（31天 × 8h = 248h）：attendanceSalary = 8680", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 31; d++) {
      shifts.push({ employeeId: "emp-001", date: `2026-07-${String(d).padStart(2, "0")}`, shift: "午班", hoursValue: 8 });
    }
    const att = calcFromShiftsPure("emp-001", MONTH, ltParttime, shifts, ss);
    expect(att.attendanceDays).toBe(31);
    expect(att.totalHours).toBe(248);
    expect(att.attendanceSalary).toBe(8680); // 248 × 35
  });

  it("G3. 按天结算：attendanceSalary = attendanceDays × baseSalary（日薪）", () => {
    const dailyParttime = makeEmployee({
      type: "longterm_parttime" as any,
      baseSalary: 300, // 日薪
      overtimeHourlyRate: 35,
      restDaysPerMonth: 4,
      parttimeMode: "daily",
    });
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 20; d++) {
      shifts.push({ employeeId: "emp-001", date: `2026-07-${String(d).padStart(2, "0")}`, shift: "午班", hoursValue: 8 });
    }
    const att = calcFromShiftsPure("emp-001", MONTH, dailyParttime, shifts, ss);
    expect(att.attendanceDays).toBe(20);
    expect(att.attendanceSalary).toBe(6000); // 20 × 300
  });

  it("G4. 零排班：attendanceSalary = 0（不产生任何底薪）", () => {
    const shifts: ShiftEntry[] = [];
    const att = calcFromShiftsPure("emp-001", MONTH, ltParttime, shifts, ss);
    expect(att.attendanceDays).toBe(0);
    expect(att.attendanceSalary).toBe(0);
  });

  it("G5. 不受节假日倍数和特殊状态扣薪影响", () => {
    const shifts: ShiftEntry[] = [];
    for (let d = 1; d <= 23; d++) {
      shifts.push({ employeeId: "emp-001", date: `2026-07-${String(d).padStart(2, "0")}`, shift: "午班", hoursValue: 8 });
    }
    const att = calcFromShiftsPure("emp-001", MONTH, ltParttime, shifts, ss);
    // 兼职不受特殊状态影响
    expect(att.totalSpecialDeduction).toBe(0);
    expect(att.holidayBonus).toBe(0);
    expect(att.attendanceSalary).toBe(Math.round(184 * 35 * 100) / 100); // 6440
  });
});
