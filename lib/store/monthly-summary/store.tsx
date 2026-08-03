/**
 * 月度总报表 Store
 * 管理：报表、供应商档案、付款记录、账户余额
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../../sync/engine";
import {
  MonthlySummaryReport, Supplier, MonthlyPaymentRecord, AccountBalance,
  PaymentStatus,
} from "./types";

const REPORTS_KEY = "monthly_summary.reports.v1";
const SUPPLIERS_KEY = "monthly_summary.suppliers.v1";
const PAYMENTS_KEY = "monthly_summary.payments.v1";
const BALANCES_KEY = "monthly_summary.balances.v1";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── State ────────────────────────────────────────────────────────────────────
interface SummaryState {
  reports: MonthlySummaryReport[];
  suppliers: Supplier[];
  payments: MonthlyPaymentRecord[];
  balances: AccountBalance[];
}

type Action =
  | { type: "LOAD"; payload: SummaryState }
  | { type: "UPSERT_REPORT"; report: MonthlySummaryReport }
  | { type: "DELETE_REPORT"; id: string }
  | { type: "ADD_SUPPLIER"; supplier: Supplier }
  | { type: "UPDATE_SUPPLIER"; id: string; updates: Partial<Supplier> }
  | { type: "DELETE_SUPPLIER"; id: string }
  | { type: "UPSERT_PAYMENT"; payment: MonthlyPaymentRecord }
  | { type: "DELETE_PAYMENT"; id: string }
  | { type: "UPSERT_BALANCE"; balance: AccountBalance }
  | { type: "DELETE_BALANCE"; id: string };

function reducer(state: SummaryState, action: Action): SummaryState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "UPSERT_REPORT": {
      const idx = state.reports.findIndex((r) => r.id === action.report.id);
      if (idx >= 0) {
        const next = [...state.reports];
        next[idx] = action.report;
        return { ...state, reports: next };
      }
      return { ...state, reports: [action.report, ...state.reports] };
    }
    case "DELETE_REPORT":
      return { ...state, reports: state.reports.filter((r) => r.id !== action.id) };
    case "ADD_SUPPLIER":
      return { ...state, suppliers: [action.supplier, ...state.suppliers] };
    case "UPDATE_SUPPLIER":
      return { ...state, suppliers: state.suppliers.map((s) => s.id === action.id ? { ...s, ...action.updates, updatedAt: new Date().toISOString() } : s) };
    case "DELETE_SUPPLIER":
      return { ...state, suppliers: state.suppliers.filter((s) => s.id !== action.id) };
    case "UPSERT_PAYMENT": {
      const idx = state.payments.findIndex((p) => p.id === action.payment.id);
      if (idx >= 0) {
        const next = [...state.payments];
        next[idx] = action.payment;
        return { ...state, payments: next };
      }
      return { ...state, payments: [action.payment, ...state.payments] };
    }
    case "DELETE_PAYMENT":
      return { ...state, payments: state.payments.filter((p) => p.id !== action.id) };
    case "UPSERT_BALANCE": {
      const idx = state.balances.findIndex((b) => b.id === action.balance.id);
      if (idx >= 0) {
        const next = [...state.balances];
        next[idx] = action.balance;
        return { ...state, balances: next };
      }
      return { ...state, balances: [action.balance, ...state.balances] };
    }
    case "DELETE_BALANCE":
      return { ...state, balances: state.balances.filter((b) => b.id !== action.id) };
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface SummaryContextValue extends SummaryState {
  // 报表
  upsertReport: (report: MonthlySummaryReport) => void;
  deleteReport: (id: string) => void;
  getReport: (month: string) => MonthlySummaryReport | undefined;
  // 供应商
  addSupplier: (data: Omit<Supplier, "id" | "createdAt" | "updatedAt">) => string;
  updateSupplier: (id: string, updates: Partial<Supplier>) => void;
  deleteSupplier: (id: string) => void;
  // 付款记录
  upsertPayment: (payment: MonthlyPaymentRecord) => void;
  deletePayment: (id: string) => void;
  getPaymentsForMonth: (month: string) => MonthlyPaymentRecord[];
  /** 添加一笔付款，自动更新已付/待付金额 */
  addPaymentEntry: (paymentId: string, entry: {
    date: string; amount: number; bankAccountId: string;
    paymentMethod: string; notes: string;
  }) => void;
  // 账户余额
  upsertBalance: (balance: AccountBalance) => void;
  deleteBalance: (id: string) => void;
  getBalancesForMonth: (month: string) => AccountBalance[];
}

const SummaryContext = createContext<SummaryContextValue | null>(null);

