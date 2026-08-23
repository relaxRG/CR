import { useEffect, type ComponentType, type ReactNode } from "react";
import { usePathname } from "expo-router";
import { resolveFeatureBoundary, type FeatureBoundary } from "@/lib/navigation/feature-boundary";
import { markAppPerformance } from "@/lib/performance/app-performance-marks";
import { CocktailFeatureProviders } from "@/components/providers/CocktailFeatureProviders";
import { WineFeatureProviders } from "@/components/providers/WineFeatureProviders";
import { LabFeatureProviders } from "@/components/providers/LabFeatureProviders";
import { FoodFeatureProviders } from "@/components/providers/FoodFeatureProviders";
import { StoreFeatureProviders } from "@/components/providers/StoreFeatureProviders";
import { StoreReportReadModelProvider } from "@/components/providers/StoreReportReadModelProvider";

const PROVIDERS: Record<Exclude<FeatureBoundary, "all" | "core">, ComponentType<{ children: ReactNode }>> = {
  cocktail: CocktailFeatureProviders,
  wine: WineFeatureProviders,
  lab: LabFeatureProviders,
  food: FoodFeatureProviders,
  store: StoreFeatureProviders,
};

function AllFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <CocktailFeatureProviders>
      <WineFeatureProviders>
        <LabFeatureProviders>
          <FoodFeatureProviders>
            <StoreFeatureProviders>{children}</StoreFeatureProviders>
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
  if (pathname === "/monthly-summary" || pathname === "/period-analysis") {
    return <Provider><StoreReportReadModelProvider>{children}</StoreReportReadModelProvider></Provider>;
  }
  return <Provider>{children}</Provider>;
}
