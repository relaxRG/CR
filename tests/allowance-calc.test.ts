/**
 * 补贴计算逻辑单元测试
 *
 * 覆盖场景：
 * 1. 日补贴（meal_per_day）必须乘以出勤天数
 * 2. 固定补贴（transport_fixed / custom_fixed）不受出勤天数影响
 * 3. 补贴禁用时返回 0
 * 4. 季度/年度补贴的发放月判断
 * 5. 取消绩效后 allowanceOverrides=false 时补贴清零
 * 6. 全勤奖（custom_fixed）逻辑
 * 7. 出勤天数为 0 时日补贴为 0
 * 8. 混合补贴规则的合计计算
 */

import { describe, it, expect } from "vitest";
import {
  calcAllowance,
  shouldPayAllowanceThisMonth,
  AllowanceRule,
} from "../lib/labor/types";

// ─── 辅助工厂 ─────────────────────────────────────────────────────────────────
function makeRule(overrides: Partial<AllowanceRule>): AllowanceRule {
  return {
    id: "rule-1",
    type: "meal_per_day",
    label: "饭补",
    amount: 15,
    unit: "per_day",
    enabled: true,
    ...overrides,
  };
}

// ─── 1. 日补贴（meal_per_day）乘以出勤天数 ────────────────────────────────────
describe("日补贴（meal_per_day）", () => {
  it("出勤 27 天，¥15/天 → ¥405", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 15 });
    const { amount } = calcAllowance(rule, 27);
    expect(amount).toBe(405);
  });

  it("出勤 26 天，¥15/天 → ¥390", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 15 });
    const { amount } = calcAllowance(rule, 26);
    expect(amount).toBe(390);
  });

  it("出勤 0 天，¥15/天 → ¥0（不应发放）", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 15 });
    const { amount } = calcAllowance(rule, 0);
    expect(amount).toBe(0);
  });

  it("disabled 规则返回 0，不受出勤天数影响", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 15, enabled: false });
    const { amount } = calcAllowance(rule, 27);
    expect(amount).toBe(0);
  });

  it("autoNote 包含正确的计算说明", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 15 });
    const { autoNote } = calcAllowance(rule, 27);
    expect(autoNote).toContain("27天");
    expect(autoNote).toContain("¥15");
    expect(autoNote).toContain("405");
  });
});

// ─── 2. 固定补贴（transport_fixed）不受出勤天数影响 ──────────────────────────
describe("固定交通补贴（transport_fixed）", () => {
  it("出勤任意天数，固定 ¥200 → ¥200", () => {
    const rule = makeRule({ type: "transport_fixed", amount: 200 });
    expect(calcAllowance(rule, 27).amount).toBe(200);
    expect(calcAllowance(rule, 1).amount).toBe(200);
    expect(calcAllowance(rule, 0).amount).toBe(200);
  });

  it("disabled 规则返回 0", () => {
    const rule = makeRule({ type: "transport_fixed", amount: 200, enabled: false });
    expect(calcAllowance(rule, 27).amount).toBe(0);
  });
});

