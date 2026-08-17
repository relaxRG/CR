import {
  buildMeituanMonthlyImportPreview,
  type MeituanDishCategoryRow,
  type MeituanMonthlyImportPreview,
  type MeituanMonthlyRevenueRow,
  type MeituanStoreScope,
} from "./monthly-import";
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
