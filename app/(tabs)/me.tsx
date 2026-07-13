import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useRecipeStore } from "@/lib/recipes/store";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useSync } from "@/lib/sync/provider";

/** "我的"个人中心页:数据总览、标签管理与批量导入入口、语言设置 */
export default function MeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const { recipes } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const { syncState, isAuthenticated, user, login, logout } = useSync();

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const syncStatusText = !isAuthenticated
    ? t("sync.off")
    : syncState.syncing
      ? t("sync.syncing")
      : syncState.error
        ? t("sync.error")
        : t("sync.on");

  const handleAccountPress = () => {
    tap();
    if (!isAuthenticated) {
      login();
      return;
    }
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(`${t("sync.logout")}?`)) {
        void logout();
      }
    } else {
      Alert.alert(t("sync.logout"), user?.email ?? "", [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("sync.logout"), style: "destructive", onPress: () => void logout() },
      ]);
    }
  };

  const stats = [
    { key: "recipes", label: t("me.stats.recipes"), value: recipes.length },
    { key: "bottles", label: t("me.stats.bottles"), value: bottles.length },
    { key: "preps", label: t("me.stats.preps"), value: preps.length },
  ];

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View className="px-5 pt-4 pb-4">
          <Text style={{ fontSize: 34, fontWeight: "700", lineHeight: 41, color: colors.foreground }}>{t("me.title")}</Text>
          <Text className="text-sm text-muted mt-1">{t("me.subtitle")}</Text>
        </View>

        {/* 云端同步账号 */}
        <View className="px-5 pb-4">
          <Pressable
            onPress={handleAccountPress}
            style={({ pressed }) => [pressed && { opacity: 0.7 }]}
          >
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden" }}>
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
                <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>
                  {isAuthenticated ? t("sync.logout") : t("sync.login")}
                </Text>
              </View>
            </View>
          </Pressable>
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

        {/* 数据管理 & 语言设置 */}
        <View className="px-5 pb-4">
          {/* 数据管理入口 */}
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden", marginBottom: 16 }}>
            <Pressable
              onPress={() => { tap(); router.push("/data-manager"); }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#0EA5E9" }]}>
                <IconSymbol name="externaldrive.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.dataManager")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>{t("me.dataManager.desc")}</Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
          </View>
          {/* 语言切换 */}
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
