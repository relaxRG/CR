/**
 * 烈酒进销存 Store
 * 管理月度快照、手动进货记录、智能匹配记录
 */
import React, { createContext, useCallback, useContext, useEffect, useReducer } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { registerStoreReload } from "../sync/engine";
import {
  SpiritMonthlySnapshot,
  SpiritManualPurchase,
  SpiritMatchRecord,
} from "./types";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── Storage Keys ────────────────────────────────────────────────────────────
const SNAPSHOT_KEY = "spirits.snapshots.v1";
const MANUAL_PURCHASE_KEY = "spirits.manual_purchases.v1";
const MATCH_RECORD_KEY = "spirits.match_records.v1";

// ─── Snapshot Store ──────────────────────────────────────────────────────────
interface SnapshotState { snapshots: SpiritMonthlySnapshot[] }
const initialSnapshotState: SnapshotState = { snapshots: [] };

type SnapshotAction =
  | { type: "LOAD"; payload: SnapshotState }
  | { type: "ADD"; snapshot: SpiritMonthlySnapshot }
  | { type: "DELETE"; id: string };

function snapshotReducer(state: SnapshotState, action: SnapshotAction): SnapshotState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { snapshots: [action.snapshot, ...state.snapshots] };
    case "DELETE": return { snapshots: state.snapshots.filter((s) => s.id !== action.id) };
    default: return state;
  }
}

// ─── Manual Purchase Store ───────────────────────────────────────────────────
interface ManualState { purchases: SpiritManualPurchase[] }
const initialManualState: ManualState = { purchases: [] };

type ManualAction =
  | { type: "LOAD"; payload: ManualState }
  | { type: "ADD"; purchase: SpiritManualPurchase }
  | { type: "DELETE"; id: string };

function manualReducer(state: ManualState, action: ManualAction): ManualState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "ADD": return { purchases: [action.purchase, ...state.purchases] };
    case "DELETE": return { purchases: state.purchases.filter((p) => p.id !== action.id) };
    default: return state;
  }
}

// ─── Match Record Store ──────────────────────────────────────────────────────
interface MatchState { records: SpiritMatchRecord[] }
const initialMatchState: MatchState = { records: [] };

type MatchAction =
  | { type: "LOAD"; payload: MatchState }
  | { type: "UPSERT"; record: SpiritMatchRecord }
  | { type: "DELETE"; rawName: string };

function matchReducer(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case "LOAD": return action.payload;
    case "UPSERT": {
      const exists = state.records.findIndex((r) => r.rawName === action.record.rawName);
      if (exists >= 0) {
        const next = [...state.records];
        next[exists] = action.record;
        return { records: next };
      }
      return { records: [action.record, ...state.records] };
    }
    case "DELETE": return { records: state.records.filter((r) => r.rawName !== action.rawName) };
    default: return state;
  }
}

// ─── Context Types ───────────────────────────────────────────────────────────
interface SpiritsSnapshotContextValue extends SnapshotState {
  addSnapshot: (snapshot: SpiritMonthlySnapshot) => void;
  deleteSnapshot: (id: string) => void;
}

interface SpiritsManualPurchaseContextValue extends ManualState {
  addManualPurchase: (data: Omit<SpiritManualPurchase, "id" | "createdAt">) => void;
  deleteManualPurchase: (id: string) => void;
}

interface SpiritsMatchContextValue extends MatchState {
  upsertMatchRecord: (record: SpiritMatchRecord) => void;
  deleteMatchRecord: (rawName: string) => void;
  getMatchRecord: (rawName: string) => SpiritMatchRecord | undefined;
}

