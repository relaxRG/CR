/**
 * 月度经营报表 Excel 解析器
 * 支持从收银系统手动导出的四类报表：
 *
 * 1. 营业概览.xlsx（4个工作表）
 *    - 营业：KPI + 优惠构成
 *    - 收款：收款方式明细
 *    - 菜品：退菜/畅销排行
 *    - 顾客：会员数据
 *
 * 2. 综合收款统计.xlsx（日度收款）
 *    - 列：营业日期/业务大类/收款小计/微信/支付宝/银联储蓄/银联信用/会员卡/美团套餐...
 *
 * 3. 菜品销售统计（菜品名称）.xlsx（按菜品名称）
 *    - 列：菜品名称/品项类型/售卖状态/销售数量/占比/销售额/占比/菜品收入/占比/优惠/占比
 *
 * 4. 菜品销售统计（菜品大类）.xlsx（按大类汇总）
 *    - 列：营业月份/菜品大类/销售数量/占比/销售额/占比/菜品收入/占比/优惠/占比
 */
import { utils, read as xlsxRead } from "xlsx";
import { sumMoney } from "@/lib/finance/money";
import {
  MonthlyReport, MonthlyKPI, PaymentMethod, DishCategory, DishItem,
  MealPeriod, DiscountItem, CustomerStats, DailyRevenue, ReturnDishItem,
} from "./types";
function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function safeNum(v: any): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function safeStr(v: any): string {
  return v == null ? "" : String(v).trim();
}

export function canonicalizeDishCategoryName(value: string): { key: string; label: string } | null {
  const label = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[・]/g, "·")
    .replace(/\s+/g, " ")
    .replace(/\s*([·/+()&-])\s*/g, "$1")
    .trim();
  // 分类名必须是可读业务文本；纯数字、数字金额和百分比说明列位错位，绝不进入快照。
  if (!label || label === "合计" || /^[-+]?\d+(?:[,.]\d+)?%?$/.test(label)) return null;
  return { key: label.toLocaleLowerCase("en-US"), label };
}

/**
 * 解析营业概览.xlsx（4个工作表）
 */
