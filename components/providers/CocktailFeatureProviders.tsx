import type { ReactNode } from "react";
import { PriceAlertProvider } from "@/lib/bottles/price-alert-store";
import { IceSettingsProvider } from "@/lib/ice/store";
import { MenuProvider } from "@/lib/menu/store";
import { MenuPackageProvider } from "@/lib/menu/package-store";
import { ShoppingProvider } from "@/lib/shopping/store";

export function CocktailFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <PriceAlertProvider>
      <IceSettingsProvider>
                <MenuPackageProvider>
                  <MenuProvider>
                    <ShoppingProvider>{children}</ShoppingProvider>
                  </MenuProvider>
                </MenuPackageProvider>
      </IceSettingsProvider>
    </PriceAlertProvider>
  );
}
