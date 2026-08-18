import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FoodIngredientState,
  buildFoodMonthlyLedger,
  foodIngredientReducer,
  sanitizeFoodIngredientState,
} from "@/lib/food/ingredient-store";

const ingredient = {
  id: "food-ledger-beef",
  name: "牛肉",
  category: "meat" as const,
  spec: "1kg/包",
  unit: "包",
  costPrice: 10,
  stock: 10,
  supplier: "测试供应商",
  notes: "",
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:00:00.000Z",
};

function initialState(): FoodIngredientState {
  return { ingredients: [ingredient], priceHistory: {}, ledgerEntries: [], ledgerMovements: [] };
}

describe("食材月度台账", () => {
  it("采购、消耗与实盘均按月份写入原子流水，且首笔采购不会污染期初库存", () => {
    let state = foodIngredientReducer(initialState(), {
      type: "RECORD_PURCHASE",
      input: { ingredientId: ingredient.id, quantity: 5, unitPrice: 12, date: "2026-05-02", supplier: "测试供应商" },
    });
    state = foodIngredientReducer(state, {
      type: "RECORD_CONSUME",
      input: { ingredientId: ingredient.id, quantity: 4, unitCost: 12, date: "2026-05-03", notes: "备餐领用" },
    });
    state = foodIngredientReducer(state, {
      type: "RECORD_STOCKTAKE",
      input: { ingredientId: ingredient.id, actualClosingQty: 9, unitCost: 12, date: "2026-05-31", notes: "月末盘点" },
    });

    const [row] = buildFoodMonthlyLedger(state, "2026-05");
    expect(row.openingQty).toBe(10);
    expect(row.openingUnitCost).toBe(10);
    expect(row.purchaseQty).toBe(5);
    expect(row.purchaseCost).toBe(60);
    expect(row.consumeQty).toBe(4);
    expect(row.consumeCost).toBe(48);
    expect(row.closingQty).toBe(9);
    expect(row.closingUnitCost).toBe(12);
    expect(state.ingredients[0].stock).toBe(9);
    expect(state.ledgerMovements.map((movement) => movement.kind).sort()).toEqual(["consume", "purchase", "stocktake"]);
  });

  it("供应商批量导入通过采购入口同步写入库存、月度采购汇总与原子流水", () => {
    const state = foodIngredientReducer(initialState(), {
      type: "BATCH_IMPORT",
      updates: [{
        id: ingredient.id,
        costPrice: 13,
        stockDelta: 4,
        supplier: "导入供应商",
        priceEntry: { price: 13, date: "2026-05-18", supplier: "导入供应商", source: "import" },
      }],
    });
    const [row] = buildFoodMonthlyLedger(state, "2026-05");
    expect(state.ingredients[0].stock).toBe(14);
    expect(row.openingQty).toBe(10);
    expect(row.purchaseQty).toBe(4);
    expect(row.purchaseCost).toBe(52);
    expect(row.closingQty).toBe(14);
    expect(state.ledgerMovements).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "purchase", month: "2026-05", quantity: 4, totalCost: 52 })]));
  });

  it("月结将实盘期末冻结为下月期初，而后续月份不依赖当前库存倒推", () => {
    let state = foodIngredientReducer(initialState(), {
      type: "RECORD_PURCHASE",
      input: { ingredientId: ingredient.id, quantity: 2, unitPrice: 15, date: "2026-05-10", supplier: "测试供应商" },
    });
    state = foodIngredientReducer(state, {
      type: "RECORD_STOCKTAKE",
      input: { ingredientId: ingredient.id, actualClosingQty: 8, unitCost: 14, date: "2026-05-31" },
    });
    state = foodIngredientReducer(state, { type: "CLOSE_MONTH", month: "2026-05" });

    const [june] = buildFoodMonthlyLedger(state, "2026-06");
    expect(june.openingQty).toBe(8);
    expect(june.openingUnitCost).toBe(14);
    expect(june.closingQty).toBe(8);
  });

  it("删除食材会同时清理该食材的价格历史、月度台账和原子流水", () => {
    let state = foodIngredientReducer(initialState(), {
      type: "RECORD_PURCHASE",
      input: { ingredientId: ingredient.id, quantity: 1, unitPrice: 12, date: "2026-05-04", supplier: "测试供应商" },
    });
    state = foodIngredientReducer(state, { type: "DELETE", id: ingredient.id });
    expect(state.ingredients).toEqual([]);
    expect(state.priceHistory[ingredient.id]).toBeUndefined();
    expect(state.ledgerEntries).toEqual([]);
    expect(state.ledgerMovements).toEqual([]);
  });

  it("食材详情快捷加减库存必须通过采购和消耗流水，不能直接覆盖 stock", () => {
    const detailSource = readFileSync("app/food-ingredient/[id].tsx", "utf8");
    expect(detailSource).toContain("recordPurchase({");
    expect(detailSource).toContain("recordConsume({");
    expect(detailSource).not.toContain("updateIngredient(item.id, { stock:");
  });

  it("当前食材档案未创建月度台账时保留档案与价格历史，并初始化为空账务集合", () => {
    const sanitized = sanitizeFoodIngredientState({
      ingredients: [ingredient],
      priceHistory: { [ingredient.id]: [{ price: 10, date: "2026-05-01", supplier: "测试供应商", source: "manual" }] },
    });
    expect(sanitized.ingredients).toEqual([ingredient]);
    expect(sanitized.priceHistory[ingredient.id]).toHaveLength(1);
    expect(sanitized.ledgerEntries).toEqual([]);
    expect(sanitized.ledgerMovements).toEqual([]);
  });
});
