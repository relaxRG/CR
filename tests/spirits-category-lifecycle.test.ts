import { describe, expect, it } from "vitest";
import {
  canDeleteInventoryCategory,
  moveInventoryCategory,
  normalizeCategoryMigrationTarget,
  requiresCategoryContentHandling,
} from "../lib/spirits/category-lifecycle";

const categories = [
  { id: "gin", name: "Base (Gin)", builtin: true, order: 0 },
  { id: "whisky", name: "Base (Whisky)", builtin: true, order: 1 },
  { id: "custom", name: "自定义分类", builtin: false, order: 2 },
];

describe("进销存分类安全生命周期", () => {
  it("上下按钮只交换相邻分类的顺序，边界分类不可越界", () => {
    expect(moveInventoryCategory(categories, "whisky", "up")).toEqual([{ id: "whisky", order: 0 }, { id: "gin", order: 1 }]);
    expect(moveInventoryCategory(categories, "gin", "up")).toEqual([]);
    expect(moveInventoryCategory(categories, "custom", "down")).toEqual([]);
  });

  it("内置分类不能删除；有内容的自定义分类必须先处理内容", () => {
    expect(canDeleteInventoryCategory(categories[0], 0)).toBe(false);
    expect(requiresCategoryContentHandling(categories[0], 10)).toBe(false);
    expect(canDeleteInventoryCategory(categories[2], 4)).toBe(false);
    expect(requiresCategoryContentHandling(categories[2], 4)).toBe(true);
    expect(canDeleteInventoryCategory(categories[2], 0)).toBe(true);
  });

  it("空迁移目标被规范为未分类，不能被隐式改写为其他分类", () => {
    expect(normalizeCategoryMigrationTarget("  ")).toBe("");
    expect(normalizeCategoryMigrationTarget("Base (Gin)")).toBe("Base (Gin)");
  });
});
