import { describe, expect, it } from "vitest";
import { normalizeRecipe, parseGarnishToItems, serializeGarnishItems, type GarnishItem } from "../lib/recipes/types";
import { estimateGarnishCost } from "../lib/recipes/garnish-split";
import type { Bottle } from "../lib/bottles/types";
import type { HomemadePrep } from "../lib/homemade/types";

const baseRecipe = {
  id: "r1",
  name: "Test",
  categoryId: null,
  baseSpirit: "",
  glass: "",
  method: "",
  strength: "" as const,
  variantOf: "",
  codexFamily: "",
  flavors: [],
  source: "",
  story: "",
  flavorDesc: "",
  ingredients: [],
  steps: "",
  notes: "",
  favorite: false,
  made: false,
  rating: null,
  sortIndex: null,
  cardTagOrder: null,
  createdAt: 0,
  updatedAt: 0,
};

describe("garnishItems migration & serialization", () => {
  it("migrates legacy garnish string to garnishItems", () => {
    const rec = normalizeRecipe({ ...baseRecipe, garnish: "柠檬皮, 薄荷叶" } as any);
    expect(rec.garnishItems?.length).toBe(2);
    expect(rec.garnishItems?.[0].name).toBe("柠檬皮");
    expect(rec.garnishItems?.[1].name).toBe("薄荷叶");
  });

  it("keeps existing garnishItems untouched (with linkDismissed)", () => {
    const items: GarnishItem[] = [{ id: "g1", name: "柠檬皮", linkDismissed: true }];
    const rec = normalizeRecipe({ ...baseRecipe, garnish: "柠檬皮", garnishItems: items } as any);
    expect(rec.garnishItems?.[0].linkDismissed).toBe(true);
  });

  it("serializeGarnishItems joins names and skips empties", () => {
    const items: GarnishItem[] = [
      { id: "a", name: "橙皮" },
      { id: "b", name: "  " },
      { id: "c", name: "樱桃" },
    ];
    expect(serializeGarnishItems(items)).toBe("橙皮, 樱桃");
  });

  it("parseGarnishToItems splits on comma/semicolon", () => {
    const items = parseGarnishToItems("橙皮; 樱桃, 薄荷");
    expect(items.map((i) => i.name)).toEqual(["橙皮", "樱桃", "薄荷"]);
  });
});

describe("estimateGarnishCost with structured garnishItems", () => {
  const bottle: Bottle = {
    id: "b1",
    nameEn: "Lemon",
    nameZh: "柠檬",
    brand: "",
    category: "materials",
    style: "",
    abv: 0,
    volumeMl: 1000,
    price: 10,
    stock: 1,
    notes: "",
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Bottle;
  const preps: HomemadePrep[] = [];

  it("respects linkDismissed: no link, not in unmatched", () => {
    const cost = estimateGarnishCost("柠檬", [bottle], preps, [
      { id: "g1", name: "柠檬", linkDismissed: true },
    ]);
    expect(cost.unmatchedNames).not.toContain("柠檬");
    expect(cost.groups[0]?.items[0]?.est.link).toBeNull();
  });

  it("uses explicit linkedBottleId", () => {
    const cost = estimateGarnishCost("随便写的名字", [bottle], preps, [
      { id: "g1", name: "随便写的名字", linkedBottleId: "b1" },
    ]);
    expect(cost.groups[0]?.items[0]?.est.link?.kind).toBe("bottle");
  });

  it("unmatched garnish (no dismiss) recorded for auto-add", () => {
    const cost = estimateGarnishCost("神秘装饰", [bottle], preps, [
      { id: "g1", name: "神秘装饰" },
    ]);
    expect(cost.unmatchedNames).toContain("神秘装饰");
  });
});