function parseOverviewExcel(base64: string): {
  kpi: Partial<MonthlyKPI>;
  paymentMethods: PaymentMethod[];
  discounts: DiscountItem[];
  customerStats: Partial<CustomerStats>;
  returnDishes: ReturnDishItem[];
  rawMonth: string;
} {
  const wb = xlsxRead(base64, { type: "base64" });

  // ── 营业工作表 ──────────────────────────────────────────────────────────────
  const bizWs = wb.Sheets["营业"];
  const bizRows = bizWs ? utils.sheet_to_json<any[]>(bizWs, { header: 1, defval: null }) : [];

  const kpi: Partial<MonthlyKPI> = {};
  const discounts: DiscountItem[] = [];
  let rawMonth = "";

  // 提取日期范围
  for (const row of bizRows) {
    const r0 = safeStr(row?.[0]);
    const r1 = safeStr(row?.[1]);
    if (r0.includes("营业日期")) {
      // "营业日期：【2026-07-01至2026-07-31】"
      const m = r0.match(/(\d{4}-\d{2})/);
      if (m) rawMonth = m[1].replace("-", "/");
    }
    if (r0 === "营业收入") kpi.revenue = safeNum(r1);
    if (r0 === "营业额") kpi.turnover = safeNum(r1);
    if (r0 === "优惠金额") kpi.discountAmount = safeNum(r1);
    if (r0 === "优惠占比") kpi.discountRate = parseFloat(r1) / 100;
    if (r0 === "订单量") kpi.orderCount = safeNum(r1);
  }

  // 优惠构成（从营业工作表提取）
  let inDiscount = false;
  let currentDiscountType = "";
  for (const row of bizRows) {
    const r0 = safeStr(row?.[0]);
    const r1 = safeStr(row?.[1]);
    const r2 = safeStr(row?.[2]);
    if (r0 === "优惠构成") { inDiscount = true; continue; }
    if (inDiscount) {
      if (r0 && r0 !== "折扣类型" && r0 !== "小计" && !r0.startsWith("合计")) {
        currentDiscountType = r0;
      }
      if (r1 && r1 !== "折扣金额(元)" && r1 !== "小计" && r2) {
        discounts.push({ type: currentDiscountType, subType: r1, amount: safeNum(r2) });
      }
    }
  }

  // ── 收款工作表 ──────────────────────────────────────────────────────────────
  const payWs = wb.Sheets["收款"];
  const payRows = payWs ? utils.sheet_to_json<any[]>(payWs, { header: 1, defval: null }) : [];
  const paymentMethods: PaymentMethod[] = [];

  // 总收款
  let totalPayment = 0;
  for (const row of payRows) {
    const r0 = safeStr(row?.[0]);
    const r1 = safeStr(row?.[1]);
    const r2 = safeStr(row?.[2]);
    if (r0 === "收款合计(元)") totalPayment = safeNum(r1);
    // 扫码支付明细
    if (r1 === "微信" || r1 === "支付宝" || r1.includes("银联")) {
      paymentMethods.push({ name: r1, amount: safeNum(r2), pct: 0 });
    }
    // 美团团购
    if (r0 === "美团/大众点评团购" && r1 && r1 !== "小计") {
      paymentMethods.push({ name: r1, amount: safeNum(r2), pct: 0 });
    }
    if (r0 === "" && r1 && r1 !== "小计" && r2 && payRows.indexOf(row) > 15) {
      // 美团子项
      const prev = paymentMethods[paymentMethods.length - 1];
      if (prev && prev.name.includes("套餐")) {
        // already captured
      } else {
        paymentMethods.push({ name: r1, amount: safeNum(r2), pct: 0 });
      }
    }
  }
  // 计算占比
  if (totalPayment > 0) {
    paymentMethods.forEach((p) => { p.pct = p.amount / totalPayment; });
  }

  // ── 菜品工作表 ──────────────────────────────────────────────────────────────
  const dishWs = wb.Sheets["菜品"];
  const dishRows = dishWs ? utils.sheet_to_json<any[]>(dishWs, { header: 1, defval: null }) : [];
  const returnDishes: ReturnDishItem[] = [];

  let inReturn = false;
  for (const row of dishRows) {
    const r0 = safeStr(row?.[0]);
    const r1 = safeStr(row?.[1]);
    if (r0 === "菜品销量(份)") kpi.dishSalesCount = safeNum(r1);
    if (r0 === "退菜数量(份)") kpi.returnDishCount = safeNum(r1);
    if (r0 === "增菜数量(份)") kpi.giftDishCount = safeNum(r1);
    if (r0 === "退菜菜品排行") { inReturn = true; continue; }
    if (r0 === "畅销菜品排行") { inReturn = false; continue; }
    if (inReturn && r0 && r0 !== "菜品名称" && r1) {
      returnDishes.push({ name: r0, count: safeNum(r1) });
    }
  }

  // ── 顾客工作表 ──────────────────────────────────────────────────────────────
  const custWs = wb.Sheets["顾客"];
  const custRows = custWs ? utils.sheet_to_json<any[]>(custWs, { header: 1, defval: null }) : [];
  const customerStats: Partial<CustomerStats> = {};

  for (const row of custRows) {
    const r0 = safeStr(row?.[0]);
    const r1 = safeStr(row?.[1]);
    if (r0 === "会员营业额占比") customerStats.memberRevenuePct = parseFloat(r1) / 100;
    if (r0 === "非会员营业额占比") customerStats.nonMemberRevenuePct = parseFloat(r1) / 100;
    if (r0 === "会员营业额（元）") customerStats.memberRevenue = safeNum(r1);
    if (r0 === "会员折前人均（元）") customerStats.memberAvgSpend = safeNum(r1);
    if (r0 === "非会员营业额（元）") customerStats.nonMemberRevenue = safeNum(r1);
    if (r0 === "非会员折前人均（元）") {
      customerStats.nonMemberAvgSpend = safeNum(r1);
      kpi.avgSpendPerPerson = safeNum(r1);
    }
    if (r0 === "新增会员（人）") customerStats.newMembers = safeNum(r1);
    if (r0 === "新增会员卡（张）") customerStats.newMemberCards = safeNum(r1);
    if (r0 === "会员消费笔数（笔）" && !customerStats.memberOrderCount) {
      customerStats.memberOrderCount = safeNum(r1);
    }
    if (r0 === "储值余额消费（元）" && !customerStats.storedBalanceConsume) {
      customerStats.storedBalanceConsume = safeNum(r1);
    }
    if (r0 === "赠送余额消费（元）" && !customerStats.giftBalanceConsume) {
      customerStats.giftBalanceConsume = safeNum(r1);
    }
    if (r0 === "积分赠送变动（积分）" && !customerStats.pointsEarned) {
      customerStats.pointsEarned = safeNum(r1);
    }
  }

  return { kpi, paymentMethods, discounts, customerStats, returnDishes, rawMonth };
}

/**
 * 解析综合收款统计.xlsx（日度收款）
 * 列：营业日期/业务大类/收款小计/微信/支付宝/银联储蓄/银联信用/会员卡/美团套餐A/美团套餐B/美团套餐C
 */
