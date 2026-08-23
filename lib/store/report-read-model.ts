import type { Employee, EmployeeDept, PaySlip } from "@/lib/labor/types";
import type { PettyRecord } from "@/lib/store/petty-store";

export type ReportEmployeeFact = Readonly<{
  id: Employee["id"];
  code: Employee["code"];
  realName: Employee["realName"];
  dept: Employee["dept"];
  type: Employee["type"];
  sortOrder?: Employee["sortOrder"];
  active: Employee["active"];
  archived: boolean;
  bankAccounts: ReadonlyArray<Readonly<{ bankName: string; cardNumber: string; isDefault: boolean }>>;
}>;
export type ReportPaySlipFact = Readonly<Pick<PaySlip, "employeeId" | "month" | "grossSalary" | "advanceAmount" | "pettyLaborPaid" | "finalSalary" | "totalEmployerCost" | "notes">>;

export type ReportRevenueFact = Readonly<{
  date: string;
  category: string;
  amount: number;
}>;

export type ReportPurchaseFact = Readonly<{
  id: string;
  date: string;
  supplier?: string;
  amount: number;
}>;

export type ReportInventoryFact = Readonly<{
  id: string;
  month: string;
  purchaseCost: number;
  consumptionCost: number;
  endingValue: number;
}>;

export type StoreReportReadModel = Readonly<{
  month: string;
  labor: Readonly<{ employeeCount: number; employerCost: number; netPaid: number }>;
  petty: Readonly<{ inflow: number; otherIncome: number; expense: number }>;
  inventory: Readonly<{ purchaseCost: number; consumptionCost: number; endingValue: number }>;
  laborDetails: Readonly<{
    employees: ReadonlyArray<ReportEmployeeFact>;
    paySlips: ReadonlyArray<ReportPaySlipFact>;
    deptOrder: ReadonlyArray<EmployeeDept>;
  }>;
  suppliers: ReadonlyArray<Readonly<{ supplier: string; purchaseAmount: number }>>;
  /** 全时段按日归集，只读供经营分析按日、月、年与自定义范围筛选。 */
  analyticsByDate: ReadonlyArray<Readonly<{ date: string; amounts: Readonly<Record<string, number>> }>>;
  sourceVersion: string;
}>;

export type StoreReportFacts = Readonly<{
  payslips: readonly Pick<PaySlip, "month" | "employeeId" | "totalEmployerCost" | "finalSalary">[];
  pettyRecords: readonly Pick<PettyRecord, "date" | "code" | "amount">[];
  employees?: readonly ReportEmployeeFact[];
  payrollDetails?: readonly ReportPaySlipFact[];
  deptOrder?: readonly EmployeeDept[];
  revenueRecords?: readonly ReportRevenueFact[];
  purchases: readonly ReportPurchaseFact[];
  inventory: readonly ReportInventoryFact[];
}>;

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isPettyInflow = (code: string) => ["N0", "N1", "N2"].includes(code);
const isPettyOtherIncome = (code: string) => ["N3", "N4", "N5"].includes(code);

function* reportFactFingerprintParts(
  slips: readonly Pick<PaySlip, "month" | "employeeId" | "totalEmployerCost" | "finalSalary">[],
  pettyRecords: readonly Pick<PettyRecord, "date" | "code" | "amount">[],
  employees: readonly ReportEmployeeFact[],
  payrollDetails: readonly ReportPaySlipFact[],
  revenueRecords: readonly ReportRevenueFact[],
  purchases: readonly ReportPurchaseFact[],
  inventoryRows: readonly ReportInventoryFact[],
): Iterable<string | number> {
  yield slips.length;
  for (const slip of slips) {
    yield slip.employeeId;
    yield slip.totalEmployerCost;
    yield slip.finalSalary;
  }
  yield pettyRecords.length;
  for (const record of pettyRecords) {
    yield record.date;
    yield record.code;
    yield record.amount;
  }
  yield employees.length;
  for (const employee of employees) {
    yield employee.id;
    yield employee.realName;
    yield employee.active ? 1 : 0;
    yield employee.archived ? 1 : 0;
  }
  yield payrollDetails.length;
  for (const slip of payrollDetails) {
    yield slip.employeeId;
    yield slip.grossSalary;
    yield slip.finalSalary;
    yield slip.advanceAmount;
    yield slip.pettyLaborPaid ?? 0;
  }
  yield revenueRecords.length;
  for (const record of revenueRecords) {
    yield record.date;
    yield record.category;
    yield record.amount;
  }
  yield purchases.length;
  for (const purchase of purchases) {
    yield purchase.id;
    yield purchase.supplier ?? "";
    yield purchase.amount;
  }
  yield inventoryRows.length;
  for (const row of inventoryRows) {
    yield row.id;
    yield row.purchaseCost;
    yield row.consumptionCost;
    yield row.endingValue;
  }
}

