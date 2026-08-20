import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

describe("员工统一 UI 契约", () => {
  const labor = source("components/labor/LaborWorkspaceScreen.tsx");

  it("工资卡始终使用互不重叠的四项摘要，不以屏幕宽度删列", () => {
    expect(labor).toContain("固定四项工资摘要");
    expect(labor).toContain('label: "考勤调整"');
    expect(labor).toContain('label: "综合额外"');
    expect(labor).toContain('label: "总工资"');
    expect(labor).toContain("考勤明细（含比例底薪）");
    expect(labor).not.toContain("visibleMetricColumns");
    expect(labor).not.toContain('label: "已预支", value: advanceAmount');
  });

  it("六个工具在手机端完整同一行显示，且重算不再使用特殊强调或更多收纳", () => {
    const primitives = source("components/store/store-visual-primitives.tsx");
    const compare = source("components/labor/LaborCompareToggle.tsx");
    expect(labor).toContain('testID="payroll-inline-tools"');
    for (const label of ["员工", "核对", "重算", "导入", "导出"]) {
      expect(labor).toContain(`label="${label}"`);
    }
    expect((labor.match(/\bcompact\b/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(labor).toContain("<LaborCompareToggle compact");
    expect(labor).not.toContain('label="更多"');
    expect(labor).not.toContain("showMoreActions");
    expect(labor).not.toContain('label="重算" icon="arrow.clockwise" tone="primary" emphasis');
    expect(primitives).toContain("flex: compact ? 1 : undefined");
    expect(compare).toContain("compactButton: { minWidth: 0");
  });

  it("总览趋势保持轻量蓝灰层级，未选柱不得使用黑色强调", () => {
    expect(labor).toContain('backgroundColor: isCurrent ? colors.primary : isSelected ? colors.primary + "88" : colors.border + "B8"');
    expect(labor).not.toContain('backgroundColor: "#000"');
  });
});
