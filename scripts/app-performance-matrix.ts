import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Sample = { name: string; medianMs: number; minMs: number; maxMs: number; retainedHeapDeltaBytes: number; checksum: number };

const runs = 7;
const gc = (globalThis as unknown as { gc?: () => void }).gc;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(name: string, work: () => number): Sample {
  const durations: number[] = [];
  const heapDeltas: number[] = [];
  let checksum = 0;
  for (let index = 0; index < runs; index += 1) {
    gc?.();
    const before = process.memoryUsage().heapUsed;
    const started = performance.now();
    checksum += work();
    durations.push(performance.now() - started);
    gc?.();
    heapDeltas.push(process.memoryUsage().heapUsed - before);
  }
  return {
    name,
    medianMs: Number(median(durations).toFixed(3)),
    minMs: Number(Math.min(...durations).toFixed(3)),
    maxMs: Number(Math.max(...durations).toFixed(3)),
    retainedHeapDeltaBytes: Math.round(median(heapDeltas)),
    checksum,
  };
}

const bottles = Array.from({ length: 10_000 }, (_, index) => ({
  id: `wine-${index}`,
  name: `Wine ${index}`,
  nameEn: `Reserve ${index}`,
  region: `Region ${index % 24}`,
  grape: `Grape ${index % 18}`,
  winery: `Winery ${index % 90}`,
}));
const recipes = Array.from({ length: 5_000 }, (_, index) => ({
  id: `recipe-${index}`,
  name: `Cocktail ${index}`,
  category: `Category ${index % 16}`,
  ingredients: Array.from({ length: 6 }, (_, ingredient) => `Ingredient ${index % 160}-${ingredient}`),
}));
const foods = Array.from({ length: 5_000 }, (_, index) => ({ id: `food-${index}`, name: `Dish ${index}`, category: `Food ${index % 14}`, ingredients: [`Material ${index % 500}`] }));
const shoppingLines = Array.from({ length: 20_000 }, (_, index) => ({ itemId: `item-${index % 2_000}`, quantity: 1 + (index % 5), source: index % 2 ? "recipe" : "manual" }));
const labRecords = Array.from({ length: 12_000 }, (_, index) => ({ id: `lab-${index}`, projectId: `project-${index % 500}`, status: index % 3 === 0 ? "active" : "archived", updatedAt: 1_700_000_000_000 + index }));

function groupedWineRows(keyOf: (bottle: typeof bottles[number]) => string) {
  const groups = new Map<string, typeof bottles>();
  bottles.forEach((bottle) => {
    const key = keyOf(bottle);
    const entries = groups.get(key) ?? [];
    entries.push(bottle);
    groups.set(key, entries);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).flatMap(([title, entries]) => [
    { kind: "header", title },
    ...entries.map((bottle) => ({ kind: "bottle", id: bottle.id })),
  ]);
}

function structuralVirtualizationCheck() {
  const paths = [
    "app/(tabs)/bottles.tsx",
    "app/(tabs)/recipes.tsx",
    "app/(tabs)/food.tsx",
    "app/(tabs)/wine.tsx",
    "app/(tabs)/shopping.tsx",
    "components/inventory/VirtualizedHorizontalLedgerTable.tsx",
    "app/labor-employees.tsx",
    "app/labor-attendance.tsx",
  ];
  return paths.reduce((count, path) => {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    return count + (source.includes("FlatList") ? 1 : 0);
  }, 0);
}

const results = [
  measure("wine_grouped_rows_10k", () => groupedWineRows((bottle) => bottle.region).length + groupedWineRows((bottle) => bottle.grape).length),
  measure("cocktail_recipe_search_5k", () => recipes.filter((recipe) => recipe.name.includes("24") || recipe.ingredients.some((ingredient) => ingredient.includes("24"))).length),
  measure("food_search_5k", () => foods.filter((food) => food.name.includes("24") || food.ingredients.some((ingredient) => ingredient.includes("24"))).length),
  measure("shopping_aggregate_20k", () => {
    const totals = new Map<string, number>();
    shoppingLines.forEach((line) => totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity));
    return totals.size;
  }),
  measure("lab_active_project_index_12k", () => {
    const projects = new Map<string, number>();
    labRecords.forEach((record) => { if (record.status === "active") projects.set(record.projectId, (projects.get(record.projectId) ?? 0) + 1); });
    return projects.size;
  }),
  measure("virtualized_screen_contracts", structuralVirtualizationCheck),
];

console.log(JSON.stringify({
  scenario: {
    wineBottles: bottles.length,
    cocktailRecipes: recipes.length,
    foodItems: foods.length,
    shoppingLines: shoppingLines.length,
    labRecords: labRecords.length,
    runsPerMeasurement: runs,
    note: "Measures deterministic data preparation and source-level virtualization contracts; native view composition requires an iOS profiler.",
  },
  results,
}, null, 2));
