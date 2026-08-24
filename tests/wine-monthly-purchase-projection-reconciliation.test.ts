import { describe, expect, it } from "vitest";
import { reconcileWineMonthlyPurchaseProjection } from "@/lib/wine/monthly-purchase-projection-reconciliation";

const purchase = (input: { id: string; date: string; supplier: string; bottleId: string | null; amount: number }) => ({
  ...input,
  productName: input.id,
  unitPrice: input.amount,
  quantity: 1,
  notes: "",
  createdAt: "2026-08-24T00:00:00.000Z",
});

describe("葡萄酒月度采购投影核对", () => {
  it("只核对当月真实采购，不把供应商和酒款的独立期初累计混入差额", () => {
    const result = reconcileWineMonthlyPurchaseProjection([
      purchase({ id: "linked", date: "2026-08-03", supplier: "供应商 A", bottleId: "bottle-a", amount: 100 }),
      purchase({ id: "old", date: "2026-07-29", supplier: "供应商 A", bottleId: null, amount: 999 }),
    ], "2026-08");
    expect(result).toMatchObject({ supplierAmount: 100, linkedProductAmount: 100, unresolvedAmount: 0, isFullyLinked: true });
  });

  it("未链接的当月采购保持在待核对列表，不伪造为已关联酒款", () => {
    const result = reconcileWineMonthlyPurchaseProjection([
      purchase({ id: "linked", date: "2026-08-03", supplier: "供应商 A", bottleId: "bottle-a", amount: 100 }),
      purchase({ id: "unresolved", date: "2026-08-04", supplier: "供应商 B", bottleId: null, amount: 80 }),
    ], "2026-08");
    expect(result).toMatchObject({ supplierAmount: 180, linkedProductAmount: 100, unresolvedAmount: 80, isFullyLinked: false });
    expect(result.unresolved).toEqual([{ id: "unresolved", supplier: "供应商 B", productName: "unresolved", amount: 80 }]);
  });
});
