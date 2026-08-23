import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { registerStoreReload } from "@/lib/sync/engine";
import { PETTY_CODE_LABELS, type PettyCode } from "@/lib/store/petty-store";
import type { EmployeeDept, EmployeeType } from "@/lib/labor/types";
import { useGlobalBusinessMonth } from "@/lib/months/global-business-month";
import {
  buildStoreReportReadModel,
  loadStoreReportFacts,
  type StoreReportFacts,
  type StoreReportReadModel,
} from "@/lib/store/report-read-model";

const REPORT_SNAPSHOT_KEYS = [
  "store.revenue.v1", "store.petty.v1", "labor_employees_v1", "labor_payslips_v1", "labor_dept_order_v1",
] as const;
const EMPLOYEE_DEPTS = new Set<EmployeeDept>(["front", "kitchen", "parttime", "other"]);
const EMPLOYEE_TYPES = new Set<EmployeeType>(["fulltime", "longterm_parttime", "parttime"]);
const DEFAULT_DEPT_ORDER: EmployeeDept[] = ["front", "kitchen", "other", "parttime"];
const EMPTY_FACTS: StoreReportFacts = Object.freeze({
  payslips: [], pettyRecords: [], employees: [], payrollDetails: [], deptOrder: [], revenueRecords: [], purchases: [], inventory: [],
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

function parseArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 将持久化载荷投影为报表所需的只读事实，不回写、修复或迁移原始载荷。 */
export function decodeStoreReportSnapshot(snapshot: ReadonlyMap<string, string | null>): StoreReportFacts {
  const revenueState = parseState(snapshot.get("store.revenue.v1") ?? null);
  const pettyState = parseState(snapshot.get("store.petty.v1") ?? null);
  const employees = parseArray(snapshot.get("labor_employees_v1") ?? null).flatMap((value) => {
    const employee = asRecord(value);
    if (!employee) return [];
    const id = typeof employee.id === "string" ? employee.id : "";
    const code = typeof employee.code === "string" ? employee.code : "";
    const realName = typeof employee.realName === "string" ? employee.realName : "";
    const rawDept = typeof employee.dept === "string" ? employee.dept : "other";
    const rawType = typeof employee.type === "string" ? employee.type : "fulltime";
    if (!id || !EMPLOYEE_DEPTS.has(rawDept as EmployeeDept) || !EMPLOYEE_TYPES.has(rawType as EmployeeType)) return [];
    const bankAccounts = Array.isArray(employee.bankAccounts) ? employee.bankAccounts.flatMap((bank) => {
      const account = asRecord(bank);
      if (!account) return [];
      const bankName = typeof account.bankName === "string" ? account.bankName : "";
      const cardNumber = typeof account.cardNumber === "string" ? account.cardNumber : "";
      return bankName && cardNumber ? [{ bankName, cardNumber, isDefault: account.isDefault === true }] : [];
    }) : [];
    return [{
      id, code, realName: realName || code || id, dept: rawDept as EmployeeDept, type: rawType as EmployeeType,
      sortOrder: typeof employee.sortOrder === "number" ? employee.sortOrder : undefined,
      active: employee.active !== false, archived: employee.archived === true, bankAccounts,
    }];
  });
  const payrollDetails = parseArray(snapshot.get("labor_payslips_v1") ?? null).flatMap((value) => {
    const slip = asRecord(value);
    if (!slip) return [];
    const employeeId = typeof slip.employeeId === "string" ? slip.employeeId : "";
    const month = typeof slip.month === "string" ? slip.month : "";
    if (!employeeId || !/^\d{4}-\d{2}$/.test(month)) return [];
    return [{
      employeeId, month, grossSalary: finite(slip.grossSalary), advanceAmount: finite(slip.advanceAmount),
      pettyLaborPaid: finite(slip.pettyLaborPaid), finalSalary: finite(slip.finalSalary),
      totalEmployerCost: finite(slip.totalEmployerCost), notes: typeof slip.notes === "string" ? slip.notes : "",
    }];
  });
  const parsedDeptOrder = parseArray(snapshot.get("labor_dept_order_v1") ?? null)
    .filter((value): value is EmployeeDept => typeof value === "string" && EMPLOYEE_DEPTS.has(value as EmployeeDept));
  const deptOrder = parsedDeptOrder.length > 0 ? parsedDeptOrder : DEFAULT_DEPT_ORDER;
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
    payslips: Object.freeze(payrollDetails.map((slip) => ({
      month: slip.month, employeeId: slip.employeeId, totalEmployerCost: slip.totalEmployerCost, finalSalary: slip.finalSalary,
    }))),
    pettyRecords: Object.freeze(pettyRecords),
    employees: Object.freeze(employees),
    payrollDetails: Object.freeze(payrollDetails),
    deptOrder: Object.freeze(deptOrder),
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
