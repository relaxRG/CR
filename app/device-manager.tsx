/**
 * 设备管理页面（方案 C+）
 * 显示设备组内所有设备，支持：
 * - 查看每台设备的角色和权限
 * - 生成配对码邀请新设备
 * - 踢出设备
 * - 修改设备角色
 */
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import {
  generatePairCode,
  kickDevice,
  listDevices,
  updateDeviceRole,
  type DeviceRole,
  type RemoteDevice,
} from "@/lib/cf-sync/client";
import { useSync } from "@/lib/cf-sync/provider";

const ROLE_LABELS: Record<DeviceRole, { zh: string; en: string; color: string }> = {
  owner: { zh: "主设备", en: "Owner", color: "#0A84FF" },
  collaborator: { zh: "协作设备", en: "Collaborator", color: "#34C759" },
  guest: { zh: "访客设备", en: "Guest", color: "#FF9500" },
};

const ROLE_DESC: Record<DeviceRole, { zh: string; en: string }> = {
  owner: { zh: "读写全部数据，可管理设备", en: "Full access, manage devices" },
  collaborator: { zh: "读全部，写指定分类", en: "Read all, write allowed keys" },
  guest: { zh: "只读，不同步回主设备", en: "Read-only, no push back" },
};

export default function DeviceManagerScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const { deviceInfo, deviceRole } = useSync();
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpiry, setPairExpiry] = useState<number | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const loadDevices = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listDevices();
      setDevices(list);
    } catch (e) {
      console.warn("[DeviceManager] load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  // Countdown timer for pair code
  useEffect(() => {
    if (!pairExpiry) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((pairExpiry - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) setPairCode(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairExpiry]);

  const handleGenerateCode = async (role: DeviceRole) => {
    try {
      setGeneratingCode(true);
      const result = await generatePairCode(role, null);
      setPairCode(result.code);
      setPairExpiry(result.expiresAt);
      tap();
    } catch (e: unknown) {
      Alert.alert(lang === "zh" ? "生成失败" : "Failed", String(e));
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleKick = (device: RemoteDevice) => {
    const name = device.name;
    const msg = lang === "zh"
      ? `确认移除设备「${name}」？该设备将无法继续同步。`
      : `Remove device "${name}"? It will no longer sync.`;
    if (Platform.OS === "web") {
      if (window.confirm(msg)) void doKick(device.id);
    } else {
      Alert.alert(
        lang === "zh" ? "移除设备" : "Remove Device",
        msg,
        [
          { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
          { text: lang === "zh" ? "移除" : "Remove", style: "destructive", onPress: () => void doKick(device.id) },
        ],
      );
    }
  };

  const doKick = async (targetId: string) => {
    try {
      await kickDevice(targetId);
      await loadDevices();
    } catch (e: unknown) {
      Alert.alert(lang === "zh" ? "移除失败" : "Failed", String(e));
    }
  };

  const handleChangeRole = (device: RemoteDevice) => {
    const roles: DeviceRole[] = ["owner", "collaborator", "guest"];
    const options = roles
      .filter((r) => r !== device.role)
      .map((r) => ({
        text: lang === "zh" ? ROLE_LABELS[r].zh : ROLE_LABELS[r].en,
        onPress: () => void doChangeRole(device.id, r),
      }));
    Alert.alert(
      lang === "zh" ? "修改角色" : "Change Role",
      device.name,
      [...options, { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" as const }],
    );
  };

  const doChangeRole = async (targetId: string, role: DeviceRole) => {
    try {
      await updateDeviceRole(targetId, role, null);
      await loadDevices();
    } catch (e: unknown) {
      Alert.alert(lang === "zh" ? "修改失败" : "Failed", String(e));
    }
  };

  const isOwner = deviceRole === "owner";

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
        <Text style={[styles.title, { color: colors.foreground }]}>
          {lang === "zh" ? "设备管理" : "Device Manager"}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Current device info */}
      {deviceInfo && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.roleTag, { backgroundColor: ROLE_LABELS[deviceInfo.role].color + "20" }]}>
            <Text style={[styles.roleTagText, { color: ROLE_LABELS[deviceInfo.role].color }]}>
              {lang === "zh" ? ROLE_LABELS[deviceInfo.role].zh : ROLE_LABELS[deviceInfo.role].en}
            </Text>
          </View>
          <Text style={[styles.deviceName, { color: colors.foreground }]}>{deviceInfo.deviceName}</Text>
          <Text style={[styles.deviceDesc, { color: colors.muted }]}>
            {lang === "zh" ? ROLE_DESC[deviceInfo.role].zh : ROLE_DESC[deviceInfo.role].en}
          </Text>
        </View>
      )}

      {/* Pair code section (owner only) */}
      {isOwner && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {lang === "zh" ? "邀请新设备" : "Invite New Device"}
          </Text>
          {pairCode ? (
            <View style={styles.codeBox}>
              <Text style={[styles.codeText, { color: colors.primary }]}>{pairCode}</Text>
              <Text style={[styles.codeExpiry, { color: colors.muted }]}>
                {lang === "zh" ? `${countdown} 秒后失效` : `Expires in ${countdown}s`}
              </Text>
            </View>
          ) : (
            <View style={styles.roleButtons}>
              {(["collaborator", "guest"] as DeviceRole[]).map((role) => (
                <Pressable
                  key={role}
                  onPress={() => { tap(); void handleGenerateCode(role); }}
                  disabled={generatingCode}
                  style={({ pressed }) => [
                    styles.roleBtn,
                    { backgroundColor: ROLE_LABELS[role].color, opacity: pressed || generatingCode ? 0.7 : 1 },
                  ]}
                >
                  {generatingCode ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.roleBtnText}>
                      {lang === "zh"
                        ? `邀请${ROLE_LABELS[role].zh}`
                        : `Invite ${ROLE_LABELS[role].en}`}
                    </Text>
                  )}
                </Pressable>
              ))}
            </View>
          )}
          <Text style={[styles.hint, { color: colors.muted }]}>
            {lang === "zh"
              ? "在新设备上打开「我的」→「加入设备组」，输入上方 6 位数字"
              : "On the new device, go to Me → Join Device Group and enter the 6-digit code above"}
          </Text>
        </View>
      )}

      {/* Device list */}
      <Text style={[styles.listTitle, { color: colors.muted }]}>
        {lang === "zh" ? `设备组（${devices.length} 台）` : `Devices (${devices.length})`}
      </Text>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
      ) : (
        <FlatList
          data={devices}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          ItemSeparatorComponent={() => (
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 }} />
          )}
          renderItem={({ item }) => (
            <View style={[styles.deviceRow, { backgroundColor: colors.surface }]}>
              <View style={[styles.deviceIcon, { backgroundColor: ROLE_LABELS[item.role].color + "20" }]}>
                <IconSymbol
                  name={item.isCurrentDevice ? "house.fill" : "paperplane.fill"}
                  size={18}
                  color={ROLE_LABELS[item.role].color}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.deviceRowName, { color: colors.foreground }]}>
                  {item.name}
                  {item.isCurrentDevice && (
                    <Text style={{ color: colors.muted, fontSize: 12 }}>
                      {lang === "zh" ? " (本机)" : " (this)"}
                    </Text>
                  )}
                </Text>
                <Text style={[styles.deviceRowRole, { color: ROLE_LABELS[item.role].color }]}>
                  {lang === "zh" ? ROLE_LABELS[item.role].zh : ROLE_LABELS[item.role].en}
                </Text>
              </View>
              {isOwner && !item.isCurrentDevice && (
                <View style={styles.deviceActions}>
                  <Pressable
                    onPress={() => { tap(); handleChangeRole(item); }}
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.actionBtnText, { color: colors.primary }]}>
                      {lang === "zh" ? "改权限" : "Role"}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { tap(); handleKick(item); }}
                    style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.actionBtnText, { color: colors.error }]}>
                      {lang === "zh" ? "移除" : "Remove"}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 22 },
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  roleTag: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 8,
  },
  roleTagText: { fontSize: 12, fontWeight: "600", lineHeight: 16 },
  deviceName: { fontSize: 17, fontWeight: "600", lineHeight: 22, marginBottom: 4 },
  deviceDesc: { fontSize: 13, lineHeight: 18 },
  sectionTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20, marginBottom: 12 },
  codeBox: { alignItems: "center", paddingVertical: 12 },
  codeText: { fontSize: 40, fontWeight: "700", letterSpacing: 8, lineHeight: 48 },
  codeExpiry: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  roleButtons: { flexDirection: "row", gap: 10, marginBottom: 12 },
  roleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  roleBtnText: { color: "#fff", fontSize: 14, fontWeight: "600", lineHeight: 19 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  listTitle: { fontSize: 13, fontWeight: "500", lineHeight: 18, paddingHorizontal: 16, marginBottom: 8 },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  deviceIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceRowName: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  deviceRowRole: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  deviceActions: { flexDirection: "row", gap: 8 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  actionBtnText: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
});
