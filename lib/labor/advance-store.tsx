/**
 * 薪资预支记录 Store
 * 适用于全职/长期兼职员工提前预支薪水的情况
 * 预支金额在最终薪资结算时自动扣除
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { sumMoney } from "@/lib/finance/money";

const STORAGE_KEY = "labor.salary_advances.v1";
const CATEGORY_STORAGE_KEY = "labor.advance_categories.v1";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── 预支分类 ─────────────────────────────────────────────────────────────────

export interface AdvanceCategory {
  id: string;
  name: string;
  /** 是否内置（不可删除） */
  isBuiltin: boolean;
  sortOrder: number;
}

/** 内置分类（不可删除） */
export const BUILTIN_ADVANCE_CATEGORIES: AdvanceCategory[] = [
  { id: "fulltime_advance",  name: "全职预支",         isBuiltin: true, sortOrder: 0 },
  { id: "fulltime_salary",   name: "全职薪资发放",      isBuiltin: true, sortOrder: 1 },
  { id: "longterm_salary",   name: "长期兼职薪资发放",  isBuiltin: true, sortOrder: 2 },
  { id: "temp_parttime",     name: "临时兼职",          isBuiltin: true, sortOrder: 3 },
];

// ─── 预支记录类型 ─────────────────────────────────────────────────────────────

/** 预支状态 */
export type AdvanceStatus =
  | "pending"    // 待扣除（本月或未来月份结算时扣）
  | "deducted"   // 已在薪资单中扣除
  | "cancelled"; // 已取消（如还款）

export interface SalaryAdvance {
  id: string;
  /** 员工 ID */
  employeeId: string;
  /** 预支日期 YYYY-MM-DD */
  date: string;
  /** 预支金额（元） */
  amount: number;
  /** 计划扣除月份（如 "2026-03"，空=下月自动扣） */
  deductMonth: string;
  /** 状态 */
  status: AdvanceStatus;
  /** 预支分类 ID（对应 AdvanceCategory.id） */
  category: string;
  /** 关联的薪资单 ID（已扣除时填入） */
  paySlipId?: string;
  /** 关联的备用金记录 ID（通过备用金支付时填入） */
  pettyRecordId?: string;
  /** 备注（如：预支原因、还款说明） */
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 预支记录 State / Actions ─────────────────────────────────────────────────
interface AdvanceState {
  advances: SalaryAdvance[];
}

type AdvanceAction =
  | { type: "LOAD"; payload: AdvanceState }
  | { type: "ADD"; advance: SalaryAdvance }
  | { type: "UPDATE"; id: string; updates: Partial<SalaryAdvance> }
  | { type: "DELETE"; id: string };

function advanceReducer(state: AdvanceState, action: AdvanceAction): AdvanceState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { advances: [action.advance, ...state.advances] };
    case "UPDATE":
      return { advances: state.advances.map((a) => a.id === action.id ? { ...a, ...action.updates, updatedAt: new Date().toISOString() } : a) };
    case "DELETE":
      return { advances: state.advances.filter((a) => a.id !== action.id) };
    default: return state;
  }
}

// ─── 分类 State / Actions ─────────────────────────────────────────────────────
interface CategoryState {
  customCategories: AdvanceCategory[];
}

type CategoryAction =
  | { type: "LOAD"; payload: AdvanceCategory[] }
  | { type: "ADD"; category: AdvanceCategory }
  | { type: "UPDATE"; id: string; updates: Partial<AdvanceCategory> }
  | { type: "DELETE"; id: string };

function categoryReducer(state: CategoryState, action: CategoryAction): CategoryState {
  switch (action.type) {
    case "LOAD": return { customCategories: action.payload };
    case "ADD": return { customCategories: [...state.customCategories, action.category] };
    case "UPDATE":
      return { customCategories: state.customCategories.map((c) => c.id === action.id ? { ...c, ...action.updates } : c) };
    case "DELETE":
      return { customCategories: state.customCategories.filter((c) => c.id !== action.id) };
    default: return state;
  }
}

// ─── 预支记录 Context ─────────────────────────────────────────────────────────
interface AdvanceContextValue extends AdvanceState {
  addAdvance: (data: Omit<SalaryAdvance, "id" | "createdAt" | "updatedAt">) => string;
  updateAdvance: (id: string, updates: Partial<SalaryAdvance>) => void;
  deleteAdvance: (id: string) => void;
  /** 获取某员工某月待扣除的预支总额 */
  getPendingDeduction: (employeeId: string, month: string) => number;
  /** 获取某员工某月的预支记录 */
  getAdvancesForMonth: (employeeId: string, month: string) => SalaryAdvance[];
  /** 标记为已扣除 */
  markDeducted: (advanceId: string, paySlipId: string) => void;
}

