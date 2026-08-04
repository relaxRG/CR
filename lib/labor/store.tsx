/**
 * 人工成本管理 Store v3
 * 新增：特殊状态系统、加班换休逻辑、社保/公积金/个税、全局薪资设置
 * 修复：少休天数自动计算、考勤工资闭环
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import {
  Employee, ShiftEntry, MonthlyAttendance, PaySlip, MonthConfig,
  ShiftTemplate, HolidayConfig, PerformanceTemplate, PerformanceRecord,
  EmployeeGroup, CompOffBalance, SpecialStatus, GlobalPayrollSettings,
  CompOffBalanceEntry, HolidayCompOffEntry, UnexplainedRestAlert,
  calcDailyRate, calcAllowance, calcSocialInsurance, calcIncomeTax, calcFinalSalary,
  getDaysInMonth, parseMonth, getContractHoursForDate,
  calcCompOffExpiresMonth, getAvailableCompOffDays,
  DEFAULT_SHIFT_TEMPLATES, DEFAULT_EMPLOYEE_GROUPS, DEFAULT_SPECIAL_STATUSES,
  DEFAULT_GLOBAL_PAYROLL_SETTINGS,
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

// ─── 通用单值持久化 Hook ──────────────────────────────────────────────────────
function usePersistedValue<T>(key: string, defaultValue: T) {
  const [data, setData] = useState<T>(defaultValue);
  const [ready, setReady] = useState(false);
  const ref = useRef<T>(defaultValue);

  useEffect(() => {
    AsyncStorage.getItem(key).then((raw) => {
      if (raw) {
        try { const parsed = JSON.parse(raw) as T; ref.current = parsed; setData(parsed); } catch {}
      }
      setReady(true);
    });
  }, [key]);

  const persist = useCallback((next: T) => {
    ref.current = next;
    setData(next);
    AsyncStorage.setItem(key, JSON.stringify(next)).catch(console.error);
  }, [key]);

  return { data, ref, persist, ready };
}

// ─── 员工档案 Store ───────────────────────────────────────────────────────────
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
  const { data: employees, ref, persist, ready } = usePersisted<Employee>("labor_employees_v1");

  const addEmployee = useCallback((draft: Omit<Employee, "id" | "createdAt">): string => {
    const id = uuid();
    persist([...ref.current, { ...draft, id, createdAt: new Date().toISOString() }]);
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
interface EmployeeGroupStore {
  groups: EmployeeGroup[];
  addGroup: (draft: Omit<EmployeeGroup, "id">) => string;
  updateGroup: (id: string, patch: Partial<EmployeeGroup>) => void;
  deleteGroup: (id: string) => void;
  moveEmployeeToGroup: (employeeId: string, groupId: string) => void;
  reorderEmployeesInGroup: (groupId: string, orderedIds: string[]) => void;
  reorderGroups: (orderedIds: string[]) => void;
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
  const { data: groups, ref, persist, ready } = usePersisted<EmployeeGroup>("labor_employee_groups_v1", DEFAULT_EMPLOYEE_GROUPS);

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
      if (g.id === groupId) return { ...g, employeeIds: g.employeeIds.includes(employeeId) ? g.employeeIds : [...g.employeeIds, employeeId] };
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
interface ShiftTemplateStore {
  templates: ShiftTemplate[];
  upsertTemplate: (tpl: ShiftTemplate) => void;
  deleteTemplate: (id: string) => void;
  getTemplate: (session: string) => ShiftTemplate | undefined;
  ready: boolean;
}

const ShiftTemplateContext = createContext<ShiftTemplateStore>({
  templates: DEFAULT_SHIFT_TEMPLATES,
  upsertTemplate: () => {}, deleteTemplate: () => {},
  getTemplate: () => undefined, ready: false,
});

function ShiftTemplateProvider({ children }: { children: React.ReactNode }) {
  const { data: templates, ref, persist, ready } = usePersisted<ShiftTemplate>("labor_shift_templates_v1", DEFAULT_SHIFT_TEMPLATES);

  const upsertTemplate = useCallback((tpl: ShiftTemplate) => {
    const idx = ref.current.findIndex((t) => t.id === tpl.id);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = tpl; persist(next); }
    else persist([...ref.current, tpl]);
  }, [persist, ref]);

  const deleteTemplate = useCallback((id: string) => {
    persist(ref.current.filter((t) => t.id !== id));
  }, [persist, ref]);

  const getTemplate = useCallback((session: string) => ref.current.find((t) => t.session === session), [ref]);

  return (
    <ShiftTemplateContext.Provider value={{ templates, upsertTemplate, deleteTemplate, getTemplate, ready }}>
      {children}
    </ShiftTemplateContext.Provider>
  );
}

// ─── 特殊状态 Store ───────────────────────────────────────────────────────────
interface SpecialStatusStore {
  statuses: SpecialStatus[];
  upsertStatus: (status: SpecialStatus) => void;
  deleteStatus: (id: string) => void;
  getStatus: (id: string) => SpecialStatus | undefined;
  ready: boolean;
}

const SpecialStatusContext = createContext<SpecialStatusStore>({
  statuses: DEFAULT_SPECIAL_STATUSES,
  upsertStatus: () => {}, deleteStatus: () => {},
  getStatus: () => undefined, ready: false,
});

function SpecialStatusProvider({ children }: { children: React.ReactNode }) {
  const { data: statuses, ref, persist, ready } = usePersisted<SpecialStatus>("labor_special_statuses_v1", DEFAULT_SPECIAL_STATUSES);

  const upsertStatus = useCallback((status: SpecialStatus) => {
    const idx = ref.current.findIndex((s) => s.id === status.id);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = status; persist(next); }
    else persist([...ref.current, status]);
  }, [persist, ref]);

  const deleteStatus = useCallback((id: string) => {
    // 内置状态不可删除
    const target = ref.current.find((s) => s.id === id);
    if (target?.isBuiltin) return;
    persist(ref.current.filter((s) => s.id !== id));
  }, [persist, ref]);

  const getStatus = useCallback((id: string) => ref.current.find((s) => s.id === id), [ref]);

  return (
    <SpecialStatusContext.Provider value={{ statuses, upsertStatus, deleteStatus, getStatus, ready }}>
      {children}
    </SpecialStatusContext.Provider>
  );
}

// ─── 节假日配置 Store ─────────────────────────────────────────────────────────
interface HolidayConfigStore {
  holidays: HolidayConfig[];
  addHoliday: (draft: Omit<HolidayConfig, "id">) => string;
  updateHoliday: (id: string, patch: Partial<HolidayConfig>) => void;
  deleteHoliday: (id: string) => void;
  getHolidayForDate: (date: string, employeeId: string) => HolidayConfig | null;
  getMonthHolidayDays: (month: string, employeeId: string) => Array<{ date: string; multiplier: number }>;
  ready: boolean;
}

const HolidayConfigContext = createContext<HolidayConfigStore>({
  holidays: [], addHoliday: () => "", updateHoliday: () => {}, deleteHoliday: () => {},
  getHolidayForDate: () => null, getMonthHolidayDays: () => [], ready: false,
});

function HolidayConfigProvider({ children }: { children: React.ReactNode }) {
  const { data: holidays, ref, persist, ready } = usePersisted<HolidayConfig>("labor_holiday_configs_v1");

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
interface ShiftStore {
  shifts: ShiftEntry[];
  upsertShift: (entry: ShiftEntry) => void;
  batchUpsertShifts: (entries: ShiftEntry[]) => void;
  deleteShift: (employeeId: string, date: string, shift: string) => void;
  getShifts: (month: string) => ShiftEntry[];
  ready: boolean;
}

const ShiftContext = createContext<ShiftStore>({
  shifts: [], upsertShift: () => {}, batchUpsertShifts: () => {},
  deleteShift: () => {}, getShifts: () => [], ready: false,
});

function ShiftProvider({ children }: { children: React.ReactNode }) {
  const { data: shifts, ref, persist, ready } = usePersisted<ShiftEntry>("labor_shifts_v1");

  const upsertShift = useCallback((entry: ShiftEntry) => {
    const existing = ref.current.findIndex(
      (s) => s.employeeId === entry.employeeId && s.date === entry.date && s.shift === entry.shift
    );
    if (existing >= 0) { const next = [...ref.current]; next[existing] = entry; persist(next); }
    else persist([...ref.current, entry]);
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

  const deleteShift = useCallback((employeeId: string, date: string, shift: string) => {
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
interface AttendanceStore {
  records: MonthlyAttendance[];
  upsertAttendance: (record: MonthlyAttendance) => void;
  deleteAttendance: (id: string) => void;
  getAttendance: (employeeId: string, month: string) => MonthlyAttendance | null;
  /**
   * 从排班数据自动计算考勤汇总
   * 支持：差异化工时、特殊状态扣薪、加班换休、节假日、少休自动计算
   */
  calcFromShifts: (
    employeeId: string,
    month: string,
    employee: Employee,
    shifts: ShiftEntry[],
    specialStatuses: SpecialStatus[],
    holidayDays?: Array<{ date: string; multiplier: number }>
  ) => MonthlyAttendance;
  ready: boolean;
}

