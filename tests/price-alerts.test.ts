import { describe, expect, it } from "vitest";
import { emptyPriceAlertLedger, inspectPriceChannel, resolvePriceAlert, upsertPriceAlerts } from "@/lib/bottles/price-alerts";

const bottle = { id: "bottle-1" } as any;
const channel = { id: "channel-1", name: "供应商", type: "supplier", latestPrice: 130, unit: "瓶", isCostBasis: true, purchaseNames: [], createdAt: "2026-01-01", updatedAt: "2026-08-01", priceHistory: [{ date: "2026-07-01", price: 100, source: "manual" }, { date: "2026-08-01", price: 130, source: "manual" }] } as any;

describe("价格异常告警账本", () => {
  it("基准渠道异常涨价创建严重告警并通过指纹去重", () => {
    const candidates = inspectPriceChannel(bottle, channel, "channel_edit");
    expect(candidates.some((entry) => entry.severity === "critical")).toBe(true);
    const first = upsertPriceAlerts(emptyPriceAlertLedger(), candidates, "2026-08-01T00:00:00.000Z");
    const second = upsertPriceAlerts(first, candidates, "2026-08-01T01:00:00.000Z");
    expect(second.alerts).toHaveLength(first.alerts.length);
    expect(second.alerts[0].detectedCount).toBe(2);
  });
  it("促销抑制不因重复巡检重新打开", () => {
    const candidates = inspectPriceChannel(bottle, channel, "channel_edit");
    const ledger = upsertPriceAlerts(emptyPriceAlertLedger(), candidates);
    const suppressed = resolvePriceAlert(ledger, ledger.alerts[0].id, "temporary_promotion", "2099-01-01T00:00:00.000Z");
    expect(upsertPriceAlerts(suppressed, candidates).alerts[0].status).toBe("suppressed");
  });
});
