import { describe, expect, it } from "vitest";
import { rankWineLinkCandidates } from "@/lib/wine/link-candidates";
import { projectWinePurchaseChannels, reconcileWineBottlePurchaseProjection } from "@/lib/wine/purchase-bottle-projection";
import type { WineBottle, WineInventoryItem, WineManualPurchase } from "@/lib/wine/types";

const now = "2026-08-22T10:00:00.000Z";
const bottle = (id: string, overrides: Partial<WineBottle> = {}): WineBottle => ({
  id, name: "霞多丽 2022 750ml", nameEn: "Chardonnay 2022 750ml", vintage: "2022", region: "", grape: "", winery: "", style: "white", abv: null, costPrice: 100, salePrice: null, stock: 0, rating: null, notes: "", photoUri: "", supplier: "供应商 A", createdAt: now, updatedAt: now,
  ...overrides,
});
const purchase = (id: string, bottleId: string | null, overrides: Partial<WineManualPurchase> = {}): WineManualPurchase => ({
  id, date: "2026-08-01", supplier: "供应商 A", bottleId, productName: "供应商 A 的霞多丽", unitPrice: 100, quantity: 2, amount: 200, notes: "", createdAt: now,
  ...overrides,
});
const inventoryItem: WineInventoryItem = { seq: 1, wineType: "white", category: "white", supplier: "供应商 A", name: "霞多丽 2022 750ml", initUnitCost: 0, initQty: 0, initCost: 0, purchaseQty: 0, purchaseCost: 0, endQty: 0, unitCost: 0, endCost: 0, consumeBottles: 0, consumeQty: 0 };

describe("葡萄酒采购到档案投影", () => {
  it("仅投影已确认 bottleId 的采购，重复协调幂等且不根据名称自动绑定", () => {
    const linked = purchase("p-1", "bottle-a");
    const unlinkedSameName = purchase("p-2", null, { productName: "霞多丽 2022 750ml" });
    const first = projectWinePurchaseChannels("bottle-a", [linked, unlinkedSameName]);
    expect(first).toHaveLength(1);
    expect(first[0].priceHistory.map((entry) => entry.sourcePurchaseId)).toEqual(["p-1"]);
    const updates = reconcileWineBottlePurchaseProjection(bottle("bottle-a"), [linked, unlinkedSameName]);
    expect(updates).toMatchObject({ costPrice: 100, costChannelId: first[0].id, purchaseChannelProjections: first });
    expect(reconcileWineBottlePurchaseProjection({ ...bottle("bottle-a"), ...updates }, [linked, unlinkedSameName])).toBeNull();
  });

  it("重链或删除采购后旧档案投影会清空，并保留仍有效的人工成本渠道选择", () => {
    const aFirst = purchase("p-a1", "bottle-a", { supplier: "供应商 A", unitPrice: 100, amount: 100, quantity: 1 });
    const aSecond = purchase("p-a2", "bottle-a", { supplier: "供应商 B", unitPrice: 130, amount: 130, quantity: 1, date: "2026-08-10" });
    const channels = projectWinePurchaseChannels("bottle-a", [aFirst, aSecond]);
    const preferred = channels.find((channel) => channel.supplier === "供应商 B")!;
    const selected = bottle("bottle-a", { purchaseChannelProjections: channels, costChannelId: preferred.id, costPrice: 130 });
    expect(reconcileWineBottlePurchaseProjection(selected, [aFirst, aSecond])).toBeNull();
    const relinked = { ...aFirst, bottleId: "bottle-b" };
    const oldUpdates = reconcileWineBottlePurchaseProjection(selected, [relinked, aSecond]);
    expect(oldUpdates).toMatchObject({ purchaseChannelProjections: [expect.objectContaining({ supplier: "供应商 B" })], costChannelId: preferred.id, costPrice: 130 });
    const deletedAll = reconcileWineBottlePurchaseProjection({ ...selected, ...oldUpdates }, []);
    expect(deletedAll?.purchaseChannelProjections).toEqual([]);
    expect(deletedAll?.costChannelId).toBeUndefined();
  });
});

describe("葡萄酒智能链接候选", () => {
  it("仅返回待确认候选，并提升中英文名称、供应商、年份和规格一致的档案", () => {
    const exact = bottle("exact");
    const similarWrongSupplier = bottle("similar", { supplier: "供应商 Z", name: "霞多丽 2021 750ml", nameEn: "Chardonnay 2021 750ml", vintage: "2021" });
    const candidates = rankWineLinkCandidates(inventoryItem, [similarWrongSupplier, exact]);
    expect(candidates.map((candidate) => candidate.bottle.id)).toEqual(["exact", "similar"]);
    expect(candidates[0].reasons).toEqual(expect.arrayContaining(["名称完全匹配", "供应商一致", "年份一致", "规格一致"]));
    expect(candidates.every((candidate) => candidate.bottle.id)).toBe(true);
  });
});
