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
  ShiftTemplate, HolidayConfig,
  SpecialStatus, GlobalPayrollSettings,
  CompOffBalanceEntry, HolidayCompOffEntry, UnexplainedRestAlert,
  CustomDept, BusinessHoursEntry, ShiftGroup, FillPreset,
  ScheduleSnapshot, DeptCategory,
  calcDailyRate, calcAllowance, calcSocialInsurance, calcIncomeTax,
  getDaysInMonth, parseMonth, getContractHoursForDate,
  calcCompOffExpiresMonth, getAvailableCompOffDays,
  DEFAULT_SHIFT_TEMPLATES, DEFAULT_SPECIAL_STATUSES,
  DEFAULT_GLOBAL_PAYROLL_SETTINGS, DEFAULT_CUSTOM_DEPTS,
  DEFAULT_BUSINESS_HOURS, DEFAULT_SHIFT_GROUPS,
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
  /** 删除员工档案（不删除历史排班/薪资数据） */
  deleteEmployee: (id: string) => void;
  /** 归档员工（离职归档）：从主列表和排班表消失，历史数据保留 */
  archiveEmployee: (id: string) => void;
  /** 恢复归档员工为在职 */
  restoreEmployee: (id: string) => void;
  /** 重新排序同部门员工（拖拽排序后调用） */
  reorderEmployees: (orderedIds: string[]) => void;
  ready: boolean;
}

const EmployeeContext = createContext<EmployeeStore>({
  employees: [], addEmployee: () => "", updateEmployee: () => {}, deleteEmployee: () => {},
  archiveEmployee: () => {}, restoreEmployee: () => {}, reorderEmployees: () => {}, ready: false,
});

function EmployeeProvider({ children }: { children: React.ReactNode }) {
  const { data: employees, ref, persist, ready } = usePersisted<Employee>("labor_employees_v1");

  // 持久化迁移：清除废弃的 defaultSession 字段
  React.useEffect(() => {
    if (!ready) return;
    const needsMigration = ref.current.some((e) =>
      "defaultSession" in e ||
      "address" in e ||
      "idCardImageUri" in e ||
      "healthCertImageUri" in e ||
      "weeklyHours" in e
    );
    if (needsMigration) {
      console.log("[EmployeeProvider] 持久化迁移：清除废弃字段、迁移旧字段");
      persist(ref.current.map((e) => {
        const next: any = { ...e };
        // 删除 defaultSession
        delete next.defaultSession;
        // address 迁移为 actualAddress
        if ("address" in next && !next.actualAddress) {
          next.actualAddress = next.address;
        }
        delete next.address;
        // idCardImageUri 迁移为 idCardFrontUrl
        if ("idCardImageUri" in next && !next.idCardFrontUrl) {
          next.idCardFrontUrl = next.idCardImageUri;
        }
        delete next.idCardImageUri;
        // healthCertImageUri 迁移为 healthCertUrl
        if ("healthCertImageUri" in next && !next.healthCertUrl) {
          next.healthCertUrl = next.healthCertImageUri;
        }
        delete next.healthCertImageUri;
        // weeklyHours（旧版 Map 格式）迁移为 weeklyHoursRules（新版规则数组）
        if ("weeklyHours" in next && next.weeklyHours && !next.weeklyHoursRules?.length) {
          const map = next.weeklyHours as Record<number, number | null>;
          const rules: Array<{ id: string; fromDay: number; toDay: number; hours: number }> = [];
          // 将连续相同工时的天合并为一条规则
          let i = 1; // 从周一开始
          while (i <= 7) {
            const dow = i % 7; // 0=周日, 1=周一, ..., 6=周六
            const h = map[dow];
            if (h !== null && h !== undefined && h > 0) {
              let j = i + 1;
              while (j <= 7) {
                const nextDow = j % 7;
                if (map[nextDow] === h) j++;
                else break;
              }
              const toDow = (j - 1) % 7;
              rules.push({ id: `migrated_${i}`, fromDay: dow, toDay: toDow, hours: h });
              i = j;
            } else {
              i++;
            }
          }
          if (rules.length > 0) next.weeklyHoursRules = rules;
        }
        delete next.weeklyHours;
        return next;
      }));
    }
  }, [ready]);

  const addEmployee = useCallback((draft: Omit<Employee, "id" | "createdAt">): string => {
    const id = uuid();
    // 新员工自动分配 sortOrder（同部门内最大值+1）
    const sameDept = ref.current.filter((e) => e.dept === draft.dept);
    const maxOrder = sameDept.reduce((max, e) => Math.max(max, e.sortOrder ?? 0), -1);
    persist([...ref.current, { ...draft, id, sortOrder: maxOrder + 1, createdAt: new Date().toISOString() }]);
    return id;
  }, [persist, ref]);

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    persist(ref.current.map((e) => e.id === id ? { ...e, ...patch } : e));
  }, [persist, ref]);

  const deleteEmployee = useCallback((id: string) => {
    persist(ref.current.filter((e) => e.id !== id));
  }, [persist, ref]);

  // 归档员工：标记 archived=true，保留所有历史数据
  const archiveEmployee = useCallback((id: string) => {
    persist(ref.current.map((e) => e.id === id
      ? { ...e, archived: true, archivedAt: new Date().toISOString() }
      : e
    ));
  }, [persist, ref]);

  // 恢复归档员工为在职
  const restoreEmployee = useCallback((id: string) => {
    persist(ref.current.map((e) => e.id === id
      ? { ...e, archived: false, archivedAt: undefined }
      : e
    ));
  }, [persist, ref]);

  // 拖拽排序：根据传入的 id 顺序更新同部门员工的 sortOrder
  const reorderEmployees = useCallback((orderedIds: string[]) => {
    const next = [...ref.current];
    orderedIds.forEach((id, idx) => {
      const i = next.findIndex((e) => e.id === id);
      if (i >= 0) next[i] = { ...next[i], sortOrder: idx };
    });
    persist(next);
  }, [persist, ref]);

  const employeeContextValue = React.useMemo(
    () => ({ employees, addEmployee, updateEmployee, deleteEmployee, archiveEmployee, restoreEmployee, reorderEmployees, ready }),
    [employees, addEmployee, updateEmployee, deleteEmployee, archiveEmployee, restoreEmployee, reorderEmployees, ready]
  );
  return (
    <EmployeeContext.Provider value={employeeContextValue}>
      {children}
    </EmployeeContext.Provider>
  );
}

