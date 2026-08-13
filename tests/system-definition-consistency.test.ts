import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("系统定义一致性", () => {
  it("薪资术语规范将绩效补贴与综合额外定义为唯一派生公式", () => {
    const terms = read("docs/payroll-terms-and-realtime-settlement.md");
    expect(terms).toContain("`补贴合计 + 工作绩效 + 业绩绩效`");
    expect(terms).toContain("`绩效补贴 + 奖惩小计`");
    expect(terms).toContain("零出勤为零");
  });

  it("生产薪资代码不再将已删除的聚合字段作为现行计算或回退来源", () => {
    const payroll = read("lib/labor/payroll-extras.ts");
    const laborPage = read("app/labor.tsx");
    expect(payroll).not.toMatch(/\.performanceBonus\b|\.salesCommission\b/);
    expect(laborPage).not.toMatch(/\.performanceBonus\b|\.salesCommission\b/);
    expect(payroll).toContain("settlePayrollExtras");
    expect(laborPage).toContain("resolveDraftPayrollExtrasForDisplay");
    expect(laborPage).toContain("resolvePersistedPayrollExtrasForDisplay");
  });

  it("月度状态定义明确：DRAFT可重算，FROZEN和ADJUSTING不得覆盖冻结基线", () => {
    const guards = read("lib/labor/payroll-sync-guards.ts");
    const close = read("lib/labor/month-close.ts");
    expect(guards).toContain("DRAFT：尚未确认的实时月份");
    expect(guards).toContain("FROZEN：已确认发薪，禁止任何自动写入");
    expect(close).toContain('return "adjusting"');
    expect(close).toContain('? "frozen" : "draft"');
  });

  it("强制重算文案限定为所选DRAFT月，不使用跨月删除语义", () => {
    const labor = read("app/labor.tsx");
    expect(labor).toContain("重新计算所选月草稿薪资");
    expect(labor).toContain("不会修改其他月份或已确认发薪数据");
    expect(labor).toContain('getRosterMonthStatus(month) !== "draft"');
  });
});
