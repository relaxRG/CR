import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getStoreDensity,
  getStoreSummaryColumns,
  getStoreVisibleMetricColumns,
  STORE_CATEGORY_TONES,
  STORE_TEXT,
  STORE_VISUAL_RULES,
  STORE_VISUAL_SYSTEM,
} from "../lib/theme/store-visual-system";

const root = resolve(__dirname, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("门店唯一视觉系统规范", () => {
  it("固定iPhone、iPad、Mac三端的舒适密度与最大内容宽度", () => {
    expect(getStoreDensity(390)).toBe("phone");
    expect(getStoreDensity(834)).toBe("tablet");
    expect(getStoreDensity(1280)).toBe("desktop");
    expect(getStoreSummaryColumns(390)).toBe(2);
    expect(getStoreSummaryColumns(834)).toBe(4);
    expect(getStoreVisibleMetricColumns(390)).toBe(3);
    expect(getStoreVisibleMetricColumns(834)).toBe(5);
    expect(getStoreVisibleMetricColumns(1280)).toBe(5);
    expect(STORE_VISUAL_SYSTEM.density.desktopContentMaxWidth).toBe(1240);
  });

  it("固定例行图标、文本字重和语义色彩的使用上限", () => {
    expect(STORE_VISUAL_SYSTEM.icon.section).toBe(14);
    expect(STORE_VISUAL_SYSTEM.icon.toolbar).toBe(16);
    expect(STORE_VISUAL_SYSTEM.icon.maximumRoutine).toBe(18);
    expect(STORE_TEXT.body.fontWeight).toBe("500");
    expect(STORE_TEXT.metric.fontWeight).toBe("600");
    expect(STORE_CATEGORY_TONES).toEqual(["primary", "overtime", "kitchen", "allowance", "danger", "front"]);
    expect(STORE_VISUAL_RULES.color).toContain("蓝=当前主操作/前厅");
    expect(STORE_VISUAL_RULES.type).toContain("禁止700/800/900");
  });

  it("报表、员工、备用金、库存和店铺均依赖共享视觉系统而非新建局部标准", () => {
    const consumers = [
      "app/(tabs)/store.tsx",
      "app/labor.tsx",
      "components/store/petty-cash.tsx",
      "components/store/inventory.tsx",
    ];
    consumers.slice(0, -1).forEach((path) => {
      expect(source(path), path).toContain("store-visual-system");
    });
    expect(source("components/store/inventory.tsx")).toContain("StoreSegmentedTabs");
    expect(source("components/store/shop.tsx")).toContain('<StoreInventoryScreen mode="shop" />');
  });

  it("门店根页与员工页使用共享分段页签，员工不再渲染重复英文部门字段", () => {
    expect(source("app/(tabs)/store.tsx")).toContain("StoreSegmentedTabs");
    const labor = source("app/labor.tsx");
    expect(labor).toContain("StoreSegmentedTabs");
    expect(labor).toContain("StoreSectionHeader");
    expect(labor).toContain("visibleMetricColumns === 3");
    expect(labor).not.toContain("{employee.dept}</Text>");
  });
});
