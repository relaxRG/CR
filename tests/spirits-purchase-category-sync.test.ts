import { describe, expect, it } from "vitest";
import { buildPurchaseCategorySelection, resolvePurchaseDisplayCategory } from "../lib/spirits/purchase-category-sync";

describe("烈酒采购分类同步", () => {
  it("已关联酒款时，进货分类列优先显示库存主档的当前分类", () => {
    expect(resolvePurchaseDisplayCategory({ category: "Other" }, { category: "Base (Gin)" })).toBe("Base (Gin)");
  });

  it("未关联酒款时保留采购发生时的分类快照", () => {
    expect(resolvePurchaseDisplayCategory({ category: "Other" }, null)).toBe("Other");
    expect(resolvePurchaseDisplayCategory({ category: "" }, null)).toBe("未分类");
  });

  it("快速选择分类写回当前采购记录的酒款关联和分类", () => {
    expect(buildPurchaseCategorySelection("spirit-1", "  Base (Rum)  ")).toEqual({ itemId: "spirit-1", category: "Base (Rum)" });
  });
});
