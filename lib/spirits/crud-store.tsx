/**
 * 烈酒进销存 CRUD Store（新版）
 * 支持：手动增删改酒款、月份切换、进货流水录入、Excel 导入、台账月结
 */
import React, { createContext, useContext, useEffect, useReducer } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SpiritItem, SpiritPurchaseRecord, SpiritLedgerEntry } from "./types";

const ITEMS_KEY = "spirits.items.v2";
const PURCHASES_KEY = "spirits.purchases.v2";
const LEDGER_KEY = "spirits.ledger.v2";

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// ─── State 定义 ───────────────────────────────────────────────────────────────
interface SpiritsState {
  items: SpiritItem[];
  purchases: SpiritPurchaseRecord[];
  ledger: SpiritLedgerEntry[];
}

const initial: SpiritsState = { items: [], purchases: [], ledger: [] };

type Action =
  | { type: "LOAD"; payload: SpiritsState }
  // 酒款档案
  | { type: "ADD_ITEM"; item: SpiritItem }
  | { type: "UPDATE_ITEM"; id: string; patch: Partial<SpiritItem> }
  | { type: "DELETE_ITEM"; id: string }
  // 进货流水
  | { type: "ADD_PURCHASE"; record: SpiritPurchaseRecord }
  | { type: "UPDATE_PURCHASE"; id: string; patch: Partial<SpiritPurchaseRecord> }
  | { type: "DELETE_PURCHASE"; id: string }
  | { type: "BATCH_ADD_PURCHASES"; records: SpiritPurchaseRecord[] }
  // 台账
  | { type: "UPSERT_LEDGER"; entry: SpiritLedgerEntry }
  | { type: "DELETE_LEDGER"; id: string };

function reducer(state: SpiritsState, action: Action): SpiritsState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_ITEM": return { ...state, items: [...state.items, action.item] };
    case "UPDATE_ITEM": return {
      ...state,
      items: state.items.map((i) => i.id === action.id ? { ...i, ...action.patch, updatedAt: new Date().toISOString() } : i),
    };
    case "DELETE_ITEM": return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "ADD_PURCHASE": return { ...state, purchases: [...state.purchases, action.record] };
    case "UPDATE_PURCHASE": return {
      ...state,
      purchases: state.purchases.map((p) => p.id === action.id ? { ...p, ...action.patch } : p),
    };
    case "DELETE_PURCHASE": return { ...state, purchases: state.purchases.filter((p) => p.id !== action.id) };
    case "BATCH_ADD_PURCHASES": return { ...state, purchases: [...state.purchases, ...action.records] };
    case "UPSERT_LEDGER": {
      const idx = state.ledger.findIndex((e) => e.id === action.entry.id);
      if (idx >= 0) {
        const next = [...state.ledger];
        next[idx] = action.entry;
        return { ...state, ledger: next };
      }
      return { ...state, ledger: [...state.ledger, action.entry] };
    }
    case "DELETE_LEDGER": return { ...state, ledger: state.ledger.filter((e) => e.id !== action.id) };
    default: return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface SpiritsContextValue extends SpiritsState {
  // 酒款档案
  addItem: (data: Omit<SpiritItem, "id" | "createdAt" | "updatedAt">) => SpiritItem;
  updateItem: (id: string, patch: Partial<SpiritItem>) => void;
  deleteItem: (id: string) => void;
  // 进货流水
  addPurchase: (data: Omit<SpiritPurchaseRecord, "id" | "createdAt">) => void;
  updatePurchase: (id: string, patch: Partial<SpiritPurchaseRecord>) => void;
  deletePurchase: (id: string) => void;
  batchAddPurchases: (records: Omit<SpiritPurchaseRecord, "id" | "createdAt">[]) => void;
  // 台账
  upsertLedger: (entry: Omit<SpiritLedgerEntry, "id" | "updatedAt"> & { id?: string }) => void;
  deleteLedger: (id: string) => void;
  // 查询
  getMonthPurchases: (month: string) => SpiritPurchaseRecord[];
  getMonthLedger: (month: string) => SpiritLedgerEntry[];
  getItemLedger: (itemId: string, month: string) => SpiritLedgerEntry | undefined;
  getAvailableMonths: () => string[];
  // 月结：将本月期末带入下月期初
  closeMonth: (month: string) => void;
  // 从进货流水自动更新台账进货数据
  syncLedgerFromPurchases: (month: string) => void;
}

const SpiritsContext = createContext<SpiritsContextValue | null>(null);

