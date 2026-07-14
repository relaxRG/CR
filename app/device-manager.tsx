/**
 * 设备管理页面（方案 C+ / 5D 升级版）
 *
 * 新增功能：
 * 1. 同步状态实时反馈动画（脉冲光环 + 状态文字）
 * 2. DeepSeek 余额直观显示模块（进度条 + 颜色预警）
 * 3. 三通道备份状态面板（Cloudflare D1 / iCloud Drive / 本地快照）
 * 4. 设备列表（角色管理、配对码、踢出）
 */
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { listSnapshots } from "@/lib/backup/local-backup";
import { getICloudMeta } from "@/lib/backup/icloud-backup";

const CF_WORKER_URL = "https://cocktail-ai.kikikong2017.workers.dev";

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

// ─── DeepSeek Balance ─────────────────────────────────────────────────────────
type BalanceInfo = {
  balance: number;
  currency: string;
  lastChecked: number;
} | null;

async function fetchBalance(): Promise<BalanceInfo> {
  try {
    const res = await fetch(`${CF_WORKER_URL}/api/balance/check`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json() as { balance?: number; currency?: string };
    return {
      balance: data.balance ?? 0,
      currency: data.currency ?? "CNY",
      lastChecked: Date.now(),
    };
  } catch {
    return null;
  }
}

// ─── Sync Pulse Animation ─────────────────────────────────────────────────────
function SyncPulse({ active, color }: { active: boolean; color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.4, { duration: 700, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 700, easing: Easing.in(Easing.ease) }),
        ),
        -1,
        false,
      );
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.15, { duration: 700 }),
          withTiming(0.5, { duration: 700 }),
        ),
        -1,
        false,
      );
    } else {
      scale.value = withTiming(1, { duration: 300 });
      opacity.value = withTiming(0, { duration: 300 });
    }
  }, [active, scale, opacity]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.pulseContainer}>
      <Animated.View
        style={[styles.pulseRing, { borderColor: color }, ringStyle]}
      />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

