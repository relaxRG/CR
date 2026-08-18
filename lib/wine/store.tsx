import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { WineBottle, WineMonthlySnapshot, WineManualPurchase, WineInventoryItem } from "./types";

const STORAGE_KEY = "wine.bottles.v1";
const SNAPSHOT_KEY = "wine.snapshots.v2";
const MANUAL_PURCHASE_KEY = "wine.manual_purchases.v1";

export interface WineState {
  bottles: WineBottle[];
}

export interface WineSnapshotState {
  snapshots: WineMonthlySnapshot[];
}

export interface WineManualPurchaseState {
  purchases: WineManualPurchase[];
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
  | { type: "UPDATE_SNAPSHOT"; id: string; updates: Partial<WineMonthlySnapshot> }
  | { type: "DELETE_SNAPSHOT"; id: string };

type ManualPurchaseAction =
  | { type: "LOAD"; payload: WineManualPurchaseState }
  | { type: "ADD"; purchase: WineManualPurchase }
  | { type: "UPDATE"; id: string; updates: Partial<WineManualPurchase> }
  | { type: "BATCH_UPDATE"; ids: string[]; updates: Partial<WineManualPurchase> }
  | { type: "BATCH_UPDATE_DATE"; ids: string[]; date: string }
  | { type: "DELETE"; id: string }
  | { type: "BATCH_DELETE"; ids: string[] };

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
export { uuid as wineUuid };

const initialState: WineState = { bottles: [] };
const initialSnapshotState: WineSnapshotState = { snapshots: [] };
const initialManualState: WineManualPurchaseState = { purchases: [] };

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
    case "UPDATE_SNAPSHOT": return {
      snapshots: state.snapshots.map((s) =>
        s.id === action.id ? { ...s, ...action.updates } : s
      ),
    };
    case "DELETE_SNAPSHOT": return { snapshots: state.snapshots.filter((s) => s.id !== action.id) };
    default: return state;
  }
}

export function wineManualPurchaseReducer(state: WineManualPurchaseState, action: ManualPurchaseAction): WineManualPurchaseState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { purchases: [action.purchase, ...state.purchases] };
    case "UPDATE": return {
      purchases: state.purchases.map((p) =>
        p.id === action.id ? { ...p, ...action.updates } : p
      ),
    };
    case "BATCH_UPDATE": return {
      purchases: state.purchases.map((purchase) => {
        if (!action.ids.includes(purchase.id)) return purchase;
        const next = { ...purchase, ...action.updates };
        // 数量或单价调整后必须同步重算总价，禁止留下旧金额。
        if (action.updates.quantity !== undefined || action.updates.unitPrice !== undefined) {
          next.amount = next.quantity * next.unitPrice;
        }
        return next;
      }),
    };
    case "BATCH_UPDATE_DATE": return {
      purchases: state.purchases.map((p) =>
        action.ids.includes(p.id) ? { ...p, date: action.date } : p
      ),
    };
    case "DELETE": return { purchases: state.purchases.filter((p) => p.id !== action.id) };
    case "BATCH_DELETE": return { purchases: state.purchases.filter((p) => !action.ids.includes(p.id)) };
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

const WineContext = createContext<WineContextValue | null>(null);
const WineSnapshotContext = createContext<WineSnapshotContextValue | null>(null);
const WineManualPurchaseContext = createContext<WineManualPurchaseContextValue | null>(null);

export function WineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [snapshotState, snapshotDispatch] = useReducer(snapshotReducer, initialSnapshotState);
  const [manualState, manualDispatch] = useReducer(wineManualPurchaseReducer, initialManualState);

  useEffect(() => {
    const loadBottles = () => AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
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
          {children}
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
