import { performance } from "node:perf_hooks";

type CompOffEntry = {
  employeeId: string;
  source: "overtime" | "holiday";
  status: "available" | "used_rest";
  expiresMonth: string;
  days: number;
};

type RestAlert = { employeeId: string; month: string; resolution: "pending" | "deduct" | "waive"; unexplainedDays: number };
type CashRecord = { date: string; category: string; amount: number };

const EMPLOYEE_COUNT = 500;
const COMP_OFF_ENTRY_COUNT = 10_000;
const CASH_RECORD_COUNT = 12_000;
const INVENTORY_ITEM_COUNT = 1_000;
const INVENTORY_PURCHASE_COUNT = 10_000;
const SCHEDULE_SHIFT_COUNT = 10_000;
const SCHEDULE_DAYS = 31;
const SHOP_ITEM_COUNT = 1_000;
const SHOP_PURCHASE_COUNT = 10_000;
const SHOP_CONSUME_COUNT = 10_000;
const MONTH = "2026-08";
const PREVIOUS_MONTH = "2026-07";
const RUNS = 7;

const employees = Array.from({ length: EMPLOYEE_COUNT }, (_, index) => `employee-${index + 1}`);
const compOffEntries: CompOffEntry[] = Array.from({ length: COMP_OFF_ENTRY_COUNT }, (_, index) => ({
  employeeId: employees[index % employees.length],
  source: index % 3 === 0 ? "holiday" : "overtime",
  status: index % 5 === 0 ? "used_rest" : "available",
  expiresMonth: index % 7 === 0 ? "2026-07" : "2026-10",
  days: index % 4 === 0 ? 0.5 : 1,
}));
const restAlerts: RestAlert[] = Array.from({ length: COMP_OFF_ENTRY_COUNT }, (_, index) => ({
  employeeId: employees[index % employees.length],
  month: index % 2 === 0 ? MONTH : PREVIOUS_MONTH,
  resolution: index % 3 === 0 ? "pending" : "waive",
  unexplainedDays: (index % 3) + 0.5,
}));
const revenueRecords: CashRecord[] = Array.from({ length: CASH_RECORD_COUNT }, (_, index) => ({
  date: `${index % 2 === 0 ? MONTH : PREVIOUS_MONTH}-${String((index % 28) + 1).padStart(2, "0")}`,
  category: index % 6 === 0 ? "revenue" : index % 5 === 0 ? "wine_cost" : "food_cost",
  amount: 20 + (index % 700),
}));
const pettyRecords: CashRecord[] = Array.from({ length: CASH_RECORD_COUNT }, (_, index) => ({
  date: `${index % 2 === 0 ? MONTH : PREVIOUS_MONTH}-${String((index % 28) + 1).padStart(2, "0")}`,
  category: "petty_cash",
  amount: 5 + (index % 120),
}));
const inventoryItems = Array.from({ length: INVENTORY_ITEM_COUNT }, (_, index) => ({ id: `item-${index + 1}`, referencePrice: 50 + (index % 300) }));
const inventoryGroups = Array.from({ length: 20 }, (_, index) => ({ name: `group-${index + 1}`, color: `#${String(100000 + index)}` }));
const inventoryPurchases = Array.from({ length: INVENTORY_PURCHASE_COUNT }, (_, index) => ({
  id: `purchase-${index + 1}`,
  itemId: inventoryItems[index % inventoryItems.length]!.id,
  group: inventoryGroups[index % inventoryGroups.length]!.name,
  quantity: (index % 12) + 1,
  unitPrice: 60 + (index % 300),
}));
const scheduleShifts = Array.from({ length: SCHEDULE_SHIFT_COUNT }, (_, index) => ({
  employeeId: employees[index % employees.length]!,
  date: `${MONTH}-${String((index % SCHEDULE_DAYS) + 1).padStart(2, "0")}`,
  session: index % 2 === 0 ? "晚班" : "早班",
}));
const shopItems = Array.from({ length: SHOP_ITEM_COUNT }, (_, index) => ({ id: `shop-item-${index + 1}`, latestCostPrice: 20 + (index % 80) }));
const shopPurchases = Array.from({ length: SHOP_PURCHASE_COUNT }, (_, index) => ({ itemId: shopItems[index % shopItems.length]!.id, quantity: (index % 8) + 1, totalAmount: 100 + (index % 300) }));
const shopConsumes = Array.from({ length: SHOP_CONSUME_COUNT }, (_, index) => ({ itemId: shopItems[index % shopItems.length]!.id, quantity: (index % 5) + 1, totalCost: 30 + (index % 120), reason: index % 7 === 0 ? "loss" : "normal" }));
const shopPreviousSnapshotItems = shopItems.map((item, index) => ({ itemId: item.id, closingQty: 20 + (index % 10), closingUnitCost: 20 + (index % 80) }));

