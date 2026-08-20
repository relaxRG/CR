import { describe, expect, it } from "vitest";
import { normalizeBottle, type Bottle } from "@/lib/bottles/types";
import { migrateSpiritAliasesToBottleChannels } from "@/lib/spirits/bottle-channel-migration";
import type { SpiritItem } from "@/lib/spirits/types";

const spirit = (patch: Partial<SpiritItem> = {}): SpiritItem => ({
  id: "spirit-cointreau",
  name: "君度",
  category: "Orange Liqueur",
  unit: "瓶",
  refPrice: 100,
  supplier: "至缘",
  supplierAliases: [{ supplier: "至缘", purchaseName: "君度 FP", normalizedSupplier: "至缘", normalizedName: "君度fp" }],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const bottle = (patch: Partial<Bottle> = {}): Bottle => normalizeBottle({
  id: "bottle-cointreau",
  nameZh: "君度",
  priceCny: 0,
  ...patch,
});

describe("烈酒别名迁移到鸡尾酒库供应渠道", () => {
  it("仅在唯一匹配时关联酒款，并把旧别名和参考价迁入供应商渠道", () => {
    const result = migrateSpiritAliasesToBottleChannels([spirit()], [bottle()], "2026-08-20T00:00:00.000Z");
    expect(result.unresolvedItemIds).toEqual([]);
    expect(result.itemPatches).toEqual([{ id: "spirit-cointreau", patch: { bottleId: "bottle-cointreau", bottleLinkConfidence: "auto" } }]);
    const migrated = result.bottleUpdates[0];
    expect(migrated.costChannelId).toBeTruthy();
    expect(migrated.priceCny).toBe(100);
    expect(migrated.supplierChannels?.[0]).toMatchObject({ name: "至缘", latestPrice: 100, isCostBasis: true });
    expect(migrated.supplierChannels?.[0].purchaseNames?.map((entry) => entry.name)).toEqual(["君度", "君度 FP"]);
    expect(migrated.supplierChannels?.[0].priceHistory?.[0]).toMatchObject({ price: 100, source: "烈酒历史迁移" });
  });

  it("多个候选酒款时保持待关联，绝不自动创建或错误合并渠道", () => {
    const duplicate = bottle({ id: "bottle-duplicate", nameZh: "君度" });
    const result = migrateSpiritAliasesToBottleChannels([spirit({ supplierAliases: [] })], [bottle(), duplicate]);
    expect(result.itemPatches).toEqual([]);
    expect(result.bottleUpdates).toEqual([]);
    expect(result.unresolvedItemIds).toEqual(["spirit-cointreau"]);
  });
});
