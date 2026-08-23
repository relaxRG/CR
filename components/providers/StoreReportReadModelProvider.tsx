import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { registerStoreReload } from "@/lib/sync/engine";
import { PETTY_CODE_LABELS, type PettyCode } from "@/lib/store/petty-store";
import type { EmployeeDept, EmployeeType } from "@/lib/labor/types";
import { useGlobalBusinessMonth } from "@/lib/months/global-business-month";
import { createReportReadRefreshController } from "@/lib/store/report-read-refresh-controller";
import {
  buildStoreReportReadModel,
  loadStoreReportFacts,
  type StoreReportFacts,
  type StoreReportReadModel,
} from "@/lib/store/report-read-model";

const REPORT_SNAPSHOT_KEYS = [
  "store.revenue.v1", "store.petty.v1", "labor_employees_v1", "labor_payslips_v1", "labor_dept_order_v1",
  "labor_shifts_v1", "spirits.purchases.v3", "spirits.suppliers.v1", "food.purchases.v1",
  "store.petty_labor_links.v1", "wine.snapshots.v2", "wine.manual_purchases.v1",
] as const;
const REPORT_REVISION_KEYS = REPORT_SNAPSHOT_KEYS.map((key) => `sync.ts.${key}`);
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

function readSnapshotRevision(rows: readonly [string, string | null][]): string {
  const values = new Map(rows);
  return REPORT_SNAPSHOT_KEYS.map((key) => values.get(`sync.ts.${key}`) ?? "0").join(":");
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
  const shifts = parseArray(snapshot.get("labor_shifts_v1") ?? null).flatMap((value) => {
    const shift = asRecord(value);
    if (!shift) return [];
    const employeeId = typeof shift.employeeId === "string" ? shift.employeeId : "";
    const date = typeof shift.date === "string" ? shift.date : "";
    const shiftName = typeof shift.shift === "string" ? shift.shift : "";
    return employeeId && /^\d{4}-\d{2}-\d{2}$/.test(date) && shiftName
      ? [{ employeeId, date, shift: shiftName, hoursValue: finite(shift.hoursValue) }]
      : [];
  });
  const pettyLaborLinks = parseArray(snapshot.get("store.petty_labor_links.v1") ?? null).flatMap((value) => {
    const link = asRecord(value);
    if (!link) return [];
    const pettyRecordId = typeof link.pettyRecordId === "string" ? link.pettyRecordId : "";
    const month = typeof link.month === "string" ? link.month : "";
    return pettyRecordId && /^\d{4}-\d{2}$/.test(month)
      ? [{ pettyRecordId, month, amount: finite(link.amount) }]
      : [];
  });
  const spiritPurchases = parseArray(snapshot.get("spirits.purchases.v3") ?? null).flatMap((value) => {
    const purchase = asRecord(value);
    if (!purchase) return [];
    const id = typeof purchase.id === "string" ? purchase.id : "";
    const date = typeof purchase.date === "string" ? purchase.date : "";
    return id && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? [{ id, date, supplier: typeof purchase.supplier === "string" ? purchase.supplier : undefined, amount: finite(purchase.amount), domain: "spirits" as const }]
      : [];
  });
  const wineSnapshotPurchases = parseArray(snapshot.get("wine.snapshots.v2") ?? null).flatMap((value) => {
    const snapshot = asRecord(value);
    if (!snapshot) return [];
    const monthLabel = typeof snapshot.monthLabel === "string" ? snapshot.monthLabel : "";
    const match = monthLabel.match(/^(\d{4})年(\d{1,2})月$/);
    const supplierTotals = asRecord(snapshot.supplierTotals);
    if (!match || !supplierTotals) return [];
    const date = `${match[1]}-${match[2]!.padStart(2, "0")}-01`;
    return Object.entries(supplierTotals).flatMap(([supplier, amount]) => typeof amount === "number" && Number.isFinite(amount)
      ? [{ id: `wine-snapshot:${snapshot.id ?? monthLabel}:${supplier}`, date, supplier, amount, domain: "wine_snapshot" as const }]
      : []);
  });
  const wineManualPurchases = parseArray(snapshot.get("wine.manual_purchases.v1") ?? null).flatMap((value) => {
    const purchase = asRecord(value);
    if (!purchase) return [];
    const id = typeof purchase.id === "string" ? purchase.id : "";
    const date = typeof purchase.date === "string" ? purchase.date : "";
    const supplier = typeof purchase.supplier === "string" ? purchase.supplier : "";
    const productName = typeof purchase.productName === "string" ? purchase.productName : "";
    return id && /^\d{4}-\d{2}-\d{2}$/.test(date) && supplier
      ? [{ id, date, supplier, amount: finite(purchase.amount), domain: "wine_manual" as const, productName }]
      : [];
  });
  const spiritSupplierNames = parseArray(snapshot.get("spirits.suppliers.v1") ?? null).flatMap((value) => {
    const supplier = asRecord(value);
    const name = typeof supplier?.name === "string" ? supplier.name.trim() : "";
    return name ? [name] : [];
  });
  const foodPurchases = parseArray(snapshot.get("food.purchases.v1") ?? null).flatMap((value) => {
    const purchase = asRecord(value);
    if (!purchase) return [];
    const id = typeof purchase.id === "string" ? purchase.id : "";
    const importDate = typeof purchase.importDate === "string" ? purchase.importDate : "";
    const periodLabel = typeof purchase.periodLabel === "string" ? purchase.periodLabel : "";
    const periodMatch = periodLabel.match(/^(\d{4})年(\d{1,2})月$/);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(importDate)
      ? importDate
      : periodMatch ? `${periodMatch[1]}-${periodMatch[2]!.padStart(2, "0")}-01` : "";
    return id && date
      ? [{ id, date, supplier: typeof purchase.supplierName === "string" ? purchase.supplierName : undefined, amount: finite(purchase.totalAmount), domain: "food" as const }]
      : [];
  });
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
      const id = typeof record?.id === "string" ? record.id : "";
      const date = typeof record?.date === "string" ? record.date : "";
      const code = typeof record?.code === "string" ? record.code : "";
      const amount = typeof record?.amount === "number" ? record.amount : NaN;
      return id && /^\d{4}-\d{2}-\d{2}$/.test(date) && Object.hasOwn(PETTY_CODE_LABELS, code) && Number.isFinite(amount)
        ? [{ id, date, code: code as PettyCode, amount }]
        : [];
    })
    : [];
  return Object.freeze({
    payslips: Object.freeze(payrollDetails.map((slip) => ({
      month: slip.month, employeeId: slip.employeeId, totalEmployerCost: slip.totalEmployerCost, finalSalary: slip.finalSalary,
    }))),
    pettyRecords: Object.freeze(pettyRecords),
    pettyLaborLinks: Object.freeze(pettyLaborLinks),
    spiritSupplierNames: Object.freeze(spiritSupplierNames),
    employees: Object.freeze(employees),
    payrollDetails: Object.freeze(payrollDetails),
    deptOrder: Object.freeze(deptOrder),
    shifts: Object.freeze(shifts),
    revenueRecords: Object.freeze(revenueRecords),
    purchases: Object.freeze([...spiritPurchases, ...wineSnapshotPurchases, ...wineManualPurchases, ...foodPurchases]),
    inventory: [],
  });
}

