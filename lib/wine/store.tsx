import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { WineBottle } from "./types";

const STORAGE_KEY = "wine.bottles.v1";

export interface WineState {
  bottles: WineBottle[];
}

type Action =
  | { type: "LOAD"; payload: WineState }
  | { type: "ADD"; bottle: WineBottle }
  | { type: "UPDATE"; id: string; updates: Partial<WineBottle> }
  | { type: "DELETE"; id: string }
  | { type: "UPDATE_STOCK"; id: string; delta: number };

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const initialState: WineState = { bottles: [] };

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
    case "UPDATE_STOCK": return {
      ...state,
      bottles: state.bottles.map((b) =>
        b.id === action.id ? { ...b, stock: Math.max(0, b.stock + action.delta), updatedAt: new Date().toISOString() } : b
      ),
    };
    default: return state;
  }
}

interface WineContextValue extends WineState {
  addBottle: (data: Omit<WineBottle, "id" | "createdAt" | "updatedAt">) => void;
  updateBottle: (id: string, updates: Partial<WineBottle>) => void;
  deleteBottle: (id: string) => void;
  updateStock: (id: string, delta: number) => void;
}

const WineContext = createContext<WineContextValue | null>(null);

export function WineProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {}
      }
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

  const updateStock = useCallback((id: string, delta: number) => {
    dispatch({ type: "UPDATE_STOCK", id, delta });
  }, []);

  return (
    <WineContext.Provider value={{ ...state, addBottle, updateBottle, deleteBottle, updateStock }}>
      {children}
    </WineContext.Provider>
  );
}

export function useWineStore(): WineContextValue {
  const ctx = useContext(WineContext);
  if (!ctx) throw new Error("useWineStore must be used within WineProvider");
  return ctx;
}
