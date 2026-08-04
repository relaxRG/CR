/**
 * 人工成本管理 Store v2
 * 新增：差异化工时、调休、节假日配置、绩效模板、绩效记录、员工分组、班次模板
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import {
  Employee, ShiftEntry, MonthlyAttendance, PaySlip, MonthConfig,
  ShiftTemplate, HolidayConfig, PerformanceTemplate, PerformanceRecord,
  EmployeeGroup, CompOffBalance,
  calcDailyRate, calcAttendanceSalary, calcAllowance, getDaysInMonth, parseMonth,
  getContractHoursForDate,
  DEFAULT_SHIFT_TEMPLATES, DEFAULT_EMPLOYEE_GROUPS,
} from "./types";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// ─── 通用持久化 Hook ──────────────────────────────────────────────────────────
function usePersisted<T>(key: string, defaultValue: T[] = []) {
  const [data, setData] = useState<T[]>(defaultValue);
  const [ready, setReady] = useState(false);
  const ref = useRef<T[]>(defaultValue);

  useEffect(() => {
    const load = () => AsyncStorage.getItem(key).then((raw) => {
      if (raw) {
        try { const parsed = JSON.parse(raw) as T[]; ref.current = parsed; setData(parsed); } catch {}
      }
      setReady(true);
    });
    load();
    return registerStoreReload(load);
  }, [key]);

  const persist = useCallback((next: T[]) => {
    ref.current = next;
    setData(next);
    AsyncStorage.setItem(key, JSON.stringify(next)).catch(console.error);
    notifySyncChange(key);
  }, [key]);

  return { data, ref, persist, ready };
}

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

// ─── 员工分组 Store ───────────────────────────────────────────────────────────
const EMP_GROUP_KEY = "labor_employee_groups_v1";

interface EmployeeGroupStore {
  groups: EmployeeGroup[];
  addGroup: (draft: Omit<EmployeeGroup, "id">) => string;
  updateGroup: (id: string, patch: Partial<EmployeeGroup>) => void;
  deleteGroup: (id: string) => void;
  /** 将员工移入某分组（自动从其他分组移除） */
  moveEmployeeToGroup: (employeeId: string, groupId: string) => void;
  /** 在分组内重新排序员工 */
  reorderEmployeesInGroup: (groupId: string, orderedIds: string[]) => void;
  /** 重新排序分组 */
  reorderGroups: (orderedIds: string[]) => void;
  /** 切换分组折叠状态 */
  toggleCollapse: (groupId: string) => void;
  ready: boolean;
}

const EmployeeGroupContext = createContext<EmployeeGroupStore>({
  groups: DEFAULT_EMPLOYEE_GROUPS,
  addGroup: () => "", updateGroup: () => {}, deleteGroup: () => {},
  moveEmployeeToGroup: () => {}, reorderEmployeesInGroup: () => {},
  reorderGroups: () => {}, toggleCollapse: () => {}, ready: false,
});

