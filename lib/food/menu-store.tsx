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
  | { type: "TOGGLE_AVAILABLE"; id: string };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: FoodMenuState, action: Action): FoodMenuState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { items: [action.item, ...state.items] };
    case "UPDATE": return { items: state.items.map((i) => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE": return { items: state.items.filter((i) => i.id !== action.id) };
    case "TOGGLE_AVAILABLE": return { items: state.items.map((i) => i.id === action.id ? { ...i, available: !i.available, updatedAt: new Date().toISOString() } : i) };
    default: return state;
  }
}

interface FoodMenuContextValue extends FoodMenuState {
  addItem: (data: Omit<FoodItem, "id" | "createdAt" | "updatedAt">) => void;
  updateItem: (id: string, updates: Partial<FoodItem>) => void;
  deleteItem: (id: string) => void;
  toggleAvailable: (id: string) => void;
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
  const toggleAvailable = useCallback((id: string) => dispatch({ type: "TOGGLE_AVAILABLE", id }), []);

  return (
    <FoodMenuContext.Provider value={{ ...state, addItem, updateItem, deleteItem, toggleAvailable }}>
      {children}
    </FoodMenuContext.Provider>
  );
}

export function useFoodMenuStore(): FoodMenuContextValue {
  const ctx = useContext(FoodMenuContext);
  if (!ctx) throw new Error("useFoodMenuStore must be used within FoodMenuProvider");
  return ctx;
}
