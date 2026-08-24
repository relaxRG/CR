import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");

describe("build 138 崩溃防护回归", () => {
  it("鸡尾酒边界为菜单与酒款编辑装配烈酒库存事实源", () => {
    const providers = source("components/providers/CocktailFeatureProviders.tsx");

    expect(providers).toContain('import { SpiritsInventoryProvider }');
    expect(providers).toContain("<SpiritsInventoryProvider>");
  });

  it("研发边界为销售子页装配菜单、葡萄酒、食材和套餐事实源", () => {
    const providers = source("components/providers/LabFeatureProviders.tsx");

    expect(providers).toContain("<WineProvider>");
    expect(providers).toContain("<FoodMenuProvider>");
    expect(providers).toContain("<MenuPackageProvider>");
    expect(providers).toContain("<MenuProvider>");
  });

  it("同步启动、冲突处理与扫码权限拒绝均消费异步异常而不让其冒泡", () => {
    const syncProvider = source("lib/cf-sync/provider.tsx");
    const scanner = source("components/qr-scanner.tsx");

    expect(syncProvider).toContain('console.warn("[CFSync] startup recovery failed:"');
    expect(syncProvider).toContain("conflictAlertVisibleRef");
    expect(syncProvider).toContain('console.warn("[CFSync] resolve conflict failed:"');
    expect(scanner).toContain('console.warn("[QRScanner] expo-camera is unavailable:"');
    expect(scanner).toContain('console.warn("[QRScanner] permission request failed:"');
    expect(scanner).toContain('console.warn("[QRScanner] manual permission request failed:"');
    expect(scanner).toContain("onPress={handleManualPermissionRequest}");
    expect(scanner).not.toContain("onPress={() => void requestPermission()}");
    expect(scanner).toContain("<CameraUnavailable");
  });
});
