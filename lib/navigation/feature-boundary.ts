export type FeatureBoundary = "cocktail" | "wine" | "lab" | "food" | "store" | "core" | "all";

/**
 * 将稳定 URL 映射到 Provider 功能域。
 * 普通业务页只装配所属 Tab；数据管理、备份等跨域技术页走 all，
 * 以保持现有深链和管理能力而不在首屏装配全部业务仓库。
 */
export function resolveFeatureBoundary(pathname: string): FeatureBoundary {
  const path = pathname.split("?")[0] || "/";

  if (
    path === "/sync-log" ||
    path === "/device-manager" ||
    path === "/pair-device" ||
    path === "/me" ||
    path === "/role-guide" ||
    path === "/role-settings" ||
    path === "/card-tag-settings" ||
    path === "/backup" ||
    path === "/data-manager"
  ) return "core";

  if (
    path === "/" ||
    path.startsWith("/cocktail") ||
    path.startsWith("/recipe") ||
    path.startsWith("/bottle") ||
    path.startsWith("/homemade") ||
    path.startsWith("/menu") ||
    path.startsWith("/shopping") ||
    path.startsWith("/ice-settings") ||
    path.startsWith("/taxonomy-manager") ||
    path.startsWith("/tags") ||
    path.startsWith("/system-tags")
  ) return "cocktail";

  if (path.startsWith("/wine")) return "wine";

  if (path === "/lab" || path.startsWith("/lab/")) return "lab";

  if (
    path.startsWith("/food") && !path.startsWith("/food-inventory")
  ) return "food";

  if (
    path.startsWith("/store") ||
    path.startsWith("/labor") ||
    path.startsWith("/spirits-inventory") ||
    path.startsWith("/beer-inventory") ||
    path.startsWith("/ice-inventory") ||
    path.startsWith("/fruit-inventory") ||
    path.startsWith("/glassware-inventory") ||
    path.startsWith("/tableware-inventory") ||
    path.startsWith("/daily-inventory") ||
    path.startsWith("/equipment-inventory") ||
    path.startsWith("/monthly-summary") ||
    path.startsWith("/monthly-report-import") ||
    path.startsWith("/period-analysis") ||
    path.startsWith("/dish-analysis") ||
    path.startsWith("/petty-category-settings") ||
    path.startsWith("/supplier-import") ||
    path.startsWith("/suppliers")
  ) return "store";

  return "all";
}
