/**
 * Suite K：备用金与手动预支合并展示测试
 * 验证薪资卡片和导出报表中"已预支"字段正确合计 advanceAmount + pettyLaborPaid
 */
import { describe, it, expect } from "vitest";
import type { PaySlip } from "../lib/labor/types";

// ─── 模拟薪资卡片的展示逻辑（与 components/labor/LaborWorkspaceScreen.tsx L499 一致）──────────────────────

function getDisplayAdvanceAmount(slip: Partial<PaySlip> | null | undefined): number {
  return (slip?.advanceAmount ?? 0) + (slip?.pettyLaborPaid ?? 0);
}

// ─── 模拟导出模块的预支展示逻辑（与 export.ts L170 一致）──────────────────────

function getExportAdvanceAmount(slip: Partial<PaySlip> | null | undefined): number {
  return (slip?.advanceAmount ?? 0) + (slip?.pettyLaborPaid ?? 0);
}

// ─── 测试数据 ─────────────────────────────────────────────────────────────────

function makeSlip(overrides: Partial<PaySlip> = {}): Partial<PaySlip> {
  return {
    advanceAmount: 0,
    pettyLaborPaid: 0,
    grossSalary: 10000,
    finalSalary: 10000,
    ...overrides,
  };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe("Suite K：备用金与手动预支合并展示", () => {

  describe("K1. 薪资卡片展示逻辑", () => {
    it("无预支无备用金 → 显示 0", () => {
      const slip = makeSlip({ advanceAmount: 0, pettyLaborPaid: 0 });
      expect(getDisplayAdvanceAmount(slip)).toBe(0);
    });

    it("仅手动预支 → 显示 advanceAmount", () => {
      const slip = makeSlip({ advanceAmount: 500, pettyLaborPaid: 0 });
      expect(getDisplayAdvanceAmount(slip)).toBe(500);
    });

    it("仅备用金关联 → 显示 pettyLaborPaid", () => {
      const slip = makeSlip({ advanceAmount: 0, pettyLaborPaid: 8339.80 });
      expect(getDisplayAdvanceAmount(slip)).toBeCloseTo(8339.80);
    });

    it("手动预支 + 备用金关联 → 合计", () => {
      const slip = makeSlip({ advanceAmount: 1000, pettyLaborPaid: 5000 });
      expect(getDisplayAdvanceAmount(slip)).toBe(6000);
    });

    it("slip 为 null → 返回 0", () => {
      expect(getDisplayAdvanceAmount(null)).toBe(0);
    });

    it("slip 为 undefined → 返回 0", () => {
      expect(getDisplayAdvanceAmount(undefined)).toBe(0);
    });

    it("字段缺失（旧数据无 pettyLaborPaid）→ 安全回退", () => {
      const slip = { advanceAmount: 200 } as Partial<PaySlip>;
      expect(getDisplayAdvanceAmount(slip)).toBe(200);
    });
  });

  describe("K2. 导出报表展示逻辑", () => {
    it("合计与薪资卡片一致", () => {
      const slip = makeSlip({ advanceAmount: 1500, pettyLaborPaid: 3000 });
      expect(getExportAdvanceAmount(slip)).toBe(getDisplayAdvanceAmount(slip));
      expect(getExportAdvanceAmount(slip)).toBe(4500);
    });

    it("Stephen 场景：3笔备用金 ¥5000+¥1000+¥1400 = ¥7400", () => {
      const slip = makeSlip({ advanceAmount: 0, pettyLaborPaid: 7400 });
      expect(getExportAdvanceAmount(slip)).toBe(7400);
    });

    it("Jason 场景：1笔备用金 ¥79.80", () => {
      const slip = makeSlip({ advanceAmount: 0, pettyLaborPaid: 79.80 });
      expect(getExportAdvanceAmount(slip)).toBeCloseTo(79.80);
    });
  });

  describe("K3. finalSalary 验证（确保不重复扣除）", () => {
    it("finalSalary 已经同时扣除了 advanceAmount 和 pettyLaborPaid", () => {
      // buildPaySlipDraft 中：finalSalary = grossSalary - ... - advanceAmount - pettyLaborPaidAmt
      const grossSalary = 10000;
      const advanceAmount = 500;
      const pettyLaborPaid = 3000;
      const expectedFinal = grossSalary - advanceAmount - pettyLaborPaid; // 6500

      const slip = makeSlip({
        grossSalary,
        advanceAmount,
        pettyLaborPaid,
        finalSalary: expectedFinal,
      });

      // 展示的"已预支"合计
      const displayAdvance = getDisplayAdvanceAmount(slip);
      expect(displayAdvance).toBe(3500); // 500 + 3000

      // 验证：grossSalary - displayAdvance = finalSalary（简化公式，无社保等）
      expect(slip.grossSalary! - displayAdvance).toBe(slip.finalSalary);
    });

    it("展示合计 + finalSalary 闭环验证", () => {
      const slip = makeSlip({
        grossSalary: 8085,
        advanceAmount: 0,
        pettyLaborPaid: 0,
        finalSalary: 8085,
      });
      const displayAdvance = getDisplayAdvanceAmount(slip);
      expect(displayAdvance).toBe(0);
      expect(slip.grossSalary! - displayAdvance).toBe(slip.finalSalary);
    });
  });

  describe("K4. 月报中 advAmt 展示逻辑", () => {
    it("有 slip 时从 slip 读取合计", () => {
      const slip = makeSlip({ advanceAmount: 200, pettyLaborPaid: 800 });
      const payment = { advanceAmount: 0 }; // payment 中的 advanceAmount 是供应商概念
      // 模拟 monthly-summary.tsx L757 的逻辑
      const advAmt = slip ? ((slip.advanceAmount ?? 0) + (slip.pettyLaborPaid ?? 0)) : (payment?.advanceAmount ?? 0);
      expect(advAmt).toBe(1000);
    });

    it("无 slip 时回退到 payment.advanceAmount", () => {
      const slip = null;
      const payment = { advanceAmount: 500 };
      const advAmt = slip ? ((slip as any).advanceAmount ?? 0) + ((slip as any).pettyLaborPaid ?? 0) : (payment?.advanceAmount ?? 0);
      expect(advAmt).toBe(500);
    });
  });
});
