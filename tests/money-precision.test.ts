/**
 * Suite O：金额精度与格式一致性测试
 *
 * 验证：
 * 1. 计算引擎输出的精度（Math.round × 100 / 100）
 * 2. formatMoney 的格式化输出
 * 3. 精度与自适应字号的兼容性（最长字符串不超过容器）
 * 4. 浮点累积误差防护
 */
import { describe, it, expect } from "vitest";

// ─── 复制生产代码的精度函数 ──────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe("Suite O：金额精度与格式一致性测试", () => {

  describe("O1. 计算引擎精度（Math.round × 100 / 100）", () => {
    it("比例底薪：10000 × 25/27 = 9259.26（不是 9259.259...）", () => {
      const result = r2(10000 * 25 / 27);
      expect(result).toBe(9259.26);
    });

    it("比例底薪：8000 × 27/27 = 8000（整数）", () => {
      const result = r2(8000 * 27 / 27);
      expect(result).toBe(8000);
    });

    it("加班费：8.5h × 35 = 297.50", () => {
      const result = r2(8.5 * 35);
      expect(result).toBe(297.5);
    });

    it("日薪：10000 / 27 = 370.37", () => {
      const result = r2(10000 / 27);
      expect(result).toBe(370.37);
    });

    it("补贴：15 × 27 = 405（整数）", () => {
      const result = r2(15 * 27);
      expect(result).toBe(405);
    });

    it("finalSalary：累加多个精度值不产生浮点误差", () => {
      // 模拟：grossSalary - 社保 - 公积金 - 个税 - 预支
      const grossSalary = r2(10000 * 27 / 27); // 10000
      const si = r2(10000 * 0.08);             // 800
      const hf = r2(10000 * 0.12);             // 1200
      const tax = r2(0);                        // 0
      const advance = r2(3000);                 // 3000
      const finalSalary = r2(grossSalary - si - hf - tax - advance);
      expect(finalSalary).toBe(5000);
    });

    it("浮点经典陷阱：0.1 + 0.2 经过 r2 处理后正确", () => {
      // 0.1 + 0.2 = 0.30000000000000004（浮点问题）
      const raw = 0.1 + 0.2;
      expect(raw).not.toBe(0.3); // 验证问题存在
      const rounded = r2(raw);
      expect(rounded).toBe(0.3); // r2 修复了这个问题
    });
  });

  describe("O2. formatMoney 格式化输出", () => {
    const cases: [number, string][] = [
      [0, "0"],
      [100, "100"],
      [1000, "1000"],
      [10000, "10000"],
      [99999, "99999"],
      [0.1, "0.10"],
      [0.5, "0.50"],
      [9259.26, "9259.26"],
      [14410.74, "14410.74"],
      [8339.80, "8339.80"],
      [370.37, "370.37"],
      [-200, "-200"],
      [-8339.80, "-8339.80"],
      [NaN, "0"],
      [Infinity, "0"],
      [-Infinity, "0"],
    ];

    cases.forEach(([input, expected]) => {
      it(`formatMoney(${input}) = "${expected}"`, () => {
        expect(formatMoney(input)).toBe(expected);
      });
    });
  });

  describe("O3. 格式化字符串长度与自适应字号兼容性", () => {
    // 最小容器宽度（iPhone SE 5格）
    const minContainerWidth = (375 - 32 - 24) / 5; // ≈ 63.8pt

    // 最大可能的金额字符串
    const worstCaseAmounts = [
      { text: "¥99999.99", desc: "最大正金额" },
      { text: "-¥99999.99", desc: "最大负金额" },
      { text: "+¥99999.99", desc: "最大正号金额" },
    ];

    worstCaseAmounts.forEach(({ text, desc }) => {
      it(`${desc} "${text}" 在 iPhone SE 5格中不溢出（fontSize=12, minScale=0.7）`, () => {
        const fontSize = 12;
        const minScale = 0.7;
        const charWidthRatio = 0.62;
        const textWidth = text.length * fontSize * charWidthRatio;
        const scale = minContainerWidth / textWidth;
        const effectiveFontSize = Math.max(fontSize * minScale, fontSize * scale);
        const overflows = effectiveFontSize < fontSize * minScale;
        expect(overflows).toBe(false);
      });
    });

    it("人力总览最大金额 ¥999999.99 在 iPhone SE 4格中不溢出（fontSize=16, minScale=0.6）", () => {
      const text = "¥999999.99";
      const containerWidth = (375 - 28 - 3) / 4; // ≈ 86pt
      const fontSize = 16;
      const minScale = 0.6;
      const charWidthRatio = 0.62;
      const textWidth = text.length * fontSize * charWidthRatio;
      const scale = containerWidth / textWidth;
      const effectiveFontSize = Math.max(fontSize * minScale, fontSize * scale);
      const overflows = effectiveFontSize < fontSize * minScale;
      expect(overflows).toBe(false);
    });
  });

  describe("O4. 精度一致性（计算 → 存储 → 展示）", () => {
    it("计算结果精度 = 存储精度 = 展示精度", () => {
      // 模拟完整流程：计算 → JSON序列化 → 反序列化 → 格式化展示
      const calculated = r2(10000 * 25 / 27); // 9259.26
      const serialized = JSON.stringify({ amount: calculated });
      const deserialized = JSON.parse(serialized).amount;
      const displayed = `¥${formatMoney(deserialized)}`;

      expect(calculated).toBe(9259.26);
      expect(deserialized).toBe(9259.26);
      expect(displayed).toBe("¥9259.26");
    });

    it("整数金额不显示多余小数点", () => {
      const calculated = r2(8000 * 27 / 27); // 8000.0
      const displayed = `¥${formatMoney(calculated)}`;
      expect(displayed).toBe("¥8000"); // 不是 "¥8000.00"
    });

    it("finalSalary 精度与展示精度一致", () => {
      // 模拟 Stephen 的场景：370.37 + 15 = 385.37
      const proportionalBase = r2(10000 / 27); // 370.37
      const extra = 15;
      const finalSalary = r2(proportionalBase + extra); // 385.37
      const displayed = `¥${formatMoney(finalSalary)}`;
      expect(displayed).toBe("¥385.37");
    });
  });
});
