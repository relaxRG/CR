/**
 * 店铺月度经营分析数据类型
 * 基于 predawn 美团收银系统导出的四类报表：
 * - 营业概览（营业/收款/菜品/顾客 4个工作表）
 * - 综合收款统计（日度收款明细）
 * - 菜品销售统计-大类（按菜品名称）
 * - 菜品销售统计-明细（按菜品大类）
 */

// ─── 核心 KPI ─────────────────────────────────────────────────────────────────
export interface MonthlyKPI {
  /** 营业收入（实收） */
  revenue: number;
  /** 营业额（含优惠前） */
  turnover: number;
  /** 优惠金额 */
  discountAmount: number;
  /** 优惠占比 */
  discountRate: number;
  /** 订单量 */
  orderCount: number;
  /** 消费桌数 */
  tableCount: number;
  /** 反结单量 */
  refundOrderCount: number;
  /** 赠菜数量 */
  giftDishCount: number;
  /** 退菜数量 */
  returnDishCount: number;
  /** 菜品销量（份） */
  dishSalesCount: number;
  /** 人均消费（非会员折前） */
  avgSpendPerPerson: number;
  /** 同比/环比对比值（可选，来自对比周期） */
  revenueVs?: number;
  turnoverVs?: number;
  discountAmountVs?: number;
  orderCountVs?: number;
  tableCountVs?: number;
  refundOrderCountVs?: number;
  giftDishCountVs?: number;
}

// ─── 收款方式 ─────────────────────────────────────────────────────────────────
export interface PaymentMethod {
  name: string;
  amount: number;
  pct: number;
  vsAmount?: number;
}

// ─── 菜品大类 ─────────────────────────────────────────────────────────────────
export interface DishCategory {
  name: string;
  salesQty: number;
  salesQtyPct: number;
  salesAmount: number;
  salesAmountPct: number;
  revenue: number;
  revenuePct: number;
  discountAmount: number;
  discountPct: number;
  vsAmount?: number;    // 较上月/去年同期变化
  vsPct?: number;
}

// ─── 菜品明细 ─────────────────────────────────────────────────────────────────
export interface DishItem {
  name: string;
  itemType: string;    // 普通菜/套餐等
  status: string;      // 在售/停售
  salesQty: number;
  salesQtyPct: number;
  salesAmount: number;
  salesAmountPct: number;
  revenue: number;
  revenuePct: number;
  discountAmount: number;
  discountPct: number;
  vsAmount?: number;
}

// ─── 餐段构成 ─────────────────────────────────────────────────────────────────
export interface MealPeriod {
  name: string;        // 晚上/白天/未设置餐段
  amount: number;
  pct: number;
  vsAmount?: number;
}

// ─── 优惠构成 ─────────────────────────────────────────────────────────────────
export interface DiscountItem {
  type: string;        // 会员卡/美团团购/手动折扣
  subType: string;     // 具体折扣名称
  amount: number;
}

// ─── 顾客数据 ─────────────────────────────────────────────────────────────────
export interface CustomerStats {
  memberRevenuePct: number;
  nonMemberRevenuePct: number;
  memberRevenue: number;
  memberAvgSpend: number;
  nonMemberRevenue: number;
  nonMemberAvgSpend: number;
  newMembers: number;
  newMemberCards: number;
  memberOrderCount: number;
  storedBalanceConsume: number;
  giftBalanceConsume: number;
  pointsEarned: number;
}

// ─── 日度收款 ─────────────────────────────────────────────────────────────────
export interface DailyRevenue {
  date: string;         // "2026-07-31"
  total: number;
  wechat: number;
  alipay: number;
  unionpay: number;
  member: number;
  meituan: number;
  other: number;
}

// ─── 退菜排行 ─────────────────────────────────────────────────────────────────
export interface ReturnDishItem {
  name: string;
  count: number;
}

