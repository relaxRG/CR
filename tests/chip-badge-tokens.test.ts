import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CHIP_BADGE_LAYOUT, CHIP_BADGE_RULES, formatCompactCount } from "../lib/theme/chip-badge-tokens";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("标签与数量徽标 Design Token", () => {
  it("对筛选Chip、数量徽标和信息标签提供明确的不可压缩/换行约束", () => {
    expect(CHIP_BADGE_LAYOUT.scrollChip.flexShrink).toBe(0);
    expect(CHIP_BADGE_LAYOUT.scrollLabel.flexShrink).toBe(0);
    expect(CHIP_BADGE_LAYOUT.countBadge.flexShrink).toBe(0);
    expect(CHIP_BADGE_LAYOUT.countBadge.minWidth).toBe(20);
    expect(CHIP_BADGE_LAYOUT.wrapChip.maxWidth).toBe("100%");
    expect(CHIP_BADGE_RULES.scroll).toContain("不得被 flex 压缩");
  });

  it("将超大计数收敛为99+，避免固定徽标无限膨胀", () => {
    expect(formatCompactCount(0)).toBe("0");
    expect(formatCompactCount(3)).toBe("3");
    expect(formatCompactCount(99)).toBe("99");
    expect(formatCompactCount(100)).toBe("99+");
    expect(formatCompactCount(12_000)).toBe("99+");
    expect(formatCompactCount(Number.NaN)).toBe("0");
  });

  it("员工部门筛选、快捷筛选、变更标签和库存分类分段导航均保留对应窄屏护栏", () => {
    const employees = read("app/labor-employees.tsx");
    const quickFilters = read("components/quick-filter-chips.tsx");
    const labChanges = read("components/lab-change-chips.tsx");
    const inventory = read("components/store/inventory.tsx");

    expect(employees).toContain('CHIP_BADGE_LAYOUT.scrollChip');
    expect(employees).toContain('CHIP_BADGE_LAYOUT.countBadge');
    expect(employees).toContain('formatCompactCount(count)');
    expect(quickFilters).toContain('chip: {\n    flexShrink: 0,');
    expect(quickFilters).toContain('subChip: {\n    flexDirection: "row",\n    alignItems: "center",\n    gap: 3,\n    flexShrink: 0,');
    expect(labChanges).toContain('CHIP_BADGE_LAYOUT.wrapChip');
    expect(labChanges).toContain('numberOfLines={2}');
    expect(inventory).toContain("<StoreSegmentedTabs");
    expect(inventory).toContain('testID={mode === "shop" ? "shop-segmented-tabs" : "inventory-segmented-tabs"}');
    expect(read("components/store/store-visual-primitives.tsx")).toContain("minHeight: 40");
  });
});