// ─── 自定义部门 Store ─────────────────────────────────────────────────────────
interface CustomDeptStore {
  depts: CustomDept[];
  addDept: (draft: Omit<CustomDept, "id">) => string;
  updateDept: (id: string, patch: Partial<CustomDept>) => void;
  deleteDept: (id: string) => void;
  getDept: (id: string) => CustomDept | undefined;
  resolveEmployeeDept: (emp: Employee) => CustomDept;
  ready: boolean;
}

const CustomDeptContext = createContext<CustomDeptStore>({
  depts: DEFAULT_CUSTOM_DEPTS,
  addDept: () => "", updateDept: () => {}, deleteDept: () => {},
  getDept: () => undefined, resolveEmployeeDept: () => DEFAULT_CUSTOM_DEPTS[0], ready: false,
});

function CustomDeptProvider({ children }: { children: React.ReactNode }) {
  const { data: depts, ref, persist, ready } = usePersisted<CustomDept>("labor_custom_depts_v1", DEFAULT_CUSTOM_DEPTS);

  const addDept = useCallback((draft: Omit<CustomDept, "id">): string => {
    const id = "dept_" + uuid();
    persist([...ref.current, { ...draft, id }]);
    return id;
  }, [persist, ref]);

  const updateDept = useCallback((id: string, patch: Partial<CustomDept>) => {
    persist(ref.current.map((d) => d.id === id ? { ...d, ...patch } : d));
  }, [persist, ref]);

  const deleteDept = useCallback((id: string) => {
    persist(ref.current.filter((d) => d.id !== id));
  }, [persist, ref]);

  const getDept = useCallback((id: string) => ref.current.find((d) => d.id === id), [ref]);

  const resolveEmployeeDept = useCallback((emp: Employee): CustomDept => {
    if (emp.customDeptId) {
      const found = ref.current.find((d) => d.id === emp.customDeptId);
      if (found) return found;
    }
    const legacyMap: Record<string, string> = { front: "dept_front", kitchen: "dept_kitchen", parttime: "dept_front", other: "dept_company" };
    const mappedId = legacyMap[emp.dept] ?? "dept_front";
    return ref.current.find((d) => d.id === mappedId) ?? ref.current[0] ?? DEFAULT_CUSTOM_DEPTS[0];
  }, [ref]);

  return (
    <CustomDeptContext.Provider value={{ depts, addDept, updateDept, deleteDept, getDept, resolveEmployeeDept, ready }}>
      {children}
    </CustomDeptContext.Provider>
  );
}

