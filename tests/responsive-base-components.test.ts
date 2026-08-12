import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RESPONSIVE_LAYOUT, RESPONSIVE_UI_RULES } from "../lib/theme/responsive-layout-tokens";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("基础组件响应式布局 Token", () => {
  it("定义可收缩内容、固定项、可换行选项、操作文字和Sheet边界的统一约束", () => {
    expect(RESPONSIVE_LAYOUT.fluidRowContent).toEqual({ flex: 1, minWidth: 0 });
    expect(RESPONSIVE_LAYOUT.fixedRowItem.flexShrink).toBe(0);
    expect(RESPONSIVE_LAYOUT.wrapOption.maxWidth).toBe("100%");
    expect(RESPONSIVE_LAYOUT.wrapOption.flexShrink).toBe(1);
    expect(RESPONSIVE_LAYOUT.sheetContent.width).toBe("100%");
    expect(RESPONSIVE_UI_RULES.option).toContain("两行");
  });

  it("全局搜索框将输入文本设为可收缩内容，图标和清除按钮保持固定", () => {
    const source = read("components/search-bar.tsx");
    expect(source).toContain('RESPONSIVE_LAYOUT.fluidRowContent, styles.input');
    expect(source).toContain('style={RESPONSIVE_LAYOUT.fixedRowItem}');
    expect(source).toContain('minWidth: 0');
  });

  it("筛选、批量编辑和单位选择抽屉的长选项均可在自身容器换行", () => {
    const filter = read("components/filter-sort-sheet.tsx");
    const bulk = read("components/bulk-action-bar.tsx");
    const unit = read("components/unit-picker-sheet.tsx");

    expect(filter).toContain('RESPONSIVE_LAYOUT.wrapOption');
    expect(filter).toContain('numberOfLines={2}');
    expect(filter).toContain('adjustsFontSizeToFit');
    expect(bulk).toContain('RESPONSIVE_LAYOUT.wrapOption');
    expect(bulk).toContain('numberOfLines={2}');
    expect(unit).toContain('RESPONSIVE_LAYOUT.wrapOption');
    expect(unit).toContain('numberOfLines={2}');
  });

  it("两个可访问的个人中心入口均允许长说明换行，且正文容器可在箭头和状态点之间安全收缩", () => {
    for (const page of ["app/(tabs)/me.tsx", "app/me.tsx"]) {
      const source = read(page);
      expect(source).toContain("rowContent:");
      expect(source).toContain("minWidth: 0");
      expect(source).toContain("style={styles.rowContent}");
      expect(source).toContain("numberOfLines={2}");
    }
  });

  it("链接选择抽屉和底部Tab栏保留长文字与固定控制元素的边界", () => {
    const link = read("components/link-picker-sheet.tsx");
    const tab = read("components/floating-tab-bar.tsx");

    expect(link).toContain('RESPONSIVE_LAYOUT.sheetContent');
    expect(link).toContain('RESPONSIVE_LAYOUT.fluidRowContent');
    expect(link).toContain('RESPONSIVE_LAYOUT.fixedRowItem');
    expect(link).toContain('RESPONSIVE_LAYOUT.actionText');
    expect(tab).toContain('minWidth: 0');
    expect(tab).toContain('adjustsFontSizeToFit');
    expect(tab).toContain('minimumFontScale={0.75}');
  });
});
