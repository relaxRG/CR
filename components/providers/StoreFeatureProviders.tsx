import type { ReactNode } from "react";
import { RevenueProvider } from "@/lib/store/revenue-store";
import { PettyCashProvider } from "@/lib/store/petty-store";
import { SpiritsInventoryProvider } from "@/lib/spirits/crud-store";
import { MonthlyReportProvider } from "@/lib/store/monthly-report/store";
import { RawExcelArchiveProvider } from "@/lib/store/monthly-report/raw-excel-archive-store";
import { LaborProvider } from "@/lib/labor/store";
import { SalaryAdvanceProvider, SalaryAdvanceCategoryProvider } from "@/lib/labor/advance-store";
import { PettyCategoryProvider } from "@/lib/store/petty-category-store";
import { PettyInventoryLinkProvider } from "@/lib/store/petty-inventory-link-store";
import { PettyLaborLinkProvider } from "@/lib/store/petty-labor-link-store";
import { BeerInventoryProvider } from "@/lib/beer/inventory-store";
import { IceNewInventoryProvider } from "@/lib/ice/new-inventory-store";
import { FruitNewInventoryProvider } from "@/lib/fruit/new-inventory-store";
import { GlasswareInventoryProvider } from "@/lib/glassware/inventory-store";
import { TablewareInventoryProvider } from "@/lib/tableware/inventory-store";
import { DailyInventoryProvider } from "@/lib/daily/inventory-store";
import { EquipmentInventoryProvider } from "@/lib/equipment/inventory-store";
import { DishAnalysisProvider } from "@/lib/store/monthly-report/dish-analysis-store";
import { ScheduleProvider } from "@/lib/store/period-analysis/schedule-store";
import { PeriodAnalysisProvider } from "@/lib/store/period-analysis/store";
import { MonthlySummaryProvider } from "@/lib/store/monthly-summary/store";
import { ModuleMonthCloseProvider } from "@/lib/month-close/module-month-close-store";

export function StoreFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <RevenueProvider>
      <PettyCashProvider>
        <SpiritsInventoryProvider>
          <MonthlyReportProvider>
            <RawExcelArchiveProvider>
              <LaborProvider>
                <SalaryAdvanceCategoryProvider>
                  <SalaryAdvanceProvider>
                    <PettyCategoryProvider>
                      <PettyInventoryLinkProvider>
                        <PettyLaborLinkProvider>
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
                                                <ModuleMonthCloseProvider>{children}</ModuleMonthCloseProvider>
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
                        </PettyLaborLinkProvider>
                      </PettyInventoryLinkProvider>
                    </PettyCategoryProvider>
                  </SalaryAdvanceProvider>
                </SalaryAdvanceCategoryProvider>
              </LaborProvider>
            </RawExcelArchiveProvider>
          </MonthlyReportProvider>
        </SpiritsInventoryProvider>
      </PettyCashProvider>
    </RevenueProvider>
  );
}
