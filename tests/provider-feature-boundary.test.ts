import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveFeatureBoundary } from "@/lib/navigation/feature-boundary";

const source = (relative: string) => readFileSync(`${process.cwd()}/${relative}`, "utf8");

describe("功能域 Provider 边界", () => {
  it("将五个业务 Tab、详情深链与跨域技术页映射到正确边界", () => {
    expect(resolveFeatureBoundary("/cocktail")).toBe("cocktail");
    expect(resolveFeatureBoundary("/recipe/abc")).toBe("cocktail");
    expect(resolveFeatureBoundary("/wine/abc")).toBe("wine");
    expect(resolveFeatureBoundary("/wine-inventory-import")).toBe("wine");
    expect(resolveFeatureBoundary("/lab/projects")).toBe("lab");
    expect(resolveFeatureBoundary("/food-ingredient/abc")).toBe("food");
    expect(resolveFeatureBoundary("/labor")).toBe("store");
    expect(resolveFeatureBoundary("/device-manager")).toBe("core");
    expect(resolveFeatureBoundary("/backup")).toBe("core");
    expect(resolveFeatureBoundary("/glassware-inventory")).toBe("store");
  });

  it("根布局只保留共享内核、全局月份与动态功能域边界", () => {
    const root = source("app/_layout.tsx");

    expect(root).toContain("<AppFeatureBoundary>");
    expect(root).toContain("<GlobalBusinessMonthProvider>");
    expect(root).toContain("<RecipeProvider>");
    expect(root).toContain("<BottleTaxonomyProvider>");
    expect(root).toContain("<BottleProvider>");
    expect(root).toContain("<HomemadeProvider>");
    expect(root).toContain("<WineProvider>");
    expect(root).toContain("<SupplierPurchaseProvider>");
    expect(root).not.toContain("<LaborProvider>");
    expect(root).not.toContain("<SpiritsInventoryProvider>");
    expect(root).not.toContain("<FoodMenuProvider>");
  });

  it("功能域边界按路径条件装配五个 Tab，跨域技术页只走唯一事实源组合", () => {
    const boundary = source("components/providers/AppFeatureBoundary.tsx");

    expect(boundary).toContain('import { CocktailFeatureProviders }');
    expect(boundary).toContain('import { WineFeatureProviders }');
    expect(boundary).toContain('import { LabFeatureProviders }');
    expect(boundary).toContain('import { FoodFeatureProviders }');
    expect(boundary).toContain("StoreAllFeatureProviders");
    expect(boundary).toContain("StoreReportProviders");
    expect(boundary).toContain("StoreInventoryDeepLinkProviders");
    expect(boundary).not.toContain("StoreFeatureProviders");
    expect(boundary).toContain('if (boundary === "all")');
    expect(boundary).toContain('pathname === "/store"');
    expect(boundary).not.toContain("<Suspense");
  });

  it("门店主路由交由顶级 Tab 子边界装配，避免与旧复合树重复实例化", () => {
    const storeScreen = source("app/(tabs)/store.tsx");
    const tabBoundary = source("components/providers/StoreTabBoundary.tsx");

    expect(storeScreen).toContain('<StoreTabBoundary tab={effectiveTab}>');
    expect(tabBoundary).toContain("key={tab}");
    expect(tabBoundary).toContain("lifecycle.current.dispose()");
  });

  it("门店域不持有跨域全局月份，跨域葡萄酒事实仍由共享内核唯一装配", () => {
    const providers = source("components/providers/StoreTabProviders.tsx");

    expect(providers).not.toContain("GlobalBusinessMonthProvider");
    expect(providers).not.toContain("WineProvider");
  });
});
