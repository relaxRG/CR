/**
 * 排班 + 营业时间 + 加班预警 类型定义 (Build 135)
 *
 * 核心逻辑：
 *   1. 营业时间设置（按星期配置 + 按日期手工覆盖）
 *   2. 班次档案（增删改，月度复用）
 *   3. 排班表（ShiftEntry 已在 labor/types.ts，这里扩展加班判定）
 *   4. 加班预警（联动时段营业统计 Excel 数据）
 */

// ─── 营业时间设置 ──────────────────────────────────────────────────────────────
/** 按星期的默认关门时间（0=周日, 1=周一, ..., 6=周六） */
export interface WeekdayClosingTime {
  /** 0=周日 1=周一 ... 6=周六 */
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** 该日是否营业；未设置时兼容历史数据并视为营业。 */
  open?: boolean;
  /** 该日开门时间；未设置时回退到全局 openingTime。 */
  openingTime?: string;
  /** 关门时间 "HH:MM"，跨日用 "25:00" 表示次日01:00 */
  closingTime: string;
}

export interface BusinessHoursConfig {
  id: string;
  /** 开门时间 "HH:MM" */
  openingTime: string;
  /** 按星期的默认关门时间（7条，每天一条） */
  weekdayClosingTimes: WeekdayClosingTime[];
  /** 按日期的手工覆盖（优先于星期默认值） */
  dateOverrides: { date: string; closingTime: string; note?: string }[];
  /** 旧营业时间页面的加班预警开关；纳入同一共享配置。 */
  overtimeAlertEnabled?: boolean;
  /** 旧营业时间页面的临近关门预警分钟数；纳入同一共享配置。 */
  closingAlertMinutes?: number;
  updatedAt: string;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  id: "default",
  openingTime: "12:00",
  weekdayClosingTimes: [
    { weekday: 0, open: true, openingTime: "12:00", closingTime: "25:00" }, // 周日 01:00次日
    { weekday: 1, open: true, openingTime: "12:00", closingTime: "24:00" }, // 周一 00:00次日
    { weekday: 2, open: true, openingTime: "12:00", closingTime: "24:00" }, // 周二
    { weekday: 3, open: true, openingTime: "12:00", closingTime: "24:00" }, // 周三
    { weekday: 4, open: true, openingTime: "12:00", closingTime: "24:00" }, // 周四
    { weekday: 5, open: true, openingTime: "12:00", closingTime: "25:00" }, // 周五 01:00次日
    { weekday: 6, open: true, openingTime: "12:00", closingTime: "25:00" }, // 周六 01:00次日
  ],
  dateOverrides: [],
  overtimeAlertEnabled: true,
  closingAlertMinutes: 90,
  updatedAt: new Date().toISOString(),
};

