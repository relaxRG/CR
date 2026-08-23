import type { ReactNode } from "react";
import { FoodMenuProvider } from "@/lib/food/menu-store";
import { FoodIngredientProvider } from "@/lib/food/ingredient-store";

export function FoodFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <FoodMenuProvider>
      <FoodIngredientProvider>{children}</FoodIngredientProvider>
    </FoodMenuProvider>
  );
}