const AdvanceContext = createContext<AdvanceContextValue | null>(null);

// ─── 分类 Context ─────────────────────────────────────────────────────────────
interface CategoryContextValue {
  /** 所有分类（内置 + 自定义），已按 sortOrder 排序 */
  allCategories: AdvanceCategory[];
  customCategories: AdvanceCategory[];
  addCategory: (name: string) => void;
  updateCategory: (id: string, name: string) => void;
  deleteCategory: (id: string) => void;
}

const CategoryContext = createContext<CategoryContextValue | null>(null);

// ─── Providers ────────────────────────────────────────────────────────────────

export function SalaryAdvanceCategoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(categoryReducer, { customCategories: [] });

  useEffect(() => {
    const load = () => AsyncStorage.getItem(CATEGORY_STORAGE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    load();
    return registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(state.customCategories)).catch(() => {});
    notifySyncChange(CATEGORY_STORAGE_KEY);
  }, [state.customCategories]);

  const allCategories = React.useMemo(() =>
    [...BUILTIN_ADVANCE_CATEGORIES, ...state.customCategories].sort((a, b) => a.sortOrder - b.sortOrder),
    [state.customCategories]
  );

  const addCategory = useCallback((name: string) => {
    const maxOrder = Math.max(...allCategories.map((c) => c.sortOrder), 3);
    dispatch({ type: "ADD", category: { id: uuid(), name, isBuiltin: false, sortOrder: maxOrder + 1 } });
  }, [allCategories]);

  const updateCategory = useCallback((id: string, name: string) => {
    dispatch({ type: "UPDATE", id, updates: { name } });
  }, []);

  const deleteCategory = useCallback((id: string) => {
    dispatch({ type: "DELETE", id });
  }, []);

  return (
    <CategoryContext.Provider value={{ allCategories, customCategories: state.customCategories, addCategory, updateCategory, deleteCategory }}>
      {children}
    </CategoryContext.Provider>
  );
}

export function SalaryAdvanceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(advanceReducer, { advances: [] });

  useEffect(() => {
    const load = () => AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<AdvanceState>;
          // 迁移旧数据：补充 category 字段
          const advances = (parsed.advances ?? []).map((a: any) => ({
            ...a,
            category: a.category ?? "fulltime_advance",
          }));
          dispatch({ type: "LOAD", payload: { advances } });
        } catch {}
      }
    });
    load();
    return registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [state]);

  const addAdvance = useCallback((data: Omit<SalaryAdvance, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatch({ type: "ADD", advance: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);

  const updateAdvance = useCallback((id: string, updates: Partial<SalaryAdvance>) =>
    dispatch({ type: "UPDATE", id, updates }), []);

  const deleteAdvance = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);

  const getPendingDeduction = useCallback((employeeId: string, month: string): number => {
    return sumMoney(state.advances
      .filter((advance) =>
        advance.employeeId === employeeId &&
        advance.status === "pending" &&
        (advance.deductMonth === month || advance.deductMonth === "")
      )
      .map((advance) => advance.amount));
  }, [state.advances]);

  const getAdvancesForMonth = useCallback((employeeId: string, month: string): SalaryAdvance[] => {
    return state.advances.filter((a) =>
      a.employeeId === employeeId &&
      (a.deductMonth === month || a.date.startsWith(month))
    );
  }, [state.advances]);

  const markDeducted = useCallback((advanceId: string, paySlipId: string) => {
    dispatch({ type: "UPDATE", id: advanceId, updates: { status: "deducted", paySlipId } });
  }, []);

  return (
    <AdvanceContext.Provider value={{
      ...state, addAdvance, updateAdvance, deleteAdvance,
      getPendingDeduction, getAdvancesForMonth, markDeducted,
    }}>
      {children}
    </AdvanceContext.Provider>
  );
}

export function useSalaryAdvanceStore(): AdvanceContextValue {
  const ctx = useContext(AdvanceContext);
  if (!ctx) throw new Error("useSalaryAdvanceStore must be used within SalaryAdvanceProvider");
  return ctx;
}

export function useAdvanceCategoryStore(): CategoryContextValue {
  const ctx = useContext(CategoryContext);
  if (!ctx) throw new Error("useAdvanceCategoryStore must be used within SalaryAdvanceCategoryProvider");
  return ctx;
}
