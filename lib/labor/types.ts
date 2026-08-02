/**
 * 人工成本管理模块 - 完整类型定义
 * 基于 predawn 2月考勤工资表 + 排班表 + 薪资汇总截图
 */

// ─── 员工部门 / 类型 ──────────────────────────────────────────────────────────
export type EmployeeDept = "front" | "kitchen" | "parttime" | "other";
/**
 * fulltime = 全职
 * longterm_parttime = 长期兼职（固定排班，有月度薪资，支持薪资预支）
 * parttime = 临时兼职（按次/按小时，无固定排班）
 */
export type EmployeeType = "fulltime" | "longterm_parttime" | "parttime";

export const DEPT_LABELS: Record<EmployeeDept, string> = {
  front: "前厅",
  kitchen: "后厨",
  parttime: "兼职",
  other: "其他",
};

export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  fulltime: "全职",
  longterm_parttime: "长期兼职",
  parttime: "临时兼职",
};

export const EMPLOYEE_TYPE_COLORS: Record<EmployeeType, string> = {
  fulltime: "#007AFF",
  longterm_parttime: "#5856D6",
  parttime: "#FF9500",
};

export const DEPT_COLORS: Record<EmployeeDept, string> = {
  front: "#007AFF",    // 蓝色（前厅）
  kitchen: "#34C759",  // 绿色（后厨）
  parttime: "#FF9500", // 橙色（兼职）
  other: "#8E8E93",    // 灰色
};

// ─── 员工档案 ─────────────────────────────────────────────────────────────────
export interface Employee {
  id: string;
  /** 员工代号（如 RG, Zik, 权哥） */
  code: string;
  /** 真实姓名 */
  realName: string;
  /** 联系方式 */
  phone: string;
  /** 部门 */
  dept: EmployeeDept;
  /** 类型：全职/兼职 */
  type: EmployeeType;
  /** 底薪（月，全职专用） */
  baseSalary: number;
  /** 每日标准工时（小时/天，全职专用） */
  stdHoursPerDay: number;
  /** 月休息天数（全职专用） */
  restDaysPerMonth: number;
  /** 时薪（手动设定，兼职和全职加班都用这个） */
  hourlyRate: number;
  /** 加班时薪（默认等于时薪，可单独设定） */
  overtimeHourlyRate: number;
  /** 节假日倍率（如 1.5 = 1.5倍，2 = 2倍） */
  holidayMultiplier: number;
  /** 备注 */
  notes: string;
  /** 是否在职 */
  active: boolean;
  /**
   * 长期兼职专用：月度固定薪资（若设置，则按月结算而非纯按小时）
   * 0 = 不设置，仍按工时计算
   */
  monthlyFixedSalary: number;
  /** 銀行卡信息（用于薪资发放） */
  bankAccounts?: EmployeeBankAccount[];
  /** 创建时间 */
  createdAt: string;
}

// ─── 员工銀行卡 ───────────────────────────────────────────────────────────────────────────────────────
export interface EmployeeBankAccount {
  id: string;
  /** 账户名（通常是真实姓名） */
  accountName: string;
  /** 銀行名称 */
  bankName: string;
  /** 銀行卡号 */
  cardNumber: string;
  /** 备注 */
  note: string;
  /** 是否为默认账户 */
  isDefault: boolean;
}

// ─── 排班单元格值 ─────────────────────────────────────────────────────────────
/** 时长版本：数字（工时）或特殊标注 */
export type ShiftHoursValue = number | "休" | "无早" | null;

/** 午/晚版本：班次类型 */
export type ShiftSessionValue = "午" | "晚" | "午晚" | "休" | "无早" | null;

// ─── 排班记录（每月每员工每天） ───────────────────────────────────────────────
export interface ShiftEntry {
  /** 员工ID */
  employeeId: string;
  /** 日期 "2026-02-01" */
  date: string;
  /** 班次：白/晚 */
  shift: "day" | "evening" | "both";
  /** 时长版本：工时（小时），null=未排班，-1=休，-2=无早 */
  hoursValue: ShiftHoursValue;
  /** 午晚版本：班次标注 */
  sessionValue: ShiftSessionValue;
}

// ─── 月度考勤汇总（每员工每月） ──────────────────────────────────────────────
export interface MonthlyAttendance {
  id: string;
  /** 员工ID */
  employeeId: string;
  /** 月份 "2026-02" */
  month: string;
  /** 当月天数 */
  daysInMonth: number;
  /** 出勤天数 */
  attendanceDays: number;
  /** 总工时 */
  totalHours: number;
  /** 标准工时（出勤天数 × 每日标准工时） */
  stdHours: number;
  /** 加班时间（总工时 - 标准工时，正数为加班） */
  overtimeHours: number;
  /** 少休天数（负数表示少休，需扣款；正数表示多休） */
  underRestDays: number;
  /** 节假日加班天数（几倍天数） */
  holidayDays: number;
  /** 日薪（底薪 ÷ 实际工作天数，自动计算，可手动覆盖） */
  dailyRate: number;
  /** 是否手动覆盖日薪 */
  dailyRateOverride: boolean;
  /** 加班工资（加班时间 × 加班时薪） */
  overtimePay: number;
  /** 少休扣款（少休天数 × 日薪，负数） */
  underRestDeduction: number;
  /** 节假日补偿（节假日天数 × 日薪 × (节假日倍率-1)） */
  holidayBonus: number;
  /** 考勤工资 = 底薪 + 加班工资 - 少休扣款 + 节假日补偿 */
  attendanceSalary: number;
  /** 手动备注 */
  notes: string;
}

