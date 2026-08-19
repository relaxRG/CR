import type { SummaryLineItem } from "./types";
import { sumMoney } from "@/lib/finance/money";

export interface MonthlySummaryPresentation {
  dishRevenueItems: SummaryLineItem[];
  otherRevenueItems: SummaryLineItem[];
  feeItems: SummaryLineItem[];
  expenseItems: SummaryLineItem[];
  totalDishRevenue: number;
  totalOtherRevenue: number;
  totalFees: number;
}

/**
 * 总月报唯一展示分组：
 * - 菜品收入：按菜品大类呈现；
 * - 其他经营收入：充电宝、手工营业收入等；
 * - 手续费：从营业收入中独立扣减，不与账户收款渠道混排；
 * - 已重复计算项不进入任何金额小计。
 */
export function buildMonthlySummaryPresentation(items: SummaryLineItem[]): MonthlySummaryPresentation {
  const effectiveItems = items.filter((item) => {
    const isDuplicate = item.manualDuplicate ?? item.isDuplicate;
    return !isDuplicate;
  });

  const revenueItems = effectiveItems.filter((item) => item.category === "revenue");
  const dishRevenueItems = revenueItems.filter((item) => item.revenueKind === "dish_category");
  const feeItems = revenueItems.filter((item) => item.revenueKind === "fee");
  const otherRevenueItems = revenueItems.filter((item) => (
    item.revenueKind === "other_operating"
    || item.revenueKind === "uncategorized"
    // 旧版手动营业收入没有 revenueKind；在新展示中透明归入其他经营收入。
    || item.revenueKind === undefined
  ));
  const expenseItems = effectiveItems.filter((item) => item.category !== "revenue");

  return {
    dishRevenueItems,
    otherRevenueItems,
    feeItems,
    expenseItems,
    totalDishRevenue: sumMoney(dishRevenueItems.map((item) => item.amount)),
    totalOtherRevenue: sumMoney(otherRevenueItems.map((item) => item.amount)),
    totalFees: Math.abs(sumMoney(feeItems.map((item) => item.amount))),
  };
}

export function hasVisibleMonthlySummaryItems(items: SummaryLineItem[]): boolean {
  return items.some((item) => !(item.manualDuplicate ?? item.isDuplicate));
}
