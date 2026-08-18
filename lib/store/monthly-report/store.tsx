/**
 * 月度经营分析 Store
 * 持久化存储月度报告快照列表
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../../sync/engine";
import { MonthlyReport } from "./types";
import { replaceMonthlyReportForBusinessMonth } from "./month-key";

const STORAGE_KEY = "monthly_reports_v1";

interface MonthlyReportStore {
  reports: MonthlyReport[];
  addReport: (report: MonthlyReport) => void;
  deleteReport: (id: string) => void;
  updateReport: (id: string, patch: Partial<MonthlyReport>) => void;
  ready: boolean;
}

const MonthlyReportContext = createContext<MonthlyReportStore>({
  reports: [],
  addReport: () => {},
  deleteReport: () => {},
  updateReport: () => {},
  ready: false,
});

export function MonthlyReportProvider({ children }: { children: React.ReactNode }) {
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [ready, setReady] = useState(false);
  const reportsRef = useRef<MonthlyReport[]>([]);

  useEffect(() => {
    const load = () => AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as MonthlyReport[];
          reportsRef.current = parsed;
          setReports(parsed);
        } catch {}
      }
      setReady(true);
    });
    load();
    // ★ 注册同步重载回调
    return registerStoreReload(load);
  }, []);

  const persist = useCallback((next: MonthlyReport[]) => {
    reportsRef.current = next;
    setReports(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(console.error);
    // ★ 通知同步引擎
    notifySyncChange(STORAGE_KEY);
  }, []);

  const addReport = useCallback((report: MonthlyReport) => {
    // 同业务月份只保留最新一份；2026/07 与 2026-07 必须视为同月。
    persist(replaceMonthlyReportForBusinessMonth(reportsRef.current, report));
  }, [persist]);

  const deleteReport = useCallback((id: string) => {
    persist(reportsRef.current.filter((r) => r.id !== id));
  }, [persist]);

  const updateReport = useCallback((id: string, patch: Partial<MonthlyReport>) => {
    persist(reportsRef.current.map((r) => r.id === id ? { ...r, ...patch } : r));
  }, [persist]);

  return (
    <MonthlyReportContext.Provider value={{ reports, addReport, deleteReport, updateReport, ready }}>
      {children}
    </MonthlyReportContext.Provider>
  );
}

export function useMonthlyReportStore() {
  return useContext(MonthlyReportContext);
}
