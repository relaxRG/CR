/**
 * 水果进销存 Store
 * 管理水果品种档案、进出库记录、月度快照
 */
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FruitItem, FruitTransaction, FruitMonthlySnapshot, FruitUnit } from "./types";
import { registerStoreReload } from "../sync/engine";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const ITEMS_KEY = "fruit.items.v1";
const TRANSACTIONS_KEY = "fruit.transactions.v1";
const SNAPSHOTS_KEY = "fruit.snapshots.v1";

// ─── Items Store ──────────────────────────────────────────────────────────────
interface ItemsState { items: FruitItem[] }
const initialItemsState: ItemsState = { items: [] };

type ItemsAction =
  | { type: "LOAD"; payload: ItemsState }
  | { type: "ADD"; item: FruitItem }
  | { type: "UPDATE"; id: string; updates: Partial<FruitItem> }
  | { type: "DELETE"; id: string };

function itemsReducer(state: ItemsState, action: ItemsAction): ItemsState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { items: [...state.items, action.item] };
    case "UPDATE": return { items: state.items.map(i => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE": return { items: state.items.filter(i => i.id !== action.id) };
    default: return state;
  }
}

// ─── Transactions Store ───────────────────────────────────────────────────────
interface TxState { transactions: FruitTransaction[] }
const initialTxState: TxState = { transactions: [] };

type TxAction =
  | { type: "LOAD"; payload: TxState }
  | { type: "ADD"; tx: FruitTransaction }
  | { type: "DELETE"; id: string };

function txReducer(state: TxState, action: TxAction): TxState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { transactions: [action.tx, ...state.transactions] };
    case "DELETE": return { transactions: state.transactions.filter(t => t.id !== action.id) };
    default: return state;
  }
}

// ─── Snapshots Store ──────────────────────────────────────────────────────────
interface SnapState { snapshots: FruitMonthlySnapshot[] }
const initialSnapState: SnapState = { snapshots: [] };

type SnapAction =
  | { type: "LOAD"; payload: SnapState }
  | { type: "ADD"; snapshot: FruitMonthlySnapshot }
  | { type: "DELETE"; id: string };

function snapReducer(state: SnapState, action: SnapAction): SnapState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { snapshots: [action.snapshot, ...state.snapshots] };
    case "DELETE": return { snapshots: state.snapshots.filter(s => s.id !== action.id) };
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface FruitStoreValue {
  // Items
  items: FruitItem[];
  addItem: (draft: Omit<FruitItem, "id" | "createdAt" | "updatedAt">) => string;
  updateItem: (id: string, updates: Partial<FruitItem>) => void;
  deleteItem: (id: string) => void;
  // Transactions
  transactions: FruitTransaction[];
  addTransaction: (draft: Omit<FruitTransaction, "id" | "createdAt">) => void;
  deleteTransaction: (id: string) => void;
  // Snapshots
  snapshots: FruitMonthlySnapshot[];
  addSnapshot: (draft: Omit<FruitMonthlySnapshot, "id" | "createdAt">) => void;
  deleteSnapshot: (id: string) => void;
  // Computed
  getItemTransactions: (itemId: string) => FruitTransaction[];
  getLowStockItems: () => FruitItem[];
  ready: boolean;
}

const FruitContext = createContext<FruitStoreValue | null>(null);

export function FruitProvider({ children }: { children: React.ReactNode }) {
  const [itemsState, dispatchItems] = useReducer(itemsReducer, initialItemsState);
  const [txState, dispatchTx] = useReducer(txReducer, initialTxState);
  const [snapState, dispatchSnap] = useReducer(snapReducer, initialSnapState);
  const [ready, setReady] = React.useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [itemsRaw, txRaw, snapRaw] = await AsyncStorage.multiGet([ITEMS_KEY, TRANSACTIONS_KEY, SNAPSHOTS_KEY]);
        if (itemsRaw[1]) dispatchItems({ type: "LOAD", payload: JSON.parse(itemsRaw[1]) });
        if (txRaw[1]) dispatchTx({ type: "LOAD", payload: JSON.parse(txRaw[1]) });
        if (snapRaw[1]) dispatchSnap({ type: "LOAD", payload: JSON.parse(snapRaw[1]) });
      } catch {}
      setReady(true);
    };
    load();
    return registerStoreReload(() => { void load(); });
  }, []);

  // Persist items
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(itemsState)).catch(() => {});
  }, [itemsState, ready]);

  // Persist transactions
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(txState)).catch(() => {});
  }, [txState, ready]);

  // Persist snapshots
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapState)).catch(() => {});
  }, [snapState, ready]);

  const addItem = useCallback((draft: Omit<FruitItem, "id" | "createdAt" | "updatedAt">) => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatchItems({ type: "ADD", item: { ...draft, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<FruitItem>) => {
    dispatchItems({ type: "UPDATE", id, updates });
  }, []);

  const deleteItem = useCallback((id: string) => {
    dispatchItems({ type: "DELETE", id });
  }, []);

  const addTransaction = useCallback((draft: Omit<FruitTransaction, "id" | "createdAt">) => {
    const id = uuid();
    const now = new Date().toISOString();
    const tx: FruitTransaction = { ...draft, id, createdAt: now };
    dispatchTx({ type: "ADD", tx });
    // Update item stock
    dispatchItems({
      type: "UPDATE",
      id: draft.fruitItemId,
      updates: {
        currentStock: Math.max(0, (itemsState.items.find(i => i.id === draft.fruitItemId)?.currentStock ?? 0) + draft.quantity),
        latestCostPrice: draft.type === "in" && draft.unitPrice > 0 ? draft.unitPrice : undefined as unknown as number,
      },
    });
  }, [itemsState.items]);

  const deleteTransaction = useCallback((id: string) => {
    dispatchTx({ type: "DELETE", id });
  }, []);

  const addSnapshot = useCallback((draft: Omit<FruitMonthlySnapshot, "id" | "createdAt">) => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatchSnap({ type: "ADD", snapshot: { ...draft, id, createdAt: now } });
  }, []);

  const deleteSnapshot = useCallback((id: string) => {
    dispatchSnap({ type: "DELETE", id });
  }, []);

  const getItemTransactions = useCallback((itemId: string) => {
    return txState.transactions.filter(t => t.fruitItemId === itemId);
  }, [txState.transactions]);

  const getLowStockItems = useCallback(() => {
    return itemsState.items.filter(i => i.active && i.currentStock <= i.alertThreshold);
  }, [itemsState.items]);

  return (
    <FruitContext.Provider value={{
      items: itemsState.items,
      addItem, updateItem, deleteItem,
      transactions: txState.transactions,
      addTransaction, deleteTransaction,
      snapshots: snapState.snapshots,
      addSnapshot, deleteSnapshot,
      getItemTransactions, getLowStockItems,
      ready,
    }}>
      {children}
    </FruitContext.Provider>
  );
}

export function useFruitStore() {
  const ctx = useContext(FruitContext);
  if (!ctx) throw new Error("useFruitStore must be used within FruitProvider");
  return ctx;
}
