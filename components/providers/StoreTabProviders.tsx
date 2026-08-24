import type { ReactNode } from "react";
import { PettyCashProvider } from "@/lib/store/petty-store";
import { PettyCategoryProvider } from "@/lib/store/petty-category-store";
import { PettyInventoryLinkProvider } from "@/lib/store/petty-inventory-link-store";
import { PettyLaborLinkProvider } from "@/lib/store/petty-labor-link-store";
import { SpiritsInventoryProvider } from "@/lib/spirits/crud-store";
import { FoodIngredientProvider, SupplierPurchaseProvider } from "@/lib/food/ingredient-store";
import { BeerInventoryProvider } from "@/lib/beer/inventory-store";
import { IceNewInventoryProvider } from "@/lib/ice/new-inventory-store";
import { FruitNewInventoryProvider } from "@/lib/fruit/new-inventory-store";
import { GlasswareInventoryProvider } from "@/lib/glassware/inventory-store";
import { TablewareInventoryProvider } from "@/lib/tableware/inventory-store";
import { DailyInventoryProvider } from "@/lib/daily/inventory-store";
import { EquipmentInventoryProvider } from "@/lib/equipment/inventory-store";
import { LaborProvider } from "@/lib/labor/store";
import { SalaryAdvanceCategoryProvider, SalaryAdvanceProvider } from "@/lib/labor/advance-store";
import { MonthlyReportProvider } from "@/lib/store/monthly-report/store";
import { ScheduleProvider } from "@/lib/store/period-analysis/schedule-store";
import { PeriodAnalysisProvider } from "@/lib/store/period-analysis/store";
import { MonthlySummaryProvider } from "@/lib/store/monthly-summary/store";
import { ModuleMonthCloseProvider } from "@/lib/month-close/module-month-close-store";
import { RawExcelArchiveProvider } from "@/lib/store/monthly-report/raw-excel-archive-store";
import { DishAnalysisProvider } from "@/lib/store/monthly-report/dish-analysis-store";
import { ReportMonthCloseProvider } from "@/lib/labor/report-month-close-provider";
import { StoreReportReadModelProvider } from "./StoreReportReadModelProvider";

export type StoreTabKey = "monthly" | "labor" | "petty" | "inventory" | "shop";

export function StoreShopProviders({ children }: { children: ReactNode }) {
  return (
    <GlasswareInventoryProvider>
      <TablewareInventoryProvider>
        <DailyInventoryProvider>
          <EquipmentInventoryProvider>{children}</EquipmentInventoryProvider>
        </DailyInventoryProvider>
      </TablewareInventoryProvider>
    </GlasswareInventoryProvider>
  );
}

export function StorePettyProviders({ children }: { children: ReactNode }) {
  return (
    <PettyCashProvider>
      <PettyCategoryProvider>
        <PettyInventoryLinkProvider>
          <PettyLaborLinkProvider>{children}</PettyLaborLinkProvider>
        </PettyInventoryLinkProvider>
      </PettyCategoryProvider>
    </PettyCashProvider>
  );
}

export function StoreInventoryProviders({ children }: { children: ReactNode }) {
  return (
    <SpiritsInventoryProvider>
      <FoodIngredientProvider>
        <BeerInventoryProvider>
          <IceNewInventoryProvider>
            <FruitNewInventoryProvider>{children}</FruitNewInventoryProvider>
          </IceNewInventoryProvider>
        </BeerInventoryProvider>
      </FoodIngredientProvider>
    </SpiritsInventoryProvider>
  );
}

/**
 * 供应商管理与导入页面同时消费报表汇总、食材档案及供应商采购记录。
 * 该组合用于独立深链，避免为此挂载完整门店事实树。
 */
export function StoreSupplierManagementProviders({ children }: { children: ReactNode }) {
  return (
    <StoreReportProviders>
      <FoodIngredientProvider>
        <SupplierPurchaseProvider>{children}</SupplierPurchaseProvider>
      </FoodIngredientProvider>
    </StoreReportProviders>
  );
}

export function StoreInventoryDeepLinkProviders({ children }: { children: ReactNode }) {
  return (
    <ModuleMonthCloseProvider>
      <StoreInventoryProviders>{children}</StoreInventoryProviders>
    </ModuleMonthCloseProvider>
  );
}

export function StoreLaborProviders({ children }: { children: ReactNode }) {
  return (
    <LaborProvider>
      <SalaryAdvanceCategoryProvider>
        <SalaryAdvanceProvider>{children}</SalaryAdvanceProvider>
      </SalaryAdvanceCategoryProvider>
    </LaborProvider>
  );
}

/**
 * 劳动工作区会将备用金条目投影为预支与人工关联；独立劳动路由必须同时装配这两个只需读取/关联的事实源。
 * StoreAllFeatureProviders 已由 StorePettyProviders 提供相同来源，因此不在其内部重复使用本组合。
 */
export function StoreLaborWorkspaceProviders({ children }: { children: ReactNode }) {
  return (
    <PettyCashProvider>
      <PettyLaborLinkProvider>
        <StoreLaborProviders>{children}</StoreLaborProviders>
      </PettyLaborLinkProvider>
    </PettyCashProvider>
  );
}

/**
 * 报表边界只装配报告自有写模型、受控月结命令与只读跨域物化视图。
 * 它不挂载人力、备用金、库存、采购或店铺的可写事实 Provider；离开报表时由 Tab key 完整卸载。
 */
export function StoreAllFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <RawExcelArchiveProvider>
      <DishAnalysisProvider>
        <StoreReportProviders>
          <StoreLaborProviders>
            <StorePettyProviders>
              <StoreInventoryProviders>
                <StoreShopProviders>{children}</StoreShopProviders>
              </StoreInventoryProviders>
            </StorePettyProviders>
          </StoreLaborProviders>
        </StoreReportProviders>
      </DishAnalysisProvider>
    </RawExcelArchiveProvider>
  );
}

export function StoreReportImportProviders({ children }: { children: ReactNode }) {
  return (
    <MonthlyReportProvider>
      <RawExcelArchiveProvider>
        <DishAnalysisProvider>
          <ScheduleProvider>
            <PeriodAnalysisProvider>{children}</PeriodAnalysisProvider>
          </ScheduleProvider>
        </DishAnalysisProvider>
      </RawExcelArchiveProvider>
    </MonthlyReportProvider>
  );
}

export function StoreReportProviders({ children }: { children: ReactNode }) {
  return (
    <MonthlyReportProvider>
      <ScheduleProvider>
        <PeriodAnalysisProvider>
          <MonthlySummaryProvider>
            <ModuleMonthCloseProvider>
              <ReportMonthCloseProvider>
                <StoreReportReadModelProvider>{children}</StoreReportReadModelProvider>
              </ReportMonthCloseProvider>
            </ModuleMonthCloseProvider>
          </MonthlySummaryProvider>
        </PeriodAnalysisProvider>
      </ScheduleProvider>
    </MonthlyReportProvider>
  );
}
