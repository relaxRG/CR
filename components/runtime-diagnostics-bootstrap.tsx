import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { usePathname } from "expo-router";

import {
  installGlobalRuntimeDiagnostics,
  recordRuntimeEvent,
  redactRuntimePath,
} from "@/lib/diagnostics/runtime";

/** Installs runtime diagnostics once and records only coarse lifecycle/navigation evidence. */
export function RuntimeDiagnosticsBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    const dispose = installGlobalRuntimeDiagnostics();
    void recordRuntimeEvent("app_start", "Runtime diagnostics installed");
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      void recordRuntimeEvent("app_lifecycle", `AppState changed to ${nextState}`);
    });
    return () => {
      subscription.remove();
      dispose();
    };
  }, []);

  useEffect(() => {
    if (pathname) {
      void recordRuntimeEvent("navigation", `Route opened: ${redactRuntimePath(pathname)}`);
    }
  }, [pathname]);

  return null;
}
