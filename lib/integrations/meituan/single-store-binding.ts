import {
  buildMeituanMonthlyImportPreview,
  type MeituanDishCategoryRow,
  type MeituanMonthlyImportPreview,
  type MeituanMonthlyRevenueRow,
  type MeituanStoreScope,
} from "./monthly-import";
import type { MonthlyReport } from "@/lib/store/monthly-report/types";
import {
  buildMeituanDailyBillPreview,
  type MeituanDailyBillPreview,
  type MeituanOfficialDailyBillRow,
} from "./daily-bill-import";

/**
 * 当前产品仅允许绑定一个美团门店。门店 ID 由设置页保存后传入；导入预览不提供选店能力。
 * 保留稳定门店 ID 是为了拒绝误上传其他门店文件，而不是启用多店功能。
 */
export interface MeituanSingleStoreBinding extends MeituanStoreScope {
  bindingId: "meituan-guanJia.single-store.v1";
}

export function createMeituanSingleStoreBinding(storeId: string, storeName: string): MeituanSingleStoreBinding {
  const normalizedStoreId = String(storeId ?? "").trim();
  if (!normalizedStoreId) throw new Error("请先在美团数据导入设置中绑定当前门店 ID");
  return {
    bindingId: "meituan-guanJia.single-store.v1",
    storeId: normalizedStoreId,
    storeName: String(storeName ?? "当前门店").trim() || "当前门店",
    timeZone: "Asia/Shanghai",
  };
}

export function buildCurrentStoreMonthlyImportPreview(input: {
  binding: MeituanSingleStoreBinding;
  month: string;
  revenueRows: MeituanMonthlyRevenueRow[];
  dishCategoryRows: MeituanDishCategoryRow[];
}): MeituanMonthlyImportPreview {
  return buildMeituanMonthlyImportPreview({
    store: input.binding,
    month: input.month,
    revenueRows: input.revenueRows,
    dishCategoryRows: input.dishCategoryRows,
  });
}

/** 将已通过门店和月份隔离的美团预览转换为当前月报可确认写入的最小快照。 */
export function createMonthlyReportFromMeituanPreview(preview: MeituanMonthlyImportPreview, now = new Date().toISOString()): MonthlyReport {
  const [year, month] = preview.month.split("-");
  return {
    id: preview.importKey,
    rawMonth: preview.month,
    monthLabel: `${year}年${Number(month)}月`,
    importedAt: now,
    compareMode: "mom",
    kpi: {
      ...preview.kpi,
      tableCount: 0,
      refundOrderCount: 0,
      giftDishCount: 0,
      returnDishCount: 0,
      dishSalesCount: preview.dishCategories.reduce((sum, item) => sum + item.salesQty, 0),
      avgSpendPerPerson: 0,
    },
    paymentMethods: [],
    dishCategories: preview.unclassifiedRevenue === 0
      ? preview.dishCategories
      : [...preview.dishCategories, {
          name: "未分类营业收入（待核对）",
          salesQty: 0,
          salesQtyPct: 0,
          salesAmount: preview.unclassifiedRevenue,
          salesAmountPct: 0,
          revenue: preview.unclassifiedRevenue,
          revenuePct: 0,
          discountAmount: 0,
          discountPct: 0,
        }],
    topDishes: [],
    mealPeriods: [],
    discounts: [],
    customerStats: {
      memberRevenuePct: 0,
      nonMemberRevenuePct: 0,
      memberRevenue: 0,
      memberAvgSpend: 0,
      nonMemberRevenue: 0,
      nonMemberAvgSpend: 0,
      newMembers: 0,
      newMemberCards: 0,
      memberOrderCount: 0,
      storedBalanceConsume: 0,
      giftBalanceConsume: 0,
      pointsEarned: 0,
    },
    dailyRevenues: [],
    returnDishes: [],
  };
}

export function buildCurrentStoreDailyBillPreview(input: {
  binding: MeituanSingleStoreBinding;
  month: string;
  bills: MeituanOfficialDailyBillRow[];
  existingSourceKeys?: Map<string, string>;
}): MeituanDailyBillPreview {
  return buildMeituanDailyBillPreview({
    store: input.binding,
    month: input.month,
    bills: input.bills,
    existingSourceKeys: input.existingSourceKeys,
  });
}
