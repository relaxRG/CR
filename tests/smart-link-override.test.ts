import { describe, expect, it } from "vitest";
import { smartLinkIngredient } from "../lib/recipes/smart-link";
import type { Bottle } from "../lib/bottles/types";

/** 最小可用的 Bottle 构造器（只填 smartLink 相关字段） */
function mkBottle(partial: Partial<Bottle> & { id: string; nameZh: string }): Bottle {
  return {
    nameEn: "",
    category: "果蔬",
    style: "",
    brand: "",
    origin: "",
    volume: "",
    abv: 0,
    priceCny: 0,
    notes: "",
    flavorTags: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as unknown as Bottle;
}

type PrepLike = { id: string; name: string; nameAlt?: string };

function mkPrep(partial: PrepLike): PrepLike {
  return partial;
}

describe("smartLink auto mode with libraryOverride=homemade bottles (Bug 1)", () => {
  it("matches a bottle whose libraryOverride is homemade (garnish row should link)", () => {
    const bottles = [
      mkBottle({ id: "b1", nameZh: "脱水菠萝", libraryOverride: "homemade" } as never),
    ];
    const link = smartLinkIngredient("脱水菠萝", bottles as Bottle[], [] as never, "auto");
    expect(link).not.toBeNull();
    expect(link?.kind).toBe("bottle");
    if (link?.kind === "bottle") expect(link.bottle.id).toBe("b1");
  });

  it("prefers an exact-name prep over an override bottle with the same name", () => {
    const bottles = [
      mkBottle({ id: "b2", nameZh: "自制糖浆", libraryOverride: "homemade" } as never),
    ];
    const preps = [mkPrep({ id: "p1", name: "自制糖浆" })];
    const link = smartLinkIngredient("自制糖浆", bottles as Bottle[], preps as never, "auto");
    expect(link).not.toBeNull();
    expect(link?.kind).toBe("prep");
    if (link?.kind === "prep") expect(link.prep.id).toBe("p1");
  });

  it("still matches normal bottles without override", () => {
    const bottles = [mkBottle({ id: "b3", nameZh: "安高天娜苦精" })];
    const link = smartLinkIngredient("安高天娜苦精", bottles as Bottle[], [] as never, "auto");
    expect(link).not.toBeNull();
    expect(link?.kind).toBe("bottle");
  });
});
