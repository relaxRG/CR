import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, Platform, View, useColorScheme as useSystemColorScheme } from "react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";

import { SchemeColors, type ColorScheme } from "@/constants/theme";
import {
  normalizeSystemScheme,
  resolveThemeScheme,
  shouldApplySystemAppearance,
  type ThemePreference,
} from "@/lib/theme/theme-preference";

type ThemeContextValue = {
  /** 当前实际应用到组件和 NativeWind 的配色。 */
  colorScheme: ColorScheme;
  /** 用户的选择；默认 system，表示随系统即时变化。 */
  themePreference: ThemePreference;
  /** 选择固定浅色或深色，仅覆盖当前运行期。 */
  setColorScheme: (scheme: ColorScheme) => void;
  /** 清除手动覆盖，立即回到系统当前主题并持续监听。 */
  followSystemTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * 统一主题根：系统 Appearance 是唯一外观来源；手动主题只保存在Provider状态中。
 * 不调用会强制覆盖系统外观的全局API，避免后续系统变化失效。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const hookSystemScheme = useSystemColorScheme();
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [observedSystemScheme, setObservedSystemScheme] = useState<ColorScheme>(() =>
    normalizeSystemScheme(hookSystemScheme ?? Appearance.getColorScheme()),
  );

  // Hook 变化作为兜底；原生 Appearance 订阅则保证运行期间即时接收变化。
  useEffect(() => {
    setObservedSystemScheme(normalizeSystemScheme(hookSystemScheme));
  }, [hookSystemScheme]);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme: next }) => {
      setObservedSystemScheme(normalizeSystemScheme(next));
    });
    return () => subscription.remove();
  }, []);

  // react-native-web 的 Appearance 事件在部分浏览器不会随媒体仿真/系统切换触发，
  // 因此额外直接订阅 matchMedia，确保 H5 与原生端都可在运行中立即切换。
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setObservedSystemScheme(event.matches ? "dark" : "light");
    };
    setObservedSystemScheme(media.matches ? "dark" : "light");
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  const colorScheme = resolveThemeScheme(themePreference, observedSystemScheme);

  const applyScheme = useCallback((scheme: ColorScheme) => {
    nativewindColorScheme.set(scheme);
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.theme = scheme;
      root.classList.toggle("dark", scheme === "dark");
      const palette = SchemeColors[scheme];
      Object.entries(palette).forEach(([token, value]) => {
        root.style.setProperty(`--color-${token}`, value);
      });
    }
  }, []);

  useEffect(() => {
    applyScheme(colorScheme);
  }, [applyScheme, colorScheme]);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setThemePreference(scheme);
  }, []);

  const followSystemTheme = useCallback(() => {
    setObservedSystemScheme(normalizeSystemScheme(Appearance.getColorScheme()));
    setThemePreference("system");
  }, []);

  const themeVariables = useMemo(
    () =>
      vars({
        "color-primary": SchemeColors[colorScheme].primary,
        "color-background": SchemeColors[colorScheme].background,
        "color-surface": SchemeColors[colorScheme].surface,
        "color-foreground": SchemeColors[colorScheme].foreground,
        "color-muted": SchemeColors[colorScheme].muted,
        "color-border": SchemeColors[colorScheme].border,
        "color-success": SchemeColors[colorScheme].success,
        "color-warning": SchemeColors[colorScheme].warning,
        "color-error": SchemeColors[colorScheme].error,
      }),
    [colorScheme],
  );

  const value = useMemo(
    () => ({
      colorScheme,
      themePreference,
      setColorScheme,
      followSystemTheme,
    }),
    [colorScheme, followSystemTheme, setColorScheme, themePreference],
  );

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}

/** 导出供测试与调用方明确区分系统监听和手动覆盖的语义。 */
export { shouldApplySystemAppearance };
