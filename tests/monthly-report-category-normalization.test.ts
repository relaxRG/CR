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
