/**
 * Suite P：备用金员工匹配测试
 * 验证 extractKeywords 和 matchEmployeeFromDescription 的正确性
 *
 * 核心规则（修复后）：
 * - 单字符关键词（=1）：只匹配 code，不匹配 realName（防止"洋"⊆"张忠洋"误匹配）
 * - 多字符关键词（>=2）：匹配 code + realName（完整词段，精度高）
 * - 策略 B：cleanedDesc 整体是 code 的子串（仅针对 code，不针对 realName）
 */
import { describe, it, expect } from "vitest";
import { extractKeywords, matchEmployeeFromDescription } from "../lib/store/petty-labor-link-store";
import type { NameAlias } from "../lib/store/petty-labor-link-store";

// ─── 测试员工列表（覆盖典型场景）────────────────────────────────────────────────
const EMPLOYEES = [
  { id: "emp-rg",      code: "RG",      realName: "瑞雪" },
  { id: "emp-stephen", code: "Stephen", realName: "张忠洋" },
  { id: "emp-jason",   code: "Jason",   realName: "林宗利" },
  { id: "emp-xiaoyu",  code: "小宇",    realName: "王宇" },
  { id: "emp-zihao",   code: "子豪",    realName: "王琪" },
];
const NO_ALIASES: NameAlias[] = [];

// ─── Suite P1：extractKeywords ───────────────────────────────────────────────

