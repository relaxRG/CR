/**
 * 门店 Tab — 三大模块
 * 【当月月报】月报（月度总报表）/ 经营分析
 * 【运营】备用金 / 员工管理
 * 【库存管理】10 个品类进销存入口
 *
 * 注：【清单】已迁移至研发 Tab 并优先展示
 */
import React from "react";
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useSync } from "@/lib/cf-sync/provider";
import { IconSymbol } from "@/components/ui/icon-symbol";
import StorePettyCashScreen from "@/components/store/petty-cash";
import StoreAnalyticsScreen from "@/components/store/analytics";
import StoreInventoryScreen from "@/components/store/inventory";
import StoreReportScreen from "@/components/store/report";
import LaborScreen from "@/app/labor";

type MainTab = "monthly" | "operations" | "inventory";
type MonthlyTab = "summary" | "analytics";
type OperationsTab = "petty" | "labor";

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "monthly",    label: "当月月报" },
  { key: "operations", label: "运营" },
  { key: "inventory",  label: "库存管理" },
];

const MONTHLY_TABS: { key: MonthlyTab; label: string }[] = [
  { key: "summary",   label: `${new Date().getMonth() + 1}月报表` },
  { key: "analytics", label: "经营分析" },
];

const OPERATIONS_TABS: { key: OperationsTab; label: string }[] = [
  { key: "petty", label: "备用金" },
  { key: "labor", label: "员工管理" },
];

// ── 当月月报模块 ──────────────────────────────────────────────────────────────
function MonthlyModule({ insets }: { insets: any }) {
  const colors = useColors();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [monthlyTab, setMonthlyTab] = usePersistedState<MonthlyTab>("store.monthly.tab.v1", "summary");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {MONTHLY_TABS.map((t) => {
          const active = monthlyTab === t.key;
          return (
            <Pressable key={t.key} onPress={() => { tap(); setMonthlyTab(t.key); }}
              style={[S.subChip, {
                backgroundColor: active ? colors.primary : colors.surface,
                borderColor: active ? colors.primary : colors.border,
              }]}>
              <Text style={[S.subChipText, {
                color: active ? "#fff" : colors.foreground,
                fontWeight: active ? "600" : "400",
              }]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {monthlyTab === "summary" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StoreReportScreen />
        </SafeAreaInsetsContext.Provider>
      )}
      {monthlyTab === "analytics" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StoreAnalyticsScreen />
        </SafeAreaInsetsContext.Provider>
      )}
    </View>
  );
}

// ── 运营模块 ──────────────────────────────────────────────────────────────────
function OperationsModule({ insets }: { insets: any }) {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [opsTab, setOpsTab] = usePersistedState<OperationsTab>("store.ops.tab.v1", "petty");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {OPERATIONS_TABS.map((t) => {
          const active = opsTab === t.key;
          return (
            <Pressable key={t.key} onPress={() => { tap(); setOpsTab(t.key); }}
              style={[S.subChip, {
                backgroundColor: active ? colors.primary : colors.surface,
                borderColor: active ? colors.primary : colors.border,
              }]}>
              <Text style={[S.subChipText, {
                color: active ? "#fff" : colors.foreground,
                fontWeight: active ? "600" : "400",
              }]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {opsTab === "petty" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StorePettyCashScreen />
        </SafeAreaInsetsContext.Provider>
      )}
      {opsTab === "labor" && (
        <View style={{ flex: 1 }}>
          <LaborScreen embedded />
        </View>
      )}
    </View>
  );
}

// ── 门店主屏 ──────────────────────────────────────────────────────────────────
export default function StoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mainTab, setMainTab] = usePersistedState<MainTab>("store.main.tab.v2", "monthly");
  const { syncState } = useSync();
  const hasSyncBadge = !!syncState.error;
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const childInsets = { ...insets, top: 0 };
  const mainTitle = MAIN_TABS.find((t) => t.key === mainTab)?.label ?? "门店";

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[S.header, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 10 }}>
          <Text style={[S.title, { color: colors.foreground }]}>{mainTitle}</Text>
          <Pressable onPress={() => { tap(); router.push("/me"); }}
            style={({ pressed }) => [S.meBtn, { opacity: pressed ? 0.7 : 1 }]}>
            {hasSyncBadge && <View style={[S.syncDot, { backgroundColor: colors.error }]} />}
            <IconSymbol name="person.crop.circle" size={28} color={colors.primary} />
          </Pressable>
        </View>

        {/* 三大模块主 Tab（下划线风格） */}
        <View style={[S.mainTabRow, { borderBottomColor: colors.border }]}>
          {MAIN_TABS.map((t) => {
            const active = mainTab === t.key;
            return (
              <Pressable key={t.key} onPress={() => { tap(); setMainTab(t.key); }}
                style={[S.mainTabBtn, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
                <Text style={[S.mainTabText, {
                  color: active ? colors.primary : colors.muted,
                  fontWeight: active ? "700" : "400",
                }]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 内容区 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        {mainTab === "monthly"    && <MonthlyModule    insets={childInsets} />}
        {mainTab === "operations" && <OperationsModule insets={childInsets} />}
        {mainTab === "inventory"  && <StoreInventoryScreen />}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const S = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 0 },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41, letterSpacing: 0.3 },
  meBtn: { position: "relative", marginBottom: 10 },
  syncDot: { position: "absolute", top: 0, right: 0, width: 8, height: 8, borderRadius: 4, zIndex: 1 },
  mainTabRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  mainTabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  mainTabText: { fontSize: 16 },
  subChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  subChipText: { fontSize: 14, lineHeight: 20 },
  entryIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  hidden: { display: "none" },
});
