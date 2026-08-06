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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import {
  generatePairCode,
  kickDevice,
  listDevices,
  updateDeviceRole,
  renameCurrentDevice,
  type DeviceRole,
  type RemoteDevice,
} from "@/lib/cf-sync/client";
import { FEATURE_MODULES, allowedKeysToFeatures, featuresToAllowedKeys, type FeatureKey } from "./role-settings";
import { Switch } from "react-native";
import { useSync } from "@/lib/cf-sync/provider";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { listSnapshots } from "@/lib/backup/local-backup";
import { getICloudMeta } from "@/lib/backup/icloud-backup";
import { syncPhotos } from "@/lib/sync/photo-sync";
import { QRCode } from "@/components/qr-code";

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

// ─── 邀请权限预设 Sheet ────────────────────────────────────────────────────────
// ─── 快捷预设定义 ────────────────────────────────────────────────────────────────────────────────
const INVITE_PRESETS: {
  labelZh: string;
  labelEn: string;
  icon: string;
  role: DeviceRole;
  features: FeatureKey[];
}[] = [
  {
    labelZh: "🏪 吧台设备",
    labelEn: "Bar Device",
    icon: "🏪",
    role: "collaborator",
    features: ["recipes", "bottles", "homemade", "menu", "shopping"],
  },
  {
    labelZh: "🍽️ 厨房设备",
    labelEn: "Kitchen Device",
    icon: "🍽️",
    role: "collaborator",
    features: ["food", "shopping"],
  },
  {
    labelZh: "💰 财务只读",
    labelEn: "Finance Read-Only",
    icon: "💰",
    role: "guest",
    features: ["store_ops", "labor", "payroll"],
  },
  {
    labelZh: "📊 运营只读",
    labelEn: "Ops Read-Only",
    icon: "📊",
    role: "guest",
    features: ["store_ops", "recipes", "wine", "food", "menu"],
  },
  {
    labelZh: "⚗️ 研发设备",
    labelEn: "Lab Device",
    icon: "⚗️",
    role: "collaborator",
    features: ["recipes", "lab", "bottles", "homemade", "books"],
  },
  {
    labelZh: "🔓 全功能协作",
    labelEn: "Full Collaborator",
    icon: "🔓",
    role: "collaborator",
    features: FEATURE_MODULES.map((m) => m.key) as FeatureKey[],
  },
];

function InvitePermissionSheet({
  role,
  features,
  onToggle,
  onApplyPreset,
  lang,
  colors,
}: {
  role: DeviceRole;
  features: Set<FeatureKey>;
  onToggle: (key: FeatureKey) => void;
  onApplyPreset: (preset: typeof INVITE_PRESETS[0]) => void;
  lang: string;
  colors: ReturnType<typeof import("@/hooks/use-colors").useColors>;
}) {
  if (role === "owner") return null;
  return (
    <View style={{ marginTop: 12 }}>
      {/* 快捷预设 */}
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>
        {lang === "zh" ? "快捷预设" : "Quick Presets"}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {INVITE_PRESETS.map((preset) => (
          <Pressable
            key={preset.labelZh}
            onPress={() => onApplyPreset(preset)}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 20,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 13, color: colors.foreground }}>
              {lang === "zh" ? preset.labelZh : preset.labelEn}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* 模块权限开关 */}
      <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 8 }}>
        {lang === "zh" ? "自定义权限（可邀请后再调整）" : "Custom permissions (adjustable later)"}
      </Text>
      {FEATURE_MODULES.map((mod) => (
        <View key={mod.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 6, gap: 10 }}>
          <Text style={{ fontSize: 18, width: 24, textAlign: "center" }}>{mod.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, color: colors.foreground }}>
              {lang === "zh" ? mod.labelZh : mod.labelEn}
            </Text>
            <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
              {lang === "zh" ? mod.descZh : mod.descEn}
            </Text>
          </View>
          <Switch
            value={features.has(mod.key)}
            onValueChange={() => { if (role !== "guest") onToggle(mod.key); }}
            disabled={role === "guest"}
            trackColor={{ false: colors.border, true: mod.color + "80" }}
            thumbColor={features.has(mod.key) ? mod.color : colors.muted}
          />
        </View>
      ))}
    </View>
  );
}

