import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { useSync } from "@/lib/cf-sync/provider";
import { useI18n } from "@/lib/i18n";
import { can, type CanDecision } from "@/lib/sync/device-session";
import type { Capability } from "@/lib/sync/capabilities";

/**
 * 全 App 页面与业务动作的唯一权限 Hook。
 * 新功能不得直接读取成员角色、策略数组或存储键；必须调用 useCan(capability)。
 */
export function useCan(capability: Capability): CanDecision {
  const { deviceSessionState } = useSync();
  return useMemo(
    () => can(deviceSessionState, capability),
    [deviceSessionState, capability],
  );
}

/**
 * 一次读取多个动作，适用于“页面读取 + 编辑按钮 + 导入 + 月结”的工作台。
 */
export function useCapabilityGuard(capability: Capability): {
  decision: CanDecision;
  guard: () => boolean;
} {
  const decision = useCan(capability);
  const { lang } = useI18n();
  const guard = useCallback(() => {
    if (decision.allowed) return true;
    const text = decision.reason === "offline"
      ? (lang === "zh" ? "当前为离线缓存状态，请联网后再执行此操作。" : "This action requires an online verified session.")
      : decision.reason === "policy_stale" || decision.reason === "verifying"
      ? (lang === "zh" ? "正在核验设备权限，请稍后重试。" : "Device permissions are being verified. Please try again shortly.")
      : decision.reason === "membership_revoked"
      ? (lang === "zh" ? "此设备已不在同步组中，无法继续操作。" : "This device is no longer an active sync-group member.")
      : (lang === "zh" ? "此设备没有执行该操作的权限，请联系主设备授权。" : "This device is not authorized for this action.");
    Alert.alert(lang === "zh" ? "无法执行操作" : "Action unavailable", text);
    return false;
  }, [decision, lang]);
  return { decision, guard };
}

export function useCapabilities<const T extends readonly Capability[]>(capabilities: T): {
  readonly [K in T[number]]: CanDecision;
} {
  const { deviceSessionState } = useSync();
  return useMemo(() => {
    const decisions: Partial<Record<T[number], CanDecision>> = {};
    for (const capability of capabilities) {
      decisions[capability as T[number]] = can(deviceSessionState, capability);
    }
    return decisions as { readonly [K in T[number]]: CanDecision };
  }, [capabilities, deviceSessionState]);
}
