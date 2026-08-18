import { describe, expect, it } from "vitest";
import { applyWineLedgerView, applyWinePurchaseView, collectWineTypes, compareWineTypes, getWineSupplierNames, toggleSort, wineTypeRank } from "@/lib/wine/table-view";
import type { WineInventoryItem, WineManualPurchase } from "@/lib/wine/types";

const item = (overrides: Partial<WineInventoryItem>): WineInventoryItem => ({
  seq: 1,
  wineType: "Red",
  supplier: "甘澜",
  name: "酒款",
  initUnitCost: 100,
  initQty: 1,
  initCost: 100,
  purchaseQty: 0,
  purchaseCost: 0,
  endQty: 1,
  unitCost: 100,
  endCost: 100,
  consumeBottles: 0,
  consumeQty: 0,
  ...overrides,
});

const purchase = (overrides: Partial<WineManualPurchase>): WineManualPurchase => ({
  id: "purchase-1",
  date: "2026-02-01",
  supplier: "甘澜",
  bottleId: null,
  productName: "酒款",
  unitPrice: 100,
  quantity: 1,
  amount: 100,
  notes: "",
  createdAt: "2026-02-01T00:00:00.000Z",
  ...overrides,
});

describe("葡萄酒工作台筛选与排序", () => {
  it("按固定酒类顺序显示存在的分组，并且不生成不存在的分类行", () => {
    const rows = [
      item({ seq: 1, wineType: "Sparkling", name: "起泡" }),
      item({ seq: 2, wineType: "White", name: "白" }),
      item({ seq: 3, wineType: "Red", name: "红" }),
    ];
    expect(collectWineTypes(rows)).toEqual(["Red", "White", "Sparkling"]);
    expect(applyWineLedgerView(rows, "", null, null, { key: "category", direction: "asc" }).map((row) => row.wineType))
      .toEqual(["Red", "White", "Sparkling"]);
  });

  it("库存搜索、供应商、酒类和列排序可以交集生效", () => {
    const rows = [
      item({ seq: 1, name: "赤霞珠", supplier: "甘澜", wineType: "Red", purchaseCost: 300 }),
      item({ seq: 2, name: "霞多丽", supplier: "EMW", wineType: "White", purchaseCost: 500 }),
      item({ seq: 3, name: "赤霞珠精选", supplier: "甘澜", wineType: "Red", purchaseCost: 100 }),
    ];
    const visible = applyWineLedgerView(rows, "赤霞珠", "甘澜", "Red", { key: "purchaseCost", direction: "desc" });
    expect(visible.map((row) => row.seq)).toEqual([1, 3]);
  });

  it("供应商标签合并台账、手动采购与葡萄酒库来源且去重", () => {
    expect(getWineSupplierNames([item({ supplier: "甘澜" })], [purchase({ supplier: "EMW" }), purchase({ id: "purchase-2", supplier: "甘澜" })], ["君荟", "EMW"]))
      .toEqual(["甘澜", "君荟", "EMW"]);
  });

  it("当月进货可按总价排序，切换同一排序键反转方向", () => {
    const rows = [
      purchase({ id: "a", productName: "A", amount: 320 }),
      purchase({ id: "b", productName: "B", amount: 80 }),
    ];
    expect(applyWinePurchaseView(rows, "", null, { key: "amount", direction: "desc" }).map((row) => row.id)).toEqual(["a", "b"]);
    expect(toggleSort({ key: "amount", direction: "desc" }, "amount")).toEqual({ key: "amount", direction: "asc" });
  });

  it("未知分类、空筛选、数值列和文本列排序均保持稳定", () => {
    const rows = [
      item({ seq: 1, wineType: "自然酒", name: "霞多丽", supplier: "A", actualEndQty: 9, endQty: 1 }),
      item({ seq: 2, wineType: "其他", name: "赤霞珠", supplier: "B", actualEndQty: undefined, endQty: 2 }),
      item({ seq: 3, wineType: "", name: "黑皮诺", supplier: "C", endQty: 3 }),
    ];
    expect(wineTypeRank("未知")).toBeGreaterThan(wineTypeRank("Natural"));
    expect(compareWineTypes("White", "Red")).toBeGreaterThan(0);
    expect(applyWineLedgerView(rows, "", null, null, { key: "closingQty", direction: "desc" }).map((row) => row.seq)).toEqual([1, 3, 2]);
    expect(applyWineLedgerView(rows, "", null, null, { key: "name", direction: "asc" }).map((row) => row.name)).toEqual(["赤霞珠", "黑皮诺", "霞多丽"]);
    expect(toggleSort({ key: "amount", direction: "asc" }, "name")).toEqual({ key: "name", direction: "asc" });
  });

  it("采购可按文本字段、备注搜索和供应商交集筛选", () => {
    const rows = [
      purchase({ id: "a", supplier: "EMW", productName: "霞多丽", notes: "紧急" }),
      purchase({ id: "b", supplier: "君荟", productName: "赤霞珠", date: "2026-02-09" }),
    ];
    expect(applyWinePurchaseView(rows, "紧急", "EMW", { key: "supplier", direction: "asc" }).map((row) => row.id)).toEqual(["a"]);
    expect(applyWinePurchaseView(rows, "", null, { key: "date", direction: "asc" }).map((row) => row.id)).toEqual(["a", "b"]);
    expect(getWineSupplierNames([item({ supplier: "" })], rows, [" ", "EMW"])).toEqual(["君荟", "EMW"]);
  });
});
