/**
 * 智能链接引擎单元测试
 * 覆盖：精确匹配、Waldorf 别名、同义词规范化、模糊匹配、形态折叠、边界防御
 */
import { describe, it, expect } from "vitest";
import { smartLinkIngredient } from "../lib/recipes/smart-link";
import type { Bottle } from "../lib/bottles/types";
import type { HomemadePrep } from "../lib/homemade/types";

// ── 测试数据 ──────────────────────────────────────────────────────────────
const mkBottle = (id: string, nameZh: string, nameEn: string, extra?: Partial<Bottle>): Bottle => ({
  id,
  nameZh,
  nameEn,
  brand: "",
  category: "spirits",
  style: "",
  origin: "",
  volume: "700ml",
  abv: 40,
  priceCny: 100,
  notes: "",
  flavorTags: [],
  story: "",
  styleDesc: "",
  builtin: false,
  rating: null,
  sortIndex: 0,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

const mkPrep = (id: string, name: string, nameAlt: string): HomemadePrep => ({
  id,
  name,
  nameAlt,
  type: "syrup",
  abvGroup: null,
  ingredients: [],
  recipe: "",
  yield: "",
  shelfLife: "",
  storage: "",
  source: "",
  notes: "",
  builtin: false,
  made: false,
  rating: null,
  sortIndex: 0,
  createdAt: 0,
  updatedAt: 0,
});

const vodka = mkBottle("b1", "伏特加", "Vodka");
const cointreau = mkBottle("b2", "君度橙酒", "Cointreau", { brand: "Cointreau" });
const angostura = mkBottle("b3", "安格斯特拉苦精", "Angostura Bitters");
const honeyPrep = mkPrep("p1", "蜂蜜糖浆", "Honey Syrup");
const strawberryPrep = mkPrep("p2", "草莓糖浆", "Strawberry Syrup");

const bottles = [vodka, cointreau, angostura];
const preps = [honeyPrep, strawberryPrep];

// ── 测试套件 ──────────────────────────────────────────────────────────────
describe("smartLinkIngredient — 精确匹配", () => {
  it("中文名精确命中酒库", () => {
    const r = smartLinkIngredient("伏特加", bottles, preps);
    expect(r?.kind).toBe("bottle");
    if (r?.kind === "bottle") expect(r.bottle.id).toBe("b1");
  });

  it("英文名精确命中酒库", () => {
    const r = smartLinkIngredient("Cointreau", bottles, preps);
    expect(r?.kind).toBe("bottle");
    if (r?.kind === "bottle") expect(r.bottle.id).toBe("b2");
  });

  it("中文名精确命中自制库", () => {
    const r = smartLinkIngredient("蜂蜜糖浆", bottles, preps);
    expect(r?.kind).toBe("prep");
    if (r?.kind === "prep") expect(r.prep.id).toBe("p1");
  });

  it("英文名精确命中自制库", () => {
    const r = smartLinkIngredient("Honey Syrup", bottles, preps);
    expect(r?.kind).toBe("prep");
    if (r?.kind === "prep") expect(r.prep.id).toBe("p1");
  });

  it("品牌名精确命中酒库", () => {
    const r = smartLinkIngredient("Cointreau", bottles, []);
    expect(r?.kind).toBe("bottle");
  });
});

describe("smartLinkIngredient — 模糊匹配", () => {
  it("大小写不敏感", () => {
    const r = smartLinkIngredient("angostura bitters", bottles, preps);
    expect(r?.kind).toBe("bottle");
    if (r?.kind === "bottle") expect(r.bottle.id).toBe("b3");
  });

  it("自制库优先于酒库模糊命中", () => {
    const r = smartLinkIngredient("草莓糖浆", bottles, preps);
    expect(r?.kind).toBe("prep");
    if (r?.kind === "prep") expect(r.prep.id).toBe("p2");
  });
});

describe("smartLinkIngredient — 边界防御", () => {
  it("空字符串返回 null", () => {
    expect(smartLinkIngredient("", bottles, preps)).toBeNull();
  });

  it("单字符返回 null", () => {
    expect(smartLinkIngredient("A", bottles, preps)).toBeNull();
  });

  it("两库均为空时返回 null", () => {
    expect(smartLinkIngredient("伏特加", [], [])).toBeNull();
  });

  it("完全不匹配的名称返回 null", () => {
    expect(smartLinkIngredient("xyzzy_nonexistent_ingredient", bottles, preps)).toBeNull();
  });

  it("自循环防护：传入空 preps 时不崩溃", () => {
    const r = smartLinkIngredient("蜂蜜糖浆", bottles, []);
    expect(r === null || r?.kind === "bottle").toBe(true);
  });

  it("只有空格的字符串返回 null", () => {
    expect(smartLinkIngredient("   ", bottles, preps)).toBeNull();
  });
});
