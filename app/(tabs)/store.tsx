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
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom, gap: 12 }}>
          {/* 员工管理主入口（直通） */}
          <Pressable onPress={() => { tap(); router.push("/labor" as any); }}
            style={({ pressed }) => [{
              borderRadius: 14, borderWidth: 1, borderColor: "#007AFF" + "44",
              backgroundColor: "#007AFF" + "08", padding: 16, opacity: pressed ? 0.8 : 1,
              flexDirection: "row" as const, alignItems: "center" as const, gap: 12,
            }]}>
            <View style={[S.entryIcon, { backgroundColor: "#007AFF" + "22", width: 48, height: 48, borderRadius: 14 }]}>
              <IconSymbol name="person.2.fill" size={24} color="#007AFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>员工管理</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>排班 · 档案 · 薪资 · 绩效 · 预支</Text>
            </View>
            <IconSymbol name="chevron.right" size={18} color="#007AFF" />
          </Pressable>

          {/* 快捷入口 */}
          <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }}>
            {[
              { icon: "calendar.badge.clock", color: "#34C759", title: "排班管理",     sub: "月度排班 · 午晚分行",      route: "/labor-schedule" },
              { icon: "clock.fill",           color: "#FF9500", title: "考勤记录",     sub: "打卡 · 加班 · 调休",      route: "/labor-attendance" },
              { icon: "creditcard.fill",      color: "#AF52DE", title: "预支管理",     sub: "员工预支记录",             route: "/labor-advances" },
              { icon: "clock.badge.exclamationmark", color: "#FF3B30", title: "营业时间设置", sub: "临近关门预警 · 加班分析", route: "/store-hours" },
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
