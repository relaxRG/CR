import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("薪资与考勤数字颜色层级", () => {
  const labor = read("app/labor.tsx");
  const attendance = read("app/labor-attendance.tsx");

  it("薪资统计的综合额外只使用正文色、主结果色和负向异常色", () => {
    const extra = block(labor, "/* ─── 综合额外（5格）─── */", "{/* ─── 扣款（5格）─── */}");
    expect(extra).not.toContain("colors.success");
    expect(extra).not.toContain("colors.warning");
    expect(extra).not.toContain("#FF2D55");
    expect(extra).toContain("color: extraTotal >= 0 ? colors.primary : colors.error");
    expect(extra).toContain("color: reward < 0 ? colors.error : reward > 0 ? colors.foreground");
  });

  it("薪资统计的常规扣款仅依靠负号表达，不把预支、社保、公积金和个税全部标成红色", () => {
    const deductions = block(labor, "{/* ─── 扣款（5格）─── */}", "{/* ─── 实发薪资 + 公司社保公积金─── */}");
    expect(deductions).not.toContain("colors.error");
    expect(deductions).not.toContain("colors.warning");
    expect(deductions).toContain("color: advance > 0 ? colors.foreground : colors.muted");
    expect(deductions).toContain("color: tax > 0 ? colors.foreground : colors.muted");
  });

  it("考勤概况收起卡只突出待发和负向奖惩，普通金额保持正文色", () => {
    const compact = block(attendance, "const grid1 = [", "return (\n      <TouchableOpacity");
    expect(compact).toContain("{ label: \"待发\",     value: final,    color: colors.primary }");
    expect(compact).toContain("reward < 0 ? colors.error : colors.foreground");
    expect(compact).not.toContain("colors.success");
    expect(compact).not.toContain("colors.warning");
  });

  it("展开详情不再把每项正向金额染绿，保留主结果、真实异常和次要信息三层", () => {
    expect(attendance).toContain("const valueColor = primary ? colors.primary : negative ? colors.error : isMuted ? colors.muted : colors.foreground;");
    expect(attendance).not.toContain("positive ? colors.success");
  });
});
