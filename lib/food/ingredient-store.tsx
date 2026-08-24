import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer, useState } from "react";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { multiplyMoney, roundMoney, sumMoney } from "@/lib/finance/money";
import {
  FoodIngredient,
  FoodLedgerMovement,
  FoodMonthlyLedgerEntry,
  PriceHistoryEntry,
  SupplierPurchaseRecord,
} from "./types";

const STORAGE_KEY = "food.ingredients.v2";
const PURCHASE_KEY = "food.purchases.v1";

export interface FoodIngredientState {
  ingredients: FoodIngredient[];
  /** 每个 ingredient 的价格历史，key=ingredientId。 */
  priceHistory: Record<string, PriceHistoryEntry[]>;
  /** 月度期初、采购汇总、消耗汇总和实盘结果。 */
  ledgerEntries: FoodMonthlyLedgerEntry[];
  /** 月度台账的原子流水，用于审计采购、消耗和盘点来源。 */
  ledgerMovements: FoodLedgerMovement[];
}

export interface FoodMonthlyLedgerRow extends FoodMonthlyLedgerEntry {
  name: string;
  nameEn?: string;
  category: FoodIngredient["category"];
  spec: string;
  unit: string;
  closingQty: number;
  closingUnitCost: number;
  closingCost: number;
}

export interface FoodPurchaseInput {
  ingredientId: string;
  quantity: number;
  unitPrice: number;
  date: string;
  supplier: string;
  notes?: string;
  source?: PriceHistoryEntry["source"];
}

export interface FoodConsumeInput {
  ingredientId: string;
  quantity: number;
  date: string;
  unitCost?: number;
  notes?: string;
}

export interface FoodStocktakeInput {
  ingredientId: string;
  actualClosingQty: number;
  date: string;
  unitCost?: number;
  notes?: string;
}

export interface PurchaseState {
  records: SupplierPurchaseRecord[];
}

function monthFromDate(date: string) {
  return /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : new Date().toISOString().slice(0, 7);
}

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function weightedUnitCost(entry: Pick<FoodMonthlyLedgerEntry, "openingQty" | "openingUnitCost" | "purchaseQty" | "purchaseCost">) {
  const totalQty = entry.openingQty + entry.purchaseQty;
  if (totalQty <= 0) return entry.openingUnitCost;
  return roundMoney(sumMoney([multiplyMoney(entry.openingQty, entry.openingUnitCost), entry.purchaseCost]) / totalQty);
}

function theoreticalClosingQty(entry: Pick<FoodMonthlyLedgerEntry, "openingQty" | "purchaseQty" | "consumeQty">) {
  return Math.max(0, entry.openingQty + entry.purchaseQty - entry.consumeQty);
}

function entryClosing(entry: FoodMonthlyLedgerEntry) {
  const closingUnitCost = entry.actualClosingUnitCost ?? weightedUnitCost(entry);
  const closingQty = entry.actualClosingQty ?? theoreticalClosingQty(entry);
  return { closingQty, closingUnitCost, closingCost: multiplyMoney(closingQty, closingUnitCost) };
}

export function sanitizeFoodIngredientState(raw: unknown): FoodIngredientState {
  const source = Array.isArray(raw)
    ? { ingredients: raw }
    : raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};
  const ingredients = Array.isArray(source.ingredients) ? source.ingredients : [];
  return {
    ingredients: ingredients
      .filter((ingredient): ingredient is FoodIngredient => Boolean(ingredient) && typeof ingredient === "object"),
    priceHistory: source.priceHistory && typeof source.priceHistory === "object"
      ? source.priceHistory as Record<string, PriceHistoryEntry[]>
      : {},
    ledgerEntries: Array.isArray(source.ledgerEntries)
      ? source.ledgerEntries.filter((entry): entry is FoodMonthlyLedgerEntry => Boolean(entry) && typeof entry === "object")
      : [],
    ledgerMovements: Array.isArray(source.ledgerMovements)
      ? source.ledgerMovements.filter((movement): movement is FoodLedgerMovement => Boolean(movement) && typeof movement === "object")
      : [],
  };
}

