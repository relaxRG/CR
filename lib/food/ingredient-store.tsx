import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { FoodIngredient, PriceHistoryEntry, SupplierPurchaseRecord } from "./types";

const STORAGE_KEY = "food.ingredients.v2";
const PURCHASE_KEY = "food.purchases.v1";

export interface FoodIngredientState {
  ingredients: FoodIngredient[];
  /** 每个 ingredient 的价格历史，key=ingredientId */
  priceHistory: Record<string, PriceHistoryEntry[]>;
}

export interface PurchaseState {
  records: SupplierPurchaseRecord[];
}

type Action =
  | { type: "LOAD"; payload: FoodIngredientState }
  | { type: "ADD"; ingredient: FoodIngredient }
  | { type: "UPDATE"; id: string; updates: Partial<FoodIngredient> }
  | { type: "DELETE"; id: string }
  | { type: "UPDATE_STOCK"; id: string; delta: number }
  | {
      type: "BATCH_IMPORT";
      updates: {
        id: string;
        costPrice: number;
        stockDelta: number;
        supplier: string;
        priceEntry: PriceHistoryEntry;
      }[];
    };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: FoodIngredientState, action: Action): FoodIngredientState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { ...state, ingredients: [action.ingredient, ...state.ingredients] };
    case "UPDATE": return {
      ...state,
      ingredients: state.ingredients.map((i) =>
        i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i
      ),
    };
    case "DELETE": return { ...state, ingredients: state.ingredients.filter((i) => i.id !== action.id) };
    case "UPDATE_STOCK": return {
      ...state,
      ingredients: state.ingredients.map((i) =>
        i.id === action.id ? { ...i, stock: Math.max(0, i.stock + action.delta), updatedAt: new Date().toISOString() } : i
      ),
    };
    case "BATCH_IMPORT": {
      const newIngredients = state.ingredients.map((ing) => {
        const upd = action.updates.find((u) => u.id === ing.id);
        if (!upd) return ing;
        return {
          ...ing,
          costPrice: upd.costPrice,
          supplier: upd.supplier || ing.supplier,
          stock: Math.max(0, ing.stock + upd.stockDelta),
          updatedAt: new Date().toISOString(),
        };
      });
      const newHistory = { ...state.priceHistory };
      for (const upd of action.updates) {
        const existing = newHistory[upd.id] ?? [];
        const alreadyExists = existing.some(
          (e) => e.date === upd.priceEntry.date && e.price === upd.priceEntry.price
        );
        if (!alreadyExists) {
          newHistory[upd.id] = [upd.priceEntry, ...existing].slice(0, 50);
        }
      }
      return { ingredients: newIngredients, priceHistory: newHistory };
    }
    default: return state;
  }
}

interface FoodIngredientContextValue extends FoodIngredientState {
  addIngredient: (data: Omit<FoodIngredient, "id" | "createdAt" | "updatedAt">) => void;
  updateIngredient: (id: string, updates: Partial<FoodIngredient>) => void;
  deleteIngredient: (id: string) => void;
  updateStock: (id: string, delta: number) => void;
  batchImport: (
    updates: { id: string; costPrice: number; stockDelta: number; supplier: string; priceEntry: PriceHistoryEntry }[]
  ) => void;
}

const FoodIngredientContext = createContext<FoodIngredientContextValue | null>(null);

export function FoodIngredientProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ingredients: [], priceHistory: {} });

  useEffect(() => {
    // 先尝试读 v2，再回退 v1（兼容旧数据）
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          dispatch({
            type: "LOAD",
            payload: {
              ingredients: parsed.ingredients ?? [],
              priceHistory: parsed.priceHistory ?? {},
            },
          });
          return;
        } catch {}
      }
      // 回退读 v1
      AsyncStorage.getItem("food.ingredients.v1").then((raw1) => {
        if (raw1) {
          try {
            const parsed1 = JSON.parse(raw1);
            dispatch({
              type: "LOAD",
              payload: {
                ingredients: Array.isArray(parsed1) ? parsed1 : (parsed1.ingredients ?? []),
                priceHistory: {},
              },
            });
          } catch {}
        }
      });
    });
    registerStoreReload(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            dispatch({
              type: "LOAD",
              payload: {
                ingredients: parsed.ingredients ?? [],
                priceHistory: parsed.priceHistory ?? {},
              },
            });
          } catch {}
        }
      });
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  const addIngredient = useCallback((data: Omit<FoodIngredient, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    dispatch({ type: "ADD", ingredient: { ...data, id: uuid(), createdAt: now, updatedAt: now } });
  }, []);

  const updateIngredient = useCallback((id: string, updates: Partial<FoodIngredient>) => {
    dispatch({ type: "UPDATE", id, updates });
  }, []);

  const deleteIngredient = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);

  const updateStock = useCallback((id: string, delta: number) => {
    dispatch({ type: "UPDATE_STOCK", id, delta });
  }, []);

  const batchImport = useCallback(
    (updates: { id: string; costPrice: number; stockDelta: number; supplier: string; priceEntry: PriceHistoryEntry }[]) => {
      dispatch({ type: "BATCH_IMPORT", updates });
    },
    []
  );

  return (
    <FoodIngredientContext.Provider
      value={{ ...state, addIngredient, updateIngredient, deleteIngredient, updateStock, batchImport }}
    >
      {children}
    </FoodIngredientContext.Provider>
  );
}

export function useFoodIngredientStore(): FoodIngredientContextValue {
  const ctx = useContext(FoodIngredientContext);
  if (!ctx) throw new Error("useFoodIngredientStore must be used within FoodIngredientProvider");
  return ctx;
}

// ─── 供应商进货记录 Store ──────────────────────────────────────────────────────
type PurchaseAction =
  | { type: "LOAD"; payload: PurchaseState }
  | { type: "ADD_RECORD"; record: SupplierPurchaseRecord }
  | { type: "DELETE_RECORD"; id: string };

function purchaseReducer(state: PurchaseState, action: PurchaseAction): PurchaseState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_RECORD": return { records: [action.record, ...state.records] };
    case "DELETE_RECORD": return { records: state.records.filter((r) => r.id !== action.id) };
    default: return state;
  }
}

interface PurchaseContextValue extends PurchaseState {
  addRecord: (record: SupplierPurchaseRecord) => void;
  deleteRecord: (id: string) => void;
}

const PurchaseContext = createContext<PurchaseContextValue | null>(null);

export function SupplierPurchaseProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(purchaseReducer, { records: [] });

  useEffect(() => {
    AsyncStorage.getItem(PURCHASE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(PURCHASE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state]);

  const addRecord = useCallback((record: SupplierPurchaseRecord) => {
    dispatch({ type: "ADD_RECORD", record });
  }, []);

  const deleteRecord = useCallback((id: string) => {
    dispatch({ type: "DELETE_RECORD", id });
  }, []);

  return (
    <PurchaseContext.Provider value={{ ...state, addRecord, deleteRecord }}>
      {children}
    </PurchaseContext.Provider>
  );
}

export function useSupplierPurchaseStore(): PurchaseContextValue {
  const ctx = useContext(PurchaseContext);
  if (!ctx) throw new Error("useSupplierPurchaseStore must be used within SupplierPurchaseProvider");
  return ctx;
}
