/**
 * 人工成本管理 Store
 * 四个独立 Context：员工档案 / 排班 / 考勤汇总 / 薪资单
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Employee, ShiftEntry, MonthlyAttendance, PaySlip, MonthConfig,
  calcDailyRate, calcAttendanceSalary, calcFinalSalary, getDaysInMonth, parseMonth,
} from "./types";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── 员工档案 Store ───────────────────────────────────────────────────────────
const EMP_KEY = "labor_employees_v1";

interface EmployeeStore {
  employees: Employee[];
  addEmployee: (draft: Omit<Employee, "id" | "createdAt">) => string;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  deleteEmployee: (id: string) => void;
  ready: boolean;
}

const EmployeeContext = createContext<EmployeeStore>({
  employees: [], addEmployee: () => "", updateEmployee: () => {}, deleteEmployee: () => {}, ready: false,
});

// ─── 排班 Store ───────────────────────────────────────────────────────────────
const SHIFT_KEY = "labor_shifts_v1";

interface ShiftStore {
  shifts: ShiftEntry[];
  upsertShift: (entry: ShiftEntry) => void;
  deleteShift: (employeeId: string, date: string, shift: ShiftEntry["shift"]) => void;
  getShifts: (month: string, dept?: string) => ShiftEntry[];
  ready: boolean;
}

const ShiftContext = createContext<ShiftStore>({
  shifts: [], upsertShift: () => {}, deleteShift: () => {}, getShifts: () => [], ready: false,
});

// ─── 考勤汇总 Store ───────────────────────────────────────────────────────────
const ATTEND_KEY = "labor_attendance_v1";

interface AttendanceStore {
  records: MonthlyAttendance[];
  upsertAttendance: (record: MonthlyAttendance) => void;
  deleteAttendance: (id: string) => void;
  getAttendance: (employeeId: string, month: string) => MonthlyAttendance | null;
  /** 从排班数据自动计算考勤汇总 */
  calcFromShifts: (employeeId: string, month: string, employee: Employee, shifts: ShiftEntry[]) => MonthlyAttendance;
  ready: boolean;
}

const AttendanceContext = createContext<AttendanceStore>({
  records: [], upsertAttendance: () => {}, deleteAttendance: () => {},
  getAttendance: () => null, calcFromShifts: () => ({} as MonthlyAttendance), ready: false,
});

// ─── 薪资单 Store ─────────────────────────────────────────────────────────────
const PAYSLIP_KEY = "labor_payslips_v1";

interface PaySlipStore {
  paySlips: PaySlip[];
  upsertPaySlip: (slip: PaySlip) => void;
  deletePaySlip: (id: string) => void;
  getPaySlip: (employeeId: string, month: string) => PaySlip | null;
  ready: boolean;
}

const PaySlipContext = createContext<PaySlipStore>({
  paySlips: [], upsertPaySlip: () => {}, deletePaySlip: () => {}, getPaySlip: () => null, ready: false,
});

// ─── 月度设置 Store ───────────────────────────────────────────────────────────
const MONTH_CONFIG_KEY = "labor_month_configs_v1";

interface MonthConfigStore {
  configs: MonthConfig[];
  upsertConfig: (config: MonthConfig) => void;
  getConfig: (month: string) => MonthConfig | null;
  ready: boolean;
}

const MonthConfigContext = createContext<MonthConfigStore>({
  configs: [], upsertConfig: () => {}, getConfig: () => null, ready: false,
});

// ─── 通用持久化 Hook ──────────────────────────────────────────────────────────
function usePersisted<T>(key: string) {
  const [data, setData] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const ref = useRef<T[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(key).then((raw) => {
      if (raw) {
        try { const parsed = JSON.parse(raw) as T[]; ref.current = parsed; setData(parsed); } catch {}
      }
      setReady(true);
    });
  }, [key]);

  const persist = useCallback((next: T[]) => {
    ref.current = next;
    setData(next);
    AsyncStorage.setItem(key, JSON.stringify(next)).catch(console.error);
  }, [key]);

  return { data, ref, persist, ready };
}

