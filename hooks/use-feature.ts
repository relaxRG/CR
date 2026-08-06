/**
 * useFeature — 前端模块权限校验 hook
 *
 * 基于 useSync() 提供的 deviceRole 和 deviceInfo.allowedKeys 判断
 * 当前设备是否有权访问指定功能模块。
 *
 * 权限规则：
 *   - owner：始终有权访问所有模块
 *   - collaborator：allowedKeys 包含该模块任意 storageKey → 有权访问
 *   - guest：allowedKeys 包含该模块任意 storageKey → 只读（可访问，不可写入）
 *   - 未登录（deviceInfo 为 null）：无权访问任何模块
 *
 * 用法：
 *   const { hasFeature, canWrite, isOwner } = useFeature();
 *   if (!hasFeature("store_ops")) return <AccessDenied />;
 *   if (!canWrite("labor")) { ... // 隐藏编辑按钮 }
 */
import { useMemo } from "react";
import { useSync } from "@/lib/cf-sync/provider";
import { FEATURE_MODULES, type FeatureKey } from "@/lib/sync/feature-modules";

export interface UseFeatureResult {
  /** 当前设备是否有权访问该模块（owner 始终 true，未登录始终 false） */
  hasFeature: (feature: FeatureKey) => boolean;
  /** 当前设备是否有权写入该模块（guest 始终 false） */
  canWrite: (feature: FeatureKey) => boolean;
  /** 是否为 owner 角色 */
  isOwner: boolean;
  /** 是否为 guest 角色（只读） */
  isGuest: boolean;
  /** 是否已登录（deviceInfo 不为 null） */
  isAuthenticated: boolean;
}

export function useFeature(): UseFeatureResult {
  const { deviceRole, deviceInfo } = useSync();

  return useMemo(() => {
    const isOwner = deviceRole === "owner";
    const isGuest = deviceRole === "guest";
    const isAuthenticated = !!deviceInfo;
    const allowedKeys: string[] = deviceInfo?.allowedKeys ?? [];

    function hasFeature(feature: FeatureKey): boolean {
      if (!isAuthenticated) return false;
      if (isOwner) return true;
      const mod = FEATURE_MODULES.find((m) => m.key === feature);
      if (!mod) return false;
      return mod.storageKeys.some((k) => allowedKeys.includes(k));
    }

    function canWrite(feature: FeatureKey): boolean {
      if (isGuest) return false;
      return hasFeature(feature);
    }

    return { hasFeature, canWrite, isOwner, isGuest, isAuthenticated };
  }, [deviceRole, deviceInfo]);
}
