/**
 * 门店 Tab — 四大顶级模块
 * 【报表】经营分析 / 账户
 * 【员工】薪资统计 / 排班表 / 薪资预支
 * 【备用金】备用金管理
 * 【库存】10 个品类进销存入口
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
import StoreAccountsScreen from "@/components/store/accounts";
import StoreInventoryScreen from "@/components/store/inventory";
import LaborScreen from "@/app/labor";

type MainTab = "monthly" | "labor" | "petty" | "inventory";
type ReportTab = "summary" | "analytics" | "accounts";

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "monthly",   label: "报表" },
  { key: "labor",     label: "员工" },
  { key: "petty",     label: "备用金" },
  { key: "inventory", label: "库存" },
];

const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: "summary",   label: "总月报" },
  { key: "analytics", label: "经营分析" },
  { key: "accounts",  label: "账户" },
];

// ── 报表模块（含经营分析 + 账户两个子入口）────────────────────────────────────
function ReportModule({ insets }: { insets: any }) {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [reportTab, setReportTab] = usePersistedState<ReportTab>("store.report.tab.v2", "analytics");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 子 Tab Chip 切换栏 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {REPORT_TABS.map((t) => {
          const active = reportTab === t.key;
          return (
            <Pressable key={t.key} onPress={() => {
                tap();
                if (t.key === "summary") {
                  router.push("/monthly-summary" as any);
                } else {
                  setReportTab(t.key);
                }
              }}
              style={({ pressed }) => [S.subChip, {
                backgroundColor: active ? colors.primary : colors.surface,
                borderColor: active ? colors.primary : colors.border,
                opacity: pressed ? 0.75 : 1,
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

      {reportTab === "analytics" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StoreAnalyticsScreen />
        </SafeAreaInsetsContext.Provider>
      )}
      {reportTab === "accounts" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StoreAccountsScreen />
        </SafeAreaInsetsContext.Provider>
      )}
    </View>
  );
}

// ── 门店主屏 ──────────────────────────────────────────────────────────────────
export default function StoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mainTab, setMainTab] = usePersistedState<MainTab>("store.main.tab.v3", "monthly");
  const { syncState } = useSync();
  const hasSyncBadge = !!syncState.error;
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const childInsets = { ...insets, top: 0 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 顶部导航栏：头像 + 四个顶级 Tab */}
      <View style={[S.header, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        {/* 头像按钮（右上角） */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingBottom: 4 }}>
          <Pressable onPress={() => { tap(); router.push("/me"); }}
            style={({ pressed }) => [S.meBtn, { opacity: pressed ? 0.7 : 1 }]}>
            {hasSyncBadge && <View style={[S.syncDot, { backgroundColor: colors.error }]} />}
            <IconSymbol name="person.crop.circle" size={28} color={colors.primary} />
          </Pressable>
        </View>

        {/* 四大模块主 Tab（下划线风格） */}
        <View style={[S.mainTabRow, { borderBottomColor: colors.border }]}>
          {MAIN_TABS.map((t) => {
            const active = mainTab === t.key;
            return (
              <Pressable key={t.key} onPress={() => { tap(); setMainTab(t.key); }}
                style={({ pressed }) => [S.mainTabBtn, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }, { opacity: pressed ? 0.6 : 1 }]}>
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
        {mainTab === "monthly"   && <ReportModule insets={childInsets} />}
        {mainTab === "labor"     && <View style={{ flex: 1 }}><LaborScreen embedded /></View>}
        {mainTab === "petty"     && <SafeAreaInsetsContext.Provider value={childInsets}><StorePettyCashScreen /></SafeAreaInsetsContext.Provider>}
        {mainTab === "inventory" && <StoreInventoryScreen />}
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const S = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 0 },
  meBtn: { position: "relative" },
  syncDot: { position: "absolute", top: 0, right: 0, width: 8, height: 8, borderRadius: 4, zIndex: 1 },
  mainTabRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  mainTabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  mainTabText: { fontSize: 16 },
  subChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  subChipText: { fontSize: 14, lineHeight: 20 },
});