function EmployeeGroupProvider({ children }: { children: React.ReactNode }) {
  const { data: groups, ref, persist, ready } = usePersisted<EmployeeGroup>(EMP_GROUP_KEY, DEFAULT_EMPLOYEE_GROUPS);

  const addGroup = useCallback((draft: Omit<EmployeeGroup, "id">): string => {
    const id = uuid();
    persist([...ref.current, { ...draft, id }]);
    return id;
  }, [persist, ref]);

  const updateGroup = useCallback((id: string, patch: Partial<EmployeeGroup>) => {
    persist(ref.current.map((g) => g.id === id ? { ...g, ...patch } : g));
  }, [persist, ref]);

  const deleteGroup = useCallback((id: string) => {
    persist(ref.current.filter((g) => g.id !== id));
  }, [persist, ref]);

  const moveEmployeeToGroup = useCallback((employeeId: string, groupId: string) => {
    persist(ref.current.map((g) => {
      if (g.id === groupId) {
        return { ...g, employeeIds: g.employeeIds.includes(employeeId) ? g.employeeIds : [...g.employeeIds, employeeId] };
      }
      return { ...g, employeeIds: g.employeeIds.filter((id) => id !== employeeId) };
    }));
  }, [persist, ref]);

  const reorderEmployeesInGroup = useCallback((groupId: string, orderedIds: string[]) => {
    persist(ref.current.map((g) => g.id === groupId ? { ...g, employeeIds: orderedIds } : g));
  }, [persist, ref]);

  const reorderGroups = useCallback((orderedIds: string[]) => {
    const sorted = [...ref.current].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
    persist(sorted.map((g, i) => ({ ...g, sortOrder: i })));
  }, [persist, ref]);

  const toggleCollapse = useCallback((groupId: string) => {
    persist(ref.current.map((g) => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
  }, [persist, ref]);

  return (
    <EmployeeGroupContext.Provider value={{
      groups, addGroup, updateGroup, deleteGroup,
      moveEmployeeToGroup, reorderEmployeesInGroup, reorderGroups, toggleCollapse, ready,
    }}>
      {children}
    </EmployeeGroupContext.Provider>
  );
}

// ─── 班次模板 Store ───────────────────────────────────────────────────────────
const SHIFT_TPL_KEY = "labor_shift_templates_v1";

interface ShiftTemplateStore {
  templates: ShiftTemplate[];
  upsertTemplate: (tpl: ShiftTemplate) => void;
  deleteTemplate: (id: string) => void;
  getTemplate: (session: "午" | "晚") => ShiftTemplate | undefined;
  ready: boolean;
}

const ShiftTemplateContext = createContext<ShiftTemplateStore>({
  templates: DEFAULT_SHIFT_TEMPLATES,
  upsertTemplate: () => {}, deleteTemplate: () => {},
  getTemplate: () => undefined, ready: false,
});

function ShiftTemplateProvider({ children }: { children: React.ReactNode }) {
  const { data: templates, ref, persist, ready } = usePersisted<ShiftTemplate>(SHIFT_TPL_KEY, DEFAULT_SHIFT_TEMPLATES);

  const upsertTemplate = useCallback((tpl: ShiftTemplate) => {
    const idx = ref.current.findIndex((t) => t.id === tpl.id);
    if (idx >= 0) {
      const next = [...ref.current]; next[idx] = tpl; persist(next);
    } else {
      persist([...ref.current, tpl]);
    }
  }, [persist, ref]);

  const deleteTemplate = useCallback((id: string) => {
    persist(ref.current.filter((t) => t.id !== id));
  }, [persist, ref]);

  const getTemplate = useCallback((session: "午" | "晚") => {
    return ref.current.find((t) => t.session === session);
  }, [ref]);

  return (
    <ShiftTemplateContext.Provider value={{ templates, upsertTemplate, deleteTemplate, getTemplate, ready }}>
      {children}
    </ShiftTemplateContext.Provider>
  );
}

// ─── 节假日配置 Store ─────────────────────────────────────────────────────────
const HOLIDAY_KEY = "labor_holiday_configs_v1";

interface HolidayConfigStore {
  holidays: HolidayConfig[];
  addHoliday: (draft: Omit<HolidayConfig, "id">) => string;
  updateHoliday: (id: string, patch: Partial<HolidayConfig>) => void;
  deleteHoliday: (id: string) => void;
  /** 获取某日期适用的节假日配置（某员工） */
  getHolidayForDate: (date: string, employeeId: string) => HolidayConfig | null;
  /** 获取某月某员工的节假日天数和倍率 */
  getMonthHolidayDays: (month: string, employeeId: string) => Array<{ date: string; multiplier: number }>;
  ready: boolean;
}

const HolidayConfigContext = createContext<HolidayConfigStore>({
  holidays: [], addHoliday: () => "", updateHoliday: () => {}, deleteHoliday: () => {},
  getHolidayForDate: () => null, getMonthHolidayDays: () => [], ready: false,
});

function HolidayConfigProvider({ children }: { children: React.ReactNode }) {
  const { data: holidays, ref, persist, ready } = usePersisted<HolidayConfig>(HOLIDAY_KEY);

  const addHoliday = useCallback((draft: Omit<HolidayConfig, "id">): string => {
    const id = uuid();
    persist([...ref.current, { ...draft, id }]);
    return id;
  }, [persist, ref]);

  const updateHoliday = useCallback((id: string, patch: Partial<HolidayConfig>) => {
    persist(ref.current.map((h) => h.id === id ? { ...h, ...patch } : h));
  }, [persist, ref]);

  const deleteHoliday = useCallback((id: string) => {
    persist(ref.current.filter((h) => h.id !== id));
  }, [persist, ref]);

  const getHolidayForDate = useCallback((date: string, employeeId: string): HolidayConfig | null => {
    return ref.current.find((h) =>
      h.dates.includes(date) &&
      (h.applicableEmployeeIds.length === 0 || h.applicableEmployeeIds.includes(employeeId))
    ) ?? null;
  }, [ref]);

  const getMonthHolidayDays = useCallback((month: string, employeeId: string) => {
    const result: Array<{ date: string; multiplier: number }> = [];
    for (const h of ref.current) {
      if (h.applicableEmployeeIds.length > 0 && !h.applicableEmployeeIds.includes(employeeId)) continue;
      for (const d of h.dates) {
        if (d.startsWith(month)) result.push({ date: d, multiplier: h.multiplier });
      }
    }
    return result;
  }, [ref]);

  return (
    <HolidayConfigContext.Provider value={{
      holidays, addHoliday, updateHoliday, deleteHoliday,
      getHolidayForDate, getMonthHolidayDays, ready,
    }}>
      {children}
    </HolidayConfigContext.Provider>
  );
}

// ─── 排班 Store ───────────────────────────────────────────────────────────────
const SHIFT_KEY = "labor_shifts_v1";

interface ShiftStore {
  shifts: ShiftEntry[];
  upsertShift: (entry: ShiftEntry) => void;
  /** 批量保存（快速填充整行使用） */
  batchUpsertShifts: (entries: ShiftEntry[]) => void;
  deleteShift: (employeeId: string, date: string, shift: ShiftEntry["shift"]) => void;
  getShifts: (month: string) => ShiftEntry[];
  ready: boolean;
}

const ShiftContext = createContext<ShiftStore>({
  shifts: [], upsertShift: () => {}, batchUpsertShifts: () => {},
  deleteShift: () => {}, getShifts: () => [], ready: false,
});

function ShiftProvider({ children }: { children: React.ReactNode }) {
  const { data: shifts, ref, persist, ready } = usePersisted<ShiftEntry>(SHIFT_KEY);

  const upsertShift = useCallback((entry: ShiftEntry) => {
    const existing = ref.current.findIndex(
      (s) => s.employeeId === entry.employeeId && s.date === entry.date && s.shift === entry.shift
    );
    if (existing >= 0) {
      const next = [...ref.current]; next[existing] = entry; persist(next);
    } else {
      persist([...ref.current, entry]);
    }
  }, [persist, ref]);

  const batchUpsertShifts = useCallback((entries: ShiftEntry[]) => {
    let next = [...ref.current];
    for (const entry of entries) {
      const idx = next.findIndex(
        (s) => s.employeeId === entry.employeeId && s.date === entry.date && s.shift === entry.shift
      );
      if (idx >= 0) { next[idx] = entry; } else { next = [...next, entry]; }
    }
    persist(next);
  }, [persist, ref]);

  const deleteShift = useCallback((employeeId: string, date: string, shift: ShiftEntry["shift"]) => {
    persist(ref.current.filter((s) => !(s.employeeId === employeeId && s.date === date && s.shift === shift)));
  }, [persist, ref]);

  const getShifts = useCallback((month: string): ShiftEntry[] => {
    return ref.current.filter((s) => s.date.startsWith(month));
  }, [ref]);

  return (
    <ShiftContext.Provider value={{ shifts, upsertShift, batchUpsertShifts, deleteShift, getShifts, ready }}>
      {children}
    </ShiftContext.Provider>
  );
}

// ─── 考勤汇总 Store ───────────────────────────────────────────────────────────
const ATTEND_KEY = "labor_attendance_v1";

interface AttendanceStore {
  records: MonthlyAttendance[];
  upsertAttendance: (record: MonthlyAttendance) => void;
  deleteAttendance: (id: string) => void;
  getAttendance: (employeeId: string, month: string) => MonthlyAttendance | null;
  /**
   * 从排班数据自动计算考勤汇总（支持差异化工时、调休、节假日）
   * @param holidayDays 节假日天数列表（来自 HolidayConfigStore）
   */
  calcFromShifts: (
    employeeId: string,
    month: string,
    employee: Employee,
    shifts: ShiftEntry[],
    holidayDays?: Array<{ date: string; multiplier: number }>
  ) => MonthlyAttendance;
  ready: boolean;
}

const AttendanceContext = createContext<AttendanceStore>({
  records: [], upsertAttendance: () => {}, deleteAttendance: () => {},
  getAttendance: () => null, calcFromShifts: () => ({} as MonthlyAttendance), ready: false,
});

function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const { data: records, ref, persist, ready } = usePersisted<MonthlyAttendance>(ATTEND_KEY);

  const upsertAttendance = useCallback((record: MonthlyAttendance) => {
    const idx = ref.current.findIndex((r) => r.employeeId === record.employeeId && r.month === record.month);
    if (idx >= 0) {
      const next = [...ref.current]; next[idx] = record; persist(next);
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
    employeeId: string,
    month: string,
    employee: Employee,
    shifts: ShiftEntry[],
    holidayDaysList: Array<{ date: string; multiplier: number }> = []
  ): MonthlyAttendance => {
    const { year, month: m } = parseMonth(month);
    const daysInMonth = getDaysInMonth(year, m);
    const empShifts = shifts.filter((s) => s.employeeId === employeeId && s.date.startsWith(month));

    // 计算出勤天数、总工时、合同工时（差异化）、加班时间
    const daysSet = new Set<string>();
    let totalHours = 0;
    let stdHoursTotal = 0;
    let compOffHours = 0; // 换调休的加班时间

    empShifts.forEach((s) => {
      const h = s.hoursValue;
      if (typeof h === "number" && h > 0) {
        daysSet.add(s.date);
        totalHours += h;
        // 该天的合同工时
        const contractH = getContractHoursForDate(employee, s.date);
        stdHoursTotal += contractH;
        // 加班时间
        const dayOvertime = Math.max(0, h - contractH);
        if (dayOvertime > 0 && s.overtimeType === "comp_off") {
          compOffHours += dayOvertime;
        }
      }
    });

    const attendanceDays = daysSet.size;
    const overtimeHours = Math.max(0, totalHours - stdHoursTotal);
    const paidOvertimeHours = Math.max(0, overtimeHours - compOffHours);

    // 节假日天数（取最高倍率）
    const holidayDaysCount = holidayDaysList.filter((hd) => daysSet.has(hd.date)).length;
    const maxHolidayMultiplier = holidayDaysList.length > 0
      ? Math.max(...holidayDaysList.map((hd) => hd.multiplier))
      : employee.holidayMultiplier;

    const dailyRate = calcDailyRate(employee.baseSalary, daysInMonth, employee.restDaysPerMonth);
    const existing = ref.current.find((r) => r.employeeId === employeeId && r.month === month);

    const result = calcAttendanceSalary({
      type: employee.type,
      baseSalary: employee.baseSalary,
      dailyRate,
      totalHours,
      stdHoursPerDay: employee.stdHoursPerDay,
      attendanceDays,
      overtimeHourlyRate: employee.overtimeHourlyRate,
      underRestDays: existing?.underRestDays ?? 0,
      holidayDays: existing?.holidayDays ?? holidayDaysCount,
      holidayMultiplier: maxHolidayMultiplier,
      paidOvertimeHours,
    });

    return {
      id: existing?.id ?? uuid(),
      employeeId,
      month,
      daysInMonth,
      attendanceDays,
      totalHours: Math.round(totalHours * 10) / 10,
      stdHours: Math.round(stdHoursTotal * 10) / 10,
      overtimeHours: Math.round(overtimeHours * 10) / 10,
      compOffHours: Math.round(compOffHours * 10) / 10,
      paidOvertimeHours: Math.round(paidOvertimeHours * 10) / 10,
      underRestDays: existing?.underRestDays ?? 0,
      holidayDays: existing?.holidayDays ?? holidayDaysCount,
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

// ─── 调休余额 Store ───────────────────────────────────────────────────────────
const COMP_OFF_KEY = "labor_comp_off_v1";

interface CompOffStore {
  balances: CompOffBalance[];
  upsertBalance: (balance: CompOffBalance) => void;
  getBalance: (employeeId: string, month: string) => CompOffBalance | null;
  ready: boolean;
}

const CompOffContext = createContext<CompOffStore>({
  balances: [], upsertBalance: () => {}, getBalance: () => null, ready: false,
});

function CompOffProvider({ children }: { children: React.ReactNode }) {
  const { data: balances, ref, persist, ready } = usePersisted<CompOffBalance>(COMP_OFF_KEY);

  const upsertBalance = useCallback((balance: CompOffBalance) => {
    const idx = ref.current.findIndex((b) => b.employeeId === balance.employeeId && b.month === balance.month);
    if (idx >= 0) {
      const next = [...ref.current]; next[idx] = balance; persist(next);
    } else {
      persist([...ref.current, balance]);
    }
  }, [persist, ref]);

  const getBalance = useCallback((employeeId: string, month: string): CompOffBalance | null => {
    return ref.current.find((b) => b.employeeId === employeeId && b.month === month) ?? null;
  }, [ref]);

  return (
    <CompOffContext.Provider value={{ balances, upsertBalance, getBalance, ready }}>
      {children}
    </CompOffContext.Provider>
  );
}

// ─── 绩效模板 Store ───────────────────────────────────────────────────────────
const PERF_TPL_KEY = "labor_performance_templates_v1";

interface PerformanceTemplateStore {
  templates: PerformanceTemplate[];
  upsertTemplate: (tpl: PerformanceTemplate) => void;
  deleteTemplate: (id: string) => void;
  getTemplate: (employeeId: string) => PerformanceTemplate | null;
  ready: boolean;
}

const PerformanceTemplateContext = createContext<PerformanceTemplateStore>({
  templates: [], upsertTemplate: () => {}, deleteTemplate: () => {},
  getTemplate: () => null, ready: false,
});

function PerformanceTemplateProvider({ children }: { children: React.ReactNode }) {
  const { data: templates, ref, persist, ready } = usePersisted<PerformanceTemplate>(PERF_TPL_KEY);

  const upsertTemplate = useCallback((tpl: PerformanceTemplate) => {
    const idx = ref.current.findIndex((t) => t.employeeId === tpl.employeeId);
    if (idx >= 0) {
      const next = [...ref.current];
      next[idx] = { ...tpl, updatedAt: new Date().toISOString() };
      persist(next);
    } else {
      persist([...ref.current, { ...tpl, updatedAt: new Date().toISOString() }]);
    }
  }, [persist, ref]);

  const deleteTemplate = useCallback((id: string) => {
    persist(ref.current.filter((t) => t.id !== id));
  }, [persist, ref]);

  const getTemplate = useCallback((employeeId: string): PerformanceTemplate | null => {
    return ref.current.find((t) => t.employeeId === employeeId) ?? null;
  }, [ref]);

  return (
    <PerformanceTemplateContext.Provider value={{ templates, upsertTemplate, deleteTemplate, getTemplate, ready }}>
      {children}
    </PerformanceTemplateContext.Provider>
  );
}

// ─── 绩效月度记录 Store ───────────────────────────────────────────────────────
const PERF_RECORD_KEY = "labor_performance_records_v1";

interface PerformanceRecordStore {
  records: PerformanceRecord[];
  upsertRecord: (record: PerformanceRecord) => void;
  deleteRecord: (id: string) => void;
  getRecord: (employeeId: string, month: string) => PerformanceRecord | null;
  ready: boolean;
}

const PerformanceRecordContext = createContext<PerformanceRecordStore>({
  records: [], upsertRecord: () => {}, deleteRecord: () => {},
  getRecord: () => null, ready: false,
});

function PerformanceRecordProvider({ children }: { children: React.ReactNode }) {
  const { data: records, ref, persist, ready } = usePersisted<PerformanceRecord>(PERF_RECORD_KEY);

  const upsertRecord = useCallback((record: PerformanceRecord) => {
    const idx = ref.current.findIndex((r) => r.employeeId === record.employeeId && r.month === record.month);
    if (idx >= 0) {
      const next = [...ref.current];
      next[idx] = { ...record, updatedAt: new Date().toISOString() };
      persist(next);
    } else {
      persist([...ref.current, { ...record, updatedAt: new Date().toISOString() }]);
    }
  }, [persist, ref]);

  const deleteRecord = useCallback((id: string) => {
    persist(ref.current.filter((r) => r.id !== id));
  }, [persist, ref]);

  const getRecord = useCallback((employeeId: string, month: string): PerformanceRecord | null => {
    return ref.current.find((r) => r.employeeId === employeeId && r.month === month) ?? null;
  }, [ref]);

  return (
    <PerformanceRecordContext.Provider value={{ records, upsertRecord, deleteRecord, getRecord, ready }}>
      {children}
    </PerformanceRecordContext.Provider>
  );
}

// ─── 薪资单 Store ─────────────────────────────────────────────────────────────
const PAYSLIP_KEY = "labor_payslips_v1";

interface PaySlipStore {
  paySlips: PaySlip[];
  upsertPaySlip: (slip: PaySlip) => void;
  deletePaySlip: (id: string) => void;
  getPaySlip: (employeeId: string, month: string) => PaySlip | null;
  /**
   * 从考勤+绩效+补贴自动生成薪资单草稿
   * 不会覆盖已有的人工修改项（isOverride=true 的字段）
   */
  buildPaySlipDraft: (
    employee: Employee,
    month: string,
    attendance: MonthlyAttendance | null,
    performanceTotal: number,
    advanceAmount: number,
  ) => PaySlip;
  ready: boolean;
}

const PaySlipContext = createContext<PaySlipStore>({
  paySlips: [], upsertPaySlip: () => {}, deletePaySlip: () => {},
  getPaySlip: () => null,
  buildPaySlipDraft: () => ({} as PaySlip),
  ready: false,
});

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

  const buildPaySlipDraft = useCallback((
    employee: Employee,
    month: string,
    attendance: MonthlyAttendance | null,
    performanceTotal: number,
    advanceAmount: number,
  ): PaySlip => {
    const existing = ref.current.find((s) => s.employeeId === employee.id && s.month === month);
    const attendanceDays = attendance?.attendanceDays ?? 0;
    const attendanceSalary = attendance?.attendanceSalary ?? 0;

    // 自动计算补贴
    let mealAllowance = 0;
    let transportAllowance = 0;
    let otherAllowance = 0;
    const allowanceDetails: Record<string, { amount: number; autoNote: string; isOverride: boolean }> = {};

    if (employee.allowanceRules) {
      for (const rule of employee.allowanceRules) {
        if (!rule.enabled) continue;
        const { amount, autoNote } = calcAllowance(rule, attendanceDays);
        const existingDetail = existing?.allowanceDetails?.[rule.id];
        const isOverride = existingDetail?.isOverride ?? false;
        const finalAmount = isOverride ? (existingDetail?.amount ?? amount) : amount;

        allowanceDetails[rule.id] = { amount: finalAmount, autoNote, isOverride };

        if (rule.type === "transport_fixed") transportAllowance += finalAmount;
        else if (rule.type === "meal_per_day") mealAllowance += finalAmount;
        else otherAllowance += finalAmount;
      }
    }

    const finalSalary = Math.round((
      attendanceSalary + performanceTotal + transportAllowance + mealAllowance + otherAllowance +
      (existing?.salesCommission ?? 0) + (existing?.rewardPenalty ?? 0)
    ) * 100) / 100;

    return {
      id: existing?.id ?? uuid(),
      employeeId: employee.id,
      month,
      attendanceDays,
      attendanceSalary,
      performanceBonus: performanceTotal,
      salesCommission: existing?.salesCommission ?? 0,
      mealAllowance,
      transportAllowance,
      otherAllowance,
      rewardPenalty: existing?.rewardPenalty ?? 0,
      rewardPenaltyNote: existing?.rewardPenaltyNote ?? "",
      advanceAmount,
      notes: existing?.notes ?? "",
      finalSalary,
      allowanceDetails,
      updatedAt: new Date().toISOString(),
    };
  }, [ref]);

  return (
    <PaySlipContext.Provider value={{ paySlips, upsertPaySlip, deletePaySlip, getPaySlip, buildPaySlipDraft, ready }}>
      {children}
    </PaySlipContext.Provider>
  );
}

// ─── 月度设置 Provider ────────────────────────────────────────────────────────
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

function MonthConfigProvider({ children }: { children: React.ReactNode }) {
  const { data: configs, ref, persist, ready } = usePersisted<MonthConfig>(MONTH_CONFIG_KEY);

  const upsertConfig = useCallback((config: MonthConfig) => {
    const idx = ref.current.findIndex((c) => c.month === config.month);
    if (idx >= 0) {
      const next = [...ref.current]; next[idx] = config; persist(next);
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
        <EmployeeGroupProvider>
          <ShiftTemplateProvider>
            <HolidayConfigProvider>
              <ShiftProvider>
                <AttendanceProvider>
                  <CompOffProvider>
                    <PaySlipProvider>
                      <PerformanceTemplateProvider>
                        <PerformanceRecordProvider>
                          {children}
                        </PerformanceRecordProvider>
                      </PerformanceTemplateProvider>
                    </PaySlipProvider>
                  </CompOffProvider>
                </AttendanceProvider>
              </ShiftProvider>
            </HolidayConfigProvider>
          </ShiftTemplateProvider>
        </EmployeeGroupProvider>
      </EmployeeProvider>
    </MonthConfigProvider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
export function useEmployeeStore() { return useContext(EmployeeContext); }
export function useEmployeeGroupStore() { return useContext(EmployeeGroupContext); }
export function useShiftStore() { return useContext(ShiftContext); }
export function useShiftTemplateStore() { return useContext(ShiftTemplateContext); }
export function useHolidayConfigStore() { return useContext(HolidayConfigContext); }
export function useAttendanceStore() { return useContext(AttendanceContext); }
export function useCompOffStore() { return useContext(CompOffContext); }
export function usePaySlipStore() { return useContext(PaySlipContext); }
export function usePerformanceTemplateStore() { return useContext(PerformanceTemplateContext); }
export function usePerformanceRecordStore() { return useContext(PerformanceRecordContext); }
export function useMonthConfigStore() { return useContext(MonthConfigContext); }
