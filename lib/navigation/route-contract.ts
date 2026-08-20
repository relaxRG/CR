export type RouteMode = "primary_tab" | "standalone" | "embedded_reusable" | "compat_redirect" | "system_callback" | "development_only";

export type RouteContract = Readonly<{
  path: string;
  mode: RouteMode;
  owner: string;
  target?: string;
}>;

/**
 * 路由事实来源。新增页面必须声明唯一 owner 与模式，兼容路由只能重定向，
 * 不允许重新挂载另一套同构工作台。
 */
export const ROUTE_CONTRACTS: readonly RouteContract[] = [
  { path: "/cocktail", mode: "primary_tab", owner: "cocktail.workspace" },
  { path: "/wine", mode: "primary_tab", owner: "wine.catalog" },
  { path: "/lab", mode: "primary_tab", owner: "lab.workspace" },
  { path: "/food", mode: "primary_tab", owner: "food.workspace" },
  { path: "/store", mode: "primary_tab", owner: "store.workspace" },

  { path: "/library", mode: "compat_redirect", owner: "cocktail.workspace", target: "/cocktail" },
  { path: "/", mode: "compat_redirect", owner: "cocktail.workspace", target: "/cocktail" },

  { path: "/me", mode: "standalone", owner: "profile.workspace" },
  { path: "/monthly-summary", mode: "embedded_reusable", owner: "reports.monthly" },
  { path: "/period-analysis", mode: "embedded_reusable", owner: "analytics.period" },
  { path: "/store-accounts", mode: "embedded_reusable", owner: "accounts.workspace" },
  { path: "/labor", mode: "embedded_reusable", owner: "labor.workspace" },
  { path: "/lab/plan", mode: "embedded_reusable", owner: "lab.plan" },

  { path: "/oauth/callback", mode: "system_callback", owner: "oauth.callback" },
  { path: "/dev/money-input-lab", mode: "development_only", owner: "development.money_input" },
  { path: "/dev/theme-lab", mode: "development_only", owner: "development.theme" },
] as const;

export function getRouteContract(path: string): RouteContract | undefined {
  return ROUTE_CONTRACTS.find((entry) => entry.path === path);
}

export function getCompatibilityRedirect(path: string): string | null {
  const entry = getRouteContract(path);
  return entry?.mode === "compat_redirect" ? entry.target ?? null : null;
}
