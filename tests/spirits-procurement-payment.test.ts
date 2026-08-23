import { describe, expect, it } from "vitest";
import {
  summarizeSpiritPurchasePayment,
  validateSpiritProcurementPaymentAllocation,
  validateSpiritProcurementPaymentLedger,
  type SpiritProcurementPaymentAllocation,
} from "@/lib/spirits/procurement-payment";

const purchase = { id: "purchase-1", amount: 300, supplier: "线上渠道" };
const pettyAllocation: SpiritProcurementPaymentAllocation = {
  id: "allocation-1",
  purchaseId: "purchase-1",
  source: "petty_cash",
  pettyCashRecordId: "petty-1",
  amount: 120,
  paidAt: "2026-08-24",
  paymentMethod: "支付宝",
};

describe("烈酒采购付款分摊", () => {
  it("网络采购可由备用金逐笔分摊，付款状态不修改采购成本金额", () => {
    const partial = summarizeSpiritPurchasePayment(purchase, [pettyAllocation], "online");
    const settled = summarizeSpiritPurchasePayment(purchase, [pettyAllocation, { ...pettyAllocation, id: "allocation-2", amount: 180, pettyCashRecordId: "petty-2" }], "online");

    expect(partial).toMatchObject({ purchaseAmount: 300, paidAmount: 120, remainingAmount: 180, status: "partial", requiresPettyLink: false });
    expect(settled).toMatchObject({ purchaseAmount: 300, paidAmount: 300, remainingAmount: 0, status: "paid", requiresPettyLink: false });
    expect(purchase.amount).toBe(300);
  });

  it("网络采购缺少备用金凭证显示待关联，供货商则可保持集中待付", () => {
    expect(summarizeSpiritPurchasePayment(purchase, [], "online")).toMatchObject({ status: "unpaid", requiresPettyLink: true });
    expect(summarizeSpiritPurchasePayment(purchase, [], "supplier")).toMatchObject({ status: "unpaid", requiresPettyLink: false });
  });

  it("拒绝无凭证备用金、直接付款夹带备用金和引用不存在采购行的付款", () => {
    expect(validateSpiritProcurementPaymentAllocation({ ...pettyAllocation, pettyCashRecordId: undefined })).toBe("备用金付款必须关联实际备用金记录");
    expect(validateSpiritProcurementPaymentAllocation({ ...pettyAllocation, source: "direct", pettyCashRecordId: "petty-1" })).toBe("直接付款不得附带备用金记录");
    expect(validateSpiritProcurementPaymentLedger([], [pettyAllocation])).toEqual(["allocation-1：引用的采购记录不存在"]);
  });
});
