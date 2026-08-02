/**
 * 冰块进销存 Context Store
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { IceInventoryItem, IceInventoryTransaction, IceInventoryState } from "./inventory";

const ITEMS_KEY = "ice.inv.items.v1";
const TX_KEY = "ice.inv.tx.v1";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

type Action =
  | { type: "LOAD"; payload: IceInventoryState }
  | { type: "ADD_ITEM"; item: IceInventoryItem }
  | { type: "UPDATE_ITEM"; id: string; updates: Partial<IceInventoryItem> }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_TX"; tx: IceInventoryTransaction };

function reducer(state: IceInventoryState, action: Action): IceInventoryState {
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
        if (item.id !== tx.iceItemId) return item;
        const newStock = Math.max(0, item.currentStock + tx.quantity);
        const updates: Partial<IceInventoryItem> = { currentStock: newStock, updatedAt: new Date().toISOString() };
        if (tx.type === "in" && tx.unitPrice > 0) updates.latestCostPrice = tx.unitPrice;
        return { ...item, ...updates };
      });
      return { ...state, items: newItems, transactions: [tx, ...state.transactions] };
    }
    default: return state;
  }
}

interface IceInventoryContextValue extends IceInventoryState {
  addItem: (data: Omit<IceInventoryItem, "id" | "createdAt" | "updatedAt">) => string;
  updateItem: (id: string, updates: Partial<IceInventoryItem>) => void;
  deleteItem: (id: string) => void;
  addTransaction: (data: Omit<IceInventoryTransaction, "id" | "createdAt">) => void;
  getMonthlyPurchase: (iceItemId: string, month: string) => { qty: number; cost: number };
}

const IceInventoryContext = createContext<IceInventoryContextValue | null>(null);

export function IceInventoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [], transactions: [] });

  useEffect(() => {
    const load = async () => {
      try {
        const [itemsRaw, txRaw] = await Promise.all([
          AsyncStorage.getItem(ITEMS_KEY),
          AsyncStorage.getItem(TX_KEY),
        ]);
        dispatch({
          type: "LOAD",
          payload: {
            items: itemsRaw ? JSON.parse(itemsRaw) : [],
            transactions: txRaw ? JSON.parse(txRaw) : [],
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
    notifySyncChange(ITEMS_KEY);
  }, [state]);

  const addItem = useCallback((data: Omit<IceInventoryItem, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatch({ type: "ADD_ITEM", item: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);
  const updateItem = useCallback((id: string, updates: Partial<IceInventoryItem>) => dispatch({ type: "UPDATE_ITEM", id, updates }), []);
  const deleteItem = useCallback((id: string) => dispatch({ type: "DELETE_ITEM", id }), []);
  const addTransaction = useCallback((data: Omit<IceInventoryTransaction, "id" | "createdAt">) => {
    dispatch({ type: "ADD_TX", tx: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
  }, []);
  const getMonthlyPurchase = useCallback((iceItemId: string, month: string) => {
    const txs = state.transactions.filter((t) => t.iceItemId === iceItemId && t.type === "in" && t.date.startsWith(month));
    return { qty: txs.reduce((s, t) => s + t.quantity, 0), cost: txs.reduce((s, t) => s + t.totalAmount, 0) };
  }, [state.transactions]);

  return (
    <IceInventoryContext.Provider value={{ ...state, addItem, updateItem, deleteItem, addTransaction, getMonthlyPurchase }}>
      {children}
    </IceInventoryContext.Provider>
  );
}

export function useIceInventoryStore(): IceInventoryContextValue {
  const ctx = useContext(IceInventoryContext);
  if (!ctx) throw new Error("useIceInventoryStore must be used within IceInventoryProvider");
  return ctx;
}
