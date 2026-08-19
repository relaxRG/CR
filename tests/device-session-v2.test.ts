import { describe, expect, it } from "vitest";
import {
  CAPABILITY_RESOURCES,
  ONLINE_REQUIRED_CAPABILITIES,
  ONLINE_REQUIRED_HIGH_RISK_RESOURCES,
  ONLINE_REQUIRED_WRITE_ACTIONS,
  STORAGE_POLICY,
  BUSINESS_TABS,
  businessTabForCapability,
  type BusinessTab,
  type Capability,
} from "@/lib/sync/capabilities";
import {
  can,
  type DeviceSessionState,
  type DeviceSessionV2,
} from "@/lib/sync/device-session";
import { SYNC_KEYS } from "@/lib/sync/engine";
import { FEATURE_CONTRACTS } from "@/lib/sync/feature-contract";

const tabsForCapabilities = (capabilities: readonly Capability[]): BusinessTab[] => [
  ...new Set(capabilities.map(businessTabForCapability).filter((tab): tab is BusinessTab => tab !== null)),
];

const baseSession = (capabilities: readonly Capability[], tabs: readonly BusinessTab[] = tabsForCapabilities(capabilities)): DeviceSessionV2 => ({
  schemaVersion: 2,
  device: { id: "device-1", name: "iPhone", platform: "ios" },
  membership: {
    groupId: "group-1",
    status: "active",
    role: "collaborator",
    ownerDeviceId: "owner-1",
    lastVerifiedAt: 1_735_689_600_000,
  },
  policy: { revision: 17, issuedAt: 1_735_689_600_000, tabs, capabilities },
  sync: { freshness: "verified_online", serverTime: 1_735_689_600_000, latestGroupChangeAt: 1_735_689_600_000 },
});

const authorized = (tabs: readonly BusinessTab[], capabilities: readonly Capability[] = []): DeviceSessionState => ({
  tag: "authorized",
  session: baseSession(capabilities, tabs),
});

describe("DeviceSessionV2 状态机与 can()", () => {
  it("本地单机模式可使用所有业务能力，不依赖伪造 owner 或 allowed_keys", () => {
    expect(can({ tag: "local_single_device" }, "inventory_wine.close")).toMatchObject({
      allowed: true,
      reason: "local_single_device",
    });
  });

  it("在线已核验设备按五Tab授权内部全部内容，内部页签不再单独拒绝", () => {
    const state = authorized(["store"]);
    expect(can(state, "analytics_period.view")).toMatchObject({ allowed: true, policyRevision: 17 });
    expect(can(state, "payroll.close")).toMatchObject({ allowed: true, policyRevision: 17 });
    expect(can(state, "recipes.view")).toMatchObject({ allowed: false, reason: "missing_capability" });
  });

  it("离线缓存可查看已授权数据，但禁止导入、导出、月结与设备管理等高风险动作", () => {
    const session = baseSession(["inventory_wine.view", "inventory_wine.edit", "inventory_wine.close", "reports_monthly.import"], ["wine", "store"]);
    const state: DeviceSessionState = { tag: "offline_cache", session, retryAt: 1_735_689_660_000 };
    expect(can(state, "inventory_wine.view")).toMatchObject({ allowed: true });
    expect(can(state, "inventory_wine.edit")).toMatchObject({ allowed: false, reason: "offline", retryable: true });
    expect(can(state, "inventory_wine.close")).toMatchObject({ allowed: false, reason: "offline", retryable: true });
    expect(can(state, "reports_monthly.import")).toMatchObject({ allowed: false, reason: "offline", retryable: true });
  });

  it("策略过期时禁止继续使用旧权限，必须重新向 Worker 核验", () => {
    const state: DeviceSessionState = { tag: "policy_stale", session: baseSession(["payroll.edit"], ["store"]) };
    expect(can(state, "payroll.edit")).toMatchObject({
      allowed: false,
      reason: "policy_stale",
      retryable: true,
      policyRevision: 17,
    });
  });

  it("远端撤销成员资格后，缓存中的旧能力不能继续用于读取或写入", () => {
    const state: DeviceSessionState = {
      tag: "membership_revoked",
      session: { ...baseSession(["recipes.edit"], ["cocktail"]), membership: { ...baseSession([]).membership, status: "revoked" } },
      code: "REVOKED",
    };
    expect(can(state, "recipes.edit")).toMatchObject({ allowed: false, reason: "membership_revoked" });
  });
});

