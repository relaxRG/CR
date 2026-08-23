import { buildStoreReportReadModel, type StoreReportFacts } from "@/lib/store/report-read-model";

const WARMUP_ITERATIONS = 3;
const MEASURED_ITERATIONS = 7;
const TARGET_MONTH = "2026-08";
const TOTAL_FACTS = 100_000;

function buildFacts(): StoreReportFacts {
  const payslips = Array.from({ length: 500 }, (_, index) => ({
    month: TARGET_MONTH,
    employeeId: `employee-${index}`,
    totalEmployerCost: 6500 + (index % 11) * 83.17,
    finalSalary: 4800 + (index % 13) * 61.29,
  }));
  const pettyRecords = Array.from({ length: 25_000 }, (_, index) => ({
    date: `${TARGET_MONTH}-${String((index % 28) + 1).padStart(2, "0")}`,
    code: (["N0", "N3", "A1", "B2", "K2"] as const)[index % 5],
    amount: 20 + (index % 37) * 3.75,
  }));
  const purchases = Array.from({ length: 50_000 }, (_, index) => ({
    id: `purchase-${index}`,
    date: `${TARGET_MONTH}-${String((index % 28) + 1).padStart(2, "0")}`,
    supplier: `供应商-${index % 250}`,
    amount: 100 + (index % 41) * 6.5,
  }));
  const inventory = Array.from({ length: TOTAL_FACTS - payslips.length - pettyRecords.length - purchases.length }, (_, index) => ({
    id: `inventory-${index}`,
    month: TARGET_MONTH,
    purchaseCost: 100 + (index % 23) * 5.25,
    consumptionCost: 50 + (index % 19) * 3.75,
    endingValue: 500 + (index % 29) * 8.5,
  }));
  return { payslips, pettyRecords, purchases, inventory };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function collectGarbage() {
  global.gc?.();
}

const facts = buildFacts();
const stableInput = JSON.stringify(facts);
for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration += 1) {
  buildStoreReportReadModel(TARGET_MONTH, facts);
}
collectGarbage();
const fixedFactsBaselineBytes = process.memoryUsage().heapUsed;

const elapsedMs: number[] = [];
const buildAllocationBytes: number[] = [];
const releasedResidualBytes: number[] = [];
let finalModel = buildStoreReportReadModel(TARGET_MONTH, facts);

for (let iteration = 0; iteration < MEASURED_ITERATIONS; iteration += 1) {
  finalModel = undefined as unknown as typeof finalModel;
  collectGarbage();
  const beforeBuild = process.memoryUsage().heapUsed;
  const start = process.hrtime.bigint();
  let model = buildStoreReportReadModel(TARGET_MONTH, facts);
  const end = process.hrtime.bigint();
  const afterBuild = process.memoryUsage().heapUsed;
  elapsedMs.push(Number(end - start) / 1_000_000);
  buildAllocationBytes.push(afterBuild - beforeBuild);
  finalModel = model;
  model = undefined as unknown as typeof model;
  finalModel = undefined as unknown as typeof finalModel;
  collectGarbage();
  releasedResidualBytes.push(process.memoryUsage().heapUsed - fixedFactsBaselineBytes);
}

finalModel = buildStoreReportReadModel(TARGET_MONTH, facts);
const report = {
  scenario: "store_report_read_model_100k_synthetic_facts",
  dataClassification: "synthetic_algorithm_stress_fixture_not_business_records",
  totalFacts: facts.payslips.length + facts.pettyRecords.length + facts.purchases.length + facts.inventory.length,
  warmupIterations: WARMUP_ITERATIONS,
  measuredIterations: MEASURED_ITERATIONS,
  gcExposed: typeof global.gc === "function",
  fixedFactsBaselineBytes,
  elapsedMs,
  medianElapsedMs: median(elapsedMs),
  buildAllocationBytes,
  medianBuildAllocationBytes: median(buildAllocationBytes),
  releasedResidualBytes,
  medianReleasedResidualBytes: median(releasedResidualBytes),
  memoryInterpretation: typeof global.gc === "function"
    ? "release residual is a same-process V8 heuristic, not a leak verdict; use isolated processes or heap snapshots for leak attribution."
    : "GC is unavailable, so memory values are non-comparable allocation samples only.",
  supplierRows: finalModel.suppliers.length,
  sourceVersionLength: finalModel.sourceVersion.length,
  inputUnchanged: JSON.stringify(facts) === stableInput,
  modelFrozen: Object.isFrozen(finalModel),
};

console.log(JSON.stringify(report, null, 2));
if (!report.inputUnchanged || !report.modelFrozen) process.exitCode = 1;
