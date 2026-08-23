import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { notifySyncChange, registerStoreReload } from "@/lib/sync/engine";
import { createMonthCloseOperationGate } from "@/lib/labor/month-close-operation-gate";
import {
  buildFinalScheduleByDept,
  buildFrozenPayrollByEmployee,
  calculateArchiveAdjustments,
  getCurrentMonthCloseArchive,
  getMonthCloseStatus,
} from "@/lib/labor/month-close";
import type {
  AdjustmentSettleMethod,
  Employee,
  MonthAdjustmentSession,
  MonthCloseArchive,
  MonthCloseStatus,
  MonthlyAttendance,
  PaySlip,
  ShiftEntry,
} from "@/lib/labor/types";

const ARCHIVES_KEY = "labor_month_close_archives_v1";
const SESSIONS_KEY = "labor_month_adjustment_sessions_v1";
const EMPLOYEES_KEY = "labor_employees_v1";
const SHIFTS_KEY = "labor_shifts_v1";
const ATTENDANCES_KEY = "labor_attendance_v1";
const PAYSLIPS_KEY = "labor_payslips_v1";

function parseArray<T>(raw: string | null): T[] | null {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : null;
  } catch {
    return null;
  }
}

async function loadCommandFacts(): Promise<{
  employees: Employee[];
  shifts: ShiftEntry[];
  attendances: MonthlyAttendance[];
  paySlips: PaySlip[];
} | null> {
  const rows = await AsyncStorage.multiGet([EMPLOYEES_KEY, SHIFTS_KEY, ATTENDANCES_KEY, PAYSLIPS_KEY]);
  const byKey = new Map(rows);
  const employees = parseArray<Employee>(byKey.get(EMPLOYEES_KEY) ?? null);
  const shifts = parseArray<ShiftEntry>(byKey.get(SHIFTS_KEY) ?? null);
  const attendances = parseArray<MonthlyAttendance>(byKey.get(ATTENDANCES_KEY) ?? null);
  const paySlips = parseArray<PaySlip>(byKey.get(PAYSLIPS_KEY) ?? null);
  return employees && shifts && attendances && paySlips ? { employees, shifts, attendances, paySlips } : null;
}

type ReportMonthCloseStore = Readonly<{
  archives: readonly MonthCloseArchive[];
  sessions: readonly MonthAdjustmentSession[];
  getStatus: (month: string) => MonthCloseStatus;
  getCurrentArchive: (month: string) => MonthCloseArchive | null;
  getArchives: (month: string) => MonthCloseArchive[];
  getAdjustmentSession: (month: string) => MonthAdjustmentSession | null;
  isMonthLocked: (month: string) => boolean;
  isMonthWritable: (month: string) => boolean;
  finalizeMonthClose: (month: string, summary: MonthCloseArchive["summary"]) => Promise<MonthCloseArchive | null>;
  openAdjustmentSession: (month: string, reason: string, settleMethod: AdjustmentSettleMethod) => Promise<MonthAdjustmentSession | null>;
  discardAdjustmentSession: (month: string) => Promise<boolean>;
  applyArchivedSchedule: (month: string, archiveId: string) => Promise<boolean>;
  settleAdjustment: (month: string, adjustmentId: string, method: AdjustmentSettleMethod, settledInMonth: string) => Promise<void>;
  getPendingAdjustments: (month: string) => MonthCloseArchive["adjustments"];
  ready: boolean;
}>;

const ReportMonthCloseContext = createContext<ReportMonthCloseStore | null>(null);

/**
 * 报表的月结入口只管理归档/调整会话状态；涉及人力事实的操作在用户确认时一次性读取并写入。
 * 它不装配 Employee、Shift、Attendance 或 PaySlip 的可写 React Context，避免报表 Tab 形成隐式跨域订阅。
 */
