import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("首页启动防崩溃规范", () => {
  it("根路由树必须有可恢复错误边界", () => {
    const layout = source("app/_layout.tsx");
    const boundary = source("components/app-error-boundary.tsx");

    expect(layout).toContain('import { AppErrorBoundary }');
    expect(layout).toContain("<AppErrorBoundary>");
    expect(boundary).toContain("getDerivedStateFromError");
    expect(boundary).toContain("componentDidCatch");
  });

  it("根级语言与供应商采购水合必须消费存储拒绝并验证数据形状", () => {
    const i18n = source("lib/i18n/index.tsx");
    const supplierPurchases = source("lib/food/ingredient-store.tsx");

    expect(i18n).toContain("[I18n] language hydration failed");
    expect(supplierPurchases).toContain("[SupplierPurchase] hydration failed");
    expect(supplierPurchases).toContain("Array.isArray((parsed as PurchaseState).records)");
  });

  it("同步重载必须消费Promise拒绝，并且不把损坏缓存直接写入首页Provider状态", () => {
    const homemade = source("lib/homemade/store.tsx");
    const taxonomy = source("lib/bottles/taxonomy.tsx");
    const spirits = source("lib/spirits/crud-store.tsx");

    expect(homemade).toContain("[Homemade] sync reload failed");
    expect(taxonomy).toContain("[BottleTaxonomy] sync reload failed");
    expect(spirits).toContain("Array.isArray(parsedItems)");
    expect(spirits).toContain("Array.isArray(parsedPurchases)");
  });

  it("首页成本派生必须容忍缺失的历史名称字段", () => {
    const smartLink = source("lib/recipes/smart-link.ts");

    expect(smartLink).toContain('const norm = (s: string | null | undefined)');
    expect(smartLink).toContain('(s ?? "").trim()');
  });

  it("同步启动与冲突处理必须有顶层异常隔离和弹窗重入锁", () => {
    const syncProvider = source("lib/cf-sync/provider.tsx");

    expect(syncProvider).toContain("conflictAlertVisibleRef");
    expect(syncProvider).toContain("[CFSync] startup recovery failed");
    expect(syncProvider).toContain("[CFSync] resolve conflict failed");
  });
});
