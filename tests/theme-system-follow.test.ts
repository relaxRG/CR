import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeSystemScheme,
  resolveThemeScheme,
  shouldApplySystemAppearance,
} from "../lib/theme/theme-preference";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("系统深浅色模式动态跟随", () => {
  it("默认 system 偏好立即采纳系统浅色或深色主题", () => {
    expect(resolveThemeScheme("system", "light")).toBe("light");
    expect(resolveThemeScheme("system", "dark")).toBe("dark");
    expect(normalizeSystemScheme(null)).toBe("light");
  });

  it("固定浅色或深色仅覆盖有效主题，不应改写系统Appearance来源", () => {
    expect(resolveThemeScheme("light", "dark")).toBe("light");
    expect(resolveThemeScheme("dark", "light")).toBe("dark");
    expect(shouldApplySystemAppearance("system")).toBe(true);
    expect(shouldApplySystemAppearance("light")).toBe(false);
    expect(shouldApplySystemAppearance("dark")).toBe(false);
  });

  it("从手动模式回到 system 后应立即采用当前系统主题", () => {
    const manualScheme = resolveThemeScheme("dark", "light");
    const restoredSystemScheme = resolveThemeScheme("system", "light");
    expect(manualScheme).toBe("dark");
    expect(restoredSystemScheme).toBe("light");
  });

  it("主题Provider必须订阅系统Appearance变化，且不得再调用会锁死系统跟随的Appearance.setColorScheme", () => {
    const source = read("lib/theme-provider.tsx");
    expect(source).toContain('Appearance.addChangeListener');
    expect(source).toContain('window.matchMedia');
    expect(source).toContain('setObservedSystemScheme');
    expect(source).toContain('themePreference');
    expect(source).toContain('followSystemTheme');
    expect(source).not.toContain('Appearance.setColorScheme');
    expect(source).toContain('nativewindColorScheme.set(scheme)');
  });

  it("主题实验页允许手动覆盖后立即恢复跟随系统", () => {
    const source = read("app/dev/theme-lab.tsx");
    expect(source).toContain('followSystemTheme');
    expect(source).toContain('Follow system · current');
  });

  it("基础组件响应式布局修复持续受自动化测试覆盖", () => {
    const source = read("tests/responsive-base-components.test.ts");
    expect(source).toContain('全局搜索框将输入文本设为可收缩内容');
    expect(source).toContain('筛选、批量编辑和单位选择抽屉的长选项均可在自身容器换行');
    expect(source).toContain('链接选择抽屉和底部Tab栏保留长文字与固定控制元素的边界');
  });
});
