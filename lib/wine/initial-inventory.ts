import { WineInventoryItem, WineMonthlySnapshot } from "./types";

export interface WineInitialInventoryInput {
  month: string;
  supplier: string;
  category: string;
  categoryColor?: string;
  name: string;
  bottleId: string;
  quantity: number;
  unitCost: number;
}

function monthLabel(month: string): string {
  return `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
}

/**
 * 期初库存是盘点事实，而不是采购事实：不会写入 WineManualPurchase，
 * 也不会进入本月进货金额。后续真实进货只能由带日期的采购流水写入。
 */
export function appendWineInitialInventory(
  current: WineMonthlySnapshot | null,
  input: WineInitialInventoryInput,
  meta: { now: string; snapshotId: string },
): WineMonthlySnapshot {
  const quantity = Math.max(0, input.quantity);
  const unitCost = Math.max(0, input.unitCost);
  const item: WineInventoryItem = {
    seq: current ? Math.max(0, ...current.items.map((existing) => existing.seq)) + 1 : 1,
    wineType: input.category || "其他",
    category: input.category || "其他",
    categoryColor: input.categoryColor,
    supplier: input.supplier,
    bottleId: input.bottleId,
    name: input.name,
    initUnitCost: unitCost,
    initQty: quantity,
    initCost: quantity * unitCost,
    purchaseQty: 0,
    purchaseCost: 0,
    endQty: quantity,
    unitCost,
    endCost: quantity * unitCost,
    consumeBottles: 0,
    consumeQty: 0,
  };
  const base: WineMonthlySnapshot = current ?? {
    id: meta.snapshotId,
    monthLabel: monthLabel(input.month),
    importedAt: meta.now,
    items: [],
    purchaseOrders: [],
    supplierTotals: {},
    totalPurchase: 0,
    totalConsume: 0,
    totalEndCost: 0,
  };
  if (base.items.some((existing) => existing.supplier === input.supplier && existing.name.trim().toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) {
    throw new Error("该供应商下已存在同名库存条目，请在台账中调整已有期初库存。");
  }
  const items = [...base.items, item];
  return {
    ...base,
    importedAt: meta.now,
    items,
    totalEndCost: items.reduce((total, inventoryItem) => total + inventoryItem.endCost, 0),
    totalConsume: items.reduce((total, inventoryItem) => total + inventoryItem.consumeQty, 0),
  };
}

/**
 * 新增酒款时的第一笔真实采购：库存条目以零期初、当月采购和期末库存写入。
 * 调用方必须在同一交互中创建对应 WineManualPurchase；重新计算会得到相同结果，
 * 因而不会把采购金额重复计入库存快照。
 */
export function appendWineFirstPurchaseInventory(
  current: WineMonthlySnapshot | null,
  input: WineInitialInventoryInput,
  meta: { now: string; date: string; snapshotId: string },
): WineMonthlySnapshot {
  const quantity = Math.max(0, input.quantity);
  const unitCost = Math.max(0, input.unitCost);
  const base: WineMonthlySnapshot = current ?? {
    id: meta.snapshotId,
    monthLabel: monthLabel(input.month),
    importedAt: meta.now,
    items: [],
    purchaseOrders: [],
    supplierTotals: {},
    totalPurchase: 0,
    totalConsume: 0,
    totalEndCost: 0,
  };
  if (base.items.some((existing) => existing.supplier === input.supplier && existing.name.trim().toLocaleLowerCase() === input.name.trim().toLocaleLowerCase())) {
    throw new Error("该供应商下已存在同名库存条目，请使用已有酒款录入采购。");
  }
  const item: WineInventoryItem = {
    seq: Math.max(0, ...base.items.map((existing) => existing.seq)) + 1,
    wineType: input.category || "其他",
    category: input.category || "其他",
    categoryColor: input.categoryColor,
    supplier: input.supplier,
    bottleId: input.bottleId,
    name: input.name,
    initUnitCost: unitCost,
    initQty: 0,
    initCost: 0,
    purchaseQty: quantity,
    purchaseCost: quantity * unitCost,
    endQty: quantity,
    unitCost,
    endCost: quantity * unitCost,
    consumeBottles: 0,
    consumeQty: 0,
  };
  const purchaseOrders = [...base.purchaseOrders, {
    date: meta.date,
    supplier: input.supplier,
    productName: input.name,
    unitPrice: unitCost,
    quantity,
    amount: quantity * unitCost,
  }];
  const supplierTotals = { ...base.supplierTotals, [input.supplier]: (base.supplierTotals[input.supplier] ?? 0) + quantity * unitCost };
  const items = [...base.items, item];
  return {
    ...base,
    importedAt: meta.now,
    items,
    purchaseOrders,
    supplierTotals,
    totalPurchase: Object.values(supplierTotals).reduce((total, amount) => total + amount, 0),
    totalEndCost: items.reduce((total, inventoryItem) => total + inventoryItem.endCost, 0),
    totalConsume: items.reduce((total, inventoryItem) => total + inventoryItem.consumeQty, 0),
  };
}