// ─── Balance Bar ──────────────────────────────────────────────────────────────
function BalanceBar({ balance, currency }: { balance: number; currency: string }) {
  const { lang } = useI18n();
  const colors = useColors();
  const MAX_DISPLAY = 20; // ¥20 = full bar
  const pct = Math.min(1, balance / MAX_DISPLAY);
  const barWidth = useSharedValue(0);

  useEffect(() => {
    barWidth.value = withTiming(pct, { duration: 800, easing: Easing.out(Easing.ease) });
  }, [pct, barWidth]);

  const barStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value * 100}%` as `${number}%`,
  }));

  const barColor = balance < 2 ? "#FF3B30" : balance < 5 ? "#FF9500" : "#34C759";
  const statusText = balance < 2
    ? (lang === "zh" ? "余额不足，请充值" : "Low balance, please top up")
    : balance < 5
    ? (lang === "zh" ? "余额偏低" : "Balance running low")
    : (lang === "zh" ? "余额充足" : "Balance OK");

  return (
    <View>
      <View style={styles.balanceRow}>
        <Text style={[styles.balanceAmount, { color: barColor }]}>
          {currency === "CNY" ? "¥" : "$"}{balance.toFixed(2)}
        </Text>
        <Text style={[styles.balanceStatus, { color: barColor }]}>{statusText}</Text>
      </View>
      <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
        <Animated.View style={[styles.barFill, { backgroundColor: barColor }, barStyle]} />
      </View>
      <Text style={[styles.balanceHint, { color: colors.muted }]}>
        {lang === "zh"
          ? "DeepSeek API · 余额 < ¥5 时自动发邮件提醒"
          : "DeepSeek API · Auto email alert when < ¥5"}
      </Text>
    </View>
  );
}

// ─── Channel Status Row ───────────────────────────────────────────────────────
function ChannelRow({
  icon,
  label,
  status,
  detail,
  statusColor,
}: {
  icon: string;
  label: string;
  status: string;
  detail: string;
  statusColor: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.channelRow}>
      <Text style={styles.channelIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.channelLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.channelDetail, { color: colors.muted }]}>{detail}</Text>
      </View>
      <View style={[styles.channelBadge, { backgroundColor: statusColor + "20" }]}>
        <Text style={[styles.channelBadgeText, { color: statusColor }]}>{status}</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function DeviceManagerScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const { deviceInfo, deviceRole, syncState } = useSync();

  // Devices
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairExpiry, setPairExpiry] = useState<number | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Balance
  const [balance, setBalance] = useState<BalanceInfo>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Backup channels
  const [localSnapshotCount, setLocalSnapshotCount] = useState(0);
  const [icloudLastBackup, setIcloudLastBackup] = useState<number | null>(null);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Load devices
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

  // Load balance
  const loadBalance = useCallback(async () => {
    setBalanceLoading(true);
    const info = await fetchBalance();
    setBalance(info);
    setBalanceLoading(false);
  }, []);

  // Load backup status
  const loadBackupStatus = useCallback(async () => {
    try {
      const snapshots = await listSnapshots();
      setLocalSnapshotCount(snapshots.length);
      const meta = await getICloudMeta();
      setIcloudLastBackup(meta.lastBackupAt);
    } catch {}
  }, []);

  useEffect(() => {
    void loadDevices();
    void loadBalance();
    void loadBackupStatus();
  }, [loadDevices, loadBalance, loadBackupStatus]);

  // Countdown for pair code
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
  const isSyncing = syncState.syncing;
  const syncColor = syncState.error ? "#FF3B30" : isSyncing ? "#0A84FF" : "#34C759";
  const syncLabel = syncState.error
    ? (lang === "zh" ? "同步出错" : "Sync Error")
    : isSyncing
    ? (lang === "zh" ? "同步中..." : "Syncing...")
    : syncState.lastSyncedAt
    ? (lang === "zh" ? "已同步" : "Synced")
    : (lang === "zh" ? "等待同步" : "Waiting");

  // Format last sync time
  const lastSyncLabel = syncState.lastSyncedAt
    ? (() => {
        const diff = Math.floor((Date.now() - syncState.lastSyncedAt) / 1000);
        if (diff < 60) return lang === "zh" ? `${diff} 秒前` : `${diff}s ago`;
        if (diff < 3600) return lang === "zh" ? `${Math.floor(diff / 60)} 分钟前` : `${Math.floor(diff / 60)}m ago`;
        return lang === "zh" ? `${Math.floor(diff / 3600)} 小时前` : `${Math.floor(diff / 3600)}h ago`;
      })()
    : (lang === "zh" ? "从未" : "Never");

  // iCloud backup label
  const icloudLabel = icloudLastBackup
    ? (() => {
        const diff = Math.floor((Date.now() - icloudLastBackup) / 1000 / 60);
        if (diff < 60) return lang === "zh" ? `${diff} 分钟前` : `${diff}m ago`;
        return lang === "zh" ? `${Math.floor(diff / 60)} 小时前` : `${Math.floor(diff / 60)}h ago`;
      })()
    : (lang === "zh" ? "尚未备份" : "Not yet");

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
        <Pressable
          onPress={() => { tap(); void loadDevices(); void loadBalance(); void loadBackupStatus(); }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="paperplane.fill" size={18} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>

        {/* ── 1. Sync Status Card ── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            {lang === "zh" ? "同步状态" : "Sync Status"}
          </Text>
          <View style={styles.syncRow}>
            <SyncPulse active={isSyncing} color={syncColor} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.syncLabel, { color: syncColor }]}>{syncLabel}</Text>
              <Text style={[styles.syncDetail, { color: colors.muted }]}>
                {lang === "zh" ? "上次同步：" : "Last sync: "}{lastSyncLabel}
              </Text>
              {syncState.error && (
                <Text style={[styles.syncError, { color: "#FF3B30" }]} numberOfLines={2}>
                  {syncState.error}
                </Text>
              )}
            </View>
          </View>

          {/* Three-channel status */}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.channelTitle, { color: colors.muted }]}>
            {lang === "zh" ? "三通道备份" : "3-Channel Backup"}
          </Text>
          <ChannelRow
            icon="☁️"
            label="Cloudflare D1"
            status={syncState.lastSyncedAt ? (lang === "zh" ? "正常" : "OK") : (lang === "zh" ? "等待" : "Pending")}
            detail={`${lang === "zh" ? "主通道 · 上次：" : "Primary · Last: "}${lastSyncLabel}`}
            statusColor={syncState.lastSyncedAt ? "#34C759" : "#FF9500"}
          />
          <ChannelRow
            icon="📁"
            label={lang === "zh" ? "iCloud Drive" : "iCloud Drive"}
            status={icloudLastBackup ? (lang === "zh" ? "已备份" : "Backed up") : (lang === "zh" ? "等待" : "Pending")}
            detail={`${lang === "zh" ? "5分钟自动 · 7版本 · 上次：" : "Auto 5min · 7ver · Last: "}${icloudLabel}`}
            statusColor={icloudLastBackup ? "#34C759" : "#FF9500"}
          />
          <ChannelRow
            icon="🔒"
            label={lang === "zh" ? "本地加密快照" : "Local Encrypted"}
            status={localSnapshotCount > 0 ? `${localSnapshotCount}/3` : (lang === "zh" ? "等待" : "Pending")}
            detail={lang === "zh" ? "每次启动自动创建 · 3个循环" : "Auto on launch · 3 rotating"}
            statusColor={localSnapshotCount > 0 ? "#34C759" : "#FF9500"}
          />
        </View>

        {/* ── 2. DeepSeek Balance Card ── */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.balanceHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {lang === "zh" ? "DeepSeek AI 余额" : "DeepSeek AI Balance"}
            </Text>
            <Pressable
              onPress={() => { tap(); void loadBalance(); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={[styles.refreshText, { color: colors.primary }]}>
                {lang === "zh" ? "刷新" : "Refresh"}
              </Text>
            </Pressable>
          </View>
          {balanceLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : balance ? (
            <BalanceBar balance={balance.balance} currency={balance.currency} />
          ) : (
            <Text style={[styles.balanceHint, { color: colors.muted }]}>
              {lang === "zh" ? "无法获取余额（检查网络）" : "Cannot fetch balance (check network)"}
            </Text>
          )}
        </View>

        {/* ── 3. Current Device Card ── */}
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

        {/* ── 4. Pair Code Section (owner only) ── */}
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

        {/* ── 5. Device List ── */}
        <Text style={[styles.listTitle, { color: colors.muted }]}>
          {lang === "zh" ? `设备组（${devices.length} 台）` : `Devices (${devices.length})`}
        </Text>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
        ) : (
          <View style={[styles.deviceListCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {devices.map((item, idx) => (
              <View key={item.id}>
                {idx > 0 && (
                  <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 52 }} />
                )}
                <View style={styles.deviceRow}>
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
              </View>
            ))}
            {devices.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                {lang === "zh" ? "暂无其他设备" : "No other devices"}
              </Text>
            )}
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
  sectionTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20, marginBottom: 12 },
  // Sync pulse
  pulseContainer: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  pulseRing: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
  },
  pulseDot: { width: 12, height: 12, borderRadius: 6 },
  syncRow: { flexDirection: "row", alignItems: "center" },
  syncLabel: { fontSize: 16, fontWeight: "600", lineHeight: 21 },
  syncDetail: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  syncError: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  channelTitle: { fontSize: 12, fontWeight: "500", lineHeight: 17, marginBottom: 8 },
  channelRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 },
  channelIcon: { fontSize: 18, width: 24, textAlign: "center" },
  channelLabel: { fontSize: 14, fontWeight: "500", lineHeight: 19 },
  channelDetail: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  channelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  channelBadgeText: { fontSize: 12, fontWeight: "600", lineHeight: 17 },
  // Balance
  balanceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  refreshText: { fontSize: 14, fontWeight: "500" },
  balanceRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 },
  balanceAmount: { fontSize: 28, fontWeight: "700", lineHeight: 34 },
  balanceStatus: { fontSize: 13, fontWeight: "500", lineHeight: 18 },
  barTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 8 },
  barFill: { height: 6, borderRadius: 3 },
  balanceHint: { fontSize: 12, lineHeight: 17 },
  // Device card
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
  // Pair code
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
  // Device list
  listTitle: { fontSize: 13, fontWeight: "500", lineHeight: 18, paddingHorizontal: 16, marginBottom: 8 },
  deviceListCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
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
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: "center", paddingVertical: 24 },
});
