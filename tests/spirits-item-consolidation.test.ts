import { describe, expect, it } from "vitest";
import {
  canPrepareSpiritItemConsolidation,
  findExactSpiritItemDuplicateGroups,
  findSharedBottleLinkGroups,
  normalizeSpiritIdentityName,
} from "@/lib/spirits/item-consolidation";
import type { SpiritItem } from "@/lib/spirits/types";

const item = (id: string, name: string, overrides: Partial<SpiritItem> = {}): SpiritItem => ({
  id,
  name,
  category: "Gin",
  unit: "瓶",
  refPrice: 0,
  active: true,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
  ...overrides,
});

describe("烈酒商品整理候选", () => {
  it("只将Unicode、大小写和空白差异视为完全同名候选，不吞掉实际不同的酒款", () => {
    const groups = findExactSpiritItemDuplicateGroups([
      item("a", "芝 华 士 12 年", { nameEn: "Chivas 12" }),
      item("b", "芝华士12年", { nameEn: "CHIVAS１２" }),
      item("c", "芝华士18年", { nameEn: "Chivas 18" }),
    ]);

    expect(normalizeSpiritIdentityName("Ｃhivas  12\u200B")).toBe("chivas12");
    expect(groups).toEqual([
      { normalizedName: "芝华士12年", itemIds: ["a", "b"], match: "exact-normalized" },
      { normalizedName: "chivas12", itemIds: ["a", "b"], match: "exact-normalized" },
    ]);
  });

  it("多个烈酒条目链接同一鸡尾酒库档案时只提示人工整理，不将其自动视为同一库存", () => {
    const shared = findSharedBottleLinkGroups([
      item("a", "供应商 A 名称", { bottleId: "bottle_chivas" }),
      item("b", "供应商 B 名称", { bottleId: "bottle_chivas" }),
      item("c", "不同酒款", { bottleId: "bottle_other" }),
    ]);

    expect(shared).toEqual([{ bottleId: "bottle_chivas", itemIds: ["a", "b"] }]);
    expect(canPrepareSpiritItemConsolidation("a", ["b"])).toBe(true);
    expect(canPrepareSpiritItemConsolidation("a", ["a"])).toBe(false);
    expect(canPrepareSpiritItemConsolidation("", ["b"])).toBe(false);
  });
});