export function SpiritsInventoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(ITEMS_KEY),
      AsyncStorage.getItem(PURCHASES_KEY),
      AsyncStorage.getItem(LEDGER_KEY),
    ]).then(([itemsRaw, purchasesRaw, ledgerRaw]) => {
      const items = itemsRaw ? JSON.parse(itemsRaw) : [];
      const purchases = purchasesRaw ? JSON.parse(purchasesRaw) : [];
      const ledger = ledgerRaw ? JSON.parse(ledgerRaw) : [];
      dispatch({ type: "LOAD", payload: { items, purchases, ledger } });
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(state.items));
    AsyncStorage.setItem(PURCHASES_KEY, JSON.stringify(state.purchases));
    AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(state.ledger));
  }, [state]);

  const addItem = (data: Omit<SpiritItem, "id" | "createdAt" | "updatedAt">): SpiritItem => {
    const now = new Date().toISOString();
    const item: SpiritItem = { ...data, id: uuid(), createdAt: now, updatedAt: now };
    dispatch({ type: "ADD_ITEM", item });
    return item;
  };

  const updateItem = (id: string, patch: Partial<SpiritItem>) => {
    dispatch({ type: "UPDATE_ITEM", id, patch });
  };

  const deleteItem = (id: string) => {
    dispatch({ type: "DELETE_ITEM", id });
  };

  const addPurchase = (data: Omit<SpiritPurchaseRecord, "id" | "createdAt">) => {
    const record: SpiritPurchaseRecord = { ...data, id: uuid(), createdAt: new Date().toISOString() };
    dispatch({ type: "ADD_PURCHASE", record });
  };

  const updatePurchase = (id: string, patch: Partial<SpiritPurchaseRecord>) => {
    dispatch({ type: "UPDATE_PURCHASE", id, patch });
  };

  const deletePurchase = (id: string) => {
    dispatch({ type: "DELETE_PURCHASE", id });
  };

  const batchAddPurchases = (records: Omit<SpiritPurchaseRecord, "id" | "createdAt">[]) => {
    const now = new Date().toISOString();
    const full = records.map((r) => ({ ...r, id: uuid(), createdAt: now }));
    dispatch({ type: "BATCH_ADD_PURCHASES", records: full });
  };

  const upsertLedger = (entry: Omit<SpiritLedgerEntry, "id" | "updatedAt"> & { id?: string }) => {
    const full: SpiritLedgerEntry = {
      ...entry,
      id: entry.id ?? uuid(),
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: "UPSERT_LEDGER", entry: full });
  };

  const deleteLedger = (id: string) => {
    dispatch({ type: "DELETE_LEDGER", id });
  };

  const getMonthPurchases = (month: string) =>
    state.purchases.filter((p) => p.month === month);

  const getMonthLedger = (month: string) =>
    state.ledger.filter((e) => e.month === month);

  const getItemLedger = (itemId: string, month: string) =>
    state.ledger.find((e) => e.itemId === itemId && e.month === month);

  const getAvailableMonths = (): string[] => {
    const months = new Set<string>();
    state.purchases.forEach((p) => months.add(p.month));
    state.ledger.forEach((e) => months.add(e.month));
    // Always include current month
    months.add(getCurrentMonth());
    return [...months].sort().reverse();
  };

  const syncLedgerFromPurchases = (month: string) => {
    const monthPurchases = state.purchases.filter((p) => p.month === month);
    // Group by itemId
    const byItem: Record<string, SpiritPurchaseRecord[]> = {};
    monthPurchases.forEach((p) => {
      const key = p.itemId ?? `raw:${p.rawName}`;
      if (!byItem[key]) byItem[key] = [];
      byItem[key].push(p);
    });
    Object.entries(byItem).forEach(([key, records]) => {
      if (!key.startsWith("raw:")) {
        const itemId = key;
        const purchaseQty = records.reduce((s, r) => s + r.quantity, 0);
        const purchaseCost = records.reduce((s, r) => s + r.amount, 0);
        const existing = state.ledger.find((e) => e.itemId === itemId && e.month === month);
        const avgUnitCost = purchaseQty > 0 ? purchaseCost / purchaseQty : 0;
        const openingQty = existing?.openingQty ?? 0;
        const openingUnitCost = existing?.openingUnitCost ?? avgUnitCost;
        const consumeQty = existing?.consumeQty ?? 0;
        const closingQty = openingQty + purchaseQty - consumeQty;
        const closingUnitCost = avgUnitCost > 0 ? avgUnitCost : openingUnitCost;
        upsertLedger({
          id: existing?.id,
          month,
          itemId,
          openingQty,
          openingUnitCost,
          purchaseQty,
          purchaseCost,
          consumeQty,
          closingQty,
          closingUnitCost,
          closingCost: closingQty * closingUnitCost,
          isClosed: existing?.isClosed ?? false,
        });
      }
    });
  };

  const closeMonth = (month: string) => {
    // Calculate next month
    const [y, m] = month.split("-").map(Number);
    const nextDate = new Date(y, m, 1); // m is already 1-based, so this gives next month
    const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;

    const monthLedger = state.ledger.filter((e) => e.month === month);
    monthLedger.forEach((entry) => {
      // Mark current month as closed
      upsertLedger({ ...entry, isClosed: true });
      // Create or update next month's opening stock from this month's closing
      const nextExisting = state.ledger.find((e) => e.itemId === entry.itemId && e.month === nextMonth);
      upsertLedger({
        id: nextExisting?.id,
        month: nextMonth,
        itemId: entry.itemId,
        openingQty: entry.closingQty,
        openingUnitCost: entry.closingUnitCost,
        purchaseQty: nextExisting?.purchaseQty ?? 0,
        purchaseCost: nextExisting?.purchaseCost ?? 0,
        consumeQty: nextExisting?.consumeQty ?? 0,
        closingQty: entry.closingQty + (nextExisting?.purchaseQty ?? 0) - (nextExisting?.consumeQty ?? 0),
        closingUnitCost: entry.closingUnitCost,
        closingCost: (entry.closingQty + (nextExisting?.purchaseQty ?? 0) - (nextExisting?.consumeQty ?? 0)) * entry.closingUnitCost,
        isClosed: false,
      });
    });
  };

  return (
    <SpiritsContext.Provider value={{
      ...state,
      addItem, updateItem, deleteItem,
      addPurchase, updatePurchase, deletePurchase, batchAddPurchases,
      upsertLedger, deleteLedger,
      getMonthPurchases, getMonthLedger, getItemLedger,
      getAvailableMonths, closeMonth, syncLedgerFromPurchases,
    }}>
      {children}
    </SpiritsContext.Provider>
  );
}

export function useSpiritsInventoryStore() {
  const ctx = useContext(SpiritsContext);
  if (!ctx) throw new Error("useSpiritsInventoryStore must be used within SpiritsInventoryProvider");
  return ctx;
}
