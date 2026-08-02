/**
 * 啤酒进销存 Store
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { BeerItem, BeerTransaction, BeerMonthlySnapshot } from "./types";

const ITEMS_KEY = "beer.items.v1";
const TX_KEY = "beer.transactions.v1";
const SNAP_KEY = "beer.snapshots.v1";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── State ────────────────────────────────────────────────────────────────────
interface BeerState {
  items: BeerItem[];
  transactions: BeerTransaction[];
  snapshots: BeerMonthlySnapshot[];
}

type Action =
  | { type: "LOAD"; payload: BeerState }
  | { type: "ADD_ITEM"; item: BeerItem }
  | { type: "UPDATE_ITEM"; id: string; updates: Partial<BeerItem> }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_TX"; tx: BeerTransaction }
  | { type: "ADD_SNAPSHOT"; snap: BeerMonthlySnapshot }
  | { type: "DELETE_SNAPSHOT"; id: string };

function reducer(state: BeerState, action: Action): BeerState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_ITEM": return { ...state, items: [action.item, ...state.items] };
    case "UPDATE_ITEM":
      return { ...state, items: state.items.map((i) => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE_ITEM":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "ADD_TX": {
      const tx = action.tx;
      const newItems = state.items.map((item) => {
        if (item.id !== tx.beerItemId) return item;
        const newStock = Math.max(0, item.currentStock + tx.quantity);
        const updates: Partial<BeerItem> = { currentStock: newStock, updatedAt: new Date().toISOString() };
        if (tx.type === "in" && tx.unitPrice > 0) updates.latestCostPrice = tx.unitPrice;
        return { ...item, ...updates };
      });
      return { ...state, items: newItems, transactions: [tx, ...state.transactions] };
    }
    case "ADD_SNAPSHOT":
      return { ...state, snapshots: [action.snap, ...state.snapshots.filter((s) => s.month !== action.snap.month)] };
    case "DELETE_SNAPSHOT":
      return { ...state, snapshots: state.snapshots.filter((s) => s.id !== action.id) };
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface BeerContextValue extends BeerState {
  addItem: (data: Omit<BeerItem, "id" | "createdAt" | "updatedAt">) => string;
  updateItem: (id: string, updates: Partial<BeerItem>) => void;
  deleteItem: (id: string) => void;
  addTransaction: (data: Omit<BeerTransaction, "id" | "createdAt">) => void;
  addSnapshot: (snap: BeerMonthlySnapshot) => void;
  deleteSnapshot: (id: string) => void;
  /** 获取某款啤酒的月度进货汇总 */
  getMonthlyPurchase: (beerItemId: string, month: string) => { qty: number; cost: number };
}

const BeerContext = createContext<BeerContextValue | null>(null);

export function BeerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [], transactions: [], snapshots: [] });

  useEffect(() => {
    const load = async () => {
      try {
        const [itemsRaw, txRaw, snapRaw] = await Promise.all([
          AsyncStorage.getItem(ITEMS_KEY),
          AsyncStorage.getItem(TX_KEY),
          AsyncStorage.getItem(SNAP_KEY),
        ]);
        dispatch({
          type: "LOAD",
          payload: {
            items: itemsRaw ? JSON.parse(itemsRaw) : [],
            transactions: txRaw ? JSON.parse(txRaw) : [],
            snapshots: snapRaw ? JSON.parse(snapRaw) : [],
          },
        });
      } catch {}
    };
    load();
    registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(state.items)).catch(() => {});
    AsyncStorage.setItem(TX_KEY, JSON.stringify(state.transactions)).catch(() => {});
    AsyncStorage.setItem(SNAP_KEY, JSON.stringify(state.snapshots)).catch(() => {});
    notifySyncChange(ITEMS_KEY);
  }, [state]);

  const addItem = useCallback((data: Omit<BeerItem, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatch({ type: "ADD_ITEM", item: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);
  const updateItem = useCallback((id: string, updates: Partial<BeerItem>) => dispatch({ type: "UPDATE_ITEM", id, updates }), []);
  const deleteItem = useCallback((id: string) => dispatch({ type: "DELETE_ITEM", id }), []);
  const addTransaction = useCallback((data: Omit<BeerTransaction, "id" | "createdAt">) => {
    dispatch({ type: "ADD_TX", tx: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
  }, []);
  const addSnapshot = useCallback((snap: BeerMonthlySnapshot) => dispatch({ type: "ADD_SNAPSHOT", snap }), []);
  const deleteSnapshot = useCallback((id: string) => dispatch({ type: "DELETE_SNAPSHOT", id }), []);

  const getMonthlyPurchase = useCallback((beerItemId: string, month: string) => {
    const txs = state.transactions.filter(
      (t) => t.beerItemId === beerItemId && t.type === "in" && t.date.startsWith(month)
    );
    return {
      qty: txs.reduce((s, t) => s + t.quantity, 0),
      cost: txs.reduce((s, t) => s + t.totalAmount, 0),
    };
  }, [state.transactions]);

  return (
    <BeerContext.Provider value={{ ...state, addItem, updateItem, deleteItem, addTransaction, addSnapshot, deleteSnapshot, getMonthlyPurchase }}>
      {children}
    </BeerContext.Provider>
  );
}

export function useBeerStore(): BeerContextValue {
  const ctx = useContext(BeerContext);
  if (!ctx) throw new Error("useBeerStore must be used within BeerProvider");
  return ctx;
}
