/**
 * 单独补发单 Store
 * 与正常薪资流程完全隔离，独立存储、独立付款、独立导出
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import type { SeparatePaymentSlip } from "./payroll-confirmation";

const STORAGE_KEY = "labor.separate_payments.v1";

// ─── State & Actions ──────────────────────────────────────────────────────────

interface SeparatePaymentState {
  payments: SeparatePaymentSlip[];
  ready: boolean;
}

type Action =
  | { type: "LOAD"; payload: SeparatePaymentSlip[] }
  | { type: "ADD"; payload: SeparatePaymentSlip[] }
  | { type: "MARK_PAID"; id: string; paidAt: number }
  | { type: "ADD_NOTE"; id: string; notes: string }
  | { type: "DELETE"; id: string };

function reducer(state: SeparatePaymentState, action: Action): SeparatePaymentState {
  switch (action.type) {
    case "LOAD":
      return { ...state, payments: action.payload, ready: true };
    case "ADD":
      return { ...state, payments: [...state.payments, ...action.payload] };
    case "MARK_PAID":
      return {
        ...state,
        payments: state.payments.map((p) =>
          p.id === action.id ? { ...p, paymentStatus: "paid" as const, paidAt: action.paidAt } : p
        ),
      };
    case "ADD_NOTE":
      return {
        ...state,
        payments: state.payments.map((p) =>
          p.id === action.id ? { ...p, notes: action.notes } : p
        ),
      };
    case "DELETE":
      return { ...state, payments: state.payments.filter((p) => p.id !== action.id) };
    default:
      return state;
  }
}

// ─── Context & Provider ───────────────────────────────────────────────────────

interface SeparatePaymentStore {
  payments: SeparatePaymentSlip[];
  ready: boolean;
  /** 批量添加补发单 */
  addPayments: (slips: SeparatePaymentSlip[]) => void;
  /** 标记为已付款 */
  markPaid: (id: string) => void;
  /** 添加备注 */
  addNote: (id: string, notes: string) => void;
  /** 删除补发单 */
  deletePayment: (id: string) => void;
  /** 获取某月的补发单 */
  getByMonth: (month: string) => SeparatePaymentSlip[];
  /** 获取某员工的补发单 */
  getByEmployee: (employeeId: string) => SeparatePaymentSlip[];
  /** 获取待付款的补发单 */
  getPending: () => SeparatePaymentSlip[];
  /** 获取汇总统计 */
  getSummary: () => { total: number; pending: number; paid: number; totalAmount: number; pendingAmount: number };
}

const SeparatePaymentContext = createContext<SeparatePaymentStore>({
  payments: [],
  ready: false,
  addPayments: () => {},
  markPaid: () => {},
  addNote: () => {},
  deletePayment: () => {},
  getByMonth: () => [],
  getByEmployee: () => [],
  getPending: () => [],
  getSummary: () => ({ total: 0, pending: 0, paid: 0, totalAmount: 0, pendingAmount: 0 }),
});

export function SeparatePaymentProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { payments: [], ready: false });

  // 加载持久化数据
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      dispatch({ type: "LOAD", payload: raw ? JSON.parse(raw) : [] });
    });
    return registerStoreReload(() => {
      AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
        dispatch({ type: "LOAD", payload: raw ? JSON.parse(raw) : [] });
      });
    });
  }, []);

  // 持久化
  const persist = useCallback((payments: SeparatePaymentSlip[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payments));
    notifySyncChange(STORAGE_KEY);
  }, []);

  const addPayments = useCallback((slips: SeparatePaymentSlip[]) => {
    dispatch({ type: "ADD", payload: slips });
    persist([...state.payments, ...slips]);
  }, [state.payments, persist]);

  const markPaid = useCallback((id: string) => {
    const paidAt = Date.now();
    dispatch({ type: "MARK_PAID", id, paidAt });
    persist(state.payments.map((p) => p.id === id ? { ...p, paymentStatus: "paid" as const, paidAt } : p));
  }, [state.payments, persist]);

  const addNote = useCallback((id: string, notes: string) => {
    dispatch({ type: "ADD_NOTE", id, notes });
    persist(state.payments.map((p) => p.id === id ? { ...p, notes } : p));
  }, [state.payments, persist]);

  const deletePayment = useCallback((id: string) => {
    dispatch({ type: "DELETE", id });
    persist(state.payments.filter((p) => p.id !== id));
  }, [state.payments, persist]);

  const getByMonth = useCallback((month: string) => {
    return state.payments.filter((p) => p.sourceMonth === month);
  }, [state.payments]);

  const getByEmployee = useCallback((employeeId: string) => {
    return state.payments.filter((p) => p.employeeId === employeeId);
  }, [state.payments]);

  const getPending = useCallback(() => {
    return state.payments.filter((p) => p.paymentStatus === "pending");
  }, [state.payments]);

  const getSummary = useCallback(() => {
    const total = state.payments.length;
    const pending = state.payments.filter((p) => p.paymentStatus === "pending").length;
    const paid = total - pending;
    const totalAmount = state.payments.reduce((sum, p) => sum + p.amount, 0);
    const pendingAmount = state.payments.filter((p) => p.paymentStatus === "pending").reduce((sum, p) => sum + p.amount, 0);
    return { total, pending, paid, totalAmount, pendingAmount };
  }, [state.payments]);

  return (
    <SeparatePaymentContext.Provider value={{
      payments: state.payments, ready: state.ready,
      addPayments, markPaid, addNote, deletePayment,
      getByMonth, getByEmployee, getPending, getSummary,
    }}>
      {children}
    </SeparatePaymentContext.Provider>
  );
}

export function useSeparatePaymentStore() { return useContext(SeparatePaymentContext); }
