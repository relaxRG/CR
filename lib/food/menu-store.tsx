import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { FoodItem } from "./types";

const STORAGE_KEY = "food.menu.v1";

export interface FoodMenuState { items: FoodItem[] }

type Action =
  | { type: "LOAD"; payload: FoodMenuState }
  | { type: "ADD"; item: FoodItem }
  | { type: "UPDATE"; id: string; updates: Partial<FoodItem> }
  | { type: "DELETE"; id: string }
  | { type: "BATCH_DELETE"; ids: string[] }
  | { type: "REORDER"; items: FoodItem[] }
  | { type: "TOGGLE_AVAILABLE"; id: string }
  | { type: "BATCH_TOGGLE"; ids: string[]; available: boolean };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: FoodMenuState, action: Action): FoodMenuState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { items: [action.item, ...state.items] };
    case "UPDATE": return { items: state.items.map((i) => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE": return { items: state.items.filter((i) => i.id !== action.id) };
    case "BATCH_DELETE": return { items: state.items.filter((i) => !action.ids.includes(i.id)) };
    case "REORDER": return { items: action.items };
    case "TOGGLE_AVAILABLE": return { items: state.items.map((i) => i.id === action.id ? { ...i, available: !i.available, updatedAt: new Date().toISOString() } : i) };
    case "BATCH_TOGGLE": return { items: state.items.map((i) => action.ids.includes(i.id) ? { ...i, available: action.available, updatedAt: new Date().toISOString() } : i) };
    default: return state;
  }
}

interface FoodMenuContextValue extends FoodMenuState {
  addItem: (data: Omit<FoodItem, "id" | "createdAt" | "updatedAt">) => void;
  updateItem: (id: string, updates: Partial<FoodItem>) => void;
  deleteItem: (id: string) => void;
  batchDeleteItems: (ids: string[]) => void;
  reorderItems: (items: FoodItem[]) => void;
  toggleAvailable: (id: string) => void;
  batchToggleAvailable: (ids: string[], available: boolean) => void;
}

const FoodMenuContext = createContext<FoodMenuContextValue | null>(null);

export function FoodMenuProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [] });

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

  const addItem = useCallback((data: Omit<FoodItem, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    dispatch({ type: "ADD", item: { ...data, id: uuid(), createdAt: now, updatedAt: now } });
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<FoodItem>) => {
    dispatch({ type: "UPDATE", id, updates });
  }, []);

  const deleteItem = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);
  const batchDeleteItems = useCallback((ids: string[]) => dispatch({ type: "BATCH_DELETE", ids }), []);
  const reorderItems = useCallback((items: FoodItem[]) => dispatch({ type: "REORDER", items }), []);
  const toggleAvailable = useCallback((id: string) => dispatch({ type: "TOGGLE_AVAILABLE", id }), []);
  const batchToggleAvailable = useCallback((ids: string[], available: boolean) => dispatch({ type: "BATCH_TOGGLE", ids, available }), []);

  return (
    <FoodMenuContext.Provider value={{ ...state, addItem, updateItem, deleteItem, batchDeleteItems, reorderItems, toggleAvailable, batchToggleAvailable }}>
      {children}
    </FoodMenuContext.Provider>
  );
}

export function useFoodMenuStore(): FoodMenuContextValue {
  const ctx = useContext(FoodMenuContext);
  if (!ctx) throw new Error("useFoodMenuStore must be used within FoodMenuProvider");
  return ctx;
}
