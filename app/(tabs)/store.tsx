/**
 * 门店 Tab — 四大顶级模块
 * 所有顶级页签始终可见；查看、编辑、导入、导出、月结和管理动作均由 DeviceSessionV2 的独立能力决定。
 * 顶级页签始终可见，未获查看能力时展示精确锁定状态。
 */
import React from "react";
import {
  Platform, Pressable, StyleSheet, Text, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useReportMonthNavigation } from "@/hooks/use-report-month-navigation";
import { BoundedBusinessMonthNavigator } from "@/components/months/BoundedBusinessMonthNavigator";
import { useSync } from "@/lib/cf-sync/provider";
import { useCan } from "@/hooks/use-can";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StoreSegmentedTabs } from "@/components/store/store-visual-primitives";
import { floatingTabContentBottomInset } from "@/components/floating-tab-bar";
import StorePettyCashScreen from "@/components/store/petty-cash";
import StoreAnalyticsScreen from "@/components/store/analytics";
import StoreAccountsScreen from "@/components/store/accounts";
import StoreInventoryScreen from "@/components/store/inventory";
import StoreShopScreen from "@/components/store/shop";
import LaborScreen from "@/app/labor";
import MonthlySummaryScreen from "@/app/monthly-summary";
import PeriodAnalysisScreen from "@/app/period-analysis";
import { StoreTabBoundary } from "@/components/providers/StoreTabBoundary";

type MainTab = "monthly" | "labor" | "petty" | "shop" | "inventory";
type ReportTab = "summary" | "analytics" | "accounts" | "period";

const ALL_MAIN_TABS: { key: MainTab; label: string }[] = [
  { key: "monthly", label: "报表" },
  { key: "labor", label: "员工" },
  { key: "petty", label: "备用金" },
  { key: "inventory", label: "库存" },
  { key: "shop", label: "店铺" },
];

