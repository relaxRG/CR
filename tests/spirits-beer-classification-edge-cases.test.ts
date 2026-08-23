import { describe, expect, it } from "vitest";
import {
  summarizeSpiritPurchasePayment,
  validateSpiritProcurementPaymentLedger,
  type SpiritProcurementPaymentAllocation,
} from "@/lib/spirits/procurement-payment";
import { applySupplierPurchaseTableView, EMPTY_SUPPLIER_PURCHASE_FILTERS } from "@/lib/spirits/purchase-table-view";

describe("烈酒内啤酒分类独立核算边缘场景", () => {
  const beerPurchase = { id: "beer-purchase", amount: 156, supplier: "同一烈酒供应商" };
  const whiskyPurchase = { id: "whisky-purchase", amount: 210, supplier: "同一烈酒供应商" };

  it("同一供应商的啤酒和非啤酒付款只结清各自采购行，且不改变采购成本", () => {
    const beerPayment: SpiritProcurementPaymentAllocation = {
      id: "pay-beer", purchaseId: beerPurchase.id, source: "petty_cash", pettyCashRecordId: "petty-1",
      amount: 156, paidAt: "2026-08-24", paymentMethod: "支付宝",
    };
    const beer = summarizeSpiritPurchasePayment(beerPurchase, [beerPayment], "online");
    const whisky = summarizeSpiritPurchasePayment(whiskyPurchase, [beerPayment], "supplier");

    expect(beer).toMatchObject({ paidAmount: 156, remainingAmount: 0, status: "paid", requiresPettyLink: false });
    expect(whisky).toMatchObject({ paidAmount: 0, remainingAmount: 210, status: "unpaid", requiresPettyLink: false });
    expect(beerPurchase.amount + whiskyPurchase.amount).toBe(366);
  });

  it("网络采购无备用金凭证必须待关联，超付必须显式保留而不能静默截断", () => {
    const unresolved = summarizeSpiritPurchasePayment(beerPurchase, [], "online");
    const overpaid = summarizeSpiritPurchasePayment(beerPurchase, [{
      id: "pay-over", purchaseId: beerPurchase.id, source: "direct", amount: 160,
      paidAt: "2026-08-24", paymentMethod: "转账",
    }], "supplier");

    expect(unresolved).toMatchObject({ status: "unpaid", requiresPettyLink: true, remainingAmount: 156 });
    expect(overpaid).toMatchObject({ status: "overpaid", paidAmount: 160, remainingAmount: 0 });
  });

  it("一笔备用金可分配给啤酒和非啤酒采购，但未知采购行和无凭证付款必须被阻止", () => {
    const allocations: SpiritProcurementPaymentAllocation[] = [
      { id: "pay-beer", purchaseId: beerPurchase.id, source: "petty_cash", pettyCashRecordId: "petty-1", amount: 100, paidAt: "2026-08-24", paymentMethod: "微信" },
      { id: "pay-whisky", purchaseId: whiskyPurchase.id, source: "petty_cash", pettyCashRecordId: "petty-1", amount: 40, paidAt: "2026-08-24", paymentMethod: "微信" },
      { id: "pay-invalid", purchaseId: "missing", source: "petty_cash", amount: 1, paidAt: "2026-08-24", paymentMethod: "微信" },
    ];
    expect(validateSpiritProcurementPaymentLedger([beerPurchase, whiskyPurchase], allocations)).toEqual([
      "pay-invalid：备用金付款必须关联实际备用金记录",
      "pay-invalid：引用的采购记录不存在",
    ]);
  });

  it("分类多选按分类管理顺序排序，未分类只在显式选择时出现", () => {
    const rows = applySupplierPurchaseTableView([
      { id: "beer", month: "2026-08", date: "2026-08-24", rawName: "青岛", supplier: "A", unit: "瓶", source: "manual", createdAt: "2026-08-24T00:00:00.000Z", quantity: 24, unitPrice: 6.5, amount: 156, displayCategory: "啤酒 / Beer", categoryOrder: 3, nameKey: "beer", displayName: "青岛", searchableName: "青岛", isMatched: true, displayGroup: "" },
      { id: "whisky", month: "2026-08", date: "2026-08-24", rawName: "芝华士", supplier: "A", unit: "瓶", source: "manual", createdAt: "2026-08-24T00:00:00.000Z", quantity: 1, unitPrice: 210, amount: 210, displayCategory: "威士忌", categoryOrder: 1, nameKey: "whisky", displayName: "芝华士", searchableName: "芝华士", isMatched: true, displayGroup: "" },
      { id: "unknown", month: "2026-08", date: "2026-08-24", rawName: "未知", supplier: "A", unit: "瓶", source: "manual", createdAt: "2026-08-24T00:00:00.000Z", quantity: 1, unitPrice: 10, amount: 10, displayCategory: "未分类", categoryOrder: Number.MAX_SAFE_INTEGER, nameKey: "unknown", displayName: "未知", searchableName: "未知", isMatched: false, displayGroup: "" },
    ], { filters: { ...EMPTY_SUPPLIER_PURCHASE_FILTERS, categories: ["啤酒 / Beer", "威士忌"] }, sort: { key: "category", direction: "asc" } });

    expect(rows.map((row) => row.id)).toEqual(["whisky", "beer"]);
  });
});
