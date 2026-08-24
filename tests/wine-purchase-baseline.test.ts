import { describe, expect, it } from "vitest";
import {
  archiveWinePurchaseBaselines,
  assertWinePurchaseBaselineDimensionsBalanced,
  createWinePurchaseBaseline,
  deleteWinePurchaseBaseline,
  reconcileWinePurchaseBaselineDimensions,
  resolveWineCumulativePurchaseAmount,
  updateWinePurchaseBaseline,
} from "@/lib/wine/purchase-baseline";

const auditBase = { id: "audit-1", reason: "导入前历史累计", occurredAt: "2026-08-24T00:00:00.000Z", month: "2026-08" };

describe("葡萄酒采购累积基线", () => {
  it("供应商和酒款初始累积金额进入真实采购汇总，但每次修改保留前后金额审计", () => {
    const created = createWinePurchaseBaseline({
      id: "supplier-a", scope: "supplier", subjectId: "supplier-a", initialCumulativeAmount: 1200,
      createdAt: auditBase.occurredAt, updatedAt: auditBase.occurredAt,
    }, auditBase);
    const updated = updateWinePurchaseBaseline(created.baseline, 1500, { ...auditBase, id: "audit-2", reason: "核对历史发票" });

    expect(created.audit).toMatchObject({ action: "created", previousAmount: null, nextAmount: 1200 });
    expect(updated.audit).toMatchObject({ action: "updated", previousAmount: 1200, nextAmount: 1500 });
    expect(resolveWineCumulativePurchaseAmount(800, updated.baseline)).toBe(2300);
  });

  it("删除是可审计软删除，且不再进入累计金额", () => {
    const baseline = { id: "product-a", scope: "product" as const, subjectId: "bottle-a", initialCumulativeAmount: 300, createdAt: auditBase.occurredAt, updatedAt: auditBase.occurredAt };
    const deleted = deleteWinePurchaseBaseline(baseline, { ...auditBase, id: "audit-delete", reason: "重复历史基线" });
    expect(deleted.audit).toMatchObject({ action: "deleted", previousAmount: 300, nextAmount: null });
    expect(resolveWineCumulativePurchaseAmount(500, deleted.baseline)).toBe(500);
  });

  it("供应商与酒款初始累计是同一历史采购的双维度视图，必须严格守恒", () => {
    const balanced = [
      { id: "supplier-a", scope: "supplier" as const, subjectId: "supplier-a", initialCumulativeAmount: 1200, createdAt: auditBase.occurredAt, updatedAt: auditBase.occurredAt },
      { id: "supplier-b", scope: "supplier" as const, subjectId: "supplier-b", initialCumulativeAmount: 300, createdAt: auditBase.occurredAt, updatedAt: auditBase.occurredAt },
      { id: "product-a", scope: "product" as const, subjectId: "product-a", initialCumulativeAmount: 900, createdAt: auditBase.occurredAt, updatedAt: auditBase.occurredAt },
      { id: "product-b", scope: "product" as const, subjectId: "product-b", initialCumulativeAmount: 600, createdAt: auditBase.occurredAt, updatedAt: auditBase.occurredAt },
    ];
    expect(reconcileWinePurchaseBaselineDimensions(balanced)).toMatchObject({ supplierInitialAmount: 1500, productInitialAmount: 1500, difference: 0, isBalanced: true });
    expect(assertWinePurchaseBaselineDimensionsBalanced(balanced)).toMatchObject({ isBalanced: true });
    expect(() => assertWinePurchaseBaselineDimensionsBalanced([{ ...balanced[0], initialCumulativeAmount: 1201 }, ...balanced.slice(1)])).toThrow("初始累计金额不一致");
  });

  it("月结归档是不可变副本，后续编辑不回写已经关闭月份", () => {
    const baseline = { id: "supplier-a", scope: "supplier" as const, subjectId: "supplier-a", initialCumulativeAmount: 1200, createdAt: auditBase.occurredAt, updatedAt: auditBase.occurredAt };
    const archive = archiveWinePurchaseBaselines({ id: "archive-aug", month: "2026-08", closedAt: "2026-08-31T23:59:59.000Z", baselines: [baseline], auditEntries: [] });
    baseline.initialCumulativeAmount = 9999;
    expect(archive.baselines[0].initialCumulativeAmount).toBe(1200);
  });
});
