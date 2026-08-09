/**
 * 设备进销存 Store（独立，不使用通用核心库）
 * 特点：购入/折旧/维修记录，不是进货逻辑，关联备用金 E 类
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer, useState } from "react";
import {
  EquipmentItem, MaintenanceRecord,
  calcMonthlyDepreciation, calcBookValue
} from "@/lib/inventory-core/types";
import { registerStoreReload } from "../sync/engine";

const STORAGE_KEY = "equipment.inventory.v1";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export interface EquipmentState {
  items: EquipmentItem[];
  maintenanceRecords: MaintenanceRecord[];
}

type Action =
  | { type: "LOAD"; payload: EquipmentState }
  | { type: "ADD_ITEM"; item: EquipmentItem }
  | { type: "UPDATE_ITEM"; id: string; updates: Partial<EquipmentItem> }
  | { type: "DELETE_ITEM"; id: string }
  | { type: "ADD_MAINTENANCE"; record: MaintenanceRecord }
  | { type: "DELETE_MAINTENANCE"; id: string };

function reducer(state: EquipmentState, action: Action): EquipmentState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_ITEM": return { ...state, items: [action.item, ...state.items] };
    case "UPDATE_ITEM":
      return { ...state, items: state.items.map((i) => i.id === action.id ? { ...i, ...action.updates, updatedAt: new Date().toISOString() } : i) };
    case "DELETE_ITEM": return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case "ADD_MAINTENANCE": return { ...state, maintenanceRecords: [action.record, ...state.maintenanceRecords] };
    case "DELETE_MAINTENANCE": return { ...state, maintenanceRecords: state.maintenanceRecords.filter((r) => r.id !== action.id) };
    default: return state;
  }
}

interface EquipmentContextValue extends EquipmentState {
  ready: boolean;
  addItem: (data: Omit<EquipmentItem, "id" | "createdAt" | "updatedAt">) => string;
  updateItem: (id: string, updates: Partial<EquipmentItem>) => void;
  deleteItem: (id: string) => void;
  addMaintenance: (data: Omit<MaintenanceRecord, "id" | "createdAt">) => void;
  deleteMaintenance: (id: string) => void;
  getMonthlyDepreciation: (item: EquipmentItem) => number;
  getBookValue: (item: EquipmentItem) => number;
  getTotalMonthlyDepreciation: () => number;
  getMonthMaintenanceCost: (month: string) => number;
}

const EquipmentContext = createContext<EquipmentContextValue | null>(null);

export function EquipmentInventoryProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { items: [], maintenanceRecords: [] });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) dispatch({ type: "LOAD", payload: JSON.parse(raw) });
      } catch {}
      setReady(true);
    };
    load();
    return registerStoreReload(() => { void load(); });
  }, []);

  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, ready]);

  const addItem = useCallback((data: Omit<EquipmentItem, "id" | "createdAt" | "updatedAt">): string => {
    const id = uuid();
    const now = new Date().toISOString();
    dispatch({ type: "ADD_ITEM", item: { ...data, id, createdAt: now, updatedAt: now } });
    return id;
  }, []);

  const updateItem = useCallback((id: string, updates: Partial<EquipmentItem>) => {
    dispatch({ type: "UPDATE_ITEM", id, updates });
  }, []);

  const deleteItem = useCallback((id: string) => dispatch({ type: "DELETE_ITEM", id }), []);

  const addMaintenance = useCallback((data: Omit<MaintenanceRecord, "id" | "createdAt">) => {
    dispatch({ type: "ADD_MAINTENANCE", record: { ...data, id: uuid(), createdAt: new Date().toISOString() } });
  }, []);

  const deleteMaintenance = useCallback((id: string) => dispatch({ type: "DELETE_MAINTENANCE", id }), []);

  const getMonthlyDepreciation = useCallback((item: EquipmentItem) => calcMonthlyDepreciation(item), []);
  const getBookValue = useCallback((item: EquipmentItem) => calcBookValue(item), []);

  const getTotalMonthlyDepreciation = useCallback(() => {
    return state.items
      .filter((i) => i.active && i.status !== "scrapped")
      .reduce((s, i) => s + calcMonthlyDepreciation(i), 0);
  }, [state.items]);

  const getMonthMaintenanceCost = useCallback((month: string) => {
    return state.maintenanceRecords
      .filter((r) => r.date.startsWith(month))
      .reduce((s, r) => s + r.cost, 0);
  }, [state.maintenanceRecords]);

  return (
    <EquipmentContext.Provider value={{
      ...state, ready,
      addItem, updateItem, deleteItem,
      addMaintenance, deleteMaintenance,
      getMonthlyDepreciation, getBookValue,
      getTotalMonthlyDepreciation, getMonthMaintenanceCost,
    }}>
      {children}
    </EquipmentContext.Provider>
  );
}

export function useEquipmentInventoryStore(): EquipmentContextValue {
  const ctx = useContext(EquipmentContext);
  if (!ctx) throw new Error("useEquipmentInventoryStore must be used within EquipmentInventoryProvider");
  return ctx;
}

export const EQUIPMENT_TYPES = [
  { value: "ice_machine", label: "制冰机", color: "#00BCD4" },
  { value: "refrigerator", label: "冰箱/冷柜", color: "#0288D1" },
  { value: "bar_equipment", label: "调酒设备", color: "#F59E0B" },
  { value: "audio", label: "音响设备", color: "#8B5CF6" },
  { value: "lighting", label: "灯光设备", color: "#F4A300" },
  { value: "pos", label: "POS/收银", color: "#10B981" },
  { value: "ventilation", label: "通风/空调", color: "#0EA5E9" },
  { value: "other", label: "其他设备", color: "#94A3B8" },
] as const;

export const EQUIPMENT_EXCEL_HINT =
  "A列：名称 | B列：设备类型 | C列：规格/型号 | D列：购入日期(YYYY-MM-DD)\n" +
  "E列：购入价格(元) | F列：预计使用年限(年) | G列：残值率(%) | H列：供应商/品牌";

export async function parseEquipmentExcel(base64: string): Promise<{
  items?: Omit<EquipmentItem, "id" | "createdAt" | "updatedAt">[];
  error?: string;
}> {
  try {
    const { utils, read } = await import("xlsx");
    const wb = read(base64, { type: "base64" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = utils.sheet_to_json(ws, { header: 1, defval: "" });
    const items: Omit<EquipmentItem, "id" | "createdAt" | "updatedAt">[] = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = String(r[0] ?? "").trim();
      if (!name) continue;
      const typeRaw = String(r[1] ?? "").trim();
      let equipmentType = "other";
      for (const t of EQUIPMENT_TYPES) {
        if (typeRaw.includes(t.label) || typeRaw.includes(t.value)) { equipmentType = t.value; break; }
      }
      items.push({
        name,
        equipmentType,
        spec: String(r[2] ?? "").trim(),
        purchaseDate: String(r[3] ?? new Date().toISOString().slice(0, 10)).trim(),
        purchasePrice: Number(r[4]) || 0,
        usefulLifeYears: Number(r[5]) || 5,
        residualRate: Number(r[6]) || 0,
        status: "normal",
        supplier: String(r[7] ?? "").trim(),
        notes: "",
        active: true,
      });
    }
    return { items };
  } catch (e) {
    return { error: String(e) };
  }
}
