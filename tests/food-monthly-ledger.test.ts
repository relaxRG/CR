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

  it("历史食材数据缺少新增台账字段时保持原有档案与价格历史，并初始化为空账务集合", () => {
    const sanitized = sanitizeFoodIngredientState({
      ingredients: [{ ...ingredient, alertThreshold: 2 }],
      priceHistory: { [ingredient.id]: [{ price: 10, date: "2026-05-01", supplier: "测试供应商", source: "manual" }] },
    });
    expect(sanitized.ingredients[0]).not.toHaveProperty("alertThreshold");
    expect(sanitized.priceHistory[ingredient.id]).toHaveLength(1);
    expect(sanitized.ledgerEntries).toEqual([]);
    expect(sanitized.ledgerMovements).toEqual([]);
  });
});
