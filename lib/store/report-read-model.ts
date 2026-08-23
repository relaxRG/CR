import type { PaySlip } from "@/lib/labor/types";
import type { PettyRecord } from "@/lib/store/petty-store";

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
  suppliers: ReadonlyArray<Readonly<{ supplier: string; purchaseAmount: number }>>;
  sourceVersion: string;
}>;

export type StoreReportFacts = Readonly<{
  payslips: readonly Pick<PaySlip, "month" | "employeeId" | "totalEmployerCost" | "finalSalary">[];
  pettyRecords: readonly Pick<PettyRecord, "date" | "code" | "amount">[];
  purchases: readonly ReportPurchaseFact[];
  inventory: readonly ReportInventoryFact[];
}>;

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const isPettyInflow = (code: string) => ["N0", "N1", "N2"].includes(code);
const isPettyOtherIncome = (code: string) => ["N3", "N4", "N5"].includes(code);

/**
 * 只读、确定性聚合：不修改输入，不访问 React Context，不写 AsyncStorage，也不暴露增删改命令。
 */
export function buildStoreReportReadModel(month: string, facts: StoreReportFacts): StoreReportReadModel {
  const slips = facts.payslips.filter((slip) => slip.month === month);
  const pettyRecords = facts.pettyRecords.filter((record) => record.date.startsWith(month));
  const inventoryRows = facts.inventory.filter((row) => row.month === month);
  const purchases = facts.purchases.filter((purchase) => purchase.date.startsWith(month));

  const supplierAmounts = new Map<string, number>();
  for (const purchase of purchases) {
    const supplier = purchase.supplier?.trim() || "未命名供应商";
    supplierAmounts.set(supplier, roundMoney((supplierAmounts.get(supplier) ?? 0) + purchase.amount));
  }

  const sourceVersion = [
    month,
    slips.map((slip) => slip.employeeId).sort().join(","),
    pettyRecords.length,
    purchases.map((purchase) => purchase.id).sort().join(","),
    inventoryRows.map((row) => row.id).sort().join(","),
  ].join("|");

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
    suppliers: Object.freeze([...supplierAmounts.entries()]
      .map(([supplier, purchaseAmount]) => Object.freeze({ supplier, purchaseAmount }))
      .sort((a, b) => b.purchaseAmount - a.purchaseAmount || a.supplier.localeCompare(b.supplier))),
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
