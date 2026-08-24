import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("高风险深链Provider稳定性", () => {
  it("供应商管理与导入路由使用包含报表、食材和供应商采购事实的专用组合", () => {
    const boundary = source("components/providers/AppFeatureBoundary.tsx");
    const providers = source("components/providers/StoreTabProviders.tsx");
    const featureMap = source("lib/navigation/feature-boundary.ts");

    expect(featureMap).toContain('path.startsWith("/suppliers")');
    expect(featureMap).toContain('path.startsWith("/supplier-import")');
    expect(boundary).toContain("StoreSupplierManagementProviders");
    expect(boundary).toContain('pathname.startsWith("/suppliers")');
    expect(boundary).toContain('pathname.startsWith("/supplier-import")');
    expect(providers).toContain("<StoreReportProviders>");
    expect(providers).toContain("<FoodIngredientProvider>");
    expect(providers).toContain("<SupplierPurchaseProvider>{children}</SupplierPurchaseProvider>");
  });

  it("采购渠道深链为烈酒采购投影提供库存事实源", () => {
    const boundary = source("components/providers/AppFeatureBoundary.tsx");

    expect(boundary).toContain('pathname.startsWith("/bottle-channels")');
    expect(boundary).toContain("<SpiritsInventoryProvider>{children}</SpiritsInventoryProvider>");
  });
});
