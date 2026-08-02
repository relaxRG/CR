/**
 * 餐时段营业统计 Excel 解析器
 *
 * 文件格式（按日统计，半小时粒度）：
 *   行1: 标题
 *   行2: 统计说明
 *   行3: 表头 [营业日期, 半小时, 营业额, 优惠金额, 营业收入, 订单量, 折前单均, 折后单均, 用餐人数, 折前人均, 折后人均]
 *   行4+: 数据
 *
 * 注意：可能有两个文件（同一数据集），需去重
 */
import * as XLSX from "xlsx";
import {
  HalfHourSlot, DailyPeriodRecord, PeriodAnalysisReport,
  PeriodAnalysisSettings, DEFAULT_PERIOD_SETTINGS,
  classifySlot, isAfterTime, slotToMinutes,
  PERIOD_LABELS,
} from "./types";
import type { PeriodKey } from "./types";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

interface RawRow {
  date: string;
  slot: string;
  revenue: number;
  discount: number;
  netRevenue: number;
  orders: number;
  avgBefore: number;
  avgAfter: number;
  guests: number;
  perPersonBefore: number;
  perPersonAfter: number;
}

function parseDate(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw).trim().replace(/\//g, "-");
  // 处理 "2026-07-31" 格式
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 处理 Excel 日期数字
  if (typeof raw === "number") {
    const d = XLSX.SSF.parse_date_code(raw);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  return s;
}

function safeNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function parsePeriodAnalysisExcel(
  fileContents: ArrayBuffer[],
  settings: PeriodAnalysisSettings = DEFAULT_PERIOD_SETTINGS
): PeriodAnalysisReport | null {
  // 收集所有行，去重（key = date+slot）
  const rowMap = new Map<string, RawRow>();

  for (const buf of fileContents) {
    try {
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

      // 找到表头行（含"营业日期"的行）
      let headerRow = -1;
      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const row = rows[i] as unknown[];
        if (row && row[0] && String(row[0]).includes("营业日期")) {
          headerRow = i;
          break;
        }
      }
      if (headerRow < 0) continue;

      for (let i = headerRow + 1; i < rows.length; i++) {
        const row = rows[i] as unknown[];
        if (!row || !row[0] || !row[1]) continue;
        const date = parseDate(row[0]);
        const slot = String(row[1]).trim();
        if (!date || !slot || slot === "半小时") continue;

        const key = `${date}|${slot}`;
        if (!rowMap.has(key)) {
          rowMap.set(key, {
            date,
            slot,
            revenue: safeNum(row[2]),
            discount: safeNum(row[3]),
            netRevenue: safeNum(row[4]),
            orders: Math.round(safeNum(row[5])),
            avgBefore: safeNum(row[6]),
            avgAfter: safeNum(row[7]),
            guests: Math.round(safeNum(row[8])),
            perPersonBefore: safeNum(row[9]),
            perPersonAfter: safeNum(row[10]),
          });
        }
      }
    } catch (e) {
      console.warn("解析 Excel 失败:", e);
    }
  }

  if (rowMap.size === 0) return null;

  // 推断月份
  const allDates = Array.from(rowMap.values()).map((r) => r.date).filter(Boolean).sort();
  const month = allDates.length > 0 ? allDates[0].slice(0, 7) : new Date().toISOString().slice(0, 7);

  // 按日期分组
  const byDate = new Map<string, RawRow[]>();
  for (const row of rowMap.values()) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date)!.push(row);
  }

  // 构建逐日记录
  const dailyRecords: DailyPeriodRecord[] = [];
  const periodKeys: PeriodKey[] = ["lunch", "dinner", "midnight", "late_night"];

  for (const [date, rows] of byDate.entries()) {
    // 按时段排序
    const sorted = [...rows].sort((a, b) => slotToMinutes(a.slot) - slotToMinutes(b.slot));

    const slots: HalfHourSlot[] = sorted.map((r) => {
      const period = classifySlot(r.slot) ?? "lunch";
      const startStr = r.slot.split("-")[0].trim();
      const [h, m] = startStr.split(":").map(Number);
      return {
        slot: r.slot,
        startHour: h,
        startMin: m,
        period,
        revenue: r.revenue,
        discount: r.discount,
        netRevenue: r.netRevenue,
        orders: r.orders,
        guests: r.guests,
        avgOrderBefore: r.avgBefore,
        avgOrderAfter: r.avgAfter,
      };
    });

    // 各大时段汇总
    const periodTotals: DailyPeriodRecord["periodTotals"] = {
      lunch: { revenue: 0, orders: 0, guests: 0, slotCount: 0 },
      dinner: { revenue: 0, orders: 0, guests: 0, slotCount: 0 },
      midnight: { revenue: 0, orders: 0, guests: 0, slotCount: 0 },
      late_night: { revenue: 0, orders: 0, guests: 0, slotCount: 0 },
    };
    for (const s of slots) {
      const pt = periodTotals[s.period];
      pt.revenue += s.revenue;
      pt.orders += s.orders;
      pt.guests += s.guests;
      pt.slotCount++;
    }

    // 凌晨加班分析
    const lateSlots = slots.filter((s) => s.period === "late_night");
    const lateNightRevenue = lateSlots.reduce((sum, s) => sum + s.revenue, 0);
    const lateNightOrders = lateSlots.reduce((sum, s) => sum + s.orders, 0);

    // 1:30am 后的时段
    const after130Slots = lateSlots.filter((s) =>
      isAfterTime(s.slot, settings.alertStartTime)
    );
    const after130amRevenue = after130Slots.reduce((sum, s) => sum + s.revenue, 0);
    const after130amOrders = after130Slots.reduce((sum, s) => sum + s.orders, 0);

    // 加班性价比提醒：有凌晨加班 + 1:30后营业额 < 阈值
    const overtimeAlert = settings.enableOvertimeAlert &&
      lateSlots.length > 0 &&
      after130amRevenue < settings.overtimeThreshold;

    dailyRecords.push({
      date,
      slots,
      periodTotals,
      hasLateNight: lateSlots.length > 0,
      lateNightRevenue,
      lateNightOrders,
      after130amRevenue,
      after130amOrders,
      overtimeAlert,
    });
  }

  // 按日期排序
  dailyRecords.sort((a, b) => b.date.localeCompare(a.date));

  // 月度各时段汇总
  const monthlyTotals: PeriodAnalysisReport["monthlyTotals"] = {
    lunch: { revenue: 0, orders: 0, guests: 0, activeDays: 0, avgDailyRevenue: 0, avgDailyOrders: 0 },
    dinner: { revenue: 0, orders: 0, guests: 0, activeDays: 0, avgDailyRevenue: 0, avgDailyOrders: 0 },
    midnight: { revenue: 0, orders: 0, guests: 0, activeDays: 0, avgDailyRevenue: 0, avgDailyOrders: 0 },
    late_night: { revenue: 0, orders: 0, guests: 0, activeDays: 0, avgDailyRevenue: 0, avgDailyOrders: 0 },
  };
  for (const dr of dailyRecords) {
    for (const pk of periodKeys) {
      const pt = dr.periodTotals[pk];
      if (pt.revenue > 0 || pt.orders > 0) {
        monthlyTotals[pk].revenue += pt.revenue;
        monthlyTotals[pk].orders += pt.orders;
        monthlyTotals[pk].guests += pt.guests;
        monthlyTotals[pk].activeDays++;
      }
    }
  }
  for (const pk of periodKeys) {
    const mt = monthlyTotals[pk];
    if (mt.activeDays > 0) {
      mt.avgDailyRevenue = Math.round(mt.revenue / mt.activeDays);
      mt.avgDailyOrders = Math.round((mt.orders / mt.activeDays) * 10) / 10;
    }
  }

  // 半小时时段分布（跨月汇总）
  const slotDistribution: PeriodAnalysisReport["slotDistribution"] = {};
  for (const dr of dailyRecords) {
    for (const s of dr.slots) {
      if (!slotDistribution[s.slot]) {
        slotDistribution[s.slot] = {
          totalRevenue: 0, totalOrders: 0, activeDays: 0, avgRevenue: 0, period: s.period,
        };
      }
      slotDistribution[s.slot].totalRevenue += s.revenue;
      slotDistribution[s.slot].totalOrders += s.orders;
      slotDistribution[s.slot].activeDays++;
    }
  }
  for (const key of Object.keys(slotDistribution)) {
    const sd = slotDistribution[key];
    sd.avgRevenue = sd.activeDays > 0 ? Math.round(sd.totalRevenue / sd.activeDays) : 0;
  }

  // 加班性价比提醒列表
  const overtimeAlerts: PeriodAnalysisReport["overtimeAlerts"] = dailyRecords
    .filter((dr) => dr.overtimeAlert)
    .map((dr) => {
      const lowSlots = dr.slots
        .filter((s) => s.period === "late_night" && isAfterTime(s.slot, settings.alertStartTime) && s.revenue < settings.overtimeThreshold)
        .map((s) => ({ slot: s.slot, revenue: s.revenue, orders: s.orders }));
      return {
        date: dr.date,
        lateNightRevenue: dr.lateNightRevenue,
        after130amRevenue: dr.after130amRevenue,
        orders: dr.after130amOrders,
        threshold: settings.overtimeThreshold,
        lowSlots,
      };
    });

  return {
    id: uuid(),
    month,
    sourceNote: `餐时段营业统计 · ${allDates[0]} 至 ${allDates[allDates.length - 1]}`,
    dailyRecords,
    monthlyTotals,
    slotDistribution,
    overtimeAlerts,
    overtimeThreshold: settings.overtimeThreshold,
    createdAt: new Date().toISOString(),
  };
}
