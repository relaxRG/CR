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
import { getICloudMeta } from "@/lib/backup/icloud-backup";

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

  const [icloudLastAt, setIcloudLastAt] = useState<number | null>(null);

  useEffect(() => {
    getICloudMeta().then((meta) => setIcloudLastAt(meta.lastBackupAt));
  }, [syncState.lastSyncedAt]);

  // 数据总览
  const stats = [
    { key: "recipes", value: recipes.length, label: t("me.stats.recipes") },
    { key: "bottles", value: bottles.length, label: t("me.stats.bottles") },
    { key: "preps", value: preps.length, label: t("me.stats.preps") },
  ];

  // 同步状态文字
  const syncStatusText = (() => {
    if (syncState.syncing) return lang === "zh" ? "同步中…" : "Syncing…";
    if (syncState.error) return lang === "zh" ? `同步失败：${syncState.error}` : `Sync failed: ${syncState.error}`;
    if (syncState.lastSyncedAt) {
      const diff = Date.now() - syncState.lastSyncedAt;
      if (diff < 60000) return lang === "zh" ? "刚刚同步" : "Just synced";
      if (diff < 3600000) return lang === "zh" ? `${Math.floor(diff / 60000)} 分钟前` : `${Math.floor(diff / 60000)}m ago`;
      return lang === "zh" ? `${Math.floor(diff / 3600000)} 小时前` : `${Math.floor(diff / 3600000)}h ago`;
    }
    return lang === "zh" ? "尚未同步" : "Not synced yet";
  })();

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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.tags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.tags.desc")}</Text>
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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.import")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.import.desc")}</Text>
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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.taxonomy")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.taxonomy.desc")}</Text>
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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.systemTags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.systemTags.desc")}</Text>
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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.cardTags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.cardTags.desc")}</Text>
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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.bookImport")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.bookImport.desc")}</Text>
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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.ice")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.ice.desc")}</Text>
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
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.dataManager")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>{t("me.dataManager.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            {/* 云端同步状态行 */}
            <View style={styles.row}>
              <View style={[styles.iconWrap, { backgroundColor: "#0A84FF" }]}>
                <IconSymbol name="icloud.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {isAuthenticated && user?.name ? user.name : t("sync.title")}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>
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
                  <View style={styles.rowContent}>
                    <Text style={styles.rowTitle} className="text-foreground">
                      {lang === "zh" ? "设备管理" : "Device Manager"}
                    </Text>
                    <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>
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
                  <View style={styles.rowContent}>
                    <Text style={styles.rowTitle} className="text-foreground">
                      {lang === "zh" ? "创建同步组" : "Create Sync Group"}
                    </Text>
                    <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>
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
                  <View style={styles.rowContent}>
                    <Text style={styles.rowTitle} className="text-foreground">
                      {lang === "zh" ? "加入设备组" : "Join Device Group"}
                    </Text>
                    <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>
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
        {/* 数据备份与恢复（进入式） */}
        <View className="px-5 pb-4">
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
            <Pressable
              onPress={() => { tap(); router.push("/backup"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
                <IconSymbol name="externaldrive.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={styles.rowContent}>
                <Text style={styles.rowTitle} className="text-foreground">
                  {lang === "zh" ? "数据备份" : "Data Backup"}
                </Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={2}>
                  {icloudLastAt
                    ? (lang === "zh" ? `上次 iCloud 备份：${new Date(icloudLastAt).toLocaleString()}` : `Last iCloud backup: ${new Date(icloudLastAt).toLocaleString()}`)
                    : (lang === "zh" ? "备份、恢复与导入导出" : "Backup, restore, import & export")}
                </Text>
              </View>
              {/* iCloud 新鲜度角标 */}
              {icloudLastAt ? (
                <View style={{
                  width: 10, height: 10, borderRadius: 5,
                  backgroundColor: Date.now() - icloudLastAt < 24 * 60 * 60 * 1000 ? "#34C759" : "#FF9F0A",
                  marginRight: 6,
                }} />
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
  rowContent: {
    flex: 1,
    minWidth: 0,
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
