import { Alert, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { getSyncLog, subscribeSyncState, type SyncLogEntry } from "@/lib/sync/engine";
import { useSync } from "@/lib/cf-sync/provider";
import { MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";

type FilterKey = "all" | "error" | "conflict" | "backup" | "push" | "pull" | "diagnostic";

function typeLabel(type: SyncLogEntry["type"], lang: string) {
  const map: Record<SyncLogEntry["type"], [string, string]> = {
    push:     ["上传", "Push"],
    pull:     ["下载", "Pull"],
    backup:   ["备份", "Backup"],
    restore:  ["恢复", "Restore"],
    error:    ["错误", "Error"],
    conflict: ["冲突", "Conflict"],
    switch:   ["切换", "Switch"],
    diagnostic: ["诊断", "Diagnostic"],
  };
  return lang === "zh" ? map[type][0] : map[type][1];
}

function typeColor(type: SyncLogEntry["type"]) {
  const colors: Record<SyncLogEntry["type"], string> = {
    push:     "#007AFF",
    pull:     "#34C759",
    backup:   "#FF9500",
    restore:  "#FF3B30",
    error:    "#FF3B30",
    conflict: "#FF6B00",
    switch:   "#5856D6",
    diagnostic: "#AF52DE",
  };
  return colors[type];
}

export default function SyncLogScreen() {
  const colors = useColors();
  const { lang } = useI18n();
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const { dismissSyncError } = useSync();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    // ★ 初始加载
    getSyncLog().then(setLog);
    // ★ 订阅实时刷新：每次同步状态变化时自动更新日志
    const unsub = subscribeSyncState((s) => {
      if (s.log && s.log.length > 0) setLog(s.log);
    });
    // 用户进入同步日志页面，视为已知晓错误，清除红点角标
    dismissSyncError();
    return unsub;
  }, [dismissSyncError]);

  const filteredLog = useMemo(() => {
    if (filter === "all") return log;
    return log.filter((e) => e.type === filter);
  }, [log, filter]);

  const exportPayload = useMemo(() => JSON.stringify({
    exportedAt: new Date().toISOString(),
    note: "cocktail R runtime and sync diagnostics. No business records are included.",
    entries: log,
  }, null, 2), [log]);

  const copyLogs = async () => {
    try {
      await Clipboard.setStringAsync(exportPayload);
      Alert.alert(lang === "zh" ? "已复制日志" : "Logs copied", lang === "zh" ? "请将完整内容粘贴回对话。" : "Paste the complete content into the support conversation.");
    } catch (error) {
      Alert.alert(lang === "zh" ? "复制失败" : "Copy failed", error instanceof Error ? error.message : String(error));
    }
  };

  const shareLogs = async () => {
    if (Platform.OS === "web") {
      await copyLogs();
      return;
    }
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error(lang === "zh" ? "当前设备无法打开系统分享面板。" : "System sharing is unavailable on this device.");
      }
      const uri = `${FileSystem.cacheDirectory}cocktail-r-diagnostics-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(uri, exportPayload, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(uri, {
        dialogTitle: lang === "zh" ? "导出运行日志" : "Export runtime logs",
        mimeType: "application/json",
        UTI: "public.json",
      });
    } catch (error) {
      Alert.alert(lang === "zh" ? "导出失败" : "Export failed", error instanceof Error ? error.message : String(error));
    }
  };

  // 筛选 Chips 配置
  const chips: { key: FilterKey; zh: string; en: string; color: string }[] = [
    { key: "all",      zh: "全部",  en: "All",      color: colors.primary },
    { key: "error",    zh: "错误",  en: "Error",    color: "#FF3B30" },
    { key: "conflict", zh: "冲突",  en: "Conflict", color: "#FF6B00" },
    { key: "backup",   zh: "备份",  en: "Backup",   color: "#FF9500" },
    { key: "push",     zh: "上传",  en: "Push",     color: "#007AFF" },
    { key: "pull",     zh: "下载",  en: "Pull",     color: "#34C759" },
    { key: "diagnostic", zh: "诊断", en: "Diagnostic", color: "#AF52DE" },
  ];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      {/* 手动 header */}
      <View style={[styles.manualHeader, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={[styles.backText, { color: colors.primary }]}>
            {lang === "zh" ? "‹ 返回" : "‹ Back"}
          </Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          {lang === "zh" ? "同步与诊断日志" : "Sync & Diagnostics"}
        </Text>
        <View style={{ width: 64 }} />
      </View>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => void copyLogs()} style={[styles.actionButton, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.actionLabel, { color: colors.foreground }]}>{lang === "zh" ? "复制完整日志" : "Copy full log"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void shareLogs()} style={[styles.actionButton, { borderColor: colors.primary, backgroundColor: colors.primary }]}>
          <Text style={styles.shareLabel}>{lang === "zh" ? "导出文件" : "Export file"}</Text>
        </Pressable>
      </View>

      {/* 筛选 Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
        style={{ flexShrink: 0 }}
      >
        {chips.map((chip) => {
          const active = filter === chip.key;
          const count = chip.key === "all" ? log.length : log.filter((e) => e.type === chip.key).length;
          return (
            <Pressable
              key={chip.key}
              onPress={() => setFilter(chip.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? chip.color : colors.surface,
                  borderColor: active ? chip.color : colors.border,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                {lang === "zh" ? chip.zh : chip.en}
                {count > 0 ? `  ${count}` : ""}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {filteredLog.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>
            {lang === "zh" ? "暂无相关记录" : "No matching records"}
          </Text>
        </View>
      ) : (
        <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
          data={filteredLog}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.header}>
                <View style={[styles.badge, { backgroundColor: typeColor(item.type) }]}>
                  <Text style={styles.badgeText}>{typeLabel(item.type, lang)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12 }}>
                  {new Date(item.time).toLocaleString()}
                </Text>
              </View>
              {item.message ? (
                <Text selectable style={{ color: colors.foreground, fontSize: 14, marginTop: 4 }}>
                  {item.message}
                </Text>
              ) : null}
              {item.source ? (
                <Text selectable style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                  {item.source}
                </Text>
              ) : null}
              {item.detail ? (
                <Text selectable style={{ color: colors.muted, fontFamily: "monospace", fontSize: 11, lineHeight: 16, marginTop: 8 }}>
                  {item.detail}
                </Text>
              ) : null}
              {item.keys && item.keys.length > 0 ? (
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                  {item.keys.join("  ·  ")}
                </Text>
              ) : null}
            </View>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  manualHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  backBtn: {
    width: 64,
    paddingVertical: 4,
  },
  backText: {
    fontSize: 17,
    fontWeight: "400",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  actionButton: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  shareLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
  },
  chip: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
  },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
