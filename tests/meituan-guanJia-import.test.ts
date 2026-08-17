import { describe, expect, it } from "vitest";
import {
  buildMeituanMonthlyImportPreview,
  canonicalizeMeituanCategoryName,
  normalizeMeituanMonth,
} from "@/lib/integrations/meituan/monthly-import";
import { buildMeituanDailyBillPreview } from "@/lib/integrations/meituan/daily-bill-import";

const store = { storeId: "mt-store-a", storeName: "至缘酒吧·A店" };

describe("美团管家智能版多店月度导入", () => {
  it("将 food、Food、全角空格 food 自动合并，但不误合并 Food · 套餐", () => {
    expect(canonicalizeMeituanCategoryName(" FOOD ")).toEqual({ key: "food", label: "FOOD" });
    expect(canonicalizeMeituanCategoryName("Ｆｏｏｄ")).toEqual({ key: "food", label: "Food" });
    expect(canonicalizeMeituanCategoryName("Food · 套餐")?.key).toBe("food · 套餐");

    const preview = buildMeituanMonthlyImportPreview({
      store,
      month: "2026-07",
      revenueRows: [{ storeId: store.storeId, month: "2026/07", revenue: 160, turnover: 180, discountAmount: 20, orderCount: 4 }],
      dishCategoryRows: [
        { storeId: store.storeId, month: "2026-07", categoryName: "food", salesQty: 1, salesAmount: 50, revenue: 45, discountAmount: 5 },
        { storeId: store.storeId, month: "2026-07", categoryName: " Food ", salesQty: 2, salesAmount: 80, revenue: 75, discountAmount: 5 },
        { storeId: store.storeId, month: "2026-07", categoryName: "Food · 套餐", salesQty: 1, salesAmount: 40, revenue: 40 },
      ],
    });

    expect(preview.dishCategories).toHaveLength(2);
    expect(preview.dishCategories.find((item) => item.name.toLowerCase() === "food")?.revenue).toBe(120);
    expect(preview.dishCategories.find((item) => item.name === "Food · 套餐")?.revenue).toBe(40);
    expect(preview.isBalanced).toBe(true);
    expect(preview.importKey).toBe("meituan-guanJia:mt-store-a:2026-07");
  });

  it("拒绝跨门店和跨月行，且将收入差额显式留给用户确认", () => {
    const preview = buildMeituanMonthlyImportPreview({
      store,
      month: "2026-07",
      revenueRows: [
        { storeId: store.storeId, month: "2026-07", revenue: 100 },
        { storeId: "mt-store-b", month: "2026-07", revenue: 999 },
        { storeId: store.storeId, month: "2026-08", revenue: 999 },
      ],
      dishCategoryRows: [
        { storeId: store.storeId, month: "2026-07", categoryName: "Food", revenue: 80 },
        { storeId: "mt-store-b", month: "2026-07", categoryName: "Wine", revenue: 999 },
      ],
    });

    expect(preview.kpi.revenue).toBe(100);
    expect(preview.categoryRevenue).toBe(80);
    expect(preview.unclassifiedRevenue).toBe(20);
    expect(preview.isBalanced).toBe(false);
    expect(preview.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["STORE_MISMATCH", "MONTH_MISMATCH", "REVENUE_GAP"]));
  });

  it("标准化美团多种月份格式并拒绝非法月份", () => {
    expect(normalizeMeituanMonth("2026/7")).toBe("2026-07");
    expect(normalizeMeituanMonth("2026年07月")).toBe("2026-07");
    expect(normalizeMeituanMonth("2026-13")).toBeNull();
  });
});

describe("美团官方日账单导入 MVP", () => {
  const baseBill = {
    wmOrderViewId: "mt-order-001",
    daliyBillDate: "2026-07-15",
    appPoiCode: store.storeId,
    settleAmount: "81.00",
    totalFoodAmount: "100.00",
    activityPoiAmount: "-10.00",
    activityMeituanAmount: "-5.00",
    platformChargeFee: "-4.00",
    userOnlinePayAmount: "96.00",
    userOfflinePayAmount: "0.00",
    wmAppOrderSkuBenefitDetailList: [
      { app_spu_code: "food-a", sku_id: "sku-a", name: "Food A", count: 2, totalOriginPrice: "60", totalActivityPrice: "55", totalReducePrice: "5" },
      { app_spu_code: "food-b", sku_id: "sku-b", name: "Food B", count: 1, totalOriginPrice: "40", totalActivityPrice: "30", totalReducePrice: "10" },
    ],
  };

  it("建立门店、订单和月份幂等键，并保留菜品金额、优惠、平台费和结算额的独立口径", () => {
    const preview = buildMeituanDailyBillPreview({ store, month: "2026-07", bills: [baseBill] });
    expect(preview.isValid).toBe(true);
    expect(preview.bills[0]).toMatchObject({
      sourceKey: "meituan-openapi:mt-store-a:mt-order-001",
      grossFoodAmount: 100,
      merchantDiscount: 10,
      platformDiscount: 5,
      platformFee: 4,
      settlementAmount: 81,
    });
    expect(preview.totals).toEqual({ grossFoodAmount: 100, merchantDiscount: 10, platformDiscount: 5, platformFee: 4, settlementAmount: 81 });
  });

  it("跨门店、跨月、退款和同订单金额冲突均阻断导入，绝不串入目标门店月度快照", () => {
    const fingerprint = JSON.stringify(["80.00", "100.00", "-10.00", "-5.00", "-4.00", "96.00", "0.00"]);
    const preview = buildMeituanDailyBillPreview({
      store,
      month: "2026-07",
      existingSourceKeys: new Map([["meituan-openapi:mt-store-a:mt-order-001", fingerprint]]),
      bills: [
        baseBill,
        { ...baseBill, wmOrderViewId: "mt-order-002", appPoiCode: "mt-store-b" },
        { ...baseBill, wmOrderViewId: "mt-order-003", daliyBillDate: "2026-08-01" },
        { ...baseBill, wmOrderViewId: "mt-order-004", refundTime: "2026-07-16 10:00:00" },
      ],
    });

    expect(preview.bills).toHaveLength(0);
    expect(preview.isValid).toBe(false);
    expect(preview.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["DUPLICATE_CONFLICT", "STORE_MISMATCH", "MONTH_MISMATCH", "REFUND_CONFLICT"]));
  });
});