function forceGc() {
  global.gc?.();
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(name: string, run: () => number, runs = RUNS) {
  const elapsed: number[] = [];
  let checksum = 0;
  forceGc();
  const retainedBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    checksum += run();
    elapsed.push(performance.now() - startedAt);
  }
  forceGc();
  const retainedAfter = process.memoryUsage().heapUsed;
  return {
    name,
    medianMs: Number(median(elapsed).toFixed(3)),
    minMs: Number(Math.min(...elapsed).toFixed(3)),
    maxMs: Number(Math.max(...elapsed).toFixed(3)),
    retainedHeapDeltaBytes: retainedAfter - retainedBefore,
    checksum,
  };
}

function baselineEmployeeCardLookups() {
  let total = 0;
  for (const employeeId of employees) {
    const overtime = compOffEntries
      .filter((entry) => entry.employeeId === employeeId && entry.source === "overtime" && entry.status === "available" && entry.expiresMonth >= MONTH)
      .reduce((sum, entry) => sum + entry.days, 0);
    const holiday = compOffEntries
      .filter((entry) => entry.employeeId === employeeId && entry.source === "holiday" && entry.status === "available" && entry.expiresMonth >= MONTH)
      .reduce((sum, entry) => sum + entry.days, 0);
    const alert = restAlerts.find((entry) => entry.employeeId === employeeId && entry.month === MONTH);
    total += overtime + holiday + (alert?.unexplainedDays ?? 0);
  }
  return total;
}

function indexedEmployeeCardLookups() {
  const compOffSummary = new Map<string, { overtimeAvailable: number; holidayAvailable: number }>();
  for (const entry of compOffEntries) {
    if (entry.status !== "available" || entry.expiresMonth < MONTH) continue;
    const current = compOffSummary.get(entry.employeeId) ?? { overtimeAvailable: 0, holidayAvailable: 0 };
    if (entry.source === "overtime") current.overtimeAvailable += entry.days;
    else current.holidayAvailable += entry.days;
    compOffSummary.set(entry.employeeId, current);
  }
  const alertByEmployee = new Map<string, RestAlert>();
  for (const alert of restAlerts) if (alert.month === MONTH) alertByEmployee.set(alert.employeeId, alert);
  let total = 0;
  for (const employeeId of employees) {
    const balance = compOffSummary.get(employeeId) ?? { overtimeAvailable: 0, holidayAvailable: 0 };
    total += balance.overtimeAvailable + balance.holidayAvailable + (alertByEmployee.get(employeeId)?.unexplainedDays ?? 0);
  }
  return total;
}

function isInMonth(record: CashRecord, month: string) {
  return record.date.startsWith(month);
}

