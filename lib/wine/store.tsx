import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import {
  WineAuditEntry,
  WineBottle,
  WineImportBatch,
  WineManualPurchase,
  WineMonthRestorePoint,
  WineMonthlySnapshot,
} from "./types";
import { rebuildWineSnapshotFromPurchases } from "./workbook-engine";
import { wineManualPurchaseReducer, WineManualPurchaseState } from "./manual-purchase-reducer";
import { normalizeWineSupplierAliases, resolveWineBottleForSupplierName } from "./supplier-alias";

const STORAGE_KEY = "wine.bottles.v1";
const SNAPSHOT_KEY = "wine.snapshots.v2";
const MANUAL_PURCHASE_KEY = "wine.manual_purchases.v1";
const IMPORT_CONTROL_KEY = "wine.import_control.v1";

export interface WineState {
  bottles: WineBottle[];
}

export interface WineSnapshotState {
  snapshots: WineMonthlySnapshot[];
}

export interface WineImportControlState {
  batches: WineImportBatch[];
  restorePoints: WineMonthRestorePoint[];
  auditEntries: WineAuditEntry[];
}

type Action =
  | { type: "LOAD"; payload: WineState }
  | { type: "ADD"; bottle: WineBottle }
  | { type: "UPDATE"; id: string; updates: Partial<WineBottle> }
  | { type: "DELETE"; id: string }
  | { type: "BATCH_DELETE"; ids: string[] }
  | { type: "REORDER"; bottles: WineBottle[] }
  | { type: "UPDATE_STOCK"; id: string; delta: number };

type SnapshotAction =
  | { type: "LOAD"; payload: WineSnapshotState }
  | { type: "ADD_SNAPSHOT"; snapshot: WineMonthlySnapshot }
  | { type: "REPLACE_MONTH_SNAPSHOT"; month: string; snapshot: WineMonthlySnapshot }
  | { type: "UPDATE_SNAPSHOT"; id: string; updates: Partial<WineMonthlySnapshot> }
  | { type: "DELETE_SNAPSHOT"; id: string };

type ImportControlAction =
  | { type: "LOAD"; payload: WineImportControlState }
  | { type: "ADD_BATCH"; batch: WineImportBatch }
  | { type: "ADD_RESTORE_POINT"; restorePoint: WineMonthRestorePoint }
  | { type: "ADD_AUDIT"; entry: WineAuditEntry };

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
export { uuid as wineUuid };

const initialState: WineState = { bottles: [] };
const initialSnapshotState: WineSnapshotState = { snapshots: [] };
const initialManualState: WineManualPurchaseState = { purchases: [] };
const initialImportControlState: WineImportControlState = { batches: [], restorePoints: [], auditEntries: [] };

function importControlReducer(state: WineImportControlState, action: ImportControlAction): WineImportControlState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_BATCH": return { ...state, batches: [action.batch, ...state.batches] };
    case "ADD_RESTORE_POINT": return { ...state, restorePoints: [action.restorePoint, ...state.restorePoints].slice(0, 24) };
    case "ADD_AUDIT": return { ...state, auditEntries: [action.entry, ...state.auditEntries].slice(0, 240) };
    default: return state;
  }
}

function reducer(state: WineState, action: Action): WineState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { ...state, bottles: [action.bottle, ...state.bottles] };
    case "UPDATE": return {
      ...state,
      bottles: state.bottles.map((b) =>
        b.id === action.id ? { ...b, ...action.updates, updatedAt: new Date().toISOString() } : b
      ),
    };
    case "DELETE": return { ...state, bottles: state.bottles.filter((b) => b.id !== action.id) };
    case "BATCH_DELETE": return { ...state, bottles: state.bottles.filter((b) => !action.ids.includes(b.id)) };
    case "REORDER": return { ...state, bottles: action.bottles };
    case "UPDATE_STOCK": return {
      ...state,
      bottles: state.bottles.map((b) =>
        b.id === action.id ? { ...b, stock: Math.max(0, b.stock + action.delta), updatedAt: new Date().toISOString() } : b
      ),
    };
    default: return state;
  }
}

