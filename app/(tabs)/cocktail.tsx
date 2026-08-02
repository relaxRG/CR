/**
 * 鸡尾酒 Tab（酒单 + 酒库 + 自制库）
 * 顶部：大标题 + iOS Segmented（酒单/酒库/自制库）
 * 三个子视图始终挂载，用 display:none 切换可见性。
 */
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useRecipeStore } from "@/lib/recipes/store";
import BottlesScreen from "./bottles";
import HomemadeScreen from "./homemade";
import { RecipesScreen } from "./recipes";

type CocktailTab = "recipes" | "bottles" | "homemade";

export default function CocktailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = usePersistedState<CocktailTab>("cocktail.tab.v1", "recipes");

  const { recipes } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();

  const TABS: { key: CocktailTab; label: string }[] = [
    { key: "recipes", label: "酒单" },
    { key: "bottles", label: "酒库" },
    { key: "homemade", label: "自制库" },
  ];

  const handleSwitch = (key: CocktailTab) => {
    if (key === tab) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTab(key);
  };

  const title =
    tab === "recipes" ? "酒单"
    : tab === "bottles" ? "酒库"
    : "自制库";

  const subtitle =
    tab === "recipes"
      ? recipes.length > 0 ? `共 ${recipes.length} 份配方` : "记录属于你的每一杯"
      : tab === "bottles"
        ? `${bottles.length} 款酒 · 名称、度数与参考价`
        : `${preps.length} 个自制原料 · 糖浆、利口酒与自制酒`;

  const childInsets = { ...insets, top: 0 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={1}>{subtitle}</Text>
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
                <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <SafeAreaInsetsContext.Provider value={childInsets}>
        <View style={[{ flex: 1 }, tab !== "recipes" && styles.hidden]}>
          <RecipesScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "bottles" && styles.hidden]}>
          <BottlesScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "homemade" && styles.hidden]}>
          <HomemadeScreen />
        </View>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41, letterSpacing: 0.3 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 2, marginBottom: 10 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  hidden: { display: "none" },
});
