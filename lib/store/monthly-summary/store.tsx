/**
 * 月度总报表 Store (Build 134)
 * 管理：报表、供应商档案、付款记录、账户余额、备用金分类配置、库存模块配置
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../../sync/engine";
import {
  MonthlySummaryReport, Supplier, MonthlyPaymentRecord, AccountBalance,
  PaymentStatus, PettyCodeConfig, InventoryReportConfig,
  DEFAULT_PETTY_CODE_CONFIGS, DEFAULT_INVENTORY_CONFIGS,
} from "./types";

const REPORTS_KEY      = "monthly_summary.reports.v1";
const SUPPLIERS_KEY    = "monthly_summary.suppliers.v1";
const PAYMENTS_KEY     = "monthly_summary.payments.v1";
const BALANCES_KEY     = "monthly_summary.balances.v1";
const PETTY_CFG_KEY    = "monthly_summary.petty_configs.v1";
const INVENTORY_CFG_KEY = "monthly_summary.inventory_configs.v1";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── State ────────────────────────────────────────────────────────────────────
interface SummaryState {
  reports: MonthlySummaryReport[];
  suppliers: Supplier[];
  payments: MonthlyPaymentRecord[];
  balances: AccountBalance[];
  /** 备用金分类配置（用户可修改，默认值来自 DEFAULT_PETTY_CODE_CONFIGS） */
  pettyCodeConfigs: PettyCodeConfig[];
  /** 库存模块月报配置（用户可修改，默认值来自 DEFAULT_INVENTORY_CONFIGS） */
  inventoryConfigs: InventoryReportConfig[];
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
  | { type: "DELETE_BALANCE"; id: string }
  | { type: "UPSERT_PETTY_CODE_CONFIG"; config: PettyCodeConfig }
  | { type: "DELETE_PETTY_CODE_CONFIG"; code: string }
  | { type: "RESET_PETTY_CODE_CONFIGS" }
  | { type: "UPSERT_INVENTORY_CONFIG"; config: InventoryReportConfig }
  | { type: "RESET_INVENTORY_CONFIGS" };

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

    case "UPSERT_PETTY_CODE_CONFIG": {
      const idx = state.pettyCodeConfigs.findIndex((c) => c.code === action.config.code);
      if (idx >= 0) {
        const next = [...state.pettyCodeConfigs];
        next[idx] = action.config;
        return { ...state, pettyCodeConfigs: next };
      }
      return { ...state, pettyCodeConfigs: [...state.pettyCodeConfigs, action.config] };
    }
    case "DELETE_PETTY_CODE_CONFIG":
      return { ...state, pettyCodeConfigs: state.pettyCodeConfigs.filter((c) => c.code !== action.code) };
    case "RESET_PETTY_CODE_CONFIGS":
      return { ...state, pettyCodeConfigs: [...DEFAULT_PETTY_CODE_CONFIGS] };

    case "UPSERT_INVENTORY_CONFIG": {
      const idx = state.inventoryConfigs.findIndex((c) => c.module === action.config.module);
      if (idx >= 0) {
        const next = [...state.inventoryConfigs];
        next[idx] = action.config;
        return { ...state, inventoryConfigs: next };
      }
      return { ...state, inventoryConfigs: [...state.inventoryConfigs, action.config] };
    }
    case "RESET_INVENTORY_CONFIGS":
      return { ...state, inventoryConfigs: [...DEFAULT_INVENTORY_CONFIGS] };

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
  /** 添加一笔付款，自动更新已付/待付金额和状态 */
  addPaymentEntry: (paymentId: string, entry: {
    date: string; amount: number; bankAccountId: string;
    paymentMethod: string; accountType?: "company" | "personal" | "petty" | "pos"; notes: string;
  }) => void;
  // 账户余额
  upsertBalance: (balance: AccountBalance) => void;
  deleteBalance: (id: string) => void;
  getBalancesForMonth: (month: string) => AccountBalance[];
  // 备用金分类配置
  upsertPettyCodeConfig: (config: PettyCodeConfig) => void;
  deletePettyCodeConfig: (code: string) => void;
  resetPettyCodeConfigs: () => void;
  /** 获取某个分类的配置（优先用户配置，回退默认配置） */
  getPettyCodeConfig: (code: string) => PettyCodeConfig | undefined;
  // 库存模块配置
  upsertInventoryConfig: (config: InventoryReportConfig) => void;
  resetInventoryConfigs: () => void;
  /** 获取某个库存模块的配置（优先用户配置，回退默认配置） */
  getInventoryConfig: (module: string) => InventoryReportConfig | undefined;
}

