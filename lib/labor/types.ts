/**
 * 人工成本管理模块 - 完整类型定义 v2
 * 新增：差异化工时、调休规则、补贴规则、绩效模板、班次模板、节假日配置、员工分组
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

// ─── 差异化工时规则（按星期设置合同工时） ────────────────────────────────────
/**
 * 每个星期几的合同工时
 * key: 0=周日, 1=周一, ..., 6=周六
 * value: 合同工时（小时），null=该天不上班/休息
 */
export type WeeklyHoursMap = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, number | null>>;

// ─── 调休规则 ─────────────────────────────────────────────────────────────────
export interface CompOffRule {
  /** 多少小时加班换1天调休（默认8） */
  hoursPerDay: number;
  /** 是否启用调休（false=全部计加班费） */
  enabled: boolean;
}

// ─── 补贴规则 ─────────────────────────────────────────────────────────────────
export type AllowanceType =
  | "transport_fixed"   // 交通补贴（固定月额）
  | "meal_per_day"      // 饭补（每出勤天 × 日额）
  | "custom_fixed"      // 自定义固定补贴
  | "custom_formula";   // 自定义公式（预留）

export interface AllowanceRule {
  id: string;
  type: AllowanceType;
  label: string;
  /** 金额（固定月额 or 每天金额） */
  amount: number;
  /** 是否启用 */
  enabled: boolean;
}

// ─── 绩效条目数据源类型 ───────────────────────────────────────────────────────
export type PerformanceDataSource =
  | "manual"            // 纯手动
  | "revenue"           // 营业额（从月报读取）
  | "net_profit"        // 净利润（从月报读取）
  | "attendance_days";  // 出勤天数（从排班表读取）

// ─── 绩效条目（模板级别） ─────────────────────────────────────────────────────
export interface PerformanceItem {
  id: string;
  /** 编号（A1/B2/C1...） */
  code: string;
  /** 条目名称 */
  title: string;
  /** 详细说明/备注 */
  description: string;
  /** 最高可得金额（0=无上限） */
  maxAmount: number;
  /** 是否固定金额（固定则 actualAmount = maxAmount，不需填写） */
  isFixed: boolean;
  /** 数据来源 */
  dataSource: PerformanceDataSource;
  /**
   * 阶梯规则（用于营业额提点、好评数等）
   * 例：[{ threshold: 50000, rate: 0.04 }, { threshold: 90000, rate: 0.05 }]
   * threshold = 达到该值时，rate = 提成比例（0.04 = 4%）
   */
  tiers?: Array<{ threshold: number; rate: number; label?: string }>;
  /** 排序权重 */
  sortOrder: number;
}

// ─── 绩效分组（模板级别） ─────────────────────────────────────────────────────
export interface PerformanceGroup {
  id: string;
  /** 分组标题（A / B / 工作绩效 / 利润提点...） */
  title: string;
  /** 分组说明 */
  description: string;
  /** 该分组下的条目 */
  items: PerformanceItem[];
  /** 排序权重 */
  sortOrder: number;
}

// ─── 绩效模板（每位员工一个） ─────────────────────────────────────────────────
export interface PerformanceTemplate {
  id: string;
  /** 员工ID */
  employeeId: string;
  /** 模板名称 */
  name: string;
  /** 分组列表 */
  groups: PerformanceGroup[];
  /** 更新时间 */
  updatedAt: string;
}

// ─── 绩效月度记录（每月填写实际完成情况） ────────────────────────────────────
export interface PerformanceRecord {
  id: string;
  /** 员工ID */
  employeeId: string;
  /** 月份 "2026-07" */
  month: string;
  /**
   * 各条目实际完成金额
   * key = PerformanceItem.id，value = 实际金额
   */
  actuals: Record<string, number>;
  /**
   * 各条目是否被人工覆盖（覆盖后显示"已修改"标记）
   * key = PerformanceItem.id
   */
  overrides: Record<string, boolean>;
  /**
   * 各条目的智能填充备注（如"本月营业额：¥82,000"）
   * key = PerformanceItem.id
   */
  autoNotes: Record<string, string>;
  /** 绩效合计（自动汇总） */
  totalPerformance: number;
  /** 更新时间 */
  updatedAt: string;
}

