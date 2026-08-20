import { describe, expect, it } from "vitest";
import { getBottleCostPriceImpact, getChannelPriceImpact } from "@/lib/bottles/price-impact";

describe("酒款渠道价格影响", () => {
  const channel = {
    id: "channel-1", name: "供应商A", type: "supplier" as const, latestPrice: 120, unit: "瓶", isCostBasis: true,
    purchaseNames: [], createdAt: "2026-01-01", updatedAt: "2026-08-01",
    priceHistory: [{ date: "2026-07-01", price: 100, source: "manual" as const }, { date: "2026-08-01", price: 120, source: "manual" as const }],
  };
  it("显示当前成本基准相对上次报价的真实差额", () => {
    const impact = getChannelPriceImpact(channel);
    expect(impact).toMatchObject({ previousPrice: 100, currentPrice: 120, delta: 20, deltaPercent: 0.2, isCostBasis: true });
  });
  it("只读取酒款选定的成本基准渠道", () => {
    expect(getBottleCostPriceImpact({ supplierChannels: [channel], costChannelId: "channel-1" } as any)?.channelName).toBe("供应商A");
  });
});
