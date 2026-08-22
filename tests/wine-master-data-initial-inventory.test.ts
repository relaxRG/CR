import { describe, expect, it } from "vitest";
import { appendWineFirstPurchaseInventory, appendWineInitialInventory } from "@/lib/wine/initial-inventory";
import { hydrateWineMasterData } from "@/lib/wine/master-data";
import type { WineManualPurchase, WineMonthlySnapshot } from "@/lib/wine/types";

const now = "2026-08-22T10:00:00.000Z";
const emptySnapshot: WineMonthlySnapshot = {
  id: "snapshot-1", monthLabel: "2026年8月", importedAt: now, items: [], purchaseOrders: [], supplierTotals: {}, totalPurchase: 0, totalConsume: 0, totalEndCost: 0,
};

function purchase(overrides: Partial<WineManualPurchase> = {}): WineManualPurchase {
  return {
    id: "purchase-1", date: "2026-08-10", supplier: "旧供应商", bottleId: null, productName: "旧酒款", unitPrice: 128, quantity: 2, amount: 256, notes: "", createdAt: now,
    ...overrides,
  };
}

describe("葡萄酒主数据安全纳管", () => {
  it("从历史快照、采购和葡萄酒档案补入缺失供应商与分类，但不覆盖用户已有资料或归档状态", () => {
    const result = hydrateWineMasterData({
      suppliers: [{ id: "supplier-1", name: "旧供应商", nameEn: "Legacy Supplier", aliases: ["旧别名"], notes: "保留", sortOrder: 0, archived: true, createdAt: now, updatedAt: now }],
      categories: [{ id: "category-1", name: "红葡萄酒", color: "#DB2777", sortOrder: 0, archived: true, createdAt: now, updatedAt: now }],
    }, {
      bottles: [{ id: "bottle-1", name: "库内白酒", nameEn: "", vintage: "", region: "", grape: "", winery: "", style: "white", abv: null, costPrice: 100, salePrice: null, stock: 1, rating: null, notes: "", photoUri: "", supplier: "新供应商", createdAt: now, updatedAt: now }],
      snapshots: [{ ...emptySnapshot, items: [{ seq: 1, wineType: "红葡萄酒", supplier: "旧供应商", name: "旧酒款", initUnitCost: 100, initQty: 1, initCost: 100, purchaseQty: 0, purchaseCost: 0, endQty: 1, unitCost: 100, endCost: 100, consumeBottles: 0, consumeQty: 0 }] }],
      purchases: [purchase({ category: "自然酒" })],
    }, { now, nextId: (() => { let index = 0; return () => `new-${++index}`; })() });

    expect(result.suppliers).toHaveLength(2);
    expect(result.suppliers[0]).toMatchObject({ name: "旧供应商", aliases: ["旧别名"], archived: true });
    expect(result.suppliers[1]).toMatchObject({ name: "新供应商", archived: false });
    expect(result.categories.map((item) => item.name)).toEqual(["红葡萄酒", "自然酒"]);
    expect(result.categories[0]).toMatchObject({ color: "#DB2777", archived: true });
  });
});

describe("葡萄酒期初库存与首笔采购", () => {
  it("期初库存只增加库存事实，不产生本月采购金额或采购订单", () => {
    const next = appendWineInitialInventory(null, {
      month: "2026-08", supplier: "供应商 A", category: "红葡萄酒", categoryColor: "#DB2777", name: "期初酒", bottleId: "bottle-a", quantity: 6, unitCost: 88,
    }, { now, snapshotId: "initial-1" });
    expect(next.items[0]).toMatchObject({ initQty: 6, initCost: 528, purchaseQty: 0, purchaseCost: 0, endQty: 6, endCost: 528, bottleId: "bottle-a" });
    expect(next.totalPurchase).toBe(0);
    expect(next.purchaseOrders).toEqual([]);
  });

  it("首笔真实采购创建零期初库存行、采购汇总和真实填写的日期，且拒绝重复同供应商酒款", () => {
    const next = appendWineFirstPurchaseInventory(emptySnapshot, {
      month: "2026-08", supplier: "供应商 B", category: "白葡萄酒", categoryColor: "#2563EB", name: "新酒", bottleId: "bottle-b", quantity: 3, unitCost: 120,
    }, { now, date: "2026-08-21", snapshotId: "first-1" });
    expect(next.items[0]).toMatchObject({ initQty: 0, purchaseQty: 3, purchaseCost: 360, endQty: 3, endCost: 360, bottleId: "bottle-b" });
    expect(next.purchaseOrders).toEqual([expect.objectContaining({ date: "2026-08-21", amount: 360 })]);
    expect(next.supplierTotals).toEqual({ "供应商 B": 360 });
    expect(() => appendWineFirstPurchaseInventory(next, {
      month: "2026-08", supplier: "供应商 B", category: "白葡萄酒", name: "新酒", bottleId: "bottle-c", quantity: 1, unitCost: 120,
    }, { now, date: "2026-08-21", snapshotId: "first-2" })).toThrow("已存在同名库存条目");
  });
});