// ─── 班次模板 ─────────────────────────────────────────────────────────────────
/**
 * 班次名称：任意字符串，完全由用户自定义。
 * 参考餐饮行业常见班次：早班、午班、晚班、大夜班、全天班、中班等。
 * 不再限定为固定少数选项，支持增删改任意数量班次。
 */
export type ShiftSession = string;

export interface ShiftTemplate {
  id: string;
  /**
   * 班次名称（任意自定义，如"午班"、"晚班"、"早班"、"大夜班"等）
   * 排班表按此字段动态分行展示
   */
  session: string;
  /** 开始时间（如 "11:00"） */
  startTime: string;
  /** 结束时间（如 "17:00"，跨午夜写 "02:00"） */
  endTime: string;
  /** 默认工时（小时）——添加排班时自动带入，可单独修改 */
  defaultHours: number;
  /** 显示颜色（十六进制，如 "#FF9500"） */
  color: string;
  /** 排序权重（决定排班表中班次行的显示顺序，数字越小越靠前） */
  sortOrder: number;
}

/**
 * 默认班次模板（参考餐饮行业常见设置）
 * 用户可在班次模板设置页全量增删改
 */
export const DEFAULT_SHIFT_TEMPLATES: ShiftTemplate[] = [
  { id: "tpl_noon",    session: "午班", startTime: "10:30", endTime: "17:00", defaultHours: 6,  color: "#FF9500", sortOrder: 0 },
  { id: "tpl_evening", session: "晚班", startTime: "17:00", endTime: "24:00", defaultHours: 7,  color: "#5856D6", sortOrder: 1 },
];

/** 班次颜色预设（新建班次时供选择） */
export const SHIFT_COLOR_PRESETS = [
  "#FF9500", // 橙色（午班）
  "#5856D6", // 紫色（晚班）
  "#34C759", // 绿色（早班）
  "#FF3B30", // 红色（大夜班）
  "#007AFF", // 蓝色（全天班）
  "#AF52DE", // 紫红（中班）
  "#5AC8FA", // 浅蓝（早午班）
  "#FF2D55", // 玫红（大夜班）
  "#FFCC00", // 黄色
  "#8E8E93", // 灰色
];


// ─── 节假日配置 ───────────────────────────────────────────────────────────────
export interface HolidayConfig {
  id: string;
  /** 节日名称（如"国庆节"） */
  name: string;
  /** 节日日期列表（"2026-10-01"...） */
  dates: string[];
  /** 工资倍率（如 2 = 2倍，1.5 = 1.5倍） */
  multiplier: number;
  /** 适用员工ID列表（空=全部适用） */
  applicableEmployeeIds: string[];
  /** 备注（如"法定节假日第1天"） */
  notes: string;
}

/** 法定节假日参考数据 */
export const LEGAL_HOLIDAY_REFERENCE = [
  { name: "元旦", desc: "1月1日，1天", multiplier: 3 },
  { name: "春节", desc: "农历初一至初七，7天", multiplier: 3 },
  { name: "清明节", desc: "4月4-6日，1天", multiplier: 3 },
  { name: "劳动节", desc: "5月1-5日，1天", multiplier: 3 },
  { name: "端午节", desc: "农历五月初五，1天", multiplier: 3 },
  { name: "中秋节", desc: "农历八月十五，1天", multiplier: 3 },
  { name: "国庆节", desc: "10月1-7日，3天", multiplier: 3 },
];

// ─── 员工自定义分组 ───────────────────────────────────────────────────────────
export interface EmployeeGroup {
  id: string;
  /** 分组名称（如"前厅"、"后厨"、"管理层"） */
  name: string;
  /** 分组颜色 */
  color: string;
  /** 该分组内员工ID的有序列表 */
  employeeIds: string[];
  /** 排序权重（分组间排序） */
  sortOrder: number;
  /** 是否折叠 */
  collapsed: boolean;
}

