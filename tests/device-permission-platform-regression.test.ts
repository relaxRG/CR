import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasFeaturePermission } from "@/lib/sync/feature-modules";
import { resolveSyncDevicePlatform } from "@/lib/sync/device-platform";

describe("设备同步权限与平台识别回归", () => {
  it("将全功能协作的null授权视为全部模块可访问", () => {
    expect(hasFeaturePermission(null, "store_ops")).toBe(true);
    expect(hasFeaturePermission(null, "labor")).toBe(true);
    expect(hasFeaturePermission(null, "payroll")).toBe(true);
  });

  it("只允许明确数组包含的模块，避免受限协作设备越权", () => {
    expect(hasFeaturePermission(["store.inventory.v1"], "store_ops")).toBe(true);
    expect(hasFeaturePermission(["store.inventory.v1"], "labor")).toBe(false);
    expect(hasFeaturePermission([], "store_ops")).toBe(false);
  });

  it("优先将iOS运行时上的桌面硬件识别为macOS，而不是iPad", () => {
    expect(resolveSyncDevicePlatform({
      nativePlatform: "ios",
      deviceType: 3,
      desktopType: 3,
      modelName: "iPad",
      osName: "iOS",
    })).toBe("macos");
  });

  it("保持真实iPad、Android和Web的原有平台分类", () => {
    expect(resolveSyncDevicePlatform({ nativePlatform: "ios", deviceType: 2, desktopType: 3, modelName: "iPad Pro", osName: "iOS" })).toBe("ios");
    expect(resolveSyncDevicePlatform({ nativePlatform: "android", deviceType: 1, desktopType: 3, modelName: "Pixel", osName: "Android" })).toBe("android");
    expect(resolveSyncDevicePlatform({ nativePlatform: "web", deviceType: null, desktopType: 3 })).toBe("web");
  });
});

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("同步服务端全权限与平台元数据边界", () => {
  it("Worker将null allowed_keys保留为全功能，并提供受鉴权的平台刷新接口", () => {
    const worker = read("workers/cocktail-ai/worker-v4.js");
    expect(worker).toContain('!Array.isArray(pullAllowedKeys) ? null');
    expect(worker).toContain('device.role === "collaborator" && Array.isArray(serverAllowedKeys)');
    expect(worker).toContain('path === "/api/device/update-metadata"');
    expect(worker).toContain('normalizeDevicePlatform');
  });

  it("客户端同步成功后刷新历史平台元数据，并且切组也使用统一平台分类", () => {
    const provider = read("lib/cf-sync/provider.tsx");
    const groupSwitch = read("lib/cf-sync/group-switch.ts");
    expect(provider).toContain("refreshCurrentDevicePlatform()");
    expect(groupSwitch).toContain("platform: getSyncDevicePlatform()");
  });
});
