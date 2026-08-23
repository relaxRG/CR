/**
 * 人工成本管理 Store v3
 * 新增：特殊状态系统、加班换休逻辑、社保/公积金/个税、全局薪资设置
 * 修复：少休天数自动计算、考勤工资闭环
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { notifySyncChange, registerStoreReload } from "../sync/engine";
import { SeparatePaymentProvider } from "./separate-payment-store";
import { calculateAttendanceFromShifts } from "./attendance-calculator";
import { createMonthCloseOperationGate } from "./month-close-operation-gate";
import {
  Employee, EmployeeDept, ShiftEntry, MonthlyAttendance, PaySlip, MonthConfig,
  ShiftTemplate, HolidayConfig,
  SpecialStatus, GlobalPayrollSettings,
  MonthCloseArchive, MonthCloseStatus, MonthAdjustmentSession, PayrollAdjustment, AdjustmentSettleMethod,
  CompOffBalanceEntry, HolidayCompOffEntry, UnexplainedRestAlert,
  CustomDept, BusinessHoursEntry, ShiftGroup, FillPreset,
  calcSocialInsurance, calcIncomeTax,

  calcCompOffExpiresMonth,
  DEFAULT_SHIFT_TEMPLATES, DEFAULT_SPECIAL_STATUSES,
  DEFAULT_GLOBAL_PAYROLL_SETTINGS, DEFAULT_CUSTOM_DEPTS,
  DEFAULT_BUSINESS_HOURS, DEFAULT_SHIFT_GROUPS,
} from "./types";
import { settlePayrollExtras } from "./payroll-extras";
import { calculateFinalSalary, calculateGrossSalary } from "./payroll-reconciliation";
import { CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION, getActiveAllowanceControls, needsHistoricalAllowanceRulesReset, resetHistoricalAllowanceRules } from "./allowance-rules-reset";
import {
  createCompOffCashOutEvent,
  migrateLegacyCompOffSettlement,
  migrateLegacyPaySlipCompOffCashOut,
  voidCompOffCashOutEvent,
} from "./comp-off-cashout-settlement";
import {
  buildFinalScheduleByDept,
  buildFrozenPayrollByEmployee,
  calculateArchiveAdjustments,
  getCurrentMonthCloseArchive,
  getMonthCloseStatus,
} from "./month-close";

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
    const load = () => AsyncStorage.getItem(key).then((raw) => {
      if (raw) {
        try { const parsed = JSON.parse(raw) as T; ref.current = parsed; setData(parsed); } catch {}
      }
      setReady(true);
    });
    void load();
    return registerStoreReload(() => { void load(); });
  }, [key]);

  const persist = useCallback((next: T) => {
    ref.current = next;
    setData(next);
    void AsyncStorage.setItem(key, JSON.stringify(next))
      .then(() => notifySyncChange(key))
      .catch(console.error);
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
      "weeklyHours" in e ||
      // 用户明确要求删除所有历史补贴规则，不做格式迁移或类型推断。
      needsHistoricalAllowanceRulesReset(e)
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
        // 用户明确要求删除所有历史补贴规则，不做迁移：保留空规则状态，
        // 后续只能在新员工档案表单中重新创建当前结构的规则。
        if (needsHistoricalAllowanceRulesReset(next)) {
          Object.assign(next, resetHistoricalAllowanceRules(next));
        }
        return next;
      }));
    }
  }, [ready]);

  const addEmployee = useCallback((draft: Omit<Employee, "id" | "createdAt">): string => {
    const id = uuid();
    const now = Date.now();
    // 新员工自动分配 sortOrder（同部门内最大値+1）
    const sameDept = ref.current.filter((e) => e.dept === draft.dept);
    const maxOrder = sameDept.reduce((max, e) => Math.max(max, e.sortOrder ?? 0), -1);
    persist([...ref.current, { ...draft, allowanceRulesSchemaVersion: CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION, id, sortOrder: maxOrder + 1, createdAt: new Date().toISOString(), updatedAt: now }]);
    return id;
  }, [persist, ref]);

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    // 写入 updatedAt 时间戳，支持多端并发修改时的字段级 LWW 合并
    persist(ref.current.map((e) => e.id === id ? {
      ...e,
      ...patch,
      allowanceRulesSchemaVersion: patch.allowanceRules !== undefined
        ? CURRENT_ALLOWANCE_RULES_SCHEMA_VERSION
        : e.allowanceRulesSchemaVersion,
      updatedAt: Date.now(),
    } : e));
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
      ? { ...e, archived: false, archivedAt: undefined, active: true, updatedAt: Date.now() }
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

// ─── 分组顺序 Store ───────────────────────────────────────────────────────────
/** 默认分组顺序（前厅/后厨/公司/临时兼职） */
export const DEFAULT_DEPT_ORDER: EmployeeDept[] = ["front", "kitchen", "other", "parttime"];
const DEPT_ORDER_KEY = "labor_dept_order_v1";