const SpiritsSnapshotContext = createContext<SpiritsSnapshotContextValue | null>(null);
const SpiritsManualPurchaseContext = createContext<SpiritsManualPurchaseContextValue | null>(null);
const SpiritsMatchContext = createContext<SpiritsMatchContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────
export function SpiritsProvider({ children }: { children: React.ReactNode }) {
  const [snapshotState, snapshotDispatch] = useReducer(snapshotReducer, initialSnapshotState);
  const [manualState, manualDispatch] = useReducer(manualReducer, initialManualState);
  const [matchState, matchDispatch] = useReducer(matchReducer, initialMatchState);

  // Load from AsyncStorage
  useEffect(() => {
    const load = () => {
      AsyncStorage.getItem(SNAPSHOT_KEY).then((raw) => {
        if (raw) { try { snapshotDispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      });
      AsyncStorage.getItem(MANUAL_PURCHASE_KEY).then((raw) => {
        if (raw) { try { manualDispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      });
      AsyncStorage.getItem(MATCH_RECORD_KEY).then((raw) => {
        if (raw) { try { matchDispatch({ type: "LOAD", payload: JSON.parse(raw) }); } catch {} }
      });
    };
    load();
    return registerStoreReload(load);
  }, []);

  // Persist on change
  useEffect(() => {
    AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshotState)).catch(() => {});
  }, [snapshotState]);

  useEffect(() => {
    AsyncStorage.setItem(MANUAL_PURCHASE_KEY, JSON.stringify(manualState)).catch(() => {});
  }, [manualState]);

  useEffect(() => {
    AsyncStorage.setItem(MATCH_RECORD_KEY, JSON.stringify(matchState)).catch(() => {});
  }, [matchState]);

  // Snapshot actions
  const addSnapshot = useCallback((snapshot: SpiritMonthlySnapshot) => {
    snapshotDispatch({ type: "ADD", snapshot });
  }, []);

  const deleteSnapshot = useCallback((id: string) => {
    snapshotDispatch({ type: "DELETE", id });
  }, []);

  // Manual purchase actions
  const addManualPurchase = useCallback((data: Omit<SpiritManualPurchase, "id" | "createdAt">) => {
    const now = new Date().toISOString();
    manualDispatch({ type: "ADD", purchase: { ...data, id: uuid(), createdAt: now } });
  }, []);

  const deleteManualPurchase = useCallback((id: string) => {
    manualDispatch({ type: "DELETE", id });
  }, []);

  // Match record actions
  const upsertMatchRecord = useCallback((record: SpiritMatchRecord) => {
    matchDispatch({ type: "UPSERT", record });
  }, []);

  const deleteMatchRecord = useCallback((rawName: string) => {
    matchDispatch({ type: "DELETE", rawName });
  }, []);

  const getMatchRecord = useCallback(
    (rawName: string) => matchState.records.find((r) => r.rawName === rawName),
    [matchState.records]
  );

  return (
    <SpiritsSnapshotContext.Provider value={{ ...snapshotState, addSnapshot, deleteSnapshot }}>
      <SpiritsManualPurchaseContext.Provider value={{ ...manualState, addManualPurchase, deleteManualPurchase }}>
        <SpiritsMatchContext.Provider value={{ ...matchState, upsertMatchRecord, deleteMatchRecord, getMatchRecord }}>
          {children}
        </SpiritsMatchContext.Provider>
      </SpiritsManualPurchaseContext.Provider>
    </SpiritsSnapshotContext.Provider>
  );
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
export function useSpiritsSnapshotStore(): SpiritsSnapshotContextValue {
  const ctx = useContext(SpiritsSnapshotContext);
  if (!ctx) throw new Error("useSpiritsSnapshotStore must be used within SpiritsProvider");
  return ctx;
}

export function useSpiritsManualPurchaseStore(): SpiritsManualPurchaseContextValue {
  const ctx = useContext(SpiritsManualPurchaseContext);
  if (!ctx) throw new Error("useSpiritsManualPurchaseStore must be used within SpiritsProvider");
  return ctx;
}

export function useSpiritsMatchStore(): SpiritsMatchContextValue {
  const ctx = useContext(SpiritsMatchContext);
  if (!ctx) throw new Error("useSpiritsMatchStore must be used within SpiritsProvider");
  return ctx;
}
