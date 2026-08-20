import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ROUTE_CONTRACTS,
  getCompatibilityRedirect,
  getRouteContract,
} from "@/lib/navigation/route-contract";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("navigation route contract", () => {
  it("把旧资料库深链收敛到唯一鸡尾酒工作台", () => {
    expect(getCompatibilityRedirect("/library")).toBe("/cocktail");
    expect(getRouteContract("/library")).toMatchObject({
      mode: "compat_redirect",
      owner: "cocktail.workspace",
      target: "/cocktail",
    });
    expect(source("app/library.tsx")).toContain('<Redirect href="/cocktail" />');
  });

  it("只保留一个个人中心实现，不再在隐藏 Tab 中维护第二套页面", () => {
    expect(existsSync(resolve(root, "app/me.tsx"))).toBe(true);
    expect(existsSync(resolve(root, "app/(tabs)/me.tsx"))).toBe(false);
    expect(source("app/(tabs)/_layout.tsx")).not.toContain('name="me"');
  });

  it("兼容重定向必须拥有目标，且不得与正式主 Tab 重复拥有同一路径", () => {
    const primaryPaths = ROUTE_CONTRACTS
      .filter((entry) => entry.mode === "primary_tab")
      .map((entry) => entry.path);
    expect(new Set(primaryPaths).size).toBe(primaryPaths.length);

    for (const entry of ROUTE_CONTRACTS.filter((item) => item.mode === "compat_redirect")) {
      expect(entry.target).toBeTruthy();
      expect(entry.target).not.toBe(entry.path);
    }
  });

  it("独立库存页通过共享工作台获得统一返回入口，深链不会进入死胡同", () => {
    const inventoryShell = source("components/inventory/BaseInventoryScreen.tsx");
    expect(inventoryShell).toContain('onPress={() => router.back()}');
    expect(inventoryShell).toContain('!embedded &&');
  });
});
