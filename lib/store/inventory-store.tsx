import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

const STORAGE_KEY = "store.inventory.v1";

export type InventoryCategory = "spirit" | "wine" | "food" | "equipment" | "tableware" | "daily";

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
  spirit: "烈酒",
  wine: "葡萄酒",
  food: "食材",
  equipment: "设备",
  tableware: "杯具餐具",
  daily: "日用品",
};

export interface InventoryItem {
  id: string;
  name: string;
  category: InventoryCategory;
  spec: string;         // 规格
  unit: string;         // 单位
  currentStock: number; // 当前库存
  alertThreshold: number; // 预警线
  costPrice: number | null;
  supplier: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  type: "in" | "out" | "adjust";
  quantity: number;     // 正数=入库，负数=出库
  date: string;
  notes: string;
  createdAt: string;
}

export interface InventoryState {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
}

type Action =
  | { type: "LOAD"; payload: InventoryState }
  | { type: "ADD_ITEM"; item: InventoryItem }
  | { type: "UPDATE_ITEM"; id: string; updates: Partial<InventoryItem> }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_TRANSACTION"; tx: InventoryTransaction };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: InventoryState, action: Action): InventoryState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_ITEM": return { ...state, items: [action.item, ...state.items] };
    case "UPDATE_ITEM": return { ...state, items: state.items.map((i) => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE_ITEM": return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "ADD_TRANSACTION": {
      const tx = action.tx;
      const newItems = state.items.map((item) => {
        if (item.id !== tx.itemId) return item;
        return { ...item, currentStock: Math.max(0, item.currentStock + tx.quantity), updatedAt: new Date().toISOString() };
      });
      return { items: newItems, transactions: [tx, ...state.transactions] };
    }
    default: return state;
  }
}

interface InventoryContextValue extends InventoryState {
  addItem: (data: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">) => void;
  updateItem: (id: string, updates: Partial<InventoryItem>) => void;
  deleteItem: (id: string) => void;
  addTransaction: (data: Omit<InventoryTransaction, "id" | "createdAt">) => void;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

export function InventoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [], transactions: [] });

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    registerStoreReload(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      });
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  const addItem = useCallback((data: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    dispatch({ type: "ADD_ITEM", item: { ...data, id: uuid(), createdAt: now, updatedAt: now } });
  }, []);
  const updateItem = useCallback((id: string, updates: Partial<InventoryItem>) => dispatch({ type: "UPDATE_ITEM", id, updates }), []);
  const deleteItem = useCallback((id: string) => dispatch({ type: "DELETE_ITEM", id }), []);
  const addTransaction = useCallback((data: Omit<InventoryTransaction, "id" | "createdAt">) => {
    dispatch({ type: "ADD_TRANSACTION", tx: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
  }, []);

  return (
    <InventoryContext.Provider value={{ ...state, addItem, updateItem, deleteItem, addTransaction }}>
      {children}
    </InventoryContext.Provider>
  );
}

export function useInventoryStore(): InventoryContextValue {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error("useInventoryStore must be used within InventoryProvider");
  return ctx;
}