function fingerprintParts(parts: Iterable<string | number>): string {
  let hash = 2_166_136_261;
  for (const part of parts) {
    const value = String(part);
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619);
    }
    hash ^= 124; // 分隔符，避免 ["12", "3"] 与 ["1", "23"] 发生同序拼接歧义。
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function buildAnalyticsByDate(revenueRecords: readonly ReportRevenueFact[], pettyRecords: readonly Pick<PettyRecord, "date" | "code" | "amount">[]) {
  const totals = new Map<string, Map<string, number>>();
  const add = (date: string, category: string, amount: number) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount)) return;
    const byCategory = totals.get(date) ?? new Map<string, number>();
    byCategory.set(category, roundMoney((byCategory.get(category) ?? 0) + amount));
    totals.set(date, byCategory);
  };
  for (const record of revenueRecords) add(record.date, record.category, record.amount);
  for (const record of pettyRecords) add(record.date, "petty_cash", record.amount);
  return Object.freeze([...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amounts]) => Object.freeze({
      date,
      amounts: Object.freeze(Object.fromEntries(amounts.entries())),
    })));
}

/**
 * 只读、确定性聚合：不修改输入，不访问 React Context，不写 AsyncStorage，也不暴露增删改命令。
 */
export function buildStoreReportReadModel(month: string, facts: StoreReportFacts): StoreReportReadModel {
  const slips = facts.payslips.filter((slip) => slip.month === month);
  const pettyRecords = facts.pettyRecords.filter((record) => record.date.startsWith(month));
  const revenueRecords = facts.revenueRecords ?? [];
  const inventoryRows = facts.inventory.filter((row) => row.month === month);
  const purchases = facts.purchases.filter((purchase) => purchase.date.startsWith(month));

  const supplierAmounts = new Map<string, number>();
  for (const purchase of purchases) {
    const supplier = purchase.supplier?.trim() || "未命名供应商";
    supplierAmounts.set(supplier, roundMoney((supplierAmounts.get(supplier) ?? 0) + purchase.amount));
  }

  const sourceVersion = `${month}:${fingerprintParts(
    reportFactFingerprintParts(slips, pettyRecords, facts.employees ?? [], facts.payrollDetails ?? [], revenueRecords, purchases, inventoryRows),
  )}`;

  return Object.freeze({
    month,
    labor: Object.freeze({
      employeeCount: new Set(slips.map((slip) => slip.employeeId)).size,
      employerCost: roundMoney(slips.reduce((sum, slip) => sum + slip.totalEmployerCost, 0)),
      netPaid: roundMoney(slips.reduce((sum, slip) => sum + slip.finalSalary, 0)),
    }),
    petty: Object.freeze({
      inflow: roundMoney(pettyRecords.filter((record) => isPettyInflow(record.code)).reduce((sum, record) => sum + record.amount, 0)),
      otherIncome: roundMoney(pettyRecords.filter((record) => isPettyOtherIncome(record.code)).reduce((sum, record) => sum + record.amount, 0)),
      expense: roundMoney(pettyRecords.filter((record) => !isPettyInflow(record.code) && !isPettyOtherIncome(record.code)).reduce((sum, record) => sum + record.amount, 0)),
    }),
    inventory: Object.freeze({
      purchaseCost: roundMoney(inventoryRows.reduce((sum, row) => sum + row.purchaseCost, 0)),
      consumptionCost: roundMoney(inventoryRows.reduce((sum, row) => sum + row.consumptionCost, 0)),
      endingValue: roundMoney(inventoryRows.reduce((sum, row) => sum + row.endingValue, 0)),
    }),
    laborDetails: Object.freeze({
      employees: Object.freeze([...(facts.employees ?? [])]),
      paySlips: Object.freeze([...(facts.payrollDetails ?? [])]),
      deptOrder: Object.freeze([...(facts.deptOrder ?? [])]),
    }),
    suppliers: Object.freeze([...supplierAmounts.entries()]
      .map(([supplier, purchaseAmount]) => Object.freeze({ supplier, purchaseAmount }))
      .sort((a, b) => b.purchaseAmount - a.purchaseAmount || a.supplier.localeCompare(b.supplier))),
    analyticsByDate: buildAnalyticsByDate(revenueRecords, facts.pettyRecords),
    sourceVersion,
  });
}

export type ReadonlyStorage = Pick<StorageLike, "multiGet">;
type StorageLike = { multiGet: (keys: readonly string[]) => Promise<readonly [string, string | null][]> };

/**
 * 只读快照协议：调用方提供已登记的跨域键与解析器；本函数只调用 multiGet，绝不 setItem、removeItem 或 notifySyncChange。
 */
export async function loadStoreReportFacts<T extends StoreReportFacts>(
  storage: ReadonlyStorage,
  keys: readonly string[],
  decode: (snapshot: ReadonlyMap<string, string | null>) => T,
): Promise<T> {
  const rows = await storage.multiGet(keys);
  return decode(new Map(rows));
}
