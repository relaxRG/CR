/**
 * 薪资预支记录 Store
 * 适用于长期兼职员工提前预支薪水的情况
 * 预支金额在最终薪资结算时自动扣除
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";

const STORAGE_KEY = "labor.salary_advances.v1";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 预支状态 */
export type AdvanceStatus =
  | "pending"    // 待扣除（本月或未来月份结算时扣）
  | "deducted"   // 已在薪资单中扣除
  | "cancelled"; // 已取消（如还款）

export interface SalaryAdvance {
  id: string;
  /** 员工 ID */
  employeeId: string;
  /** 预支日期 */
  date: string;
  /** 预支金额（元） */
  amount: number;
  /** 计划扣除月份（如 "2026-03"，空=下月自动扣） */
  deductMonth: string;
  /** 状态 */
  status: AdvanceStatus;
  /** 关联的薪资单 ID（已扣除时填入） */
  paySlipId?: string;
  /** 备注（如：预支原因、还款说明） */
  notes: string;
  /** 是否通过备用金支付（K1 固定兼职） */
  paidViaPetty: boolean;
  /** 关联的备用金记录 ID */
  pettyRecordId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── State / Actions ──────────────────────────────────────────────────────────
interface AdvanceState {
  advances: SalaryAdvance[];
}

type Action =
  | { type: "LOAD"; payload: AdvanceState }
  | { type: "ADD"; advance: SalaryAdvance }
  | { type: "UPDATE"; id: string; updates: Partial<SalaryAdvance> }
  | { type: "DELETE"; id: string };

function reducer(state: AdvanceState, action: Action): AdvanceState {
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

// ─── Context ──────────────────────────────────────────────────────────────────
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

export function SalaryAdvanceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { advances: [] });

  useEffect(() => {
    const load = () => AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) { try { dispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
    });
    load();
    // ★ 注册同步重载回调
    return registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    // ★ 通知同步引擎
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
    return state.advances
      .filter((a) =>
        a.employeeId === employeeId &&
        a.status === "pending" &&
        (a.deductMonth === month || a.deductMonth === "")
      )
      .reduce((sum, a) => sum + a.amount, 0);
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
