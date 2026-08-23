import { describe, expect, it } from "vitest";
import {
  summarizeSpiritPurchasePayment,
  validateSpiritProcurementPaymentLedger,
  type SpiritProcurementPaymentAllocation,
} from "@/lib/spirits/procurement-payment";

type PurchaseFixture = {
  id: string;
  amount: number;
  supplier: string;
  receivedMonth: string;
  productClass: "beer" | "spirit";
};

function projectSupplierPayment(purchases: PurchaseFixture[], allocations: SpiritProcurementPaymentAllocation[]) {
  return purchases.reduce((projection, purchase) => {
    const summary = summarizeSpiritPurchasePayment(purchase, allocations, "supplier");
    const bucket = projection[purchase.productClass];
    bucket.purchase += purchase.amount;
    bucket.paid += summary.paidAmount;
    bucket.remaining += summary.remainingAmount;
    projection.total.purchase += purchase.amount;
    projection.total.paid += summary.paidAmount;
    projection.total.remaining += summary.remainingAmount;
    return projection;
  }, {
    beer: { purchase: 0, paid: 0, remaining: 0 },
    spirit: { purchase: 0, paid: 0, remaining: 0 },
    total: { purchase: 0, paid: 0, remaining: 0 },
  });
}

describe("统一供货商付款按行拆分与跨类对账 E2E", () => {
  const julyBeer: PurchaseFixture = {
    id: "purchase-july-beer", amount: 560, supplier: "烈酒供货商 A", receivedMonth: "2026-07", productClass: "beer",
  };
  const augustWhisky: PurchaseFixture = {
    id: "purchase-august-whisky", amount: 2240, supplier: "烈酒供货商 A", receivedMonth: "2026-08", productClass: "spirit",
  };

  it("8月一张统一付款单可结清7月啤酒和8月威士忌，但采购成本仍归属原账期与分类", () => {
    const payment: SpiritProcurementPaymentAllocation[] = [
      { id: "alloc-beer", purchaseId: julyBeer.id, source: "direct", amount: 560, paidAt: "2026-08-24", paymentMethod: "转账" },
      { id: "alloc-whisky", purchaseId: augustWhisky.id, source: "direct", amount: 440, paidAt: "2026-08-24", paymentMethod: "转账" },
    ];

    const projection = projectSupplierPayment([julyBeer, augustWhisky], payment);
    expect(projection.total).toEqual({ purchase: 2800, paid: 1000, remaining: 1800 });
    expect(projection.beer).toEqual({ purchase: 560, paid: 560, remaining: 0 });
    expect(projection.spirit).toEqual({ purchase: 2240, paid: 440, remaining: 1800 });

    // 付款账期为 8 月；成本账期和分类仍由采购事实决定，不能被付款回写。
    expect(julyBeer).toMatchObject({ receivedMonth: "2026-07", amount: 560, productClass: "beer" });
    expect(augustWhisky).toMatchObject({ receivedMonth: "2026-08", amount: 2240, productClass: "spirit" });
  });

  it("统一付款拆分后仍拒绝跨供应商/未知采购行，防止把付款金额混入其它供货商", () => {
    const allocations: SpiritProcurementPaymentAllocation[] = [
      { id: "valid", purchaseId: julyBeer.id, source: "direct", amount: 10, paidAt: "2026-08-24", paymentMethod: "转账" },
      { id: "wrong-supplier-row", purchaseId: "other-supplier-purchase", source: "direct", amount: 10, paidAt: "2026-08-24", paymentMethod: "转账" },
    ];
    expect(validateSpiritProcurementPaymentLedger([julyBeer, augustWhisky], allocations)).toEqual([
      "wrong-supplier-row：引用的采购记录不存在",
    ]);
  });

  it("部分付款后剩余应付按采购行和分类分别保留，后续付款只结清未付部分", () => {
    const first: SpiritProcurementPaymentAllocation[] = [
      { id: "p1-beer", purchaseId: julyBeer.id, source: "direct", amount: 200, paidAt: "2026-08-01", paymentMethod: "转账" },
      { id: "p1-whisky", purchaseId: augustWhisky.id, source: "direct", amount: 300, paidAt: "2026-08-01", paymentMethod: "转账" },
    ];
    const afterFirst = projectSupplierPayment([julyBeer, augustWhisky], first);
    expect(afterFirst).toEqual({
      beer: { purchase: 560, paid: 200, remaining: 360 },
      spirit: { purchase: 2240, paid: 300, remaining: 1940 },
      total: { purchase: 2800, paid: 500, remaining: 2300 },
    });

    const second = [...first,
      { id: "p2-beer", purchaseId: julyBeer.id, source: "direct" as const, amount: 360, paidAt: "2026-08-24", paymentMethod: "转账" },
      { id: "p2-whisky", purchaseId: augustWhisky.id, source: "direct" as const, amount: 1940, paidAt: "2026-08-24", paymentMethod: "转账" },
    ];
    expect(projectSupplierPayment([julyBeer, augustWhisky], second)).toEqual({
      beer: { purchase: 560, paid: 560, remaining: 0 },
      spirit: { purchase: 2240, paid: 2240, remaining: 0 },
      total: { purchase: 2800, paid: 2800, remaining: 0 },
    });
  });

  it("超付必须在统一供货商对账中显式暴露，不能以啤酒或烈酒类别掩盖差额", () => {
    const overpay: SpiritProcurementPaymentAllocation[] = [
      { id: "overpay", purchaseId: julyBeer.id, source: "direct", amount: 600, paidAt: "2026-08-24", paymentMethod: "转账" },
    ];
    const beer = summarizeSpiritPurchasePayment(julyBeer, overpay, "supplier");
    const supplier = projectSupplierPayment([julyBeer, augustWhisky], overpay);
    expect(beer.status).toBe("overpaid");
    expect(beer.remainingAmount).toBe(0);
    expect(supplier.beer).toEqual({ purchase: 560, paid: 600, remaining: 0 });
    expect(supplier.total.paid).toBe(600);
  });
});
