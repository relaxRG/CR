import { describe, expect, it } from "vitest";
import { floatingTabBulkBarInset, floatingTabContentInset, tabBarTopInset } from "@/lib/store/floating-tab-layout";

describe("门店浮动导航内容安全区", () => {
  it("内容预留始终高于浮动导航顶部并额外保留 16pt", () => {
    for (const bottomInset of [0, 8, 20, 34]) {
      expect(floatingTabContentInset(bottomInset)).toBe(tabBarTopInset(bottomInset) + 16);
      expect(floatingTabBulkBarInset(bottomInset)).toBeLessThan(floatingTabContentInset(bottomInset));
    }
  });

  it("Web 使用固定 12pt 浏览器底部基准，避免桌面窗口和移动端规则混淆", () => {
    expect(tabBarTopInset(0, true)).toBe(tabBarTopInset(34, true));
    expect(floatingTabContentInset(34, true)).toBe(tabBarTopInset(34, true) + 16);
  });
});
