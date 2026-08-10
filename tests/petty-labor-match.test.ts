/**
 * Suite P：备用金员工匹配测试
 * 验证 extractKeywords 和 matchEmployeeFromDescription 的正确性
 * 重点覆盖：单字符中文（如"宇"）匹配员工"小宇"的场景
 */
import { describe, it, expect } from "vitest";
import { extractKeywords, matchEmployeeFromDescription } from "../lib/store/petty-labor-link-store";
import type { NameAlias } from "../lib/store/petty-labor-link-store";

// ─── 测试 extractKeywords ────────────────────────────────────────────────────

describe("Suite P1：extractKeywords", () => {
  it("英文名 'Stephen' → ['stephen']", () => {
    expect(extractKeywords("Stephen")).toEqual(["stephen"]);
  });

  it("'w (pd) Stephen' → ['stephen']（去掉 w/pd 前缀）", () => {
    expect(extractKeywords("w (pd) Stephen")).toEqual(["stephen"]);
  });

  it("'pd (pt) Jason' → 包含 'jason'", () => {
    const kws = extractKeywords("pd (pt) Jason");
    expect(kws).toContain("jason");
  });

  it("单字符中文 '宇' → ['宇']（不再被过滤）", () => {
    expect(extractKeywords("宇")).toEqual(["宇"]);
  });

  it("多字中文 '小宇' → ['小宇']", () => {
    expect(extractKeywords("小宇")).toEqual(["小宇"]);
  });

  it("空字符串 → []", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("纯空格 → []", () => {
    expect(extractKeywords("   ")).toEqual([]);
  });
});

// ─── 测试 matchEmployeeFromDescription ───────────────────────────────────────

const EMPLOYEES = [
  { id: "emp-stephen", code: "Stephen", realName: "张忠洋" },
  { id: "emp-jason",   code: "Jason",   realName: "林宗利" },
  { id: "emp-xiaoyu",  code: "小宇",    realName: "王宇" },
  { id: "emp-rg",      code: "RG",      realName: "瑞雪" },
];
const NO_ALIASES: NameAlias[] = [];

describe("Suite P2：matchEmployeeFromDescription — 英文名匹配", () => {
  it("'w (pd) Stephen' → 匹配 emp-stephen", () => {
    const r = matchEmployeeFromDescription("w (pd) Stephen", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-stephen");
    expect(r.matchType).toBe("auto");
  });

  it("'pd (pt) Jason' → 匹配 emp-jason", () => {
    const r = matchEmployeeFromDescription("pd (pt) Jason", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-jason");
    expect(r.matchType).toBe("auto");
  });

  it("'Stephen' 直接 → 匹配 emp-stephen", () => {
    const r = matchEmployeeFromDescription("Stephen", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-stephen");
  });
});

describe("Suite P2：matchEmployeeFromDescription — 单字符中文匹配（Bug 修复）", () => {
  it("'宇' → 匹配 emp-xiaoyu（code='小宇' 包含 '宇'）", () => {
    const r = matchEmployeeFromDescription("宇", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
    expect(r.matchType).toBe("auto");
  });

  it("'小宇' → 匹配 emp-xiaoyu", () => {
    const r = matchEmployeeFromDescription("小宇", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
  });

  it("'王宇' → 匹配 emp-xiaoyu（realName 包含）", () => {
    const r = matchEmployeeFromDescription("王宇", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
  });
});

describe("Suite P2：matchEmployeeFromDescription — 未匹配场景", () => {
  it("'未知人员' → unmatched", () => {
    const r = matchEmployeeFromDescription("未知人员", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
    expect(r.matchType).toBe("unmatched");
  });

  it("空字符串 → unmatched", () => {
    const r = matchEmployeeFromDescription("", NO_ALIASES, EMPLOYEES);
    expect(r.matchType).toBe("unmatched");
  });
});

describe("Suite P2：matchEmployeeFromDescription — 别名优先", () => {
  it("别名映射命中时优先于直接匹配", () => {
    const aliases: NameAlias[] = [
      { id: "alias-1", keyword: "\u5c0f\u5b87", employeeId: "emp-xiaoyu", useCount: 5, lastUsedAt: "" },
    ];
    const r = matchEmployeeFromDescription("小宇", aliases, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
    expect(r.matchType).toBe("auto");
  });
});

// ─── Suite P3：人力总览"已发"合计逻辑 ───────────────────────────────────────

describe("Suite P3：人力总览已发合计（totalAdvancePaid）", () => {
  it("全员预支场景：已发 = pettyLaborPaid + advanceAmount 之和", () => {
    const monthSlips = [
      { finalSalary: 2500, pettyLaborPaid: 0, advanceAmount: 0 },       // RG
      { finalSalary: 0, pettyLaborPaid: 7400, advanceAmount: 0 },       // Stephen (3笔)
      { finalSalary: 0, pettyLaborPaid: 79.80, advanceAmount: 0 },      // Jason
      { finalSalary: 0, pettyLaborPaid: 1860, advanceAmount: 0 },       // 小宇
    ];
    const totalAdvancePaid = monthSlips.reduce((s, p) => s + (p.pettyLaborPaid ?? 0) + (p.advanceAmount ?? 0), 0);
    expect(totalAdvancePaid).toBeCloseTo(9339.80);
  });

  it("旧逻辑（差值法）在全员预支场景下错误返回 0", () => {
    const monthSlips = [
      { finalSalary: 0, pettyLaborPaid: 5000, advanceAmount: 0 },
    ];
    const totalSalary = monthSlips.reduce((s, p) => s + p.finalSalary, 0);
    const totalPending = monthSlips.reduce((s, p) => s + Math.max(0, p.finalSalary), 0);
    // 旧逻辑：已发 = totalSalary - totalPending = 0 - 0 = 0（错误）
    expect(totalSalary - totalPending).toBe(0);
    // 新逻辑：已发 = pettyLaborPaid = 5000（正确）
    const totalAdvancePaid = monthSlips.reduce((s, p) => s + (p.pettyLaborPaid ?? 0) + (p.advanceAmount ?? 0), 0);
    expect(totalAdvancePaid).toBe(5000);
  });

  it("无预支时已发显示 0（显示 —）", () => {
    const monthSlips = [
      { finalSalary: 2500, pettyLaborPaid: 0, advanceAmount: 0 },
    ];
    const totalAdvancePaid = monthSlips.reduce((s, p) => s + (p.pettyLaborPaid ?? 0) + (p.advanceAmount ?? 0), 0);
    expect(totalAdvancePaid).toBe(0);
  });
});