export function MonthlySummaryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    reports: [], suppliers: [], payments: [], balances: [],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [rRaw, sRaw, pRaw, bRaw] = await Promise.all([
          AsyncStorage.getItem(REPORTS_KEY),
          AsyncStorage.getItem(SUPPLIERS_KEY),
          AsyncStorage.getItem(PAYMENTS_KEY),
          AsyncStorage.getItem(BALANCES_KEY),
        ]);
        dispatch({
          type: "LOAD",
          payload: {
            reports: rRaw ? JSON.parse(rRaw) : [],
            suppliers: sRaw ? JSON.parse(sRaw) : [],
            payments: pRaw ? JSON.parse(pRaw) : [],
            balances: bRaw ? JSON.parse(bRaw) : [],
          },
        });
      } catch {}
    };
    load();
    registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(state.reports)).catch(() => {});
    AsyncStorage.setItem(SUPPLIERS_KEY, JSON.stringify(state.suppliers)).catch(() => {});
    AsyncStorage.setItem(PAYMENTS_KEY, JSON.stringify(state.payments)).catch(() => {});
    AsyncStorage.setItem(BALANCES_KEY, JSON.stringify(state.balances)).catch(() => {});
    // ★ 四个键全部通知同步引擎
    notifySyncChange(REPORTS_KEY);
    notifySyncChange(SUPPLIERS_KEY);
    notifySyncChange(PAYMENTS_KEY);
    notifySyncChange(BALANCES_KEY);
  }, [state]);

  const upsertReport = useCallback((report: MonthlySummaryReport) =>
    dispatch({ type: "UPSERT_REPORT", report }), []);
  const deleteReport = useCallback((id: string) => dispatch({ type: "DELETE_REPORT", id }), []);
  const getReport = useCallback((month: string) =>
    state.reports.find((r) => r.month === month), [state.reports]);

  const addSupplier = useCallback((data: Omit<Supplier, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatch({ type: "ADD_SUPPLIER", supplier: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);
  const updateSupplier = useCallback((id: string, updates: Partial<Supplier>) =>
    dispatch({ type: "UPDATE_SUPPLIER", id, updates }), []);
  const deleteSupplier = useCallback((id: string) => dispatch({ type: "DELETE_SUPPLIER", id }), []);

  const upsertPayment = useCallback((payment: MonthlyPaymentRecord) =>
    dispatch({ type: "UPSERT_PAYMENT", payment }), []);
  const deletePayment = useCallback((id: string) => dispatch({ type: "DELETE_PAYMENT", id }), []);
  const getPaymentsForMonth = useCallback((month: string) =>
    state.payments.filter((p) => p.month === month), [state.payments]);

  const addPaymentEntry = useCallback((paymentId: string, entry: {
    date: string; amount: number; bankAccountId: string;
    paymentMethod: string; notes: string;
  }) => {
    const payment = state.payments.find((p) => p.id === paymentId);
    if (!payment) return;
    const newEntry = { ...entry, id: uuid(), paidAt: new Date().toISOString() };
    const newPaid = payment.paidAmount + entry.amount;
    const newRemaining = Math.max(0, payment.totalAmount - newPaid);
    const newStatus: PaymentStatus = newRemaining <= 0 ? "paid" : newPaid > 0 ? "partial" : "unpaid";
    dispatch({
      type: "UPSERT_PAYMENT",
      payment: {
        ...payment,
        payments: [...payment.payments, newEntry],
        paidAmount: newPaid,
        remainingAmount: newRemaining,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      },
    });
  }, [state.payments]);

  const upsertBalance = useCallback((balance: AccountBalance) =>
    dispatch({ type: "UPSERT_BALANCE", balance }), []);
  const deleteBalance = useCallback((id: string) => dispatch({ type: "DELETE_BALANCE", id }), []);
  const getBalancesForMonth = useCallback((month: string) =>
    state.balances.filter((b) => b.month === month), [state.balances]);

  return (
    <SummaryContext.Provider value={{
      ...state,
      upsertReport, deleteReport, getReport,
      addSupplier, updateSupplier, deleteSupplier,
      upsertPayment, deletePayment, getPaymentsForMonth, addPaymentEntry,
      upsertBalance, deleteBalance, getBalancesForMonth,
    }}>
      {children}
    </SummaryContext.Provider>
  );
}

export function useMonthlySummaryStore(): SummaryContextValue {
  const ctx = useContext(SummaryContext);
  if (!ctx) throw new Error("useMonthlySummaryStore must be used within MonthlySummaryProvider");
  return ctx;
}
