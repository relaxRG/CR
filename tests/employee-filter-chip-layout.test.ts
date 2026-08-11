import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve(__dirname, "../app/labor-employees.tsx"), "utf8");

describe("员工档案顶部筛选标签布局", () => {
  it("部门文字和人数徽标均使用不可压缩的独立布局", () => {
    expect(source).toContain('numberOfLines={1} style={[S.filterLabel');
    expect(source).toContain('style={[S.filterCountBadge');
    expect(source).toContain('filterChip: {\n    flexDirection: "row", alignItems: "center", flexShrink: 0,');
    expect(source).toContain('filterLabel: { fontSize: 13, lineHeight: 18, fontWeight: "600", flexShrink: 0 }');
    expect(source).toContain('minWidth: 20, height: 20');
    expect(source).toContain('marginLeft: 6');
    expect(source).toContain('flexShrink: 0,\n  },');
  });

  it("筛选栏保留横向滚动容器，空间不足时不压缩标签内容或制造页面级溢出", () => {
    expect(source).toContain('<ScrollView horizontal showsHorizontalScrollIndicator={false}');
    expect(source).toContain('contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}');
  });
});