describe("全 App 能力策略契约", () => {
  it("每一个同步键必须有唯一的读写能力归属，新增键未注册时编译与测试均失败", () => {
    const policyKeys = Object.keys(STORAGE_POLICY).sort();
    expect(policyKeys).toEqual([...SYNC_KEYS].sort());
    for (const storageKey of SYNC_KEYS) {
      const policy = STORAGE_POLICY[storageKey];
      expect(policy.read).toContain(".");
      expect(policy.write === null || policy.write.includes(".")).toBe(true);
    }
  });

  it("所有功能契约必须引用已声明资源，且每个用户动作都从该资源能力派生", () => {
    const resources = new Set<string>(CAPABILITY_RESOURCES);
    for (const contract of FEATURE_CONTRACTS) {
      expect(resources.has(contract.resource), contract.id).toBe(true);
      if (contract.sync === "shared") {
        expect(contract.storageKeys.length, `${contract.id} 缺少同步数据归属`).toBeGreaterThan(0);
      } else {
        expect(contract.storageKeys, `${contract.id} 的本机功能不得伪装为共享数据`).toHaveLength(0);
      }
      for (const capability of Object.values(contract.actions)) {
        expect(capability.startsWith(`${contract.resource}.`), `${contract.id} 的 ${capability} 不属于 ${contract.resource}`).toBe(true);
      }
      for (const key of contract.storageKeys) {
        expect(STORAGE_POLICY[key]).toBeDefined();
      }
    }
  });
});


describe("全 App 跨设备策略收敛", () => {
  it("每个已注册业务资源都可由同一 can() 状态机判定，任何新资源不会绕过统一会话", () => {
    for (const resource of CAPABILITY_RESOURCES) {
      const capability = `${resource}.view` as Capability;
      const tab = businessTabForCapability(capability);
      if (!tab) continue;
      expect(can(authorized([tab]), capability), resource).toMatchObject({ allowed: true });
      expect(can(authorized([]), capability), resource).toMatchObject({
        allowed: false,
        reason: "missing_capability",
      });
    }
  });

  it("策略版本提升后，旧设备的策略状态必须失效，不能继续以旧权限推送跨设备数据", () => {
    const beforeChange = authorized(["cocktail"]);
    expect(can(beforeChange, "recipes.edit")).toMatchObject({ allowed: true, policyRevision: 17 });

    const afterRemotePolicyChange: DeviceSessionState = {
      tag: "policy_stale",
      session: {
        ...baseSession(["recipes.edit"], ["cocktail"]),
        policy: { ...baseSession([], []).policy, revision: 18 },
      },
    };
    expect(can(afterRemotePolicyChange, "recipes.edit")).toMatchObject({
      allowed: false,
      reason: "policy_stale",
      policyRevision: 18,
    });
  });

  it("同步键的读写能力分别由策略注册表决定，只有具备写能力的设备才可向另一设备可见的共享数据推送变更", () => {
    for (const storageKey of SYNC_KEYS) {
      const policy = STORAGE_POLICY[storageKey];
      const tab = businessTabForCapability(policy.read);
      if (!tab) continue;
      const reader = authorized([tab]);
      expect(can(reader, policy.read), `${storageKey}: read`).toMatchObject({ allowed: true });

      if (policy.write) {
        const writer = authorized([tab]);
        expect(can(writer, policy.write), `${storageKey}: write`).toMatchObject({ allowed: true });
        expect(can(reader, policy.write), `${storageKey}: same Tab grants internal write`).toMatchObject({ allowed: true });
      }
    }
  });

  it("成员被撤销、策略过期或离线高风险动作时，所有模块都获得可解释拒绝而非静默丢弃", () => {
    const highRisk = ["devices.manage", "reports_monthly.close", "inventory_wine.import", "payroll.close"] as const;
    const offline: DeviceSessionState = {
      tag: "offline_cache",
      session: baseSession(highRisk, ["store"]),
      retryAt: 1_735_689_660_000,
    };
    for (const capability of highRisk) {
      expect(can(offline, capability), capability).toMatchObject({ allowed: false, reason: "offline", retryable: true });
    }
  });

  it("每一个高风险资源的非查看动作必须自动纳入离线在线核验门禁", () => {
    for (const resource of ONLINE_REQUIRED_HIGH_RISK_RESOURCES) {
      for (const action of ONLINE_REQUIRED_WRITE_ACTIONS) {
        const capability = `${resource}.${action}` as Capability;
        expect(ONLINE_REQUIRED_CAPABILITIES.has(capability), capability).toBe(true);
        const offline: DeviceSessionState = {
          tag: "offline_cache",
          session: baseSession([capability], [businessTabForCapability(capability) ?? "store"]),
          retryAt: 1_735_689_660_000,
        };
        expect(can(offline, capability), capability).toMatchObject({ allowed: false, reason: "offline", retryable: true });
      }
    }
  });
});