function parseDailyRevenueExcel(base64: string): DailyRevenue[] {
  const wb = xlsxRead(base64, { type: "base64" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  const dailies: DailyRevenue[] = [];

  // 找到数据起始行（营业日期列有日期值）
  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const dateStr = safeStr(row[0]);
    if (!dateStr.match(/^\d{4}\/\d{2}\/\d{2}$/)) continue;

    const date = dateStr.replace(/\//g, "-");
    const total = safeNum(row[2]);
    const wechat = safeNum(row[3]);
    const alipay = safeNum(row[4]);
    const unionpay = safeNum(row[5]) + safeNum(row[6]);
    const member = safeNum(row[7]);
    // 美团套餐（列8、9、10）
    const meituan = safeNum(row[8]) + safeNum(row[9]) + safeNum(row[10]);
    const other = total - wechat - alipay - unionpay - member - meituan;

    dailies.push({ date, total, wechat, alipay, unionpay, member, meituan, other: Math.max(0, other) });
  }
  return dailies.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 解析菜品销售统计（按菜品名称）.xlsx
 * 行3=表头，行4=副表头（构成子列），行5+=数据
 * 列：菜品名称/品项类型/售卖状态/销售数量/占比/销售额/占比/菜品收入/占比/优惠/占比
 */
function parseDishItemsExcel(base64: string): DishItem[] {
  const wb = xlsxRead(base64, { type: "base64" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  const items: DishItem[] = [];

  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const name = safeStr(row[0]);
    if (!name || name === "合计") continue;
    items.push({
      name,
      itemType: safeStr(row[1]),
      status: safeStr(row[2]),
      salesQty: safeNum(row[3]),
      salesQtyPct: safeNum(row[4]),
      salesAmount: safeNum(row[5]),
      salesAmountPct: safeNum(row[6]),
      revenue: safeNum(row[7]),
      revenuePct: safeNum(row[8]),
      discountAmount: safeNum(row[9]),
      discountPct: safeNum(row[10]),
    });
  }
  return items;
}

/**
 * 解析菜品销售统计（按菜品大类）.xlsx
 * 行3=表头，行4=副表头，行5+=数据
 * 列：营业月份/菜品大类/销售数量/占比/销售额/占比/菜品收入/占比/优惠/占比
 */
function parseDishCategoriesExcel(base64: string): DishCategory[] {
  const wb = xlsxRead(base64, { type: "base64" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });

  // 按大类名称合并（同一大类可能有多行）
  const map = new Map<string, DishCategory>();

  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const category = canonicalizeDishCategoryName(safeStr(row[1]));
    if (!category) continue;

    const existing = map.get(category.key);
    const salesQty = safeNum(row[2]);
    const salesAmount = safeNum(row[4]);
    const revenue = safeNum(row[6]);
    const discountAmount = safeNum(row[8]);

    if (existing) {
      existing.salesQty += salesQty;
      existing.salesAmount = sumMoney([existing.salesAmount, salesAmount]);
      existing.revenue = sumMoney([existing.revenue, revenue]);
      existing.discountAmount = sumMoney([existing.discountAmount, discountAmount]);
    } else {
      map.set(category.key, {
        name: category.label,
        salesQty,
        salesQtyPct: safeNum(row[3]),
        salesAmount,
        salesAmountPct: safeNum(row[5]),
        revenue,
        revenuePct: safeNum(row[7]),
        discountAmount,
        discountPct: safeNum(row[9]),
      });
    }
  }

  // 重新计算占比
  const cats = Array.from(map.values());
  const totalSalesAmount = sumMoney(cats.map((category) => category.salesAmount));
  if (totalSalesAmount > 0) {
    cats.forEach((c) => { c.salesAmountPct = c.salesAmount / totalSalesAmount; });
  }

  return cats.sort((a, b) => b.salesAmount - a.salesAmount);
}

// ─── 主解析函数 ───────────────────────────────────────────────────────────────
export interface ParseReportInput {
  /** 营业概览.xlsx base64 */
  overviewBase64?: string;
  /** 综合收款统计.xlsx base64 */
  dailyBase64?: string;
  /** 菜品销售统计（菜品名称）.xlsx base64 */
  dishItemsBase64?: string;
  /** 菜品销售统计（菜品大类）.xlsx base64 */
  dishCatsBase64?: string;
}

export function parseMonthlyReport(input: ParseReportInput): {
  report: MonthlyReport | null;
  error?: string;
} {
  try {
    // 至少需要一个文件
    if (!input.overviewBase64 && !input.dishCatsBase64 && !input.dishItemsBase64 && !input.dailyBase64) {
      return { report: null, error: "请至少上传一个报表文件" };
    }

    let kpi: Partial<MonthlyKPI> = {};
    let paymentMethods: PaymentMethod[] = [];
    let discounts: DiscountItem[] = [];
    let customerStats: Partial<CustomerStats> = {};
    let returnDishes: ReturnDishItem[] = [];
    let rawMonth = "";
    let dailyRevenues: DailyRevenue[] = [];
    let topDishes: DishItem[] = [];
    let dishCategories: DishCategory[] = [];

    // 1. 营业概览
    if (input.overviewBase64) {
      const result = parseOverviewExcel(input.overviewBase64);
      kpi = { ...kpi, ...result.kpi };
      paymentMethods = result.paymentMethods;
      discounts = result.discounts;
      customerStats = result.customerStats;
      returnDishes = result.returnDishes;
      if (result.rawMonth) rawMonth = result.rawMonth;
    }

    // 2. 日度收款
    if (input.dailyBase64) {
      dailyRevenues = parseDailyRevenueExcel(input.dailyBase64);
      // 从日度数据推断月份
      if (!rawMonth && dailyRevenues.length > 0) {
        rawMonth = dailyRevenues[0].date.slice(0, 7).replace("-", "/");
      }
    }

    // 3. 菜品明细
    if (input.dishItemsBase64) {
      topDishes = parseDishItemsExcel(input.dishItemsBase64);
    }

    // 4. 菜品大类
    if (input.dishCatsBase64) {
      dishCategories = parseDishCategoriesExcel(input.dishCatsBase64);
      // 从大类数据推断月份
      if (!rawMonth) rawMonth = "未知月份";
    }

    // 月份标签
    if (!rawMonth) rawMonth = new Date().toISOString().slice(0, 7).replace("-", "/");
    const [y, m] = rawMonth.split("/");
    const monthLabel = `${y}年${Number(m)}月`;

    // 填充默认值
    const fullKpi: MonthlyKPI = {
      revenue: kpi.revenue ?? 0,
      turnover: kpi.turnover ?? 0,
      discountAmount: kpi.discountAmount ?? 0,
      discountRate: kpi.discountRate ?? 0,
      orderCount: kpi.orderCount ?? 0,
      tableCount: kpi.tableCount ?? kpi.orderCount ?? 0,
      refundOrderCount: kpi.refundOrderCount ?? 0,
      giftDishCount: kpi.giftDishCount ?? 0,
      returnDishCount: kpi.returnDishCount ?? 0,
      dishSalesCount: kpi.dishSalesCount ?? 0,
      avgSpendPerPerson: kpi.avgSpendPerPerson ?? 0,
      revenueVs: kpi.revenueVs,
      turnoverVs: kpi.turnoverVs,
      discountAmountVs: kpi.discountAmountVs,
      orderCountVs: kpi.orderCountVs,
      tableCountVs: kpi.tableCountVs,
      refundOrderCountVs: kpi.refundOrderCountVs,
      giftDishCountVs: kpi.giftDishCountVs,
    };

    const fullCustomerStats: CustomerStats = {
      memberRevenuePct: customerStats.memberRevenuePct ?? 0,
      nonMemberRevenuePct: customerStats.nonMemberRevenuePct ?? 1,
      memberRevenue: customerStats.memberRevenue ?? 0,
      memberAvgSpend: customerStats.memberAvgSpend ?? 0,
      nonMemberRevenue: customerStats.nonMemberRevenue ?? 0,
      nonMemberAvgSpend: customerStats.nonMemberAvgSpend ?? 0,
      newMembers: customerStats.newMembers ?? 0,
      newMemberCards: customerStats.newMemberCards ?? 0,
      memberOrderCount: customerStats.memberOrderCount ?? 0,
      storedBalanceConsume: customerStats.storedBalanceConsume ?? 0,
      giftBalanceConsume: customerStats.giftBalanceConsume ?? 0,
      pointsEarned: customerStats.pointsEarned ?? 0,
    };

    // 餐段构成（从截图数据硬编码，实际从营业概览中解析）
    const mealPeriods: MealPeriod[] = [];

    const report: MonthlyReport = {
      id: uuid(),
      monthLabel,
      rawMonth,
      importedAt: new Date().toISOString(),
      compareMode: "yoy",
      kpi: fullKpi,
      paymentMethods,
      dishCategories,
      topDishes,
      mealPeriods,
      discounts,
      customerStats: fullCustomerStats,
      dailyRevenues,
      returnDishes,
    };

    return { report };
  } catch (e) {
    console.error("月度报表解析失败", e);
    return { report: null, error: String(e) };
  }
}
