import { FlatList, StyleSheet, Text, View } from "react-native";
import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { getSyncLog, type SyncLogEntry } from "@/lib/sync/engine";
import { useSync } from "@/lib/cf-sync/provider";

function typeLabel(type: SyncLogEntry["type"], lang: string) {
  const map: Record<SyncLogEntry["type"], [string, string]> = {
    push:    ["上传", "Push"],
    pull:    ["下载", "Pull"],
    backup:  ["备份", "Backup"],
    restore: ["恢复", "Restore"],
    error:   ["错误", "Error"],
    conflict: ["冲突", "Conflict"],
  };
  return lang === "zh" ? map[type][0] : map[type][1];
}

function typeColor(type: SyncLogEntry["type"]) {
  return {
    push:    "#007AFF",
    pull:    "#34C759",
    backup:  "#FF9500",
    restore: "#FF3B30",
    error:   "#FF3B30",
    conflict: "#FF6B00",
  }[type];
}

export default function SyncLogScreen() {
  const colors = useColors();
  const { lang } = useI18n();
  const [log, setLog] = useState<SyncLogEntry[]>([]);
  const { dismissSyncError } = useSync();

  useEffect(() => {
    getSyncLog().then(setLog);
    // 用户进入同步日志页面，视为已知晓错误，清除红点角标
    dismissSyncError();
  }, [dismissSyncError]);

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <Stack.Screen options={{ title: lang === "zh" ? "同步日志" : "Sync Log", headerBackTitle: "" }} />
      {log.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted, fontSize: 15 }}>
            {lang === "zh" ? "暂无同步记录" : "No sync records yet"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={log}
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
