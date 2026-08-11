/**
 * 营业时间设置 + 班次档案 Store (Build 135)
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer, useState } from "react";
import { notifySyncChange, registerStoreReload } from "../../sync/engine";
import {
  BusinessHoursConfig, ShiftTemplate,
  DEFAULT_BUSINESS_HOURS, DEFAULT_SHIFT_TEMPLATES,
} from "./schedule-types";

const BIZ_HOURS_KEY = "schedule.business_hours.v1";
const SHIFT_TEMPLATES_KEY = "schedule.shift_templates.v1";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

interface ScheduleState {
  businessHours: BusinessHoursConfig;
  shiftTemplates: ShiftTemplate[];
}

type Action =
  | { type: "LOAD"; state: ScheduleState }
  | { type: "UPDATE_BIZ_HOURS"; config: BusinessHoursConfig }
  | { type: "UPSERT_SHIFT_TEMPLATE"; template: ShiftTemplate }
  | { type: "DELETE_SHIFT_TEMPLATE"; id: string }
  | { type: "RESET_SHIFT_TEMPLATES" };

function reducer(state: ScheduleState, action: Action): ScheduleState {
  switch (action.type) {
    case "LOAD": return action.state;
    case "UPDATE_BIZ_HOURS": return { ...state, businessHours: action.config };
    case "UPSERT_SHIFT_TEMPLATE": {
      const idx = state.shiftTemplates.findIndex((t) => t.id === action.template.id);
      if (idx >= 0) {
        const next = [...state.shiftTemplates];
        next[idx] = action.template;
        return { ...state, shiftTemplates: next };
      }
      return { ...state, shiftTemplates: [...state.shiftTemplates, action.template] };
    }
    case "DELETE_SHIFT_TEMPLATE":
      return { ...state, shiftTemplates: state.shiftTemplates.filter((t) => t.id !== action.id) };
    case "RESET_SHIFT_TEMPLATES":
      return { ...state, shiftTemplates: [...DEFAULT_SHIFT_TEMPLATES] };
    default: return state;
  }
}

interface ScheduleContextValue extends ScheduleState {
  updateBusinessHours: (config: BusinessHoursConfig) => void;
  addDateOverride: (date: string, closingTime: string, note?: string) => void;
  removeDateOverride: (date: string) => void;
  upsertShiftTemplate: (template: ShiftTemplate) => void;
  deleteShiftTemplate: (id: string) => void;
  resetShiftTemplates: () => void;
  createShiftTemplate: (data: Omit<ShiftTemplate, "id" | "createdAt">) => string;
}

const ScheduleContext = createContext<ScheduleContextValue | null>(null);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    businessHours: { ...DEFAULT_BUSINESS_HOURS },
    shiftTemplates: [...DEFAULT_SHIFT_TEMPLATES],
  });
  // 在 AsyncStorage 首次加载完成前禁止持久化默认值，避免慢设备上覆盖已有配置。
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [bhRaw, stRaw] = await Promise.all([
          AsyncStorage.getItem(BIZ_HOURS_KEY),
          AsyncStorage.getItem(SHIFT_TEMPLATES_KEY),
        ]);
        dispatch({
          type: "LOAD",
          state: {
            businessHours: bhRaw ? JSON.parse(bhRaw) : { ...DEFAULT_BUSINESS_HOURS },
            shiftTemplates: stRaw ? JSON.parse(stRaw) : [...DEFAULT_SHIFT_TEMPLATES],
          },
        });
      } catch {} finally { setHydrated(true); }
    };
    load();
    return registerStoreReload(load);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(BIZ_HOURS_KEY, JSON.stringify(state.businessHours)).catch(() => {});
    AsyncStorage.setItem(SHIFT_TEMPLATES_KEY, JSON.stringify(state.shiftTemplates)).catch(() => {});
    notifySyncChange(BIZ_HOURS_KEY);
    notifySyncChange(SHIFT_TEMPLATES_KEY);
  }, [state, hydrated]);

  const updateBusinessHours = useCallback((config: BusinessHoursConfig) =>
    dispatch({ type: "UPDATE_BIZ_HOURS", config }), []);

  const addDateOverride = useCallback((date: string, closingTime: string, note?: string) => {
    const updated = {
      ...state.businessHours,
      dateOverrides: [
        ...state.businessHours.dateOverrides.filter((d) => d.date !== date),
        { date, closingTime, note },
      ],
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: "UPDATE_BIZ_HOURS", config: updated });
  }, [state.businessHours]);

  const removeDateOverride = useCallback((date: string) => {
    const updated = {
      ...state.businessHours,
      dateOverrides: state.businessHours.dateOverrides.filter((d) => d.date !== date),
      updatedAt: new Date().toISOString(),
    };
    dispatch({ type: "UPDATE_BIZ_HOURS", config: updated });
  }, [state.businessHours]);

  const upsertShiftTemplate = useCallback((template: ShiftTemplate) =>
    dispatch({ type: "UPSERT_SHIFT_TEMPLATE", template }), []);

  const deleteShiftTemplate = useCallback((id: string) =>
    dispatch({ type: "DELETE_SHIFT_TEMPLATE", id }), []);

  const resetShiftTemplates = useCallback(() =>
    dispatch({ type: "RESET_SHIFT_TEMPLATES" }), []);

  const createShiftTemplate = useCallback((data: Omit<ShiftTemplate, "id" | "createdAt">): string => {
    const id = uuid();
    dispatch({
      type: "UPSERT_SHIFT_TEMPLATE",
      template: { ...data, id, createdAt: new Date().toISOString() },
    });
    return id;
  }, []);

  return (
    <ScheduleContext.Provider value={{
      ...state,
      updateBusinessHours, addDateOverride, removeDateOverride,
      upsertShiftTemplate, deleteShiftTemplate, resetShiftTemplates, createShiftTemplate,
    }}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useScheduleStore(): ScheduleContextValue {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error("useScheduleStore must be used within ScheduleProvider");
  return ctx;
}
