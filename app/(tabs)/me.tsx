import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useRecipeStore } from "@/lib/recipes/store";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useSync } from "@/lib/cf-sync/provider";
import React, { useEffect, useState } from "react";
import { getBackupInfo, restoreFromBackup, backupLocalData, triggerStoreReload } from "@/lib/sync/engine";
import { exportCurrentDataToFile, importFromJsonFile } from "@/lib/backup/local-backup";
import { performBackup, getICloudMeta, listBackupVersions, restoreFromBackup as restoreFromICloud } from "@/lib/backup/icloud-backup";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";

/** "我的"个人中心页:数据总览、标签管理与批量导入入口、语言设置 */
export default function MeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const { recipes } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const { syncState, isAuthenticated, user, login, deviceInfo, deviceRole } = useSync();
  const insets = useSafeAreaInsets();
  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const [backupTime, setBackupTime] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [icloudBacking, setIcloudBacking] = useState(false);
  const [icloudLastAt, setIcloudLastAt] = useState<number | null>(null);
  const [icloudRestoring, setIcloudRestoring] = useState(false);

  useEffect(() => {
    getBackupInfo().then((info) => setBackupTime(info?.time ?? null));
    getICloudMeta().then((meta) => setIcloudLastAt(meta.lastBackupAt));
  }, [syncState.lastSyncedAt]);

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
              ok
                ? (lang === "zh" ? "恢复成功" : "Restored")
                : (lang === "zh" ? "恢复失败" : "Failed"),
              ok
                ? (lang === "zh" ? "数据已恢复，请重启应用生效。" : "Data restored. Please restart the app.")
                : (lang === "zh" ? "未找到备份数据。" : "No backup found."),
            );
          },
        },
      ],
    );
  };

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
      // 构建选项列表
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
                    // 刷新 iCloud 元数据显示
                    getICloudMeta().then((meta) => setIcloudLastAt(meta.lastBackupAt));
                    Alert.alert(
                      lang === "zh" ? "恢复成功" : "Restore Complete",
                      lang === "zh"
                        ? `已成功恢复 ${result.restored} 项数据，配方/酒款/自制品统计已自动更新。`
                        : `Restored ${result.restored} items. Stats updated automatically.`,
                    );
                  } catch (e) {
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
    } catch (e) {
      Alert.alert(
        lang === "zh" ? "读取失败" : "Load Failed",
        lang === "zh" ? "无法读取 iCloud 备份列表，请检查 iCloud 设置。" : "Could not load iCloud backups. Check your iCloud settings.",
      );
    } finally {
      setIcloudRestoring(false);
    }
  };

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
    } catch (e) {
      Alert.alert(
        lang === "zh" ? "备份失败" : "Backup Failed",
        lang === "zh" ? "无法写入 iCloud Drive，请检查 iCloud 设置。" : "Could not write to iCloud Drive. Check your iCloud settings.",
      );
    } finally {
      setIcloudBacking(false);
    }
  };

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

  const [importing, setImporting] = useState(false);

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
      // 读取文件内容
      const jsonString = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      // 解析并预检
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
                // 触发所有 store 重新加载
                const { triggerStoreReload } = await import("@/lib/sync/engine");
                triggerStoreReload();
                Alert.alert(
                  lang === "zh" ? "导入成功" : "Import Successful",
                  lang === "zh"
                    ? `已成功恢复 ${restored} 条数据${failed > 0 ? `，${failed} 条失败` : ""}。\n\n请重启 App 以确保所有界面刷新。`
                    : `Restored ${restored} entries${failed > 0 ? `, ${failed} failed` : ""}.\n\nPlease restart the app to refresh all screens.`,
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
        lang === "zh" ? "选择文件失败" : "File Selection Failed",
        e instanceof Error ? e.message : String(e),
      );
    }
  };


  const syncStatusText = !isAuthenticated
    ? t("sync.off")
    : syncState.syncing
      ? t("sync.syncing")
      : syncState.error
        ? t("sync.error")
        : t("sync.on");

  const stats = [
    { key: "recipes", label: t("me.stats.recipes"), value: recipes.length },
    { key: "bottles", label: t("me.stats.bottles"), value: bottles.length },
    { key: "preps", label: t("me.stats.preps"), value: preps.length },
  ];

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 90 + insets.bottom }}>
        {/* 大标题 */}
        <View className="px-5 pt-4 pb-4">
          <Text style={{ fontSize: 34, fontWeight: "700", lineHeight: 41, color: colors.foreground }}>{t("me.title")}</Text>
          <Text className="text-sm text-muted mt-1">{t("me.subtitle")}</Text>
        </View>

        {/* 数据总览 */}
        <View className="px-5 pb-4">
          <View className="flex-row bg-surface rounded-2xl border border-border overflow-hidden">
            {stats.map((s, i) => (
              <View
                key={s.key}
                className="flex-1 items-center py-4"
                style={i > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border } : undefined}
              >
                <Text className="text-2xl font-bold text-foreground">{s.value}</Text>
                <Text className="text-xs text-muted mt-1">{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 功能入口 */}
        <View className="px-5 pb-4">
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            <Pressable
              onPress={() => { tap(); router.push("/tags"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
                <IconSymbol name="tag.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.tags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.tags.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => { tap(); router.push("/bulk-import"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#34C759" }]}>
                <IconSymbol name="square.and.arrow.down.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.import")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.import.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => { tap(); router.push("/taxonomy-manager"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#AF52DE" }]}>
                <IconSymbol name="tray.2.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.taxonomy")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.taxonomy.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => { tap(); router.push("/system-tags"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#00C7BE" }]}>
                <IconSymbol name="tag.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.systemTags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.systemTags.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => { tap(); router.push("/card-tag-settings"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
                <IconSymbol name="rectangle.3.group.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.cardTags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.cardTags.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => { tap(); router.push("/book-import"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
                <IconSymbol name="book.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.bookImport")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.bookImport.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => { tap(); router.push("/ice-settings"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#5AC8FA" }]}>
                <IconSymbol name="snowflake" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.ice")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.ice.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </View>

        {/* 数据管理 & 设备同步 */}
        <View className="px-5 pb-4">
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            {/* 数据管理入口 */}
            <Pressable
              onPress={() => { tap(); router.push("/data-manager"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF6B35" }]}>
                <IconSymbol name="externaldrive.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.dataManager")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.dataManager.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {/* 云端同步状态行 */}
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: "#0A84FF" }]}>
                <IconSymbol name="icloud.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {isAuthenticated && user?.name ? user.name : t("sync.title")}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {syncStatusText}
                </Text>
              </View>
            </View>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {isAuthenticated ? (
              <>
                {/* 已登录：设备管理 */}
                <Pressable
                  onPress={() => { tap(); router.push("/device-manager"); }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: "#5856D6" }]}>
                    <IconSymbol name="laptopcomputer.and.iphone" size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} className="text-foreground">
                      {lang === "zh" ? "设备管理" : "Device Manager"}
                    </Text>
                    <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                      {lang === "zh" ? "管理同步设备、邀请新设备加入" : "Manage sync devices, invite new ones"}
                    </Text>
                  </View>
                  <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                </Pressable>
              </>
            ) : (
              <>
                {/* 未登录：创建同步组 */}
                <Pressable
                  onPress={() => { tap(); router.push("/device-manager"); }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: "#5856D6" }]}>
                    <IconSymbol name="plus.circle.fill" size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} className="text-foreground">
                      {lang === "zh" ? "创建同步组" : "Create Sync Group"}
                    </Text>
                    <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                      {lang === "zh" ? "成为主设备，生成配对码邀请其他设备" : "Become owner, generate pair code"}
                    </Text>
                  </View>
                  <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                </Pressable>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
                {/* 未登录：加入设备组 */}
                <Pressable
                  onPress={() => { tap(); router.push("/pair-device"); }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: "#34C759" }]}>
                    <IconSymbol name="paperplane.fill" size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} className="text-foreground">
                      {lang === "zh" ? "加入设备组" : "Join Device Group"}
                    </Text>
                    <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                      {lang === "zh" ? "输入配对码，与其他设备同步数据" : "Enter pair code to sync with other devices"}
                    </Text>
                  </View>
                  <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* 语言设置 */}
        {/* 数据备份与恢复 */}
        <View className="px-5 pb-4">
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            {/* 手动备份 */}
            <Pressable
              onPress={handleManualBackup}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
                <IconSymbol name="arrow.down.circle.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {lang === "zh" ? "立即备份" : "Backup Now"}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {backupTime
                    ? (lang === "zh" ? `上次备份：${new Date(backupTime).toLocaleString()}` : `Last: ${new Date(backupTime).toLocaleString()}`)
                    : (lang === "zh" ? "备份当前所有数据" : "Backup all current data")}
                </Text>
              </View>
            </Pressable>
            {backupTime != null && (
              <>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
                {/* 恢复备份 */}
                <Pressable
                  onPress={handleRestore}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                  disabled={restoring}
                >
                  <View style={[styles.iconWrap, { backgroundColor: "#FF3B30" }]}>
                    <IconSymbol name="arrow.counterclockwise.circle.fill" size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} className="text-foreground">
                      {restoring
                        ? (lang === "zh" ? "恢复中…" : "Restoring…")
                        : (lang === "zh" ? "恢复备份" : "Restore Backup")}
                    </Text>
                    <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                      {lang === "zh"
                        ? `恢复至 ${new Date(backupTime).toLocaleString()} 的快照`
                        : `Restore snapshot from ${new Date(backupTime).toLocaleString()}`}
                    </Text>
                  </View>
                </Pressable>
              </>
            )}
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {/* 同步日志 */}
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
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {lang === "zh" ? "查看每次同步的详细记录" : "View detailed sync history"}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {/* 导出备份文件 */}
            <Pressable
              onPress={handleExportFile}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#5856D6" }]}>
                <IconSymbol name="square.and.arrow.up.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {lang === "zh" ? "导出备份文件" : "Export Backup File"}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {lang === "zh" ? "将所有数据导出为 JSON 文件保存到本地" : "Export all data as JSON file to device"}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {/* 从文件导入备份 */}
            <Pressable
              onPress={handleImportFile}
              disabled={importing}
              style={({ pressed }) => [styles.row, (pressed || importing) && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9F0A" }]}>
                <IconSymbol name="square.and.arrow.down.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {importing
                    ? (lang === "zh" ? "导入中…" : "Importing…")
                    : (lang === "zh" ? "从文件导入备份" : "Import Backup File")}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {lang === "zh" ? "从 JSON 备份文件恢复数据，支持跨设备迁移" : "Restore from JSON backup, supports cross-device migration"}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {/* iCloud 自动备份 */}
            <Pressable
              onPress={handleICloudBackup}
              disabled={icloudBacking}
              style={({ pressed }) => [styles.row, (pressed || icloudBacking) && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#007AFF" }]}>
                <IconSymbol name="icloud.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {icloudBacking
                    ? (lang === "zh" ? "备份中…" : "Backing up…")
                    : (lang === "zh" ? "备份到 iCloud" : "Backup to iCloud")}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {icloudLastAt
                    ? (lang === "zh" ? `上次 iCloud 备份：${new Date(icloudLastAt).toLocaleString()}` : `Last iCloud backup: ${new Date(icloudLastAt).toLocaleString()}`)
                    : (lang === "zh" ? "自动保存到 iCloud Drive，7 个版本循环保留" : "Auto-saved to iCloud Drive, 7 rotating versions")}
                </Text>
              </View>
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {/* 从 iCloud 恢复 */}
            <Pressable
              onPress={handleICloudRestore}
              disabled={icloudRestoring}
              style={({ pressed }) => [styles.row, (pressed || icloudRestoring) && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#34C759" }]}>
                <IconSymbol name="icloud.and.arrow.down.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {icloudRestoring
                    ? (lang === "zh" ? "加载中…" : "Loading…")
                    : (lang === "zh" ? "从 iCloud 恢复" : "Restore from iCloud")}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {lang === "zh" ? "从 iCloud Drive 中选择历史版本恢复数据" : "Choose a version from iCloud Drive to restore"}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </View>

        <View className="px-5 pb-4">
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: "#5856D6" }]}>
                <IconSymbol name="globe" size={18} color="#FFFFFF" />
              </View>
              <Text style={[styles.rowTitle, { flex: 1 }]} className="text-foreground">{t("me.language")}</Text>
              <View style={{ flexDirection: "row", backgroundColor: colors.background, borderRadius: 8, padding: 2, gap: 2 }}>
                {(["zh", "en"] as const).map((l) => (
                  <Pressable
                    key={l}
                    onPress={() => { tap(); setLang(l); }}
                    style={[styles.langSeg, lang === l && { backgroundColor: colors.primary }]}
                  >
                    <Text style={[styles.langSegText, { color: lang === l ? "#FFFFFF" : colors.muted }]}>
                      {l === "zh" ? "中文" : "English"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  rowDesc: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  langSeg: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 7,
  },
  langSegText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
  },
});
