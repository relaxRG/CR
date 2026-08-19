import { describe, expect, it } from "vitest";
import type { Capability } from "@/lib/sync/capabilities";
import type { DeviceSessionState, DeviceSessionV2 } from "@/lib/sync/device-session";
import {
  MAX_SESSION_RETRY_ATTEMPTS,
  SESSION_RETRY_CAP_MS,
  isMembershipFailure,
  nextSessionRetryDelay,
  sessionAfterTransportFailure,
  shouldRetryAfterNetworkChange,
} from "@/lib/sync/session-recovery";

const session = (): DeviceSessionV2 => ({
  schemaVersion: 2,
  device: { id: "device-1", name: "iPhone", platform: "ios" },
  membership: { groupId: "group-1", status: "active", role: "collaborator", ownerDeviceId: "owner-1", lastVerifiedAt: 1_735_689_600_000 },
  policy: { revision: 7, issuedAt: 1_735_689_600_000, tabs: ["cocktail"], capabilities: ["recipes.edit"] as Capability[] },
  sync: { freshness: "verified_online", serverTime: 1_735_689_600_000, latestGroupChangeAt: 1_735_689_600_000 },
});

describe("DeviceSessionV2 弱网恢复策略", () => {
  it("在线会话在 pull 或 push 的传输中断后只能降级为离线缓存，且保留最后已核验策略", () => {
    const current: DeviceSessionState = { tag: "authorized", session: session() };
    expect(sessionAfterTransportFailure(current, "NETWORK_TIMEOUT", 1_000)).toEqual({
      tag: "offline_cache",
      session: session(),
      retryAt: 31_000,
    });
  });

  it("401、403、UNAUTHORIZED 与 REVOKED 不得降级为离线缓存，必须立即撤销成员会话", () => {
    const current: DeviceSessionState = { tag: "authorized", session: session() };
    for (const failure of ["HTTP_401", "403", "DEVICE_AUTH_UNAUTHORIZED", "MEMBERSHIP_REVOKED"]) {
      expect(isMembershipFailure(failure), failure).toBe(true);
      expect(sessionAfterTransportFailure(current, failure)).toMatchObject({ tag: "membership_revoked", code: "UNAUTHORIZED" });
    }
  });

  it("策略过期、切组恢复和已撤销状态不会被一次普通网络错误覆盖为离线缓存", () => {
    const stale: DeviceSessionState = { tag: "policy_stale", session: session() };
    const recovery: DeviceSessionState = { tag: "group_switch_recovery", switchId: "switch-1" };
    expect(sessionAfterTransportFailure(stale, "NETWORK_TIMEOUT")).toEqual(stale);
    expect(sessionAfterTransportFailure(recovery, "NETWORK_TIMEOUT")).toEqual(recovery);
  });

  it("退避随失败次数递增、上限受控且带 10%–30% 抖动，不会产生紧密重试风暴", () => {
    expect(nextSessionRetryDelay(0, 0)).toBe(33_000);
    expect(nextSessionRetryDelay(1, 1)).toBe(78_000);
    expect(nextSessionRetryDelay(MAX_SESSION_RETRY_ATTEMPTS, 1)).toBeLessThanOrEqual(Math.round(SESSION_RETRY_CAP_MS * 1.3));
  });

  it("只有断网到联网的边沿触发自动恢复，连续 online 事件不重复同步", () => {
    expect(shouldRetryAfterNetworkChange(null, true)).toBe(false);
    expect(shouldRetryAfterNetworkChange(true, true)).toBe(false);
    expect(shouldRetryAfterNetworkChange(false, false)).toBe(false);
    expect(shouldRetryAfterNetworkChange(false, true)).toBe(true);
  });
});
