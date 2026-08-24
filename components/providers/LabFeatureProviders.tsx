import type { ReactNode } from "react";
import { LabProvider } from "@/lib/lab/store";
import { LabPlanProvider } from "@/lib/lab/plan-store";
import { MenuProvider } from "@/lib/menu/store";
import { MenuPackageProvider } from "@/lib/menu/package-store";
import { WineProvider } from "@/lib/wine/store";
import { FoodMenuProvider } from "@/lib/food/menu-store";

export function LabFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <WineProvider>
      <FoodMenuProvider>
        <MenuPackageProvider>
          <MenuProvider>
            <LabProvider>
              <LabPlanProvider>{children}</LabPlanProvider>
            </LabProvider>
          </MenuProvider>
        </MenuPackageProvider>
      </FoodMenuProvider>
    </WineProvider>
  );
}
