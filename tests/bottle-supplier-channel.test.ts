import { describe, expect, it } from "vitest";
import {
  getEffectiveCostPrice,
  getSupplierChannelPurchaseNames,
  normalizeBottle,
  normalizeSupplierChannels,
  type Bottle,
} from "@/lib/bottles/types";
import { resolveBottleForSupplierProductName } from "@/lib/bottles/supplier-channel-resolver";

const bottle = (id: string, nameZh: string, channels: Partial<Bottle>["supplierChannels"] = []): Bottle => normalizeBottle({
  id,
  nameZh,
  supplierChannels: channels,
});

describe("鸡尾酒库统一供应渠道", () => {
  it("将旧单一采购名称迁移为去重的多采购名称，并只保留一个成本基准", () => {
    const channels = normalizeSupplierChannels([
      {
        id: "channel-a", type: "supplier", name: "至缘", supplierProductName: "君度 FP", latestPrice: 100, unit: "瓶", isCostBasis: true,
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
      },
      {
        id: "channel-b", type: "self", name: "京东自营", purchaseNames: [{ name: "君度橙味利口酒", normalizedName: "stale" }, { name: "君度 FP", normalizedName: "stale" }], latestPrice: 98, unit: "瓶", isCostBasis: true,
        createdAt: "2026-01-02", updatedAt: "2026-01-02",
      },
    ], "channel-b");
    expect(channels.filter((channel) => channel.isCostBasis).map((channel) => channel.id)).toEqual(["channel-b"]);
    expect(getSupplierChannelPurchaseNames(channels[1]).map((entry) => entry.name)).toEqual(["君度橙味利口酒", "君度 FP"]);
    expect(getSupplierChannelPurchaseNames(channels[1]).map((entry) => entry.normalizedName)).toEqual(["君度橙味利口酒", "君度fp"]);
  });

  it("渠道现名、旧名和简称都可唯一关联，歧义时绝不自动绑定", () => {
    const cointreau = bottle("cointreau", "君度", [{
      id: "zhiyuan", type: "supplier", name: "至缘", latestPrice: 100, unit: "瓶", isCostBasis: true,
      purchaseNames: [
        { name: "君度 FP", normalizedName: "君度fp" },
        { name: "君度橙味利口酒", normalizedName: "君度橙味利口酒" },
      ],
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }]);
    expect(resolveBottleForSupplierProductName([cointreau], "至缘", "君度橙味利口酒")?.bottle.id).toBe("cointreau");
    expect(resolveBottleForSupplierProductName([cointreau], "至缘", "君度 FP")?.confidence).toBe("channel-exact");
    const duplicate = bottle("duplicate", "另一款", [{
      id: "duplicate-channel", type: "supplier", name: "至缘", latestPrice: 99, unit: "瓶", isCostBasis: false,
      purchaseNames: [{ name: "君度 FP", normalizedName: "君度fp" }], createdAt: "2026-01-01", updatedAt: "2026-01-01",
    }]);
    expect(resolveBottleForSupplierProductName([cointreau, duplicate], "至缘", "君度 FP")).toBeNull();
  });

  it("成本价格优先读取明确选择的渠道基准而不改变酒款参考价字段", () => {
    const linked = bottle("cointreau", "君度", [
      { id: "supplier", type: "supplier", name: "至缘", latestPrice: 100, unit: "瓶", isCostBasis: false, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "self", type: "self", name: "京东自营", latestPrice: 96, unit: "瓶", isCostBasis: true, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    ]);
    const normalized = normalizeBottle({ ...linked, priceCny: 120, costChannelId: "self" });
    expect(getEffectiveCostPrice(normalized)).toBe(96);
    expect(normalized.priceCny).toBe(120);
  });
});
