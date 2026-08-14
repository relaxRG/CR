import { describe, expect, it } from "vitest";
import { stripLegacyInventoryAlertThreshold } from "@/lib/inventory-core/legacy-cleanup";
import { sanitizeGenericInventoryState } from "@/lib/inventory-core/store";
import { sanitizeFoodIngredientState } from "@/lib/food/ingredient-store";

describe("库存预警历史字段清理", () => {
  it("仅删除废弃预警字段，保留杯具损耗、库存、采购和成本账务字段", () => {
    const cleaned = stripLegacyInventoryAlertThreshold({
      id: "glass-1",
      name: "高球杯",
      currentStock: 12,
      latestCostPrice: 18.5,
      damageCount: 2,
      lossCost: 37,
      alertThreshold: 10,
    });

    expect(cleaned).toEqual({
      id: "glass-1",
      name: "高球杯",
      currentStock: 12,
      latestCostPrice: 18.5,
      damageCount: 2,
      lossCost: 37,
    });
    expect(cleaned).not.toHaveProperty("alertThreshold");
  });

  it("通用库存状态加载时清理所有品类旧预警字段，不改变月度业务记录", () => {
    const state = sanitizeGenericInventoryState({
      items: [{ id: "beer-1", name: "啤酒", alertThreshold: 12, currentStock: 8 }],
      purchases: [{ id: "p-1", date: "2026-08-05", quantity: 6 }],
      consumes: [{ id: "c-1", date: "2026-08-08", quantity: 2 }],
      snapshots: [{ id: "s-1", month: "2026-08" }],
    });

    expect(state.items[0]).toMatchObject({ id: "beer-1", name: "啤酒", currentStock: 8 });
    expect(state.items[0]).not.toHaveProperty("alertThreshold");
    expect(state.purchases).toHaveLength(1);
    expect(state.consumes).toHaveLength(1);
    expect(state.snapshots).toHaveLength(1);
  });

  it("食材v1/v2历史档案加载时清理预警字段并保留价格历史", () => {
    const state = sanitizeFoodIngredientState({
      ingredients: [{ id: "food-1", name: "柠檬", stock: 4, alertThreshold: 3 }],
      priceHistory: { "food-1": [{ date: "2026-08-03", price: 5.5, supplier: "供应商A", source: "import" }] },
    });

    expect(state.ingredients[0]).toMatchObject({ id: "food-1", name: "柠檬", stock: 4 });
    expect(state.ingredients[0]).not.toHaveProperty("alertThreshold");
    expect(state.priceHistory["food-1"]).toHaveLength(1);
  });
});
