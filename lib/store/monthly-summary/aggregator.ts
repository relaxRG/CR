/**
 * 月度总报表聚合引擎
 * 从各模块自动读取数据，生成科目行，防止重复叠加
 */
import { SummaryLineItem, MonthlySummaryReport, PETTY_EXCLUDED_FROM_OTHER } from "./types";
import type { PeriodSummary, PettyRecord } from "../../store/petty-store";
import type { MonthlyReport } from "../../store/monthly-report/types";
import type { PaySlip } from "../../labor/types";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function makeItem(overrides: Partial<SummaryLineItem> & Pick<SummaryLineItem, "code" | "label" | "category" | "amount" | "source">): SummaryLineItem {
  return {
    id: uuid(),
    isPaid: false,
    paymentNote: "",
    isDuplicate: false,
    duplicateNote: "",
    isManual: false,
    notes: "",
    ...overrides,
  };
}

export interface AggregatorInput {
  month: string;
  /** 月度经营分析报告（菜品大类数据） */
  monthlyReport?: MonthlyReport;
  /** 备用金月度汇总 */
  pettySummary?: PeriodSummary;
  /** 备用金原始记录（用于逐分类提取） */
  pettyRecords?: PettyRecord[];
  /** 薪资单列表 */
  paySlips?: PaySlip[];
  /** 手动录入项（房租/外卖/活动收入等） */
  manualItems?: SummaryLineItem[];
}