const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: "summary",   label: "总月报" },
  { key: "analytics", label: "经营分析" },
  { key: "accounts",  label: "账户" },
  { key: "period",    label: "时段经营分析" },
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
  const summaryAccess = useCan("reports_monthly.view");
  const analyticsAccess = useCan("analytics_business.view");
  const accountsAccess = useCan("accounts.view");
  const periodAccess = useCan("analytics_period.view");
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [reportTab, setReportTab] = usePersistedState<ReportTab>("store.report.tab.v3", "summary");
  const { month: reportMonth, bounds: reportMonthBounds, selectMonth: selectReportMonth } = useReportMonthNavigation();

  const activeAccess = reportTab === "summary" ? summaryAccess
    : reportTab === "analytics" ? analyticsAccess
    : reportTab === "accounts" ? accountsAccess
    : periodAccess;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StoreSegmentedTabs
        testID="store-report-tabs"
        items={REPORT_TABS}
        active={reportTab}
        colors={colors}
        onChange={(next) => { tap(); setReportTab(next); }}
      />

      <BoundedBusinessMonthNavigator
          testID="report-workspace-month-navigator"
          subject="报表"
          month={reportMonth}
          bounds={reportMonthBounds}
          onChange={selectReportMonth}
        />

      {!activeAccess.allowed ? (
        <AccessDenied label={REPORT_TABS.find((tab) => tab.key === reportTab)?.label ?? "报表"} colors={colors} />
      ) : reportTab === "summary" ? (
        <View style={{ flex: 1 }}>
          <SafeAreaInsetsContext.Provider value={insets}>
            <MonthlySummaryScreen embedded />
          </SafeAreaInsetsContext.Provider>
        </View>
      ) : reportTab === "analytics" ? (
        <View style={{ flex: 1 }}>
          <SafeAreaInsetsContext.Provider value={insets}>
            <StoreAnalyticsScreen embedded />
          </SafeAreaInsetsContext.Provider>
        </View>
      ) : reportTab === "accounts" ? (
        <View style={{ flex: 1 }}>
          <SafeAreaInsetsContext.Provider value={insets}>
            <StoreAccountsScreen embedded />
          </SafeAreaInsetsContext.Provider>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <SafeAreaInsetsContext.Provider value={insets}>
            <PeriodAnalysisScreen embedded />
          </SafeAreaInsetsContext.Provider>
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
  const [mainTab, setMainTab] = usePersistedState<MainTab>("store.main.tab.v3", "monthly");
  const { syncState } = useSync();
  const laborAccess = useCan("labor_employees.view");
  const pettyAccess = useCan("petty_cash.view");
  const inventorySpiritsAccess = useCan("inventory_spirits.view");
  const inventoryWineAccess = useCan("inventory_wine.view");
  const inventoryFruitAccess = useCan("inventory_fruit.view");
  const inventoryFoodAccess = useCan("inventory_food.view");
  const inventoryBeerAccess = useCan("inventory_beer.view");
  const inventoryIceAccess = useCan("inventory_ice.view");
  const shopGlasswareAccess = useCan("shop_glassware.view");
  const shopTablewareAccess = useCan("shop_tableware.view");
  const shopSuppliesAccess = useCan("shop_supplies.view");
  const shopEquipmentAccess = useCan("shop_equipment.view");
  const inventoryAllowed = [inventorySpiritsAccess, inventoryWineAccess, inventoryFruitAccess, inventoryFoodAccess, inventoryBeerAccess, inventoryIceAccess].some((decision) => decision.allowed);
  const shopAllowed = [shopGlasswareAccess, shopTablewareAccess, shopSuppliesAccess, shopEquipmentAccess].some((decision) => decision.allowed);
  const hasSyncBadge = !!syncState.error;
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const contentBottomInset = floatingTabContentBottomInset(insets.bottom);
  // 子页面沿用原有安全区 API，但 bottom 已包含浮动导航高度，所有现有 ScrollView 自动获得末行预留。
  const childInsets = { ...insets, top: 0, bottom: contentBottomInset };

  // 顶级页签始终可见；每个业务页面按照对应的细粒度 capability 展示锁定与可用动作。
  const visibleTabs = ALL_MAIN_TABS;
  const effectiveTab = mainTab;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingBottom: contentBottomInset }}>
      {/* 五个门店模块为同一层级的胶囊选择器；头像单独保留在右侧。 */}
      <View style={{ paddingTop: insets.top, backgroundColor: colors.background, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingRight: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <StoreSegmentedTabs
              testID="store-main-tabs"
              items={visibleTabs}
              active={effectiveTab}
              colors={colors}
              onChange={(next) => { tap(); setMainTab(next); }}
            />
          </View>
          <Pressable onPress={() => { tap(); router.push("/me"); }} style={({ pressed }) => [S.meBtn, { opacity: pressed ? 0.7 : 1 }]}>
            {hasSyncBadge && <View style={[S.syncDot, { backgroundColor: colors.error }]} />}
            <IconSymbol name="person.crop.circle" size={28} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* 内容区 */}
      <SafeAreaInsetsContext.Provider value={childInsets}>
        <StoreTabBoundary tab={effectiveTab}>
          {effectiveTab === "monthly" && <ReportModule insets={childInsets} colors={colors} />}
          {effectiveTab === "labor" && (laborAccess.allowed
            ? <View style={{ flex: 1 }}><LaborScreen embedded /></View>
            : <AccessDenied label="员工" colors={colors} />
          )}
          {effectiveTab === "petty" && (pettyAccess.allowed
            ? <SafeAreaInsetsContext.Provider value={childInsets}><StorePettyCashScreen /></SafeAreaInsetsContext.Provider>
            : <AccessDenied label="备用金" colors={colors} />
          )}
          {effectiveTab === "shop" && (shopAllowed
            ? <StoreShopScreen />
            : <AccessDenied label="店铺" colors={colors} />
          )}
          {effectiveTab === "inventory" && (inventoryAllowed
            ? <StoreInventoryScreen mode="inventory" />
            : <AccessDenied label="库存" colors={colors} />
          )}
        </StoreTabBoundary>
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const S = StyleSheet.create({
  meBtn: { position: "relative", width: 36, alignItems: "center", justifyContent: "center" },
  syncDot: { position: "absolute", top: 0, right: 0, width: 8, height: 8, borderRadius: 4, zIndex: 1 },
});
