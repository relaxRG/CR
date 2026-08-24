export type ProviderStabilityTier = "critical" | "core";

export type ProviderStabilityEntry = {
  /** Stable unique ownership key; it must never be renamed without migrating the matrix. */
  id: string;
  label: string;
  tier: ProviderStabilityTier;
  source: string;
  /** Runtime renderer/integration tests which exercise hydration, reload or boundary transitions. */
  runtimeTests: readonly string[];
  /** Static contract tests which protect source-level lifecycle and ownership invariants. */
  contractTests: readonly string[];
  /** Required source markers. These capture architectural invariants, not implementation formatting. */
  requiredMarkers: readonly string[];
};

/**
 * Provider Stability Matrix
 *
 * This is the single CI manifest for providers that own shared facts, perform hydration,
 * react to remote reloads, or compose feature boundaries. New providers with any of these
 * responsibilities must be registered here together with both runtime and contract coverage.
 */
export const PROVIDER_STABILITY_MATRIX: readonly ProviderStabilityEntry[] = [
  {
    id: "bottles",
    label: "鸡尾酒酒库事实源",
    tier: "critical",
    source: "lib/bottles/store.tsx",
    runtimeTests: ["tests/provider-hydration-runtime-stability.test.tsx"],
    contractTests: ["tests/provider-async-reload-stability.test.ts"],
    requiredMarkers: ["registerStoreReload", "AsyncStorage.getItem", "catch"],
  },
  {
    id: "spirits_inventory",
    label: "烈酒库存事实源",
    tier: "critical",
    source: "lib/spirits/crud-store.tsx",
    runtimeTests: ["tests/provider-hydration-runtime-stability.test.tsx"],
    contractTests: ["tests/spirits-persistence-hydration-stability.test.ts", "tests/provider-async-reload-stability.test.ts"],
    requiredMarkers: ["registerStoreReload", "parseStoredValue", "skipNextPersistenceRef"],
  },
  {
    id: "wine_inventory",
    label: "葡萄酒库存事实源",
    tier: "critical",
    source: "lib/wine/store.tsx",
    runtimeTests: ["tests/provider-hydration-runtime-stability.test.tsx"],
    contractTests: ["tests/wine-provider-hydration-stability.test.ts", "tests/provider-async-reload-stability.test.ts"],
    requiredMarkers: ["registerStoreReload", "markStoreLoaded", "catch"],
  },
  {
    id: "labor",
    label: "人力与薪资事实源",
    tier: "critical",
    source: "lib/labor/store.tsx",
    runtimeTests: ["tests/labor-kpi-allowance-hydration-runtime.test.tsx"],
    contractTests: ["tests/app-sync-coverage.test.ts", "tests/conditional-hook-stability.test.ts"],
    requiredMarkers: ["registerStoreReload", "notifySyncChange"],
  },
  {
    id: "store_report_read_model",
    label: "门店报表只读物化视图",
    tier: "critical",
    source: "components/providers/StoreReportReadModelProvider.tsx",
    runtimeTests: ["tests/store-report-read-model-provider-renderer.test.tsx"],
    contractTests: ["tests/store-report-read-model-provider-boundary.test.ts", "tests/report-read-manifest-and-consistency.test.ts"],
    requiredMarkers: ["ticket", "committedRevision", "registerStoreReload"],
  },
  {
    id: "cocktail_feature_boundary",
    label: "鸡尾酒功能Provider装配器",
    tier: "core",
    source: "components/providers/CocktailFeatureProviders.tsx",
    runtimeTests: ["tests/provider-feature-boundary.test.ts"],
    contractTests: ["tests/provider-feature-boundary.test.ts", "tests/provider-async-reload-stability.test.ts"],
    requiredMarkers: ["CocktailFeatureProviders"],
  },
  {
    id: "wine_feature_boundary",
    label: "葡萄酒功能Provider装配器",
    tier: "core",
    source: "components/providers/WineFeatureProviders.tsx",
    runtimeTests: ["tests/provider-feature-boundary.test.ts"],
    contractTests: ["tests/provider-feature-boundary.test.ts", "tests/wine-provider-hydration-stability.test.ts"],
    requiredMarkers: ["WineFeatureProviders"],
  },
  {
    id: "food_feature_boundary",
    label: "食材功能Provider装配器",
    tier: "core",
    source: "components/providers/FoodFeatureProviders.tsx",
    runtimeTests: ["tests/provider-feature-boundary.test.ts"],
    contractTests: ["tests/provider-feature-boundary.test.ts", "tests/generic-inventory-hydration-policy.test.ts"],
    requiredMarkers: ["FoodFeatureProviders"],
  },
  {
    id: "lab_feature_boundary",
    label: "研发功能Provider装配器",
    tier: "core",
    source: "components/providers/LabFeatureProviders.tsx",
    runtimeTests: ["tests/provider-feature-boundary.test.ts"],
    contractTests: ["tests/provider-feature-boundary.test.ts"],
    requiredMarkers: ["LabFeatureProviders"],
  },
  {
    id: "store_tab_boundary",
    label: "门店顶级Tab Provider边界",
    tier: "core",
    source: "components/providers/StoreTabBoundary.tsx",
    runtimeTests: ["tests/store-tab-boundary-renderer.test.tsx"],
    contractTests: ["tests/store-tab-boundary-lifecycle.test.ts", "tests/store-tab-provider-topology.test.ts"],
    requiredMarkers: ["StoreTabBoundary"],
  },
  {
    id: "store_tab_providers",
    label: "门店Tab Provider装配器",
    tier: "core",
    source: "components/providers/StoreTabProviders.tsx",
    runtimeTests: ["tests/store-tab-boundary-renderer.test.tsx"],
    contractTests: ["tests/store-tab-provider-topology.test.ts", "tests/store-tab-boundary-lifecycle.test.ts"],
    requiredMarkers: ["StoreAllFeatureProviders", "StoreInventoryProviders", "StoreLaborProviders", "StoreLaborWorkspaceProviders"],
  },
  {
    id: "app_feature_boundary",
    label: "全局路由功能Provider边界",
    tier: "core",
    source: "components/providers/AppFeatureBoundary.tsx",
    runtimeTests: ["tests/provider-feature-boundary.test.ts"],
    contractTests: ["tests/provider-feature-boundary.test.ts", "tests/route-back-state-sync.test.ts"],
    requiredMarkers: ["usePathname", "CocktailFeatureProviders", "WineFeatureProviders"],
  },
  {
    id: "report_month_close",
    label: "报表月结受控命令Provider",
    tier: "critical",
    source: "lib/labor/report-month-close-provider.tsx",
    runtimeTests: ["tests/report-month-close-provider-renderer.test.tsx"],
    contractTests: ["tests/report-month-close-provider-boundary.test.ts", "tests/app-sync-coverage.test.ts"],
    requiredMarkers: ["createMonthClose", "notifySyncChange", "tryAcquire"],
  },
] as const;

export const CORE_PROVIDER_STABILITY_IDS = PROVIDER_STABILITY_MATRIX.map((entry) => entry.id);
