/**
 * 菜品分析快照 Store (Build 135)
 * 持久化存储每月的菜品分析数据
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import { notifySyncChange, registerStoreReload } from "../../sync/engine";
import { DishAnalysisSnapshot } from "./dish-analysis-types";

const SNAPSHOTS_KEY = "dish_analysis.snapshots.v1";


interface DishAnalysisState {
  snapshots: DishAnalysisSnapshot[];
}

type Action =
  | { type: "LOAD"; snapshots: DishAnalysisSnapshot[] }
  | { type: "UPSERT"; snapshot: DishAnalysisSnapshot }
  | { type: "DELETE"; id: string };

function reducer(state: DishAnalysisState, action: Action): DishAnalysisState {
  switch (action.type) {
    case "LOAD": return { snapshots: action.snapshots };
    case "UPSERT": {
      const idx = state.snapshots.findIndex((s) => s.id === action.snapshot.id);
      if (idx >= 0) {
        const next = [...state.snapshots];
        next[idx] = action.snapshot;
        return { snapshots: next };
      }
      return { snapshots: [action.snapshot, ...state.snapshots] };
    }
    case "DELETE":
      return { snapshots: state.snapshots.filter((s) => s.id !== action.id) };
    default: return state;
  }
}

interface DishAnalysisContextValue extends DishAnalysisState {
  upsertSnapshot: (snapshot: DishAnalysisSnapshot) => void;
  deleteSnapshot: (id: string) => void;
  getSnapshot: (month: string) => DishAnalysisSnapshot | undefined;
}

const DishAnalysisContext = createContext<DishAnalysisContextValue | null>(null);

export function DishAnalysisProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { snapshots: [] });

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(SNAPSHOTS_KEY);
        dispatch({ type: "LOAD", snapshots: raw ? JSON.parse(raw) : [] });
      } catch {}
    };
    load();
    registerStoreReload(load);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(state.snapshots)).catch(() => {});
    notifySyncChange(SNAPSHOTS_KEY);
  }, [state.snapshots]);

  const upsertSnapshot = useCallback((snapshot: DishAnalysisSnapshot) =>
    dispatch({ type: "UPSERT", snapshot }), []);
  const deleteSnapshot = useCallback((id: string) =>
    dispatch({ type: "DELETE", id }), []);
  const getSnapshot = useCallback((month: string) =>
    state.snapshots.find((s) => s.month === month), [state.snapshots]);

  return (
    <DishAnalysisContext.Provider value={{ ...state, upsertSnapshot, deleteSnapshot, getSnapshot }}>
      {children}
    </DishAnalysisContext.Provider>
  );
}

export function useDishAnalysisStore(): DishAnalysisContextValue {
  const ctx = useContext(DishAnalysisContext);
  if (!ctx) throw new Error("useDishAnalysisStore must be used within DishAnalysisProvider");
  return ctx;
}
