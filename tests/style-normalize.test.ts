import { describe, expect, it } from "vitest";
import { normalizeStyleToTaxonomy } from "../lib/bottles/style-normalize";

const RUM_STYLES = [
  { name: "White / Light", zh: "白朗姆" },
  { name: "Gold", zh: "金朗姆" },
  { name: "Aged / Añejo", zh: "陈酿朗姆" },
  { name: "Dark / Black", zh: "黑朗姆" },
  { name: "Jamaican Pot Still", zh: "牙买加壶式" },
  { name: "Cachaça", zh: "卡莎萨" },
  { name: "Overproof", zh: "高度朗姆" },
  { name: "Spiced", zh: "香料朗姆" },
];

const GIN_STYLES = [
  { name: "London Dry", zh: "伦敦干金" },
  { name: "Old Tom", zh: "老汤姆" },
  { name: "Contemporary / New Western", zh: "当代风格" },
  { name: "Sloe & Flavored Gin", zh: "黑刺李/风味金酒" },
  { name: "Aged Gin", zh: "陈酿金酒" },
];

describe("normalizeStyleToTaxonomy", () => {
  it("returns exact match as-is", () => {
    expect(normalizeStyleToTaxonomy("Gold", RUM_STYLES)).toBe("Gold");
    expect(normalizeStyleToTaxonomy("London Dry", GIN_STYLES)).toBe("London Dry");
  });

  it("matches Chinese display name", () => {
    expect(normalizeStyleToTaxonomy("白朗姆", RUM_STYLES)).toBe("White / Light");
    expect(normalizeStyleToTaxonomy("老汤姆", GIN_STYLES)).toBe("Old Tom");
  });

  it("normalizes case and slash spacing differences", () => {
    expect(normalizeStyleToTaxonomy("white/light", RUM_STYLES)).toBe("White / Light");
    expect(normalizeStyleToTaxonomy("london dry", GIN_STYLES)).toBe("London Dry");
  });

  it("maps legacy worker vocabulary via aliases", () => {
    expect(normalizeStyleToTaxonomy("White/Blanco", RUM_STYLES)).toBe("White / Light");
    expect(normalizeStyleToTaxonomy("Dark/Añejo", RUM_STYLES)).toBe("Dark / Black");
    expect(normalizeStyleToTaxonomy("Contemporary", GIN_STYLES)).toBe("Contemporary / New Western");
    expect(normalizeStyleToTaxonomy("Sloe Gin", GIN_STYLES)).toBe("Sloe & Flavored Gin");
  });

  it("falls back to containment matching", () => {
    expect(normalizeStyleToTaxonomy("Jamaican", RUM_STYLES)).toBe("Jamaican Pot Still");
    expect(normalizeStyleToTaxonomy("Overproof Rum", RUM_STYLES)).toBe("Overproof");
  });

  it("returns null when no reasonable match", () => {
    expect(normalizeStyleToTaxonomy("完全不存在的风格XYZ", RUM_STYLES)).toBeNull();
    expect(normalizeStyleToTaxonomy("", RUM_STYLES)).toBeNull();
  });
});
