export type WineSupplierTrendGestureDirection = "tap" | "horizontal" | "vertical";

export interface WineSupplierTrendGestureResult {
  direction: WineSupplierTrendGestureDirection;
  /** 移动手势完成后禁止把同一次触摸误判为柱体点击。 */
  suppressPress: boolean;
}

/**
 * 触控方向锁定：超过阈值后，横向优先交给图表滚动，纵向交还页面滚动。
 * 小位移保持 tap，以确保柱体可点击且不因轻微手抖失效。
 */
export function resolveChartGesture(input: {
  dx: number;
  dy: number;
  moved: boolean;
  threshold?: number;
}): WineSupplierTrendGestureResult {
  const threshold = input.threshold ?? 8;
  const horizontal = Math.abs(input.dx);
  const vertical = Math.abs(input.dy);
  if (!input.moved || Math.max(horizontal, vertical) < threshold) return { direction: "tap", suppressPress: false };
  if (horizontal > vertical) return { direction: "horizontal", suppressPress: true };
  return { direction: "vertical", suppressPress: true };
}
