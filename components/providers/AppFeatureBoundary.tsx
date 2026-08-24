import { useEffect, type ComponentType, type ReactNode } from "react";
import { usePathname } from "expo-router";
import { resolveFeatureBoundary, type FeatureBoundary } from "@/lib/navigation/feature-boundary";
import { markAppPerformance } from "@/lib/performance/app-performance-marks";
import { CocktailFeatureProviders } from "@/components/providers/CocktailFeatureProviders";
import { WineFeatureProviders } from "@/components/providers/WineFeatureProviders";
import { LabFeatureProviders } from "@/components/providers/LabFeatureProviders";
import { FoodFeatureProviders } from "@/components/providers/FoodFeatureProviders";
import {
  StoreAllFeatureProviders,
  StoreInventoryDeepLinkProviders,
  StoreLaborWorkspaceProviders,
  StorePettyProviders,
  StoreReportImportProviders,
  StoreReportProviders,
  StoreShopProviders,
  StoreSupplierManagementProviders,
} from "@/components/providers/StoreTabProviders";
import { SpiritsInventoryProvider } from "@/lib/spirits/crud-store";

const PROVIDERS: Record<Exclude<FeatureBoundary, "all" | "core">, ComponentType<{ children: ReactNode }>> = {
  cocktail: CocktailFeatureProviders,
  wine: WineFeatureProviders,
  lab: LabFeatureProviders,
  food: FoodFeatureProviders,
  store: StoreAllFeatureProviders,
};

function AllFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <CocktailFeatureProviders>
      <WineFeatureProviders>
        <LabFeatureProviders>
          <FoodFeatureProviders>
            <StoreAllFeatureProviders>{children}</StoreAllFeatureProviders>
          </FoodFeatureProviders>
        </LabFeatureProviders>
      </WineFeatureProviders>
    </CocktailFeatureProviders>
  );
}

/**
 * 正常业务深链只装配所属功能域；跨域技术页临时装配全部域以保持既有管理能力。
 * 该边界不修改 URL、同步键或业务数据，只取代根布局的常驻业务 Provider 树。
 */
export function AppFeatureBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const boundary = resolveFeatureBoundary(pathname);

  useEffect(() => {
    markAppPerformance("feature_boundary.mounted", `path=${pathname};boundary=${boundary}`);
  }, [boundary, pathname]);

  if (boundary === "all") return <AllFeatureProviders>{children}</AllFeatureProviders>;
  if (boundary === "core" || pathname === "/store") return <>{children}</>;
  const Provider = PROVIDERS[boundary];
  if (pathname === "/monthly-summary" || pathname === "/period-analysis" || pathname === "/store-accounts" || pathname === "/store-hours") {
    return <StoreReportProviders>{children}</StoreReportProviders>;
  }
  if (pathname === "/monthly-report-import" || pathname === "/dish-analysis") {
    return <StoreReportImportProviders>{children}</StoreReportImportProviders>;
  }
  if (pathname.startsWith("/labor")) return <StoreLaborWorkspaceProviders>{children}</StoreLaborWorkspaceProviders>;
  if (pathname === "/petty-category-settings") return <StorePettyProviders>{children}</StorePettyProviders>;
  if (pathname.startsWith("/suppliers") || pathname.startsWith("/supplier-import")) {
    return <StoreSupplierManagementProviders>{children}</StoreSupplierManagementProviders>;
  }
  if (pathname.startsWith("/bottle-channels")) {
    return <SpiritsInventoryProvider>{children}</SpiritsInventoryProvider>;
  }
  if (
    pathname.startsWith("/spirits-inventory") || pathname.startsWith("/beer-inventory") ||
    pathname.startsWith("/ice-inventory") || pathname.startsWith("/fruit-inventory") || pathname.startsWith("/food-inventory")
  ) return <StoreInventoryDeepLinkProviders>{children}</StoreInventoryDeepLinkProviders>;
  if (
    pathname.startsWith("/glassware-inventory") || pathname.startsWith("/tableware-inventory") ||
    pathname.startsWith("/daily-inventory") || pathname.startsWith("/equipment-inventory")
  ) return <StoreShopProviders>{children}</StoreShopProviders>;
  return <Provider>{children}</Provider>;
}
