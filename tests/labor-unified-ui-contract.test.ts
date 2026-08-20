import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

describe("员工统一 UI 契约", () => {
  const labor = source("components/labor/LaborWorkspaceScreen.tsx");

  it("工资卡恢复原有五项摘要与展开明细，预支与实发仍由原始结算路径展示", () => {
    expect(labor).toContain("5格摘要行");
    expect(labor).toContain('label: "加班考勤"');
    expect(labor).toContain('label: "综合额外"');
    expect(labor).toContain('label: "已预支", value: advanceAmount');
    expect(labor).toContain('label: "总工资"');
    expect(labor).toContain("{metrics.map(({ label, value, color }) => (");
    expect(labor).not.toContain("visibleMetricColumns === 3");
    expect(labor).toContain("实发薪资");
    expect(labor).toContain("考勤明细（5格）");
  });

  it("iPhone 工资卡完整展示五项摘要，加班考勤与综合额外均为中性深色，后厨总工资跟随实发颜色", () => {
    expect(labor).toContain('label: "加班考勤", value: overtimeAndHoliday > 0 ? `+¥${formatMoney(overtimeAndHoliday)}` : "—", color: overtimeAndHoliday > 0 ? storeTone(colors, "neutral")');
    expect(labor).toContain('label: "综合额外", value: extraTotal !== 0 ? `${extraTotal >= 0 ? "+" : ""}¥${formatMoney(extraTotal)}` : "—", color: extraTotal !== 0 ? storeTone(colors, "neutral")');
    expect(labor).toContain('label: "总工资", value: finalSalary !== null ? `¥${formatMoney(finalSalary)}` : "—", color: deptColor');
  });

  it("人力总览恢复原始自适应结构，不再被强制为一行四列", () => {
    expect(labor).toContain("const summaryColumns = getStoreSummaryColumns(width)");
    expect(labor).toContain('flexWrap: "wrap"');
    expect(labor).toContain('label: "待发"');
    expect(labor).toContain('label: "已预支"');
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