// ─── 3. 自定义固定补贴（custom_fixed）─────────────────────────────────────────
describe("自定义固定补贴（custom_fixed）", () => {
  it("全勤奖 ¥500，出勤任意天数 → ¥500（固定额，不按天计）", () => {
    // 全勤奖是固定补贴，应明确指定 unit: "per_month"
    const rule = makeRule({ type: "custom_fixed", label: "全勤奖", amount: 500, unit: "per_month" });
    expect(calcAllowance(rule, 27).amount).toBe(500);
    expect(calcAllowance(rule, 0).amount).toBe(500);
  });

  it("disabled 全勤奖返回 0", () => {
    const rule = makeRule({ type: "custom_fixed", amount: 500, unit: "per_month", enabled: false });
    expect(calcAllowance(rule, 27).amount).toBe(0);
  });

  // 修复验证： custom_fixed + per_day 应乘以出勤天数
  it("custom_fixed + per_day：餐补 ¥30/天 × 26天 = ¥780", () => {
    const rule = makeRule({ type: "custom_fixed", label: "餐补", amount: 30, unit: "per_day" });
    expect(calcAllowance(rule, 26).amount).toBe(780);
  });

  it("custom_fixed + per_day：出勤 0 天 → ¥0", () => {
    const rule = makeRule({ type: "custom_fixed", label: "餐补", amount: 30, unit: "per_day" });
    expect(calcAllowance(rule, 0).amount).toBe(0);
  });

  it("custom_fixed + per_day：不同出勤天数结果不同（不是固定额）", () => {
    const rule = makeRule({ type: "custom_fixed", label: "餐补", amount: 30, unit: "per_day" });
    expect(calcAllowance(rule, 20).amount).toBe(600);
    expect(calcAllowance(rule, 26).amount).toBe(780);
    expect(calcAllowance(rule, 30).amount).toBe(900);
  });

  it("custom_fixed + per_month：不受出勤天数影响（固定额）", () => {
    const rule = makeRule({ type: "custom_fixed", label: "交通补贴", amount: 200, unit: "per_month" });
    expect(calcAllowance(rule, 0).amount).toBe(200);
    expect(calcAllowance(rule, 26).amount).toBe(200);
  });

  it("custom_fixed + per_day autoNote 包含天数计算说明", () => {
    const rule = makeRule({ type: "custom_fixed", label: "餐补", amount: 30, unit: "per_day" });
    const { autoNote } = calcAllowance(rule, 26);
    expect(autoNote).toContain("26天");
    expect(autoNote).toContain("780");
  });
});

// ─── 4. 季度/年度补贴发放月判断 ───────────────────────────────────────────────
describe("shouldPayAllowanceThisMonth - 季度补贴（natural）", () => {
  it("自然季度：3月发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "natural" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-03")).toBe(true);
  });

  it("自然季度：6月发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "natural" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-06")).toBe(true);
  });

  it("自然季度：9月发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "natural" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-09")).toBe(true);
  });

  it("自然季度：12月发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "natural" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-12")).toBe(true);
  });

  it("自然季度：非季末月（如7月）不发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "natural" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-07")).toBe(false);
  });
});

describe("shouldPayAllowanceThisMonth - 年度补贴（natural）", () => {
  it("自然年度：12月发放", () => {
    const rule = makeRule({ unit: "per_year", periodMode: "natural" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-12")).toBe(true);
  });

  it("自然年度：非12月不发放", () => {
    const rule = makeRule({ unit: "per_year", periodMode: "natural" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-08")).toBe(false);
  });
});

describe("shouldPayAllowanceThisMonth - 滚动季度（rolling）", () => {
  it("滚动季度：生效月 2026-01，第3个月（2026-03）发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "rolling", effectiveMonth: "2026-01" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-03")).toBe(true);
  });

  it("滚动季度：生效月 2026-01，第6个月（2026-06）发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "rolling", effectiveMonth: "2026-01" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-06")).toBe(true);
  });

  it("滚动季度：生效月 2026-01，第2个月（2026-02）不发放", () => {
    const rule = makeRule({ unit: "per_quarter", periodMode: "rolling", effectiveMonth: "2026-01" });
    expect(shouldPayAllowanceThisMonth(rule, "2026-02")).toBe(false);
  });
});

