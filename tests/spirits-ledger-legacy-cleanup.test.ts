import { describe, expect, it } from "vitest";
import { normalizeLegacySpiritLedger } from "../lib/spirits/ledger-legacy-cleanup";

const base = {
  id: "ledger-1", month: "2026-03", itemId: "gin", openingQty: 2, openingUnitCost: 80,
  purchaseQty: 6, purchaseCost: 510, closingQty: 5, closingUnitCost: 83.75, closingCost: 418.75,
  isClosed: false, updatedAt: "2026-03-31T00:00:00.000Z",
};

describe("烈酒历史台账消耗字段清理", () => {
  it("旧盘点把消耗成本写入consumeQty时，根据库存恒等式恢复消耗瓶数并保留成本", () => {
    expect(normalizeLegacySpiritLedger({ ...base, consumeQty: 251.25 })).toMatchObject({ consumeQty: 3, consumeCost: 251.25 });
  });

  it("旧手动台账数量符合库存恒等式时，按期末单位成本补全消耗成本", () => {
    expect(normalizeLegacySpiritLedger({ ...base, consumeQty: 3 })).toMatchObject({ consumeQty: 3, consumeCost: 251.25 });
  });

  it("新台账已有消耗成本时不重写用户或Excel的明确值", () => {
    expect(normalizeLegacySpiritLedger({ ...base, consumeQty: 3, consumeCost: 249.5 })).toMatchObject({ consumeQty: 3, consumeCost: 249.5 });
  });
});
