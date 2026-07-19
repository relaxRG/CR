import { describe, expect, it } from "vitest";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import type { Bottle } from "@/lib/bottles/types";
import type { Ingredient } from "@/lib/recipes/types";

const bottle = (over: Partial<Bottle>): Bottle =>
  ({
    id: "b1",
    nameZh: "金酒",
    nameEn: "Gin",
    category: "金酒",
    library: "spirits",
    brand: "",
    origin: "",
    volume: "700ml",
    abv: 40,
    priceCny: 100,
    notes: "",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as unknown as Bottle;

describe("linkDismissed persistence (Bug 8)", () => {
  it("smart-cost 对 linkDismissed 配料不再自动匹配", () => {
    const bottles = [bottle({ id: "b1", nameZh: "金酒" })];
    const ings: Ingredient[] = [
      { id: "i1", name: "金酒", amount: "45ml", linkDismissed: true } as Ingredient,
    ];
    const est = estimateRecipeCostSmart(ings, bottles, []);
    const item = est.items.find((it) => it.ingredient.id === "i1");
    expect(item?.link ?? null).toBeNull();
  });

  it("未忽略的同名配料仍正常匹配", () => {
    const bottles = [bottle({ id: "b1", nameZh: "金酒" })];
    const ings: Ingredient[] = [
      { id: "i1", name: "金酒", amount: "45ml" } as Ingredient,
    ];
    const est = estimateRecipeCostSmart(ings, bottles, []);
    const item = est.items.find((it) => it.ingredient.id === "i1");
    expect(item?.link).not.toBeNull();
    expect(item?.link?.kind).toBe("bottle");
  });
});
