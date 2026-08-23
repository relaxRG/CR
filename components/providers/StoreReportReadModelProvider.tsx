import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { registerStoreReload } from "@/lib/sync/engine";
import { PETTY_CODE_LABELS, type PettyCode } from "@/lib/store/petty-store";
import { useGlobalBusinessMonth } from "@/lib/months/global-business-month";
import {
  buildStoreReportReadModel,
  loadStoreReportFacts,
  type StoreReportFacts,
  type StoreReportReadModel,
} from "@/lib/store/report-read-model";

const REPORT_SNAPSHOT_KEYS = ["store.revenue.v1", "store.petty.v1"] as const;
const EMPTY_FACTS: StoreReportFacts = Object.freeze({
  payslips: [], pettyRecords: [], revenueRecords: [], purchases: [], inventory: [],
});

type ReportReadModelContextValue = Readonly<{
  model: StoreReportReadModel;
  ready: boolean;
  refresh: () => Promise<void>;
}>;

const StoreReportReadModelContext = createContext<ReportReadModelContextValue | null>(null);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function parseState(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try { return asRecord(JSON.parse(raw)) ?? {}; } catch { return {}; }
}

/** 将持久化载荷投影为报表所需的只读事实，不回写、修复或迁移原始载荷。 */
export function decodeStoreReportSnapshot(snapshot: ReadonlyMap<string, string | null>): StoreReportFacts {
  const revenueState = parseState(snapshot.get("store.revenue.v1") ?? null);
  const pettyState = parseState(snapshot.get("store.petty.v1") ?? null);
  const revenueRecords = Array.isArray(revenueState.records)
    ? revenueState.records.flatMap((value) => {
      const record = asRecord(value);
      const date = typeof record?.date === "string" ? record.date : "";
      const category = typeof record?.category === "string" ? record.category : "";
      const amount = typeof record?.amount === "number" ? record.amount : NaN;
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && category && Number.isFinite(amount) ? [{ date, category, amount }] : [];
    })
    : [];
  const pettyRecords = Array.isArray(pettyState.records)
    ? pettyState.records.flatMap((value) => {
      const record = asRecord(value);
      const date = typeof record?.date === "string" ? record.date : "";
      const code = typeof record?.code === "string" ? record.code : "";
      const amount = typeof record?.amount === "number" ? record.amount : NaN;
      return /^\d{4}-\d{2}-\d{2}$/.test(date) && Object.hasOwn(PETTY_CODE_LABELS, code) && Number.isFinite(amount)
        ? [{ date, code: code as PettyCode, amount }]
        : [];
    })
    : [];
  return Object.freeze({
    payslips: [],
    pettyRecords: Object.freeze(pettyRecords),
    revenueRecords: Object.freeze(revenueRecords),
    purchases: [],
    inventory: [],
  });
}

export function StoreReportReadModelProvider({ children }: { children: React.ReactNode }) {
  const { month } = useGlobalBusinessMonth();
  const [facts, setFacts] = useState<StoreReportFacts>(EMPTY_FACTS);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    const nextFacts = await loadStoreReportFacts(AsyncStorage, REPORT_SNAPSHOT_KEYS, decodeStoreReportSnapshot);
    setFacts(nextFacts);
    setReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    const guardedRefresh = () => refresh().catch(() => {
      if (active) setReady(true);
    });
    void guardedRefresh();
    const unregister = registerStoreReload(guardedRefresh);
    return () => { active = false; unregister(); };
  }, [refresh]);

  const value = useMemo<ReportReadModelContextValue>(() => Object.freeze({
    model: buildStoreReportReadModel(month, facts),
    ready,
    refresh,
  }), [facts, month, ready, refresh]);
  return <StoreReportReadModelContext.Provider value={value}>{children}</StoreReportReadModelContext.Provider>;
}

export function useStoreReportReadModel(): ReportReadModelContextValue {
  const context = useContext(StoreReportReadModelContext);
  if (!context) throw new Error("useStoreReportReadModel must be used within StoreReportReadModelProvider");
  return context;
}
