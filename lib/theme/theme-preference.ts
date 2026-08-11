import type { ColorScheme } from "@/constants/theme";

/** 主题偏好：默认跟随系统；手动选择只在当前运行期间覆盖系统。 */
export type ThemePreference = "system" | ColorScheme;

export function normalizeSystemScheme(scheme: ColorScheme | null | undefined): ColorScheme {
  return scheme === "dark" ? "dark" : "light";
}

/** 根据用户偏好和系统外观得出唯一有效主题。 */
export function resolveThemeScheme(
  preference: ThemePreference,
  systemScheme: ColorScheme | null | undefined,
): ColorScheme {
  return preference === "system" ? normalizeSystemScheme(systemScheme) : preference;
}

/** 系统外观变化只有在跟随系统时才会改变有效主题。 */
export function shouldApplySystemAppearance(preference: ThemePreference): boolean {
  return preference === "system";
}
