import "@/global.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import { Platform } from "react-native";
import "@/lib/_core/nativewind-pressable";
import { ThemeProvider } from "@/lib/theme-provider";
import {
  SafeAreaFrameContext,
  SafeAreaInsetsContext,
  SafeAreaProvider,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { EdgeInsets, Metrics, Rect } from "react-native-safe-area-context";

import { initManusRuntime, subscribeSafeAreaInsets } from "@/lib/_core/manus-runtime";
import { RecipeProvider } from "@/lib/recipes/store";
import { I18nProvider } from "@/lib/i18n";
import { SyncProvider } from "@/lib/cf-sync/provider";
import { BottleProvider } from "@/lib/bottles/store";
import { BottleTaxonomyProvider } from "@/lib/bottles/taxonomy";
import { HomemadeProvider } from "@/lib/homemade/store";
import { IceSettingsProvider } from "@/lib/ice/store";
import { LabProvider } from "@/lib/lab/store";
import { BookStoreProvider } from "@/lib/books/store";
import { MenuProvider } from "@/lib/menu/store";
import { ShoppingProvider } from "@/lib/shopping/store";
import { WineProvider } from "@/lib/wine/store";
import { FoodMenuProvider } from "@/lib/food/menu-store";
import { MenuPackageProvider } from "@/lib/menu/package-store";
import { FoodIngredientProvider, SupplierPurchaseProvider } from "@/lib/food/ingredient-store";
import { RevenueProvider } from "@/lib/store/revenue-store";
import { PettyCashProvider } from "@/lib/store/petty-store";
import { InventoryProvider } from "@/lib/store/inventory-store";
import { LabPlanProvider } from "@/lib/lab/plan-store";
import { SpiritsProvider } from "@/lib/spirits/store";
import { SpiritsInventoryProvider } from "@/lib/spirits/crud-store";
import { MonthlyReportProvider } from "@/lib/store/monthly-report/store";
import { LaborProvider } from "@/lib/labor/store";
import { SalaryAdvanceProvider, SalaryAdvanceCategoryProvider } from "@/lib/labor/advance-store";
import { PettyCategoryProvider } from "@/lib/store/petty-category-store";
import { PettyInventoryLinkProvider } from "@/lib/store/petty-inventory-link-store";
import { PettyLaborLinkProvider } from "@/lib/store/petty-labor-link-store";
import { BeerProvider } from "@/lib/beer/store";
import { IceInventoryProvider } from "@/lib/ice/inventory-store";
import { FruitProvider } from "@/lib/fruit/store";
import { PeriodAnalysisProvider } from "@/lib/store/period-analysis/store";
import { MonthlySummaryProvider } from "@/lib/store/monthly-summary/store";
import { DishAnalysisProvider } from "@/lib/store/monthly-report/dish-analysis-store";
import { ScheduleProvider } from "@/lib/store/period-analysis/schedule-store";
import { BeerInventoryProvider } from "@/lib/beer/inventory-store";
import { IceNewInventoryProvider } from "@/lib/ice/new-inventory-store";
import { FruitNewInventoryProvider } from "@/lib/fruit/new-inventory-store";
import { GlasswareInventoryProvider } from "@/lib/glassware/inventory-store";
import { TablewareInventoryProvider } from "@/lib/tableware/inventory-store";
import { DailyInventoryProvider } from "@/lib/daily/inventory-store";
import { EquipmentInventoryProvider } from "@/lib/equipment/inventory-store";

const DEFAULT_WEB_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEFAULT_WEB_FRAME: Rect = { x: 0, y: 0, width: 0, height: 0 };

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  const initialInsets = initialWindowMetrics?.insets ?? DEFAULT_WEB_INSETS;
  const initialFrame = initialWindowMetrics?.frame ?? DEFAULT_WEB_FRAME;

  const [insets, setInsets] = useState<EdgeInsets>(initialInsets);
  const [frame, setFrame] = useState<Rect>(initialFrame);

  // Initialize Manus runtime for cookie injection from parent container
  useEffect(() => {
    initManusRuntime();
    // 迁移脚本：清理历史遗留的空排班记录（hoursValue=null 且无特殊状态）
    // 根因：SchHoursModal 旧版本清空工时保留了空记录，导致考勤统计异常（已修复于 commit e70c4c5）
    import("@/lib/migrations/clean-empty-shift-entries").then(({ cleanEmptyShiftEntries }) => {
      cleanEmptyShiftEntries().then((removed) => {
        if (removed > 0) console.log(`[Startup] 已清理 ${removed} 条空排班记录`);
      });
    });
    // 迁移脚本：清理历史遗留的 monthlyFixedSalary 字段（幽灵字段，已删除于 commit be4f76e）
    // 根因：该字段存在于 Employee 接口但从未被计算引擎使用，属于幽灵字段
    import("@/lib/migrations/clean-monthly-fixed-salary").then(({ cleanMonthlyFixedSalary }) => {
      cleanMonthlyFixedSalary().then((cleaned) => {
        if (cleaned > 0) console.log(`[Startup] 已清理 ${cleaned} 条员工记录中的 monthlyFixedSalary 字段`);
      });
    });
  }, []);

  const handleSafeAreaUpdate = useCallback((metrics: Metrics) => {
    setInsets(metrics.insets);
    setFrame(metrics.frame);
  }, []);

  useEffect(() => {
    // App-only build: web SafeArea override no longer used.
    if (Platform.OS !== "web") return;
    const unsubscribe = subscribeSafeAreaInsets(handleSafeAreaUpdate);
    return () => unsubscribe();
  }, [handleSafeAreaUpdate]);

  // Create clients once and reuse them
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Disable automatic refetching on window focus for mobile
            refetchOnWindowFocus: false,
            // Retry failed requests once
            retry: 1,
          },
          mutations: {
            // AI mutations should not auto-retry — they are expensive and
            // a timeout/error is usually not transient. Callers handle errors explicitly.
            retry: 0,
          },
        },
      }),
  );
  // Ensure minimum 8px padding for top and bottom on mobile
  const providerInitialMetrics = useMemo(() => {
    const metrics = initialWindowMetrics ?? { insets: initialInsets, frame: initialFrame };
    return {
      ...metrics,
      insets: {
        ...metrics.insets,
        top: Math.max(metrics.insets.top, 16),
        bottom: Math.max(metrics.insets.bottom, 12),
      },
    };
  }, [initialInsets, initialFrame]);

  const content = (
    <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
      <I18nProvider>
      <SyncProvider>
      <RecipeProvider>
          <BottleTaxonomyProvider>
          <BottleProvider>
          <HomemadeProvider>
          <IceSettingsProvider>
          <LabProvider>
          <BookStoreProvider>
          <MenuPackageProvider>
          <MenuProvider>
          <ShoppingProvider>
          <WineProvider>
          <FoodMenuProvider>
          <FoodIngredientProvider>
          <RevenueProvider>
          <PettyCashProvider>
          <InventoryProvider>
          <LabPlanProvider>
          <SupplierPurchaseProvider>
          <SpiritsProvider>
          <SpiritsInventoryProvider>
          <MonthlyReportProvider>
          <LaborProvider>
          <SalaryAdvanceCategoryProvider>
          <SalaryAdvanceProvider>
          <PettyCategoryProvider>
          <PettyInventoryLinkProvider>
          <PettyLaborLinkProvider>
          <BeerProvider>
          <IceInventoryProvider>
          <FruitProvider>
          <BeerInventoryProvider>
          <IceNewInventoryProvider>
          <FruitNewInventoryProvider>
          <GlasswareInventoryProvider>
          <TablewareInventoryProvider>
          <DailyInventoryProvider>
          <EquipmentInventoryProvider>
          <DishAnalysisProvider>
          <ScheduleProvider>
          <PeriodAnalysisProvider>
          <MonthlySummaryProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="recipe/[id]" />
              <Stack.Screen
                name="recipe-form"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen name="bottle/[id]" />
              <Stack.Screen
                name="bottle-form"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen
                name="bottle-channels"
                options={{ presentation: "modal", headerShown: false }}
              />
              <Stack.Screen name="homemade/[id]" />
              <Stack.Screen
                name="homemade-form"
                options={{ presentation: "modal" }}
              />
              <Stack.Screen name="ice-settings" options={{ presentation: "modal" }} />
              <Stack.Screen name="lab/projects" />
              <Stack.Screen name="lab/[id]" />
              <Stack.Screen name="lab/new" options={{ presentation: "modal" }} />
              <Stack.Screen name="lab/batch-form" options={{ presentation: "modal" }} />
              <Stack.Screen name="lab/compare" />
              <Stack.Screen name="book-reader" />
              <Stack.Screen name="card-tag-settings" options={{ presentation: "modal" }} />
              <Stack.Screen name="device-manager" options={{ presentation: "modal" }} />
              <Stack.Screen name="pair-device" options={{ presentation: "modal" }} />
              <Stack.Screen name="book-import" options={{ presentation: "modal" }} />
              <Stack.Screen name="bulk-import" options={{ presentation: "modal" }} />
              <Stack.Screen name="data-manager" options={{ presentation: "modal" }} />
              <Stack.Screen name="me" options={{ presentation: "modal" }} />
              <Stack.Screen name="wine-form" options={{ presentation: "modal" }} />
              <Stack.Screen name="wine/[id]" />
              <Stack.Screen name="food-form" options={{ presentation: "modal" }} />
              <Stack.Screen name="food-ingredient-form" options={{ presentation: "modal" }} />
              <Stack.Screen name="food/[id]" />
              <Stack.Screen name="food-ingredient/[id]" />
              <Stack.Screen name="lab/plan" />
              <Stack.Screen name="supplier-import" options={{ presentation: "modal" }} />
              <Stack.Screen name="backup" options={{ presentation: "modal" }} />
              <Stack.Screen name="role-guide" options={{ presentation: "modal" }} />
              <Stack.Screen name="sync-log" options={{ presentation: "modal" }} />
              <Stack.Screen name="system-tags" options={{ presentation: "modal" }} />
              <Stack.Screen name="tags" options={{ presentation: "modal" }} />
              <Stack.Screen name="taxonomy-manager" options={{ presentation: "modal" }} />
              <Stack.Screen name="wine-inventory" />
              <Stack.Screen name="wine-inventory-import" options={{ presentation: "modal" }} />
              <Stack.Screen name="spirits-inventory" />
              <Stack.Screen name="spirits-inventory-import" options={{ presentation: "modal" }} />
              <Stack.Screen name="monthly-report" />
              <Stack.Screen name="monthly-report-import" options={{ presentation: "modal" }} />
              <Stack.Screen name="labor" />
              <Stack.Screen name="labor-employees" />
              <Stack.Screen name="labor-archived" />
              <Stack.Screen name="labor-employee-profile" />
              <Stack.Screen name="labor-employee-form" options={{ presentation: "modal" }} />
              <Stack.Screen name="labor-attendance" />
              <Stack.Screen name="labor-advances" />
              <Stack.Screen name="labor-salary-history" />
              <Stack.Screen name="labor-kpi-allowance" />
              <Stack.Screen name="labor-kpi-allowance-edit" />
              <Stack.Screen name="petty-category-settings" options={{ presentation: "modal" }} />
              <Stack.Screen name="beer-ice-inventory" />
              <Stack.Screen name="beer-inventory" />
              <Stack.Screen name="ice-inventory" />
              <Stack.Screen name="fruit-inventory" />
              <Stack.Screen name="food-inventory" />
              <Stack.Screen name="glassware-inventory" />
              <Stack.Screen name="tableware-inventory" />
              <Stack.Screen name="daily-inventory" />
              <Stack.Screen name="equipment-inventory" />
              <Stack.Screen name="period-analysis" />
              <Stack.Screen name="monthly-summary" />
              <Stack.Screen name="suppliers" />
              <Stack.Screen name="dish-analysis" />
            </Stack>
            <StatusBar style="auto" />
          </MonthlySummaryProvider>
          </PeriodAnalysisProvider>
          </ScheduleProvider>
          </DishAnalysisProvider>
          </EquipmentInventoryProvider>
          </DailyInventoryProvider>
          </TablewareInventoryProvider>
          </GlasswareInventoryProvider>
          </FruitNewInventoryProvider>
          </IceNewInventoryProvider>
          </BeerInventoryProvider>
          </FruitProvider>
          </IceInventoryProvider>
          </BeerProvider>
          </PettyLaborLinkProvider>
          </PettyInventoryLinkProvider>
          </PettyCategoryProvider>
          </SalaryAdvanceProvider>
          </SalaryAdvanceCategoryProvider>
          </LaborProvider>
          </MonthlyReportProvider>
          </SpiritsInventoryProvider>
          </SpiritsProvider>
          </SupplierPurchaseProvider>
          </LabPlanProvider>
          </InventoryProvider>
          </PettyCashProvider>
          </RevenueProvider>
          </FoodIngredientProvider>
          </FoodMenuProvider>
          </WineProvider>
          </ShoppingProvider>
          </MenuProvider>
          </MenuPackageProvider>
          </BookStoreProvider>
          </LabProvider>
          </IceSettingsProvider>
          </HomemadeProvider>
          </BottleProvider>
          </BottleTaxonomyProvider>
          </RecipeProvider>
          </SyncProvider>
          </I18nProvider>
        </QueryClientProvider>
    </GestureHandlerRootView>
  );

  const shouldOverrideSafeArea = Platform.OS === "web";

  if (shouldOverrideSafeArea) {
    return (
      <ThemeProvider>
        <SafeAreaProvider initialMetrics={providerInitialMetrics}>
          <SafeAreaFrameContext.Provider value={frame}>
            <SafeAreaInsetsContext.Provider value={insets}>
              {content}
            </SafeAreaInsetsContext.Provider>
          </SafeAreaFrameContext.Provider>
        </SafeAreaProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SafeAreaProvider initialMetrics={providerInitialMetrics}>{content}</SafeAreaProvider>
    </ThemeProvider>
  );
}