export const useCustomDeptStore = () => useContext(CustomDeptContext);

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

  // 迁移旧数据：确保三种新调休换休状态存在
  React.useEffect(() => {
    if (!ready) return;
    const ids = new Set(ref.current.map((s) => s.id));
    const missing = DEFAULT_SPECIAL_STATUSES.filter((s) => !ids.has(s.id));
    if (missing.length > 0) {
      console.log("[SpecialStatusProvider] 迁移旧数据，补充缺失的内置状态:", missing.map((s) => s.id));
      persist([...ref.current, ...missing]);
    }
  }, [ready]);

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
  /** 批量删除排班记录（一次性写入，避免竞态条件） */
  batchDeleteShifts: (keys: Array<{ employeeId: string; date: string; shift: string }>) => void;
  getShifts: (month: string) => ShiftEntry[];
  ready: boolean;
}

const ShiftContext = createContext<ShiftStore>({
  shifts: [], upsertShift: () => {}, batchUpsertShifts: () => {},
  deleteShift: () => {}, batchDeleteShifts: () => {}, getShifts: () => [], ready: false,
});

/**
 * 持久化迁移旧排班数据：
 * 1. shift="day"/"evening"/"both"/"午"/"晚" → "午班"/"晚班"
 * 2. 清除废弃字段 sessionValue 和 overtimeType
 */
function migrateShiftEntries(entries: ShiftEntry[]): { migrated: ShiftEntry[]; changed: boolean } {
  let changed = false;
  const migrated = entries.map((e) => {
    let next = { ...e };
    let dirty = false;

    // 1. 迁移旧 shift 名称
    const oldShift = next.shift;
    if (oldShift === "day" || oldShift === "午") { next.shift = "午班"; dirty = true; }
    else if (oldShift === "evening" || oldShift === "晚") { next.shift = "晚班"; dirty = true; }
    else if (oldShift === "both") { next.shift = "午班"; dirty = true; }

    // 2. 删除废弃字段
    if ("sessionValue" in next) { delete (next as any).sessionValue; dirty = true; }
    if ("overtimeType" in next) { delete (next as any).overtimeType; dirty = true; }

    if (dirty) changed = true;
    return next;
  });
  return { migrated, changed };
}