// ─── 员工档案 Provider ────────────────────────────────────────────────────────
function EmployeeProvider({ children }: { children: React.ReactNode }) {
  const { data: employees, ref, persist, ready } = usePersisted<Employee>(EMP_KEY);

  const addEmployee = useCallback((draft: Omit<Employee, "id" | "createdAt">): string => {
    const id = uuid();
    const emp: Employee = { ...draft, id, createdAt: new Date().toISOString() };
    persist([...ref.current, emp]);
    return id;
  }, [persist, ref]);

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    persist(ref.current.map((e) => e.id === id ? { ...e, ...patch } : e));
  }, [persist, ref]);

  const deleteEmployee = useCallback((id: string) => {
    persist(ref.current.filter((e) => e.id !== id));
  }, [persist, ref]);

  return (
    <EmployeeContext.Provider value={{ employees, addEmployee, updateEmployee, deleteEmployee, ready }}>
      {children}
    </EmployeeContext.Provider>
  );
}

// ─── 排班 Provider ────────────────────────────────────────────────────────────
function ShiftProvider({ children }: { children: React.ReactNode }) {
  const { data: shifts, ref, persist, ready } = usePersisted<ShiftEntry>(SHIFT_KEY);

  const upsertShift = useCallback((entry: ShiftEntry) => {
    const existing = ref.current.findIndex(
      (s) => s.employeeId === entry.employeeId && s.date === entry.date && s.shift === entry.shift
    );
    if (existing >= 0) {
      const next = [...ref.current];
      next[existing] = entry;
      persist(next);
    } else {
      persist([...ref.current, entry]);
    }
  }, [persist, ref]);

  const deleteShift = useCallback((employeeId: string, date: string, shift: ShiftEntry["shift"]) => {
    persist(ref.current.filter((s) => !(s.employeeId === employeeId && s.date === date && s.shift === shift)));
  }, [persist, ref]);

  const getShifts = useCallback((month: string): ShiftEntry[] => {
    return ref.current.filter((s) => s.date.startsWith(month));
  }, [ref]);

  return (
    <ShiftContext.Provider value={{ shifts, upsertShift, deleteShift, getShifts, ready }}>
      {children}
    </ShiftContext.Provider>
  );
}

// ─── 考勤汇总 Provider ────────────────────────────────────────────────────────
function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const { data: records, ref, persist, ready } = usePersisted<MonthlyAttendance>(ATTEND_KEY);

  const upsertAttendance = useCallback((record: MonthlyAttendance) => {
    const idx = ref.current.findIndex((r) => r.employeeId === record.employeeId && r.month === record.month);
    if (idx >= 0) {
      const next = [...ref.current];
      next[idx] = record;
      persist(next);
    } else {
      persist([...ref.current, record]);
    }
  }, [persist, ref]);

  const deleteAttendance = useCallback((id: string) => {
    persist(ref.current.filter((r) => r.id !== id));
  }, [persist, ref]);

  const getAttendance = useCallback((employeeId: string, month: string): MonthlyAttendance | null => {
    return ref.current.find((r) => r.employeeId === employeeId && r.month === month) ?? null;
  }, [ref]);

  const calcFromShifts = useCallback((
    employeeId: string, month: string, employee: Employee, shifts: ShiftEntry[]
  ): MonthlyAttendance => {
    const { year, month: m } = parseMonth(month);
    const daysInMonth = getDaysInMonth(year, m);
    const empShifts = shifts.filter((s) => s.employeeId === employeeId && s.date.startsWith(month));

    // 计算出勤天数和总工时
    const daysSet = new Set<string>();
    let totalHours = 0;
    empShifts.forEach((s) => {
      const h = s.hoursValue;
      if (typeof h === "number" && h > 0) {
        daysSet.add(s.date);
        totalHours += h;
      }
    });
    const attendanceDays = daysSet.size;
    const stdHours = attendanceDays * employee.stdHoursPerDay;

    const dailyRate = calcDailyRate(employee.baseSalary, daysInMonth, employee.restDaysPerMonth);
    const result = calcAttendanceSalary({
      type: employee.type,
      baseSalary: employee.baseSalary,
      dailyRate,
      totalHours,
      stdHoursPerDay: employee.stdHoursPerDay,
      attendanceDays,
      overtimeHourlyRate: employee.overtimeHourlyRate,
      underRestDays: 0,
      holidayDays: 0,
      holidayMultiplier: employee.holidayMultiplier,
    });

    const existing = ref.current.find((r) => r.employeeId === employeeId && r.month === month);
    return {
      id: existing?.id ?? uuid(),
      employeeId,
      month,
      daysInMonth,
      attendanceDays,
      totalHours: Math.round(totalHours * 10) / 10,
      stdHours,
      overtimeHours: result.overtimeHours,
      underRestDays: existing?.underRestDays ?? 0,
      holidayDays: existing?.holidayDays ?? 0,
      dailyRate,
      dailyRateOverride: existing?.dailyRateOverride ?? false,
      overtimePay: result.overtimePay,
      underRestDeduction: result.underRestDeduction,
      holidayBonus: result.holidayBonus,
      attendanceSalary: result.attendanceSalary,
      notes: existing?.notes ?? "",
    };
  }, [ref]);

  return (
    <AttendanceContext.Provider value={{ records, upsertAttendance, deleteAttendance, getAttendance, calcFromShifts, ready }}>
      {children}
    </AttendanceContext.Provider>
  );
}

