import { describe, expect, it } from "vitest";
import { buildWinePurchaseComparison, previousBusinessMonth } from "@/lib/wine/purchase-comparison";

const records = [
  { supplier: "供应商 A", productName: "酒款一", month: "2025-12", amount: 100 },
  { supplier: "供应商 A", productName: "酒款二", month: "2026-01", amount: 220 },
  { supplier: "供应商 B", productName: "酒款三", month: "2026-01", amount: 50 },
  { supplier: "供应商 A", productName: "酒款一", month: "2026-02", amount: 80 },
];

describe("葡萄酒采购比较读模型", () => {
  it("正确跨年定位上月", () => {
    expect(previousBusinessMonth("2026-01")).toBe("2025-12");
  });

  it("按供应商比较当月采购，零基数不伪造百分比", () => {
    expect(buildWinePurchaseComparison(records, { month: "2026-01", dimension: "supplier" })).toEqual([
      { key: "供应商 A", currentAmount: 220, comparisonAmount: 100, deltaAmount: 120, deltaRatio: 1.2 },
      { key: "供应商 B", currentAmount: 50, comparisonAmount: 0, deltaAmount: 50, deltaRatio: null },
    ]);
  });

  it("累计模式按相同维度保留全量历史并支持按酒款下钻", () => {
    expect(buildWinePurchaseComparison(records, { month: "2026-02", comparisonMonth: "2026-01", dimension: "product", cumulative: true })).toEqual([
      { key: "酒款二", currentAmount: 220, comparisonAmount: 220, deltaAmount: 0, deltaRatio: 0 },
      { key: "酒款一", currentAmount: 180, comparisonAmount: 100, deltaAmount: 80, deltaRatio: 0.8 },
      { key: "酒款三", currentAmount: 50, comparisonAmount: 50, deltaAmount: 0, deltaRatio: 0 },
    ]);
  });
});
