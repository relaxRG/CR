import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  clampPagerIndex,
  getResponsivePagerIndex,
  getResponsivePagerOffset,
} from "../lib/theme/responsive-pager";

const root = path.resolve(__dirname, "..");

describe("响应式横向分页几何规则", () => {
  it("将异常、负数和越界页索引钳制在可用范围", () => {
    expect(clampPagerIndex(-1, 3)).toBe(0);
    expect(clampPagerIndex(9, 3)).toBe(2);
    expect(clampPagerIndex(Number.NaN, 3)).toBe(0);
    expect(clampPagerIndex(1, 0)).toBe(0);
  });

  it("始终以当前实时页宽计算偏移，不依赖任何历史宽度", () => {
    expect(getResponsivePagerOffset(1, 375, 3)).toBe(375);
    expect(getResponsivePagerOffset(1, 1024, 3)).toBe(1024);
    expect(getResponsivePagerOffset(2, 1440, 3)).toBe(2880);
    expect(getResponsivePagerOffset(1, 0, 3)).toBe(0);
  });

  it("在滑动停靠、边界偏移和无效页宽时保持正确页索引", () => {
    expect(getResponsivePagerIndex(0, 375, 2)).toBe(0);
    expect(getResponsivePagerIndex(187, 375, 2)).toBe(0);
    expect(getResponsivePagerIndex(188, 375, 2)).toBe(1);
    expect(getResponsivePagerIndex(5000, 375, 2)).toBe(1);
    expect(getResponsivePagerIndex(-80, 375, 2)).toBe(0);
    expect(getResponsivePagerIndex(200, 0, 2)).toBe(0);
  });

  it("连续缩放后的相同逻辑页使用新页宽重建偏移", () => {
    const activeSchedulePage = 1;
    const widths = [1024, 1280, 1440];
    expect(widths.map((width) => getResponsivePagerOffset(activeSchedulePage, width, 3))).toEqual([1024, 1280, 1440]);
  });

  it("不允许无分页需求的库存页面保留可误用的模块级静态宽度快照", () => {
    const spiritsSource = fs.readFileSync(path.join(root, "components/inventory/SpiritsInventoryWorkspaceScreen.tsx"), "utf8");
    expect(spiritsSource).not.toContain("Dimensions.get(\"window\")");
    expect(spiritsSource).not.toContain("SCREEN_W");
  });
});
