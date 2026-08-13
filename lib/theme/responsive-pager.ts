/**
 * 响应式横向分页的统一几何规则。
 *
 * 所有分页偏移必须从当前容器宽度计算；不得缓存模块加载时的屏幕宽度。
 */
export function clampPagerIndex(index: number, pageCount: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(pageCount) || pageCount <= 0) return 0;
  return Math.max(0, Math.min(Math.trunc(pageCount) - 1, Math.round(index)));
}

export function getResponsivePagerOffset(index: number, pageWidth: number, pageCount: number): number {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return 0;
  return clampPagerIndex(index, pageCount) * pageWidth;
}

export function getResponsivePagerIndex(offset: number, pageWidth: number, pageCount: number): number {
  if (!Number.isFinite(offset) || !Number.isFinite(pageWidth) || pageWidth <= 0) return 0;
  return clampPagerIndex(Math.round(Math.max(0, offset) / pageWidth), pageCount);
}
