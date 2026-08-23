#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const read = (relative) => fs.readFileSync(path.resolve(relative), "utf8");
const tabProvidersPath = "components/providers/StoreTabProviders.tsx";
const boundaryPath = "components/providers/StoreTabBoundary.tsx";
const screenPath = "app/(tabs)/store.tsx";
const featureBoundaryPath = "components/providers/AppFeatureBoundary.tsx";
const tabProviders = read(tabProvidersPath);
const boundary = read(boundaryPath);
const screen = read(screenPath);
const featureBoundary = read(featureBoundaryPath);

function componentBody(name) {
  const match = tabProviders.match(new RegExp(`export function ${name}\\([^]*?\\n}`));
  if (!match) throw new Error(`未找到 ${name}`);
  return match[0];
}

function providersIn(name) {
  return [...componentBody(name).matchAll(/<([A-Za-z][A-Za-z0-9]+Provider)(?:\s|>)/g)].map((match) => match[1]);
}

const activeTabs = {
  shop: providersIn("StoreShopProviders"),
  petty: providersIn("StorePettyProviders"),
  inventory: providersIn("StoreInventoryProviders"),
  labor: providersIn("StoreLaborProviders"),
};
const expectedTabs = {
  shop: ["GlasswareInventoryProvider", "TablewareInventoryProvider", "DailyInventoryProvider", "EquipmentInventoryProvider"],
  petty: ["PettyCashProvider", "PettyCategoryProvider", "PettyInventoryLinkProvider", "PettyLaborLinkProvider"],
  inventory: ["SpiritsInventoryProvider", "FoodIngredientProvider", "BeerInventoryProvider", "IceNewInventoryProvider", "FruitNewInventoryProvider"],
  labor: ["LaborProvider", "SalaryAdvanceCategoryProvider", "SalaryAdvanceProvider"],
};
const allStableProviders = Object.values(activeTabs).flat();
const duplicateStableProviders = [...new Set(allStableProviders)].filter((provider) => allStableProviders.filter((value) => value === provider).length > 1);
const expectedMismatch = Object.entries(expectedTabs)
  .filter(([tab, expected]) => expected.some((provider) => !activeTabs[tab].includes(provider)) || activeTabs[tab].some((provider) => !expected.includes(provider)))
  .map(([tab]) => tab);
const reportUsesCompatibilityBridge = componentBody("StoreReportProviders").includes("<StoreFeatureProviders>");
const reportUsesReadModel = componentBody("StoreReportProviders").includes("StoreReportReadModelProvider");
const monthlySummary = read("app/monthly-summary.tsx");
const monthlySummaryUsesReadModel = monthlySummary.includes("useStoreReportReadModel")
  && !monthlySummary.includes("useEmployeeStore")
  && !monthlySummary.includes("usePaySlipStore");
const runtimeBoundaryWired = boundary.includes("key={tab}")
  && screen.includes("<StoreTabBoundary tab={effectiveTab}>")
  && featureBoundary.includes('pathname === "/store"');

const report = {
  schemaVersion: 2,
  currentArchitecture: reportUsesCompatibilityBridge ? "five_runtime_tab_boundaries_with_report_compatibility_bridge" : "five_runtime_tab_boundaries",
  activeTabs,
  sharedRootFacts: ["WineProvider", "SupplierPurchaseProvider", "GlobalBusinessMonthProvider"],
  duplicateStableProviders,
  expectedMismatch,
  runtimeBoundaryWired,
  report: {
    usesCompatibilityBridge: reportUsesCompatibilityBridge,
    usesReadonlyMaterializedView: reportUsesReadModel,
    monthlySummaryUsesReadModel,
    migrationState: !reportUsesReadModel
      ? "not_started"
      : reportUsesCompatibilityBridge && monthlySummaryUsesReadModel
        ? "partial_analytics_and_monthly_summary_payroll_use_read_model_period_analysis_still_uses_compatibility_contexts"
        : reportUsesCompatibilityBridge
          ? "partial_analytics_only_monthly_summary_and_period_analysis_still_use_compatibility_contexts"
          : "complete",
  },
  instanceIsolation: duplicateStableProviders.length === 0 && expectedMismatch.length === 0 && runtimeBoundaryWired,
};
console.log(JSON.stringify(report, null, 2));
if (!report.instanceIsolation) process.exit(1);
