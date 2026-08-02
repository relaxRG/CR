import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { Stack } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { getSyncLog, type SyncLogEntry } from "@/lib/sync/engine";
import { useSync } from "@/lib/cf-sync/provider";

type FilterKey = "all" | "error" | "conflict" | "backup" | "push" | "pull";

function typeLabel(type: SyncLogEntry["type"], lang: string) {
  const map: Record<SyncLogEntry["type"], [string, string]> = {
    push:     ["上传", "Push"],
    pull:     ["下载", "Pull"],
    backup:   ["备份", "Backup"],
    restore:  ["恢复", "Restore"],
    error:    ["错误", "Error"],
    conflict: ["冲突", "Conflict"],
  };
  return lang === "zh" ? map[type][0] : map[type][1];
}

function typeColor(type: SyncLogEntry["type"]) {
  return {
    push:     "#007AFF",
    pull:     "#34C759",
    backup:   "#FF9500",
    restore:  "#FF3B30",
    error:    "#FF3B30",
    conflict: "#FF6B00",
  }[type];
}

export default function SyncLogScreen() {
  const colors = useColors();
  const { lang } = useI18n();
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const { dismissSyncError } = useSync();

  useEffect(() => {
    getSyncLog().then(setLog);
    // 用户进入同步日志页面，视为已知晓错误，清除红点角标
    dismissSyncError();
  }, [dismissSyncError]);

  const filteredLog = useMemo(() => {
    if (filter === "all") return log;
    return log.filter((e) => e.type === filter);
  }, [log, filter]);

  // 筛选 Chips 配置
  const chips: { key: FilterKey; zh: string; en: string; color: string }[] = [
    { key: "all",      zh: "全部",  en: "All",      color: colors.primary },
    { key: "error",    zh: "错误",  en: "Error",    color: "#FF3B30" },
    { key: "conflict", zh: "冲突",  en: "Conflict", color: "#FF6B00" },
    { key: "backup",   zh: "备份",  en: "Backup",   color: "#FF9500" },
    { key: "push",     zh: "上传",  en: "Push",     color: "#007AFF" },
    { key: "pull",     zh: "下载",  en: "Pull",     color: "#34C759" },
  ];

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: lang === "zh" ? "同步日志" : "Sync Log", headerBackTitle: "" }} />

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
        <FlatList
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
                <Text style={{ color: colors.foreground, fontSize: 14, marginTop: 4 }}>
                  {item.message}
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
