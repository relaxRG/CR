/**
 * 研发 Tab（计划清单 / 研发计划 / 书库）
 */
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useLabStore } from "@/lib/lab/store";
import { useLabPlanStore } from "@/lib/lab/plan-store";
import { LabIndexScreen } from "../lab/index";
import BooksScreen from "./books";
import LabPlanScreen from "../lab/plan";

type LabTab = "plan" | "rd" | "books";

const TABS: { key: LabTab; label: string }[] = [
  { key: "plan", label: "计划清单" },
  { key: "rd", label: "研发计划" },
  { key: "books", label: "书库" },
];

export default function LabScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = usePersistedState<LabTab>("lab.tab.v1", "plan");
  const { projects } = useLabStore();
  const { items } = useLabPlanStore();

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const title =
    tab === "plan" ? "计划清单"
    : tab === "rd" ? "研发计划"
    : "书库";

  const subtitle =
    tab === "plan"
      ? items.length > 0 ? `${items.filter((i) => i.status === "pending").length} 项待处理 · 共 ${items.length} 项` : "规划下一步研发方向"
      : tab === "rd"
        ? projects.length > 0 ? `${projects.length} 个研发项目` : "实验与迭代"
        : "调酒参考书库";

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
                onPress={() => { tap(); setTab(item.key); }}
                style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}
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
        <View style={[{ flex: 1 }, tab !== "plan" && styles.hidden]}>
          <LabPlanScreen />
        </View>
        <View style={[{ flex: 1 }, tab !== "rd" && styles.hidden]}>
          <LabIndexScreen embedded />
        </View>
        <View style={[{ flex: 1 }, tab !== "books" && styles.hidden]}>
          <BooksScreen />
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