// ─── DeepSeek Balance ─────────────────────────────────────────────────────────
type BalanceInfo = {
  balance: number;
  currency: string;
  lastChecked: number;
} | null;

async function fetchBalance(): Promise<BalanceInfo> {
  try {
    const res = await fetch(`${CF_WORKER_URL}/api/balance`, {
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
  const insets = useSafeAreaInsets();
  const { deviceInfo, deviceRole, syncState, syncError, retrySync, logout, refreshDeviceInfo } = useSync();
  const [manualSyncing, setManualSyncing] = useState(false);
  const [renamingDevice, setRenamingDevice] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  // 照片同步进度
  const [photoProgress, setPhotoProgress] = useState<{
    phase: "upload" | "download" | "repair";
    done: number;
    total: number;
  } | null>(null);
  // 超大照片警告（压缩后仍超限，已跳过的数量）
  const [oversizedWarn, setOversizedWarn] = useState(0);

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
  const [customRoleNames, setCustomRoleNames] = useState<Record<string, string>>({});

  // 邀请时预设功能权限
  const [inviteFeatures, setInviteFeatures] = useState<Set<FeatureKey>>(
    new Set(FEATURE_MODULES.map((m) => m.key)),
  );
  const toggleInviteFeature = (key: FeatureKey) => {
    setInviteFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const applyInvitePreset = (preset: typeof INVITE_PRESETS[0]) => {
    tap();
    setInviteFeatures(new Set(preset.features));
    // 如果预设指定了角色，同时应用角色并生成配对码
    void handleGenerateCode(preset.role);
  };

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  // Load devices
  const loadDevices = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listDevices();
      setDevices(list);
      const names: Record<string, string> = {};
      for (const d of list) {
        const n = await getCustomRoleName(d.id);
        if (n) names[d.id] = n;
      }
      setCustomRoleNames(names);
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
      // 邀请时携带预设功能权限
      const allowedKeys = featuresToAllowedKeys(inviteFeatures);
      const result = await generatePairCode(role, allowedKeys);
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

  // 跳转到权限配置页
  const handleOpenRoleSettings = (device: RemoteDevice) => {
    tap();
    router.push({
      pathname: "/role-settings",
      params: {
        deviceId: device.id,
        deviceName: device.name,
        deviceRole: device.role,
        allowedKeys: device.allowedKeys ? JSON.stringify(device.allowedKeys) : "",
      },
    });
  };

  const doChangeRole = async (targetId: string, role: DeviceRole) => {
    try {
      await updateDeviceRole(targetId, role, null);
      await loadDevices();
    } catch (e: unknown) {
      Alert.alert(lang === "zh" ? "修改失败" : "Failed", String(e));
    }
  };

  // Manual "Sync Now"
  const handleSyncNow = async () => {
    if (manualSyncing) return;
    tap();
    setManualSyncing(true);
    setPhotoProgress(null);
    try {
      const ok = await retrySync();
      if (ok) {
        if (Platform.OS !== "web") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        void loadDevices();
        void loadBackupStatus();
        // 触发照片同步并显示进度
        if (Platform.OS !== "web") {
          void syncPhotos((phase, done, total) => {
            if (phase === "upload" || phase === "download") {
              setPhotoProgress({ phase, done, total });
            }
          }).then((result) => {
            setPhotoProgress(null);
            if (result.oversized > 0) setOversizedWarn(result.oversized);
          });
        }
      } else {
        Alert.alert(
          lang === "zh" ? "同步失败" : "Sync Failed",
          lang === "zh"
            ? "无法完成同步，请检查网络后重试。"
            : "Could not complete sync. Check your network and try again.",
        );
      }
    } finally {
      setManualSyncing(false);
    }
  };

  const isOwner = deviceRole === "owner";
  const isSyncing = syncState.syncing || manualSyncing;
  const combinedError = syncState.error || syncError;
  const syncColor = combinedError ? "#FF3B30" : isSyncing ? "#0A84FF" : "#34C759";
  const syncLabel = combinedError
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
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {lang === "zh" ? "设备管理" : "Device Manager"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Pressable
            onPress={() => { tap(); router.push("/role-guide"); }}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="info.circle" size={22} color={colors.primary} />
          </Pressable>

        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => {
              tap();
              void loadDevices();
              void loadBalance();
              void loadBackupStatus();
            }}
            tintColor={colors.primary}
          />
        }
      >

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
              {combinedError && (
                <Text style={[styles.syncError, { color: "#FF3B30" }]} numberOfLines={2}>
                  {combinedError}
                </Text>
              )}
            </View>
            <Pressable
              onPress={() => void handleSyncNow()}
              disabled={isSyncing}
              style={({ pressed }) => [
                styles.syncNowBtn,
                { backgroundColor: colors.primary, opacity: isSyncing ? 0.5 : pressed ? 0.7 : 1 },
              ]}
            >
              {manualSyncing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.syncNowText}>
                  {lang === "zh" ? "立即同步" : "Sync Now"}
                </Text>
              )}
            </Pressable>
            {/* 照片同步进度 */}
            {photoProgress && photoProgress.total > 0 && (
              <Text style={[styles.photoProgressText, { color: colors.muted }]}>
                {photoProgress.phase === "upload"
                  ? (lang === "zh"
                    ? `上传照片 ${photoProgress.done}/${photoProgress.total} 张`
                    : `Uploading ${photoProgress.done}/${photoProgress.total} photos`)
                  : (lang === "zh"
                    ? `下载照片 ${photoProgress.done}/${photoProgress.total} 张`
                    : `Downloading ${photoProgress.done}/${photoProgress.total} photos`)}
              </Text>
            )}
            {oversizedWarn > 0 && (
              <Text style={[styles.photoProgressText, { color: "#FF9500" }]}>
                {lang === "zh"
                  ? `${oversizedWarn} 张照片压缩后仍超限，已跳过`
                  : `${oversizedWarn} photo(s) still oversized after compression, skipped`}
              </Text>
            )}
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
            label={lang === "zh" ? (isUsingICloudDrive() ? "iCloud Drive 备份" : "本机文档备份") : (isUsingICloudDrive() ? "iCloud Drive Backup" : "Local Documents")}
            status={icloudLastBackup ? (lang === "zh" ? "已备份" : "Backed up") : (lang === "zh" ? "等待" : "Pending")}
            detail={`${lang === "zh" ? (isUsingICloudDrive() ? "1小时自动 · 7版本 · 跨设备可见 · 上次：" : "1小时自动 · 7版本 · 本地存储 · 上次：") : (isUsingICloudDrive() ? "Auto 1h · 7ver · visible in Files app · Last: " : "Auto 1h · 7ver · local storage · Last: ")}${icloudLabel}`}
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
            {renamingDevice ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 4 }}>
                <TextInput
                  value={renameInput}
                  onChangeText={setRenameInput}
                  placeholder={deviceInfo.deviceName}
                  placeholderTextColor={colors.muted}
                  style={{
                    flex: 1,
                    fontSize: 16,
                    color: colors.foreground,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.primary,
                    paddingVertical: 4,
                  }}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={async () => {
                    if (renameInput.trim()) {
                      await renameCurrentDevice(renameInput.trim());
                      await refreshDeviceInfo();
                    }
                    setRenamingDevice(false);
                    setRenameInput("");
                  }}
                />
                <Pressable
                  onPress={async () => {
                    if (renameInput.trim()) {
                      await renameCurrentDevice(renameInput.trim());
                      await refreshDeviceInfo();
                    }
                    setRenamingDevice(false);
                    setRenameInput("");
                  }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>
                    {lang === "zh" ? "保存" : "Save"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => { setRenamingDevice(false); setRenameInput(""); }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={{ fontSize: 14, color: colors.muted }}>
                    {lang === "zh" ? "取消" : "Cancel"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={[styles.deviceName, { color: colors.foreground, flex: 1 }]}>{deviceInfo.deviceName}</Text>
                <Pressable
                  onPress={() => { tap(); setRenameInput(deviceInfo.deviceName); setRenamingDevice(true); }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <Text style={{ fontSize: 13, color: colors.primary }}>
                    {lang === "zh" ? "重命名" : "Rename"}
                  </Text>
                </Pressable>
              </View>
            )}
            <Text style={[styles.deviceDesc, { color: colors.muted }]}>
              {lang === "zh" ? ROLE_DESC[deviceInfo.role].zh : ROLE_DESC[deviceInfo.role].en}
            </Text>
            {/* Bug 5：显示同步组短码，便于跨设备核对是否在同一组 */}
            <Text style={[styles.deviceDesc, { color: colors.muted, marginTop: 4 }]}>
              {lang === "zh" ? "同步组 " : "Sync group "}
              <Text style={{ fontWeight: "600", color: colors.foreground }}>
                {deviceInfo.groupId.slice(0, 8).toUpperCase()}
              </Text>
              {lang === "zh" ? "（各设备需一致才互相同步）" : " (must match across devices)"}
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
                {/* QR Code */}
                <View style={{ alignItems: "center", marginTop: 12 }}>
                  <QRCode value={pairCode} size={160} backgroundColor="#FFFFFF" foregroundColor="#000000" />
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                    {lang === "zh" ? "扫描二维码或手动输入上方数字" : "Scan QR or enter the code manually"}
                  </Text>
                </View>
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
            {/* 邀请权限预设（生成配对码前可调整） */}
            {!pairCode && (
              <InvitePermissionSheet
                role={"collaborator"}
                features={inviteFeatures}
                onToggle={toggleInviteFeature}
                onApplyPreset={applyInvitePreset}
                lang={lang}
                colors={colors}
              />
            )}
            {/* 权限说明链接 */}
            <Pressable
              onPress={() => { tap(); router.push("/role-guide"); }}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, marginTop: 14, alignSelf: "flex-start" })}
            >
              <Text style={{ fontSize: 13, color: colors.primary }}>
                {lang === "zh" ? "各角色权限说明 →" : "Role permissions guide →"}
              </Text>
            </Pressable>
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
                      {customRoleNames[item.id] ? `（${customRoleNames[item.id]}）` : ""}
                    </Text>
                  </View>
                 {isOwner && !item.isCurrentDevice && (
                   <View style={styles.deviceActions}>
                      {item.role !== "owner" && (
                        <Pressable
                          onPress={() => {
                            tap();
                            Alert.alert(
                              lang === "zh" ? "设为主设备" : "Set as Owner",
                              lang === "zh"
                                ? `将「${item.name}」设为主设备？当前主设备将降级为协作者。`
                                : `Set "${item.name}" as the owner? The current owner will become a collaborator.`,
                              [
                                { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
                                { text: lang === "zh" ? "确认" : "Confirm", style: "destructive", onPress: () => void doChangeRole(item.id, "owner") },
                              ],
                            );
                          }}
                          style={({ pressed }) => [styles.actionBtn, { borderColor: "#FF9500", borderWidth: 1 }, pressed && { opacity: 0.6 }]}
                        >
                          <Text style={[styles.actionBtnText, { color: "#FF9500" }]}>
                            {lang === "zh" ? "设为主设备" : "Set Owner"}
                          </Text>
                        </Pressable>
                      )}
                      <Pressable
                        onPress={() => handleOpenRoleSettings(item)}
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.6 }]}
                      >
                        <Text style={[styles.actionBtnText, { color: colors.primary }]}>
                          {lang === "zh" ? "权限" : "Perms"}
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
              <View style={{
                marginHorizontal: 16,
                marginVertical: 8,
                backgroundColor: colors.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 20,
                alignItems: "center",
                gap: 8,
              }}>
                <IconSymbol name="qrcode" size={36} color={colors.muted} />
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground, textAlign: "center" }}>
                  {lang === "zh" ? "暂无其他设备" : "No other devices yet"}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", lineHeight: 19 }}>
                  {lang === "zh"
                    ? "在上方生成配对码，在新设备的设备管理中输入即可加入同步组"
                    : "Generate a pair code above and enter it on the new device to join the sync group"}
                </Text>
              </View>
            )}
            {devices.length === 1 && (
              <Text style={[styles.emptyText, { color: colors.muted, paddingHorizontal: 16 }]}>
                {lang === "zh"
                  ? "当前同步组只有本机一台设备。若想让 Mac / 其他设备同步数据，请在上方生成配对码，并在新设备的「设备管理 → 加入设备组」中输入。各自独立注册的设备不会互相同步。"
                  : "Only this device is in the sync group. To sync with your Mac or other devices, generate a pair code above and enter it on the new device (Device Manager → Join Group). Independently registered devices do NOT sync with each other."}
              </Text>
            )}
          </View>
        )}
        {/* ── 危险区：退出同步组 / 退出并清除数据 ── */}
        {deviceInfo && (
          <View style={{ marginHorizontal: 16, marginTop: 8, marginBottom: 8 }}>
            <Text style={[styles.listTitle, { color: colors.muted, marginBottom: 8 }]}>
              {lang === "zh" ? "危险操作" : "Danger Zone"}
            </Text>
            <View style={[styles.deviceListCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              {/* 退出同步组 */}
              <Pressable
                onPress={() => {
                  tap();
                  if (Platform.OS === "web") {
                    if (typeof window !== "undefined" && window.confirm(lang === "zh" ? "退出同步组？" : "Leave sync group?")) {
                      void logout();
                    }
                  } else {
                    Alert.alert(
                      lang === "zh" ? "退出同步组" : "Leave Sync Group",
                      lang === "zh" ? "退出后本设备将停止同步，数据仍保留在本地。" : "You will stop syncing. Local data is kept.",
                      [
                        { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
                        { text: lang === "zh" ? "退出" : "Leave", style: "destructive", onPress: () => void logout() },
                      ],
                    );
                  }
                }}
                style={({ pressed }) => [styles.deviceRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.deviceIcon, { backgroundColor: "#8E8E93" }]}>
                  <IconSymbol name="rectangle.portrait.and.arrow.right" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.deviceRowName, { color: colors.foreground }]}>
                    {lang === "zh" ? "退出同步组" : "Leave Sync Group"}
                  </Text>
                  <Text style={[styles.deviceRowRole, { color: colors.muted }]}>
                    {lang === "zh" ? "停止多设备同步，数据保留本地" : "Stop syncing, keep local data"}
                  </Text>
                </View>
              </Pressable>
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
              {/* 退出并清除数据 */}
              <Pressable
                onPress={() => {
                  tap();
                  Alert.alert(
                    lang === "zh" ? "退出并清除数据" : "Leave & Clear Data",
                    lang === "zh"
                      ? "退出同步组并删除本机所有本地数据（配方、酒库、自制等）。此操作不可恢复。"
                      : "Leave the sync group and delete all local data. This cannot be undone.",
                    [
                      { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
                      {
                        text: lang === "zh" ? "退出并清除" : "Leave & Clear",
                        style: "destructive",
                        onPress: async () => {
                          await logout();
                          await AsyncStorage.clear();
                          if (Platform.OS !== "web") {
                            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                          }
                          Alert.alert(
                            lang === "zh" ? "已清除" : "Cleared",
                            lang === "zh" ? "所有本地数据已清除，请重启 App。" : "All local data cleared. Please restart the App.",
                          );
                        },
                      },
                    ],
                  );
                }}
                style={({ pressed }) => [styles.deviceRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.deviceIcon, { backgroundColor: "#8E8E93" }]}>
                  <IconSymbol name="trash.fill" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.deviceRowName, { color: colors.foreground }]}>
                    {lang === "zh" ? "退出并清除数据" : "Leave & Clear Data"}
                  </Text>
                  <Text style={[styles.deviceRowRole, { color: colors.muted }]}>
                    {lang === "zh" ? "退出同步组并删除本机所有本地数据" : "Leave group and wipe all local data"}
                  </Text>
                </View>
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
  syncNowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 76,
  },
  syncNowText: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: "#FFFFFF" },
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
  photoProgressText: { fontSize: 12, lineHeight: 16, marginTop: 6, textAlign: "center" },
});
import { getCustomRoleName } from "./role-settings";
import { isUsingICloudDrive } from "@/lib/backup/icloud-backup";
