/**
 * 设备权限配置页
 *
 * 功能：
 * 1. 查看指定设备的当前角色和功能权限
 * 2. 自定义角色显示名称（本地存储）
 * 3. 开关各功能模块的同步权限（写入 allowedKeys）
 * 4. 转移主设备权限（owner → 本机降级为 collaborator）
 */
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import {
  kickDevice,
  updateDeviceRole,
  type DeviceRole,
  type RemoteDevice,
  listDevices,
  getDeviceInfo,
} from "@/lib/cf-sync/client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useSync } from "@/lib/cf-sync/provider";

// ─── 功能模块定义（从纯 TS 文件导入，不依赖 React Native）─────────────────────────────
export type { FeatureKey } from "@/lib/sync/feature-modules";
export { FEATURE_MODULES } from "@/lib/sync/feature-modules";
import type { FeatureKey } from "@/lib/sync/feature-modules";
import { FEATURE_MODULES } from "@/lib/sync/feature-modules";
// ─── 自定义角色名称存储 ───────────────────────────────────────────────────────
const CUSTOM_ROLE_NAMES_KEY = "device.customRoleNames.v1";

export async function getCustomRoleName(deviceId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ROLE_NAMES_KEY);
    if (!raw) return null;
    const map: Record<string, string> = JSON.parse(raw);
    return map[deviceId] ?? null;
  } catch {
    return null;
  }
}

export async function setCustomRoleName(deviceId: string, name: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_ROLE_NAMES_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    if (name.trim()) {
      map[deviceId] = name.trim();
    } else {
      delete map[deviceId];
    }
    await AsyncStorage.setItem(CUSTOM_ROLE_NAMES_KEY, JSON.stringify(map));
  } catch {}
}

// ─── allowedKeys ↔ FeatureKey 转换 ───────────────────────────────────────────
export function allowedKeysToFeatures(allowedKeys: string[] | null): Set<FeatureKey> {
  if (!allowedKeys) {
    // null = 全部权限
    return new Set(FEATURE_MODULES.map((m) => m.key));
  }
  const result = new Set<FeatureKey>();
  for (const mod of FEATURE_MODULES) {
    if (mod.storageKeys.some((k) => allowedKeys.includes(k))) {
      result.add(mod.key);
    }
  }
  return result;
}