function snapshotReducer(state: WineSnapshotState, action: SnapshotAction): WineSnapshotState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_SNAPSHOT": return { snapshots: [action.snapshot, ...state.snapshots] };
    case "REPLACE_MONTH_SNAPSHOT":
      return {
        snapshots: [
          action.snapshot,
          ...state.snapshots.filter((snapshot) => snapshot.monthLabel !== action.month && !snapshot.monthLabel.startsWith(`${action.month.slice(0, 4)}年${Number(action.month.slice(5))}月`)),
        ],
      };
    case "UPDATE_SNAPSHOT": return {
      snapshots: state.snapshots.map((s) =>
        s.id === action.id ? { ...s, ...action.updates } : s
      ),
    };
    case "DELETE_SNAPSHOT": return { snapshots: state.snapshots.filter((s) => s.id !== action.id) };
    default: return state;
  }
}

interface WineContextValue extends WineState {
  addBottle: (data: Omit<WineBottle, "id" | "createdAt" | "updatedAt">) => void;
  updateBottle: (id: string, updates: Partial<WineBottle>) => void;
  deleteBottle: (id: string) => void;
  batchDeleteBottles: (ids: string[]) => void;
  reorderBottles: (bottles: WineBottle[]) => void;
  updateStock: (id: string, delta: number) => void;
  /** ★ 获取某款酒某月的参考单价 */
  getWineRefPrice: (bottleId: string, month: string) => number;
  /** ★ 设置某款酒某月的参考单价 */
  setWineRefPrice: (bottleId: string, month: string, price: number) => void;
}

interface WineSnapshotContextValue extends WineSnapshotState {
  addSnapshot: (snapshot: WineMonthlySnapshot) => void;
  updateSnapshot: (id: string, updates: Partial<WineMonthlySnapshot>) => void;
  deleteSnapshot: (id: string) => void;
  /** ★ 月末盘点：更新快照中某款酒的实际期末库存量，自动反推消耗 */
  setActualEndQty: (snapshotId: string, seq: number, actualQty: number) => void;
  /** ★ 批量月末盘点 */
  batchSetActualEndQty: (snapshotId: string, entries: { seq: number; actualQty: number }[]) => void;
}

interface WineManualPurchaseContextValue extends WineManualPurchaseState {
  addManualPurchase: (data: Omit<WineManualPurchase, "id" | "createdAt">) => void;
  updateManualPurchase: (id: string, updates: Partial<WineManualPurchase>) => void;
  deleteManualPurchase: (id: string) => void;
  /** ★ 批量删除 */
  batchDeleteManualPurchases: (ids: string[]) => void;
  /** ★ 原子化批量修改；数量或单价变更时同步重算总价。 */
  batchUpdateManualPurchases: (ids: string[], updates: Partial<WineManualPurchase>) => void;
  /** ★ 批量修改日期 */
  batchUpdateManualPurchaseDate: (ids: string[], date: string) => void;
  /** ★ 获取某供应商某月的进货记录 */
  getSupplierMonthPurchases: (supplier: string, month: string) => WineManualPurchase[];
  /** ★ 获取某月所有进货记录 */
  getMonthPurchases: (month: string) => WineManualPurchase[];
}

interface WineImportControlContextValue extends WineImportControlState {
  applyWorkbookImport: (input: { month: string; snapshot: WineMonthlySnapshot | null; purchases: WineManualPurchase[]; batch: WineImportBatch }) => void;
  clearMonthPurchases: (month: string) => WineMonthRestorePoint;
  recalculateMonthInventory: (month: string) => WineMonthRestorePoint | null;
  restoreMonth: (restorePointId: string) => boolean;
}

const WineContext = createContext<WineContextValue | null>(null);
const WineSnapshotContext = createContext<WineSnapshotContextValue | null>(null);
const WineManualPurchaseContext = createContext<WineManualPurchaseContextValue | null>(null);
const WineImportControlContext = createContext<WineImportControlContextValue | null>(null);

