import { type ComponentType, type ReactNode, useEffect, useMemo, useRef } from "react";
import { markAppPerformance } from "@/lib/performance/app-performance-marks";
import { createStoreTabBoundaryLifecycle, type StoreTabKey as LifecycleTabKey } from "@/lib/store/store-tab-boundary-lifecycle";
import {
  StoreInventoryProviders,
  StoreLaborProviders,
  StorePettyProviders,
  StoreReportProviders,
  StoreShopProviders,
  type StoreTabKey,
} from "./StoreTabProviders";

const PROVIDERS: Record<StoreTabKey, ComponentType<{ children: ReactNode }>> = {
  monthly: StoreReportProviders,
  labor: StoreLaborProviders,
  petty: StorePettyProviders,
  inventory: StoreInventoryProviders,
  shop: StoreShopProviders,
};

/**
 * 门店顶级 Tab 的唯一事实源边界。
 * Provider key 随 Tab 改变，使 React 卸载旧树；生命周期内核同时负责释放未来的轮询或临时读模型资源。
 */
export function StoreTabBoundary({ tab, children }: { tab: StoreTabKey; children: ReactNode }) {
  const lifecycle = useRef(createStoreTabBoundaryLifecycle((next: LifecycleTabKey) => {
    markAppPerformance("store_tab_boundary.mounted", `tab=${next}`);
    return () => markAppPerformance("store_tab_boundary.cleaned", `tab=${next}`);
  }));

  useEffect(() => {
    lifecycle.current.activate(tab);
  }, [tab]);

  useEffect(() => () => lifecycle.current.dispose(), []);

  const Provider = useMemo(() => PROVIDERS[tab], [tab]);
  return <Provider key={tab}>{children}</Provider>;
}
