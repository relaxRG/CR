/**
 * 门店 Tab — 三大模块
 * 【清单】在售清单 / 采购清单
 * 【报表】月度总报表 / 经营分析 / 备用金 / 人工成本
 * 【库存管理】10 个品类进销存入口
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
import StoreSaleScreen from "@/components/store/sale";
import StorePurchaseScreen from "@/components/store/purchase";
import StorePettyCashScreen from "@/components/store/petty-cash";
import StoreAnalyticsScreen from "@/components/store/analytics";
import StoreInventoryScreen from "@/components/store/inventory";
import StoreReportScreen from "@/components/store/report";

type MainTab = "list" | "report" | "inventory";
type ListTab = "sale" | "purchase";
type ReportTab = "summary" | "analytics" | "petty" | "labor";

const MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "list", label: "清单" },
  { key: "report", label: "报表" },
  { key: "inventory", label: "库存管理" },
];
const LIST_TABS: { key: ListTab; label: string }[] = [
  { key: "sale", label: "在售清单" },
  { key: "purchase", label: "采购清单" },
];
const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: "summary", label: `${new Date().getMonth() + 1}月报表` },
  { key: "analytics", label: "经营分析" },
  { key: "petty", label: "备用金" },
  { key: "labor", label: "人工成本" },
];

function ReportModule({ insets }: { insets: any }) {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [reportTab, setReportTab] = usePersistedState<ReportTab>("store.report.tab.v1", "summary");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {REPORT_TABS.map((t) => {
          const active = reportTab === t.key;
          return (
            <Pressable key={t.key} onPress={() => { tap(); setReportTab(t.key); }}
              style={[S.subChip, {
                backgroundColor: active ? colors.primary : colors.surface,
                borderColor: active ? colors.primary : colors.border,
              }]}>
              <Text style={[S.subChipText, { color: active ? "#fff" : colors.foreground, fontWeight: active ? "600" : "400" }]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {reportTab === "summary" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StoreReportScreen />
        </SafeAreaInsetsContext.Provider>
      )}
      {reportTab === "analytics" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StoreAnalyticsScreen />
        </SafeAreaInsetsContext.Provider>
      )}
      {reportTab === "petty" && (
        <SafeAreaInsetsContext.Provider value={insets}>
          <StorePettyCashScreen />
        </SafeAreaInsetsContext.Provider>
      )}
      {reportTab === "labor" && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom, gap: 12 }}>
          <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }}>
            {[
              { icon: "person.2.fill", color: "#007AFF", title: "人工成本管理", sub: "员工档案 · 薪资核算", route: "/labor" },
              { icon: "calendar.badge.clock", color: "#34C759", title: "排班管理", sub: "月度排班 · 出勤记录", route: "/labor-schedule" },
              { icon: "clock.fill", color: "#FF9500", title: "考勤记录", sub: "打卡 · 迟到早退 · 加班", route: "/labor-attendance" },
              { icon: "creditcard.fill", color: "#AF52DE", title: "预支管理", sub: "员工预支记录", route: "/labor-advances" },
            ].map((item, i, arr) => (
              <Pressable key={item.route} onPress={() => { tap(); router.push(item.route as any); }}
                style={({ pressed }) => [{
                  flexDirection: "row" as const, alignItems: "center" as const, gap: 12, padding: 14,
                  borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0,
                  borderBottomColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                }]}>
                <View style={[S.entryIcon, { backgroundColor: item.color + "22" }]}>
                  <IconSymbol name={item.icon as any} size={20} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{item.title}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{item.sub}</Text>
                </View>
                <IconSymbol name="chevron.right" size={16} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export default function StoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mainTab, setMainTab] = usePersistedState<MainTab>("store.main.tab.v1", "list");
  const [listTab, setListTab] = usePersistedState<ListTab>("store.list.tab.v1", "sale");
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

        {/* 清单模块子 Tab */}
        {mainTab === "list" && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ paddingVertical: 8, gap: 8, alignItems: "center" }}>
            {LIST_TABS.map((t) => {
              const active = listTab === t.key;
              return (
                <Pressable key={t.key} onPress={() => { tap(); setListTab(t.key); }}
                  style={[S.subChip, {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  }]}>
                  <Text style={[S.subChipText, { color: active ? "#fff" : colors.foreground, fontWeight: active ? "600" : "400" }]}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* 内容区 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        {mainTab === "list" && (
          <>
            <View style={[{ flex: 1 }, listTab !== "sale" && S.hidden]}>
              <StoreSaleScreen />
            </View>
            <View style={[{ flex: 1 }, listTab !== "purchase" && S.hidden]}>
              <StorePurchaseScreen />
            </View>
          </>
        )}
        {mainTab === "report" && <ReportModule insets={childInsets} />}
        {mainTab === "inventory" && <StoreInventoryScreen />}
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
