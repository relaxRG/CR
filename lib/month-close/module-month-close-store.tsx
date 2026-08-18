import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { notifySyncChange, registerStoreReload } from "@/lib/sync/engine";
import {
  FinalizeModuleMonthInput,
  finalizeModuleMonth,
  getCurrentModuleArchive,
  getModuleMonthCloseStatus,
  isModuleMonthWritable,
  ModuleCloseSummary,
  ModuleMonthAdjustment,
  ModuleMonthCloseArchive,
  MonthCloseModule,
  ModuleMonthCloseStatus,
  openModuleAdjustment,
  summarizeModuleMonth,
} from "./module-month-close";

const ARCHIVES_KEY = "module_month_close_archives_v1";
const SESSIONS_KEY = "module_month_adjustment_sessions_v1";

interface ModuleMonthCloseStore {
  archives: ModuleMonthCloseArchive[];
  sessions: ModuleMonthAdjustment[];
  ready: boolean;
  getStatus: (module: MonthCloseModule, month: string) => ModuleMonthCloseStatus;
  getCurrentArchive: (module: MonthCloseModule, month: string) => ModuleMonthCloseArchive | null;
  getModuleSummary: (module: MonthCloseModule, month: string) => ModuleCloseSummary;
  isWritable: (module: MonthCloseModule, month: string) => boolean;
  finalize: <TSnapshot>(input: FinalizeModuleMonthInput<TSnapshot>) => ModuleMonthCloseArchive<TSnapshot> | null;
  openAdjustment: (module: MonthCloseModule, month: string, reason: string) => ModuleMonthAdjustment | null;
  discardAdjustment: (module: MonthCloseModule, month: string) => boolean;
}

const emptyStore: ModuleMonthCloseStore = {
  archives: [],
  sessions: [],
  ready: false,
  getStatus: () => "draft",
  getCurrentArchive: () => null,
  getModuleSummary: (module, _month) => ({ module, status: "draft", version: null, paymentSummary: { payable: 0, paid: 0, remaining: 0 }, updatedAt: null }),
  isWritable: () => true,
  finalize: () => null,
  openAdjustment: () => null,
  discardAdjustment: () => false,
};

const ModuleMonthCloseContext = createContext<ModuleMonthCloseStore>(emptyStore);

function parseArchives(raw: string | null): ModuleMonthCloseArchive[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSessions(raw: string | null): ModuleMonthAdjustment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ModuleMonthCloseProvider({ children }: { children: React.ReactNode }) {
  const [archives, setArchives] = useState<ModuleMonthCloseArchive[]>([]);
  const [sessions, setSessions] = useState<ModuleMonthAdjustment[]>([]);
  const archivesRef = useRef<ModuleMonthCloseArchive[]>([]);
  const sessionsRef = useRef<ModuleMonthAdjustment[]>([]);
  const [ready, setReady] = useState(false);
  const operationMonthsRef = useRef(new Set<string>());

  const persistArchives = useCallback((next: ModuleMonthCloseArchive[]) => {
    archivesRef.current = next;
    setArchives(next);
    AsyncStorage.setItem(ARCHIVES_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(ARCHIVES_KEY);
  }, []);

  const persistSessions = useCallback((next: ModuleMonthAdjustment[]) => {
    sessionsRef.current = next;
    setSessions(next);
    AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next)).catch(() => {});
    notifySyncChange(SESSIONS_KEY);
  }, []);

  const load = useCallback(async () => {
    const [archiveRaw, sessionRaw] = await Promise.all([
      AsyncStorage.getItem(ARCHIVES_KEY),
      AsyncStorage.getItem(SESSIONS_KEY),
    ]);
    const nextArchives = parseArchives(archiveRaw);
    const nextSessions = parseSessions(sessionRaw);
    archivesRef.current = nextArchives;
    sessionsRef.current = nextSessions;
    setArchives(nextArchives);
    setSessions(nextSessions);
    setReady(true);
  }, []);

  useEffect(() => {
    load().catch(() => setReady(true));
    return registerStoreReload(load);
  }, [load]);

  const withModuleMonthLock = useCallback(<T,>(module: MonthCloseModule, month: string, operation: () => T): T | null => {
    const key = `${module}:${month}`;
    if (operationMonthsRef.current.has(key)) return null;
    operationMonthsRef.current.add(key);
    try {
      return operation();
    } finally {
      operationMonthsRef.current.delete(key);
    }
  }, []);

  const getStatus = useCallback((module: MonthCloseModule, month: string) =>
    getModuleMonthCloseStatus(archivesRef.current, sessionsRef.current, module, month), []);
  const getCurrentArchive = useCallback((module: MonthCloseModule, month: string) =>
    getCurrentModuleArchive(archivesRef.current, module, month), []);
  const getModuleSummary = useCallback((module: MonthCloseModule, month: string) =>
    summarizeModuleMonth(archivesRef.current, sessionsRef.current, module, month), []);
  const isWritable = useCallback((module: MonthCloseModule, month: string) =>
    isModuleMonthWritable(archivesRef.current, sessionsRef.current, module, month), []);

  const finalize = useCallback(<TSnapshot,>(input: FinalizeModuleMonthInput<TSnapshot>): ModuleMonthCloseArchive<TSnapshot> | null => {
    const result = withModuleMonthLock(input.module, input.month, () =>
      finalizeModuleMonth(archivesRef.current, sessionsRef.current, input));
    if (!result?.archive) return null;
    persistArchives(result.archives);
    if (result.sessionIdsToRemove.length > 0) {
      persistSessions(sessionsRef.current.filter((session) => !result.sessionIdsToRemove.includes(session.id)));
    }
    return result.archive;
  }, [persistArchives, persistSessions, withModuleMonthLock]);

  const openAdjustment = useCallback((module: MonthCloseModule, month: string, reason: string): ModuleMonthAdjustment | null => {
    const session = withModuleMonthLock(module, month, () =>
      openModuleAdjustment(archivesRef.current, sessionsRef.current, module, month, reason));
    if (!session) return null;
    persistSessions([...sessionsRef.current, session]);
    return session;
  }, [persistSessions, withModuleMonthLock]);

  const discardAdjustment = useCallback((module: MonthCloseModule, month: string): boolean => {
    const result = withModuleMonthLock(module, month, () => {
      const existing = sessionsRef.current.find((session) => session.module === module && session.month === month);
      if (!existing) return false;
      persistSessions(sessionsRef.current.filter((session) => session.id !== existing.id));
      return true;
    });
    return result === true;
  }, [persistSessions, withModuleMonthLock]);

  const value = useMemo<ModuleMonthCloseStore>(() => ({
    archives,
    sessions,
    ready,
    getStatus,
    getCurrentArchive,
    getModuleSummary,
    isWritable,
    finalize,
    openAdjustment,
    discardAdjustment,
  }), [archives, sessions, ready, getStatus, getCurrentArchive, getModuleSummary, isWritable, finalize, openAdjustment, discardAdjustment]);

  return <ModuleMonthCloseContext.Provider value={value}>{children}</ModuleMonthCloseContext.Provider>;
}

export function useModuleMonthCloseStore(): ModuleMonthCloseStore {
  return useContext(ModuleMonthCloseContext);
}
