/**
 * 自制库成本估算 + 智能链接单元测试
 * 覆盖：homemadeId 字段、自制库原料成本传递、自循环防护
 */
import { describe, it, expect } from "vitest";
import { estimatePrepCost } from "../lib/homemade/cost";
import type { Bottle } from "../lib/bottles/types";
import type { HomemadePrep } from "../lib/homemade/types";

const mkBottle = (id: string, nameZh: string, nameEn: string, priceCny = 100, volume = "700ml"): Bottle => ({
  id, nameZh, nameEn, brand: "", category: "spirits", style: "", origin: "",
  volume, abv: 40, priceCny, notes: "", flavorTags: [], story: "", styleDesc: "",
  builtin: false, rating: null, sortIndex: 0, createdAt: 0, updatedAt: 0,
});

const mkPrep = (id: string, name: string, nameAlt: string, ingredients: { name: string; amount: string }[] = [], yieldStr = ""): HomemadePrep => ({
  id, name, nameAlt, type: "syrup", abvGroup: null, ingredients, recipe: "",
  yield: yieldStr, shelfLife: "", storage: "", source: "", notes: "",
  builtin: false, made: false, rating: null, sortIndex: 0, createdAt: 0, updatedAt: 0,
});

const vodka = mkBottle("b1", "伏特加", "Vodka", 200, "700ml");
const honeyPrep = mkPrep("p1", "蜂蜜糖浆", "Honey Syrup", [{ name: "水", amount: "100ml" }, { name: "蜂蜜", amount: "100g" }], "200ml");

describe("estimatePrepCost — homemadeId 字段", () => {
  it("无自制库时所有 item.homemadeId 为 null", () => {
    const prep = mkPrep("px", "测试自制品", "Test Prep", [{ name: "伏特加", amount: "30ml" }, { name: "水", amount: "20ml" }]);
    const cost = estimatePrepCost(prep, [vodka], []);
    for (const item of cost.items) {
      expect(item.homemadeId).toBeNull();
    }
  });

  it("原料匹配到自制库时 homemadeId 有值", () => {
    const prep = mkPrep("px", "测试自制品", "Test Prep", [{ name: "蜂蜜糖浆", amount: "30ml" }]);
    const cost = estimatePrepCost(prep, [], [honeyPrep]);
    const matched = cost.items.find((i) => i.homemadeId === "p1");
    expect(matched).toBeDefined();
  });

  it("自循环防护：自制品不匹配到自身", () => {
    // honeyPrep 的原料里有 "蜂蜜糖浆" 字样（假设），传入 allPreps 包含自身时不应循环
    const selfRef = mkPrep("p1", "蜂蜜糖浆", "Honey Syrup", [{ name: "蜂蜜糖浆", amount: "50ml" }]);
    // estimatePrepCost 内部会 filter(p => p.id !== prep.id)
    const cost = estimatePrepCost(selfRef, [], [selfRef]);
    // 不应崩溃，homemadeId 应为 null（自身被排除）
    for (const item of cost.items) {
      expect(item.homemadeId).toBeNull();
    }
  });

  it("bottleId 和 homemadeId 互斥（不同时有值）", () => {
    const prep = mkPrep("px", "测试", "Test", [{ name: "伏特加", amount: "30ml" }, { name: "蜂蜜糖浆", amount: "20ml" }]);
    const cost = estimatePrepCost(prep, [vodka], [honeyPrep]);
    for (const item of cost.items) {
      // 不应同时有 bottleId 和 homemadeId
      expect(item.bottleId !== null && item.homemadeId !== null).toBe(false);
    }
  });
});

describe("estimatePrepCost — 基础功能不受影响", () => {
  it("无原料时 batchCost 为 0", () => {
    const prep = mkPrep("px", "空自制品", "Empty");
    const cost = estimatePrepCost(prep, [], []);
    expect(cost.batchCost).toBe(0);
    expect(cost.items).toHaveLength(0);
  });

  it("无法估算的原料 cost 为 null", () => {
    const prep = mkPrep("px", "测试", "Test", [{ name: "神秘原料", amount: "" }]);
    const cost = estimatePrepCost(prep, [], []);
    expect(cost.items[0].cost).toBeNull();
    expect(cost.items[0].homemadeId).toBeNull();
    expect(cost.items[0].bottleId).toBeNull();
  });
});