// ─── 5. 混合补贴规则合计计算 ───────────────────────────────────────────────────
describe("混合补贴规则合计", () => {
  it("饭补 ¥15/天×27天 + 交通补贴 ¥200 = ¥605", () => {
    const rules: AllowanceRule[] = [
      makeRule({ id: "meal", type: "meal_per_day", amount: 15 }),
      makeRule({ id: "transport", type: "transport_fixed", amount: 200 }),
    ];
    const total = rules.reduce((sum, r) => sum + calcAllowance(r, 27).amount, 0);
    expect(total).toBe(605);
  });

  it("取消饭补（allowanceEnabled=false）后合计只含交通补贴 ¥200", () => {
    const rules: AllowanceRule[] = [
      makeRule({ id: "meal", type: "meal_per_day", amount: 15 }),
      makeRule({ id: "transport", type: "transport_fixed", amount: 200 }),
    ];
    const allowanceEnabled: Record<string, boolean> = { meal: false, transport: true };
    const total = rules.reduce((sum, r) => {
      if (!allowanceEnabled[r.id]) return sum;
      return sum + calcAllowance(r, 27).amount;
    }, 0);
    expect(total).toBe(200);
  });

  it("全部取消后合计为 0", () => {
    const rules: AllowanceRule[] = [
      makeRule({ id: "meal", type: "meal_per_day", amount: 15 }),
      makeRule({ id: "transport", type: "transport_fixed", amount: 200 }),
    ];
    const allowanceEnabled: Record<string, boolean> = { meal: false, transport: false };
    const total = rules.reduce((sum, r) => {
      if (!allowanceEnabled[r.id]) return sum;
      return sum + calcAllowance(r, 27).amount;
    }, 0);
    expect(total).toBe(0);
  });
});

// ─── 6. 边界值测试 ─────────────────────────────────────────────────────────────
describe("边界值", () => {
  it("日补贴金额为小数（¥12.5/天×26天 = ¥325）", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 12.5 });
    expect(calcAllowance(rule, 26).amount).toBe(325);
  });

  it("日补贴金额为 0 → 合计为 0", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 0 });
    expect(calcAllowance(rule, 27).amount).toBe(0);
  });

  it("出勤天数为 31 天（最大月份）", () => {
    const rule = makeRule({ type: "meal_per_day", amount: 15 });
    expect(calcAllowance(rule, 31).amount).toBe(465);
  });
});

// ─── 7. 升级验证：unit 统一计算（不依赖 type 的 switch-case）────────────────────
describe("升级验证：unit 统一决定计算方式", () => {
  it("任意 type + unit=per_day → 乘以出勤天数", () => {
    // 模拟旧版创建的规则：type 可能是任意值，但 unit 明确为 per_day
    const rule = makeRule({ type: "custom_fixed" as any, label: "餐补", amount: 15, unit: "per_day" });
    expect(calcAllowance(rule, 27).amount).toBe(405);
  });

  it("未知 type + unit=per_day → 仍然乘以天数（不走 default 分支返回固定值）", () => {
    const rule = makeRule({ type: "unknown_type" as any, label: "餐补", amount: 15, unit: "per_day" });
    expect(calcAllowance(rule, 27).amount).toBe(405);
  });

  it("meal_per_day 迁移后 unit=per_day → 正确乘以天数", () => {
    // 旧版 meal_per_day 规则经过迁移后 unit 被补充为 "per_day"
    const rule: any = { id: "r1", type: "meal_per_day", label: "饭补", amount: 15, unit: "per_day", enabled: true };
    expect(calcAllowance(rule, 27).amount).toBe(405);
  });

  it("custom_fixed 无 unit 字段 → 默认 per_month（固定值）", () => {
    const rule: any = { id: "r1", type: "custom_fixed", label: "全勤奖", amount: 500, enabled: true };
    expect(calcAllowance(rule, 27).amount).toBe(500);
    expect(calcAllowance(rule, 0).amount).toBe(500);
  });

  it("transport_fixed 无 unit 字段 → 默认 per_month（固定值）", () => {
    const rule: any = { id: "r1", type: "transport_fixed", label: "交通", amount: 200, enabled: true };
    expect(calcAllowance(rule, 27).amount).toBe(200);
  });

  it("per_day 补贴随出勤天数动态变化（子豪场景：¥15/天）", () => {
    const rule = makeRule({ type: "custom_fixed", label: "餐补", amount: 15, unit: "per_day" });
    expect(calcAllowance(rule, 1).amount).toBe(15);
    expect(calcAllowance(rule, 10).amount).toBe(150);
    expect(calcAllowance(rule, 27).amount).toBe(405);
    expect(calcAllowance(rule, 31).amount).toBe(465);
  });
});
