import { useWindowDimensions } from "react-native";

/**
 * 判断当前设备是否为平板/宽屏（宽度 ≥ 768pt）。
 * 用于 iPad 响应式布局：网格列数、分栏宽度等。
 *
 * 使用示例：
 * ```tsx
 * const isTablet = useIsTablet();
 * const numColumns = isTablet ? 2 : 1;
 * ```
 */
export function useIsTablet(): boolean {
  const { width } = useWindowDimensions();
  return width >= 768;
}

/**
 * 返回响应式列数：iPad 上 2 列，手机上 1 列。
 * 可传入 tabletColumns 自定义 iPad 列数（默认 2）。
 */
export function useResponsiveColumns(tabletColumns = 2): number {
  const isTablet = useIsTablet();
  return isTablet ? tabletColumns : 1;
}
