/**
 * 通用进销存 Store 工厂
 * 为 beer/ice/fruit/glassware/tableware/daily 等品类提供统一的月度台账 Store
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { MonthlySnapshot, PurchaseRecord, ConsumeRecord, getCurrentMonth, getPrevMonth, getOpeningFromLastMonth } from "./types";
import {
  createInventoryOperationReceipt,
  InventoryBulkPreflight,
  InventoryOperationReceipt,
  prepareInventoryBulkOperation,
} from "./bulk-operation";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── 通用进销存 State ────────────────────────────────────────────────────────
export interface GenericInventoryItem {
  id: string;
  name: string;
  nameEn?: string;
  /** 品类/分组标签（各品类自定义含义） */
  category: string;
  spec: string;
  unit: string;
  /** 当前实际库存（由进出库操作维护） */
  currentStock: number;
  /** 最新进货价 */
  latestCostPrice: number;
  /** 供应商 */
  supplier: string;
  /** 备注 */
  notes: string;
  active: boolean;
  /** 归档不删除采购、消耗与月结快照；用于恢复与审计。 */
  archivedAt?: string;
  archiveReason?: string;
  createdAt: string;
  updatedAt: string;
  /** 扩展字段（各品类自定义，如售价/用途/包装类型等） */
  extra?: Record<string, unknown>;
}

export interface GenericInventoryState {
  items: GenericInventoryItem[];
  purchases: PurchaseRecord[];
  consumes: ConsumeRecord[];
  snapshots: MonthlySnapshot[];
  operationReceipts: InventoryOperationReceipt[];
}

export function sanitizeGenericInventoryState(raw: unknown): GenericInventoryState {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    items: items
      .filter((item): item is GenericInventoryItem => Boolean(item) && typeof item === "object"),
    purchases: Array.isArray(source.purchases) ? source.purchases as PurchaseRecord[] : [],
    consumes: Array.isArray(source.consumes) ? source.consumes as ConsumeRecord[] : [],
    snapshots: Array.isArray(source.snapshots) ? source.snapshots as MonthlySnapshot[] : [],
    operationReceipts: Array.isArray(source.operationReceipts) ? source.operationReceipts as InventoryOperationReceipt[] : [],
  };
}

type Action =
  | { type: "LOAD"; payload: GenericInventoryState }
  | { type: "ADD_ITEM"; item: GenericInventoryItem }
  | { type: "UPDATE_ITEM"; id: string; updates: Partial<GenericInventoryItem> }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_PURCHASE"; record: PurchaseRecord }
  | { type: "DELETE_PURCHASE"; id: string }
  | { type: "ADD_CONSUME"; record: ConsumeRecord }
  | { type: "DELETE_CONSUME"; id: string }
  | { type: "ADD_SNAPSHOT"; snapshot: MonthlySnapshot }
  | { type: "DELETE_SNAPSHOT"; id: string }
  | { type: "APPLY_BULK_ITEM_OPERATION"; preflight: InventoryBulkPreflight; targetCategory?: string; receipt: InventoryOperationReceipt }
  | { type: "RESTORE_ARCHIVED_ITEMS"; ids: string[]; receipt: InventoryOperationReceipt };

