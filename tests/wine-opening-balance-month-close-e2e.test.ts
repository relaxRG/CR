import { describe, expect, it } from "vitest";
import {
  archiveWinePurchaseBaselines,
  createWinePurchaseBaseline,
  resolveWineCumulativePurchaseAmount,
  updateWinePurchaseBaseline,
} from "@/lib/wine/purchase-baseline";
import { reconcileWineMonthlyPurchaseProjection } from "@/lib/wine/monthly-purchase-projection-reconciliation";

const audit = { id: "audit-1", reason: "录入系统启用前历史金额", occurredAt: "2026-08-24T00:00:00.000Z", month: "2026-08" };
const purchase = (input: { id: string; date: string; supplier: string; bottleId: string | null; amount: number }) => ({
  ...input, productName: input.id, unitPrice: input.amount, quantity: 1, notes: "", createdAt: audit.occurredAt,
});

describe("葡萄酒独立期初与月结 E2E", () => {
  it("供应商与酒款期初可独立维护；差额不混入当月投影也不阻断归档", () => {
    const supplierOpening = createWinePurchaseBaseline({ id: "opening-supplier", scope: "supplier", subjectId: "supplier-a", initialCumulativeAmount: 1200, createdAt: audit.occurredAt, updatedAt: audit.occurredAt }, audit);
    const productOpening = createWinePurchaseBaseline({ id: "opening-product", scope: "product", subjectId: "bottle-a", initialCumulativeAmount: 800, createdAt: audit.occurredAt, updatedAt: audit.occurredAt }, { ...audit, id: "audit-2" });
    const changedProductOpening = updateWinePurchaseBaseline(productOpening.baseline, 900, { ...audit, id: "audit-3", reason: "补录酒款历史发票" });

    const monthly = reconcileWineMonthlyPurchaseProjection([
      purchase({ id: "p-linked", date: "2026-08-03", supplier: "供应商 A", bottleId: "bottle-a", amount: 100 }),
      purchase({ id: "p-unlinked", date: "2026-08-05", supplier: "供应商 A", bottleId: null, amount: 60 }),
    ], "2026-08");
    const archive = archiveWinePurchaseBaselines({ id: "close-2026-08", month: "2026-08", closedAt: "2026-08-31T23:59:59.000Z", baselines: [supplierOpening.baseline, changedProductOpening.baseline], auditEntries: [supplierOpening.audit, productOpening.audit, changedProductOpening.audit] });

    expect(resolveWineCumulativePurchaseAmount(100, supplierOpening.baseline)).toBe(1300);
    expect(resolveWineCumulativePurchaseAmount(100, changedProductOpening.baseline)).toBe(1000);
    expect(monthly).toMatchObject({ supplierAmount: 160, linkedProductAmount: 100, unresolvedAmount: 60, isFullyLinked: false });
    expect(archive.baselines.map((baseline) => baseline.initialCumulativeAmount)).toEqual([1200, 900]);
  });

  it("修复链接后，当月投影恢复完整；历史归档仍保持原始期初副本", () => {
    const opening = { id: "opening", scope: "supplier" as const, subjectId: "supplier-a", initialCumulativeAmount: 500, createdAt: audit.occurredAt, updatedAt: audit.occurredAt };
    const archived = archiveWinePurchaseBaselines({ id: "close-2026-08", month: "2026-08", closedAt: "2026-08-31T23:59:59.000Z", baselines: [opening], auditEntries: [] });
    const repaired = reconcileWineMonthlyPurchaseProjection([
      purchase({ id: "p-linked", date: "2026-08-03", supplier: "供应商 A", bottleId: "bottle-a", amount: 100 }),
      purchase({ id: "p-repaired", date: "2026-08-05", supplier: "供应商 A", bottleId: "bottle-b", amount: 60 }),
    ], "2026-08");
    opening.initialCumulativeAmount = 999;
    expect(repaired).toMatchObject({ supplierAmount: 160, linkedProductAmount: 160, unresolvedAmount: 0, isFullyLinked: true });
    expect(archived.baselines[0].initialCumulativeAmount).toBe(500);
  });
});