import { utils, write } from "xlsx";
import {
  parseMeituanDishCategoriesWorkbook,
  parseMeituanMonthlyRevenueWorkbook,
} from "@/lib/integrations/meituan/excel-adapter";

describe("美团管家智能版 Excel 模板适配器", () => {
  it("从带说明行的多店月度收入与菜品大类工作表提取稳定门店、月份和金额字段", () => {
    const revenueSheet = utils.aoa_to_sheet([
      ["美团管家智能版经营导出"],
      ["门店编码", "营业月份", "营业收入", "营业额", "优惠金额", "订单量"],
      ["mt-store-a", "2026年7月", 160, 180, 20, 4],
      ["mt-store-b", "2026年7月", 999, 999, 0, 1],
    ]);
    const categorySheet = utils.aoa_to_sheet([
      ["门店编码", "营业月份", "菜品大类", "销售数量", "销售额", "菜品收入", "优惠金额"],
      ["mt-store-a", "2026/07", "Food", 2, 100, 90, 10],
      ["mt-store-a", "2026/07", " food ", 1, 70, 70, 0],
      ["mt-store-b", "2026/07", "Food", 3, 999, 999, 0],
    ]);
    const revenueBook = utils.book_new();
    utils.book_append_sheet(revenueBook, revenueSheet, "营业收入");
    const categoryBook = utils.book_new();
    utils.book_append_sheet(categoryBook, categorySheet, "菜品销售大类");

    const revenues = parseMeituanMonthlyRevenueWorkbook(write(revenueBook, { type: "base64", bookType: "xlsx" }));
    const categories = parseMeituanDishCategoriesWorkbook(write(categoryBook, { type: "base64", bookType: "xlsx" }));
    const preview = buildMeituanMonthlyImportPreview({
      store,
      month: "2026-07",
      revenueRows: revenues.rows,
      dishCategoryRows: categories.rows,
    });

    expect(revenues.headerRowIndex).toBe(1);
    expect(categories.rows).toHaveLength(3);
    expect(preview.dishCategories).toHaveLength(1);
    expect(preview.dishCategories[0]).toMatchObject({ name: "Food", salesQty: 3, revenue: 160 });
    expect(preview.kpi.revenue).toBe(160);
    expect(preview.isBalanced).toBe(true);
  });
});

import {
  buildCurrentStoreDailyBillPreview,
  buildCurrentStoreMonthlyImportPreview,
  createMeituanSingleStoreBinding,
} from "@/lib/integrations/meituan/single-store-binding";

describe("当前单店美团绑定", () => {
  it("仅使用已绑定门店 ID 生成预览，并将其他门店文件行作为错误隔离", () => {
    const binding = createMeituanSingleStoreBinding("mt-current-store", "当前门店");
    const preview = buildCurrentStoreMonthlyImportPreview({
      binding,
      month: "2026-07",
      revenueRows: [
        { storeId: "mt-current-store", month: "2026-07", revenue: 100 },
        { storeId: "mt-other-store", month: "2026-07", revenue: 999 },
      ],
      dishCategoryRows: [{ storeId: "mt-current-store", month: "2026-07", categoryName: "Food", revenue: 100 }],
    });

    expect(binding.bindingId).toBe("meituan-guanJia.single-store.v1");
    expect(preview.kpi.revenue).toBe(100);
    expect(preview.issues.some((item) => item.code === "STORE_MISMATCH")).toBe(true);
  });

  it("单店日账单仍严格使用绑定门店 ID 建立订单幂等键", () => {
    const binding = createMeituanSingleStoreBinding("mt-current-store", "当前门店");
    const preview = buildCurrentStoreDailyBillPreview({
      binding,
      month: "2026-07",
      bills: [{
        wmOrderViewId: "current-order-1",
        daliyBillDate: "2026-07-02",
        appPoiCode: "mt-current-store",
        settleAmount: 90,
        totalFoodAmount: 100,
      }],
    });

    expect(preview.isValid).toBe(true);
    expect(preview.bills[0].sourceKey).toBe("meituan-openapi:mt-current-store:current-order-1");
  });
});
