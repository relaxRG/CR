import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { numericColor, NUMERIC_COLOR_RULES, NUMERIC_TONE } from "../lib/theme/numeric-color-tokens";

const colors = { foreground: "#111111", primary: "#1677FF", error: "#FF3B30", muted: "#8E8E93" };
const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("数字颜色 Design Token", () => {
  it("只提供普通、主结果、异常和次要信息四种数值语义", () => {
    expect(numericColor(colors)).toBe(colors.foreground);
    expect(numericColor(colors, NUMERIC_TONE.primary)).toBe(colors.foreground);
    expect(numericColor(colors, NUMERIC_TONE.negative)).toBe(colors.error);
    expect(numericColor(colors, NUMERIC_TONE.muted)).toBe(colors.muted);
    expect(Object.keys(NUMERIC_COLOR_RULES)).toEqual(["value", "primary", "negative", "muted"]);
  });

  it("时段成本分析保留分类线条色，但不再使用分类色渲染金额文本", () => {
    const source = read("app/period-analysis.tsx");
    expect(source).toContain('import { numericColor } from "@/lib/theme/numeric-color-tokens";');
    expect(source).toContain("color: numericColor(colors) }}>{fmtRevenue(totals.avgDailyRevenue)}");
    expect(source).toContain("color: numericColor(colors), width: 50");
    expect(source).toContain("backgroundColor: color");
  });

  it("绩效汇总仅突出总额，工作绩效和业绩绩效等普通数值使用正文色", () => {
    const source = read("app/labor-kpi-allowance.tsx");
    expect(source).toContain('import { numericColor, NUMERIC_TONE } from "@/lib/theme/numeric-color-tokens";');
    expect(source).toContain("numericColor(colors, NUMERIC_TONE.primary) }]}>¥{formatMoney(grandTotal)}");
    expect(source).not.toContain("color: colors.success }]}>¥{formatMoney(workKPIBonus)}");
    expect(source).not.toContain("color: colors.success }]}>¥{formatMoney(revenueKPIBonus)}");
  });

});