function reducer(state: GenericInventoryState, action: Action): GenericInventoryState {
  switch (action.type) {
    case "LOAD": return action.payload;

    case "ADD_ITEM":
      return { ...state, items: [action.item, ...state.items] };

    case "UPDATE_ITEM":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i
        ),
      };

    case "DELETE_ITEM":
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };

    case "ADD_PURCHASE": {
      const r = action.record;
      // 更新库存和最新进价
      const newItems = state.items.map((item) => {
        if (item.id !== r.itemId) return item;
        return {
          ...item,
          currentStock: item.currentStock + r.quantity,
          latestCostPrice: r.unitPrice > 0 ? r.unitPrice : item.latestCostPrice,
          updatedAt: new Date().toISOString(),
        };
      });
      return { ...state, items: newItems, purchases: [r, ...state.purchases] };
    }

    case "DELETE_PURCHASE":
      return { ...state, purchases: state.purchases.filter((r) => r.id !== action.id) };

    case "ADD_CONSUME": {
      const r = action.record;
      // 更新库存
      const newItems = state.items.map((item) => {
        if (item.id !== r.itemId) return item;
        return {
          ...item,
          currentStock: Math.max(0, item.currentStock - r.quantity),
          updatedAt: new Date().toISOString(),
        };
      });
      return { ...state, items: newItems, consumes: [r, ...state.consumes] };
    }

    case "DELETE_CONSUME":
      return { ...state, consumes: state.consumes.filter((r) => r.id !== action.id) };

    case "ADD_SNAPSHOT":
      // 同月份只保留最新一条
      return {
        ...state,
        snapshots: [action.snapshot, ...state.snapshots.filter((s) => s.month !== action.snapshot.month)],
      };

    case "DELETE_SNAPSHOT":
      return { ...state, snapshots: state.snapshots.filter((s) => s.id !== action.id) };

    case "APPLY_BULK_ITEM_OPERATION": {
      const deleteIds = new Set(action.preflight.deletableIds);
      const archiveIds = new Set(action.preflight.archivableIds);
      const reclassifyIds = new Set(action.preflight.reclassifiableIds);
      const now = action.receipt.completedAt;
      return {
        ...state,
        items: state.items
          .filter((item) => !deleteIds.has(item.id))
          .map((item) => archiveIds.has(item.id)
            ? { ...item, active: false, archivedAt: now, archiveReason: action.preflight.action, updatedAt: now }
            : reclassifyIds.has(item.id)
              ? { ...item, category: action.targetCategory ?? item.category, updatedAt: now }
              : item),
        operationReceipts: [action.receipt, ...state.operationReceipts].slice(0, 100),
      };
    }

    case "RESTORE_ARCHIVED_ITEMS": {
      const restoreIds = new Set(action.ids);
      const now = action.receipt.completedAt;
      return {
        ...state,
        items: state.items.map((item) => restoreIds.has(item.id)
          ? { ...item, active: true, archivedAt: undefined, archiveReason: undefined, updatedAt: now }
          : item),
        operationReceipts: [action.receipt, ...state.operationReceipts].slice(0, 100),
      };
    }

    default: return state;
  }
}

// ─── Context Value 接口 ──────────────────────────────────────────────────────
export interface GenericInventoryContextValue extends GenericInventoryState {
  ready: boolean;
  // Items
  addItem: (data: Omit<GenericInventoryItem, "id" | "createdAt" | "updatedAt">) => string;
  updateItem: (id: string, updates: Partial<GenericInventoryItem>) => void;
  deleteItem: (id: string) => void;
  // Purchases
  addPurchase: (data: Omit<PurchaseRecord, "id" | "createdAt">) => void;
  deletePurchase: (id: string) => void;
  // Consumes
  addConsume: (data: Omit<ConsumeRecord, "id" | "createdAt">) => void;
  deleteConsume: (id: string) => void;
  // Snapshots
  addSnapshot: (data: Omit<MonthlySnapshot, "id" | "createdAt">) => void;
  deleteSnapshot: (id: string) => void;
  /** 共享安全批量预检：历史数据项目自动降级为归档。 */
  prepareBulkOperation: (input: { action: "archive" | "delete" | "reclassify"; ids: string[]; isMonthWritable: boolean; targetCategory?: string }) => InventoryBulkPreflight;
  applyBulkOperation: (preflight: InventoryBulkPreflight, targetCategory?: string) => InventoryOperationReceipt;
  restoreArchivedItems: (ids: string[]) => InventoryOperationReceipt;
  operationReceipts: InventoryOperationReceipt[];
  getArchivedItems: () => GenericInventoryItem[];
  // Computed helpers
  getLastSnapshot: () => MonthlySnapshot | null;
  getSnapshotByMonth: (month: string) => MonthlySnapshot | null;
  getMonthPurchases: (month: string) => PurchaseRecord[];
  getMonthConsumes: (month: string) => ConsumeRecord[];
  getItemMonthPurchases: (itemId: string, month: string) => PurchaseRecord[];
  getItemMonthConsumes: (itemId: string, month: string) => ConsumeRecord[];
  /** 获取某商品本月期初数据（从上月快照自动带入） */
  getOpeningData: (itemId: string, month?: string) => { qty: number; unitCost: number };
}