function ShiftProvider({ children }: { children: React.ReactNode }) {
  const { data: shifts, ref, persist, ready } = usePersisted<ShiftEntry>("labor_shifts_v1");

  // 数据加载后自动持久化迁移旧数据
  React.useEffect(() => {
    if (!ready) return;
    const { migrated, changed } = migrateShiftEntries(ref.current);
    if (changed) {
      console.log("[ShiftProvider] 持久化迁移旧排班数据：day/evening→午班/晚班，清除废弃字段");
      persist(migrated);
    }
  }, [ready]);

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

  // 批量删除：一次性过滤所有需要删除的记录，只写入一次，避免竞态条件
  const batchDeleteShifts = useCallback((keys: Array<{ employeeId: string; date: string; shift: string }>) => {
    if (keys.length === 0) return;
    const keySet = new Set(keys.map((k) => `${k.employeeId}|${k.date}|${k.shift}`));
    persist(ref.current.filter((s) => !keySet.has(`${s.employeeId}|${s.date}|${s.shift}`)));
  }, [persist, ref]);

  const getShifts = useCallback((month: string): ShiftEntry[] => {
    return ref.current.filter((s) => s.date.startsWith(month));
  }, [ref]);

  return (
    <ShiftContext.Provider value={{ shifts, upsertShift, batchUpsertShifts, deleteShift, batchDeleteShifts, getShifts, ready }}>
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
        // ── 三字段驱动引擎：direction + countAsAttendance + salaryMultiplier ──
        const dir = specialStatus.direction;
        const countsAsAtt = specialStatus.countAsAttendance;
        const isCompOff = specialStatus.category === "comp_off";

        if (isCompOff) {
          // 加班换休：算出勤，不计实际工时，合同工时加入标准工时（避免加班时数虚高）
          compOffCount++;
          daysSet.add(s.date);
          const contractH = getContractHoursForDate(employee, s.date);
          stdHoursTotal += contractH;
        } else if (countsAsAtt) {
          // 算出勤的特殊状态（如节日上班、违规扣款但上了班）
          const h = s.hoursValue;
          if (typeof h === "number" && h > 0) {
            daysSet.add(s.date);
            totalHours += h;
            const contractH = getContractHoursForDate(employee, s.date);
            stdHoursTotal += contractH;
          } else {
            // 无工时但标记为算出勤
            daysSet.add(s.date);
            const contractH = getContractHoursForDate(employee, s.date);
            stdHoursTotal += contractH;
          }
          // 按方向计算额外调整
          if (dir === "positive" && specialStatus.salaryMultiplier > 1) {
            // 正向补偿：额外给 (multiplier-1) 倍日薪
            const dayBonus = Math.round(dailyRate * (specialStatus.salaryMultiplier - 1) * 100) / 100;
            holidayBonus += dayBonus;
          } else if (dir === "negative") {
            // 负向惩罚（上了班但违规）：额外扣 multiplier 倍日薪
            const extraDeduction = Math.round(specialStatus.salaryMultiplier * dailyRate * 100) / 100;
            const key = specialStatus.id;
            if (!specialStatusDeductions[key]) {
              specialStatusDeductions[key] = { count: 0, deduction: 0, name: specialStatus.name, multiplier: specialStatus.salaryMultiplier };
            }
            specialStatusDeductions[key].count++;
            specialStatusDeductions[key].deduction += extraDeduction;
          }
          // neutral：不加不扣
        } else {
          // 不算出勤的特殊状态（如缺席、休息）
          // 该天不加入 daysSet → 比例底薪自然少1天
          if (dir === "negative") {
            // 负向缺席：额外调整 = (multiplier - 1) × 日薪
            // 旷工2x → 额外扣(2-1)=1天；病假0.5x → 退回(1-0.5)=0.5天；事假1x → 无额外调整
            const extraDeduction = Math.round((specialStatus.salaryMultiplier - 1) * dailyRate * 100) / 100;
            if (extraDeduction !== 0) {
              const key = specialStatus.id;
              if (!specialStatusDeductions[key]) {
                specialStatusDeductions[key] = { count: 0, deduction: 0, name: specialStatus.name, multiplier: specialStatus.salaryMultiplier };
              }
              specialStatusDeductions[key].count++;
              specialStatusDeductions[key].deduction += extraDeduction;
            }
          } else if (dir === "positive") {
            // 正向不出勤（如年假：不出勤但不扣薪）：退回1天日薪抵消比例底薪已少的那天
            const refund = Math.round(specialStatus.salaryMultiplier * dailyRate * 100) / 100;
            if (refund !== 0) {
              const key = specialStatus.id;
              if (!specialStatusDeductions[key]) {
                specialStatusDeductions[key] = { count: 0, deduction: 0, name: specialStatus.name, multiplier: specialStatus.salaryMultiplier };
              }
              specialStatusDeductions[key].count++;
              specialStatusDeductions[key].deduction -= refund; // 负数 = 退款
            }
          }
          // neutral 不出勤（如普通休息）：无额外调整
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

    /**
     * 考勤工资计算逻辑（按实际出勤天数比例）
     *
     * 全职员工：
     *   底薪比例 = baseSalary × (实际出勤天数 / 应出勤天数)
     *   实际出勤天数 = 有工时天数 + 加班换休天数 + 节假日调休天数（这些天已在 daysSet 里）
     *   特殊状态只处理额外惩罚/补偿：
     *     - 旷工 2x：该天已不在出勤（比例已扣1天），额外再扣 (2-1)=1 天日薪
     *     - 病假 0.5x：该天已不在出勤（比例已扣1天），退回 (1-0.5)=0.5 天日薪
     *     - 事假 1x：该天已不在出勤（比例已扣），无额外调整
     *
     * 兼职员工：按实际工时 × 时薪（不受出勤天数影响）
     */
    let attendanceSalary: number;
    if (employee.type === "parttime") {
      attendanceSalary = Math.round(totalHours * employee.overtimeHourlyRate * 100) / 100;
    } else {
      // 按实际出勤天数比例计算底薪
      const proportionalBase = expectedAttendanceDays > 0
        ? Math.round((employee.baseSalary * attendanceDays / expectedAttendanceDays) * 100) / 100
        : employee.baseSalary;
      // 考勤工资 = 比例底薪 + 加班工资 + 特殊状态额外调整 + 节日补偿
      // totalSpecialDeduction 是额外惩罚（无来源多休已通过比例底薪自然体现）
      attendanceSalary = Math.round(
        (proportionalBase + overtimePay - totalSpecialDeduction + holidayBonus) * 100
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
      // 加班超时提醒：加班时数超过4h时提醒员工存入调休
      overtimeAlertHours: rawOvertimeHours >= 4 ? Math.round(rawOvertimeHours * 10) / 10 : undefined,
      // 本月已存入调休的加班小时数（compOffCount * hoursPerCompOff）
      storedOvertimeHours: compOffHoursUsed > 0 ? Math.round(compOffHoursUsed * 10) / 10 : undefined,
    };
  }, [ref]);

  const attendanceContextValue = React.useMemo(
    () => ({ records, upsertAttendance, deleteAttendance, getAttendance, calcFromShifts, ready }),
    [records, upsertAttendance, deleteAttendance, getAttendance, calcFromShifts, ready]
  );
  return (
    <AttendanceContext.Provider value={attendanceContextValue}>
      {children}
    </AttendanceContext.Provider>
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
      const overrides = existing?.allowanceOverrides;
      for (const rule of employee.allowanceRules) {
        if (!rule.enabled) continue;
        // 如果用户在绩效补贴页手动取消了此补贴，则跳过
        if (overrides && rule.id in overrides && !overrides[rule.id]) continue;
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
    // 优先使用员工独立配置，否则使用全局配置
    const siConfig = employee.socialInsurance ?? globalSettings?.defaultSocialInsurance;
    // 开关判断：必须同时满足「员工配置 enabled=true」且「全局开关未关闭」
    // 修复 Bug：旧逻辑用 || 导致全局开关为 true 时就就算员工关闭也会计算社保
    // 修复 Bug：初始化时不从 existing 继承旧扣除数据，开关关闭时强制清零，防止历史数据污染
    const siEnabled = siConfig?.enabled === true && globalSettings?.socialInsuranceEnabled !== false;
    let socialInsuranceDeduction = 0;  // 个人部分：开关关闭时强制为 0
    let housingFundDeduction = 0;      // 个人部分：开关关闭时强制为 0
    let employerSocialInsurance = 0;   // 公司部分：开关关闭时强制为 0
    let employerHousingFund = 0;       // 公司部分：开关关闭时强制为 0
    let socialInsuranceDetails: PaySlip["socialInsuranceDetails"] = undefined;
    let employerInsuranceDetails: PaySlip["employerInsuranceDetails"] = undefined;

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
    // 修复 Bug：与社保开关相同，个税开关必须员工配置 enabled=true 且全局开关未关闭
    const taxEnabled = taxConfig?.enabled === true && globalSettings?.incomeTaxEnabled !== false;
    // 修复 Bug：开关关闭时不从 existing 继承旧个税数据，强制清零
    let incomeTax = 0;
    let incomeTaxNote = "";

    if (taxEnabled && taxConfig) {
      const totalDeductions = socialInsuranceDeduction + housingFundDeduction;
      // 本月应纳税所得额 = 应发 - 个人社保/公积金 - 起征点(5000) - 专项附加扣除
      const thisMonthTaxable = Math.max(0,
        grossSalary - totalDeductions - taxConfig.threshold - (taxConfig.specialDeductions ?? 0)
      );
      // 年度累计应纳税所得额（含本月，调用方已传入前几月的累计值）
      // cumulativeIncome 由调用方从历史 paySlips 计算，已是「应纳税所得额」
      const cumTaxableIncome = cumulativeIncome + thisMonthTaxable;
      const result = calcIncomeTax(
        cumTaxableIncome, cumulativeTaxPaid,
        taxConfig.threshold, 0
      );
      incomeTax = result.tax;
      incomeTaxNote = result.note;
    }

    // ── 公司总人力成本 ──
    const totalEmployerCost = Math.round((
      grossSalary + employerSocialInsurance + employerHousingFund
    ) * 100) / 100;

    // ── 实发薪资（含预支扣除 + 备用金已付扣除）──
    // 开启社保/个税时：实发 = 应发 - 社保个人 - 公积金个人 - 个税 - 预支 - 备用金已付
    // 关闭社保/个税时：实发 = 应发 - 预支 - 备用金已付
    const pettyLaborPaidAmt = existing?.pettyLaborPaid ?? 0;
    const finalSalary = Math.round((
      grossSalary - socialInsuranceDeduction - housingFundDeduction - incomeTax - advanceAmount - pettyLaborPaidAmt
    ) * 100) / 100;

    return {
      id: existing?.id ?? uuid(),
      employeeId: employee.id,
      month,
      // 员工姓名/代号快照：员工删除后历史薪资单仍可显示姓名
      employeeName: employee.realName,
      employeeCode: employee.code,
      attendanceDays,
      attendanceSalary,
      performanceBonus: performanceTotal,
      salesCommission: existing?.salesCommission ?? 0,
      mealAllowance,
      transportAllowance,
      otherAllowance,
      rewardPenalty: existing?.rewardPenalty ?? 0,
      rewardPenaltyItems: existing?.rewardPenaltyItems,
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
      // 保留手动字段：调休兑现、节假日分配、备用金人工已付
      compOffCashOut: existing?.compOffCashOut,
      compOffCashOutNote: existing?.compOffCashOutNote,
      holidayBonusAllocation: existing?.holidayBonusAllocation,
      pettyLaborPaid: existing?.pettyLaborPaid,
      pettyLaborLinkIds: existing?.pettyLaborLinkIds,
      updatedAt: new Date().toISOString(),
    };
  }, [ref]);

  const paySlipContextValue = React.useMemo(
    () => ({ paySlips, upsertPaySlip, deletePaySlip, getPaySlip, buildPaySlipDraft, ready }),
    [paySlips, upsertPaySlip, deletePaySlip, getPaySlip, buildPaySlipDraft, ready]
  );
  return (
    <PaySlipContext.Provider value={paySlipContextValue}>
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
  /** 获取某员工在某月可用的余额总天数（available 状态且未过期） */
  getAvailableDays: (employeeId: string, month: string) => number;
  /** 将余额兑现成钱（标记为 cashed_out，记录兑现金额） */
  cashOutEntry: (id: string, dailyRate: number, usedMonth: string) => void;
  /** 自动将过期余额标记为 expired */
  expireOldEntries: (currentMonth: string) => void;
  ready: boolean;
}

const CompOffBalanceEntryContext = createContext<CompOffBalanceEntryStore>({
  entries: [], addEntry: () => {}, updateEntry: () => {},
  getEntries: () => [], getAvailableDays: () => 0, cashOutEntry: () => {}, expireOldEntries: () => {},
  ready: false,
});

function CompOffBalanceEntryProvider({ children }: { children: React.ReactNode }) {
  const { data: entries, ref, persist, ready } = usePersisted<CompOffBalanceEntry>("labor_comp_off_entries_v1");

  // 迁移旧数据：修复 expiresMonth 为空字符串的条目（旧版错误写入空字符串）
  React.useEffect(() => {
    if (!ready) return;
    const needsFix = ref.current.some((e) => e.status === "available" && !e.expiresMonth);
    if (needsFix) {
      const fixed = ref.current.map((e) => {
        if (e.status === "available" && !e.expiresMonth) {
          // 根据 earnedMonth 计算3个月后过期
          return { ...e, expiresMonth: calcCompOffExpiresMonth(e.earnedMonth) };
        }
        return e;
      });
      console.log("[CompOffBalanceEntryProvider] 迁移旧数据，修复 expiresMonth 为空的条目");
      persist(fixed);
    }
  }, [ready]);

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
    return ref.current
      .filter((e) => e.employeeId === employeeId && e.status === "available" && e.expiresMonth >= month)
      .reduce((sum, e) => sum + e.days, 0);
  }, [ref]);

  const cashOutEntry = useCallback((id: string, unitRate: number, usedMonth: string) => {
    // unitRate：单位兑换费率（加班换休=时薪，节假日换休=日薪），传0表示直接扣除不产生金额
    const entry = ref.current.find((e) => e.id === id);
    if (!entry || entry.status !== "available") return;
    const cashOutAmount = Math.round(entry.days * unitRate * 100) / 100;
    const next = ref.current.map((e) => e.id === id
      ? { ...e, status: "cashed_out" as const, usedMonth, cashOutUnitRate: unitRate, cashOutAmount }
      : e
    );
    persist(next);
  }, [persist, ref]);

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
    <CompOffBalanceEntryContext.Provider value={{ entries, addEntry, updateEntry, getEntries, getAvailableDays, cashOutEntry, expireOldEntries, ready }}>
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

// ─── 店铺经营时间 Store ──────────────────────────────────────────────────────
interface BusinessHoursStore {
  businessHours: BusinessHoursEntry[];
  upsertBusinessHours: (entry: BusinessHoursEntry) => void;
  deleteBusinessHours: (id: string) => void;
  setBusinessHours: (entries: BusinessHoursEntry[]) => void;
  ready: boolean;
}

const BusinessHoursContext = createContext<BusinessHoursStore>({
  businessHours: DEFAULT_BUSINESS_HOURS,
  upsertBusinessHours: () => {}, deleteBusinessHours: () => {}, setBusinessHours: () => {}, ready: false,
});

function BusinessHoursProvider({ children }: { children: React.ReactNode }) {
  const { data: businessHours, ref, persist, ready } = usePersisted<BusinessHoursEntry>("labor_business_hours_v1", DEFAULT_BUSINESS_HOURS);

  const upsertBusinessHours = useCallback((entry: BusinessHoursEntry) => {
    const idx = ref.current.findIndex((e) => e.id === entry.id);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = entry; persist(next); }
    else persist([...ref.current, entry]);
  }, [persist, ref]);

  const deleteBusinessHours = useCallback((id: string) => {
    persist(ref.current.filter((e) => e.id !== id));
  }, [persist, ref]);

  const setBusinessHours = useCallback((entries: BusinessHoursEntry[]) => {
    persist(entries);
  }, [persist]);

  return (
    <BusinessHoursContext.Provider value={{ businessHours, upsertBusinessHours, deleteBusinessHours, setBusinessHours, ready }}>
      {children}
    </BusinessHoursContext.Provider>
  );
}

