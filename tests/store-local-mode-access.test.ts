import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const storeSource = fs.readFileSync(
  path.resolve(process.cwd(), "app/(tabs)/store.tsx"),
  "utf8",
);

describe("门店本地单机模式访问守卫", () => {
  it("未配对时，报表模块不得因为hasFeature=false而被错误拦截", () => {
    expect(storeSource).toContain(
      'if (isAuthenticated && !hasFeature("store_ops"))',
    );
    expect(storeSource).not.toContain(
      'if (!hasFeature("store_ops")) {\n    return <AccessDenied label="报表"',
    );
  });

  it("标签可见性与员工、备用金、库存内容守卫应使用同一单机模式兼容规则", () => {
    expect(storeSource).toContain(
      'const canAccess = (feature: "store_ops" | "labor") => !isAuthenticated || hasFeature(feature);',
    );
    expect(storeSource).toContain('canAccess("labor")');
    expect(storeSource).toContain('canAccess("store_ops")');
    expect(storeSource).toContain('effectiveTab === "inventory" && (\n          canAccess("store_ops")');
    expect(storeSource).toContain('effectiveTab === "shop"      && (\n          canAccess("store_ops")');

    const visibleRule = '!isAuthenticated || hasFeature(t.feature)';
    expect(storeSource).toContain(visibleRule);
  });
});
