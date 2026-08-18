import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { parseMonthlyReport } from "@/lib/store/monthly-report/excel-parser";

describe("月度经营报表菜品大类归并", () => {
  it("将 Food、food 与全角 Food 归并为一行，但保留 Food · 套餐的独立业务语义", () => {
    const sheet = utils.aoa_to_sheet([
      ["菜品销售统计（大类）"],
      [],
      [],
      ["营业月份", "菜品大类", "销售数量", "数量占比", "销售额", "销售额占比", "菜品收入", "收入占比", "优惠", "优惠占比"],
      ["2026/07", "Food", 1, 0, 100, 0, 90, 0, 10, 0],
      ["2026/07", " food ", 2, 0, 50, 0, 45, 0, 5, 0],
      ["2026/07", "Ｆｏｏｄ", 1, 0, 20, 0, 20, 0, 0, 0],
      ["2026/07", "Food · 套餐", 1, 0, 30, 0, 30, 0, 0, 0],
    ]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "菜品大类");
    const result = parseMonthlyReport({ dishCatsBase64: write(workbook, { type: "base64", bookType: "xlsx" }) });

    expect(result.error).toBeUndefined();
    expect(result.report?.dishCategories).toHaveLength(2);
    expect(result.report?.dishCategories.find((item) => item.name === "Food")).toMatchObject({
      salesQty: 4,
      salesAmount: 170,
      revenue: 155,
      discountAmount: 15,
    });
    expect(result.report?.dishCategories.find((item) => item.name === "Food·套餐")?.revenue).toBe(30);
  });
});


describe("月度经营报表金额精度", () => {
  it("归并多条小数金额时按分汇总，不保留浮点尾差", () => {
    const sheet = utils.aoa_to_sheet([
      ["菜品销售统计（大类）"],
      [],
      [],
      ["营业月份", "菜品大类", "销售数量", "数量占比", "销售额", "销售额占比", "菜品收入", "收入占比", "优惠", "优惠占比"],
      ["2026/07", "Food", 1, 0, 0.1, 0, 0.1, 0, 0.01, 0],
      ["2026/07", "food", 1, 0, 0.2, 0, 0.2, 0, 0.02, 0],
      ["2026/07", "FOOD", 1, 0, 0.3, 0, 0.3, 0, 0.03, 0],
    ]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "菜品大类");

    const result = parseMonthlyReport({ dishCatsBase64: write(workbook, { type: "base64", bookType: "xlsx" }) });
    const food = result.report?.dishCategories.find((item) => item.name === "Food");

    expect(result.error).toBeUndefined();
    expect(food).toMatchObject({
      salesAmount: 0.6,
      revenue: 0.6,
      discountAmount: 0.06,
    });
  });
});


describe("菜品大类列位保护", () => {
  it("不将营业月份前置模板中的销量数字误写为菜品大类", async () => {
    const { parseDishCategories } = await import("@/lib/store/monthly-report/dish-analysis-parser");
    const sheet = utils.aoa_to_sheet([
      ["菜品销售统计（大类）"],
      ["2026/07"],
      ["营业月份", "菜品大类", "销售数量", "数量占比", "销售额", "销售额占比", "菜品收入", "收入占比", "优惠"],
      [],
      ["2026/07", "Food", 3485, 0.5, 10000, 0.5, 9500, 0.5, 500],
      ["2026/07", "Wine", 1631, 0.21, 4200, 0.21, 4000, 0.21, 200],
      ["2026/07", "合计", 5116, 1, 14200, 1, 13500, 1, 700],
    ]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "菜品大类");

    const result = parseDishCategories(write(workbook, { type: "base64", bookType: "xlsx" }));
    expect(result.categories).toEqual([
      expect.objectContaining({ name: "Food", salesQty: 3485, salesAmount: 10000 }),
      expect.objectContaining({ name: "Wine", salesQty: 1631, salesAmount: 4200 }),
    ]);
    expect(result.categories.some((item) => /^\d/.test(item.name))).toBe(false);
  });
});

describe("菜品大类按月重建", () => {
  it("仅替换错误的大类派生缓存，保留同月小类和菜品明细", async () => {
    const { rebuildDishCategoriesFromMonthlyReport } = await import("@/lib/store/monthly-report/rebuild-dish-categories");
    const snapshot = {
      id: "dish-2026-07", month: "2026-07", monthLabel: "2026年7月", importedAt: "old",
      categories: [{ name: "3485", salesQty: 0, salesQtyPct: 0, salesAmount: 1, salesAmountPct: 0.5, revenue: 1, revenuePct: 0.5, discount: 0 }],
      subCategories: [{ category: "Food", subCategory: "小食", salesQty: 1, salesQtyPct: 1, salesAmount: 100, salesAmountPct: 1, revenue: 100, revenuePct: 1, discount: 0 }],
      items: [], specs: [], dailyPayments: [],
      importedReports: { categories: true, subCategories: true, items: false, specs: false, revenueStatement: false, dailyPayments: false, timeSlotsByOrder: false, timeSlotsByCheckout: false },
    } as any;
    const report = {
      rawMonth: "2026/07", monthLabel: "2026年7月",
      dishCategories: [{ name: "Food", salesQty: 3485, salesQtyPct: 0.5, salesAmount: 10000, salesAmountPct: 0.5, revenue: 9500, revenuePct: 0.5, discountAmount: 500, discountPct: 0.05 }],
    } as any;

    const rebuilt = rebuildDishCategoriesFromMonthlyReport(snapshot, report);
    expect(rebuilt.categories).toEqual([expect.objectContaining({ name: "Food", salesQty: 3485, salesAmount: 10000, discount: 500 })]);
    expect(rebuilt.subCategories).toEqual(snapshot.subCategories);
    expect(rebuilt.items).toEqual([]);
  });
});
