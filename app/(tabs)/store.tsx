/**
 * 门店 Tab — 四大顶级模块
 * 【报表】经营分析 / 账户        → 需要 store_ops 权限
 * 【员工】薪资统计 / 排班表 / 薪资预支  → 需要 labor 权限
 * 【备用金】备用金管理            → 需要 store_ops 权限
 * 【库存】10 个品类进销存入口      → 需要 store_ops 权限
 *
 * 权限控制：
 *   - owner：所有 Tab 可见
 *   - collaborator/guest：仅显示 allowedKeys 包含对应模块的 Tab
 *   - 未登录：显示所有 Tab（本地单机模式）
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
import { useFeature } from "@/hooks/use-feature";
import { IconSymbol } from "@/components/ui/icon-symbol";
import StorePettyCashScreen from "@/components/store/petty-cash";
import StoreAnalyticsScreen from "@/components/store/analytics";
import StoreAccountsScreen from "@/components/store/accounts";
import StoreInventoryScreen from "@/components/store/inventory";
import LaborScreen from "@/app/labor";

type MainTab = "monthly" | "labor" | "petty" | "inventory";
type ReportTab = "summary" | "analytics" | "accounts";

const ALL_MAIN_TABS: { key: MainTab; label: string; feature: "store_ops" | "labor" }[] = [
  { key: "monthly",   label: "报表",  feature: "store_ops" },
  { key: "labor",     label: "员工",  feature: "labor" },
  { key: "petty",     label: "备用金", feature: "store_ops" },
  { key: "inventory", label: "库存",  feature: "store_ops" },
];

const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: "summary",   label: "总月报" },
  { key: "analytics", label: "经营分析" },
  { key: "accounts",  label: "账户" },
];

// ── 无权限占位组件 ─────────────────────────────────────────────────────────────
function AccessDenied({ label, colors }: { label: string; colors: any }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
      <IconSymbol name="lock.fill" size={40} color={colors.muted} />
      <Text style={{ fontSize: 16, color: colors.muted, fontWeight: "600" }}>无权访问</Text>
      <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", paddingHorizontal: 32 }}>
        您的设备没有「{label}」模块的访问权限，请联系管理员授权。
      </Text>
    </View>
  );
}

// ── 报表模块（含总月报 / 经营分析 / 账户三个子入口）──────────────────────────────
function ReportModule({ insets, colors }: { insets: any; colors: any }) {
  const router = useRouter();
  const { hasFeature } = useFeature();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [reportTab, setReportTab] = usePersistedState<ReportTab>("store.report.tab.v2", "analytics");

  if (!hasFeature("store_ops")) {
    return <AccessDenied label="报表" colors={colors} />;
  }

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
  const { hasFeature, isAuthenticated } = useFeature();
  const hasSyncBadge = !!syncState.error;
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const childInsets = { ...insets, top: 0 };

  // 过滤出当前设备有权访问的 Tab（未登录时显示全部，保持本地单机模式可用）
  const visibleTabs = ALL_MAIN_TABS.filter((t) =>
    !isAuthenticated || hasFeature(t.feature)
  );

  // 如果当前选中的 Tab 不可见，自动切换到第一个可见 Tab
  const effectiveTab = visibleTabs.find((t) => t.key === mainTab)
    ? mainTab
    : (visibleTabs[0]?.key ?? "monthly");

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 顶部导航栏：Tab + 头像合并为一行（修复顶部留白过宽 Bug） */}
      <View style={{ paddingTop: insets.top, backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20 }}>
          {/* Tab 列表（占满剩余空间） */}
          <View style={{ flex: 1, flexDirection: "row" }}>
            {visibleTabs.map((t) => {
              const active = effectiveTab === t.key;
              return (
                <Pressable key={t.key} onPress={() => { tap(); setMainTab(t.key); }}
                  style={({ pressed }) => [{
                    paddingVertical: 12,
                    paddingHorizontal: 4,
                    marginRight: 16,
                    borderBottomWidth: 2,
                    borderBottomColor: active ? colors.primary : "transparent",
                    opacity: pressed ? 0.6 : 1,
                  }]}>
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
          {/* 头像按鈕（右侧对齐） */}
          <Pressable onPress={() => { tap(); router.push("/me"); }}
            style={({ pressed }) => [S.meBtn, { opacity: pressed ? 0.7 : 1 }]}>
            {hasSyncBadge && <View style={[S.syncDot, { backgroundColor: colors.error }]} />}
            <IconSymbol name="person.crop.circle" size={28} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* 内容区 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        {effectiveTab === "monthly"   && <ReportModule insets={childInsets} colors={colors} />}
        {effectiveTab === "labor"     && (
          hasFeature("labor")
            ? <View style={{ flex: 1 }}><LaborScreen embedded /></View>
            : <AccessDenied label="员工" colors={colors} />
        )}
        {effectiveTab === "petty"     && (
          hasFeature("store_ops")
            ? <SafeAreaInsetsContext.Provider value={childInsets}><StorePettyCashScreen /></SafeAreaInsetsContext.Provider>
            : <AccessDenied label="备用金" colors={colors} />
        )}
        {effectiveTab === "inventory" && (
          hasFeature("store_ops")
            ? <StoreInventoryScreen />
            : <AccessDenied label="库存" colors={colors} />
        )}
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