// ─── 月度报告快照（完整） ─────────────────────────────────────────────────────
export interface MonthlyReport {
  id: string;
  /** 月份标签，如 "2026年7月" */
  monthLabel: string;
  /** 原始月份字符串，如 "2026/07" */
  rawMonth: string;
  /** 导入时间 */
  importedAt: string;
  /** 对比方式：同比去年 / 环比上月 */
  compareMode: "yoy" | "mom";
  /** 核心 KPI */
  kpi: MonthlyKPI;
  /** 收款方式构成 */
  paymentMethods: PaymentMethod[];
  /** 菜品大类销售 */
  dishCategories: DishCategory[];
  /** 菜品明细（Top N） */
  topDishes: DishItem[];
  /** 餐段构成 */
  mealPeriods: MealPeriod[];
  /** 优惠构成 */
  discounts: DiscountItem[];
  /** 顾客数据 */
  customerStats: CustomerStats;
  /** 日度收款（31天） */
  dailyRevenues: DailyRevenue[];
  /** 退菜排行 */
  returnDishes: ReturnDishItem[];
}

// ─── 业务洞察 ─────────────────────────────────────────────────────────────────
export interface BusinessInsight {
  type: "growth" | "decline" | "alert" | "info";
  title: string;
  desc: string;
  value?: string;
}

/** 生成业务洞察 */
export function generateInsights(report: MonthlyReport): BusinessInsight[] {
  const insights: BusinessInsight[] = [];
  const { kpi, dishCategories } = report;

  // 整体营收趋势
  if (kpi.revenueVs !== undefined) {
    const pct = kpi.revenue > 0 ? (kpi.revenueVs / (kpi.revenue - kpi.revenueVs)) * 100 : 0;
    insights.push({
      type: kpi.revenueVs >= 0 ? "growth" : "decline",
      title: kpi.revenueVs >= 0 ? "营业收入增长" : "营业收入下滑",
      desc: `较对比周期${kpi.revenueVs >= 0 ? "增长" : "下降"} ¥${Math.abs(kpi.revenueVs).toFixed(0)}（${Math.abs(pct).toFixed(1)}%）`,
      value: `¥${Math.abs(kpi.revenueVs).toFixed(0)}`,
    });
  }

  // 菜品大类增长/下滑
  const sortedCats = [...dishCategories].filter(c => c.vsAmount !== undefined).sort((a, b) => (b.vsAmount ?? 0) - (a.vsAmount ?? 0));
  if (sortedCats.length > 0) {
    const top = sortedCats[0];
    if ((top.vsAmount ?? 0) > 500) {
      insights.push({
        type: "growth",
        title: `${top.name} 增长最快`,
        desc: `较对比周期增长 ¥${(top.vsAmount ?? 0).toFixed(0)}，占比 ${(top.salesAmountPct * 100).toFixed(1)}%`,
        value: `+¥${(top.vsAmount ?? 0).toFixed(0)}`,
      });
    }
    const bottom = sortedCats[sortedCats.length - 1];
    if ((bottom.vsAmount ?? 0) < -500) {
      insights.push({
        type: "decline",
        title: `${bottom.name} 下滑明显`,
        desc: `较对比周期下降 ¥${Math.abs(bottom.vsAmount ?? 0).toFixed(0)}`,
        value: `-¥${Math.abs(bottom.vsAmount ?? 0).toFixed(0)}`,
      });
    }
  }

  // 优惠率
  if (kpi.discountRate > 0.06) {
    insights.push({
      type: "alert",
      title: "优惠率偏高",
      desc: `本月优惠占比 ${(kpi.discountRate * 100).toFixed(1)}%，手动赠菜是主要来源`,
      value: `${(kpi.discountRate * 100).toFixed(1)}%`,
    });
  }

  // 会员体系
  if (report.customerStats.memberRevenuePct < 0.05) {
    insights.push({
      type: "info",
      title: "会员体系待激活",
      desc: `会员营业额占比仅 ${(report.customerStats.memberRevenuePct * 100).toFixed(2)}%，本月新增 ${report.customerStats.newMembers} 名会员`,
    });
  }

  return insights;
}