// ─── 班次分组 Store ───────────────────────────────────────────────────────────
interface ShiftGroupStore {
  shiftGroups: ShiftGroup[];
  upsertShiftGroup: (group: ShiftGroup) => void;
  deleteShiftGroup: (id: string) => void;
  setShiftGroups: (groups: ShiftGroup[]) => void;
  getGroupForTemplate: (templateId: string) => ShiftGroup | undefined;
  ready: boolean;
}

const ShiftGroupContext = createContext<ShiftGroupStore>({
  shiftGroups: DEFAULT_SHIFT_GROUPS,
  upsertShiftGroup: () => {}, deleteShiftGroup: () => {}, setShiftGroups: () => {},
  getGroupForTemplate: () => undefined, ready: false,
});

function ShiftGroupProvider({ children }: { children: React.ReactNode }) {
  const { data: shiftGroups, ref, persist, ready } = usePersisted<ShiftGroup>("labor_shift_groups_v1", DEFAULT_SHIFT_GROUPS);

  const upsertShiftGroup = useCallback((group: ShiftGroup) => {
    const idx = ref.current.findIndex((g) => g.id === group.id);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = group; persist(next); }
    else persist([...ref.current, group]);
  }, [persist, ref]);

  const deleteShiftGroup = useCallback((id: string) => {
    persist(ref.current.filter((g) => g.id !== id));
  }, [persist, ref]);

  const setShiftGroups = useCallback((groups: ShiftGroup[]) => {
    persist(groups);
  }, [persist]);

  const getGroupForTemplate = useCallback((templateId: string): ShiftGroup | undefined => {
    return ref.current.find((g) => g.templateIds.includes(templateId));
  }, [ref]);

  return (
    <ShiftGroupContext.Provider value={{ shiftGroups, upsertShiftGroup, deleteShiftGroup, setShiftGroups, getGroupForTemplate, ready }}>
      {children}
    </ShiftGroupContext.Provider>
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
// ─── 快速填充预设 Store ───────────────────────────────────────────────────────
interface FillPresetStore {
  presets: FillPreset[];
  savePreset: (preset: Omit<FillPreset, "id" | "createdAt">) => void;
  deletePreset: (id: string) => void;
}

const FillPresetContext = createContext<FillPresetStore>({
  presets: [], savePreset: () => {}, deletePreset: () => {},
});

function FillPresetProvider({ children }: { children: React.ReactNode }) {
  const { data: presets, ref, persist } = usePersisted<FillPreset>("labor_fill_presets_v1");

  const savePreset = useCallback((preset: Omit<FillPreset, "id" | "createdAt">) => {
    const newPreset: FillPreset = { ...preset, id: uuid(), createdAt: new Date().toISOString() };
    // 最多保存 3 个，满了替换最旧的
    const current = ref.current;
    const next = current.length >= 3
      ? [...current.slice(1), newPreset]
      : [...current, newPreset];
    persist(next);
  }, [persist, ref]);

  const deletePreset = useCallback((id: string) => {
    persist(ref.current.filter((p) => p.id !== id));
  }, [persist, ref]);

  return (
    <FillPresetContext.Provider value={{ presets, savePreset, deletePreset }}>
      {children}
    </FillPresetContext.Provider>
  );
}


// ─── 排班表历史快照 Store ─────────────────────────────────────────────────────
interface ScheduleSnapshotStore {
  snapshots: ScheduleSnapshot[];
  /** 获取某月某部门的所有快照版本（按版本号降序） */
  getSnapshots: (month: string, deptCategory: DeptCategory) => ScheduleSnapshot[];
  /** 保存新快照（自动分配版本号） */
  saveSnapshot: (snapshot: Omit<ScheduleSnapshot, "id" | "version" | "createdAt">) => void;
  /** 更新快照（锁定/解锁/修改备注） */
  updateSnapshot: (id: string, updates: Partial<Pick<ScheduleSnapshot, "isLocked" | "isFinal" | "note" | "label">>) => void;
  /** 删除快照（仅未锁定的可删除） */
  deleteSnapshot: (id: string) => void;
  ready: boolean;
}
const ScheduleSnapshotContext = createContext<ScheduleSnapshotStore>({
  snapshots: [],
  getSnapshots: () => [],
  saveSnapshot: () => {},
  updateSnapshot: () => {},
  deleteSnapshot: () => {},
  ready: false,
});
function ScheduleSnapshotProvider({ children }: { children: React.ReactNode }) {
  const { data: snapshots, ref, persist, ready } = usePersisted<ScheduleSnapshot>("labor_schedule_snapshots_v1");
  const getSnapshots = useCallback((month: string, deptCategory: DeptCategory): ScheduleSnapshot[] => {
    return ref.current
      .filter((s) => s.month === month && s.deptCategory === deptCategory)
      .sort((a, b) => b.version - a.version);
  }, [ref]);
  const saveSnapshot = useCallback((snapshot: Omit<ScheduleSnapshot, "id" | "version" | "createdAt">) => {
    const existing = ref.current.filter((s) => s.month === snapshot.month && s.deptCategory === snapshot.deptCategory);
    const nextVersion = existing.length > 0 ? Math.max(...existing.map((s) => s.version)) + 1 : 1;
    const newSnapshot: ScheduleSnapshot = {
      ...snapshot,
      id: uuid(),
      version: nextVersion,
      createdAt: new Date().toISOString(),
    };
    persist([...ref.current, newSnapshot]);
  }, [ref, persist]);
  const updateSnapshot = useCallback((id: string, updates: Partial<Pick<ScheduleSnapshot, "isLocked" | "isFinal" | "note" | "label">>) => {
    const idx = ref.current.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = [...ref.current];
    next[idx] = { ...next[idx], ...updates };
    persist(next);
  }, [ref, persist]);
  const deleteSnapshot = useCallback((id: string) => {
    const snap = ref.current.find((s) => s.id === id);
    if (!snap || snap.isLocked) return; // 锁定的不可删除
    persist(ref.current.filter((s) => s.id !== id));
  }, [ref, persist]);
  return (
    <ScheduleSnapshotContext.Provider value={{ snapshots, getSnapshots, saveSnapshot, updateSnapshot, deleteSnapshot, ready }}>
      {children}
    </ScheduleSnapshotContext.Provider>
  );
}

export function LaborProvider({ children }: { children: React.ReactNode }) {
  return (
    <MonthConfigProvider>
      <EmployeeProvider>
        <CustomDeptProvider>
          <BusinessHoursProvider>
          <FillPresetProvider>
          <ShiftGroupProvider>
          <ScheduleSnapshotProvider>
          <ShiftTemplateProvider>
            <SpecialStatusProvider>
              <HolidayConfigProvider>
                <ShiftProvider>
                  <AttendanceProvider>
                      <CompOffBalanceEntryProvider>
                        <HolidayCompOffProvider>
                          <UnexplainedRestAlertProvider>
                            <PaySlipProvider>
                                  <GlobalPayrollSettingsProvider>
                                    {children}
                                  </GlobalPayrollSettingsProvider>
                            </PaySlipProvider>
                          </UnexplainedRestAlertProvider>
                        </HolidayCompOffProvider>
                      </CompOffBalanceEntryProvider>
                  </AttendanceProvider>
                </ShiftProvider>
              </HolidayConfigProvider>
            </SpecialStatusProvider>
          </ShiftTemplateProvider>
          </ScheduleSnapshotProvider>
          </ShiftGroupProvider>
          </FillPresetProvider>
          </BusinessHoursProvider>
        </CustomDeptProvider>
      </EmployeeProvider>
    </MonthConfigProvider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────
export function useEmployeeStore() { return useContext(EmployeeContext); }
export function useShiftStore() { return useContext(ShiftContext); }
export function useShiftTemplateStore() { return useContext(ShiftTemplateContext); }
export function useSpecialStatusStore() { return useContext(SpecialStatusContext); }
export function useHolidayConfigStore() { return useContext(HolidayConfigContext); }
export function useAttendanceStore() { return useContext(AttendanceContext); }
export function usePaySlipStore() { return useContext(PaySlipContext); }
export function useMonthConfigStore() { return useContext(MonthConfigContext); }
export function useGlobalPayrollSettingsStore() { return useContext(GlobalPayrollSettingsContext); }
export function useCompOffBalanceEntryStore() { return useContext(CompOffBalanceEntryContext); }
export function useHolidayCompOffStore() { return useContext(HolidayCompOffContext); }
export function useUnexplainedRestAlertStore() { return useContext(UnexplainedRestAlertContext); }
export function useBusinessHoursStore() { return useContext(BusinessHoursContext); }
export function useShiftGroupStore() { return useContext(ShiftGroupContext); }
export function useFillPresetStore() { return useContext(FillPresetContext); }
export function useScheduleSnapshotStore() { return useContext(ScheduleSnapshotContext); }
