import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_TAB_RESOURCES,
  BUSINESS_TABS,
  CAPABILITY_RESOURCES,
  SYSTEM_CAPABILITY_RESOURCES,
  businessTabForCapability,
  capabilitiesForBusinessTabs,
  type BusinessTab,
} from "@/lib/sync/capabilities";
import { can, type DeviceSessionState, type DeviceSessionV2 } from "@/lib/sync/device-session";

function authorized(tabs: readonly BusinessTab[]): DeviceSessionState {
  const capabilities = capabilitiesForBusinessTabs(tabs);
  const session: DeviceSessionV2 = {
    schemaVersion: 2,
    device: { id: "device-1", name: "Mac", platform: "macos" },
    membership: { groupId: "group-1", status: "active", role: "collaborator", ownerDeviceId: "owner-1", lastVerifiedAt: Date.now() },
    policy: { revision: 1, issuedAt: Date.now(), tabs, capabilities },
    sync: { freshness: "verified_online", serverTime: Date.now(), latestGroupChangeAt: Date.now() },
  };
  return { tag: "authorized", session };
}

const roleSettings = fs.readFileSync(path.resolve(__dirname, "../app/role-settings.tsx"), "utf8");
const deviceManager = fs.readFileSync(path.resolve(__dirname, "../app/device-manager.tsx"), "utf8");
const worker = fs.readFileSync(path.resolve(__dirname, "../workers/cocktail-ai/worker-v4.js"), "utf8");
const roleGuide = fs.readFileSync(path.resolve(__dirname, "../app/role-guide.tsx"), "utf8");

describe("五个顶级业务Tab统一权限", () => {
  it("39个资源恰好归属五Tab或系统职责，不能产生第六个用户授权入口", () => {
    const mapped = Object.values(BUSINESS_TAB_RESOURCES).flat();
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped, ...SYSTEM_CAPABILITY_RESOURCES].sort()).toEqual([...CAPABILITY_RESOURCES].sort());
    expect(BUSINESS_TABS).toEqual(["cocktail", "wine", "lab", "food", "store"]);
  });

  it("门店授权覆盖报表、员工、备用金、库存、店铺和所有内部页签", () => {
    const state = authorized(["store"]);
    for (const capability of [
      "reports_monthly.view", "analytics_business.view", "analytics_period.view", "accounts.view",
      "labor_employees.view", "payroll.edit", "petty_cash.view", "inventory_spirits.close", "shop_equipment.edit",
    ] as const) {
      expect(businessTabForCapability(capability)).toBe("store");
      expect(can(state, capability), capability).toMatchObject({ allowed: true });
    }
    expect(can(state, "recipes.view")).toMatchObject({ allowed: false, reason: "missing_capability" });
  });

  it("设备管理与配对界面只展示五Tab开关，不保留资源×动作用户矩阵", () => {
    expect(roleSettings).toContain("BUSINESS_TABS.map");
    expect(roleSettings).toContain("门店包含报表、员工、备用金、库存、店铺及全部内部页签");
    expect(roleSettings).not.toContain("CAPABILITY_RESOURCES.map");
    expect(deviceManager).toContain("初始业务范围（内部页面自动继承）");
    expect(deviceManager).not.toContain("完整资源 × 动作矩阵");
    expect(roleGuide).toContain("业务访问只有五个顶级Tab");
    expect(roleGuide).not.toContain("查看配方库");
    expect(roleGuide).toContain("内部页面自动继承所属Tab");
  });

  it("Worker发布五Tab会话、结构化策略更新和恢复路由健康信息", () => {
    expect(worker).toContain('policyModel: "five_business_tabs"');
    expect(worker).toContain('"/api/device/recover-stale-owner"');
    expect(worker).toContain("normalizeRequestedTabs");
    expect(worker).toContain("encodeBusinessTabs");
    expect(worker).not.toContain("normalizeRequestedCapabilities");
  });
});
