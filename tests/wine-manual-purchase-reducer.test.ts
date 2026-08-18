import { describe, expect, it } from "vitest";
import { wineManualPurchaseReducer } from "@/lib/wine/manual-purchase-reducer";

const state = {
  purchases: [
    {
      id: "p-1",
      date: "2026-02-10",
      supplier: "甘澜",
      bottleId: "wine-1",
      productName: "赤霞珠",
      unitPrice: 120,
      quantity: 2,
      amount: 240,
      notes: "",
      createdAt: "2026-02-10T00:00:00.000Z",
    },
    {
      id: "p-2",
      date: "2026-02-11",
      supplier: "EMW",
      bottleId: null,
      productName: "霞多丽",
      unitPrice: 80,
      quantity: 3,
      amount: 240,
      notes: "",
      createdAt: "2026-02-11T00:00:00.000Z",
    },
  ],
};

describe("葡萄酒手动采购批量编辑", () => {
  it("批量修改数量会同步重算每条记录的总价且不影响未选择记录", () => {
    const next = wineManualPurchaseReducer(state, { type: "BATCH_UPDATE", ids: ["p-1"], updates: { quantity: 5 } });
    expect(next.purchases[0]).toMatchObject({ quantity: 5, unitPrice: 120, amount: 600 });
    expect(next.purchases[1]).toEqual(state.purchases[1]);
  });

  it("批量修改单价、供应商和日期均为原子更新", () => {
    const priced = wineManualPurchaseReducer(state, { type: "BATCH_UPDATE", ids: ["p-1", "p-2"], updates: { unitPrice: 99, supplier: "新供货商" } });
    expect(priced.purchases.map((purchase) => [purchase.supplier, purchase.amount])).toEqual([["新供货商", 198], ["新供货商", 297]]);
    const dated = wineManualPurchaseReducer(priced, { type: "BATCH_UPDATE_DATE", ids: ["p-2"], date: "2026-02-20" });
    expect(dated.purchases.map((purchase) => purchase.date)).toEqual(["2026-02-10", "2026-02-20"]);
  });

  it("加载、新增、单条修改和删除均不会影响未命中的记录", () => {
    const loaded = wineManualPurchaseReducer({ purchases: [] }, { type: "LOAD", payload: state });
    expect(loaded).toEqual(state);
    const added = wineManualPurchaseReducer(loaded, { type: "ADD", purchase: { ...state.purchases[0], id: "p-3" } });
    expect(added.purchases.map((purchase) => purchase.id)).toEqual(["p-3", "p-1", "p-2"]);
    const supplierOnly = wineManualPurchaseReducer(added, { type: "BATCH_UPDATE", ids: ["p-1"], updates: { supplier: "仅改供应商" } });
    expect(supplierOnly.purchases.find((purchase) => purchase.id === "p-1")).toMatchObject({ supplier: "仅改供应商", amount: 240 });
    const updated = wineManualPurchaseReducer(supplierOnly, { type: "UPDATE", id: "p-2", updates: { notes: "已核对" } });
    expect(updated.purchases.find((purchase) => purchase.id === "p-2")?.notes).toBe("已核对");
    const deleted = wineManualPurchaseReducer(updated, { type: "DELETE", id: "p-3" });
    expect(deleted.purchases.map((purchase) => purchase.id)).toEqual(["p-1", "p-2"]);
    const batchDeleted = wineManualPurchaseReducer(deleted, { type: "BATCH_DELETE", ids: ["p-1", "missing"] });
    expect(batchDeleted.purchases.map((purchase) => purchase.id)).toEqual(["p-2"]);
  });
});
