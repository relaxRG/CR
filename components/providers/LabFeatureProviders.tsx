import type { ReactNode } from "react";
import { LabProvider } from "@/lib/lab/store";
import { LabPlanProvider } from "@/lib/lab/plan-store";

export function LabFeatureProviders({ children }: { children: ReactNode }) {
  return (
    <LabProvider>
      <LabPlanProvider>{children}</LabPlanProvider>
    </LabProvider>
  );
}
