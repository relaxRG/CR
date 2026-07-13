import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useRecipeStore } from "@/lib/recipes/store";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useSync } from "@/lib/sync/provider";

/** 所有需要清除的本地数据 key */
const ALL_DATA_KEYS = [
  // 配方
  "cocktail.recipes", "cocktail.categories", "cocktail.seeded",
  "cocktail.tags", "cocktail.tagGroups", "cocktail_waldorf_imported_v1",
  // 酒款
  "cocktail.bottles", "cocktail.bottles.seeded", "cocktail.bottles.waldorf.v1",
  "bottles.material.migrated.v8", "bottles.material.migrated.v9",
  "bottles.taxonomy.categories.v1", "bottles.taxonomy.styles.v1",
  // 自制
  "homemade.preps.v1", "homemade.seeded.v1", "homemade.sections.v1",
  "homemade.types.v1", "homemade.taxonomy.v2",
  "homemade.waldorf.v1", "homemade.waldorf.v2", "homemade.source.v3",
  // 实验室
  "cocktail.lab.projects", "cocktail.lab.batches",
  // 书籍
  "cocktail.books.v1",
  // 菜单 / 购物 / 冰块 / 卡片设置
  "menu_store_v1", "shopping_store_v1",
  "cocktail.iceSettings.v2", "card.tag.settings.v2",
  // 同步时间戳（前缀 sync.ts.）
  ...["cocktail.recipes","cocktail.categories","cocktail.tags","cocktail.tagGroups",
    "cocktail.seeded","cocktail_waldorf_imported_v1","cocktail.bottles",
    "cocktail.bottles.seeded","cocktail.bottles.waldorf.v1","homemade.preps.v1",
    "homemade.seeded.v1","homemade.sections.v1","homemade.types.v1",
    "homemade.taxonomy.v2","homemade.waldorf.v1","bottles.taxonomy.categories.v1",
    "bottles.taxonomy.styles.v1","cocktail.lab.projects","cocktail.lab.batches",
    "app.lang.v1","cocktail.books.v1","menu_store_v1","shopping_store_v1",
    "cocktail.iceSettings.v2",
  ].map((k) => `sync.ts.${k}`),
  "sync.lastPulledAt",
];

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

  const handleClearData = () => {
    tap();
    const doDelete = async () => {
      await AsyncStorage.multiRemove(ALL_DATA_KEYS);
      Alert.alert(t("me.clearData.success"));
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(t("me.clearData.confirm.message"))) {
        void doDelete();
      }
    } else {
      Alert.alert(
        t("me.clearData.confirm.title"),
        t("me.clearData.confirm.message"),
        [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("me.clearData.confirm.button"), style: "destructive", onPress: () => void doDelete() },
        ],
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
              onPress={() => {
                tap();
                router.push("/tags");
              }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.primary }]}>
                <IconSymbol name="tag.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.tags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {t("me.tags.desc")}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => {
                tap();
                router.push("/bulk-import");
              }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#34C759" }]}>
                <IconSymbol name="square.and.arrow.down.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.import")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {t("me.import.desc")}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => {
                tap();
                router.push("/card-tag-settings");
              }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
                <IconSymbol name="rectangle.3.group.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.cardTags")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {t("me.cardTags.desc")}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => {
                tap();
                router.push("/book-import");
              }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#FF9500" }]}>
                <IconSymbol name="book.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.bookImport")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {t("me.bookImport.desc")}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
            <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 64 }} />
            <Pressable
              onPress={() => {
                tap();
                router.push("/ice-settings");
              }}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: "#5AC8FA" }]}>
                <IconSymbol name="snowflake" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} className="text-foreground">{t("me.ice")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {t("me.ice.desc")}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </View>

        {/* 语言设置 */}
        <View className="px-5 pb-4">
          {/* 清除所有数据 */}
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden", marginBottom: 16 }}>
            <Pressable
              onPress={handleClearData}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: colors.error }]}>
                <IconSymbol name="trash.fill" size={18} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.error }]}>{t("me.clearData")}</Text>
                <Text style={styles.rowDesc} className="text-muted" numberOfLines={1}>
                  {t("me.clearData.desc")}
                </Text>
              </View>
            </Pressable>
          </View>
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
                    onPress={() => {
                      tap();
                      setLang(l);
                    }}
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
