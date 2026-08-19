import {
  ONLINE_REQUIRED_CAPABILITIES,
  businessTabForCapability,
  type BusinessTab,
  type Capability,
} from "./capabilities";
import type { SyncDevicePlatform } from "./device-platform";

/** Worker 已核验的成员资格；不包含任何长期令牌。 */
export type MembershipStatus =
  | "active"
  | "revoked"
  | "pending_switch"
  | "recovery_required";

/** 数据与策略的可信来源。离线缓存不是远端已确认状态。 */
export type SessionFreshness =
  | "verified_online"
  | "offline_cache"
  | "policy_stale"
  | "unknown";

export type DeviceSessionV2 = Readonly<{
  schemaVersion: 2;
  device: Readonly<{
    id: string;
    name: string;
    platform: SyncDevicePlatform;
  }>;
  membership: Readonly<{
    groupId: string;
    status: MembershipStatus;
    role: "owner" | "collaborator" | "guest";
    ownerDeviceId: string | null;
    lastVerifiedAt: number;
  }>;
  policy: Readonly<{
    revision: number;
    issuedAt: number;
    /** 用户可配置的唯一业务授权：鸡尾酒、葡萄酒、研发、餐食、门店。 */
    tabs: readonly BusinessTab[];
    /** 仅用于系统职责（设备组、备份、诊断）的派生能力；不作为用户权限入口。 */
    capabilities: readonly Capability[];
  }>;
  sync: Readonly<{
    freshness: SessionFreshness;
    serverTime: number;
    latestGroupChangeAt: number;
  }>;
}>;

/**
 * 本机只保存设备凭据；角色、权限和成员状态必须从 Worker session-v2 刷新，
 * 绝不再持久化为本机权限事实。
 */
export type DeviceCredentials = Readonly<{
  deviceId: string;
  groupId: string;
  deviceName: string;
  deviceToken?: string;
  webMemoryTicket?: string;
}>;

export type DeviceSessionState =
  | Readonly<{ tag: "booting" }>
  | Readonly<{ tag: "local_single_device" }>
  | Readonly<{ tag: "verifying"; cached: DeviceSessionV2 | null }>
  | Readonly<{ tag: "authorized"; session: DeviceSessionV2 }>
  | Readonly<{ tag: "offline_cache"; session: DeviceSessionV2; retryAt: number }>
  | Readonly<{ tag: "policy_stale"; session: DeviceSessionV2 }>
  | Readonly<{ tag: "membership_revoked"; session: DeviceSessionV2 | null; code: "UNAUTHORIZED" | "REVOKED" }>
  | Readonly<{ tag: "group_switch_recovery"; switchId: string }>
  | Readonly<{ tag: "blocked"; code: string; recoverable: boolean; session: DeviceSessionV2 | null }>;

export type CanReason =
  | "allowed"
  | "local_single_device"
  | "verifying"
  | "offline"
  | "policy_stale"
  | "membership_revoked"
  | "missing_capability"
  | "group_switch_recovery"
  | "blocked";

export type CanDecision = Readonly<{
  allowed: boolean;
  reason: CanReason;
  retryable: boolean;
  policyRevision: number | null;
}>;

const deny = (
  reason: Exclude<CanReason, "allowed" | "local_single_device">,
  retryable: boolean,
  policyRevision: number | null = null,
): CanDecision => ({ allowed: false, reason, retryable, policyRevision });

/**
 * 全 App 唯一权限判定器。
 * 页面可见性、按钮、导入导出、月结、同步 push 与 Worker 命令均以相同 Capability 调用此规则。
 */
export function can(state: DeviceSessionState, capability: Capability): CanDecision {
  switch (state.tag) {
    case "local_single_device":
      return { allowed: true, reason: "local_single_device", retryable: false, policyRevision: null };
    case "booting":
    case "verifying":
      return deny("verifying", true, state.tag === "verifying" ? state.cached?.policy.revision ?? null : null);
    case "membership_revoked":
      return deny("membership_revoked", false, state.session?.policy.revision ?? null);
    case "policy_stale":
      return deny("policy_stale", true, state.session.policy.revision);
    case "group_switch_recovery":
      return deny("group_switch_recovery", true);
    case "blocked":
      return deny("blocked", state.recoverable, state.session?.policy.revision ?? null);
    case "authorized":
    case "offline_cache": {
      const session = state.session;
      if (session.membership.status !== "active") {
        return deny("membership_revoked", false, session.policy.revision);
      }
      if (state.tag === "offline_cache" && ONLINE_REQUIRED_CAPABILITIES.has(capability)) {
        return deny("offline", true, session.policy.revision);
      }
      const businessTab = businessTabForCapability(capability);
      if (businessTab
        ? !session.policy.tabs.includes(businessTab)
        : !session.policy.capabilities.includes(capability)) {
        return deny("missing_capability", false, session.policy.revision);
      }
      return { allowed: true, reason: "allowed", retryable: false, policyRevision: session.policy.revision };
    }
  }
}

/** 使用中的会话在远端策略版本推进后立即失效，调用方必须重新核验。 */
export function isPolicyRevisionCurrent(session: DeviceSessionV2, revision: number | null | undefined): boolean {
  return typeof revision === "number" && revision === session.policy.revision;
}

/** 仅用于展示，不参与任何安全判断。 */
export function sessionDisplayState(state: DeviceSessionState): "local" | "verified" | "offline" | "locked" | "checking" {
  switch (state.tag) {
    case "local_single_device": return "local";
    case "authorized": return "verified";
    case "offline_cache": return "offline";
    case "booting":
    case "verifying": return "checking";
    default: return "locked";
  }
}
