import { describe, expect, it } from "vitest";
import { normalizeBottle, type Bottle } from "@/lib/bottles/types";
import { hasBottlePurchaseProjectionChanged, projectBottleSupplierChannelsFromPurchases } from "@/lib/spirits/purchase-bottle-projection";
import type { SpiritPurchaseRecord } from "@/lib/spirits/types";

const bottle = (patch: Partial<Bottle> = {}): Bottle => normalizeBottle({ id: "bottle-mezcal", nameZh: "福得梅斯卡尔龙舌兰酒", priceCny: 0, ...patch });
const purchase = (patch: Partial<SpiritPurchaseRecord> = {}): SpiritPurchaseRecord => ({
  id: "purchase-1", month: "2026-01", date: "2026-01-30", itemId: "spirit-mezcal",
  rawName: "福得梅斯卡尔龙舌兰酒", unit: "瓶", quantity: 1, unitPrice: 195, amount: 195,
  supplier: "至缘", source: "manual", createdAt: "2026-01-30T10:00:00.000Z", ...patch,
});

describe("烈酒采购到酒库价格卡片投影", () => {
  it("首次链接采购自动生成供应渠道、采购名称、价格历史与唯一成本基准", () => {
    const projected = projectBottleSupplierChannelsFromPurchases(bottle(), [purchase()]);
    expect(projected.costChannelId).toBeTruthy();
    expect(projected.priceCny).toBe(195);
    expect(projected.supplierChannels).toHaveLength(1);
    expect(projected.supplierChannels[0]).toMatchObject({ name: "至缘", latestPrice: 195, unit: "瓶", isCostBasis: true });
    expect(projected.supplierChannels[0].purchaseNames?.map((entry) => entry.name)).toEqual(["福得梅斯卡尔龙舌兰酒"]);
    expect(projected.supplierChannels[0].priceHistory).toMatchObject([{ date: "2026-01-30", price: 195, quantity: 1, sourcePurchaseId: "purchase-1" }]);
  });

  it("同渠道新旧采购名称、价格和数量汇总为同一渠道，最新采购决定最新价", () => {
    const projected = projectBottleSupplierChannelsFromPurchases(bottle(), [
      purchase(),
      purchase({ id: "purchase-2", date: "2026-02-10", rawName: "福得梅斯卡尔 Mezcal", unitPrice: 215, quantity: 2, amount: 430, source: "excel", createdAt: "2026-02-10T10:00:00.000Z" }),
    ]);
    expect(projected.supplierChannels).toHaveLength(1);
    expect(projected.supplierChannels[0].latestPrice).toBe(215);
    expect(projected.supplierChannels[0].purchaseNames?.map((entry) => entry.name)).toEqual(["福得梅斯卡尔龙舌兰酒", "福得梅斯卡尔 Mezcal"]);
    expect(projected.supplierChannels[0].priceHistory?.map((entry) => entry.sourcePurchaseId)).toEqual(["purchase-2", "purchase-1"]);
  });

  it("多供应商分别形成渠道，已选成本基准不会被后续新渠道自动替换", () => {
    const base = bottle({ supplierChannels: [{
      id: "channel-zhiyuan", type: "supplier", name: "至缘", latestPrice: 195, unit: "瓶", isCostBasis: true,
      priceHistory: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    }], costChannelId: "channel-zhiyuan", priceCny: 195 });
    const projected = projectBottleSupplierChannelsFromPurchases(base, [purchase(), purchase({ id: "purchase-2", supplier: "戎恒", unitPrice: 180, createdAt: "2026-02-01T00:00:00.000Z" })]);
    expect(projected.supplierChannels).toHaveLength(2);
    expect(projected.costChannelId).toBe("channel-zhiyuan");
    expect(projected.priceCny).toBe(195);
  });

  it("同一采购重复同步不追加重复价格历史；删除采购后投影可收敛", () => {
    const first = projectBottleSupplierChannelsFromPurchases(bottle(), [purchase()]);
    const onceProjected = { ...bottle(first), ...first } as Bottle;
    const second = projectBottleSupplierChannelsFromPurchases(onceProjected, [purchase()]);
    expect(second.supplierChannels[0].priceHistory).toHaveLength(1);
    expect(hasBottlePurchaseProjectionChanged(onceProjected, second)).toBe(false);

    const emptied = projectBottleSupplierChannelsFromPurchases(onceProjected, []);
    expect(emptied.supplierChannels).toHaveLength(0);
  });

  it("采购重链到另一款酒时，旧酒款的渠道、源采购历史、成本基准与有效成本均被撤销", () => {
    const source = bottle({ id: "bottle-source", nameZh: "旧酒款" });
    const firstProjection = projectBottleSupplierChannelsFromPurchases(source, [purchase()]);
    const sourceWithPurchase = { ...source, ...firstProjection } as Bottle;

    // 当前采购被重新链接至另一款酒：旧酒款收到空采购集，新酒款收到原采购记录。
    const sourceAfterRelink = projectBottleSupplierChannelsFromPurchases(sourceWithPurchase, []);
    const targetAfterRelink = projectBottleSupplierChannelsFromPurchases(
      bottle({ id: "bottle-target", nameZh: "新酒款" }),
      [purchase()],
    );

    expect(sourceAfterRelink).toEqual({ supplierChannels: [], costChannelId: undefined, priceCny: 0 });
    expect(hasBottlePurchaseProjectionChanged(sourceWithPurchase, sourceAfterRelink)).toBe(true);
    expect(targetAfterRelink.supplierChannels[0].priceHistory?.[0].sourcePurchaseId).toBe("purchase-1");
    expect(targetAfterRelink.priceCny).toBe(195);
  });
});