export function WineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [snapshotState, snapshotDispatch] = useReducer(snapshotReducer, initialSnapshotState);
  const [manualState, manualDispatch] = useReducer(wineManualPurchaseReducer, initialManualState);
  const [importControlState, importControlDispatch] = useReducer(importControlReducer, initialImportControlState);

  useEffect(() => {
    const loadBottles = () => AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as WineState;
          dispatch({
            type: "LOAD",
            payload: {
              bottles: (parsed.bottles ?? []).map((bottle) => ({
                ...bottle,
                supplierAliases: normalizeWineSupplierAliases(bottle.supplierAliases),
              })),
            },
          });
        } catch {}
      }
    });
    loadBottles();
    return registerStoreReload(loadBottles);
  }, []);

  useEffect(() => {
    const loadSnap = () => AsyncStorage.getItem(SNAPSHOT_KEY).then((raw) => {
      if (raw) { try { snapshotDispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    loadSnap();
    return registerStoreReload(loadSnap);
  }, []);

  useEffect(() => {
    const loadManual = () => AsyncStorage.getItem(MANUAL_PURCHASE_KEY).then((raw) => {
      if (raw) { try { manualDispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    loadManual();
    return registerStoreReload(loadManual);
  }, []);

  useEffect(() => {
    const loadImportControl = () => AsyncStorage.getItem(IMPORT_CONTROL_KEY).then((raw) => {
      if (raw) { try { importControlDispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    loadImportControl();
    return registerStoreReload(loadImportControl);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  useEffect(() => {
    AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshotState)).catch(() => {});
    notifySyncChange(SNAPSHOT_KEY);
  }, [snapshotState]);

  useEffect(() => {
    AsyncStorage.setItem(MANUAL_PURCHASE_KEY, JSON.stringify(manualState)).catch(() => {});
    notifySyncChange(MANUAL_PURCHASE_KEY);
  }, [manualState]);

  useEffect(() => {
    AsyncStorage.setItem(IMPORT_CONTROL_KEY, JSON.stringify(importControlState)).catch(() => {});
    notifySyncChange(IMPORT_CONTROL_KEY);
  }, [importControlState]);

  // ── WineBottle 方法 ────────────────────────────────────────────────────────
  const addBottle = useCallback((data: Omit<WineBottle, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    dispatch({ type: "ADD", bottle: { ...data, id: uuid(), createdAt: now, updatedAt: now } });
  }, []);

  const updateBottle = useCallback((id: string, updates: Partial<WineBottle>) => {
    dispatch({ type: "UPDATE", id, updates });
  }, []);

  const deleteBottle = useCallback((id: string) => {
    dispatch({ type: "DELETE", id });
  }, []);

  const batchDeleteBottles = useCallback((ids: string[]) => {
    dispatch({ type: "BATCH_DELETE", ids });
  }, []);

  const reorderBottles = useCallback((bottles: WineBottle[]) => {
    dispatch({ type: "REORDER", bottles });
  }, []);

  const updateStock = useCallback((id: string, delta: number) => {
    dispatch({ type: "UPDATE_STOCK", id, delta });
  }, []);

  // ★ 参考单价（存在 WineBottle.refPrices 中）
  const getWineRefPrice = useCallback((bottleId: string, month: string): number => {
    const bottle = state.bottles.find((b) => b.id === bottleId);
    if (!bottle) return 0;
    if (bottle.refPrices?.[month]) return bottle.refPrices[month];
    // 找最近的历史价格
    const months = Object.keys(bottle.refPrices ?? {}).sort().reverse();
    for (const m of months) {
      if (m <= month) return bottle.refPrices![m];
    }
    return bottle.costPrice ?? 0;
  }, [state.bottles]);

  const setWineRefPrice = useCallback((bottleId: string, month: string, price: number) => {
    const bottle = state.bottles.find((b) => b.id === bottleId);
    if (!bottle) return;
    dispatch({
      type: "UPDATE",
      id: bottleId,
      updates: {
        refPrices: { ...(bottle.refPrices ?? {}), [month]: price },
        costPrice: price, // 同步更新最新进价
      },
    });
  }, [state.bottles]);

  // ── WineSnapshot 方法 ──────────────────────────────────────────────────────
  const addSnapshot = useCallback((snapshot: WineMonthlySnapshot) => {
    snapshotDispatch({ type: "ADD_SNAPSHOT", snapshot });
  }, []);

  const updateSnapshot = useCallback((id: string, updates: Partial<WineMonthlySnapshot>) => {
    snapshotDispatch({ type: "UPDATE_SNAPSHOT", id, updates });
  }, []);

  const deleteSnapshot = useCallback((id: string) => {
    snapshotDispatch({ type: "DELETE_SNAPSHOT", id });
  }, []);

  // ★ 月末盘点：更新快照中某款酒的实际期末库存量，自动反推消耗
  const setActualEndQty = useCallback((snapshotId: string, seq: number, actualQty: number) => {
    const snap = snapshotState.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;
    const updatedItems = snap.items.map((item) => {
      if (item.seq !== seq) return item;
      const consumeBottles = Math.max(0, item.initQty + item.purchaseQty - actualQty);
      const consumeQty = consumeBottles * item.unitCost;
      const endCost = actualQty * item.unitCost;
      return { ...item, actualEndQty: actualQty, endQty: actualQty, consumeBottles, consumeQty, endCost };
    });
    // 重新计算快照汇总
    const totalConsume = updatedItems.reduce((s, i) => s + i.consumeQty, 0);
    const totalEndCost = updatedItems.reduce((s, i) => s + i.endCost, 0);
    snapshotDispatch({ type: "UPDATE_SNAPSHOT", id: snapshotId, updates: { items: updatedItems, totalConsume, totalEndCost } });
  }, [snapshotState.snapshots]);

  const batchSetActualEndQty = useCallback((snapshotId: string, entries: { seq: number; actualQty: number }[]) => {
    const snap = snapshotState.snapshots.find((s) => s.id === snapshotId);
    if (!snap) return;
    const updatedItems = snap.items.map((item) => {
      const entry = entries.find((e) => e.seq === item.seq);
      if (!entry) return item;
      const consumeBottles = Math.max(0, item.initQty + item.purchaseQty - entry.actualQty);
      const consumeQty = consumeBottles * item.unitCost;
      const endCost = entry.actualQty * item.unitCost;
      return { ...item, actualEndQty: entry.actualQty, endQty: entry.actualQty, consumeBottles, consumeQty, endCost };
    });
    const totalConsume = updatedItems.reduce((s, i) => s + i.consumeQty, 0);
    const totalEndCost = updatedItems.reduce((s, i) => s + i.endCost, 0);
    snapshotDispatch({ type: "UPDATE_SNAPSHOT", id: snapshotId, updates: { items: updatedItems, totalConsume, totalEndCost } });
  }, [snapshotState.snapshots]);

  // ── WineManualPurchase 方法 ────────────────────────────────────────────────
  const addManualPurchase = useCallback((data: Omit<WineManualPurchase, "id" | "createdAt">) => {
    const now = new Date().toISOString();
    manualDispatch({ type: "ADD", purchase: { ...data, id: uuid(), createdAt: now } });
  }, []);

  const updateManualPurchase = useCallback((id: string, updates: Partial<WineManualPurchase>) => {
    manualDispatch({ type: "UPDATE", id, updates });
  }, []);

  const deleteManualPurchase = useCallback((id: string) => {
    manualDispatch({ type: "DELETE", id });
  }, []);

  const batchDeleteManualPurchases = useCallback((ids: string[]) => {
    manualDispatch({ type: "BATCH_DELETE", ids });
  }, []);

  const batchUpdateManualPurchases = useCallback((ids: string[], updates: Partial<WineManualPurchase>) => {
    manualDispatch({ type: "BATCH_UPDATE", ids, updates });
  }, []);

  const batchUpdateManualPurchaseDate = useCallback((ids: string[], date: string) => {
    manualDispatch({ type: "BATCH_UPDATE_DATE", ids, date });
  }, []);

  const getSupplierMonthPurchases = useCallback((supplier: string, month: string): WineManualPurchase[] => {
    return manualState.purchases.filter((p) => p.supplier === supplier && p.date.startsWith(month));
  }, [manualState.purchases]);

  const getMonthPurchases = useCallback((month: string): WineManualPurchase[] => {
    return manualState.purchases.filter((p) => p.date.startsWith(month));
  }, [manualState.purchases]);

  const createRestorePoint = useCallback((month: string, reason: WineMonthRestorePoint["reason"]): WineMonthRestorePoint => {
    const restorePoint: WineMonthRestorePoint = {
      id: uuid(),
      month,
      reason,
      createdAt: new Date().toISOString(),
      snapshot: snapshotState.snapshots.find((snapshot) => snapshot.monthLabel === `${month.slice(0, 4)}年${Number(month.slice(5))}月`) ?? null,
      purchases: manualState.purchases.filter((purchase) => purchase.date.startsWith(month)),
      batchIds: importControlState.batches.filter((batch) => batch.month === month).map((batch) => batch.id),
    };
    importControlDispatch({ type: "ADD_RESTORE_POINT", restorePoint });
    return restorePoint;
  }, [snapshotState.snapshots, manualState.purchases, importControlState.batches]);

  const applyWorkbookImport = useCallback((input: { month: string; snapshot: WineMonthlySnapshot | null; purchases: WineManualPurchase[]; batch: WineImportBatch }) => {
    const existingSnapshot = snapshotState.snapshots.some((snapshot) => snapshot.monthLabel === `${input.month.slice(0, 4)}年${Number(input.month.slice(5))}月`);
    const existingPurchases = manualState.purchases.some((purchase) => purchase.date.startsWith(input.month));
    const restorePoint = existingSnapshot || existingPurchases ? createRestorePoint(input.month, "before_replace_import") : null;
    if (input.snapshot) snapshotDispatch({ type: "REPLACE_MONTH_SNAPSHOT", month: input.month, snapshot: input.snapshot });
    const matchedPurchases = input.purchases.map((purchase) => {
      if (purchase.bottleId) return purchase;
      const matched = resolveWineBottleForSupplierName(state.bottles, purchase.supplier, purchase.productName);
      return { ...purchase, bottleId: matched?.bottle.id ?? null };
    });
    if (matchedPurchases.length > 0) manualDispatch({ type: "BATCH_ADD", purchases: matchedPurchases });
    importControlDispatch({ type: "ADD_BATCH", batch: input.batch });
    importControlDispatch({
      type: "ADD_AUDIT",
      entry: {
        id: uuid(), month: input.month, action: "workbook_import", occurredAt: new Date().toISOString(),
        detail: `导入复杂葡萄酒工作簿：库存 ${input.batch.appliedRows.inventory} 行，进货 ${input.batch.appliedRows.purchases} 行，跳过重复 ${input.batch.appliedRows.skippedDuplicates} 行。`,
        affected: { snapshots: input.snapshot ? 1 : 0, purchases: input.purchases.length, batches: 1 }, restorePointId: restorePoint?.id,
      },
    });
  }, [createRestorePoint, snapshotState.snapshots, manualState.purchases, state.bottles]);

  const clearMonthPurchases = useCallback((month: string): WineMonthRestorePoint => {
    const restorePoint = createRestorePoint(month, "before_clear_purchases");
    const affected = manualState.purchases.filter((purchase) => purchase.date.startsWith(month)).length;
    const remainingPurchases = manualState.purchases.filter((purchase) => !purchase.date.startsWith(month));
    const targetLabel = `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
    const snapshot = snapshotState.snapshots.find((item) => item.monthLabel === targetLabel);
    manualDispatch({ type: "CLEAR_MONTH", month });
    if (snapshot) {
      snapshotDispatch({ type: "UPDATE_SNAPSHOT", id: snapshot.id, updates: rebuildWineSnapshotFromPurchases(snapshot, remainingPurchases) });
    }
    importControlDispatch({
      type: "ADD_AUDIT",
      entry: {
        id: uuid(), month, action: "clear_month_purchases", occurredAt: new Date().toISOString(),
        detail: `强制清空 ${month} 采购流水 ${affected} 笔，并已基于剩余流水重建库存派生字段。`,
        affected: { snapshots: snapshot ? 1 : 0, purchases: affected, batches: 0 }, restorePointId: restorePoint.id,
      },
    });
    return restorePoint;
  }, [createRestorePoint, manualState.purchases, snapshotState.snapshots]);

  const recalculateMonthInventory = useCallback((month: string): WineMonthRestorePoint | null => {
    const snapshot = snapshotState.snapshots.find((item) => item.monthLabel === `${month.slice(0, 4)}年${Number(month.slice(5))}月`);
    if (!snapshot) return null;
    const restorePoint = createRestorePoint(month, "before_recalculate");
    const rebuilt = rebuildWineSnapshotFromPurchases(snapshot, manualState.purchases);
    snapshotDispatch({ type: "UPDATE_SNAPSHOT", id: snapshot.id, updates: rebuilt });
    importControlDispatch({
      type: "ADD_AUDIT",
      entry: {
        id: uuid(), month, action: "recalculate_month_inventory", occurredAt: new Date().toISOString(),
        detail: `从 ${manualState.purchases.filter((purchase) => purchase.date.startsWith(month)).length} 笔唯一采购流水重新计算库存派生字段。`,
        affected: { snapshots: 1, purchases: 0, batches: 0 }, restorePointId: restorePoint.id,
      },
    });
    return restorePoint;
  }, [createRestorePoint, snapshotState.snapshots, manualState.purchases]);

  const restoreMonth = useCallback((restorePointId: string): boolean => {
    const restorePoint = importControlState.restorePoints.find((point) => point.id === restorePointId);
    if (!restorePoint) return false;
    manualDispatch({ type: "RESTORE_MONTH", month: restorePoint.month, purchases: restorePoint.purchases });
    if (restorePoint.snapshot) snapshotDispatch({ type: "REPLACE_MONTH_SNAPSHOT", month: restorePoint.month, snapshot: restorePoint.snapshot });
    importControlDispatch({
      type: "ADD_AUDIT",
      entry: {
        id: uuid(), month: restorePoint.month, action: "restore_month", occurredAt: new Date().toISOString(),
        detail: `从恢复点还原 ${restorePoint.month} 的库存快照与采购流水。`,
        affected: { snapshots: restorePoint.snapshot ? 1 : 0, purchases: restorePoint.purchases.length, batches: 0 }, restorePointId,
      },
    });
    return true;
  }, [importControlState.restorePoints]);

  return (
    <WineContext.Provider value={{
      ...state,
      addBottle, updateBottle, deleteBottle, batchDeleteBottles, reorderBottles, updateStock,
      getWineRefPrice, setWineRefPrice,
    }}>
      <WineSnapshotContext.Provider value={{
        ...snapshotState,
        addSnapshot, updateSnapshot, deleteSnapshot,
        setActualEndQty, batchSetActualEndQty,
      }}>
        <WineManualPurchaseContext.Provider value={{
          ...manualState,
          addManualPurchase, updateManualPurchase, deleteManualPurchase,
          batchDeleteManualPurchases, batchUpdateManualPurchases, batchUpdateManualPurchaseDate,
          getSupplierMonthPurchases, getMonthPurchases,
        }}>
          <WineImportControlContext.Provider value={{
            ...importControlState,
            applyWorkbookImport, clearMonthPurchases, recalculateMonthInventory, restoreMonth,
          }}>
            {children}
          </WineImportControlContext.Provider>
        </WineManualPurchaseContext.Provider>
      </WineSnapshotContext.Provider>
    </WineContext.Provider>
  );
}

export function useWineStore(): WineContextValue {
  const ctx = useContext(WineContext);
  if (!ctx) throw new Error("useWineStore must be used within WineProvider");
  return ctx;
}

export function useWineSnapshotStore(): WineSnapshotContextValue {
  const ctx = useContext(WineSnapshotContext);
  if (!ctx) throw new Error("useWineSnapshotStore must be used within WineProvider");
  return ctx;
}

export function useWineManualPurchaseStore(): WineManualPurchaseContextValue {
  const ctx = useContext(WineManualPurchaseContext);
  if (!ctx) throw new Error("useWineManualPurchaseStore must be used within WineProvider");
  return ctx;
}

export function useWineImportControlStore(): WineImportControlContextValue {
  const ctx = useContext(WineImportControlContext);
  if (!ctx) throw new Error("useWineImportControlStore must be used within WineProvider");
  return ctx;
}