/** 默认员工分组（与 DEPT 对应） */
export const DEFAULT_EMPLOYEE_GROUPS: EmployeeGroup[] = [
  { id: "grp_front",   name: "前厅",   color: "#007AFF", employeeIds: [], sortOrder: 0, collapsed: false },
  { id: "grp_kitchen", name: "后厨",   color: "#34C759", employeeIds: [], sortOrder: 1, collapsed: false },
  { id: "grp_parttime",name: "兼职",   color: "#FF9500", employeeIds: [], sortOrder: 2, collapsed: false },
  { id: "grp_other",   name: "其他",   color: "#8E8E93", employeeIds: [], sortOrder: 3, collapsed: false },
];

// ─── 员工档案（扩展版） ───────────────────────────────────────────────────────
export interface Employee {
  id: string;
  /** 员工代号（如 RG, Zik, 权哥） */
  code: string;
  /** 真实姓名 */
  realName: string;
  /** 联系方式 */
  phone: string;
  /** 部门（保留兼容） */
  dept: EmployeeDept;
  /** 类型：全职/兼职 */
  type: EmployeeType;
  /** 底薪（月，全职专用） */
  baseSalary: number;
  /** 每日标准工时（小时/天，全职专用；差异化工时优先级更高） */
  stdHoursPerDay: number;
  /**
   * 差异化工时规则（按星期设置合同工时）
   * 若设置则优先于 stdHoursPerDay
   * key: 0=周日, 1=周一...6=周六, value: 合同工时（null=休息）
   */
  weeklyHours?: WeeklyHoursMap;
  /** 月休息天数（全职专用） */
  restDaysPerMonth: number;
  /** 时薪（手动设定，兼职和全职加班都用这个） */
  hourlyRate: number;
  /** 加班时薪（默认等于时薪，可单独设定） */
  overtimeHourlyRate: number;
  /** 节假日倍率（如 1.5 = 1.5倍，2 = 2倍；被 HolidayConfig 覆盖时以 HolidayConfig 为准） */
  holidayMultiplier: number;
  /** 调休规则 */
  compOffRule?: CompOffRule;
  /** 补贴规则列表 */
  allowanceRules?: AllowanceRule[];
  /** 默认班次（决定在排班表中归属午班行还是晚班行） */
  defaultSession?: ShiftSession;
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
  // ─── 详细档案信息 ───────────────────────────────────────────────────────────
  /** 身份证号 */
  idNumber?: string;
  /** 住址 */
  address?: string;
  /** 紧急联系人姓名 */
  emergencyContactName?: string;
  /** 紧急联系人电话 */
  emergencyContactPhone?: string;
  /** 紧急联系人关系 */
  emergencyContactRelation?: string;
  /** 身份证件图片 URI（本地或 base64） */
  idCardImageUri?: string;
  /** 健康证件图片 URI */
  healthCertImageUri?: string;
  /** 健康证到期日期 YYYY-MM-DD */
  healthCertExpiry?: string;
  /** 入职日期 YYYY-MM-DD */
  joinDate?: string;
  /** 创建时间 */
  createdAt: string;
}

// ─── 员工銀行卡 ───────────────────────────────────────────────────────────────
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

/**
 * 班次标注值：任意班次名称字符串，或特殊值"休"/"无早"，或 null（未排班）
 * 不再限定为固定的午/晚选项
 */
export type ShiftSessionValue = string | "休" | "无早" | null;

// ─── 排班记录（每月每员工每天） ───────────────────────────────────────────────
export interface ShiftEntry {
  /** 员工ID */
  employeeId: string;
  /** 日期 "2026-02-01" */
  date: string;
  /**
   * 班次名称（与 ShiftTemplate.session 对应，如"午班"、"晚班"、"早班"等）
   * 同一员工同一天可有多条不同班次的记录（如同时有午班和晚班）
   * @deprecated 旧值 "day"/"evening"/"both" 会在读取时自动迁移
   */
  shift: string;
  /** 时长版本：工时（小时），null=未排班 */
  hoursValue: ShiftHoursValue;
  /** 班次标注（与 shift 相同，保留用于向后兼容） */
  sessionValue: ShiftSessionValue;
  /**
   * 加班处理方式（针对超出合同工时的部分）
   * "pay" = 计加班费（默认）
   * "comp_off" = 换调休
   */
  overtimeType?: "pay" | "comp_off";
}