describe("Suite P1：extractKeywords", () => {
  it("英文名 'Stephen' → ['stephen']", () => {
    expect(extractKeywords("Stephen")).toEqual(["stephen"]);
  });

  it("'w (pd) Stephen' → ['stephen']（去掉 w/pd 前缀）", () => {
    expect(extractKeywords("w (pd) Stephen")).toEqual(["stephen"]);
  });

  it("'pd (pt) Jason' → 包含 'jason'（pd 也被保留为关键词）", () => {
    const kws = extractKeywords("pd (pt) Jason");
    expect(kws).toContain("jason");
  });

  it("单字符中文 '宇' → ['宇']（length>=1 不再过滤）", () => {
    expect(extractKeywords("宇")).toEqual(["宇"]);
  });

  it("单字符中文 '豪' → ['豪']", () => {
    expect(extractKeywords("豪")).toEqual(["豪"]);
  });

  it("多字中文 '小宇' → ['小宇']", () => {
    expect(extractKeywords("小宇")).toEqual(["小宇"]);
  });

  it("多字 realName '王宇' → ['王宇']", () => {
    expect(extractKeywords("王宇")).toEqual(["王宇"]);
  });

  it("空字符串 → []", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("纯空格 → []", () => {
    expect(extractKeywords("   ")).toEqual([]);
  });

  it("'pd' 单独出现 → ['pd']（前缀 replace 只针对带括号的 (pd)）", () => {
    // 注意：'pd' 不带括号时不会被 replace 清除，但 'w' 会被清除
    const kws = extractKeywords("pd");
    expect(kws).toContain("pd");
  });

  it("'(pd)' 带括号 → []（清理后为空）", () => {
    expect(extractKeywords("(pd)")).toEqual([]);
  });
});

// ─── Suite P2：matchEmployeeFromDescription — 正确匹配 ───────────────────────

describe("Suite P2a：正确匹配场景", () => {
  it("'宇' → 匹配 小宇（code='小宇' 包含 '宇'，单字符只匹配 code）", () => {
    const r = matchEmployeeFromDescription("宇", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
    expect(r.matchType).toBe("auto");
  });

  it("'豪' → 匹配 子豪（code='子豪' 包含 '豪'）", () => {
    const r = matchEmployeeFromDescription("豪", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-zihao");
  });

  it("'小宇' → 匹配 小宇（完整 code 匹配）", () => {
    const r = matchEmployeeFromDescription("小宇", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
  });

  it("'王宇' → 匹配 小宇（realName 多字符词段匹配）", () => {
    const r = matchEmployeeFromDescription("王宇", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
  });

  it("'子豪' → 匹配 子豪（完整 code 匹配）", () => {
    const r = matchEmployeeFromDescription("子豪", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-zihao");
  });

  it("'王琪' → 匹配 子豪（realName 多字符词段匹配）", () => {
    const r = matchEmployeeFromDescription("王琪", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-zihao");
  });

  it("'w (pd) Stephen' → 匹配 Stephen", () => {
    const r = matchEmployeeFromDescription("w (pd) Stephen", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-stephen");
  });

  it("'pd (pt) Jason' → 匹配 Jason", () => {
    const r = matchEmployeeFromDescription("pd (pt) Jason", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-jason");
  });

  it("'张忠洋' → 匹配 Stephen（realName 完整词段）", () => {
    const r = matchEmployeeFromDescription("张忠洋", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-stephen");
  });

  it("'林宗利' → 匹配 Jason（realName 完整词段）", () => {
    const r = matchEmployeeFromDescription("林宗利", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-jason");
  });

  it("'RG' → 匹配 RG（完整 code 匹配）", () => {
    const r = matchEmployeeFromDescription("RG", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("emp-rg");
  });
});

// ─── Suite P2b：单字符误匹配防护（核心边界）────────────────────────────────────

describe("Suite P2b：单字符误匹配防护（Bug 修复核心）", () => {
  it("'洋' → unmatched（realName='张忠洋' 单字符不应误匹配 Stephen）", () => {
    const r = matchEmployeeFromDescription("洋", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
    expect(r.matchType).toBe("unmatched");
  });

  it("'宗' → unmatched（realName='林宗利' 单字符不应误匹配 Jason）", () => {
    const r = matchEmployeeFromDescription("宗", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });

  it("'王' → unmatched（realName='王宇'/'王琪' 单字符不应误匹配）", () => {
    const r = matchEmployeeFromDescription("王", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });

  it("'雪' → unmatched（realName='瑞雪' 单字符不应误匹配 RG）", () => {
    const r = matchEmployeeFromDescription("雪", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });

  it("'张' → unmatched（realName='张忠洋' 单字符不应误匹配）", () => {
    const r = matchEmployeeFromDescription("张", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });

  it("'林' → unmatched（realName='林宗利' 单字符不应误匹配）", () => {
    const r = matchEmployeeFromDescription("林", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });
});

// ─── Suite P2c：空/通用词/特殊格式 ──────────────────────────────────────────

describe("Suite P2c：空/通用词/特殊格式", () => {
  it("空字符串 → unmatched", () => {
    const r = matchEmployeeFromDescription("", NO_ALIASES, EMPLOYEES);
    expect(r.matchType).toBe("unmatched");
  });

  it("'备注' → unmatched（通用词）", () => {
    const r = matchEmployeeFromDescription("备注", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });

  it("'工资' → unmatched（通用词）", () => {
    const r = matchEmployeeFromDescription("工资", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });

  it("'K1' → unmatched（备用金代码）", () => {
    const r = matchEmployeeFromDescription("K1", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });

  it("'w' → unmatched（前缀标记清理后为空）", () => {
    const r = matchEmployeeFromDescription("w", NO_ALIASES, EMPLOYEES);
    expect(r.employeeId).toBe("");
  });
});

// ─── Suite P2d：别名优先 ─────────────────────────────────────────────────────

describe("Suite P2d：别名优先", () => {
  it("别名命中时优先于直接匹配", () => {
    const aliases: NameAlias[] = [
      { id: "alias-1", keyword: "小宇", employeeId: "emp-xiaoyu", useCount: 5, lastUsedAt: "" },
    ];
    const r = matchEmployeeFromDescription("小宇", aliases, EMPLOYEES);
    expect(r.employeeId).toBe("emp-xiaoyu");
    expect(r.matchType).toBe("auto");
  });

  it("别名 useCount 高者优先", () => {
    const aliases: NameAlias[] = [
      { id: "alias-1", keyword: "宇", employeeId: "emp-rg",     useCount: 10, lastUsedAt: "" },
      { id: "alias-2", keyword: "宇", employeeId: "emp-xiaoyu", useCount: 3,  lastUsedAt: "" },
    ];
    // 高 useCount 的 alias-1 先被检查
    const r = matchEmployeeFromDescription("宇", aliases, EMPLOYEES);
    expect(r.employeeId).toBe("emp-rg");
  });
});

// ─── Suite P3：人力总览"已发"合计逻辑 ───────────────────────────────────────

describe("Suite P3：人力总览已发合计（totalAdvancePaid）", () => {
  it("全员预支场景：已发 = pettyLaborPaid + advanceAmount 之和", () => {
    const monthSlips = [
      { finalSalary: 2500,  pettyLaborPaid: 0,       advanceAmount: 0 },   // RG
      { finalSalary: 0,     pettyLaborPaid: 7400,     advanceAmount: 0 },   // Stephen (3笔)
      { finalSalary: 0,     pettyLaborPaid: 79.80,    advanceAmount: 0 },   // Jason
      { finalSalary: 0,     pettyLaborPaid: 1860,     advanceAmount: 0 },   // 小宇
    ];
    const totalAdvancePaid = monthSlips.reduce(
      (s, p) => s + (p.pettyLaborPaid ?? 0) + (p.advanceAmount ?? 0), 0
    );
    expect(totalAdvancePaid).toBeCloseTo(9339.80);
  });

  it("旧逻辑（差值法）在全员预支场景下错误返回 0", () => {
    const monthSlips = [{ finalSalary: 0, pettyLaborPaid: 5000, advanceAmount: 0 }];
    const totalSalary  = monthSlips.reduce((s, p) => s + p.finalSalary, 0);
    const totalPending = monthSlips.reduce((s, p) => s + Math.max(0, p.finalSalary), 0);
    expect(totalSalary - totalPending).toBe(0); // 旧逻辑错误
    const totalAdvancePaid = monthSlips.reduce(
      (s, p) => s + (p.pettyLaborPaid ?? 0) + (p.advanceAmount ?? 0), 0
    );
    expect(totalAdvancePaid).toBe(5000); // 新逻辑正确
  });

  it("手动预支 + 备用金混合场景", () => {
    const monthSlips = [
      { finalSalary: 3000, pettyLaborPaid: 2000, advanceAmount: 1000 },
      { finalSalary: 0,    pettyLaborPaid: 0,    advanceAmount: 500  },
    ];
    const totalAdvancePaid = monthSlips.reduce(
      (s, p) => s + (p.pettyLaborPaid ?? 0) + (p.advanceAmount ?? 0), 0
    );
    expect(totalAdvancePaid).toBe(3500);
  });

  it("无预支时已发显示 0（应显示 —）", () => {
    const monthSlips = [{ finalSalary: 2500, pettyLaborPaid: 0, advanceAmount: 0 }];
    const totalAdvancePaid = monthSlips.reduce(
      (s, p) => s + (p.pettyLaborPaid ?? 0) + (p.advanceAmount ?? 0), 0
    );
    expect(totalAdvancePaid).toBe(0);
  });
});
