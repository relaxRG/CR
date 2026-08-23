import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

const STORAGE_KEY = "store.revenue.v1";

export type RevenueCategory =
  | "revenue"       // 营收
  | "food_cost"     // 食材成本
  | "spirit_cost"   // 烈酒成本
  | "wine_cost"     // 葡萄酒成本
  | "labor_cost"    // 人工成本
  | "rent"          // 房租
  | "utilities"     // 水电
  | "petty_cash"    // 备用金
  | "operations";   // 公司运营

export const REVENUE_CATEGORY_LABELS: Record<RevenueCategory, string> = {
  revenue: "营收",
  food_cost: "食材成本",
  spirit_cost: "烈酒成本",
  wine_cost: "葡萄酒成本",
  labor_cost: "人工成本",
  rent: "房租",
  utilities: "水电",
  petty_cash: "备用金",
  operations: "公司运营",
};

export interface RevenueRecord {
  id: string;
  date: string;         // YYYY-MM-DD
  category: RevenueCategory;
  amount: number;       // 元，正数=收入，负数=支出
  notes: string;
  createdAt: string;
}

/** 员工工时记录 */
export interface StaffRecord {
  id: string;
  name: string;
  month: string;        // YYYY-MM
  workDays: number;
  workHours: number;
  salary: number;
  notes: string;
}

export interface RevenueState {
  records: RevenueRecord[];
  staff: StaffRecord[];
}

type Action =
  | { type: "LOAD"; payload: RevenueState }
  | { type: "ADD_RECORD"; record: RevenueRecord }
  | { type: "UPDATE_RECORD"; id: string; updates: Partial<RevenueRecord> }
  | { type: "DELETE_RECORD"; id: string }
  | { type: "ADD_STAFF"; staff: StaffRecord }
  | { type: "UPDATE_STAFF"; id: string; updates: Partial<StaffRecord> }
  | { type: "DELETE_STAFF"; id: string };

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function reducer(state: RevenueState, action: Action): RevenueState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_RECORD": return { ...state, records: [action.record, ...state.records] };
    case "UPDATE_RECORD": return { ...state, records: state.records.map((r) => r.id === action.id ? { ...r, ...action.updates } : r) };
    case "DELETE_RECORD": return { ...state, records: state.records.filter((r) => r.id !== action.id) };
    case "ADD_STAFF": return { ...state, staff: [action.staff, ...state.staff] };
    case "UPDATE_STAFF": return { ...state, staff: state.staff.map((s) => s.id === action.id ? { ...s, ...action.updates } : s) };
    case "DELETE_STAFF": return { ...state, staff: state.staff.filter((s) => s.id !== action.id) };
    default: return state;
  }
}

interface RevenueContextValue extends RevenueState {
  addRecord: (data: Omit<RevenueRecord, "id" | "createdAt">) => void;
  updateRecord: (id: string, updates: Partial<RevenueRecord>) => void;
  deleteRecord: (id: string) => void;
  addStaff: (data: Omit<StaffRecord, "id">) => void;
  updateStaff: (id: string, updates: Partial<StaffRecord>) => void;
  deleteStaff: (id: string) => void;
}

const RevenueContext = createContext<RevenueContextValue | null>(null);

export function RevenueProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { records: [], staff: [] });

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

  const addRecord = useCallback((data: Omit<RevenueRecord, "id" | "createdAt">) => {
    dispatch({ type: "ADD_RECORD", record: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
  }, []);
  const updateRecord = useCallback((id: string, updates: Partial<RevenueRecord>) => dispatch({ type: "UPDATE_RECORD", id, updates }), []);
  const deleteRecord = useCallback((id: string) => dispatch({ type: "DELETE_RECORD", id }), []);
  const addStaff = useCallback((data: Omit<StaffRecord, "id">) => dispatch({ type: "ADD_STAFF", staff: { ...data, id: uuid() } }), []);
  const updateStaff = useCallback((id: string, updates: Partial<StaffRecord>) => dispatch({ type: "UPDATE_STAFF", id, updates }), []);
  const deleteStaff = useCallback((id: string) => dispatch({ type: "DELETE_STAFF", id }), []);

  return (
    <RevenueContext.Provider value={{ ...state, addRecord, updateRecord, deleteRecord, addStaff, updateStaff, deleteStaff }}>
      {children}
    </RevenueContext.Provider>
  );
}

export function useRevenueStore(): RevenueContextValue {
  const ctx = useContext(RevenueContext);
  if (!ctx) throw new Error("useRevenueStore must be used within RevenueProvider");
  return ctx;
}
