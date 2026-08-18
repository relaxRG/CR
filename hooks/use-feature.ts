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
import { hasFeaturePermission, type FeatureKey } from "@/lib/sync/feature-modules";

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
  /**
   * 全局只读标志：已登录且为 guest 角色时为 true
   * 用于全局禁用编辑按鈕、隐藏操作入口
   */
  isReadOnly: boolean;
}

export function useFeature(): UseFeatureResult {
  const { deviceRole, deviceInfo } = useSync();

  return useMemo(() => {
    const isOwner = deviceRole === "owner";
    const isGuest = deviceRole === "guest";
    const isAuthenticated = !!deviceInfo;
    // null 是“无限制/全部模块”，而不是空数组。权限编辑页已按此语义写入服务端。
    const allowedKeys = deviceInfo?.allowedKeys ?? null;

    function hasFeature(feature: FeatureKey): boolean {
      if (!isAuthenticated) return false;
      if (isOwner || allowedKeys === null) return true;
      return hasFeaturePermission(allowedKeys, feature);
    }

    function canWrite(feature: FeatureKey): boolean {
      if (isGuest) return false;
      return hasFeature(feature);
    }

    const isReadOnly = isAuthenticated && isGuest;

    return { hasFeature, canWrite, isOwner, isGuest, isAuthenticated, isReadOnly };
  }, [deviceRole, deviceInfo]);
}
