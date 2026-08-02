/**
 * 月度经营分析 Store
 * 持久化存储月度报告快照列表
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MonthlyReport } from "./types";

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
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as MonthlyReport[];
          reportsRef.current = parsed;
          setReports(parsed);
        } catch {}
      }
      setReady(true);
    });
  }, []);

  const persist = useCallback((next: MonthlyReport[]) => {
    reportsRef.current = next;
    setReports(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(console.error);
  }, []);

  const addReport = useCallback((report: MonthlyReport) => {
    // 同月份只保留最新一份
    const filtered = reportsRef.current.filter((r) => r.rawMonth !== report.rawMonth);
    persist([report, ...filtered]);
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