// ─── Store 工厂函数 ──────────────────────────────────────────────────────────
export function createGenericInventoryStore(storageKey: string, categoryId: string) {
  const Context = createContext<GenericInventoryContextValue | null>(null);

  function Provider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(reducer, {
      items: [], purchases: [], consumes: [], snapshots: [], operationReceipts: [],
    });
    const [ready, setReady] = useState(false);
    const initialPersistPendingRef = useRef(true);

    useEffect(() => {
      initialPersistPendingRef.current = true;
      let alive = true;
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(storageKey);
          if (raw && alive) dispatch({ type: "LOAD", payload: sanitizeGenericInventoryState(JSON.parse(raw)) });
        } catch {}
        // 必须等待 LOAD 引发的渲染提交后才能打开持久化写回。
        // 否则在 Web 或慢设备上，默认空 state 可能先覆盖刚读取的业务库存。
        requestAnimationFrame(() => { if (alive) setReady(true); });
      })();
      return () => { alive = false; };
    }, [storageKey]);

    useEffect(() => {
      if (!ready) return;
      // 水合完成后的首次 effect 只确认加载状态，绝不写入默认 reducer state。
      // 后续用户操作或同步重载才允许将实际 state 持久化。
      if (initialPersistPendingRef.current) {
        initialPersistPendingRef.current = false;
        return;
      }
      AsyncStorage.setItem(storageKey, JSON.stringify(state)).catch(() => {});
    }, [state, ready, storageKey]);

    const addItem = useCallback((data: Omit<GenericInventoryItem, "id" | "createdAt" | "updatedAt">): string => {
      const id = uuid();
      const now = new Date().toISOString();
      dispatch({ type: "ADD_ITEM", item: { ...data, id, createdAt: now, updatedAt: now } });
      return id;
    }, []);

    const updateItem = useCallback((id: string, updates: Partial<GenericInventoryItem>) => {
      dispatch({ type: "UPDATE_ITEM", id, updates });
    }, []);

    const deleteItem = useCallback((id: string) => {
      dispatch({ type: "DELETE_ITEM", id });
    }, []);

    const addPurchase = useCallback((data: Omit<PurchaseRecord, "id" | "createdAt">) => {
      dispatch({ type: "ADD_PURCHASE", record: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
    }, []);

    const deletePurchase = useCallback((id: string) => {
      dispatch({ type: "DELETE_PURCHASE", id });
    }, []);

    const addConsume = useCallback((data: Omit<ConsumeRecord, "id" | "createdAt">) => {
      dispatch({ type: "ADD_CONSUME", record: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
    }, []);

    const deleteConsume = useCallback((id: string) => {
      dispatch({ type: "DELETE_CONSUME", id });
    }, []);

    const addSnapshot = useCallback((data: Omit<MonthlySnapshot, "id" | "createdAt">) => {
      dispatch({ type: "ADD_SNAPSHOT", snapshot: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
    }, []);

    const deleteSnapshot = useCallback((id: string) => {
      dispatch({ type: "DELETE_SNAPSHOT", id });
    }, []);

    const prepareBulkOperation = useCallback((input: { action: "archive" | "delete" | "reclassify"; ids: string[]; isMonthWritable: boolean; targetCategory?: string }) => prepareInventoryBulkOperation({
      scope: categoryId,
      action: input.action,
      selectedIds: input.ids,
      items: state.items,
      isMonthWritable: input.isMonthWritable,
      targetCategory: input.targetCategory,
      getHistory: (itemId) => ({
        purchases: state.purchases.filter((record) => record.itemId === itemId).length,
        consumes: state.consumes.filter((record) => record.itemId === itemId).length,
        ledger: 0,
        snapshots: state.snapshots.filter((snapshot) => snapshot.items.some((item) => item.itemId === itemId)).length,
        referencePrices: 0,
        currentStock: state.items.find((item) => item.id === itemId)?.currentStock ?? 0,
      }),
    }), [categoryId, state]);

    const applyBulkOperation = useCallback((preflight: InventoryBulkPreflight, targetCategory?: string): InventoryOperationReceipt => {
      const receipt = createInventoryOperationReceipt({ scope: categoryId, preflight });
      dispatch({ type: "APPLY_BULK_ITEM_OPERATION", preflight, targetCategory, receipt });
      return receipt;
    }, [categoryId]);

    const restoreArchivedItems = useCallback((ids: string[]): InventoryOperationReceipt => {
      const now = new Date().toISOString();
      const receipt: InventoryOperationReceipt = {
        operationId: `${categoryId}-restore-${Date.now()}`,
        scope: categoryId,
        action: "archive",
        createdAt: now,
        completedAt: now,
        deletedIds: [],
        archivedIds: [],
        reclassifiedIds: [],
        skippedIds: [],
      };
      dispatch({ type: "RESTORE_ARCHIVED_ITEMS", ids: [...new Set(ids)], receipt });
      return receipt;
    }, [categoryId]);

    const getArchivedItems = useCallback(() => state.items.filter((item) => !item.active), [state.items]);

    const getLastSnapshot = useCallback((): MonthlySnapshot | null => {
      if (!state.snapshots.length) return null;
      return [...state.snapshots].sort((a, b) => b.month.localeCompare(a.month))[0];
    }, [state.snapshots]);

    const getSnapshotByMonth = useCallback((month: string): MonthlySnapshot | null => {
      return state.snapshots.find((s) => s.month === month) ?? null;
    }, [state.snapshots]);

    const getMonthPurchases = useCallback((month: string): PurchaseRecord[] => {
      return state.purchases.filter((r) => r.date.startsWith(month));
    }, [state.purchases]);

    const getMonthConsumes = useCallback((month: string): ConsumeRecord[] => {
      return state.consumes.filter((r) => r.date.startsWith(month));
    }, [state.consumes]);

    const getItemMonthPurchases = useCallback((itemId: string, month: string): PurchaseRecord[] => {
      return state.purchases.filter((r) => r.itemId === itemId && r.date.startsWith(month));
    }, [state.purchases]);

    const getItemMonthConsumes = useCallback((itemId: string, month: string): ConsumeRecord[] => {
      return state.consumes.filter((r) => r.itemId === itemId && r.date.startsWith(month));
    }, [state.consumes]);

    const getOpeningData = useCallback((itemId: string, month?: string): { qty: number; unitCost: number } => {
      const targetMonth = month ?? getCurrentMonth();
      const prevMonth = getPrevMonth(targetMonth);
      const lastSnap = state.snapshots.find((s) => s.month === prevMonth) ?? null;
      return getOpeningFromLastMonth(lastSnap, itemId);
    }, [state.snapshots]);

    return (
      <Context.Provider value={{
        ...state, ready,
        addItem, updateItem, deleteItem,
        addPurchase, deletePurchase,
        addConsume, deleteConsume,
        addSnapshot, deleteSnapshot,
        prepareBulkOperation, applyBulkOperation, restoreArchivedItems, operationReceipts: state.operationReceipts, getArchivedItems,
        getLastSnapshot, getSnapshotByMonth,
        getMonthPurchases, getMonthConsumes,
        getItemMonthPurchases, getItemMonthConsumes,
        getOpeningData,
      }}>
        {children}
      </Context.Provider>
    );
  }

  function useStore(): GenericInventoryContextValue {
    const ctx = useContext(Context);
    if (!ctx) throw new Error(`useStore must be used within Provider (${categoryId})`);
    return ctx;
  }

  return { Provider, useStore };
}
