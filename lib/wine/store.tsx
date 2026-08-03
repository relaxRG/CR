import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { WineBottle, WineMonthlySnapshot, WineManualPurchase } from "./types";

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
  | { type: "DELETE_SNAPSHOT"; id: string };

type ManualPurchaseAction =
  | { type: "LOAD"; payload: WineManualPurchaseState }
  | { type: "ADD"; purchase: WineManualPurchase }
  | { type: "DELETE"; id: string };

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
    case "DELETE_SNAPSHOT": return { snapshots: state.snapshots.filter((s) => s.id !== action.id) };
    default: return state;
  }
}

function manualReducer(state: WineManualPurchaseState, action: ManualPurchaseAction): WineManualPurchaseState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { purchases: [action.purchase, ...state.purchases] };
    case "DELETE": return { purchases: state.purchases.filter((p) => p.id !== action.id) };
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
}

interface WineSnapshotContextValue extends WineSnapshotState {
  addSnapshot: (snapshot: WineMonthlySnapshot) => void;
  deleteSnapshot: (id: string) => void;
}

interface WineManualPurchaseContextValue extends WineManualPurchaseState {
  addManualPurchase: (data: Omit<WineManualPurchase, "id" | "createdAt">) => void;
  deleteManualPurchase: (id: string) => void;
}

const WineContext = createContext<WineContextValue | null>(null);
const WineSnapshotContext = createContext<WineSnapshotContextValue | null>(null);
const WineManualPurchaseContext = createContext<WineManualPurchaseContextValue | null>(null);

export function WineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [snapshotState, snapshotDispatch] = useReducer(snapshotReducer, initialSnapshotState);
  const [manualState, manualDispatch] = useReducer(manualReducer, initialManualState);

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
    // ★ 注册同步重载回调
    return registerStoreReload(loadSnap);
  }, []);

  useEffect(() => {
    const loadManual = () => AsyncStorage.getItem(MANUAL_PURCHASE_KEY).then((raw) => {
      if (raw) { try { manualDispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    loadManual();
    // ★ 注册同步重载回调
    return registerStoreReload(loadManual);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  useEffect(() => {
    AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshotState)).catch(() => {});
    // ★ 通知同步引擎
    notifySyncChange(SNAPSHOT_KEY);
  }, [snapshotState]);

  useEffect(() => {
    AsyncStorage.setItem(MANUAL_PURCHASE_KEY, JSON.stringify(manualState)).catch(() => {});
    // ★ 通知同步引擎
    notifySyncChange(MANUAL_PURCHASE_KEY);
  }, [manualState]);

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

  const addSnapshot = useCallback((snapshot: WineMonthlySnapshot) => {
    snapshotDispatch({ type: "ADD_SNAPSHOT", snapshot });
  }, []);

  const deleteSnapshot = useCallback((id: string) => {
    snapshotDispatch({ type: "DELETE_SNAPSHOT", id });
  }, []);

  const addManualPurchase = useCallback((data: Omit<WineManualPurchase, "id" | "createdAt">) => {
    const now = new Date().toISOString();
    manualDispatch({ type: "ADD", purchase: { ...data, id: uuid(), createdAt: now } });
  }, []);

  const deleteManualPurchase = useCallback((id: string) => {
    manualDispatch({ type: "DELETE", id });
  }, []);

  return (
    <WineContext.Provider value={{ ...state, addBottle, updateBottle, deleteBottle, batchDeleteBottles, reorderBottles, updateStock }}>
      <WineSnapshotContext.Provider value={{ ...snapshotState, addSnapshot, deleteSnapshot }}>
        <WineManualPurchaseContext.Provider value={{ ...manualState, addManualPurchase, deleteManualPurchase }}>
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
