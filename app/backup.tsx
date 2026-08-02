import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import React, { useEffect, useState } from "react";
import { Stack, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { getBackupInfo, restoreFromBackup, backupLocalData, triggerStoreReload } from "@/lib/sync/engine";
import { exportCurrentDataToFile, importFromJsonFile, listSnapshots, computeSnapshotDiff, computeBackupFileDiff } from "@/lib/backup/local-backup";
import {
  performBackup,
  getICloudMeta,
  listBackupVersions,
  restoreFromBackup as restoreFromICloud,
} from "@/lib/backup/icloud-backup";
import { readBackupVersion } from "@/lib/backup/icloud-backup";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function BackupScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const insets = useSafeAreaInsets();

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const [backupTime, setBackupTime] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [icloudBacking, setIcloudBacking] = useState(false);
  const [icloudLastAt, setIcloudLastAt] = useState<number | null>(null);
  const [icloudRestoring, setIcloudRestoring] = useState(false);
  const [importing, setImporting] = useState(false);
  // 本地快照列表（含 diff）
  const [snapshots, setSnapshots] = useState<Array<{
    slot: number; label: string; keyCount: number; createdAt: number; isValid: boolean;
    diff?: { snapshot: { recipes: number; bottles: number; homemade: number }; current: { recipes: number; bottles: number; homemade: number } } | null;
  }>>([]);
  // iCloud 版本列表（含 diff）
  const [icloudVersions, setIcloudVersions] = useState<Array<{
    slot: number; label: string; keyCount: number; sizeBytes: number; createdAt: number; exists: boolean;
    diff?: { snapshot: { recipes: number; bottles: number; homemade: number }; current: { recipes: number; bottles: number; homemade: number } } | null;
  }>>([]);
  const [icloudVersionsExpanded, setIcloudVersionsExpanded] = useState(false);
  const [icloudVersionsLoading, setIcloudVersionsLoading] = useState(false);

  useEffect(() => {
    getBackupInfo().then((info) => setBackupTime(info?.time ?? null));
    getICloudMeta().then((meta) => setIcloudLastAt(meta.lastBackupAt));
    void loadSnapshots();
  }, []);

  const loadSnapshots = async () => {
    const list = await listSnapshots();
    const withDiff = await Promise.all(
      list.map(async (s) => ({ ...s, diff: await computeSnapshotDiff(s.slot) })),
    );
    setSnapshots(withDiff);
  };

  const loadICloudVersions = async () => {
    setIcloudVersionsLoading(true);
    try {
      const versions = await listBackupVersions();
      const currentPairs = await AsyncStorage.multiGet(["cocktail.recipes", "cocktail.bottles", "homemade.preps.v1"]);
      const currentData: Record<string, string | null> = {};
      for (const [k, v] of currentPairs) currentData[k] = v;
      const withDiff = await Promise.all(
        versions.map(async (v) => {
          if (!v.exists) return { ...v, diff: null };
          const file = await readBackupVersion(v.slot);
          if (!file) return { ...v, diff: null };
          return { ...v, diff: computeBackupFileDiff(file.data, currentData) };
        }),
      );
      setIcloudVersions(withDiff);
    } finally {
      setIcloudVersionsLoading(false);
    }
  };

  const handleICloudVersionRestore = (slot: number, label: string) => {
    Alert.alert(
      lang === "zh" ? "确认恢复" : "Confirm Restore",
      lang === "zh"
        ? `确定要恢复 ${label} 的备份吗？\n\n当前所有数据将被替换，此操作不可撤销。`
        : `Restore backup from ${label}?\n\nAll current data will be replaced. This cannot be undone.`,
      [
        { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
        {
          text: lang === "zh" ? "确认恢复" : "Restore",
          style: "destructive",
          onPress: async () => {
            try {
              const result = await restoreFromICloud(slot);
              triggerStoreReload();
              getICloudMeta().then((meta) => setIcloudLastAt(meta.lastBackupAt));
              Alert.alert(
                lang === "zh" ? "恢复成功" : "Restore Complete",
                lang === "zh"
                  ? `已成功恢复 ${result.restored} 项数据。`
                  : `Restored ${result.restored} items.`,
              );
            } catch {
              Alert.alert(
                lang === "zh" ? "恢复失败" : "Restore Failed",
                lang === "zh" ? "无法读取备份文件，请重试。" : "Could not read backup file. Please try again.",
              );
            }
          },
        },
      ],
    );
  };

  const handleSnapshotRestore = (slot: number, label: string) => {
    Alert.alert(
      lang === "zh" ? "恢复快照" : "Restore Snapshot",
      lang === "zh"
        ? `确定要恢复至「${label}」的快照吗？\n\n当前所有数据将被替换。`
        : `Restore snapshot "${label}"?\n\nAll current data will be replaced.`,
      [
        { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
        {
          text: lang === "zh" ? "确认恢复" : "Restore",
          style: "destructive",
          onPress: async () => {
            setRestoring(true);
            const ok = await restoreFromBackup();
            setRestoring(false);
            if (ok) triggerStoreReload();
            Alert.alert(
              ok ? (lang === "zh" ? "恢复成功" : "Restored") : (lang === "zh" ? "恢复失败" : "Failed"),
              ok
                ? (lang === "zh" ? "数据已恢复。" : "Data restored.")
                : (lang === "zh" ? "未找到快照数据。" : "Snapshot not found."),
            );
          },
        },
      ],
    );
  };

  // ─── 本地快照恢复 ─────────────────────────────────────────────────────────
  const handleRestore = () => {
    if (!backupTime) return;
    const timeStr = new Date(backupTime).toLocaleString();
    Alert.alert(
      lang === "zh" ? "恢复备份" : "Restore Backup",
      lang === "zh"
        ? `确定要恢复至 ${timeStr} 的备份吗？\n\n当前所有数据将被替换为备份内容。`
        : `Restore to backup from ${timeStr}?\n\nAll current data will be replaced.`,
      [
        { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
        {
          text: lang === "zh" ? "确认恢复" : "Restore",
          style: "destructive",
          onPress: async () => {
            setRestoring(true);
            const ok = await restoreFromBackup();
            setRestoring(false);
            Alert.alert(
              ok ? (lang === "zh" ? "恢复成功" : "Restored") : (lang === "zh" ? "恢复失败" : "Failed"),
              ok
                ? (lang === "zh" ? "数据已恢复，配方/酒款/自制品统计已自动更新。" : "Data restored. Stats updated automatically.")
                : (lang === "zh" ? "未找到备份数据。" : "No backup found."),
            );
          },
        },
      ],
    );
  };

  // ─── 立即备份 ─────────────────────────────────────────────────────────────
  const handleManualBackup = async () => {
    tap();
    await backupLocalData();
    const info = await getBackupInfo();
    setBackupTime(info?.time ?? null);
    Alert.alert(
      lang === "zh" ? "备份成功" : "Backup Created",
      lang === "zh" ? "当前数据已备份，同步异常时可一键恢复。" : "Current data backed up. You can restore it if sync goes wrong.",
    );
  };

  // ─── iCloud 恢复 ──────────────────────────────────────────────────────────
  const handleICloudRestore = async () => {
    setIcloudRestoring(true);
    try {
      const versions = await listBackupVersions();
      if (versions.length === 0) {
        Alert.alert(
          lang === "zh" ? "无可用备份" : "No Backups Available",
          lang === "zh" ? "iCloud Drive 中暂无备份文件，请先执行备份。" : "No backup files found in iCloud Drive. Please back up first.",
        );
        return;
      }
      const buttons = versions.map((v) => ({
        text: `${v.label}  ·  ${v.keyCount} 项  ·  ${(v.sizeBytes / 1024).toFixed(1)} KB`,
        onPress: () => {
          Alert.alert(
            lang === "zh" ? "确认恢复" : "Confirm Restore",
            lang === "zh"
              ? `确定要恢复 ${v.label} 的备份吗？\n\n当前所有数据将被替换，此操作不可撤销。`
              : `Restore backup from ${v.label}?\n\nAll current data will be replaced. This cannot be undone.`,
            [
              { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
              {
                text: lang === "zh" ? "确认恢复" : "Restore",
                style: "destructive",
                onPress: async () => {
                  try {
                    const result = await restoreFromICloud(v.slot);
                    triggerStoreReload();
                    getICloudMeta().then((meta) => setIcloudLastAt(meta.lastBackupAt));
                    Alert.alert(
                      lang === "zh" ? "恢复成功" : "Restore Complete",
                      lang === "zh"
                        ? `已成功恢复 ${result.restored} 项数据，配方/酒款/自制品统计已自动更新。`
                        : `Restored ${result.restored} items. Stats updated automatically.`,
                    );
                  } catch {
                    Alert.alert(
                      lang === "zh" ? "恢复失败" : "Restore Failed",
                      lang === "zh" ? "无法读取备份文件，请重试。" : "Could not read backup file. Please try again.",
                    );
                  }
                },
              },
            ],
          );
        },
      }));
      buttons.push({ text: lang === "zh" ? "取消" : "Cancel", onPress: () => {} });
      Alert.alert(
        lang === "zh" ? "选择恢复版本" : "Select Backup Version",
        lang === "zh" ? "选择要恢复的 iCloud 备份版本：" : "Choose a backup version to restore:",
        buttons as any,
        { cancelable: true },
      );
    } catch {
      Alert.alert(
        lang === "zh" ? "读取失败" : "Load Failed",
        lang === "zh" ? "无法读取 iCloud 备份列表，请检查 iCloud 设置。" : "Could not load iCloud backups. Check your iCloud settings.",
      );
    } finally {
      setIcloudRestoring(false);
    }
  };

  // ─── iCloud 手动备份 ──────────────────────────────────────────────────────
  const handleICloudBackup = async () => {
    setIcloudBacking(true);
    try {
      const meta = await performBackup("手动备份");
      setIcloudLastAt(meta.lastBackupAt);
      Alert.alert(
        lang === "zh" ? "iCloud 备份成功" : "iCloud Backup Complete",
        lang === "zh"
          ? `数据已保存到 iCloud Drive，共 ${meta.slots.filter(Boolean).length} 个版本可用。`
          : `Data saved to iCloud Drive. ${meta.slots.filter(Boolean).length} version(s) available.`,
      );
    } catch {
      Alert.alert(
        lang === "zh" ? "备份失败" : "Backup Failed",
        lang === "zh" ? "无法写入 iCloud Drive，请检查 iCloud 设置。" : "Could not write to iCloud Drive. Check your iCloud settings.",
      );
    } finally {
      setIcloudBacking(false);
    }
  };

  // ─── 导出备份文件 ─────────────────────────────────────────────────────────
  const handleExportFile = async () => {
    try {
      await exportCurrentDataToFile();
    } catch (e) {
      Alert.alert(
        lang === "zh" ? "导出失败" : "Export Failed",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // ─── 从文件导入备份 ───────────────────────────────────────────────────────
  const handleImportFile = async () => {
    if (Platform.OS === "web") {
      Alert.alert(
        lang === "zh" ? "不支持" : "Not Supported",
        lang === "zh" ? "请在移动设备上使用此功能" : "Please use this feature on a mobile device",
      );
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const jsonString = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      let parsed: { appId?: string; keyCount?: number; snapshotCreatedAt?: string };
      try {
        parsed = JSON.parse(jsonString);
      } catch {
        Alert.alert(
          lang === "zh" ? "文件无效" : "Invalid File",
          lang === "zh" ? "所选文件不是有效的 JSON 格式" : "The selected file is not valid JSON",
        );
        return;
      }
      if (parsed.appId !== "cocktail-r") {
        Alert.alert(
          lang === "zh" ? "文件不匹配" : "Wrong File",
          lang === "zh" ? "该文件不是 cocktail R 的备份文件" : "This file is not a cocktail R backup",
        );
        return;
      }
      const dateStr = parsed.snapshotCreatedAt
        ? new Date(parsed.snapshotCreatedAt).toLocaleString()
        : lang === "zh" ? "未知时间" : "unknown time";
      const keyCount = parsed.keyCount ?? "?";
      Alert.alert(
        lang === "zh" ? "确认导入" : "Confirm Import",
        lang === "zh"
          ? `将从备份文件恢复数据：\n\n备份时间：${dateStr}\n数据条目：${keyCount} 项\n\n⚠️ 当前所有数据将被替换为备份内容，此操作不可撤销。`
          : `Restore from backup file:\n\nBackup time: ${dateStr}\nData entries: ${keyCount}\n\n⚠️ All current data will be replaced. This cannot be undone.`,
        [
          { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
          {
            text: lang === "zh" ? "确认导入" : "Import",
            style: "destructive",
            onPress: async () => {
              setImporting(true);
              try {
                const { restored, failed } = await importFromJsonFile(jsonString);
                triggerStoreReload();
                Alert.alert(
                  lang === "zh" ? "导入成功" : "Import Successful",
                  lang === "zh"
                    ? `已成功恢复 ${restored} 条数据${failed > 0 ? `，${failed} 条失败` : ""}，配方/酒款/自制品统计已自动更新。`
                    : `Restored ${restored} entries${failed > 0 ? `, ${failed} failed` : ""}. Stats updated automatically.`,
                );
              } catch (e) {
                Alert.alert(
                  lang === "zh" ? "导入失败" : "Import Failed",
                  e instanceof Error ? e.message : String(e),
                );
              } finally {
                setImporting(false);
              }
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert(
        lang === "zh" ? "选择文件失败" : "File Pick Failed",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // ─── UI ───────────────────────────────────────────────────────────────────
  const icloudFresh = icloudLastAt !== null && Date.now() - icloudLastAt < 24 * 60 * 60 * 1000;

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* 手动 Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => { tap(); router.back(); }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>
            {lang === "zh" ? "返回" : "Back"}
          </Text>
        </Pressable>
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>
          {lang === "zh" ? "数据备份" : "Data Backup"}
        </Text>
        <View style={{ width: 60 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 + insets.bottom }}>

        {/* iCloud 状态卡片 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconWrap, { backgroundColor: "#007AFF" }]}>
              <IconSymbol name="icloud.fill" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} className="text-foreground">
                {lang === "zh" ? "iCloud Drive 备份" : "iCloud Drive Backup"}
              </Text>
              <Text style={styles.cardDesc} className="text-muted">
                {icloudLastAt
                  ? (lang === "zh" ? `上次备份：${new Date(icloudLastAt).toLocaleString()}` : `Last backup: ${new Date(icloudLastAt).toLocaleString()}`)
                  : (lang === "zh" ? "尚未备份到 iCloud" : "Not backed up to iCloud yet")}
              </Text>
            </View>
            {icloudLastAt ? (
              <View style={[styles.freshDot, { backgroundColor: icloudFresh ? "#34C759" : "#FF9F0A" }]} />
            ) : null}
          </View>
          <View style={styles.divider} />
          {/* 备份到 iCloud */}
          <Pressable
            onPress={handleICloudBackup}
            disabled={icloudBacking}
            style={({ pressed }) => [styles.row, (pressed || icloudBacking) && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} className="text-foreground">
                {icloudBacking ? (lang === "zh" ? "备份中…" : "Backing up…") : (lang === "zh" ? "立即备份到 iCloud" : "Backup to iCloud Now")}
              </Text>
              <Text style={styles.rowDesc} className="text-muted">
                {lang === "zh" ? "7 个版本循环保留，自动每小时备份一次" : "7 rotating versions, auto-backup every hour"}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
          <View style={styles.divider} />
          {/* 从 iCloud 恢复 — 展开版本列表 */}
          <Pressable
            onPress={() => {
              tap();
              if (!icloudVersionsExpanded) void loadICloudVersions();
              setIcloudVersionsExpanded((v) => !v);
            }}
            disabled={icloudVersionsLoading}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} className="text-foreground">
                {icloudVersionsLoading ? (lang === "zh" ? "加载中…" : "Loading…") : (lang === "zh" ? "从 iCloud 恢复" : "Restore from iCloud")}
              </Text>
              <Text style={styles.rowDesc} className="text-muted">
                {lang === "zh" ? "点击展开版本列表，查看各版本数据差异" : "Tap to expand versions with data diff"}
              </Text>
            </View>
            <IconSymbol name={icloudVersionsExpanded ? "chevron.right" : "chevron.right"} size={16} color={colors.muted} />
          </Pressable>
          {icloudVersionsExpanded && icloudVersions.map((v) => (
            <React.Fragment key={v.slot}>
              <View style={[styles.divider, { marginLeft: 16 }]} />
              <Pressable
                onPress={() => { tap(); handleICloudVersionRestore(v.slot, v.label); }}
                style={({ pressed }) => [styles.versionRow, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.versionLabel, { color: colors.foreground }]}>{v.label}</Text>
                  {v.diff ? (
                    <Text style={[styles.diffText, { color: (() => {
                      const d = v.diff;
                      const gain = (d.snapshot.recipes - d.current.recipes) + (d.snapshot.bottles - d.current.bottles) + (d.snapshot.homemade - d.current.homemade);
                      return gain > 0 ? "#34C759" : gain < 0 ? "#FF9500" : colors.muted;
                    })() }]}>
                      {lang === "zh"
                        ? `配方 ${v.diff.snapshot.recipes}（当前 ${v.diff.current.recipes}）· 酒款 ${v.diff.snapshot.bottles}（当前 ${v.diff.current.bottles}）· 自制 ${v.diff.snapshot.homemade}（当前 ${v.diff.current.homemade}）`
                        : `Recipes ${v.diff.snapshot.recipes} (now ${v.diff.current.recipes}) · Bottles ${v.diff.snapshot.bottles} (now ${v.diff.current.bottles}) · Homemade ${v.diff.snapshot.homemade} (now ${v.diff.current.homemade})`}
                    </Text>
                  ) : (
                    <Text style={[styles.diffText, { color: colors.muted }]}>
                      {v.exists ? (lang === "zh" ? "无法读取差异" : "Diff unavailable") : (lang === "zh" ? "文件不存在" : "File missing")}
                    </Text>
                  )}
                </View>
                <Text style={[styles.restoreBtn, { color: colors.primary }]}>
                  {lang === "zh" ? "恢复" : "Restore"}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>

        {/* 本地快照卡片 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
              <IconSymbol name="externaldrive.fill" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} className="text-foreground">
                {lang === "zh" ? "本地快照" : "Local Snapshot"}
              </Text>
              <Text style={styles.cardDesc} className="text-muted">
                {backupTime
                  ? (lang === "zh" ? `上次快照：${new Date(backupTime).toLocaleString()}` : `Last snapshot: ${new Date(backupTime).toLocaleString()}`)
                  : (lang === "zh" ? "尚未创建本地快照" : "No local snapshot yet")}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          {/* 立即备份 */}
          <Pressable
            onPress={handleManualBackup}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} className="text-foreground">
                {lang === "zh" ? "立即创建快照" : "Create Snapshot Now"}
              </Text>
              <Text style={styles.rowDesc} className="text-muted">
                {lang === "zh" ? "保存当前数据快照，3 个版本循环保留" : "Save current data snapshot, 3 rotating versions"}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
          {backupTime != null && (
            <>
              <View style={styles.divider} />
              {/* 恢复快照 */}
              <Pressable
                onPress={handleRestore}
                disabled={restoring}
                style={({ pressed }) => [styles.row, (pressed || restoring) && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} className="text-foreground">
                    {restoring ? (lang === "zh" ? "恢复中…" : "Restoring…") : (lang === "zh" ? "恢复最新快照" : "Restore Latest Snapshot")}
                  </Text>
                  <Text style={styles.rowDesc} className="text-muted">
                    {lang === "zh"
                      ? `恢复至 ${new Date(backupTime).toLocaleString()} 的快照`
                      : `Restore snapshot from ${new Date(backupTime).toLocaleString()}`}
                  </Text>
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
            </>
          )}
          {/* 历史快照列表（含 diff） */}
          {snapshots.length > 0 && (
            <>
              <View style={styles.divider} />
              <View style={[styles.row, { paddingVertical: 8 }]}>
                <Text style={[styles.rowDesc, { color: colors.muted, flex: 1 }]}>
                  {lang === "zh" ? "历史快照版本" : "Snapshot History"}
                </Text>
              </View>
              {snapshots.map((s) => (
                <React.Fragment key={s.slot}>
                  <View style={[styles.divider, { marginLeft: 16 }]} />
                  <Pressable
                    onPress={() => { tap(); handleSnapshotRestore(s.slot, s.label); }}
                    disabled={restoring}
                    style={({ pressed }) => [styles.versionRow, pressed && { opacity: 0.7 }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.versionLabel, { color: colors.foreground }]}>{s.label}</Text>
                      {s.diff ? (
                        <Text style={[styles.diffText, { color: (() => {
                          const d = s.diff;
                          const gain = (d.snapshot.recipes - d.current.recipes) + (d.snapshot.bottles - d.current.bottles) + (d.snapshot.homemade - d.current.homemade);
                          return gain > 0 ? "#34C759" : gain < 0 ? "#FF9500" : colors.muted;
                        })() }]}>
                          {lang === "zh"
                            ? `配方 ${s.diff.snapshot.recipes}（当前 ${s.diff.current.recipes}）· 酒款 ${s.diff.snapshot.bottles}（当前 ${s.diff.current.bottles}）· 自制 ${s.diff.snapshot.homemade}（当前 ${s.diff.current.homemade}）`
                            : `Recipes ${s.diff.snapshot.recipes} (now ${s.diff.current.recipes}) · Bottles ${s.diff.snapshot.bottles} (now ${s.diff.current.bottles}) · Homemade ${s.diff.snapshot.homemade} (now ${s.diff.current.homemade})`}
                        </Text>
                      ) : (
                        <Text style={[styles.diffText, { color: colors.muted }]}>
                          {s.isValid ? (lang === "zh" ? "无法计算差异" : "Diff unavailable") : (lang === "zh" ? "快照已损坏" : "Snapshot corrupted")}
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.restoreBtn, { color: colors.primary }]}>
                      {lang === "zh" ? "恢复" : "Restore"}
                    </Text>
                  </Pressable>
                </React.Fragment>
              ))}
            </>
          )}
        </View>

        {/* 文件导入导出卡片 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.iconWrap, { backgroundColor: "#5856D6" }]}>
              <IconSymbol name="square.and.arrow.up.fill" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle} className="text-foreground">
                {lang === "zh" ? "文件导入 / 导出" : "Import / Export File"}
              </Text>
              <Text style={styles.cardDesc} className="text-muted">
                {lang === "zh" ? "JSON 格式，支持跨设备迁移" : "JSON format, supports cross-device migration"}
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          {/* 导出 */}
          <Pressable
            onPress={handleExportFile}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} className="text-foreground">
                {lang === "zh" ? "导出备份文件" : "Export Backup File"}
              </Text>
              <Text style={styles.rowDesc} className="text-muted">
                {lang === "zh" ? "将所有数据导出为 JSON 文件，可分享或存档" : "Export all data as JSON, shareable or archivable"}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
          <View style={styles.divider} />
          {/* 导入 */}
          <Pressable
            onPress={handleImportFile}
            disabled={importing}
            style={({ pressed }) => [styles.row, (pressed || importing) && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} className="text-foreground">
                {importing ? (lang === "zh" ? "导入中…" : "Importing…") : (lang === "zh" ? "从文件导入备份" : "Import Backup File")}
              </Text>
              <Text style={styles.rowDesc} className="text-muted">
                {lang === "zh" ? "从 JSON 备份文件恢复数据" : "Restore data from a JSON backup file"}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
        </View>

        {/* 同步日志入口 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Pressable
            onPress={() => { tap(); router.push("/sync-log"); }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: "#34C759" }]}>
              <IconSymbol name="list.bullet.rectangle.fill" size={18} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} className="text-foreground">
                {lang === "zh" ? "同步日志" : "Sync Log"}
              </Text>
              <Text style={styles.rowDesc} className="text-muted">
                {lang === "zh" ? "查看每次同步的详细记录" : "View detailed sync history"}
              </Text>
            </View>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </Pressable>
        </View>

      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 60,
  },
  backText: {
    fontSize: 16,
    marginLeft: 2,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: "600",
  },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  cardDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  freshDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 4,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(0,0,0,0.1)",
    marginLeft: 64,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "500",
  },
  rowDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  versionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(0,0,0,0.02)",
  },
  versionLabel: {
    fontSize: 14,
    fontWeight: "500",
  },
  diffText: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  restoreBtn: {
    fontSize: 14,
    fontWeight: "600",
  },
});