// ─── 薪资单（最终薪资） ───────────────────────────────────────────────────────
export interface PaySlip {
  id: string;
  /** 员工ID */
  employeeId: string;
  /** 月份 "2026-02" */
  month: string;
  /** 出勤天数 */
  attendanceDays: number;
  /** 考勤工资（来自 MonthlyAttendance） */
  attendanceSalary: number;
  /** 工作绩效 */
  performanceBonus: number;
  /** 业绩提点 */
  salesCommission: number;
  /** 吃饭补贴 */
  mealAllowance: number;
  /** 交通补贴 */
  transportAllowance: number;
  /** 其他补贴 */
  otherAllowance: number;
  /** 奖惩金额（正=奖励，负=惩罚） */
  rewardPenalty: number;
  /** 奖惩备注 */
  rewardPenaltyNote: string;
  /** 其他备注 */
  notes: string;
  /** 最终薪资 = 考勤工资 + 绩效 + 提点 + 补贴 ± 奖惩 */
  finalSalary: number;
  /** 创建/更新时间 */
  updatedAt: string;
}

// ─── 月度设置 ─────────────────────────────────────────────────────────────────
export interface MonthConfig {
  /** 月份 "2026-02" */
  month: string;
  /** 当月天数（自动计算，可手动覆盖） */
  daysInMonth: number;
  /** 月初日期 "2026-02-01" */
  startDate: string;
  /** 备注 */
  notes: string;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 计算当月天数 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 从月份字符串获取年月 */
export function parseMonth(month: string): { year: number; month: number } {
  const [y, m] = month.split("-").map(Number);
  return { year: y, month: m };
}

/** 计算日薪（底薪 ÷ 实际工作天数） */
export function calcDailyRate(baseSalary: number, daysInMonth: number, restDays: number): number {
  const workDays = daysInMonth - restDays;
  if (workDays <= 0) return 0;
  return Math.round((baseSalary / workDays) * 100) / 100;
}

/** 计算考勤工资 */
export function calcAttendanceSalary(params: {
  type: EmployeeType;
  baseSalary: number;
  dailyRate: number;
  totalHours: number;
  stdHoursPerDay: number;
  attendanceDays: number;
  overtimeHourlyRate: number;
  underRestDays: number;
  holidayDays: number;
  holidayMultiplier: number;
}): {
  overtimeHours: number;
  overtimePay: number;
  underRestDeduction: number;
  holidayBonus: number;
  attendanceSalary: number;
} {
  if (params.type === "parttime") {
    // 兼职：总工时 × 时薪
    const attendanceSalary = params.totalHours * params.overtimeHourlyRate;
    return { overtimeHours: params.totalHours, overtimePay: attendanceSalary, underRestDeduction: 0, holidayBonus: 0, attendanceSalary };
  }

  // 全职
  const stdHours = params.attendanceDays * params.stdHoursPerDay;
  const overtimeHours = Math.max(0, params.totalHours - stdHours);
  const overtimePay = Math.round(overtimeHours * params.overtimeHourlyRate * 100) / 100;

  // 少休扣款（underRestDays 为负数时表示少休）
  const underRestDeduction = params.underRestDays < 0
    ? Math.round(Math.abs(params.underRestDays) * params.dailyRate * 100) / 100
    : 0;

  // 节假日补偿（节假日天数 × 日薪 × (倍率-1)）
  const holidayBonus = params.holidayDays > 0
    ? Math.round(params.holidayDays * params.dailyRate * (params.holidayMultiplier - 1) * 100) / 100
    : 0;

  const attendanceSalary = Math.round((params.baseSalary + overtimePay - underRestDeduction + holidayBonus) * 100) / 100;

  return { overtimeHours, overtimePay, underRestDeduction, holidayBonus, attendanceSalary };
}

/** 计算最终薪资 */
export function calcFinalSalary(slip: Omit<PaySlip, "finalSalary" | "id" | "updatedAt">): number {
  return Math.round((
    slip.attendanceSalary +
    slip.performanceBonus +
    slip.salesCommission +
    slip.mealAllowance +
    slip.transportAllowance +
    slip.otherAllowance +
    slip.rewardPenalty
  ) * 100) / 100;
}

/** 生成月份标签 */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

/** 获取月份的所有日期 */
export function getMonthDates(month: string): string[] {
  const { year, month: m } = parseMonth(month);
  const days = getDaysInMonth(year, m);
  return Array.from({ length: days }, (_, i) => {
    const d = i + 1;
    return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  });
}

/** 获取日期的星期几（0=周日，1=周一...6=周六） */
export function getDayOfWeek(date: string): number {
  return new Date(date).getDay();
}

export const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export const WEEKDAY_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
