import { describe, expect, it } from "vitest";
import { isCurrentSpiritLedgerEntry } from "@/lib/spirits/crud-store";

const currentLedger = {
  id: "ledger-2026-07-gin",
  month: "2026-07",
  itemId: "gin-001",
  openingQty: 12,
  openingUnitCost: 80,
  purchaseQty: 3,
  purchaseCost: 270,
  consumeQty: 4,
  consumeCost: 360,
  closingQty: 11,
  closingUnitCost: 90,
  closingCost: 990,
  isClosed: true,
  updatedAt: "2026-07-31T12:00:00.000Z",
};

describe("烈酒台账当前格式", () => {
  it("只接受包含全部当前必填字段的记录", () => {
    expect(isCurrentSpiritLedgerEntry(currentLedger)).toBe(true);
  });

  it("拒绝缺少消费成本的旧账本记录，不再自动归一化", () => {
    const { consumeCost: _removed, ...legacyLedger } = currentLedger;
    expect(isCurrentSpiritLedgerEntry(legacyLedger)).toBe(false);
  });

  it("拒绝字段类型错误的账本记录", () => {
    expect(isCurrentSpiritLedgerEntry({ ...currentLedger, closingQty: "11" })).toBe(false);
  });
});