const AttendanceContext = createContext<AttendanceStore>({
  records: [], upsertAttendance: () => {}, deleteAttendance: () => {},
  getAttendance: () => null, calcFromShifts: () => ({} as MonthlyAttendance), ready: false,
});

function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const { data: records, ref, persist, ready } = usePersisted<MonthlyAttendance>("labor_attendance_v1");

  const upsertAttendance = useCallback((record: MonthlyAttendance) => {
    const idx = ref.current.findIndex((r) => r.employeeId === record.employeeId && r.month === record.month);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = record; persist(next); }
    else persist([...ref.current, record]);
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
    specialStatuses: SpecialStatus[],
    holidayDaysList: Array<{ date: string; multiplier: number }> = []
  ): MonthlyAttendance => {
    const { year, month: m } = parseMonth(month);
    const daysInMonth = getDaysInMonth(year, m);
    const empShifts = shifts.filter((s) => s.employeeId === employeeId && s.date.startsWith(month));

    // 应出勤天数（自动计算）
    const expectedAttendanceDays = Math.max(0, daysInMonth - employee.restDaysPerMonth);

    // 加班换休配置
    const hoursPerCompOff = employee.compOffRule?.hoursPerDay ?? 8;

    // 遍历排班记录，分类处理
    const daysSet = new Set<string>();
    let totalHours = 0;
    let stdHoursTotal = 0;
    let compOffCount = 0;
    let holidayBonus = 0;

    // 特殊状态扣薪明细
    const specialStatusDeductions: Record<string, { count: number; deduction: number; name: string; multiplier: number }> = {};

    // 先计算日薪（用于特殊状态扣薪）
    const dailyRate = calcDailyRate(employee.baseSalary, daysInMonth, employee.restDaysPerMonth);

    empShifts.forEach((s) => {
      const specialStatus = s.specialStatusId
        ? specialStatuses.find((ss) => ss.id === s.specialStatusId)
        : null;

      if (specialStatus) {
        // ── 特殊状态处理 ──
        if (specialStatus.category === "comp_off") {
          // 加班换休：不计实际工时，但按合同工时计入标准工时（避免加班时数虚高）
          compOffCount++;
          daysSet.add(s.date); // 加班换休那天算出勤（不扣薪）
          // 将该天的合同工时加入标准工时，使加班时数计算准确
          const contractH = getContractHoursForDate(employee, s.date);
          stdHoursTotal += contractH;
        } else if (specialStatus.category === "work_day") {
          // 节日上班：计工时，额外补偿
          const h = s.hoursValue;
          if (typeof h === "number" && h > 0) {
            daysSet.add(s.date);
            totalHours += h;
            const contractH = getContractHoursForDate(employee, s.date);
            stdHoursTotal += contractH;
            // 节日补偿 = 当天工时对应的日薪 × (倍率-1)
            const dayBonus = Math.round(dailyRate * (specialStatus.salaryMultiplier - 1) * 100) / 100;
            holidayBonus += dayBonus;
          }
        } else if (specialStatus.category === "absence") {
          // 缺席类：不计工时，按倍率扣薪
          // 排班表已自动少了1天出勤（不在 daysSet 里），额外扣薪 = (倍率-1) × 日薪
          // 例：旷工2倍 = 额外再扣1倍日薪；病假0.5倍 = 退回0.5倍日薪（负扣薪）
          const extraDeduction = Math.round((specialStatus.salaryMultiplier - 1) * dailyRate * 100) / 100;
          const key = specialStatus.id;
          if (!specialStatusDeductions[key]) {
            specialStatusDeductions[key] = { count: 0, deduction: 0, name: specialStatus.name, multiplier: specialStatus.salaryMultiplier };
          }
          specialStatusDeductions[key].count++;
          specialStatusDeductions[key].deduction += extraDeduction;
        }
      } else {
        // ── 正常工作班次 ──
        const h = s.hoursValue;
        if (typeof h === "number" && h > 0) {
          daysSet.add(s.date);
          totalHours += h;
          const contractH = getContractHoursForDate(employee, s.date);
          stdHoursTotal += contractH;
        }
      }
    });

    const attendanceDays = daysSet.size;
    const rawOvertimeHours = Math.max(0, totalHours - stdHoursTotal);
    // 加班换休消耗的加班时数
    const compOffHoursUsed = compOffCount * hoursPerCompOff;
    // 实际计费加班时数
    const paidOvertimeHours = Math.max(0, rawOvertimeHours - compOffHoursUsed);

    // 少休天数（自动计算）= 应出勤 - 实际出勤
    // 正数=缺席，负数=多出勤
    const underRestDays = expectedAttendanceDays - attendanceDays;

    // 特殊状态总扣薪
    const totalSpecialDeduction = Object.values(specialStatusDeductions)
      .reduce((s, v) => s + v.deduction, 0);

    // 加班工资
    const overtimePay = Math.round(paidOvertimeHours * employee.overtimeHourlyRate * 100) / 100;

    // 考勤工资 = 底薪 + 加班工资 - 特殊状态扣薪 + 节日补偿
    // 注意：少休天数已通过"实际出勤天数少"自然体现，不再单独扣款
    // （底薪是固定的，少出勤的扣款通过特殊状态的 absence 类型体现）
    let attendanceSalary: number;
    if (employee.type === "parttime") {
      attendanceSalary = Math.round(totalHours * employee.overtimeHourlyRate * 100) / 100;
    } else {
      attendanceSalary = Math.round(
        (employee.baseSalary + overtimePay - totalSpecialDeduction + holidayBonus) * 100
      ) / 100;
    }

    const existing = ref.current.find((r) => r.employeeId === employeeId && r.month === month);

    return {
      id: existing?.id ?? uuid(),
      employeeId,
      month,
      daysInMonth,
      attendanceDays,
      totalHours: Math.round(totalHours * 10) / 10,
      stdHours: Math.round(stdHoursTotal * 10) / 10,
      overtimeHours: Math.round(rawOvertimeHours * 10) / 10,
      compOffCount,
      hoursPerCompOff,
      paidOvertimeHours: Math.round(paidOvertimeHours * 10) / 10,
      expectedAttendanceDays,
      underRestDays,
      specialStatusDeductions,
      totalSpecialDeduction: Math.round(totalSpecialDeduction * 100) / 100,
      holidayBonus: Math.round(holidayBonus * 100) / 100,
      dailyRate,
      dailyRateOverride: existing?.dailyRateOverride ?? false,
      overtimePay,
      attendanceSalary,
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
  const { data: balances, ref, persist, ready } = usePersisted<CompOffBalance>("labor_comp_off_v1");

  const upsertBalance = useCallback((balance: CompOffBalance) => {
    const idx = ref.current.findIndex((b) => b.employeeId === balance.employeeId && b.month === balance.month);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = balance; persist(next); }
    else persist([...ref.current, balance]);
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
  const { data: templates, ref, persist, ready } = usePersisted<PerformanceTemplate>("labor_performance_templates_v1");

  const upsertTemplate = useCallback((tpl: PerformanceTemplate) => {
    const idx = ref.current.findIndex((t) => t.employeeId === tpl.employeeId);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = { ...tpl, updatedAt: new Date().toISOString() }; persist(next); }
    else persist([...ref.current, { ...tpl, updatedAt: new Date().toISOString() }]);
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
  const { data: records, ref, persist, ready } = usePersisted<PerformanceRecord>("labor_performance_records_v1");

  const upsertRecord = useCallback((record: PerformanceRecord) => {
    const idx = ref.current.findIndex((r) => r.employeeId === record.employeeId && r.month === record.month);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = { ...record, updatedAt: new Date().toISOString() }; persist(next); }
    else persist([...ref.current, { ...record, updatedAt: new Date().toISOString() }]);
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
interface PaySlipStore {
  paySlips: PaySlip[];
  upsertPaySlip: (slip: PaySlip) => void;
  deletePaySlip: (id: string) => void;
  getPaySlip: (employeeId: string, month: string) => PaySlip | null;
  /**
   * 从考勤+绩效+补贴+社保+个税自动生成薪资单草稿
   * 不覆盖已有的人工修改项
   */
  buildPaySlipDraft: (
    employee: Employee,
    month: string,
    attendance: MonthlyAttendance | null,
    performanceTotal: number,
    advanceAmount: number,
    globalSettings?: GlobalPayrollSettings,
    /** 年度累计已税收入（用于个税累计预扣法） */
    cumulativeIncome?: number,
    /** 年度累计已预扣税额 */
    cumulativeTaxPaid?: number,
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
  const { data: paySlips, ref, persist, ready } = usePersisted<PaySlip>("labor_payslips_v1");

  const upsertPaySlip = useCallback((slip: PaySlip) => {
    const idx = ref.current.findIndex((s) => s.employeeId === slip.employeeId && s.month === slip.month);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = { ...slip, updatedAt: new Date().toISOString() }; persist(next); }
    else persist([...ref.current, { ...slip, updatedAt: new Date().toISOString() }]);
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
    globalSettings?: GlobalPayrollSettings,
    cumulativeIncome: number = 0,
    cumulativeTaxPaid: number = 0,
  ): PaySlip => {
    const existing = ref.current.find((s) => s.employeeId === employee.id && s.month === month);
    const attendanceDays = attendance?.attendanceDays ?? 0;
    const attendanceSalary = attendance?.attendanceSalary ?? 0;

    // ── 补贴自动计算 ──
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

    // ── 应发薪资（税前）──
    const grossSalary = Math.round((
      attendanceSalary + performanceTotal +
      (existing?.salesCommission ?? 0) +
      transportAllowance + mealAllowance + otherAllowance +
      (existing?.rewardPenalty ?? 0)
    ) * 100) / 100;

    // ── 社保/公积金计算（双轨制：个人+公司）──
    const siConfig = employee.socialInsurance ?? globalSettings?.defaultSocialInsurance;
    const siEnabled = (siConfig?.enabled) || (globalSettings?.socialInsuranceEnabled ?? false);
    let socialInsuranceDeduction = existing?.socialInsuranceDeduction ?? 0;  // 个人部分
    let housingFundDeduction = existing?.housingFundDeduction ?? 0;           // 个人部分
    let employerSocialInsurance = existing?.employerSocialInsurance ?? 0;     // 公司部分
    let employerHousingFund = existing?.employerHousingFund ?? 0;             // 公司部分
    let socialInsuranceDetails = existing?.socialInsuranceDetails;
    let employerInsuranceDetails = existing?.employerInsuranceDetails;

    if (siEnabled && siConfig) {
      const si = calcSocialInsurance(grossSalary, { ...siConfig, enabled: true });
      // 个人部分（从工资扣）
      socialInsuranceDeduction = si.pension + si.medical + si.unemployment + si.workInjury + si.maternity;
      housingFundDeduction = si.housingFund;
      socialInsuranceDetails = {
        pension: si.pension,
        medical: si.medical,
        unemployment: si.unemployment,
        workInjury: si.workInjury,
        maternity: si.maternity,
      };
      // 公司部分（公司额外支出）
      employerSocialInsurance = si.employerPension + si.employerMedical + si.employerUnemployment + si.employerWorkInjury + si.employerMaternity;
      employerHousingFund = si.employerHousingFund;
      employerInsuranceDetails = {
        pension: si.employerPension,
        medical: si.employerMedical,
        unemployment: si.employerUnemployment,
        workInjury: si.employerWorkInjury,
        maternity: si.employerMaternity,
      };
    }

    // ── 个人所得税计算（累计预扣法）──
    // cumulativeIncome 和 cumulativeTaxPaid 由调用方从当年1月到上月的 paySlips 累加传入
    const taxConfig = employee.incomeTax ?? globalSettings?.defaultIncomeTax;
    const taxEnabled = (taxConfig?.enabled) || (globalSettings?.incomeTaxEnabled ?? false);
    let incomeTax = existing?.incomeTax ?? 0;
    let incomeTaxNote = existing?.incomeTaxNote ?? "";

    if (taxEnabled && taxConfig) {
      const totalDeductions = socialInsuranceDeduction + housingFundDeduction;
      // 本月应纳税所得额 = 应发 - 个人社保/公积金 - 起征点(5000) - 专项附加扣除
      const thisMonthTaxable = Math.max(0,
        grossSalary - totalDeductions - taxConfig.threshold - (taxConfig.specialDeductions ?? 0)
      );
      // 年度累计应纳税所得额（含本月，调用方已传入前几月的累计值）
      // cumulativeIncome 由调用方从历史 paySlips 计算，已是「应纳税所得额」
      const cumTaxableIncome = cumulativeIncome + thisMonthTaxable;
      // 传 0 给 cumulativeDeductions（已在 cumTaxableIncome 中扣除，不重复扣）
      const result = calcIncomeTax(
        cumTaxableIncome, 0, cumulativeTaxPaid,
        taxConfig.threshold, 0
      );
      incomeTax = result.tax;
      incomeTaxNote = result.note;
    }

    // ── 公司总人力成本 ──
    const totalEmployerCost = Math.round((
      grossSalary + employerSocialInsurance + employerHousingFund
    ) * 100) / 100;

    // ── 实发薪资（含预支扣除）──
    // 开启社保/个税时：实发 = 应发 - 社保个人 - 公积金个人 - 个税 - 预支
    // 关闭社保/个税时：实发 = 应发 - 预支
    const finalSalary = Math.round((
      grossSalary - socialInsuranceDeduction - housingFundDeduction - incomeTax - advanceAmount
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
      grossSalary,
      socialInsuranceDeduction,
      housingFundDeduction,
      incomeTax,
      finalSalary,
      employerSocialInsurance,
      employerHousingFund,
      totalEmployerCost,
      allowanceDetails,
      socialInsuranceDetails,
      employerInsuranceDetails,
      incomeTaxNote,
      updatedAt: new Date().toISOString(),
    };
  }, [ref]);

  return (
    <PaySlipContext.Provider value={{ paySlips, upsertPaySlip, deletePaySlip, getPaySlip, buildPaySlipDraft, ready }}>
      {children}
    </PaySlipContext.Provider>
  );
}

// ─── 全局薪资设置 Store ───────────────────────────────────────────────────────
interface GlobalPayrollSettingsStore {
  settings: GlobalPayrollSettings;
  updateSettings: (patch: Partial<GlobalPayrollSettings>) => void;
  ready: boolean;
}

const GlobalPayrollSettingsContext = createContext<GlobalPayrollSettingsStore>({
  settings: DEFAULT_GLOBAL_PAYROLL_SETTINGS,
  updateSettings: () => {},
  ready: false,
});

function GlobalPayrollSettingsProvider({ children }: { children: React.ReactNode }) {
  const { data: settingsArr, persist, ready } = usePersistedValue<GlobalPayrollSettings>(
    "labor_global_payroll_settings_v1",
    DEFAULT_GLOBAL_PAYROLL_SETTINGS
  );

  const updateSettings = useCallback((patch: Partial<GlobalPayrollSettings>) => {
    persist({ ...settingsArr, ...patch, updatedAt: new Date().toISOString() });
  }, [persist, settingsArr]);

  return (
    <GlobalPayrollSettingsContext.Provider value={{ settings: settingsArr, updateSettings, ready }}>
      {children}
    </GlobalPayrollSettingsContext.Provider>
  );
}

// ─── 月度设置 Provider ────────────────────────────────────────────────────────
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
  const { data: configs, ref, persist, ready } = usePersisted<MonthConfig>("labor_month_configs_v1");

  const upsertConfig = useCallback((config: MonthConfig) => {
    const idx = ref.current.findIndex((c) => c.month === config.month);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = config; persist(next); }
    else persist([...ref.current, config]);
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


// ─── 换休余额明细 Store（跨月累积，有效期3个月） ──────────────────────────────
interface CompOffBalanceEntryStore {
  entries: CompOffBalanceEntry[];
  /** 手动存入换休余额 */
  addEntry: (entry: Omit<CompOffBalanceEntry, "id" | "createdAt">) => void;
  /** 更新余额条目（如标记为已使用/已过期） */
  updateEntry: (id: string, patch: Partial<CompOffBalanceEntry>) => void;
  /** 获取某员工所有余额条目 */
  getEntries: (employeeId: string) => CompOffBalanceEntry[];
  /** 获取某员工在某月可用的余额总天数 */
  getAvailableDays: (employeeId: string, month: string) => number;
  /** 自动将过期余额标记为 expired */
  expireOldEntries: (currentMonth: string) => void;
  ready: boolean;
}

const CompOffBalanceEntryContext = createContext<CompOffBalanceEntryStore>({
  entries: [], addEntry: () => {}, updateEntry: () => {},
  getEntries: () => [], getAvailableDays: () => 0, expireOldEntries: () => {},
  ready: false,
});

function CompOffBalanceEntryProvider({ children }: { children: React.ReactNode }) {
  const { data: entries, ref, persist, ready } = usePersisted<CompOffBalanceEntry>("labor_comp_off_entries_v1");

  const addEntry = useCallback((entry: Omit<CompOffBalanceEntry, "id" | "createdAt">) => {
    const newEntry: CompOffBalanceEntry = {
      ...entry,
      id: uuid(),
      createdAt: new Date().toISOString(),
    };
    persist([...ref.current, newEntry]);
  }, [persist, ref]);

  const updateEntry = useCallback((id: string, patch: Partial<CompOffBalanceEntry>) => {
    const idx = ref.current.findIndex((e) => e.id === id);
    if (idx >= 0) {
      const next = [...ref.current];
      next[idx] = { ...next[idx], ...patch };
      persist(next);
    }
  }, [persist, ref]);

  const getEntries = useCallback((employeeId: string): CompOffBalanceEntry[] => {
    return ref.current.filter((e) => e.employeeId === employeeId);
  }, [ref]);

  const getAvailableDays = useCallback((employeeId: string, month: string): number => {
    return getAvailableCompOffDays(ref.current, employeeId, month);
  }, [ref]);

  const expireOldEntries = useCallback((currentMonth: string) => {
    const updated = ref.current.map((e) => {
      if (e.status === "available" && e.expiresMonth < currentMonth) {
        return { ...e, status: "expired" as const };
      }
      return e;
    });
    persist(updated);
  }, [persist, ref]);

  return (
    <CompOffBalanceEntryContext.Provider value={{ entries, addEntry, updateEntry, getEntries, getAvailableDays, expireOldEntries, ready }}>
      {children}
    </CompOffBalanceEntryContext.Provider>
  );
}

// ─── 节假日调休余额 Store ─────────────────────────────────────────────────────
interface HolidayCompOffStore {
  entries: HolidayCompOffEntry[];
  addEntry: (entry: Omit<HolidayCompOffEntry, "id" | "createdAt">) => void;
  updateEntry: (id: string, patch: Partial<HolidayCompOffEntry>) => void;
  getEntries: (employeeId: string) => HolidayCompOffEntry[];
  getAvailableDays: (employeeId: string, month: string) => number;
  expireOldEntries: (currentMonth: string) => void;
  ready: boolean;
}

const HolidayCompOffContext = createContext<HolidayCompOffStore>({
  entries: [], addEntry: () => {}, updateEntry: () => {},
  getEntries: () => [], getAvailableDays: () => 0, expireOldEntries: () => {},
  ready: false,
});

function HolidayCompOffProvider({ children }: { children: React.ReactNode }) {
  const { data: entries, ref, persist, ready } = usePersisted<HolidayCompOffEntry>("labor_holiday_comp_off_v1");

  const addEntry = useCallback((entry: Omit<HolidayCompOffEntry, "id" | "createdAt">) => {
    const newEntry: HolidayCompOffEntry = { ...entry, id: uuid(), createdAt: new Date().toISOString() };
    persist([...ref.current, newEntry]);
  }, [persist, ref]);

  const updateEntry = useCallback((id: string, patch: Partial<HolidayCompOffEntry>) => {
    const idx = ref.current.findIndex((e) => e.id === id);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = { ...next[idx], ...patch }; persist(next); }
  }, [persist, ref]);

  const getEntries = useCallback((employeeId: string): HolidayCompOffEntry[] => {
    return ref.current.filter((e) => e.employeeId === employeeId);
  }, [ref]);

  const getAvailableDays = useCallback((employeeId: string, month: string): number => {
    return ref.current
      .filter((e) => e.employeeId === employeeId && e.status === "available" && e.expiresMonth >= month)
      .reduce((sum, e) => sum + e.days, 0);
  }, [ref]);

  const expireOldEntries = useCallback((currentMonth: string) => {
    const updated = ref.current.map((e) =>
      e.status === "available" && e.expiresMonth < currentMonth ? { ...e, status: "expired" as const } : e
    );
    persist(updated);
  }, [persist, ref]);

  return (
    <HolidayCompOffContext.Provider value={{ entries, addEntry, updateEntry, getEntries, getAvailableDays, expireOldEntries, ready }}>
      {children}
    </HolidayCompOffContext.Provider>
  );
}

// ─── 无来源多休提醒 Store ─────────────────────────────────────────────────────
interface UnexplainedRestAlertStore {
  alerts: UnexplainedRestAlert[];
  upsertAlert: (alert: UnexplainedRestAlert) => void;
  getAlert: (employeeId: string, month: string) => UnexplainedRestAlert | null;
  resolveAlert: (employeeId: string, month: string, resolution: UnexplainedRestAlert["resolution"], notes?: string) => void;
  ready: boolean;
}

const UnexplainedRestAlertContext = createContext<UnexplainedRestAlertStore>({
  alerts: [], upsertAlert: () => {}, getAlert: () => null, resolveAlert: () => {}, ready: false,
});

function UnexplainedRestAlertProvider({ children }: { children: React.ReactNode }) {
  const { data: alerts, ref, persist, ready } = usePersisted<UnexplainedRestAlert>("labor_unexplained_rest_alerts_v1");

  const upsertAlert = useCallback((alert: UnexplainedRestAlert) => {
    const idx = ref.current.findIndex((a) => a.employeeId === alert.employeeId && a.month === alert.month);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = alert; persist(next); }
    else persist([...ref.current, alert]);
  }, [persist, ref]);

  const getAlert = useCallback((employeeId: string, month: string): UnexplainedRestAlert | null => {
    return ref.current.find((a) => a.employeeId === employeeId && a.month === month) ?? null;
  }, [ref]);

  const resolveAlert = useCallback((employeeId: string, month: string, resolution: UnexplainedRestAlert["resolution"], notes?: string) => {
    const idx = ref.current.findIndex((a) => a.employeeId === employeeId && a.month === month);
    if (idx >= 0) {
      const next = [...ref.current];
      next[idx] = { ...next[idx], resolution, notes: notes ?? next[idx].notes, updatedAt: new Date().toISOString() };
      persist(next);
    }
  }, [persist, ref]);

  return (
    <UnexplainedRestAlertContext.Provider value={{ alerts, upsertAlert, getAlert, resolveAlert, ready }}>
      {children}
    </UnexplainedRestAlertContext.Provider>
  );
}

// ─── 组合 Provider ────────────────────────────────────────────────────────────
export function LaborProvider({ children }: { children: React.ReactNode }) {
  return (
    <MonthConfigProvider>
      <EmployeeProvider>
        <EmployeeGroupProvider>
          <ShiftTemplateProvider>
            <SpecialStatusProvider>
              <HolidayConfigProvider>
                <ShiftProvider>
                  <AttendanceProvider>
                    <CompOffProvider>
                      <CompOffBalanceEntryProvider>
                        <HolidayCompOffProvider>
                          <UnexplainedRestAlertProvider>
                            <PaySlipProvider>
                              <PerformanceTemplateProvider>
                                <PerformanceRecordProvider>
                                  <GlobalPayrollSettingsProvider>
                                    {children}
                                  </GlobalPayrollSettingsProvider>
                                </PerformanceRecordProvider>
                              </PerformanceTemplateProvider>
                            </PaySlipProvider>
                          </UnexplainedRestAlertProvider>
                        </HolidayCompOffProvider>
                      </CompOffBalanceEntryProvider>
                    </CompOffProvider>
                  </AttendanceProvider>
                </ShiftProvider>
              </HolidayConfigProvider>
            </SpecialStatusProvider>
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
export function useSpecialStatusStore() { return useContext(SpecialStatusContext); }
export function useHolidayConfigStore() { return useContext(HolidayConfigContext); }
export function useAttendanceStore() { return useContext(AttendanceContext); }
export function useCompOffStore() { return useContext(CompOffContext); }
export function usePaySlipStore() { return useContext(PaySlipContext); }
export function usePerformanceTemplateStore() { return useContext(PerformanceTemplateContext); }
export function usePerformanceRecordStore() { return useContext(PerformanceRecordContext); }
export function useMonthConfigStore() { return useContext(MonthConfigContext); }
export function useGlobalPayrollSettingsStore() { return useContext(GlobalPayrollSettingsContext); }
export function useCompOffBalanceEntryStore() { return useContext(CompOffBalanceEntryContext); }
export function useHolidayCompOffStore() { return useContext(HolidayCompOffContext); }
export function useUnexplainedRestAlertStore() { return useContext(UnexplainedRestAlertContext); }
