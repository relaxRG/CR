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

  it("薪资预支操作位于正常内容流，保留原有蓝紫颜色且不再以悬浮层遮挡内容或底部导航", () => {
    expect(labor).toContain('testID="advance-inline-actions"');
    expect(labor).toContain('paddingBottom: insets.bottom + 24');
    expect(labor).toContain('backgroundColor: "#5856D6"');
    expect(labor).toContain('backgroundColor: "#AF52DE"');
    expect(labor).not.toContain('position: "absolute", right: 20, bottom: fabBottom(insets.bottom) + 64');
    expect(labor).not.toContain('position: "absolute", right: 20, bottom: fabBottom(insets.bottom)');
  });

  it("人力总览在 iPhone、iPad 和 Mac 均保持一行四列，手机仅收紧列内边距而不换行", () => {
    expect(labor).toContain("const summaryColumns = 4");
    expect(labor).toContain("const isPhoneSummary = width <= STORE_VISUAL_SYSTEM.density.phoneMax");
    expect(labor).toContain('testID="labor-overview-four-column-row"');
    expect(labor).toContain('flexWrap: "nowrap"');
    expect(labor).toContain('paddingHorizontal: isPhoneSummary ? 4 : 8');
    expect(labor).toContain('label: "待发"');
    expect(labor).toContain('label: "已预支"');
  });

  it("人力分类管理表单在 iPad 浮窗与 Mac 宽窗口下保持居中适中宽度", () => {
    expect(labor).toContain('width: "100%", maxWidth: 720, alignSelf: "center", backgroundColor: colors.surface');
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