function baselineAnalyticsSummaries() {
  const summarize = (month: string) => {
    const totals = new Map<string, number>();
    revenueRecords.filter((record) => isInMonth(record, month)).forEach((record) => totals.set(record.category, (totals.get(record.category) ?? 0) + record.amount));
    const pettyTotal = pettyRecords.filter((record) => isInMonth(record, month)).reduce((sum, record) => sum + record.amount, 0);
    totals.set("petty_cash", (totals.get("petty_cash") ?? 0) + pettyTotal);
    return totals;
  };
  const current = summarize(MONTH);
  const previous = summarize(PREVIOUS_MONTH);
  return (current.get("revenue") ?? 0) + (previous.get("revenue") ?? 0);
}

function indexedAnalyticsSummaries() {
  const current = new Map<string, number>();
  const previous = new Map<string, number>();
  const add = (target: Map<string, number>, key: string, amount: number) => target.set(key, (target.get(key) ?? 0) + amount);
  for (const record of revenueRecords) {
    if (isInMonth(record, MONTH)) add(current, record.category, record.amount);
    if (isInMonth(record, PREVIOUS_MONTH)) add(previous, record.category, record.amount);
  }
  for (const record of pettyRecords) {
    if (isInMonth(record, MONTH)) add(current, "petty_cash", record.amount);
    if (isInMonth(record, PREVIOUS_MONTH)) add(previous, "petty_cash", record.amount);
  }
  return (current.get("revenue") ?? 0) + (previous.get("revenue") ?? 0);
}

function baselineInventoryRows() {
  let checksum = 0;
  for (const purchase of inventoryPurchases) {
    const item = inventoryItems.find((candidate) => candidate.id === purchase.itemId);
    const group = inventoryGroups.find((candidate) => candidate.name === purchase.group);
    const rowNumber = inventoryPurchases.indexOf(purchase) + 1;
    checksum += (item?.referencePrice ?? 0) + (group?.color.length ?? 0) + rowNumber + purchase.quantity;
  }
  return checksum;
}

function indexedInventoryRows() {
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const groupByName = new Map(inventoryGroups.map((group) => [group.name, group]));
  const purchaseIndexById = new Map(inventoryPurchases.map((purchase, index) => [purchase.id, index + 1]));
  let checksum = 0;
  for (const purchase of inventoryPurchases) {
    checksum += (itemById.get(purchase.itemId)?.referencePrice ?? 0)
      + (groupByName.get(purchase.group)?.color.length ?? 0)
      + (purchaseIndexById.get(purchase.id) ?? 0)
      + purchase.quantity;
  }
  return checksum;
}

function virtualizedInventoryInitialWindow() {
  const maxRowsPerGroupChunk = 32;
  const initialChunks = 4;
  const initialRowCount = Math.min(inventoryPurchases.length, maxRowsPerGroupChunk * initialChunks);
  return inventoryPurchases.slice(0, initialRowCount).reduce((sum, purchase) => sum + purchase.quantity, 0);
}

function baselineShopLedger() {
  let checksum = 0;
  for (const item of shopItems) {
    const opening = shopPreviousSnapshotItems.find((entry) => entry.itemId === item.id) ?? { closingQty: 0, closingUnitCost: 0 };
    const purchases = shopPurchases.filter((record) => record.itemId === item.id);
    const consumes = shopConsumes.filter((record) => record.itemId === item.id);
    const purchaseQty = purchases.reduce((sum, record) => sum + record.quantity, 0);
    const consumeQty = consumes.filter((record) => record.reason !== "loss").reduce((sum, record) => sum + record.quantity, 0);
    const lossQty = consumes.filter((record) => record.reason === "loss").reduce((sum, record) => sum + record.quantity, 0);
    checksum += opening.closingQty + opening.closingUnitCost + purchaseQty + consumeQty + lossQty;
  }
  return checksum;
}

