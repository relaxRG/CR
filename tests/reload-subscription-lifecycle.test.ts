import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const files = [
  "lib/store/revenue-store.tsx",
  "lib/store/petty-store.tsx",
  "lib/store/petty-labor-link-store.tsx",
  "lib/store/petty-inventory-link-store.tsx",
  "lib/store/petty-category-store.tsx",
  "lib/food/menu-store.tsx",
  "lib/lab/plan-store.tsx",
  "lib/store/monthly-summary/store.tsx",
  "lib/store/monthly-report/dish-analysis-store.tsx",
] as const;

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("全局重载订阅生命周期", () => {
  it("注册函数提供注销回调，防止 Provider 重建后回调与闭包累积", () => {
    for (const path of files) {
      const source = read(path);
      expect(source, path).toMatch(/return\s+registerStoreReload\(/);
      expect(source, path).not.toMatch(/(?<!return\s)registerStoreReload\(/);
    }
  });

  it("同步引擎的重载注册函数确实从回调集合移除同一引用", () => {
    const engine = read("lib/sync/engine.ts");
    expect(engine).toContain("return () => reloadCallbacks.delete(fn)");
  });
});