interface DeptOrderStore {
  deptOrder: EmployeeDept[];
  saveDeptOrder: (order: EmployeeDept[]) => void;
  ready: boolean;
}
const DeptOrderContext = createContext<DeptOrderStore>({
  deptOrder: DEFAULT_DEPT_ORDER,
  saveDeptOrder: () => {},
  ready: false,
});
function DeptOrderProvider({ children }: { children: React.ReactNode }) {
  const [deptOrder, setDeptOrder] = useState<EmployeeDept[]>(DEFAULT_DEPT_ORDER);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () => AsyncStorage.getItem(DEPT_ORDER_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as EmployeeDept[];
          if (Array.isArray(parsed) && parsed.length > 0) setDeptOrder(parsed);
        } catch {}
      }
      setReady(true);
    });
    load();
    return registerStoreReload(load);
  }, []);
  const saveDeptOrder = useCallback((order: EmployeeDept[]) => {
    setDeptOrder(order);
    AsyncStorage.setItem(DEPT_ORDER_KEY, JSON.stringify(order)).catch(console.error);
    notifySyncChange(DEPT_ORDER_KEY);
  }, []);
  return (
    <DeptOrderContext.Provider value={{ deptOrder, saveDeptOrder, ready }}>
      {children}
    </DeptOrderContext.Provider>
  );
}
export const useDeptOrderStore = () => useContext(DeptOrderContext);

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

  // 删除无来源旧调休状态，并确保三种来源明确的新状态完整存在。
  React.useEffect(() => {
    if (!ready) return;
    const withoutLegacy = ref.current.filter((status) => status.id !== "ss_comp_off");
    const ids = new Set(withoutLegacy.map((status) => status.id));
    const missing = DEFAULT_SPECIAL_STATUSES.filter((status) => !ids.has(status.id));
    const next = [...withoutLegacy, ...missing];
    if (next.length !== ref.current.length || missing.length > 0) {
      console.log("[SpecialStatusProvider] 清理旧通用调休状态并补齐来源明确的内置状态");
      persist(next);
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
  /** 用指定月份记录完整替换当前月，用于受控差额调整的回滚。 */
  replaceMonthShifts: (month: string, entries: ShiftEntry[]) => void;
  ready: boolean;
}

const ShiftContext = createContext<ShiftStore>({
  shifts: [], upsertShift: () => {}, batchUpsertShifts: () => {},
  deleteShift: () => {}, batchDeleteShifts: () => {}, getShifts: () => [], replaceMonthShifts: () => {}, ready: false,
});

/**
 * 持久化迁移旧排班数据：
 * 1. shift="day"/"evening"/"both"/"午"/"晚" → "午班"/"晚班"
 * 2. 清除废弃字段 sessionValue 和 overtimeType
 */
function migrateShiftEntries(entries: ShiftEntry[]): { migrated: ShiftEntry[]; changed: boolean } {
  let changed = false;
  const migrated = entries.flatMap((e) => {
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

    // 旧“通用调休”没有来源，无法安全映射为加班换休、余额休或节假日调休；直接删除。
    if (next.specialStatusId === "ss_comp_off") {
      changed = true;
      return [];
    }

    if (dirty) changed = true;
    return [next];
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

  const replaceMonthShifts = useCallback((month: string, entries: ShiftEntry[]) => {
    persist([...ref.current.filter((shift) => !shift.date.startsWith(month)), ...entries.map((entry) => ({ ...entry }))]);
  }, [persist, ref]);

  return (
    <ShiftContext.Provider value={{ shifts, upsertShift, batchUpsertShifts, deleteShift, batchDeleteShifts, getShifts, replaceMonthShifts, ready }}>
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
  /** 用指定月份考勤完整替换当前月，用于受控差额调整的回滚。 */
  replaceMonthAttendances: (month: string, nextRecords: MonthlyAttendance[]) => void;
  ready: boolean;
}

const AttendanceContext = createContext<AttendanceStore>({
  records: [], upsertAttendance: () => {}, deleteAttendance: () => {},
  getAttendance: () => null, calcFromShifts: () => ({} as MonthlyAttendance), replaceMonthAttendances: () => {}, ready: false,
});

function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const { data: records, ref, persist, ready } = usePersisted<MonthlyAttendance>("labor_attendance_v1");

  // 删除旧的混合换休字段。历史月份需由“重新计算本月”按当前排班生成新口径，
  // 不对无来源的旧 compOffCount / storedOvertimeHours 做猜测性迁移。
  React.useEffect(() => {
    if (!ready) return;
    let changed = false;
    const next = ref.current.map((record) => {
      const normalized = {
        ...record,
        overtimeCompOffDays: record.overtimeCompOffDays ?? 0,
        overtimeCompOffHours: record.overtimeCompOffHours ?? 0,
        balanceCompOffDays: record.balanceCompOffDays ?? 0,
        holidayCompOffDays: record.holidayCompOffDays ?? 0,
      } as MonthlyAttendance & Record<string, unknown>;
      if ("compOffCount" in normalized) { delete normalized.compOffCount; changed = true; }
      if ("hoursPerCompOff" in normalized) { delete normalized.hoursPerCompOff; changed = true; }
      if ("storedOvertimeHours" in normalized) { delete normalized.storedOvertimeHours; changed = true; }
      if (normalized.overtimeCompOffDays !== record.overtimeCompOffDays || normalized.overtimeCompOffHours !== record.overtimeCompOffHours || normalized.balanceCompOffDays !== record.balanceCompOffDays || normalized.holidayCompOffDays !== record.holidayCompOffDays) changed = true;
      return normalized as MonthlyAttendance;
    });
    if (changed) persist(next);
  }, [ready]);

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
    const existing = ref.current.find((record) => record.employeeId === employeeId && record.month === month) ?? null;
    return calculateAttendanceFromShifts({
      employeeId,
      month,
      employee,
      shifts,
      specialStatuses,
      holidayDays: holidayDaysList,
      existing,
    });
  }, [ref]);

  const replaceMonthAttendances = useCallback((month: string, nextRecords: MonthlyAttendance[]) => {
    persist([...ref.current.filter((record) => record.month !== month), ...nextRecords.map((record) => ({ ...record }))]);
  }, [persist, ref]);

  const attendanceContextValue = React.useMemo(
    () => ({ records, upsertAttendance, deleteAttendance, getAttendance, calcFromShifts, replaceMonthAttendances, ready }),
    [records, upsertAttendance, deleteAttendance, getAttendance, calcFromShifts, replaceMonthAttendances, ready]
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
    advanceAmount: number,
    globalSettings?: GlobalPayrollSettings,
    /** 年度累计已税收入（用于个税累计预扣法） */
    cumulativeIncome?: number,
    /** 年度累计已预扣税额 */
    cumulativeTaxPaid?: number,
    /** 调休兑现由余额结算流水唯一汇总；仅接受可验证事件快照，绝不接受裸金额。 */
    compOffCashOutSettlementOverride?: PaySlip["compOffCashOutSettlement"],
  ) => PaySlip;
  /** 用指定月份薪资单完整替换当前月，用于受控差额调整的回滚。 */
  replaceMonthPaySlips: (month: string, nextSlips: PaySlip[]) => void;
  ready: boolean;
}

const PaySlipContext = createContext<PaySlipStore>({
  paySlips: [], upsertPaySlip: () => {}, deletePaySlip: () => {},
  getPaySlip: () => null,
  buildPaySlipDraft: () => ({} as PaySlip), replaceMonthPaySlips: () => {},
  ready: false,
});

function PaySlipProvider({ children }: { children: React.ReactNode }) {
  const { data: paySlips, ref, persist, ready } = usePersisted<PaySlip>("labor_payslips_v1");
  const compOffLedger = useContext(CompOffBalanceEntryContext);

  // 加载后一次性物理删除废弃字段，避免旧本地草稿在实时结算时继续回流。
  useEffect(() => {
    if (!ready) return;
    const legacyKeys = ["frozenAt", "frozenBy", "frozenSnapshot", "performanceBonus", "salesCommission"];
    if (!ref.current.some((slip: any) => legacyKeys.some((key) => key in slip))) return;
    persist(ref.current.map((slip: any) => {
      const next = { ...slip };
      for (const key of legacyKeys) delete next[key];
      return next;
    }));
  }, [ready, persist, ref]);

  // 旧薪资单直接保存过调休兑现裸金额。首次加载时：匹配有效事件的值转换为快照；
  // 无来源或不一致的值移动至 payrollDataQuarantine，保留审计证据但不再参加任何薪资计算。
  useEffect(() => {
    if (!ready || !compOffLedger.ready) return;
    const migrated = ref.current.map((slip) => migrateLegacyPaySlipCompOffCashOut(slip, compOffLedger.entries));
    if (migrated.some((slip, index) => slip !== ref.current[index])) persist(migrated);
  }, [compOffLedger.entries, compOffLedger.ready, persist, ready, ref]);

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

  const replaceMonthPaySlips = useCallback((month: string, nextSlips: PaySlip[]) => {
    persist([
      ...ref.current.filter((slip) => slip.month !== month),
      ...nextSlips.map((slip) => ({ ...slip, updatedAt: new Date().toISOString() })),
    ]);
  }, [persist, ref]);

  const buildPaySlipDraft = useCallback((
    employee: Employee,
    month: string,
    attendance: MonthlyAttendance | null,
    advanceAmount: number,
    globalSettings?: GlobalPayrollSettings,
    cumulativeIncome: number = 0,
    cumulativeTaxPaid: number = 0,
    compOffCashOutSettlementOverride?: PaySlip["compOffCashOutSettlement"],
  ): PaySlip => {
    const existing = ref.current.find((s) => s.employeeId === employee.id && s.month === month);
    // 兑现额只能由唯一事件账本快照明确传入；禁止旧薪资单金额在草稿重建时无来源回流。
    const compOffCashOutSettlement = compOffCashOutSettlementOverride;
    const attendanceDays = attendance?.attendanceDays ?? 0;
    const attendanceSalary = attendance?.attendanceSalary ?? 0;

    // ── 绩效与补贴唯一实时结算 ──
    // 补贴规则已被清空时，旧薪资单的开关和金额明细必须同时丢弃，
    // 防止历史规则通过控制字段在DRAFT重算中继续回流。
    const activeAllowanceControls = getActiveAllowanceControls(employee, existing);
    const extras = settlePayrollExtras(employee, month, attendanceDays, {
      allowanceOverrides: activeAllowanceControls.allowanceOverrides,
      allowanceDetails: activeAllowanceControls.allowanceDetails,
      workKPISelections: existing?.workKPISelections,
      revenueActuals: existing?.revenueActuals,
    });

    // ── 应发薪资（税前）──
    // 已验证兑现账本快照金额加入应发薪资；没有快照即为 ¥0。
    const grossSalary = calculateGrossSalary({
      attendanceSalary,
      workKPIBonus: extras.workKPIBonus,
      revenueKPIBonus: extras.revenueKPIBonus,
      transportAllowance: extras.transportAllowance,
      mealAllowance: extras.mealAllowance,
      otherAllowance: extras.otherAllowance,
      rewardPenalty: existing?.rewardPenalty ?? 0,
      compOffCashOutSettlement,
    });

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

    // ── 实发薪资（含已预支扣除）──
    // 开启社保/个税时：实发 = 应发 - 社保个人 - 公积金个人 - 个税 - 已预支（advanceAmount + pettyLaborPaid）
    // 关闭社保/个税时：实发 = 应发 - 已预支（advanceAmount + pettyLaborPaid）
    const pettyLaborPaidAmt = existing?.pettyLaborPaid ?? 0;
    const finalSalary = calculateFinalSalary({
      attendanceSalary,
      workKPIBonus: extras.workKPIBonus,
      revenueKPIBonus: extras.revenueKPIBonus,
      transportAllowance: extras.transportAllowance,
      mealAllowance: extras.mealAllowance,
      otherAllowance: extras.otherAllowance,
      rewardPenalty: existing?.rewardPenalty ?? 0,
      compOffCashOutSettlement,
      socialInsuranceDeduction,
      housingFundDeduction,
      incomeTax,
      advanceAmount,
      pettyLaborPaid: pettyLaborPaidAmt,
    });

    return {
      id: existing?.id ?? uuid(),
      employeeId: employee.id,
      month,
      // 员工姓名/代号快照：员工删除后历史薪资单仍可显示姓名
      employeeName: employee.realName,
      employeeCode: employee.code,
      attendanceDays,
      attendanceSalary,
      workKPIBonus: extras.workKPIBonus,
      revenueKPIBonus: extras.revenueKPIBonus,
      mealAllowance: extras.mealAllowance,
      transportAllowance: extras.transportAllowance,
      otherAllowance: extras.otherAllowance,
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
      allowanceDetails: extras.allowanceDetails,
      socialInsuranceDetails,
      employerInsuranceDetails,
      incomeTaxNote,
      // 调休兑现不属于手动控制字段，仅保存本次已验证事件账本快照。
      compOffCashOutSettlement,
      payrollDataQuarantine: existing?.payrollDataQuarantine,
      compOffUsage: existing?.compOffUsage,
      holidayBonusAllocation: existing?.holidayBonusAllocation,
      pettyLaborPaid: existing?.pettyLaborPaid,
      pettyLaborLinkIds: existing?.pettyLaborLinkIds,
      // 仅在员工仍有当前版本补贴规则时保留月度补贴开关；历史规则已清空时显式删除。
      allowanceOverrides: activeAllowanceControls.allowanceOverrides,
      workKPISelections: existing?.workKPISelections,
      revenueActuals: existing?.revenueActuals,
      updatedAt: new Date().toISOString(),
    };
  }, [ref]);

  const paySlipContextValue = React.useMemo(
    () => ({ paySlips, upsertPaySlip, deletePaySlip, getPaySlip, buildPaySlipDraft, replaceMonthPaySlips, ready }),
    [paySlips, upsertPaySlip, deletePaySlip, getPaySlip, buildPaySlipDraft, replaceMonthPaySlips, ready]
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

// ─── 月度归档 Provider ────────────────────────────────────────────────────────
interface MonthCloseStore {
  archives: MonthCloseArchive[];
  sessions: MonthAdjustmentSession[];
  getStatus: (month: string) => MonthCloseStatus;
  getCurrentArchive: (month: string) => MonthCloseArchive | null;
  getArchives: (month: string) => MonthCloseArchive[];
  getAdjustmentSession: (month: string) => MonthAdjustmentSession | null;
  isMonthLocked: (month: string) => boolean;
  isMonthWritable: (month: string) => boolean;
  finalizeMonthClose: (month: string, summary: MonthCloseArchive["summary"]) => MonthCloseArchive | null;
  openAdjustmentSession: (month: string, reason: string, settleMethod: AdjustmentSettleMethod) => MonthAdjustmentSession | null;
  discardAdjustmentSession: (month: string) => boolean;
  /** 仅在调整会话中，将指定正式归档的完整排班依据应用到当前月。 */
  applyArchivedSchedule: (month: string, archiveId: string) => boolean;
  settleAdjustment: (month: string, adjustmentId: string, method: AdjustmentSettleMethod, settledInMonth: string) => void;
  getPendingAdjustments: (month: string) => PayrollAdjustment[];
  ready: boolean;
}

const MonthCloseContext = createContext<MonthCloseStore>({
  archives: [], sessions: [], getStatus: () => "draft", getCurrentArchive: () => null, getArchives: () => [],
  getAdjustmentSession: () => null, isMonthLocked: () => false, isMonthWritable: () => true,
  finalizeMonthClose: () => null, openAdjustmentSession: () => null, discardAdjustmentSession: () => false, applyArchivedSchedule: () => false,
  settleAdjustment: () => {}, getPendingAdjustments: () => [], ready: false,
});

/**
 * 新的唯一月度归档中心。
 * 旧的 labor_schedule_snapshots_v1 与 labor_payroll_confirmations_v1 不迁移，首次加载即永久删除。
 */
function MonthCloseProvider({ children }: { children: React.ReactNode }) {
  const { data: archives, ref: archivesRef, persist: persistArchives, ready: archivesReady } = usePersisted<MonthCloseArchive>("labor_month_close_archives_v1");
  const { data: sessions, ref: sessionsRef, persist: persistSessions, ready: sessionsReady } = usePersisted<MonthAdjustmentSession>("labor_month_adjustment_sessions_v1");
  const { employees, ready: employeesReady } = useEmployeeStore();
  const { shifts, replaceMonthShifts, ready: shiftsReady } = useShiftStore();
  const { records, replaceMonthAttendances, ready: attendancesReady } = useAttendanceStore();
  const { paySlips, replaceMonthPaySlips, ready: paySlipsReady } = usePaySlipStore();
  const monthOperationGateRef = useRef(createMonthCloseOperationGate());

  useEffect(() => {
    if (!archivesReady || !sessionsReady) return;
    // 用户要求不迁移旧归档/确认数据：永久清除旧键以及旧薪资单冻结字段。
    AsyncStorage.multiRemove(["labor_schedule_snapshots_v1", "labor_payroll_confirmations_v1"]).catch(console.error);
  }, [archivesReady, sessionsReady]);

  const getAdjustmentSession = useCallback((month: string) => sessionsRef.current.find((session) => session.month === month && session.status === "open") ?? null, [sessionsRef]);
  const getCurrentArchive = useCallback((month: string) => getCurrentMonthCloseArchive(archivesRef.current, month), [archivesRef]);
  const getArchives = useCallback((month: string) => archivesRef.current.filter((archive) => archive.month === month).sort((a, b) => b.version - a.version), [archivesRef]);
  const getStatus = useCallback((month: string): MonthCloseStatus => getMonthCloseStatus(archivesRef.current, new Set(sessionsRef.current.filter((session) => session.status === "open").map((session) => session.month)), month), [archivesRef, sessionsRef]);
  const isMonthLocked = useCallback((month: string) => getStatus(month) === "frozen", [getStatus]);
  const isMonthWritable = useCallback((month: string) => {
    const status = getStatus(month);
    return status === "draft" || status === "adjusting";
  }, [getStatus]);

  const snapshotPayroll = useCallback(
    (month: string) => buildFrozenPayrollByEmployee(employees, paySlips, month),
    [employees, paySlips],
  );

  const finalizeMonthClose = useCallback((month: string, summary: MonthCloseArchive["summary"]): MonthCloseArchive | null => {
    if (!monthOperationGateRef.current.tryAcquire(month)) return null;
    try {
      if (!employeesReady || !shiftsReady || !attendancesReady || !paySlipsReady) return null;
      const status = getStatus(month);
    if (status === "frozen") return null;
    const activeEmployees = employees.filter((employee) => employee.active && !employee.archived);
    const scheduleByDept = buildFinalScheduleByDept(activeEmployees, shifts, month);
    const payrollByEmployee = snapshotPayroll(month);
    const session = getAdjustmentSession(month);
    const baseArchive = session ? archivesRef.current.find((archive) => archive.id === session.baseArchiveId) : null;
    if (status === "adjusting" && (!session || !baseArchive || baseArchive.status !== "frozen")) return null;

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
      scheduleByDept,
      payrollByEmployee,
      adjustments: baseArchive ? calculateArchiveAdjustments(baseArchive, payrollByEmployee, createdAt) : [],
    };

    let nextArchives = [...archivesRef.current];
    if (baseArchive) {
      nextArchives = nextArchives.map((archive) => archive.id === baseArchive.id
        ? { ...archive, status: "superseded", supersededByArchiveId: nextArchive.id }
        : archive);
    }
    persistArchives([...nextArchives, nextArchive]);
      if (session) persistSessions(sessionsRef.current.filter((item) => item.id !== session.id));
      return nextArchive;
    } finally {
      monthOperationGateRef.current.release(month);
    }
  }, [archivesRef, attendancesReady, employees, employeesReady, getAdjustmentSession, getStatus, paySlipsReady, persistArchives, persistSessions, sessionsRef, shifts, shiftsReady, snapshotPayroll]);

  const openAdjustmentSession = useCallback((month: string, reason: string, settleMethod: AdjustmentSettleMethod): MonthAdjustmentSession | null => {
    if (!monthOperationGateRef.current.tryAcquire(month)) return null;
    try {
      if (!employeesReady || !shiftsReady || !attendancesReady || !paySlipsReady || !reason.trim()) return null;
      const archive = getCurrentArchive(month);
    if (!archive || getAdjustmentSession(month)) return null;
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
        shifts: shifts.filter((shift) => shift.date.startsWith(month)).map((shift) => ({ ...shift })),
        attendances: records.filter((record) => record.month === month).map((record) => ({ ...record })),
        paySlips: paySlips.filter((slip) => slip.month === month).map((slip) => ({ ...slip })),
      },
    };
      persistSessions([...sessionsRef.current, session]);
      return session;
    } finally {
      monthOperationGateRef.current.release(month);
    }
  }, [attendancesReady, employeesReady, getAdjustmentSession, getCurrentArchive, paySlips, paySlipsReady, persistSessions, records, sessionsRef, shifts, shiftsReady]);

  const discardAdjustmentSession = useCallback((month: string): boolean => {
    if (!monthOperationGateRef.current.tryAcquire(month)) return false;
    try {
      const session = getAdjustmentSession(month);
      if (!session) return false;
      replaceMonthShifts(month, session.baseline.shifts);
      replaceMonthAttendances(month, session.baseline.attendances);
      replaceMonthPaySlips(month, session.baseline.paySlips);
      persistSessions(sessionsRef.current.filter((item) => item.id !== session.id));
      return true;
    } finally {
      monthOperationGateRef.current.release(month);
    }
  }, [getAdjustmentSession, persistSessions, replaceMonthAttendances, replaceMonthPaySlips, replaceMonthShifts, sessionsRef]);

  const applyArchivedSchedule = useCallback((month: string, archiveId: string): boolean => {
    if (!monthOperationGateRef.current.tryAcquire(month)) return false;
    try {
      if (!getAdjustmentSession(month)) return false;
      const archive = archivesRef.current.find((item) => item.id === archiveId && item.month === month && item.status === "frozen");
      if (!archive) return false;
      const entries = Object.values(archive.scheduleByDept).flatMap((snapshot) => snapshot?.entries ?? []);
      replaceMonthShifts(month, entries);
      return true;
    } finally {
      monthOperationGateRef.current.release(month);
    }
  }, [archivesRef, getAdjustmentSession, replaceMonthShifts]);

  const settleAdjustment = useCallback((month: string, adjustmentId: string, method: AdjustmentSettleMethod, settledInMonth: string) => {
    if (!monthOperationGateRef.current.tryAcquire(month)) return;
    try {
      const current = getCurrentArchive(month);
      if (!current) return;
      const nextArchives = archivesRef.current.map((archive) => archive.id !== current.id ? archive : {
        ...archive,
        adjustments: archive.adjustments.map((adjustment) => adjustment.id === adjustmentId
          ? { ...adjustment, settled: true, settleMethod: method, settledInMonth }
          : adjustment),
      });
      persistArchives(nextArchives);
    } finally {
      monthOperationGateRef.current.release(month);
    }
  }, [archivesRef, getCurrentArchive, persistArchives]);

  const getPendingAdjustments = useCallback((month: string) => getCurrentArchive(month)?.adjustments.filter((adjustment) => !adjustment.settled) ?? [], [getCurrentArchive]);
  const ready = archivesReady && sessionsReady && employeesReady && shiftsReady && attendancesReady && paySlipsReady;

  return (
    <MonthCloseContext.Provider value={{
      archives, sessions, getStatus, getCurrentArchive, getArchives, getAdjustmentSession,
      isMonthLocked, isMonthWritable, finalizeMonthClose, openAdjustmentSession,
      discardAdjustmentSession, applyArchivedSchedule, settleAdjustment, getPendingAdjustments, ready,
    }}>
      {children}
    </MonthCloseContext.Provider>
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
  /** 将余额兑换为唯一、可审计的现金事件；零费率或跨月倒流会被拒绝。 */
  cashOutEntry: (id: string, unitRate: number, usedMonth: string) => boolean;
  /** 草稿月作废错误兑现并恢复该余额；已确认月必须走更正会话。 */
  voidCashOutEntry: (id: string, reason: string) => boolean;
  /** 自动将过期余额标记为 expired */
  expireOldEntries: (currentMonth: string) => void;
  ready: boolean;
}

const CompOffBalanceEntryContext = createContext<CompOffBalanceEntryStore>({
  entries: [], addEntry: () => {}, updateEntry: () => {},
  getEntries: () => [], getAvailableDays: () => 0, cashOutEntry: () => false, voidCashOutEntry: () => false, expireOldEntries: () => {},
  ready: false,
});

function CompOffBalanceEntryProvider({ children }: { children: React.ReactNode }) {
  const { data: entries, ref, persist, ready } = usePersisted<CompOffBalanceEntry>("labor_comp_off_entries_v1");

  // 一次性规范化历史余额：修复缺失到期月，并把旧的可分裂兑现字段迁移为唯一事件快照。
  // 损坏历史（如 ¥0 费率却写入 ¥1）会被 quarantined，绝不进入薪资结算或被静默删除。
  React.useEffect(() => {
    if (!ready) return;
    let changed = false;
    const fixed = ref.current.map((raw) => {
      let entry = raw;
      if (entry.status === "available" && !entry.expiresMonth) {
        entry = { ...entry, expiresMonth: calcCompOffExpiresMonth(entry.earnedMonth) };
        changed = true;
      }
      const migrated = migrateLegacyCompOffSettlement(entry);
      if (migrated !== entry) changed = true;
      return migrated;
    });
    if (changed) persist(fixed);
  }, [ready, persist, ref]);

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

  const cashOutEntry = useCallback((id: string, unitRate: number, usedMonth: string): boolean => {
    const entry = ref.current.find((e) => e.id === id);
    if (!entry || entry.status !== "available") return false;
    const event = createCompOffCashOutEvent(entry, unitRate, usedMonth);
    if (!event) return false;
    persist(ref.current.map((e) => e.id === id
      ? { ...e, status: "cashed_out" as const, usedMonth, settlement: event, settlementHistory: e.settlementHistory ?? [] }
      : e,
    ));
    return true;
  }, [persist, ref]);

  const voidCashOutEntry = useCallback((id: string, reason: string): boolean => {
    const entry = ref.current.find((e) => e.id === id);
    if (!entry || entry.status !== "cashed_out" || !entry.settlement || entry.settlement.status === "voided") return false;
    persist(ref.current.map((e) => e.id === id ? voidCompOffCashOutEvent(e, reason) : e));
    return true;
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
    <CompOffBalanceEntryContext.Provider value={{ entries, addEntry, updateEntry, getEntries, getAvailableDays, cashOutEntry, voidCashOutEntry, expireOldEntries, ready }}>
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
  const unifiedCompOff = useContext(CompOffBalanceEntryContext);

  const addEntry = useCallback((entry: Omit<HolidayCompOffEntry, "id" | "createdAt">) => {
    const newEntry: HolidayCompOffEntry = { ...entry, id: uuid(), createdAt: new Date().toISOString() };
    persist([...ref.current, newEntry]);
  }, [persist, ref]);

  const updateEntry = useCallback((id: string, patch: Partial<HolidayCompOffEntry>) => {
    const idx = ref.current.findIndex((e) => e.id === id);
    if (idx >= 0) { const next = [...ref.current]; next[idx] = { ...next[idx], ...patch }; persist(next); }
  }, [persist, ref]);

  // 旧 HolidayCompOffEntry 与新 CompOffBalanceEntry（source=holiday）并存会造成余额重复展示和
  // 消费不一致。保留本 Provider 只用于一次性迁移历史数据，业务读取统一走 CompOffBalanceEntry。
  React.useEffect(() => {
    if (!ready || !unifiedCompOff.ready) return;
    const pending = ref.current.filter((entry) => !entry.migratedToUnified);
    if (pending.length === 0) return;

    for (const legacy of pending) {
      const alreadyMigrated = unifiedCompOff.entries.some((entry) =>
        entry.employeeId === legacy.employeeId &&
        entry.source === "holiday" &&
        entry.workDate === legacy.workDate &&
        entry.earnedMonth === legacy.workDate.slice(0, 7)
      );
      if (!alreadyMigrated) {
        unifiedCompOff.addEntry({
          employeeId: legacy.employeeId,
          earnedMonth: legacy.workDate.slice(0, 7),
          source: "holiday",
          workDate: legacy.workDate,
          holidayName: legacy.holidayName,
          days: legacy.days,
          expiresMonth: legacy.expiresMonth,
          status: legacy.status,
          usedMonth: legacy.usedMonth,
          notes: `从旧节假日调休余额迁移：${legacy.id}`,
        });
      }
      updateEntry(legacy.id, { migratedToUnified: true });
    }
  }, [ready, unifiedCompOff.ready, unifiedCompOff.entries, unifiedCompOff.addEntry, ref, updateEntry]);

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


export function LaborProvider({ children }: { children: React.ReactNode }) {
  return (
    <MonthConfigProvider>
      <EmployeeProvider>
        <CustomDeptProvider>
          <DeptOrderProvider>
          <BusinessHoursProvider>
          <FillPresetProvider>
          <ShiftGroupProvider>
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
                                    <MonthCloseProvider>
                                      <SeparatePaymentProvider>
                                        {children}
                                      </SeparatePaymentProvider>
                                    </MonthCloseProvider>
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
          </ShiftGroupProvider>
          </FillPresetProvider>
          </BusinessHoursProvider>
          </DeptOrderProvider>
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
export function useMonthCloseStore() { return useContext(MonthCloseContext); }