// ─── 调休余额记录（每员工每月） ──────────────────────────────────────────────
export interface CompOffBalance {
  id: string;
  employeeId: string;
  month: string;
  /** 本月通过换休积累的调休天数 */
  earnedDays: number;
  /** 本月已使用的调休天数 */
  usedDays: number;
  /** 结余调休天数（可结转下月） */
  remainingDays: number;
  /** 换休明细（哪天加班换了多少调休） */
  details: Array<{ date: string; overtimeHours: number; compOffDays: number }>;
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
  /** 标准工时（按差异化工时或统一工时计算） */
  stdHours: number;
  /** 加班时间（总工时 - 标准工时，正数为加班） */
  overtimeHours: number;
  /** 换调休的加班时间（不计入加班工资） */
  compOffHours: number;
  /** 实际计费加班时间（overtimeHours - compOffHours） */
  paidOvertimeHours: number;
  /** 少休天数（负数表示少休，需扣款；正数表示多休） */
  underRestDays: number;
  /** 节假日加班天数（几倍天数） */
  holidayDays: number;
  /** 日薪（底薪 ÷ 实际工作天数，自动计算，可手动覆盖） */
  dailyRate: number;
  /** 是否手动覆盖日薪 */
  dailyRateOverride: boolean;
  /** 加班工资（计费加班时间 × 加班时薪） */
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
  /** 工作绩效（来自 PerformanceRecord.totalPerformance） */
  performanceBonus: number;
  /** 业绩提点（利润提点等，单独字段） */
  salesCommission: number;
  /** 吃饭补贴（自动计算：出勤天数 × 日额） */
  mealAllowance: number;
  /** 交通补贴（固定月额） */
  transportAllowance: number;
  /** 其他补贴 */
  otherAllowance: number;
  /** 奖惩金额（正=奖励，负=惩罚） */
  rewardPenalty: number;
  /** 奖惩备注 */
  rewardPenaltyNote: string;
  /** 预支金额（从 SalaryAdvance 自动汇总） */
  advanceAmount: number;
  /** 其他备注 */
  notes: string;
  /** 最终薪资 = 考勤工资 + 绩效 + 提点 + 补贴 ± 奖惩 */
  finalSalary: number;
  /**
   * 补贴明细（用于展示各项补贴的计算依据）
   * key = AllowanceRule.id，value = { amount, autoNote, isOverride }
   */
  allowanceDetails?: Record<string, { amount: number; autoNote: string; isOverride: boolean }>;
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

/**
 * 获取某员工某天的合同工时
 * 优先使用差异化工时规则，否则使用统一标准工时
 */
export function getContractHoursForDate(employee: Employee, date: string): number {
  const dow = new Date(date).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  if (employee.weeklyHours) {
    const h = employee.weeklyHours[dow];
    if (h === null) return 0; // 该天休息
    if (h !== undefined) return h;
  }
  return employee.stdHoursPerDay;
}

/** 计算考勤工资（支持差异化工时和调休） */
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
  /** 计费加班时间（已扣除换调休部分） */
  paidOvertimeHours?: number;
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
  // 使用计费加班时间（若提供），否则使用全部加班时间
  const billableOvertimeHours = params.paidOvertimeHours ?? overtimeHours;
  const overtimePay = Math.round(billableOvertimeHours * params.overtimeHourlyRate * 100) / 100;

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

/**
 * 自动计算补贴金额
 * @param rule 补贴规则
 * @param attendanceDays 出勤天数（饭补使用）
 * @returns { amount, autoNote }
 */
export function calcAllowance(rule: AllowanceRule, attendanceDays: number): { amount: number; autoNote: string } {
  if (!rule.enabled) return { amount: 0, autoNote: "" };
  switch (rule.type) {
    case "transport_fixed":
      return { amount: rule.amount, autoNote: `交通补贴（固定）¥${rule.amount}` };
    case "meal_per_day":
      return {
        amount: Math.round(rule.amount * attendanceDays * 100) / 100,
        autoNote: `饭补 ¥${rule.amount}/天 × ${attendanceDays}天 = ¥${(rule.amount * attendanceDays).toFixed(0)}`,
      };
    case "custom_fixed":
      return { amount: rule.amount, autoNote: `${rule.label}（固定）¥${rule.amount}` };
    default:
      return { amount: rule.amount, autoNote: rule.label };
  }
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
