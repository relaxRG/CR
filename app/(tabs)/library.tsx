/**
 * 酒库 + 自制一体化标签页
 * 顶部：大标题 + iOS 原生 Segmented（酒库/自制库）
 * 下方：各子页面保留自己的二级分组切换器
 * 两个子视图始终挂载（保留筛选/滚动状态），用 display:none 切换可见性。
 */
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import BottlesScreen from "./bottles";
import HomemadeScreen from "./homemade";

type LibTab = "bottles" | "homemade";

export default function LibraryScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = usePersistedState<LibTab>("library.tab.v1", "bottles");

  // 酒库数量
  const { bottles } = useBottleStore();
  const bottleCount = bottles.length;

  // 自制库数量
  const { preps } = useHomemadeStore();
  const prepCount = preps.length;

  const TABS: { key: LibTab; zh: string; en: string }[] = [
    { key: "bottles", zh: "酒库", en: "Bar" },
    { key: "homemade", zh: "自制库", en: "Homemade" },
  ];

  const handleSwitch = (key: LibTab) => {
    if (key === tab) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTab(key);
  };

  // 副标题
  const subtitle =
    tab === "bottles"
      ? lang === "en"
        ? `${bottleCount} bottles · names, ABV & prices`
        : `${bottleCount} 款酒 · 中英文名、度数与参考价`
      : lang === "en"
        ? `${prepCount} homemade preps · syrups, liqueurs & more`
        : `${prepCount} 个自制原料 · 糖浆、利口酒、风味液体与自制酒`;

  // 大标题
  const title =
    tab === "bottles"
      ? lang === "en" ? "Bar" : "酒库"
      : lang === "en" ? "Homemade Lab" : "自制库";

  // Override top inset to 0 for child screens — this screen manages the safe-area top itself
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

        {/* 主切换器：iOS 原生 Segmented 风格（灰色容器 + 白色 pill 选中） */}
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

      {/* 子屏：用 SafeAreaInsetsContext.Provider 覆盖 top=0，避免双重 safe-area */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
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