// ─── 薪资单 Provider ──────────────────────────────────────────────────────────
function PaySlipProvider({ children }: { children: React.ReactNode }) {
  const { data: paySlips, ref, persist, ready } = usePersisted<PaySlip>(PAYSLIP_KEY);

  const upsertPaySlip = useCallback((slip: PaySlip) => {
    const idx = ref.current.findIndex((s) => s.employeeId === slip.employeeId && s.month === slip.month);
    if (idx >= 0) {
      const next = [...ref.current];
      next[idx] = { ...slip, updatedAt: new Date().toISOString() };
      persist(next);
    } else {
      persist([...ref.current, { ...slip, updatedAt: new Date().toISOString() }]);
    }
  }, [persist, ref]);

  const deletePaySlip = useCallback((id: string) => {
    persist(ref.current.filter((s) => s.id !== id));
  }, [persist, ref]);

  const getPaySlip = useCallback((employeeId: string, month: string): PaySlip | null => {
    return ref.current.find((s) => s.employeeId === employeeId && s.month === month) ?? null;
  }, [ref]);

  return (
    <PaySlipContext.Provider value={{ paySlips, upsertPaySlip, deletePaySlip, getPaySlip, ready }}>
      {children}
    </PaySlipContext.Provider>
  );
}

// ─── 月度设置 Provider ────────────────────────────────────────────────────────
function MonthConfigProvider({ children }: { children: React.ReactNode }) {
  const { data: configs, ref, persist, ready } = usePersisted<MonthConfig>(MONTH_CONFIG_KEY);

  const upsertConfig = useCallback((config: MonthConfig) => {
    const idx = ref.current.findIndex((c) => c.month === config.month);
    if (idx >= 0) {
      const next = [...ref.current];
      next[idx] = config;
      persist(next);
    } else {
      persist([...ref.current, config]);
    }
  }, [persist, ref]);

  const getConfig = useCallback((month: string): MonthConfig | null => {
    return ref.current.find((c) => c.month === month) ?? null;
  }, [ref]);

  return (
    <MonthConfigContext.Provider value={{ configs, upsertConfig, getConfig, ready }}>
      {children}
    </MonthConfigContext.Provider>
  );
}

// ─── 组合 Provider ────────────────────────────────────────────────────────────
export function LaborProvider({ children }: { children: React.ReactNode }) {
  return (
    <MonthConfigProvider>
      <EmployeeProvider>
        <ShiftProvider>
          <AttendanceProvider>
            <PaySlipProvider>
              {children}
            </PaySlipProvider>
          </AttendanceProvider>
        </ShiftProvider>
      </EmployeeProvider>
    </MonthConfigProvider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
export function useEmployeeStore() { return useContext(EmployeeContext); }
export function useShiftStore() { return useContext(ShiftContext); }
export function useAttendanceStore() { return useContext(AttendanceContext); }
export function usePaySlipStore() { return useContext(PaySlipContext); }
export function useMonthConfigStore() { return useContext(MonthConfigContext); }
