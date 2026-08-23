import type { ReactNode } from "react";
import { PettyCashProvider } from "@/lib/store/petty-store";
import { PettyCategoryProvider } from "@/lib/store/petty-category-store";
import { PettyInventoryLinkProvider } from "@/lib/store/petty-inventory-link-store";
import { PettyLaborLinkProvider } from "@/lib/store/petty-labor-link-store";
import { SpiritsInventoryProvider } from "@/lib/spirits/crud-store";
import { FoodIngredientProvider } from "@/lib/food/ingredient-store";
import { BeerInventoryProvider } from "@/lib/beer/inventory-store";
import { IceNewInventoryProvider } from "@/lib/ice/new-inventory-store";
import { FruitNewInventoryProvider } from "@/lib/fruit/new-inventory-store";
import { GlasswareInventoryProvider } from "@/lib/glassware/inventory-store";
import { TablewareInventoryProvider } from "@/lib/tableware/inventory-store";
import { DailyInventoryProvider } from "@/lib/daily/inventory-store";
import { EquipmentInventoryProvider } from "@/lib/equipment/inventory-store";
import { LaborProvider } from "@/lib/labor/store";
import { SalaryAdvanceCategoryProvider, SalaryAdvanceProvider } from "@/lib/labor/advance-store";
import { StoreFeatureProviders } from "./StoreFeatureProviders";
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
 * 报表迁移期兼容装配。月报与时段分析仍有跨域 Context 读写路径；在它们全部改为
 * 只读快照和报告自有命令前，保留一棵事实树而不是复制任一可写 Provider。
 * StoreTabBoundary 的 key 仍保证离开报表时完整卸载该树。
 */
export function StoreReportProviders({ children }: { children: ReactNode }) {
  return (
    <StoreFeatureProviders>
      <StoreReportReadModelProvider>{children}</StoreReportReadModelProvider>
    </StoreFeatureProviders>
  );
}
