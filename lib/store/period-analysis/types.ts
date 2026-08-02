/**
 * 时段营业分析模块类型定义
 * 基于 predawn 餐时段营业统计 Excel（半小时粒度）
 *
 * 四个时段：
 *   午市   11:00-17:00
 *   晚市   17:00-22:00
 *   深夜   22:00-01:00（次日）
 *   凌晨   01:00-11:00（加班时段）
 *
 * 核心分析：
 *   - 凌晨1:00后开台记录（加班时段）
 *   - 1:30am后营业额 < 阈值 → 加班性价比提醒
 *   - 每个时段的半小时分布热力图
 */

// ─── 时段枚举 ─────────────────────────────────────────────────────────────────
export type PeriodKey = "lunch" | "dinner" | "midnight" | "late_night";

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  lunch: "午市",
  dinner: "晚市",
  midnight: "深夜",
  late_night: "凌晨（加班）",
};

export const PERIOD_TIME_RANGE: Record<PeriodKey, string> = {
  lunch: "11:00 - 17:00",
  dinner: "17:00 - 22:00",
  midnight: "22:00 - 01:00",
  late_night: "01:00 - 11:00",
};

export const PERIOD_COLORS: Record<PeriodKey, string> = {
  lunch: "#FF9500",    // 橙色（午市）
  dinner: "#5856D6",   // 紫色（晚市）
  midnight: "#007AFF", // 蓝色（深夜）
  late_night: "#FF3B30", // 红色（凌晨加班）
};

// ─── 半小时时段记录 ───────────────────────────────────────────────────────────
export interface HalfHourSlot {
  /** 时段字符串，如 "22:00-22:30" */
  slot: string;
  /** 起始小时（0-23） */
  startHour: number;
  /** 起始分钟（0 或 30） */
  startMin: number;
  /** 所属大时段 */
  period: PeriodKey;
  /** 营业额（元） */
  revenue: number;
  /** 优惠金额（元） */
  discount: number;
  /** 营业收入（元） */
  netRevenue: number;
  /** 订单量 */
  orders: number;
  /** 用餐人数 */
  guests: number;
  /** 折前单均 */
  avgOrderBefore: number;
  /** 折后单均 */
  avgOrderAfter: number;
}

// ─── 单日营业记录 ─────────────────────────────────────────────────────────────
export interface DailyPeriodRecord {
  /** 营业日期 "2026-07-31" */
  date: string;
  /** 该日所有半小时时段 */
  slots: HalfHourSlot[];
  /** 各大时段汇总 */
  periodTotals: Record<PeriodKey, {
    revenue: number;
    orders: number;
    guests: number;
    slotCount: number;
  }>;
  /** 凌晨加班时段（01:00后）是否有营业 */
  hasLateNight: boolean;
  /** 凌晨加班时段总营业额 */
  lateNightRevenue: number;
  /** 凌晨加班时段订单数 */
  lateNightOrders: number;
  /** 1:30am后的营业额（用于加班性价比判断） */
  after130amRevenue: number;
  /** 1:30am后的订单数 */
  after130amOrders: number;
  /** 是否触发加班性价比提醒（after130amRevenue < threshold） */
  overtimeAlert: boolean;
}

// ─── 月度时段分析报告 ─────────────────────────────────────────────────────────
export interface PeriodAnalysisReport {
  id: string;
  /** 月份 "2026-07" */
  month: string;
  /** 数据来源说明 */
  sourceNote: string;
  /** 逐日记录 */
  dailyRecords: DailyPeriodRecord[];
  /** 各时段月度汇总 */
  monthlyTotals: Record<PeriodKey, {
    revenue: number;
    orders: number;
    guests: number;
    activeDays: number;
    avgDailyRevenue: number;
    avgDailyOrders: number;
  }>;
  /** 半小时时段分布（跨月汇总，用于热力图） */
  slotDistribution: Record<string, {
    totalRevenue: number;
    totalOrders: number;
    activeDays: number;
    avgRevenue: number;
    period: PeriodKey;
  }>;
  /** 加班性价比提醒列表 */
  overtimeAlerts: {
    date: string;
    lateNightRevenue: number;
    after130amRevenue: number;
    orders: number;
    threshold: number;
    /** 具体低收入时段 */
    lowSlots: { slot: string; revenue: number; orders: number }[];
  }[];
  /** 加班阈值（元，可调） */
  overtimeThreshold: number;
  createdAt: string;
}

// ─── 时段分析设置 ─────────────────────────────────────────────────────────────
export interface PeriodAnalysisSettings {
  /** 加班性价比提醒阈值（默认200元） */
  overtimeThreshold: number;
  /** 是否启用凌晨加班提醒 */
  enableOvertimeAlert: boolean;
  /** 提醒时段起始（默认 01:30，即01:30am后） */
  alertStartTime: string; // "01:30"
}

export const DEFAULT_PERIOD_SETTINGS: PeriodAnalysisSettings = {
  overtimeThreshold: 200,
  enableOvertimeAlert: true,
  alertStartTime: "01:30",
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 将时段字符串分类到大时段 */
export function classifySlot(slotStr: string): PeriodKey | null {
  if (!slotStr || !slotStr.includes("-")) return null;
  const startStr = slotStr.split("-")[0].trim();
  if (!startStr.includes(":")) return null;
  const [hStr, mStr] = startStr.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
  const totalMin = h * 60 + m;

  // 凌晨 01:00-11:00
  if (totalMin >= 60 && totalMin < 660) return "late_night";
  // 午市 11:00-17:00
  if (totalMin >= 660 && totalMin < 1020) return "lunch";
  // 晚市 17:00-22:00
  if (totalMin >= 1020 && totalMin < 1320) return "dinner";
  // 深夜 22:00-00:00 + 00:00-01:00
  return "midnight";
}

/** 判断时段是否在指定时间之后（用于1:30am后判断） */
export function isAfterTime(slotStr: string, afterTime: string): boolean {
  const startStr = slotStr.split("-")[0].trim();
  const [h, m] = startStr.split(":").map(Number);
  const [ah, am] = afterTime.split(":").map(Number);
  const slotMin = h * 60 + m;
  const afterMin = ah * 60 + am;
  // 凌晨时段（0-59分钟）和（60-659分钟）
  // 对于凌晨时段，01:30 = 90分钟
  return slotMin >= afterMin && slotMin < 660; // 只在凌晨时段内判断
}

/** 格式化营业额 */
export function fmtRevenue(n: number): string {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}w`;
  return `¥${n.toFixed(0)}`;
}

/** 获取时段的起始分钟数（用于排序） */
export function slotToMinutes(slotStr: string): number {
  const startStr = slotStr.split("-")[0].trim();
  const [h, m] = startStr.split(":").map(Number);
  return h * 60 + m;
}
