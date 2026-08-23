import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

const STORAGE_KEY = "lab.plan.v1";

export type PlanCategory = "cocktail" | "food";
export type PlanItemType = "product" | "purchase";
export type PlanItemStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface PlanItem {
  id: string;
  category: PlanCategory;
  type: PlanItemType;
  status: PlanItemStatus;
  /** 产品名称 / 采购品名 */
  name: string;
  /** 描述/备注 */
  notes: string;
  /** 优先级 1-3 */
  priority: 1 | 2 | 3;
  /** 计划采购数量（type=purchase 时使用） */
  quantity: string;
  /** 预计完成日期 */
  dueDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanState { items: PlanItem[] }

type Action =
  | { type: "LOAD"; payload: PlanState }
  | { type: "ADD"; item: PlanItem }
  | { type: "UPDATE"; id: string; updates: Partial<PlanItem> }
  | { type: "DELETE"; id: string }
  | { type: "SET_STATUS"; id: string; status: PlanItemStatus };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: PlanState, action: Action): PlanState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { items: [action.item, ...state.items] };
    case "UPDATE": return { items: state.items.map((i) => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE": return { items: state.items.filter((i) => i.id !== action.id) };
    case "SET_STATUS": return { items: state.items.map((i) => i.id === action.id ? { ...i, status: action.status, updatedAt: new Date().toISOString() } : i) };
    default: return state;
  }
}

interface PlanContextValue extends PlanState {
  addItem: (data: Omit<PlanItem, "id" | "createdAt" | "updatedAt">) => void;
  updateItem: (id: string, updates: Partial<PlanItem>) => void;
  deleteItem: (id: string) => void;
  setStatus: (id: string, status: PlanItemStatus) => void;
}

const PlanContext = createContext<PlanContextValue | null>(null);

export function LabPlanProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [] });

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    return registerStoreReload(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      });
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  const addItem = useCallback((data: Omit<PlanItem, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    dispatch({ type: "ADD", item: { ...data, id: uuid(), createdAt: now, updatedAt: now } });
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<PlanItem>) => dispatch({ type: "UPDATE", id, updates }), []);
  const deleteItem = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);
  const setStatus = useCallback((id: string, status: PlanItemStatus) => dispatch({ type: "SET_STATUS", id, status }), []);

  return (
    <PlanContext.Provider value={{ ...state, addItem, updateItem, deleteItem, setStatus }}>
      {children}
    </PlanContext.Provider>
  );
}

export function useLabPlanStore(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("useLabPlanStore must be used within LabPlanProvider");
  return ctx;
}