/** 获取某日的关门时间（分钟数，跨日用 >1440 表示） */
export function getClosingMinutes(
  date: string,
  config: BusinessHoursConfig,
): number {
  // 优先按日期覆盖
  const override = config.dateOverrides.find((d) => d.date === date);
  const timeStr = override?.closingTime ?? (() => {
    const d = new Date(date);
    const weekday = d.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    return config.weekdayClosingTimes.find((w) => w.weekday === weekday)?.closingTime ?? "24:00";
  })();
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** 将 "HH:MM" 或 "25:30" 转为分钟数 */
export function timeStrToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 将分钟数转为显示字符串（如 1530 → "01:30次日"） */
export function minutesToDisplayStr(minutes: number): string {
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const h = Math.floor((minutes - 1440) / 60);
  const m = (minutes - 1440) % 60;
  return `次日 ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ─── 班次档案 ──────────────────────────────────────────────────────────────────
export interface ShiftTemplate {
  id: string;
  /** 班次名称，如「午班」「晚班」「凌晨班」 */
  name: string;
  /** 班次类型：day=白/午班，evening=晚班，custom=自定义 */
  type: "day" | "evening" | "custom";
  /** 上班时间 "HH:MM" */
  startTime: string;
  /** 下班时间 "HH:MM"（跨日用 "25:00" 表示次日01:00） */
  endTime: string;
  /** 标准时长（小时，自动计算） */
  standardHours: number;
  /** 标准人数（该班次通常安排几人） */
  standardHeadcount: number;
  /** 颜色 */
  color: string;
  /** 排序 */
  sortOrder: number;
  createdAt: string;
}

export const DEFAULT_SHIFT_TEMPLATES: ShiftTemplate[] = [
  {
    id: "day",
    name: "午班",
    type: "day",
    startTime: "11:00",
    endTime: "17:00",
    standardHours: 6,
    standardHeadcount: 2,
    color: "#FF9500",
    sortOrder: 0,
    createdAt: new Date().toISOString(),
  },
  {
    id: "evening",
    name: "晚班",
    type: "evening",
    startTime: "17:00",
    endTime: "24:00",
    standardHours: 8,
    standardHeadcount: 3,
    color: "#5856D6",
    sortOrder: 1,
    createdAt: new Date().toISOString(),
  },
];

// ─── 加班判定 ──────────────────────────────────────────────────────────────────
export interface OvertimeJudgment {
  /** 员工ID */
  employeeId: string;
  /** 日期 */
  date: string;
  /** 班次类型（来自 ShiftEntry.shift） */
  shift: "day" | "evening" | "both";
  /** 实际工时（来自 ShiftEntry.hoursValue） */
  actualHours: number;
  /** 对应班次模板的标准下班时间（分钟） */
  shiftEndMinutes: number;
  /** 实际下班时间（分钟）= 上班时间 + 实际工时 */
  actualEndMinutes: number;
  /** 当天关门时间（分钟） */
  closingMinutes: number;
  /** 是否加班 */
  isOvertime: boolean;
  /** 加班时长（分钟） */
  overtimeMinutes: number;
  /** 加班开始时间（分钟，= max(实际下班, 关门时间) 的开始） */
  overtimeStartMinutes: number;
  /** 加班结束时间（分钟） */
  overtimeEndMinutes: number;
}

/** 计算某员工某天的加班情况 */
export function calcOvertimeJudgment(params: {
  employeeId: string;
  date: string;
  shift: "day" | "evening" | "both";
  actualHours: number | "休" | "无早" | null;
  shiftTemplates: ShiftTemplate[];
  businessHours: BusinessHoursConfig;
}): OvertimeJudgment | null {
  const { employeeId, date, shift, actualHours, shiftTemplates, businessHours } = params;

  // 无效工时（休/无早/null）不判定
  if (typeof actualHours !== "number" || actualHours <= 0) return null;

  // 找对应班次模板
  const templateType = shift === "day" ? "day" : "evening";
  const template = shiftTemplates.find((t) => t.type === templateType)
    ?? DEFAULT_SHIFT_TEMPLATES.find((t) => t.type === templateType)!;

  const shiftStartMinutes = timeStrToMinutes(template.startTime);
  const shiftEndMinutes = timeStrToMinutes(template.endTime);
  const actualEndMinutes = shiftStartMinutes + actualHours * 60;
  const closingMinutes = getClosingMinutes(date, businessHours);

  const isOvertime = actualEndMinutes > closingMinutes;
  const overtimeMinutes = isOvertime ? actualEndMinutes - closingMinutes : 0;

  return {
    employeeId,
    date,
    shift,
    actualHours,
    shiftEndMinutes,
    actualEndMinutes,
    closingMinutes,
    isOvertime,
    overtimeMinutes,
    overtimeStartMinutes: closingMinutes,
    overtimeEndMinutes: actualEndMinutes,
  };
}

// ─── 加班预警 ──────────────────────────────────────────────────────────────────
export type OvertimeAlertLevel = "poor" | "ok" | "unscheduled" | "none";

export interface OvertimeAlert {
  /** 日期 */
  date: string;
  /** 预警级别 */
  level: OvertimeAlertLevel;
  /** 加班员工列表 */
  overtimeEmployees: {
    employeeId: string;
    employeeName: string;
    overtimeMinutes: number;
    overtimeStartTime: string; // "00:00"
    overtimeEndTime: string;   // "02:00"
  }[];
  /** 加班时段的营业额（来自时段营业统计 Excel） */
  overtimeRevenue: number;
  /** 加班时段的订单数 */
  overtimeOrders: number;
  /** 预警阈值 */
  threshold: number;
  /** 说明 */
  message: string;
}

export const OVERTIME_ALERT_COLORS: Record<OvertimeAlertLevel, string> = {
  poor: "#FF3B30",        // 红色：加班性价比不佳
  ok: "#FF9500",          // 橙色：加班有效
  unscheduled: "#007AFF", // 蓝色：有凌晨营业但无加班排班
  none: "#8E8E93",        // 灰色：无加班
};

export const OVERTIME_ALERT_LABELS: Record<OvertimeAlertLevel, string> = {
  poor: "加班性价比不佳",
  ok: "加班有效",
  unscheduled: "未排班有营业",
  none: "正常",
};

// ─── 月度排班汇总（用于预警联动） ─────────────────────────────────────────────
export interface MonthlyScheduleSummary {
  /** 月份 "2026-08" */
  month: string;
  /** 每日加班判定结果 */
  dailyOvertimeJudgments: OvertimeJudgment[];
  /** 每日加班预警（联动时段营业统计后生成） */
  dailyAlerts: OvertimeAlert[];
  /** 本月加班预警汇总 */
  totalOvertimeDays: number;
  totalPoorDays: number;
  totalOkDays: number;
  updatedAt: string;
}