export function ReportMonthCloseProvider({ children }: { children: React.ReactNode }) {
  const [archives, setArchives] = useState<MonthCloseArchive[]>([]);
  const [sessions, setSessions] = useState<MonthAdjustmentSession[]>([]);
  const [ready, setReady] = useState(false);
  const archivesRef = useRef<MonthCloseArchive[]>([]);
  const sessionsRef = useRef<MonthAdjustmentSession[]>([]);
  const gateRef = useRef(createMonthCloseOperationGate());

  const persistArchives = useCallback(async (next: MonthCloseArchive[]): Promise<boolean> => {
    try {
      await AsyncStorage.setItem(ARCHIVES_KEY, JSON.stringify(next));
      archivesRef.current = next;
      setArchives(next);
      notifySyncChange(ARCHIVES_KEY);
      return true;
    } catch (error) {
      console.warn("报告月结归档写入失败", error);
      return false;
    }
  }, []);
  const persistSessions = useCallback(async (next: MonthAdjustmentSession[]): Promise<boolean> => {
    try {
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
      sessionsRef.current = next;
      setSessions(next);
      notifySyncChange(SESSIONS_KEY);
      return true;
    } catch (error) {
      console.warn("报告月结调整会话写入失败", error);
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const rows = await AsyncStorage.multiGet([ARCHIVES_KEY, SESSIONS_KEY]);
      if (!active) return;
      const byKey = new Map(rows);
      const nextArchives = parseArray<MonthCloseArchive>(byKey.get(ARCHIVES_KEY) ?? null);
      const nextSessions = parseArray<MonthAdjustmentSession>(byKey.get(SESSIONS_KEY) ?? null);
      if (nextArchives) {
        archivesRef.current = nextArchives;
        setArchives(nextArchives);
      }
      if (nextSessions) {
        sessionsRef.current = nextSessions;
        setSessions(nextSessions);
      }
      setReady(nextArchives !== null && nextSessions !== null);
    };
    void refresh();
    const unregister = registerStoreReload(refresh);
    return () => { active = false; unregister(); };
  }, []);

  const getAdjustmentSession = useCallback((month: string) =>
    sessionsRef.current.find((session) => session.month === month && session.status === "open") ?? null, []);
  const getCurrentArchive = useCallback((month: string) =>
    getCurrentMonthCloseArchive(archivesRef.current, month), []);
  const getArchives = useCallback((month: string) =>
    archivesRef.current.filter((archive) => archive.month === month).sort((left, right) => right.version - left.version), []);
  const getStatus = useCallback((month: string): MonthCloseStatus =>
    getMonthCloseStatus(
      archivesRef.current,
      new Set(sessionsRef.current.filter((session) => session.status === "open").map((session) => session.month)),
      month,
    ), []);
  const isMonthLocked = useCallback((month: string) => getStatus(month) === "frozen", [getStatus]);
  const isMonthWritable = useCallback((month: string) => {
    const status = getStatus(month);
    return status === "draft" || status === "adjusting";
  }, [getStatus]);

  const finalizeMonthClose = useCallback(async (month: string, summary: MonthCloseArchive["summary"]) => {
    if (!gateRef.current.tryAcquire(month)) return null;
    try {
      const facts = await loadCommandFacts();
      if (!facts || getStatus(month) === "frozen") return null;
      const session = getAdjustmentSession(month);
      const baseArchive = session ? archivesRef.current.find((archive) => archive.id === session.baseArchiveId) : null;
      if (getStatus(month) === "adjusting" && (!session || !baseArchive || baseArchive.status !== "frozen")) return null;
      const activeEmployees = facts.employees.filter((employee) => employee.active && !employee.archived);
      const payrollByEmployee = buildFrozenPayrollByEmployee(facts.employees, facts.paySlips, month);
      const createdAt = Date.now();
      const version = Math.max(0, ...archivesRef.current.filter((archive) => archive.month === month).map((archive) => archive.version)) + 1;
      const nextArchive: MonthCloseArchive = {
        id: `close-${month}-${version}-${createdAt}`,
        month,
        version,
        status: "frozen",
        createdAt,
        closedBy: "manager",
        previousArchiveId: baseArchive?.id,
        summary,
        scheduleByDept: buildFinalScheduleByDept(activeEmployees, facts.shifts, month),
        payrollByEmployee,
        adjustments: baseArchive ? calculateArchiveAdjustments(baseArchive, payrollByEmployee, createdAt) : [],
      };
      const nextArchives = baseArchive
        ? archivesRef.current.map((archive) => archive.id === baseArchive.id
          ? { ...archive, status: "superseded" as const, supersededByArchiveId: nextArchive.id }
          : archive).concat(nextArchive)
        : [...archivesRef.current, nextArchive];
      if (!await persistArchives(nextArchives)) return null;
      if (session && !await persistSessions(sessionsRef.current.filter((item) => item.id !== session.id))) return null;
      return nextArchive;
    } catch (error) {
      console.warn("报告月结归档命令失败", error);
      return null;
    } finally {
      gateRef.current.release(month);
    }
  }, [getAdjustmentSession, getStatus, persistArchives, persistSessions]);

  const openAdjustmentSession = useCallback(async (month: string, reason: string, settleMethod: AdjustmentSettleMethod) => {
    if (!gateRef.current.tryAcquire(month)) return null;
    try {
      if (!reason.trim() || getAdjustmentSession(month)) return null;
      const archive = getCurrentArchive(month);
      if (!archive) return null;
      const facts = await loadCommandFacts();
      if (!facts) return null;
      const session: MonthAdjustmentSession = {
        id: `adjust-${month}-${Date.now()}`,
        month,
        baseArchiveId: archive.id,
        baseVersion: archive.version,
        status: "open",
        reason: reason.trim(),
        settleMethod,
        createdAt: Date.now(),
        createdBy: "manager",
        baseline: {
          shifts: facts.shifts.filter((shift) => shift.date.startsWith(month)).map((shift) => ({ ...shift })),
          attendances: facts.attendances.filter((record) => record.month === month).map((record) => ({ ...record })),
          paySlips: facts.paySlips.filter((slip) => slip.month === month).map((slip) => ({ ...slip })),
        },
      };
      return await persistSessions([...sessionsRef.current, session]) ? session : null;
    } catch (error) {
      console.warn("报告月结调整会话创建失败", error);
      return null;
    } finally {
      gateRef.current.release(month);
    }
  }, [getAdjustmentSession, getCurrentArchive, persistSessions]);

  const discardAdjustmentSession = useCallback(async (month: string) => {
    if (!gateRef.current.tryAcquire(month)) return false;
    try {
      const session = getAdjustmentSession(month);
      if (!session) return false;
      const facts = await loadCommandFacts();
      if (!facts) return false;
      const nextShifts = [...facts.shifts.filter((shift) => !shift.date.startsWith(month)), ...session.baseline.shifts];
      const nextAttendances = [...facts.attendances.filter((record) => record.month !== month), ...session.baseline.attendances];
      const nextPaySlips = [...facts.paySlips.filter((slip) => slip.month !== month), ...session.baseline.paySlips];
      await AsyncStorage.multiSet([
        [SHIFTS_KEY, JSON.stringify(nextShifts)],
        [ATTENDANCES_KEY, JSON.stringify(nextAttendances)],
        [PAYSLIPS_KEY, JSON.stringify(nextPaySlips)],
      ]);
      notifySyncChange(SHIFTS_KEY);
      notifySyncChange(ATTENDANCES_KEY);
      notifySyncChange(PAYSLIPS_KEY);
      return await persistSessions(sessionsRef.current.filter((item) => item.id !== session.id));
    } catch (error) {
      console.warn("报告月结调整恢复失败", error);
      return false;
    } finally {
      gateRef.current.release(month);
    }
  }, [getAdjustmentSession, persistSessions]);

  const applyArchivedSchedule = useCallback(async (month: string, archiveId: string) => {
    if (!gateRef.current.tryAcquire(month)) return false;
    try {
      if (!getAdjustmentSession(month)) return false;
      const archive = archivesRef.current.find((item) => item.id === archiveId && item.month === month && item.status === "frozen");
      if (!archive) return false;
      const facts = await loadCommandFacts();
      if (!facts) return false;
      const entries = Object.values(archive.scheduleByDept).flatMap((snapshot) => snapshot?.entries ?? []);
      await AsyncStorage.setItem(SHIFTS_KEY, JSON.stringify([...facts.shifts.filter((shift) => !shift.date.startsWith(month)), ...entries]));
      notifySyncChange(SHIFTS_KEY);
      return true;
    } catch (error) {
      console.warn("报告月结归档排班应用失败", error);
      return false;
    } finally {
      gateRef.current.release(month);
    }
  }, [getAdjustmentSession]);

  const settleAdjustment = useCallback(async (month: string, adjustmentId: string, method: AdjustmentSettleMethod, settledInMonth: string) => {
    if (!gateRef.current.tryAcquire(month)) return;
    try {
      const current = getCurrentArchive(month);
      if (!current) return;
      await persistArchives(archivesRef.current.map((archive) => archive.id !== current.id ? archive : {
        ...archive,
        adjustments: archive.adjustments.map((adjustment) => adjustment.id === adjustmentId
          ? { ...adjustment, settled: true, settleMethod: method, settledInMonth }
          : adjustment),
      }));
    } catch (error) {
      console.warn("报告月结差额结算失败", error);
    } finally {
      gateRef.current.release(month);
    }
  }, [getCurrentArchive, persistArchives]);

  const getPendingAdjustments = useCallback((month: string) =>
    getCurrentArchive(month)?.adjustments.filter((adjustment) => !adjustment.settled) ?? [], [getCurrentArchive]);

  const value = useMemo<ReportMonthCloseStore>(() => ({
    archives,
    sessions,
    getStatus,
    getCurrentArchive,
    getArchives,
    getAdjustmentSession,
    isMonthLocked,
    isMonthWritable,
    finalizeMonthClose,
    openAdjustmentSession,
    discardAdjustmentSession,
    applyArchivedSchedule,
    settleAdjustment,
    getPendingAdjustments,
    ready,
  }), [applyArchivedSchedule, archives, discardAdjustmentSession, finalizeMonthClose, getAdjustmentSession, getArchives, getCurrentArchive, getPendingAdjustments, getStatus, isMonthLocked, isMonthWritable, openAdjustmentSession, ready, sessions, settleAdjustment]);

  return <ReportMonthCloseContext.Provider value={value}>{children}</ReportMonthCloseContext.Provider>;
}

export function useReportMonthCloseStore(): ReportMonthCloseStore {
  const context = useContext(ReportMonthCloseContext);
  if (!context) throw new Error("useReportMonthCloseStore must be used inside ReportMonthCloseProvider");
  return context;
}
