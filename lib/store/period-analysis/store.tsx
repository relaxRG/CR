/**
 * 时段分析 Store
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../../sync/engine";
import {
  PeriodAnalysisReport, PeriodAnalysisSettings, DEFAULT_PERIOD_SETTINGS,
} from "./types";

const REPORTS_KEY = "period_analysis.reports.v1";
const SETTINGS_KEY = "period_analysis.settings.v1";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

interface PeriodAnalysisState {
  reports: PeriodAnalysisReport[];
  settings: PeriodAnalysisSettings;
}

type Action =
  | { type: "LOAD"; payload: PeriodAnalysisState }
  | { type: "ADD_REPORT"; report: PeriodAnalysisReport }
  | { type: "DELETE_REPORT"; id: string }
  | { type: "UPDATE_SETTINGS"; settings: Partial<PeriodAnalysisSettings> };

function reducer(state: PeriodAnalysisState, action: Action): PeriodAnalysisState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD_REPORT": {
      // 同月份只保留最新一份
      const filtered = state.reports.filter((r) => r.month !== action.report.month);
      return { ...state, reports: [action.report, ...filtered] };
    }
    case "DELETE_REPORT":
      return { ...state, reports: state.reports.filter((r) => r.id !== action.id) };
    case "UPDATE_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.settings } };
    default: return state;
  }
}

interface PeriodAnalysisContextValue extends PeriodAnalysisState {
  addReport: (report: PeriodAnalysisReport) => void;
  deleteReport: (id: string) => void;
  updateSettings: (settings: Partial<PeriodAnalysisSettings>) => void;
  getReport: (month: string) => PeriodAnalysisReport | undefined;
  latestReport: PeriodAnalysisReport | undefined;
}

const PeriodAnalysisContext = createContext<PeriodAnalysisContextValue | null>(null);

export function PeriodAnalysisProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    reports: [],
    settings: DEFAULT_PERIOD_SETTINGS,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const [reportsRaw, settingsRaw] = await Promise.all([
          AsyncStorage.getItem(REPORTS_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        dispatch({
          type: "LOAD",
          payload: {
            reports: reportsRaw ? JSON.parse(reportsRaw) : [],
            settings: settingsRaw ? { ...DEFAULT_PERIOD_SETTINGS, ...JSON.parse(settingsRaw) } : DEFAULT_PERIOD_SETTINGS,
          },
        });
      } catch {}
    };
    load();
    // ★ 注册同步重载回调，返回清理函数
    return registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(state.reports)).catch(() => {});
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)).catch(() => {});
    // ★ 两个键都要通知同步引擎
    notifySyncChange(REPORTS_KEY);
    notifySyncChange(SETTINGS_KEY);
  }, [state]);

  const addReport = useCallback((report: PeriodAnalysisReport) => dispatch({ type: "ADD_REPORT", report }), []);
  const deleteReport = useCallback((id: string) => dispatch({ type: "DELETE_REPORT", id }), []);
  const updateSettings = useCallback((settings: Partial<PeriodAnalysisSettings>) =>
    dispatch({ type: "UPDATE_SETTINGS", settings }), []);
  const getReport = useCallback((month: string) => state.reports.find((r) => r.month === month), [state.reports]);
  const latestReport = state.reports[0];

  return (
    <PeriodAnalysisContext.Provider value={{
      ...state, addReport, deleteReport, updateSettings, getReport, latestReport,
    }}>
      {children}
    </PeriodAnalysisContext.Provider>
  );
}

export function usePeriodAnalysisStore(): PeriodAnalysisContextValue {
  const ctx = useContext(PeriodAnalysisContext);
  if (!ctx) throw new Error("usePeriodAnalysisStore must be used within PeriodAnalysisProvider");
  return ctx;
}
