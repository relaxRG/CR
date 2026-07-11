/**
 * 酒单 Tab 主容器
 * 大标题 + iOS 原生 pill 主切换器（酒单 / 研发 / 门店酒单）
 * 三个子页面始终挂载（保留筛选/滚动状态），用 display:none 切换可见性。
 */
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useRecipeStore } from "@/lib/recipes/store";
import { useLabStore } from "@/lib/lab/store";
import { useMenuStore } from "@/lib/menu/store";
import { RecipesScreen } from "./recipes";
import { LabIndexScreen } from "../lab/index";
import MenuScreen from "./menu";

type RecipesTab = "recipes" | "lab" | "menu";

export default function RecipesTabScreen() {
  const colors = useColors();
  const { lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = usePersistedState<RecipesTab>("recipes.tab.v1", "recipes");

  // 副标题数量
  const { recipes } = useRecipeStore();
  const { projects } = useLabStore();
  const { groups } = useMenuStore();
  const menuEntries = groups.reduce((sum, g) => sum + g.entries.length, 0);

  const TABS: { key: RecipesTab; zh: string; en: string }[] = [
    { key: "recipes", zh: "酒单", en: "Recipes" },
    { key: "lab", zh: "研发", en: "R&D" },
    { key: "menu", zh: "门店酒单", en: "Menu" },
  ];

  const handleSwitch = (key: RecipesTab) => {
    if (key === tab) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTab(key);
  };

  // 副标题
  const subtitle =
    tab === "recipes"
      ? lang === "en"
        ? recipes.length > 0 ? `${recipes.length} recipes` : "Record every drink you make"
        : recipes.length > 0 ? `共 ${recipes.length} 份配方` : "记录属于你的每一杯"
      : tab === "lab"
        ? lang === "en"
          ? projects.length > 0 ? `${projects.length} projects in progress` : "Experiment and iterate"
          : projects.length > 0 ? `${projects.length} 个研发项目` : "实验与迭代"
        : lang === "en"
          ? menuEntries > 0 ? `${menuEntries} drinks · ${groups.length} groups` : "Create menu groups for your bar"
          : menuEntries > 0 ? `${menuEntries} 款酒 · ${groups.length} 个分组` : "为门店创建酒单分组";

  // 大标题
  const title =
    tab === "recipes"
      ? lang === "en" ? "Recipes" : "酒单"
      : tab === "lab"
        ? lang === "en" ? "R&D Lab" : "研发"
        : lang === "en" ? "Store Menu" : "门店酒单";

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
      </View>

      {/* 子屏：始终挂载，display:none 切换 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        <View style={[{ flex: 1 }, tab !== "recipes" && styles.hidden]}>
          <RecipesScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "lab" && styles.hidden]}>
          <LabIndexScreen embedded />
        </View>
        <View style={[{ flex: 1 }, tab !== "menu" && styles.hidden]}>
          <MenuScreen />
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
  title: {
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 36,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    marginBottom: 10,
  },
  segContainer: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segItem: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segText: {
    fontSize: 14,
    lineHeight: 19,
  },
  hidden: {
    display: "none",
  },
});
