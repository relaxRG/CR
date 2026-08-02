/**
 * useGuestGuard
 *
 * 在写操作入口（新建、编辑、删除）前调用 guardWrite()。
 * 若当前设备角色为 guest，弹 Alert 提示并返回 false（阻止操作）。
 * 其他角色直接返回 true（允许操作）。
 */
import { Alert } from "react-native";
import { useCallback } from "react";
import { useSync } from "@/lib/cf-sync/provider";
import { useI18n } from "@/lib/i18n";

export function useGuestGuard() {
  const { deviceRole } = useSync();
  const { lang } = useI18n();

  const guardWrite = useCallback((): boolean => {
    if (deviceRole === "guest") {
      Alert.alert(
        lang === "zh" ? "访客设备不可编辑" : "Read-Only Device",
        lang === "zh"
          ? "当前设备为访客模式，只能查看数据，无法新建、编辑或删除内容。\n\n如需编辑权限，请联系主设备管理员。"
          : "This device is in guest mode. You can view data but cannot create, edit, or delete content.\n\nContact the owner device to request edit access.",
        [{ text: lang === "zh" ? "知道了" : "OK" }],
      );
      return false;
    }
    return true;
  }, [deviceRole, lang]);

  const isGuest = deviceRole === "guest";

  return { guardWrite, isGuest };
}
