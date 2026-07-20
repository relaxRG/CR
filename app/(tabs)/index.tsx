/**
 * 研发 Tab 主容器（原酒单 Tab，酒单已迁移至资料库 Tab）
 * 大标题 + iOS 原生 pill 主切换器（研发 / 门店）
 * 两个子页面始终挂载（保留筛选/滚动状态），用 display:none 切换可见性。
 * 门店分区内部再有 门店酒单 / 采购清单 两个子切换器。
 */
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useLabStore } from "@/lib/lab/store";
import { useMenuStore } from "@/lib/menu/store";
import { LabIndexScreen } from "../lab/index";
import MenuScreen from "./menu";
import ShoppingScreen from "./shopping";

type RecipesTab = "lab" | "menu";
type StoreSubTab = "menu" | "shopping";

export default function RecipesTabScreen() {
  const colors = useColors();
  const { lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = usePersistedState<RecipesTab>("recipes.tab.v2", "lab");
  const [storeSubTab, setStoreSubTab] = usePersistedState<StoreSubTab>("store.subtab.v1", "menu");

  // 副标题数量
  const { projects } = useLabStore();
  const { groups, ungroupedEntries } = useMenuStore();
  const menuEntries = groups.reduce((sum, g) => sum + g.entries.length, 0) + ungroupedEntries.length;
  const onSaleCount = [
    ...groups.flatMap((g) => g.entries),
    ...ungroupedEntries,
  ].filter((e) => e.available).length;

  const TABS: { key: RecipesTab; zh: string; en: string }[] = [
    { key: "lab", zh: "研发", en: "R&D" },
    { key: "menu", zh: "门店", en: "Store" },
  ];

  const handleSwitch = (key: RecipesTab) => {
    if (key === tab) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTab(key);
  };

  const handleStoreSubSwitch = (key: StoreSubTab) => {
    if (key === storeSubTab) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStoreSubTab(key);
  };

  // 副标题
  const subtitle =
    tab === "lab"
      ? lang === "en"
        ? projects.length > 0 ? `${projects.length} projects in progress` : "Experiment and iterate"
        : projects.length > 0 ? `${projects.length} 个研发项目` : "实验与迭代"
      : lang === "en"
        ? menuEntries > 0 ? `${onSaleCount} on sale · ${menuEntries} total` : "Set up your store menu"
        : menuEntries > 0 ? `在售 ${onSaleCount} 款 · 共 ${menuEntries} 款` : "设置门店酒单";

  // 大标题
  const title =
    tab === "lab"
      ? lang === "en" ? "R&D Lab" : "研发"
      : lang === "en" ? "Store" : "门店";

  // Override top inset to 0 for child screens
  const childInsets = { ...insets, top: 0 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 顶部安全区 + 大标题 + 主切换器 */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 10, backgroundColor: colors.background },
        ]}
      >
        {/* 大标题 */}
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={1}>
          {subtitle}
        </Text>
        {/* 主切换器：iOS 原生 Segmented 风格 */}
        <View style={[styles.segContainer, { backgroundColor: colors.border + "55" }]}>
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => handleSwitch(item.key)}
                style={[
                  styles.segItem,
                  active && {
                    backgroundColor: colors.background,
                    shadowColor: "#000",
                    shadowOpacity: 0.1,
                    shadowRadius: 3,
                    shadowOffset: { width: 0, height: 1 },
                    elevation: 2,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.segText,
                    {
                      color: active ? colors.foreground : colors.muted,
                      fontWeight: active ? "600" : "400",
                    },
                  ]}
                >
                  {lang === "en" ? item.en : item.zh}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {/* 门店内部子切换器 */}
        {tab === "menu" && (
          <View style={[styles.subSegContainer, { backgroundColor: colors.border + "33" }]}>
            {(["menu", "shopping"] as StoreSubTab[]).map((key) => {
              const label = key === "menu"
                ? (lang === "en" ? "Menu" : "门店酒单")
                : (lang === "en" ? "Shopping" : "采购清单");
              const active = storeSubTab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => handleStoreSubSwitch(key)}
                  style={[
                    styles.subSegItem,
                    active && {
                      backgroundColor: colors.background,
                      shadowColor: "#000",
                      shadowOpacity: 0.08,
                      shadowRadius: 2,
                      shadowOffset: { width: 0, height: 1 },
                      elevation: 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.subSegText,
                      {
                        color: active ? colors.foreground : colors.muted,
                        fontWeight: active ? "600" : "400",
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* 子屏：始终挂载，display:none 切换 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        <View style={[{ flex: 1 }, tab !== "lab" && styles.hidden]}>
          <LabIndexScreen embedded />
        </View>
        {/* 门店分区：两个子页面 */}
        <View style={[{ flex: 1 }, tab !== "menu" && styles.hidden]}>
          <View style={[{ flex: 1 }, storeSubTab !== "menu" && styles.hidden]}>
            <MenuScreen />
          </View>
          <View style={[{ flex: 1 }, storeSubTab !== "shopping" && styles.hidden]}>
            <ShoppingScreen />
          </View>
        </View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  subSegContainer: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 2,
    gap: 2,
    marginTop: 6,
  },
  subSegItem: {
    flex: 1,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  subSegText: {
    fontSize: 13,
    lineHeight: 18,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    lineHeight: 41,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    marginBottom: 12,
  },
  segContainer: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segItem: {
    flex: 1,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segText: {
    fontSize: 13,
    lineHeight: 19,
  },
  hidden: {
    display: "none",
  },
});