const SummaryContext = createContext<SummaryContextValue | null>(null);

export function MonthlySummaryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    reports: [], suppliers: [], payments: [], balances: [],
    pettyCodeConfigs: [...DEFAULT_PETTY_CODE_CONFIGS],
    inventoryConfigs: [...DEFAULT_INVENTORY_CONFIGS],
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [rRaw, sRaw, pRaw, bRaw, pcRaw, icRaw] = await Promise.all([
          AsyncStorage.getItem(REPORTS_KEY),
          AsyncStorage.getItem(SUPPLIERS_KEY),
          AsyncStorage.getItem(PAYMENTS_KEY),
          AsyncStorage.getItem(BALANCES_KEY),
          AsyncStorage.getItem(PETTY_CFG_KEY),
          AsyncStorage.getItem(INVENTORY_CFG_KEY),
        ]);
        dispatch({
          type: "LOAD",
          payload: {
            reports:           rRaw  ? JSON.parse(rRaw)  : [],
            suppliers:         sRaw  ? JSON.parse(sRaw)  : [],
            payments:          pRaw  ? JSON.parse(pRaw)  : [],
            balances:          bRaw  ? JSON.parse(bRaw)  : [],
            pettyCodeConfigs:  pcRaw ? JSON.parse(pcRaw) : [...DEFAULT_PETTY_CODE_CONFIGS],
            inventoryConfigs:  icRaw ? JSON.parse(icRaw) : [...DEFAULT_INVENTORY_CONFIGS],
          },
        });
      } catch {}
    };
    load();
    registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(REPORTS_KEY,       JSON.stringify(state.reports)).catch(() => {});
    AsyncStorage.setItem(SUPPLIERS_KEY,     JSON.stringify(state.suppliers)).catch(() => {});
    AsyncStorage.setItem(PAYMENTS_KEY,      JSON.stringify(state.payments)).catch(() => {});
    AsyncStorage.setItem(BALANCES_KEY,      JSON.stringify(state.balances)).catch(() => {});
    AsyncStorage.setItem(PETTY_CFG_KEY,     JSON.stringify(state.pettyCodeConfigs)).catch(() => {});
    AsyncStorage.setItem(INVENTORY_CFG_KEY, JSON.stringify(state.inventoryConfigs)).catch(() => {});
    notifySyncChange(REPORTS_KEY);
    notifySyncChange(SUPPLIERS_KEY);
    notifySyncChange(PAYMENTS_KEY);
    notifySyncChange(BALANCES_KEY);
    notifySyncChange(PETTY_CFG_KEY);
    notifySyncChange(INVENTORY_CFG_KEY);
  }, [state]);

  // ── 报表 ──
  const upsertReport = useCallback((report: MonthlySummaryReport) =>
    dispatch({ type: "UPSERT_REPORT", report }), []);
  const deleteReport = useCallback((id: string) =>
    dispatch({ type: "DELETE_REPORT", id }), []);
  const getReport = useCallback((month: string) =>
    state.reports.find((r) => r.month === month), [state.reports]);

  // ── 供应商 ──
  const addSupplier = useCallback((data: Omit<Supplier, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatch({ type: "ADD_SUPPLIER", supplier: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);
  const updateSupplier = useCallback((id: string, updates: Partial<Supplier>) =>
    dispatch({ type: "UPDATE_SUPPLIER", id, updates }), []);
  const deleteSupplier = useCallback((id: string) =>
    dispatch({ type: "DELETE_SUPPLIER", id }), []);

  // ── 付款记录 ──
  const upsertPayment = useCallback((payment: MonthlyPaymentRecord) =>
    dispatch({ type: "UPSERT_PAYMENT", payment }), []);
  const deletePayment = useCallback((id: string) =>
    dispatch({ type: "DELETE_PAYMENT", id }), []);
  const getPaymentsForMonth = useCallback((month: string) =>
    state.payments.filter((p) => p.month === month), [state.payments]);

  const addPaymentEntry = useCallback((paymentId: string, entry: {
    date: string; amount: number; bankAccountId: string;
    paymentMethod: string; accountType?: "company" | "personal" | "petty" | "pos"; notes: string;
  }) => {
    const payment = state.payments.find((p) => p.id === paymentId);
    if (!payment) return;
    const newEntry = { ...entry, id: uuid(), paidAt: new Date().toISOString() };
    const newPaid = payment.paidAmount + entry.amount;
    const advAmt = payment.advanceAmount ?? 0;
    const newRemaining = Math.max(0, payment.totalAmount - advAmt - newPaid);
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

  // ── 账户余额 ──
  const upsertBalance = useCallback((balance: AccountBalance) =>
    dispatch({ type: "UPSERT_BALANCE", balance }), []);
  const deleteBalance = useCallback((id: string) =>
    dispatch({ type: "DELETE_BALANCE", id }), []);
  const getBalancesForMonth = useCallback((month: string) =>
    state.balances.filter((b) => b.month === month), [state.balances]);

  // ── 备用金分类配置 ──
  const upsertPettyCodeConfig = useCallback((config: PettyCodeConfig) =>
    dispatch({ type: "UPSERT_PETTY_CODE_CONFIG", config }), []);
  const deletePettyCodeConfig = useCallback((code: string) =>
    dispatch({ type: "DELETE_PETTY_CODE_CONFIG", code }), []);
  const resetPettyCodeConfigs = useCallback(() =>
    dispatch({ type: "RESET_PETTY_CODE_CONFIGS" }), []);
  const getPettyCodeConfig = useCallback((code: string): PettyCodeConfig | undefined => {
    // 优先用户配置，回退默认配置
    return state.pettyCodeConfigs.find((c) => c.code === code)
      ?? DEFAULT_PETTY_CODE_CONFIGS.find((c) => c.code === code);
  }, [state.pettyCodeConfigs]);

  // ── 库存模块配置 ──
  const upsertInventoryConfig = useCallback((config: InventoryReportConfig) =>
    dispatch({ type: "UPSERT_INVENTORY_CONFIG", config }), []);
  const resetInventoryConfigs = useCallback(() =>
    dispatch({ type: "RESET_INVENTORY_CONFIGS" }), []);
  const getInventoryConfig = useCallback((module: string): InventoryReportConfig | undefined => {
    return state.inventoryConfigs.find((c) => c.module === module)
      ?? DEFAULT_INVENTORY_CONFIGS.find((c) => c.module === module);
  }, [state.inventoryConfigs]);

  return (
    <SummaryContext.Provider value={{
      ...state,
      upsertReport, deleteReport, getReport,
      addSupplier, updateSupplier, deleteSupplier,
      upsertPayment, deletePayment, getPaymentsForMonth, addPaymentEntry,
      upsertBalance, deleteBalance, getBalancesForMonth,
      upsertPettyCodeConfig, deletePettyCodeConfig, resetPettyCodeConfigs, getPettyCodeConfig,
      upsertInventoryConfig, resetInventoryConfigs, getInventoryConfig,
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
