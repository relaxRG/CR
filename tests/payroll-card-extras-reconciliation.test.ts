import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  resolveDraftPayrollExtrasForDisplay,
  resolvePersistedPayrollExtrasForDisplay,
} from "../lib/labor/payroll-extras";
import type { Employee } from "../lib/labor/types";

function employeeBase(id: string, name: string): Employee {
  return {
    id,
    code: name,
    realName: name,
    dept: "front",
    type: "fulltime",
    active: true,
    archived: false,
    baseSalary: 0,
    overtimeHourlyRate: 0,
    restDaysPerMonth: 4,
  } as Employee;
}

describe("薪资卡唯一额外项解析", () => {
  it("瑞雪：卡片必须从已保存工作绩效控制字段得到补贴2500、工作绩效1700、综合额外4200", () => {
    const ruixue = {
      ...employeeBase("ruixue", "瑞雪"),
      allowanceRules: [{ id: "company", enabled: true, amount: 2500, unit: "yuan_per_month", frequency: "monthly", type: "fixed" }],
      workKPIRules: [{
        id: "dianping", enabled: true, name: "大众点评评分",
        tiers: [{ id: "score", label: "4.4", amount: 200, sortOrder: 1 }],
      }, {
        id: "rank", enabled: true, name: "大众点评榜单任意前8",
        tiers: [{ id: "met", label: "达到", amount: 300, sortOrder: 1 }],
      }, {
        id: "meituan", enabled: true, name: "美团差评维护",
        tiers: [{ id: "pass", label: "合格", amount: 500, sortOrder: 1 }],
      }, {
        id: "good", enabled: true, name: "美团好评数量",
        tiers: [{ id: "30", label: "30条", amount: 300, sortOrder: 1 }],
      }, {
        id: "media", enabled: true, name: "优质评论/媒体",
        tiers: [{ id: "2", label: "2组", amount: 400, sortOrder: 1 }],
      }],
    } as unknown as Employee;

    const extras = resolveDraftPayrollExtrasForDisplay(ruixue, "2026-08", 20, {
      allowanceOverrides: {},
      workKPISelections: { dianping: "score", rank: "met", meituan: "pass", good: "30", media: "2" },
      revenueActuals: {},
    });

    expect(extras.allowanceTotal).toBe(2500);
    expect(extras.workKPIBonus).toBe(1700);
    expect(extras.revenueKPIBonus).toBe(0);
    expect(extras.grandTotal).toBe(4200);
  });

  it("张忠洋：零出勤时旧薪资单有15元也不得使日饭补或综合额外变成15元", () => {
    const zhang = {
      ...employeeBase("zhang", "张忠洋"),
      allowanceRules: [{ id: "meal", enabled: true, amount: 15, unit: "per_day", frequency: "monthly", type: "meal_per_day" }],
    } as unknown as Employee;

    const draft = resolveDraftPayrollExtrasForDisplay(zhang, "2026-08", 0, {
      allowanceOverrides: {},
      allowanceDetails: { meal: { amount: 15, autoNote: "旧草稿：¥15/天", isOverride: false } },
    });
    expect(draft.mealAllowance).toBe(0);
    expect(draft.allowanceTotal).toBe(0);
    expect(draft.grandTotal).toBe(0);

    const stalePersisted = resolvePersistedPayrollExtrasForDisplay({
      mealAllowance: 15, transportAllowance: 0, otherAllowance: 0,
      workKPIBonus: 0, revenueKPIBonus: 0, rewardPenalty: 0,
    });
    expect(stalePersisted.grandTotal).toBe(15);
    expect(draft.grandTotal).not.toBe(stalePersisted.grandTotal);
  });

  it("冻结快照只读显示，不因后续规则或考勤变化而重新结算", () => {
    const frozen = resolvePersistedPayrollExtrasForDisplay({
      mealAllowance: 15, transportAllowance: 2500, otherAllowance: 0,
      workKPIBonus: 1700, revenueKPIBonus: 0, rewardPenalty: -20,
    });
    expect(frozen.allowanceTotal).toBe(2515);
    expect(frozen.grandTotal).toBe(4195);
  });

  it("薪资卡不再直接读取DRAFT旧聚合字段，五项综合额外必须强制单行", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/labor/LaborWorkspaceScreen.tsx"), "utf8");
    expect(source).toContain("resolveDraftPayrollExtrasForDisplay");
    expect(source).toContain('getMonthCloseStatus(month) !== "draft"');
    expect(source).toContain('flexDirection: "row", flexWrap: "nowrap"');
    expect(source).toContain('style={{ flex: 1, minWidth: 0, alignItems: "center", paddingVertical: 3 }}');
    expect(source).not.toContain('width: "33.333%", alignItems: "center", paddingVertical: 3');
  });
});