export function StoreReportReadModelProvider({ children }: { children: React.ReactNode }) {
  const { month } = useGlobalBusinessMonth();
  const [facts, setFacts] = useState<StoreReportFacts>(EMPTY_FACTS);
  const [ready, setReady] = useState(false);
  const refreshController = useRef(createReportReadRefreshController());
  const committedRevision = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const ticket = refreshController.current.begin();
    try {
      const revisionRows = await AsyncStorage.multiGet(REPORT_REVISION_KEYS);
      const revision = readSnapshotRevision(revisionRows);
      if (!refreshController.current.isCurrent(ticket)) return;
      if (committedRevision.current === revision) {
        setReady(true);
        return;
      }
      const nextFacts = await loadStoreReportFacts(AsyncStorage, REPORT_SNAPSHOT_KEYS, decodeStoreReportSnapshot);
      if (!refreshController.current.isCurrent(ticket)) return;
      committedRevision.current = revision;
      setFacts(nextFacts);
      setReady(true);
    } catch {
      if (refreshController.current.isCurrent(ticket)) setReady(true);
    }
  }, []);

  useEffect(() => {
    const guardedRefresh = () => { void refresh(); };
    void refresh();
    const unregister = registerStoreReload(guardedRefresh);
    return () => { refreshController.current.dispose(); unregister(); };
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
