import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { FoodIngredient } from "./types";

const STORAGE_KEY = "food.ingredients.v1";

export interface FoodIngredientState { ingredients: FoodIngredient[] }

type Action =
  | { type: "LOAD"; payload: FoodIngredientState }
  | { type: "ADD"; ingredient: FoodIngredient }
  | { type: "UPDATE"; id: string; updates: Partial<FoodIngredient> }
  | { type: "DELETE"; id: string }
  | { type: "UPDATE_STOCK"; id: string; delta: number };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: FoodIngredientState, action: Action): FoodIngredientState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { ingredients: [action.ingredient, ...state.ingredients] };
    case "UPDATE": return { ingredients: state.ingredients.map((i) => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE": return { ingredients: state.ingredients.filter((i) => i.id !== action.id) };
    case "UPDATE_STOCK": return { ingredients: state.ingredients.map((i) => i.id === action.id ? { ...i, stock: Math.max(0, i.stock + action.delta), updatedAt: new Date().toISOString() } : i) };
    default: return state;
  }
}

interface FoodIngredientContextValue extends FoodIngredientState {
  addIngredient: (data: Omit<FoodIngredient, "id" | "createdAt" | "updatedAt">) => void;
  updateIngredient: (id: string, updates: Partial<FoodIngredient>) => void;
  deleteIngredient: (id: string) => void;
  updateStock: (id: string, delta: number) => void;
}

const FoodIngredientContext = createContext<FoodIngredientContextValue | null>(null);

export function FoodIngredientProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { ingredients: [] });

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

  const addIngredient = useCallback((data: Omit<FoodIngredient, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    dispatch({ type: "ADD", ingredient: { ...data, id: uuid(), createdAt: now, updatedAt: now } });
  }, []);

  const updateIngredient = useCallback((id: string, updates: Partial<FoodIngredient>) => {
    dispatch({ type: "UPDATE", id, updates });
  }, []);

  const deleteIngredient = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);
  const updateStock = useCallback((id: string, delta: number) => dispatch({ type: "UPDATE_STOCK", id, delta }), []);

  return (
    <FoodIngredientContext.Provider value={{ ...state, addIngredient, updateIngredient, deleteIngredient, updateStock }}>
      {children}
    </FoodIngredientContext.Provider>
  );
}

export function useFoodIngredientStore(): FoodIngredientContextValue {
  const ctx = useContext(FoodIngredientContext);
  if (!ctx) throw new Error("useFoodIngredientStore must be used within FoodIngredientProvider");
  return ctx;
}
