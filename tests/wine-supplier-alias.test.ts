import { describe, expect, it } from "vitest";
import { WineBottle } from "@/lib/wine/types";
import {
  bottleHasWineSupplier,
  createWineSupplierAlias,
  getWinePurchaseNameForSupplier,
  resolveWineBottleForSupplierName,
  upsertWineSupplierAlias,
} from "@/lib/wine/supplier-alias";

function bottle(overrides: Partial<WineBottle> = {}): WineBottle {
  return {
    id: "bottle-1",
    name: "白占边（标准名）",
    nameEn: "Benchmark",
    vintage: "",
    region: "",
    grape: "",
    winery: "",
    style: "other",
    abv: null,
    costPrice: null,
    salePrice: null,
    stock: 0,
    rating: null,
    notes: "",
    photoUri: "",
    supplier: "至缘",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("葡萄酒供应商采购名称别名", () => {
  it("同一标准酒款可保存某供应商的不同采购名称，且重复录入会幂等覆盖", () => {
    const first = upsertWineSupplierAlias([], "至缘", "白占边（金宾波本）");
    const second = upsertWineSupplierAlias(first, "至缘", "白占边（金宾波本）");
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ supplier: "至缘", purchaseName: "白占边（金宾波本）" });
  });

  it("优先用供应商别名匹配，不因采购名称不同创建第二条酒款主档", () => {
    const aliases = [createWineSupplierAlias("至缘", "白占边（金宾波本）")];
    const matched = resolveWineBottleForSupplierName([bottle({ supplierAliases: aliases })], "至缘", "白占边（金宾波本）");
    expect(matched?.bottle.id).toBe("bottle-1");
    expect(matched?.reason).toBe("supplier-alias");
  });

  it("默认供应商下的标准中文名和原文名仍可确定性匹配", () => {
    expect(resolveWineBottleForSupplierName([bottle()], "至缘", "白占边（标准名）")?.reason).toBe("supplier-canonical-name");
    expect(resolveWineBottleForSupplierName([bottle()], "至缘", "Benchmark")?.reason).toBe("supplier-canonical-name");
  });

  it("多条候选时拒绝猜测，避免供应商名称把采购流水错误关联到酒款", () => {
    const sameAlias = createWineSupplierAlias("至缘", "白占边（金宾波本）");
    const result = resolveWineBottleForSupplierName([
      bottle({ id: "one", supplierAliases: [sameAlias] }),
      bottle({ id: "two", supplierAliases: [sameAlias] }),
    ], "至缘", "白占边（金宾波本）");
    expect(result).toBeNull();
  });

  it("供应商工作台能从别名识别关联酒款，并为该供应商展示采购名称", () => {
    const item = bottle({ supplierAliases: [createWineSupplierAlias("新酒商", "Supplier Label")] });
    expect(bottleHasWineSupplier(item, "新酒商")).toBe(true);
    expect(getWinePurchaseNameForSupplier(item, "新酒商")).toBe("Supplier Label");
  });
});