function indexedShopLedger() {
  const purchasesByItemId = new Map<string, typeof shopPurchases>();
  const consumesByItemId = new Map<string, typeof shopConsumes>();
  const openingByItemId = new Map(shopPreviousSnapshotItems.map((entry) => [entry.itemId, entry]));
  shopPurchases.forEach((record) => purchasesByItemId.set(record.itemId, [...(purchasesByItemId.get(record.itemId) ?? []), record]));
  shopConsumes.forEach((record) => consumesByItemId.set(record.itemId, [...(consumesByItemId.get(record.itemId) ?? []), record]));
  let checksum = 0;
  for (const item of shopItems) {
    const opening = openingByItemId.get(item.id) ?? { closingQty: 0, closingUnitCost: 0 };
    const purchases = purchasesByItemId.get(item.id) ?? [];
    const consumes = consumesByItemId.get(item.id) ?? [];
    const purchaseQty = purchases.reduce((sum, record) => sum + record.quantity, 0);
    const consumeQty = consumes.filter((record) => record.reason !== "loss").reduce((sum, record) => sum + record.quantity, 0);
    const lossQty = consumes.filter((record) => record.reason === "loss").reduce((sum, record) => sum + record.quantity, 0);
    checksum += opening.closingQty + opening.closingUnitCost + purchaseQty + consumeQty + lossQty;
  }
  return checksum;
}

function baselineScheduleGridLookups() {
  let checksum = 0;
  for (const employeeId of employees) {
    for (let day = 1; day <= SCHEDULE_DAYS; day += 1) {
      const date = `${MONTH}-${String(day).padStart(2, "0")}`;
      checksum += scheduleShifts.find((shift) => shift.employeeId === employeeId && shift.date === date && shift.session === "晚班") ? 1 : 0;
    }
  }
  return checksum;
}

function indexedScheduleGridLookups() {
  const entryByKey = new Map(scheduleShifts.map((shift) => [`${shift.employeeId}|${shift.date}|${shift.session}`, shift]));
  let checksum = 0;
  for (const employeeId of employees) {
    for (let day = 1; day <= SCHEDULE_DAYS; day += 1) {
      const date = `${MONTH}-${String(day).padStart(2, "0")}`;
      checksum += entryByKey.has(`${employeeId}|${date}|晚班`) ? 1 : 0;
    }
  }
  return checksum;
}

const results = [
  measure("employee_cards_repeated_scan", baselineEmployeeCardLookups),
  measure("employee_cards_parent_index", indexedEmployeeCardLookups),
  measure("analytics_two_pass_filters", baselineAnalyticsSummaries),
  measure("analytics_single_pass", indexedAnalyticsSummaries),
  measure("inventory_rows_linear_lookups", baselineInventoryRows),
  measure("inventory_rows_indexed_lookups", indexedInventoryRows),
  measure("inventory_virtualized_initial_window", virtualizedInventoryInitialWindow),
  measure("shop_ledger_repeated_filters", baselineShopLedger),
  measure("shop_ledger_indexed_records_and_opening", indexedShopLedger),
  measure("schedule_grid_linear_lookup", baselineScheduleGridLookups, 3),
  measure("schedule_grid_indexed_lookup", indexedScheduleGridLookups, 3),
];

console.log(JSON.stringify({
  scenario: {
    employees: EMPLOYEE_COUNT,
    compOffEntries: COMP_OFF_ENTRY_COUNT,
    restAlerts: COMP_OFF_ENTRY_COUNT,
    revenueRecords: CASH_RECORD_COUNT,
    pettyRecords: CASH_RECORD_COUNT,
    inventoryItems: INVENTORY_ITEM_COUNT,
    inventoryPurchases: INVENTORY_PURCHASE_COUNT,
    scheduleShifts: SCHEDULE_SHIFT_COUNT,
    scheduleDays: SCHEDULE_DAYS,
    shopItems: SHOP_ITEM_COUNT,
    shopPurchases: SHOP_PURCHASE_COUNT,
    shopConsumes: SHOP_CONSUME_COUNT,
    runsPerMeasurement: RUNS,
  },
  results,
}, null, 2));
