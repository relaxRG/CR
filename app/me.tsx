/**
 * 「我的」独立页面（从门店 Tab 顶部入口进入）
 * 保留原有全部功能：数据总览、标签管理、备份、设备同步
 */
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useRecipeStore } from "@/lib/recipes/store";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useSync } from "@/lib/cf-sync/provider";
import React, { useEffect, useState } from "react";
import { getICloudMeta } from "@/lib/backup/icloud-backup";

export default function MePage() {
  const colors = useColors();
  const router = useRouter();
  const { recipes } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const { syncState, isAuthenticated, user, deviceRole } = useSync();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const [icloudLastAt, setIcloudLastAt] = useState<number | null>(null);
  useEffect(() => {
    getICloudMeta().then((meta) => setIcloudLastAt(meta.lastBackupAt));
  }, [syncState.lastSyncedAt]);

  const stats = [
    { key: "recipes", value: recipes.length, label: "配方" },
    { key: "bottles", value: bottles.length, label: "酒款" },
    { key: "preps", value: preps.length, label: "自制" },
  ];

  const syncStatusText = (() => {
    if (syncState.syncing) return "同步中…";
    if (syncState.error) return `同步失败：${syncState.error}`;
    if (syncState.lastSyncedAt) {
      const diff = Date.now() - syncState.lastSyncedAt;
      if (diff < 60000) return "刚刚同步";
      if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
      return `${Math.floor(diff / 3600000)} 小时前`;
    }
    return "尚未同步";
  })();

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>我的</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {/* 数据总览 */}
        <View className="px-5 pb-4">
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>鸡尾酒数据</Text>
          <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            {stats.map((s, i) => (
              <View
                key={s.key}
                style={[{ flex: 1, alignItems: "center", paddingVertical: 16 }, i > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border } : undefined]}
              >
                <Text style={{ fontSize: 24, fontWeight: "700", color: colors.foreground }}>{s.value}</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 功能入口 */}
        <View className="px-5 pb-4">
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>管理</Text>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            {[
              { label: "标签管理", desc: "配方、酒款的自定义标签", icon: "tag.fill", color: colors.primary, route: "/tags" },
              { label: "批量导入", desc: "批量导入配方与酒款数据", icon: "square.and.arrow.down.fill", color: "#34C759", route: "/bulk-import" },
              { label: "分类管理", desc: "烈酒风格与自制原料分类", icon: "tray.2.fill", color: "#AF52DE", route: "/taxonomy-manager" },
              { label: "系统标签", desc: "配方系统标签设置", icon: "tag.fill", color: "#00C7BE", route: "/system-tags" },
              { label: "卡片标签", desc: "自定义卡片显示标签", icon: "rectangle.3.group.fill", color: "#FF9500", route: "/card-tag-settings" },
              { label: "书籍导入", desc: "从 Apple Books 导入调酒书", icon: "book.fill", color: "#FF9500", route: "/book-import" },
              { label: "冰块设置", desc: "冰块类型与成本设置", icon: "snowflake", color: "#5AC8FA", route: "/ice-settings" },
            ].map((item, i, arr) => (
              <React.Fragment key={item.route}>
                <Pressable
                  onPress={() => { tap(); router.push(item.route as any); }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: item.color }]}>
                    <IconSymbol name={item.icon as any} size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>{item.label}</Text>
                    <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>{item.desc}</Text>
                  </View>
                  <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                </Pressable>
                {i < arr.length - 1 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />}
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* 数据管理 & 设备同步 */}
        <View className="px-5 pb-4">
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>数据与同步</Text>
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            <Pressable
              onPress={() => { tap(); router.push("/data-manager"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF6B35" }]}>
                <IconSymbol name="externaldrive.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>数据管理</Text>
                <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>导入导出、重置数据</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: "#0A84FF" }]}>
                <IconSymbol name="icloud.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>
                  {isAuthenticated && user?.name ? user.name : "云端同步"}
                </Text>
                <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>{syncStatusText}</Text>
              </View>
            </View>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {isAuthenticated ? (
              <Pressable
                onPress={() => { tap(); router.push("/device-manager"); }}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.iconWrap, { backgroundColor: "#5856D6" }]}>
                  <IconSymbol name="laptopcomputer.and.iphone" size={18} color="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>设备管理</Text>
                  <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>管理同步设备、邀请新设备加入</Text>
                </View>
                <IconSymbol name="chevron.right" size={18} color={colors.muted} />
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={() => { tap(); router.push("/device-manager"); }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: "#5856D6" }]}>
                    <IconSymbol name="plus.circle.fill" size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>创建同步组</Text>
                    <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>成为主设备，生成配对码邀请其他设备</Text>
                  </View>
                  <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                </Pressable>
                <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
                <Pressable
                  onPress={() => { tap(); router.push("/pair-device"); }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <View style={[styles.iconWrap, { backgroundColor: "#34C759" }]}>
                    <IconSymbol name="paperplane.fill" size={18} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.foreground }]}>加入设备组</Text>
                    <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>输入配对码，与其他设备同步数据</Text>
                  </View>
                  <IconSymbol name="chevron.right" size={18} color={colors.muted} />
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* 数据备份 */}
        <View className="px-5 pb-4">
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            <Pressable
              onPress={() => { tap(); router.push("/backup"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
                <IconSymbol name="externaldrive.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.foreground }]}>数据备份</Text>
                <Text style={[styles.rowDesc, { color: colors.muted }]} numberOfLines={1}>
                  {icloudLastAt
                    ? `上次 iCloud 备份：${new Date(icloudLastAt).toLocaleString()}`
                    : "备份、恢复与导入导出"}
                </Text>
              </View>
              {icloudLastAt ? (
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: Date.now() - icloudLastAt < 86400000 ? "#34C759" : "#FF9F0A", marginRight: 6 }} />
              ) : null}
              <IconSymbol name="chevron.right" size={16} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  navTitle: { fontSize: 17, fontWeight: "600", marginLeft: 8 },
  sectionTitle: { fontSize: 13, fontWeight: "500", marginBottom: 8, marginLeft: 4 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  rowDesc: { fontSize: 12, lineHeight: 17, marginTop: 2 },
});

