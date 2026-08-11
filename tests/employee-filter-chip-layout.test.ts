import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "../app/labor-employees.tsx"), "utf8");

describe("员工档案顶部筛选标签布局", () => {
  it("部门文字和人数徽标均使用共享的不可压缩独立布局 Token", () => {
    expect(source).toContain('import { CHIP_BADGE_LAYOUT, formatCompactCount } from "@/lib/theme/chip-badge-tokens";');
    expect(source).toContain('style={[CHIP_BADGE_LAYOUT.scrollChip');
    expect(source).toContain('numberOfLines={1} style={[CHIP_BADGE_LAYOUT.scrollLabel');
    expect(source).toContain('style={[CHIP_BADGE_LAYOUT.countBadge');
    expect(source).toContain('formatCompactCount(count)');
  });

  it("筛选栏保留横向滚动容器，空间不足时不压缩标签内容或制造页面级溢出", () => {
    expect(source).toContain('<ScrollView horizontal showsHorizontalScrollIndicator={false}');
    expect(source).toContain('contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}');
  });
});
