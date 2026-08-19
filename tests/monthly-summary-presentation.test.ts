import { describe, expect, it } from "vitest";
import { aggregateMonthlyReport } from "@/lib/store/monthly-summary/aggregator";
import { buildMonthlySummaryPresentation } from "@/lib/store/monthly-summary/presentation";
import { formatStoreMoney, STORE_TABLE_METRICS } from "@/lib/store/table-display";

const monthlyReport = {
  id: "mr-2026-07",
  rawMonth: "2026-07",
  kpi: { discountAmount: 13089.52 },
  paymentMethods: [
    { name: "微信", amount: 125097.34 },
    { name: "支付宝", amount: 76428.4 },
    { name: "微信服务费", amount: -152.23 },
  ],
  dishCategories: [
    { name: "Food", revenue: 130865.74 },
    { name: "Wine", revenue: 70660 },
  ],
} as any;

describe("总月报展示分组", () => {
  it("菜品大类优先展示，正向收款渠道不再混入营业收入", () => {
    const result = aggregateMonthlyReport({ month: "2026-07", monthlyReport });
    const presentation = buildMonthlySummaryPresentation(result.lineItems ?? []);

    expect(presentation.dishRevenueItems.map((item) => item.label)).toEqual(["Food", "Wine"]);
    expect(presentation.totalDishRevenue).toBe(201525.74);
    expect(presentation.dishRevenueItems.some((item) => item.label === "微信")).toBe(false);
    expect(presentation.otherRevenueItems).toHaveLength(0);
  });

  it("手续费独立扣减，优惠不在总月报生成重复参考行", () => {
    const result = aggregateMonthlyReport({ month: "2026-07", monthlyReport });
    const presentation = buildMonthlySummaryPresentation(result.lineItems ?? []);

    expect(presentation.feeItems).toHaveLength(1);
    expect(presentation.feeItems[0]).toMatchObject({
      label: "微信服务费",
      amount: -152.23,
      revenueKind: "fee",
    });
    expect(presentation.totalFees).toBe(152.23);
    expect((result.lineItems ?? []).some((item) => item.code === "revenue_discount")).toBe(false);
  });

  it("缺少菜品大类时仅以清晰标识的账户校验收入降级，不假装为菜品收入", () => {
    const result = aggregateMonthlyReport({
      month: "2026-07",
      monthlyReport: { ...monthlyReport, dishCategories: [] },
    });
    const presentation = buildMonthlySummaryPresentation(result.lineItems ?? []);

    expect(presentation.dishRevenueItems).toHaveLength(0);
    expect(presentation.otherRevenueItems.map((item) => item.label)).toEqual([
      "未匹配菜品大类 · 微信",
      "未匹配菜品大类 · 支付宝",
    ]);
  });

  it("旧手动营业收入在新展示中归入其他经营收入而不丢失", () => {
    const presentation = buildMonthlySummaryPresentation([
      {
        id: "legacy-manual-revenue",
        code: "manual_revenue",
        label: "活动收入",
        category: "revenue",
        amount: 888.5,
        source: "manual",
        isDuplicate: false,
      } as any,
    ]);

    expect(presentation.dishRevenueItems).toHaveLength(0);
    expect(presentation.otherRevenueItems).toMatchObject([{ label: "活动收入", amount: 888.5 }]);
    expect(presentation.totalOtherRevenue).toBe(888.5);
  });

  it("门店金额格式与总月报密度使用完整两位小数和统一紧凑高度", () => {
    expect(formatStoreMoney(250655.74)).toBe("¥250,655.74");
    expect(formatStoreMoney(0)).toBe("¥0.00");
    expect(STORE_TABLE_METRICS).toMatchObject({
      headerHeight: 48,
      rowHeight: 46,
      groupHeight: 34,
      summaryHeaderHeight: 42,
      summaryRowHeight: 40,
    });
  });
});
