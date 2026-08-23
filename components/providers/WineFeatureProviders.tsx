import type { ReactNode } from "react";

/**
 * 葡萄酒事实（档案、快照、采购）同时被门店月报读取，现由共享内核唯一装配。
 * 保留此边界组件以稳定葡萄酒路由架构，并为后续将仅葡萄酒 UI 状态移入此域预留位置。
 */
export function WineFeatureProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
