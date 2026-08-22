import { describe, expect, it } from "vitest";
import { applyAtomicSpiritBatchCategorySelection, applyAtomicSpiritCategorySelection } from "../lib/spirits/category-selection";
import { resolvePurchaseDisplayCategory } from "../lib/spirits/purchase-category-sync";

const item = {
  id: "spirit-1", name: "测试酒款", category: "Other", categorySource: "auto" as const,
  unit: "瓶", refPrice: 0, active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const purchase = {
  id: "purchase-1", month: "2026-01", date: "2026-01-30", itemId: "spirit-1", rawName: "测试酒款",
  category: "Other", unit: "瓶", quantity: 1, unitPrice: 100, amount: 100, source: "manual" as const, createdAt: "2026-01-30T00:00:00.000Z",
};

describe("烈酒采购分类同步", () => {
  it("已关联酒款时，进货分类列优先显示库存主档的当前分类", () => {
    expect(resolvePurchaseDisplayCategory({ category: "Other" }, { category: "Base (Gin)" })).toBe("Base (Gin)");
  });

  it("未关联酒款时保留采购发生时的分类快照", () => {
    expect(resolvePurchaseDisplayCategory({ category: "Other" }, null)).toBe("Other");
    expect(resolvePurchaseDisplayCategory({ category: "" }, null)).toBe("未分类");
  });

  it("快速选择分类以单个状态转换同步库存主档、当前采购行和酒款关联", () => {
    const next = applyAtomicSpiritCategorySelection([item], [purchase], "spirit-1", "  Base (Rum)  ", "purchase-1", "2026-02-01T00:00:00.000Z");

    expect(next.items[0]).toMatchObject({ category: "Base (Rum)", categorySource: "manual", updatedAt: "2026-02-01T00:00:00.000Z" });
    expect(next.purchases[0]).toMatchObject({ itemId: "spirit-1", category: "Base (Rum)" });
    expect(resolvePurchaseDisplayCategory(next.purchases[0], next.items[0])).toBe("Base (Rum)");
  });

  it("库存管理直接修改分类时不改写历史采购快照", () => {
    const next = applyAtomicSpiritCategorySelection([item], [purchase], "spirit-1", "Mezcal", undefined, "2026-02-01T00:00:00.000Z");

    expect(next.items[0].category).toBe("Mezcal");
    expect(next.purchases[0].category).toBe("Other");
    expect(resolvePurchaseDisplayCategory(next.purchases[0], next.items[0])).toBe("Mezcal");
  });

  it("批量分类以单个状态转换同步所有所选采购行和关联库存酒款", () => {
    const secondItem = { ...item, id: "spirit-2", name: "第二款酒", category: "Base" };
    const secondPurchase = { ...purchase, id: "purchase-2", itemId: "spirit-2", rawName: "第二款酒", category: "Base" };
    const unmatchedPurchase = { ...purchase, id: "purchase-3", itemId: undefined, rawName: "未关联采购" };
    const next = applyAtomicSpiritBatchCategorySelection(
      [item, secondItem], [purchase, secondPurchase, unmatchedPurchase], ["purchase-1", "purchase-2", "purchase-3"], "Mezcal", "2026-02-01T00:00:00.000Z",
    );

    expect(next.items.map((entry) => entry.category)).toEqual(["Mezcal", "Mezcal"]);
    expect(next.purchases.map((entry) => entry.category)).toEqual(["Mezcal", "Mezcal", "Mezcal"]);
    expect(next.purchases[2].itemId).toBeUndefined();
  });
});