export function aggregateMonthlyReport(input: AggregatorInput): Partial<MonthlySummaryReport> {
  const items: SummaryLineItem[] = [];

  // ── 1. 本月收入（来自月度经营分析） ─────────────────────────────────────────
  if (input.monthlyReport) {
    const mr = input.monthlyReport;
    // 菜品大类收入
    for (const cat of mr.dishCategories ?? []) {
      items.push(makeItem({
        code: `revenue_dish_${cat.name}`,
        label: cat.name,
        category: "revenue",
        amount: cat.revenue,
        source: "monthly_report",
        linkedModule: "monthly-report",
      }));
    }
    // 扣减项：手续费
    if (mr.kpi?.discountAmount) {
      items.push(makeItem({
        code: "revenue_discount",
        label: "优惠金额（扣减）",
        category: "revenue",
        amount: -mr.kpi.discountAmount,
        source: "monthly_report",
        notes: "已在营业额中扣除",
        isDuplicate: true,
        duplicateNote: "营业额已扣除优惠，此行仅供参考",
      }));
    }
  }

  // ── 2. 备用金收入（N 类） ────────────────────────────────────────────────────
  if (input.pettyRecords) {
    const n4Records = input.pettyRecords.filter((r) => r.code === "N4");
    const n4Total = n4Records.reduce((s, r) => s + r.amount, 0);
    if (n4Total > 0) {
      items.push(makeItem({
        code: "revenue_charger",
        label: "充电宝收入",
        category: "revenue",
        amount: n4Total,
        source: "petty_cash",
        isPaid: true,
        paymentNote: "已在备用金 N4 中计算",
        isDuplicate: true,
        duplicateNote: "已在备用金收入中计算，月报中仅供参考",
      }));
    }
  }

  // ── 3. 进货成本-食材（备用金 A 类） ─────────────────────────────────────────
  const FOOD_CODES = ["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10"];
  const FOOD_LABELS: Record<string, string> = {
    A1: "新鲜肉类", A2: "新鲜海鲜", A3: "各种冻品",
    A4: "米面粮油", A5: "蔬菜水果", A6: "牛排",
    A7: "火腿", A8: "三文鱼", A9: "临时采购", A10: "研发采购",
  };
  if (input.pettyRecords) {
    for (const code of FOOD_CODES) {
      const recs = input.pettyRecords.filter((r) => r.code === code);
      const total = recs.reduce((s, r) => s + r.amount, 0);
      items.push(makeItem({
        code: `cogs_food_${code}`,
        label: `${code} ${FOOD_LABELS[code] ?? code}`,
        category: "cogs_food",
        amount: -total,
        source: "petty_cash",
        isPaid: total > 0,
        paymentNote: total > 0 ? "已付(备用金)" : "",
      }));
    }
    // B2 酒水配料
    const b2Total = input.pettyRecords.filter((r) => r.code === "B2").reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "cogs_bev_b2",
      label: "B2 酒水配料",
      category: "cogs_beverage",
      amount: -b2Total,
      source: "petty_cash",
      isPaid: b2Total > 0,
      paymentNote: b2Total > 0 ? "已付(备用金)" : "",
    }));
    // B3 酒水耗材
    const b3Total = input.pettyRecords.filter((r) => r.code === "B3").reduce((s, r) => s + r.amount, 0);
    items.push(makeItem({
      code: "cogs_bev_b3",
      label: "B3 酒水耗材",
      category: "cogs_beverage",
      amount: -b3Total,
      source: "petty_cash",
      isPaid: b3Total > 0,
      paymentNote: b3Total > 0 ? "已付(备用金)" : "",
    }));
  }

  // ── 4. 工资（来自薪资单） ────────────────────────────────────────────────────
  if (input.paySlips) {
    for (const slip of input.paySlips) {
      items.push(makeItem({
        code: `labor_${slip.employeeId}`,
        label: slip.employeeId,
        category: "labor",
        amount: -(slip.finalSalary ?? 0),
        source: "labor",
        employeeId: slip.employeeId,
        linkedModule: "labor-attendance",
        notes: slip.notes ?? "",
      }));
    }
  }

  // ── 5. 水电（备用金 L 类） ───────────────────────────────────────────────────
  if (input.pettyRecords) {
    const l1Total = input.pettyRecords.filter((r) => r.code === "L1").reduce((s, r) => s + r.amount, 0);
    const l2Total = input.pettyRecords.filter((r) => r.code === "L2").reduce((s, r) => s + r.amount, 0);
    if (l1Total > 0) {
      items.push(makeItem({
        code: "utilities_electric",
        label: "电费（上月）",
        category: "utilities",
        amount: -l1Total,
        source: "petty_cash",
        isPaid: true,
        paymentNote: "微信支付",
      }));
    }
    if (l2Total > 0) {
      items.push(makeItem({
        code: "utilities_water",
        label: "水费（上月）",
        category: "utilities",
        amount: -l2Total,
        source: "petty_cash",
        isPaid: true,
        paymentNote: "微信支付",
      }));
    }
  }

  // ── 6. 备用金其他费用（排除已单独列示的科目） ─────────────────────────────────
  if (input.pettyRecords) {
    const otherRecs = input.pettyRecords.filter((r) => !PETTY_EXCLUDED_FROM_OTHER.includes(r.code));
    const otherTotal = otherRecs.reduce((s, r) => s + r.amount, 0);
    if (otherTotal > 0) {
      items.push(makeItem({
        code: "petty_other",
        label: "备用金费用（其他）",
        category: "petty_other",
        amount: -otherTotal,
        source: "petty_cash",
        isPaid: true,
        paymentNote: "包含员工餐补、福利、食材、探店、消杀等",
        notes: `D/E/G/H/I/J/K 类合计，排除已单独列示科目`,
      }));
    }
  }

  // ── 7. 手动录入项 ────────────────────────────────────────────────────────────
  const manualItems = input.manualItems ?? [];

  // ── 计算各小计 ───────────────────────────────────────────────────────────────
  const nonDuplicate = items.filter((i) => !i.isDuplicate);
  const totalRevenue = nonDuplicate.filter((i) => i.category === "revenue" && i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const revenueDeductions = nonDuplicate.filter((i) => i.category === "revenue" && i.amount < 0).reduce((s, i) => s + i.amount, 0);
  const totalCOGS = nonDuplicate.filter((i) => ["cogs_food","cogs_beverage"].includes(i.category)).reduce((s, i) => s + i.amount, 0);
  const totalLabor = nonDuplicate.filter((i) => i.category === "labor").reduce((s, i) => s + i.amount, 0);
  const totalRent = [...nonDuplicate, ...manualItems].filter((i) => i.category === "rent").reduce((s, i) => s + i.amount, 0);
  const totalUtilities = nonDuplicate.filter((i) => i.category === "utilities").reduce((s, i) => s + i.amount, 0);
  const totalPettyOther = nonDuplicate.filter((i) => i.category === "petty_other").reduce((s, i) => s + i.amount, 0);
  const totalExtra = manualItems.filter((i) => i.category === "extra").reduce((s, i) => s + i.amount, 0);
  const manualRevenue = manualItems.filter((i) => i.category === "revenue").reduce((s, i) => s + i.amount, 0);
  const manualCOGS = manualItems.filter((i) => ["cogs_food","cogs_beverage"].includes(i.category)).reduce((s, i) => s + i.amount, 0);

  const netProfit = (totalRevenue + revenueDeductions + manualRevenue)
    + totalCOGS + manualCOGS
    + totalLabor + totalRent + totalUtilities + totalPettyOther + totalExtra;

  return {
    lineItems: items,
    manualItems,
    totalRevenue: totalRevenue + revenueDeductions + manualRevenue,
    totalCOGS: Math.abs(totalCOGS + manualCOGS),
    totalLabor: Math.abs(totalLabor),
    totalRent: Math.abs(totalRent),
    totalUtilities: Math.abs(totalUtilities),
    totalPettyOther: Math.abs(totalPettyOther),
    totalExtra: Math.abs(totalExtra),
    netProfit,
  };
}
