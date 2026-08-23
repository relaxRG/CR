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

function forceGc() {
  global.gc?.();
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(name: string, run: () => number) {
  const elapsed: number[] = [];
  let checksum = 0;
  forceGc();
  const retainedBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < RUNS; index += 1) {
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

const results = [
  measure("employee_cards_repeated_scan", baselineEmployeeCardLookups),
  measure("employee_cards_parent_index", indexedEmployeeCardLookups),
  measure("analytics_two_pass_filters", baselineAnalyticsSummaries),
  measure("analytics_single_pass", indexedAnalyticsSummaries),
];

console.log(JSON.stringify({
  scenario: {
    employees: EMPLOYEE_COUNT,
    compOffEntries: COMP_OFF_ENTRY_COUNT,
    restAlerts: COMP_OFF_ENTRY_COUNT,
    revenueRecords: CASH_RECORD_COUNT,
    pettyRecords: CASH_RECORD_COUNT,
    runsPerMeasurement: RUNS,
  },
  results,
}, null, 2));
