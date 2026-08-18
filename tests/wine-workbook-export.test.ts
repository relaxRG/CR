import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system/legacy", () => ({ cacheDirectory: "file://tmp/", writeAsStringAsync: vi.fn() }));
vi.mock("expo-sharing", () => ({ shareAsync: vi.fn(), isAvailableAsync: vi.fn() }));
vi.mock("expo-print", () => ({ printToFileAsync: vi.fn() }));

import { summarizeWineProducts, summarizeWineSuppliers } from "@/lib/wine/workbook-export";
import type { WineManualPurchase } from "@/lib/wine/types";

function purchase(id: string, date: string, supplier: string, productName: string, quantity: number, amount: number): WineManualPurchase {
  return {
    id, date, supplier, productName, quantity, amount, unitPrice: amount / quantity,
    bottleId: null, notes: "", createdAt: `${date}T00:00:00.000Z`,
  };
}

describe("葡萄酒综合导出统计", () => {
  const data = {
    month: "2026-02",
    snapshot: null,
    purchases: [
      purchase("p1", "2026-01-20", "供应商 A", "红酒 A", 2, 200),
      purchase("p2", "2026-02-01", "供应商 A", "红酒 A", 3, 330),
      purchase("p3", "2026-02-10", "供应商 A", "白酒 B", 1, 120),
      purchase("p4", "2026-02-11", "供应商 B", "红酒 A", 4, 440),
      purchase("p5", "2026-03-01", "供应商 A", "红酒 A", 9, 999),
    ],
    batches: [],
    auditEntries: [],
  };

  it("供应商统计不纳入未来月份，并区分本月与累计采购", () => {
    expect(summarizeWineSuppliers(data)).toEqual([
      { supplier: "供应商 A", monthQty: 4, monthAmount: 450, cumulativeQty: 6, cumulativeAmount: 650, productCount: 2, lastPurchaseDate: "2026-02-10" },
      { supplier: "供应商 B", monthQty: 4, monthAmount: 440, cumulativeQty: 4, cumulativeAmount: 440, productCount: 1, lastPurchaseDate: "2026-02-11" },
    ]);
  });

  it("酒款统计以供应商与商品为唯一组，保留最近进货单价与日期", () => {
    expect(summarizeWineProducts(data)).toEqual([
      { productName: "红酒 A", supplier: "供应商 B", monthQty: 4, monthAmount: 440, cumulativeQty: 4, cumulativeAmount: 440, latestUnitPrice: 110, lastPurchaseDate: "2026-02-11" },
      { productName: "红酒 A", supplier: "供应商 A", monthQty: 3, monthAmount: 330, cumulativeQty: 5, cumulativeAmount: 530, latestUnitPrice: 110, lastPurchaseDate: "2026-02-01" },
      { productName: "白酒 B", supplier: "供应商 A", monthQty: 1, monthAmount: 120, cumulativeQty: 1, cumulativeAmount: 120, latestUnitPrice: 120, lastPurchaseDate: "2026-02-10" },
    ]);
  });
});