export function featuresToAllowedKeys(features: Set<FeatureKey>): string[] | null {
  // 全部选中 → null（无限制）
  if (features.size === FEATURE_MODULES.length) return null;
  const keys: string[] = [];
  for (const mod of FEATURE_MODULES) {
    if (features.has(mod.key)) {
      keys.push(...mod.storageKeys);
    }
  }
  return keys;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function RoleSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const params = useLocalSearchParams<{
    deviceId: string;
    deviceName: string;
    deviceRole: string;
    allowedKeys: string; // JSON string or ""
  }>();

  const deviceId = params.deviceId ?? "";
  const deviceName = params.deviceName ?? "";
  const initialRole = (params.deviceRole ?? "collaborator") as DeviceRole;
  const initialAllowedKeys: string[] | null = (() => {
    try {
      return params.allowedKeys ? JSON.parse(params.allowedKeys) : null;
    } catch {
      return null;
    }
  })();

  const { refreshDeviceInfo } = useSync();
  const [role, setRole] = useState<DeviceRole>(initialRole);
  const [enabledFeatures, setEnabledFeatures] = useState<Set<FeatureKey>>(
    allowedKeysToFeatures(initialAllowedKeys),
  );
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [isOwnerDevice, setIsOwnerDevice] = useState(false);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // 加载自定义角色名称
  useEffect(() => {
    void getCustomRoleName(deviceId).then((n) => setCustomName(n ?? ""));
  }, [deviceId]);

  // 检查当前设备是否是主设备
  useEffect(() => {
    void getDeviceInfo().then((info) => {
      setIsOwnerDevice(info?.role === "owner");
    });
  }, []);

  const toggleFeature = (key: FeatureKey) => {
    tap();
    setEnabledFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // 至少保留一个功能
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!isOwnerDevice) {
      Alert.alert(
        lang === "zh" ? "无权限" : "No Permission",
        lang === "zh" ? "只有主设备才能修改其他设备的权限。" : "Only the owner device can change permissions.",
      );
      return;
    }
    setSaving(true);
    try {
      const allowedKeys = featuresToAllowedKeys(enabledFeatures);
      await updateDeviceRole(deviceId, role, allowedKeys);
      await setCustomRoleName(deviceId, customName);
      tap();
      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        lang === "zh" ? "已保存" : "Saved",
        lang === "zh" ? "设备权限已更新。" : "Device permissions updated.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert(lang === "zh" ? "保存失败" : "Failed", String(e));
    } finally {
      setSaving(false);
    }
  };

  // 转移主设备权限
  const handleTransferOwner = () => {
    if (!isOwnerDevice) return;
    const msg = lang === "zh"
      ? `将主设备权限转移给「${deviceName}」？\n\n本机将降级为协作者，${deviceName} 将成为新的主设备，拥有全部管理权限。`
      : `Transfer owner role to "${deviceName}"?\n\nThis device will become a collaborator. "${deviceName}" will be the new owner with full admin access.`;
    Alert.alert(
      lang === "zh" ? "转移主设备权限" : "Transfer Owner",
      msg,
      [
        { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
        {
          text: lang === "zh" ? "确认转移" : "Transfer",
          style: "destructive",
          onPress: () => void doTransferOwner(),
        },
      ],
    );
  };

  const doTransferOwner = async () => {
    setSaving(true);
    try {
      // 1. 将目标设备升级为 owner
      await updateDeviceRole(deviceId, "owner", null);
      // 2. 本机本地角色降级为 collaborator（写入 SecureStore / AsyncStorage）
      const localInfo = await getDeviceInfo();
      if (localInfo) {
        const key = "cf.sync.deviceRole";
        if (Platform.OS === "web") {
          await AsyncStorage.setItem(key, "collaborator");
        } else {
          await SecureStore.setItemAsync(key, "collaborator");
        }
      }
      // 转移后立即刷新本机的 deviceInfo State，无需重新进入页面
      await refreshDeviceInfo();
      if (Platform.OS !== "web") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        lang === "zh" ? "转移成功" : "Transfer Complete",
        lang === "zh"
          ? `已将主设备权限转移给「${deviceName}」。本机已降级为协作者。`
          : `Owner role transferred to "${deviceName}". This device is now a collaborator.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert(lang === "zh" ? "转移失败" : "Failed", String(e));
    } finally {
      setSaving(false);
    }
  };

  const ROLE_OPTIONS: { value: DeviceRole; labelZh: string; labelEn: string; color: string; descZh: string; descEn: string }[] = [
    {
      value: "collaborator",
      labelZh: "协作者",
      labelEn: "Collaborator",
      color: "#34C759",
      descZh: "可读写选定功能模块",
      descEn: "Read & write selected modules",
    },
    {
      value: "guest",
      labelZh: "访客",
      labelEn: "Guest",
      color: "#FF9500",
      descZh: "只读，不同步回主设备",
      descEn: "Read-only, no push back",
    },
  ];

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => { tap(); router.back(); }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left.forwardslash.chevron.right" size={20} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {deviceName}
          </Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {lang === "zh" ? "权限配置" : "Permission Settings"}
          </Text>
        </View>
        <Pressable
          onPress={() => { tap(); void handleSave(); }}
          disabled={saving || !isOwnerDevice}
          style={({ pressed }) => [styles.saveBtn, { opacity: pressed || saving || !isOwnerDevice ? 0.5 : 1 }]}
        >
          <Text style={[styles.saveBtnText, { color: colors.primary }]}>
            {saving ? (lang === "zh" ? "保存中…" : "Saving…") : (lang === "zh" ? "保存" : "Save")}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* 非主设备提示 */}
        {!isOwnerDevice && (
          <View style={[styles.warnCard, { backgroundColor: "#FF950020", borderColor: "#FF9500" }]}>
            <Text style={{ color: "#FF9500", fontSize: 13, lineHeight: 18 }}>
              {lang === "zh"
                ? "⚠️ 只有主设备才能修改其他设备的权限。当前设备不是主设备，以下设置为只读。"
                : "⚠️ Only the owner device can change permissions. This device is not the owner, settings are read-only."}
            </Text>
          </View>
        )}

        {/* 自定义角色名称 */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            {lang === "zh" ? "自定义角色名称" : "Custom Role Name"}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              value={customName}
              onChangeText={setCustomName}
              placeholder={lang === "zh" ? "例如：吧台设备、厨房 iPad…" : "e.g. Bar iPad, Kitchen Device…"}
              placeholderTextColor={colors.muted}
              style={[styles.textInput, { color: colors.foreground, borderColor: colors.border }]}
              editable={isOwnerDevice}
              returnKeyType="done"
              maxLength={20}
            />
            <Text style={[styles.hint, { color: colors.muted }]}>
              {lang === "zh"
                ? "仅在本机显示，不影响同步功能。留空则显示系统角色名。"
                : "Displayed locally only. Leave empty to use the system role name."}
            </Text>
          </View>
        </View>

        {/* 角色选择（非 owner 设备才可切换） */}
        {role !== "owner" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              {lang === "zh" ? "角色类型" : "Role Type"}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {ROLE_OPTIONS.map((opt, idx) => (
                <View key={opt.value}>
                  {idx > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />}
                  <Pressable
                    onPress={() => { if (isOwnerDevice) { tap(); setRole(opt.value); } }}
                    style={({ pressed }) => [styles.roleRow, pressed && isOwnerDevice && { opacity: 0.7 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.roleLabel, { color: opt.color }]}>
                        {lang === "zh" ? opt.labelZh : opt.labelEn}
                      </Text>
                      <Text style={[styles.roleDesc, { color: colors.muted }]}>
                        {lang === "zh" ? opt.descZh : opt.descEn}
                      </Text>
                    </View>
                    {role === opt.value && (
                      <View style={[styles.checkDot, { backgroundColor: opt.color }]} />
                    )}
                  </Pressable>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* 功能权限开关（访客不可写，仅展示） */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>
            {lang === "zh" ? "功能权限" : "Feature Permissions"}
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.muted }]}>
            {role === "guest"
              ? (lang === "zh" ? "访客设备只读，无法写入任何功能模块。" : "Guest devices are read-only for all modules.")
              : (lang === "zh" ? "关闭的模块将不会同步到该设备（拉取和推送均受限）。" : "Disabled modules will not sync to this device.")}
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {FEATURE_MODULES.map((mod, idx) => (
              <View key={mod.key}>
                {idx > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 }} />}
                <View style={styles.featureRow}>
                  <Text style={styles.featureIcon}>{mod.icon}</Text>
                  <Text style={[styles.featureLabel, { color: colors.foreground }]}>
                    {lang === "zh" ? mod.labelZh : mod.labelEn}
                  </Text>
                  <Switch
                    value={enabledFeatures.has(mod.key)}
                    onValueChange={() => {
                      if (isOwnerDevice && role !== "guest") toggleFeature(mod.key);
                    }}
                    disabled={!isOwnerDevice || role === "guest"}
                    trackColor={{ false: colors.border, true: mod.color + "80" }}
                    thumbColor={enabledFeatures.has(mod.key) ? mod.color : colors.muted}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* 转移主设备权限（仅当前设备是 owner 且目标不是 owner 时显示） */}
        {isOwnerDevice && role !== "owner" && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>
              {lang === "zh" ? "主设备权限" : "Owner Transfer"}
            </Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable
                onPress={() => { tap(); handleTransferOwner(); }}
                style={({ pressed }) => [styles.dangerRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.dangerIcon, { backgroundColor: "#FF950020" }]}>
                  <IconSymbol name="house.fill" size={18} color="#FF9500" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.dangerLabel, { color: "#FF9500" }]}>
                    {lang === "zh" ? "转移主设备权限给此设备" : "Transfer Owner to This Device"}
                  </Text>
                  <Text style={[styles.dangerDesc, { color: colors.muted }]}>
                    {lang === "zh"
                      ? "本机将降级为协作者，此设备成为新主设备"
                      : "This device becomes owner; current device becomes collaborator"}
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 22 },
  subtitle: { fontSize: 12, lineHeight: 16 },
  saveBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  saveBtnText: { fontSize: 17, fontWeight: "600" },
  section: { marginHorizontal: 16, marginBottom: 20 },
  sectionTitle: { fontSize: 13, fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, marginLeft: 4 },
  sectionDesc: { fontSize: 12, lineHeight: 16, marginBottom: 8, marginLeft: 4 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  warnCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  textInput: {
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hint: { fontSize: 12, lineHeight: 16, paddingHorizontal: 16, paddingVertical: 8 },
  roleRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  roleLabel: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  roleDesc: { fontSize: 12, lineHeight: 16, marginTop: 2 },
  checkDot: { width: 10, height: 10, borderRadius: 5 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  featureIcon: { fontSize: 22, width: 28, textAlign: "center" },
  featureLabel: { flex: 1, fontSize: 15, lineHeight: 20 },
  dangerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  dangerIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dangerLabel: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  dangerDesc: { fontSize: 12, lineHeight: 16, marginTop: 2 },
});