function lastClosedEntry(entries: FoodMonthlyLedgerEntry[], ingredientId: string, month: string) {
  return entries
    .filter((entry) => entry.ingredientId === ingredientId && entry.month < month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
}

function createLedgerEntry(state: FoodIngredientState, ingredientId: string, month: string, now: string): FoodMonthlyLedgerEntry {
  const ingredient = state.ingredients.find((item) => item.id === ingredientId);
  const previous = lastClosedEntry(state.ledgerEntries, ingredientId, month);
  const previousClosing = previous ? entryClosing(previous) : undefined;
  return {
    id: `food-ledger-${uuid()}`,
    month,
    ingredientId,
    openingQty: previousClosing?.closingQty ?? ingredient?.stock ?? 0,
    openingUnitCost: previousClosing?.closingUnitCost ?? ingredient?.costPrice ?? 0,
    purchaseQty: 0,
    purchaseCost: 0,
    consumeQty: 0,
    consumeCost: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function withLedgerEntry(
  state: FoodIngredientState,
  ingredientId: string,
  month: string,
  now: string,
  update: (entry: FoodMonthlyLedgerEntry) => FoodMonthlyLedgerEntry,
) {
  const existing = state.ledgerEntries.find((entry) => entry.ingredientId === ingredientId && entry.month === month);
  const base = existing ?? createLedgerEntry(state, ingredientId, month, now);
  const next = update(base);
  return {
    ...state,
    ledgerEntries: existing
      ? state.ledgerEntries.map((entry) => entry.id === existing.id ? next : entry)
      : [...state.ledgerEntries, next],
  };
}

function appendPriceHistory(
  state: FoodIngredientState,
  ingredientId: string,
  entry: PriceHistoryEntry,
) {
  const existing = state.priceHistory[ingredientId] ?? [];
  if (existing.some((history) => history.date === entry.date && history.price === entry.price && history.supplier === entry.supplier)) {
    return state.priceHistory;
  }
  return { ...state.priceHistory, [ingredientId]: [entry, ...existing].slice(0, 50) };
}

function applyPurchase(state: FoodIngredientState, input: FoodPurchaseInput): FoodIngredientState {
  const ingredient = state.ingredients.find((item) => item.id === input.ingredientId);
  if (!ingredient || input.quantity <= 0) return state;
  const now = new Date().toISOString();
  const date = input.date || now.slice(0, 10);
  const month = monthFromDate(date);
  const unitPrice = Math.max(0, input.unitPrice || ingredient.costPrice || 0);
  const totalCost = multiplyMoney(input.quantity, unitPrice);
  const priceEntry: PriceHistoryEntry = { price: unitPrice, date, supplier: input.supplier || ingredient.supplier, source: input.source ?? "manual" };
  const priceHistory = appendPriceHistory(state, ingredient.id, priceEntry);
  const nextIngredient = {
    ...ingredient,
    stock: Math.max(0, ingredient.stock + input.quantity),
    costPrice: unitPrice || ingredient.costPrice,
    supplier: input.supplier || ingredient.supplier,
    priceHistory: priceHistory[ingredient.id] ?? ingredient.priceHistory,
    updatedAt: now,
  };
  const withEntry = withLedgerEntry({ ...state, priceHistory }, ingredient.id, month, now, (entry) => ({
    ...entry,
    purchaseQty: entry.purchaseQty + input.quantity,
    purchaseCost: sumMoney([entry.purchaseCost, totalCost]),
    actualClosingQty: undefined,
    actualClosingUnitCost: undefined,
    updatedAt: now,
  }));
  return {
    ...withEntry,
    ingredients: state.ingredients.map((item) => item.id === ingredient.id ? nextIngredient : item),
    priceHistory,
    ledgerMovements: [{
      id: `food-movement-${uuid()}`,
      month,
      ingredientId: ingredient.id,
      kind: "purchase",
      date,
      quantity: input.quantity,
      unitCost: unitPrice,
      totalCost,
      supplier: input.supplier || ingredient.supplier,
      notes: input.notes ?? "",
      createdAt: now,
    }, ...withEntry.ledgerMovements],
  };
}

function applyConsume(state: FoodIngredientState, input: FoodConsumeInput): FoodIngredientState {
  const ingredient = state.ingredients.find((item) => item.id === input.ingredientId);
  if (!ingredient || input.quantity <= 0) return state;
  const now = new Date().toISOString();
  const date = input.date || now.slice(0, 10);
  const month = monthFromDate(date);
  const currentEntry = state.ledgerEntries.find((entry) => entry.ingredientId === ingredient.id && entry.month === month);
  const unitCost = Math.max(0, input.unitCost ?? (currentEntry ? weightedUnitCost(currentEntry) : ingredient.costPrice ?? 0));
  const totalCost = multiplyMoney(input.quantity, unitCost);
  const withEntry = withLedgerEntry(state, ingredient.id, month, now, (entry) => ({
    ...entry,
    consumeQty: entry.consumeQty + input.quantity,
    consumeCost: sumMoney([entry.consumeCost, totalCost]),
    actualClosingQty: undefined,
    actualClosingUnitCost: undefined,
    updatedAt: now,
  }));
  return {
    ...withEntry,
    ingredients: state.ingredients.map((item) => item.id === ingredient.id
      ? { ...item, stock: Math.max(0, item.stock - input.quantity), updatedAt: now }
      : item),
    ledgerMovements: [{
      id: `food-movement-${uuid()}`,
      month,
      ingredientId: ingredient.id,
      kind: "consume",
      date,
      quantity: input.quantity,
      unitCost,
      totalCost,
      notes: input.notes ?? "",
      createdAt: now,
    }, ...withEntry.ledgerMovements],
  };
}

function applyStocktake(state: FoodIngredientState, input: FoodStocktakeInput): FoodIngredientState {
  const ingredient = state.ingredients.find((item) => item.id === input.ingredientId);
  if (!ingredient || input.actualClosingQty < 0) return state;
  const now = new Date().toISOString();
  const date = input.date || now.slice(0, 10);
  const month = monthFromDate(date);
  const currentEntry = state.ledgerEntries.find((entry) => entry.ingredientId === ingredient.id && entry.month === month);
  const unitCost = Math.max(0, input.unitCost ?? (currentEntry ? weightedUnitCost(currentEntry) : ingredient.costPrice ?? 0));
  const withEntry = withLedgerEntry(state, ingredient.id, month, now, (entry) => ({
    ...entry,
    actualClosingQty: input.actualClosingQty,
    actualClosingUnitCost: unitCost,
    updatedAt: now,
  }));
  return {
    ...withEntry,
    ingredients: state.ingredients.map((item) => item.id === ingredient.id
      ? { ...item, stock: input.actualClosingQty, costPrice: unitCost || item.costPrice, updatedAt: now }
      : item),
    ledgerMovements: [{
      id: `food-movement-${uuid()}`,
      month,
      ingredientId: ingredient.id,
      kind: "stocktake",
      date,
      quantity: input.actualClosingQty,
      unitCost,
      totalCost: multiplyMoney(input.actualClosingQty, unitCost),
      notes: input.notes ?? "",
      createdAt: now,
    }, ...withEntry.ledgerMovements],
  };
}

export function buildFoodMonthlyLedger(state: FoodIngredientState, month: string): FoodMonthlyLedgerRow[] {
  return state.ingredients.map((ingredient) => {
    const entry = state.ledgerEntries.find((candidate) => candidate.ingredientId === ingredient.id && candidate.month === month)
      ?? createLedgerEntry(state, ingredient.id, month, new Date().toISOString());
    const closing = entryClosing(entry);
    return {
      ...entry,
      name: ingredient.name,
      nameEn: ingredient.nameEn,
      category: ingredient.category,
      spec: ingredient.spec,
      unit: ingredient.unit,
      ...closing,
    };
  });
}

type Action =
  | { type: "LOAD"; payload: FoodIngredientState }
  | { type: "ADD"; ingredient: FoodIngredient }
  | { type: "UPDATE"; id: string; updates: Partial<FoodIngredient> }
  | { type: "DELETE"; id: string }
  | { type: "UPDATE_STOCK"; id: string; delta: number }
  | { type: "RECORD_PURCHASE"; input: FoodPurchaseInput }
  | { type: "RECORD_CONSUME"; input: FoodConsumeInput }
  | { type: "RECORD_STOCKTAKE"; input: FoodStocktakeInput }
  | { type: "CLOSE_MONTH"; month: string }
  | { type: "BATCH_IMPORT"; updates: { id: string; costPrice: number; stockDelta: number; supplier: string; priceEntry: PriceHistoryEntry }[] };

export function foodIngredientReducer(state: FoodIngredientState, action: Action): FoodIngredientState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { ...state, ingredients: [action.ingredient, ...state.ingredients] };
    case "UPDATE": return {
      ...state,
      ingredients: state.ingredients.map((item) => item.id === action.id ? { ...item, ...action.updates, updatedAt: new Date().toISOString() } : item),
    };
    case "DELETE": {
      const { [action.id]: _deletedPriceHistory, ...priceHistory } = state.priceHistory;
      return {
        ...state,
        ingredients: state.ingredients.filter((item) => item.id !== action.id),
        priceHistory,
        ledgerEntries: state.ledgerEntries.filter((entry) => entry.ingredientId !== action.id),
        ledgerMovements: state.ledgerMovements.filter((movement) => movement.ingredientId !== action.id),
      };
    }
    case "UPDATE_STOCK": return {
      ...state,
      ingredients: state.ingredients.map((item) => item.id === action.id ? { ...item, stock: Math.max(0, item.stock + action.delta), updatedAt: new Date().toISOString() } : item),
    };
    case "RECORD_PURCHASE": return applyPurchase(state, action.input);
    case "RECORD_CONSUME": return applyConsume(state, action.input);
    case "RECORD_STOCKTAKE": return applyStocktake(state, action.input);
    case "BATCH_IMPORT": return action.updates.reduce(
      (next, update) => applyPurchase(next, {
        ingredientId: update.id,
        quantity: update.stockDelta,
        unitPrice: update.costPrice,
        date: update.priceEntry.date,
        supplier: update.supplier,
        source: update.priceEntry.source,
      }),
      state,
    );
    case "CLOSE_MONTH": {
      const now = new Date().toISOString();
      return state.ingredients.reduce((next, ingredient) => {
        const existing = next.ledgerEntries.find((entry) => entry.ingredientId === ingredient.id && entry.month === action.month);
        const closing = entryClosing(existing ?? createLedgerEntry(next, ingredient.id, action.month, now));
        return withLedgerEntry(next, ingredient.id, action.month, now, (entry) => ({
          ...entry,
          actualClosingQty: entry.actualClosingQty ?? closing.closingQty,
          actualClosingUnitCost: entry.actualClosingUnitCost ?? closing.closingUnitCost,
          updatedAt: now,
        }));
      }, state);
    }
    default: return state;
  }
}

interface FoodIngredientContextValue extends FoodIngredientState {
  /** 返回稳定ID，供同一批供应商导入将新增食材立即写入月度采购流水。 */
  addIngredient: (data: Omit<FoodIngredient, "id" | "createdAt" | "updatedAt">) => string;
  updateIngredient: (id: string, updates: Partial<FoodIngredient>) => void;
  deleteIngredient: (id: string) => void;
  updateStock: (id: string, delta: number) => void;
  recordPurchase: (input: FoodPurchaseInput) => void;
  recordConsume: (input: FoodConsumeInput) => void;
  recordStocktake: (input: FoodStocktakeInput) => void;
  closeMonth: (month: string) => void;
  getMonthLedger: (month: string) => FoodMonthlyLedgerRow[];
  batchImport: (updates: { id: string; costPrice: number; stockDelta: number; supplier: string; priceEntry: PriceHistoryEntry }[]) => void;
}

const FoodIngredientContext = createContext<FoodIngredientContextValue | null>(null);

export function FoodIngredientProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(foodIngredientReducer, { ingredients: [], priceHistory: {}, ledgerEntries: [], ledgerMovements: [] });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      let raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) raw = await AsyncStorage.getItem("food.ingredients.v1");
      if (raw && active) {
        try { dispatch({ type: "LOAD", payload: sanitizeFoodIngredientState(JSON.parse(raw)) }); } catch {}
      }
      if (active) setHydrated(true);
    };
    void load();
    const unregister = registerStoreReload(load);
    return () => {
      active = false;
      unregister();
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(STORAGE_KEY);
  }, [hydrated, state]);

  const addIngredient = useCallback((data: Omit<FoodIngredient, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    const id = uuid();
    dispatch({ type: "ADD", ingredient: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);
  const updateIngredient = useCallback((id: string, updates: Partial<FoodIngredient>) => dispatch({ type: "UPDATE", id, updates }), []);
  const deleteIngredient = useCallback((id: string) => dispatch({ type: "DELETE", id }), []);
  const updateStock = useCallback((id: string, delta: number) => dispatch({ type: "UPDATE_STOCK", id, delta }), []);
  const recordPurchase = useCallback((input: FoodPurchaseInput) => dispatch({ type: "RECORD_PURCHASE", input }), []);
  const recordConsume = useCallback((input: FoodConsumeInput) => dispatch({ type: "RECORD_CONSUME", input }), []);
  const recordStocktake = useCallback((input: FoodStocktakeInput) => dispatch({ type: "RECORD_STOCKTAKE", input }), []);
  const closeMonth = useCallback((month: string) => dispatch({ type: "CLOSE_MONTH", month }), []);
  const getMonthLedger = useCallback((month: string) => buildFoodMonthlyLedger(state, month), [state]);
  const batchImport = useCallback((updates: { id: string; costPrice: number; stockDelta: number; supplier: string; priceEntry: PriceHistoryEntry }[]) => dispatch({ type: "BATCH_IMPORT", updates }), []);

  return (
    <FoodIngredientContext.Provider value={{
      ...state, addIngredient, updateIngredient, deleteIngredient, updateStock,
      recordPurchase, recordConsume, recordStocktake, closeMonth, getMonthLedger, batchImport,
    }}>
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
    case "DELETE_RECORD": return { records: state.records.filter((record) => record.id !== action.id) };
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
    const load = () => {
      void AsyncStorage.getItem(PURCHASE_KEY)
        .then((raw) => {
          if (!raw) return;
          try {
            const parsed: unknown = JSON.parse(raw);
            if (typeof parsed === "object" && parsed !== null && Array.isArray((parsed as PurchaseState).records)) {
              dispatch({ type: "LOAD", payload: parsed as PurchaseState });
            }
          } catch (error) {
            console.warn("[SupplierPurchase] hydration parse failed:", error);
          }
        })
        .catch((error) => console.warn("[SupplierPurchase] hydration failed:", error));
    };
    load();
    return registerStoreReload(load);
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(PURCHASE_KEY, JSON.stringify(state)).catch(() => {});
    notifySyncChange(PURCHASE_KEY);
  }, [state]);
  const addRecord = useCallback((record: SupplierPurchaseRecord) => dispatch({ type: "ADD_RECORD", record }), []);
  const deleteRecord = useCallback((id: string) => dispatch({ type: "DELETE_RECORD", id }), []);
  return <PurchaseContext.Provider value={{ ...state, addRecord, deleteRecord }}>{children}</PurchaseContext.Provider>;
}

export function useSupplierPurchaseStore(): PurchaseContextValue {
  const ctx = useContext(PurchaseContext);
  if (!ctx) throw new Error("useSupplierPurchaseStore must be used within SupplierPurchaseProvider");
  return ctx;
}
