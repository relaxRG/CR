import { describe, expect, it } from "vitest";
import { calcClosingPure, type PettyRecord } from "@/lib/store/petty-store";

function record(id: string, code: PettyRecord["code"], amount: number): PettyRecord {
  return {
    id,
    date: "2026-07-15",
    code,
    amount,
    description: "金额精度回归",
    paymentMethod: "现金",
    receiptUri: "",
    createdAt: "2026-07-15T00:00:00.000Z",
  };
}

describe("备用金月度金额精度", () => {
  it("流入、其他收入、支出与期末余额均按分汇总", () => {
    const records = [
      record("in-1", "N0", 0.1),
      record("in-2", "N1", 0.2),
      record("income-1", "N3", 0.3),
      record("expense-1", "A1", 0.1),
      record("expense-2", "B1", 0.2),
    ];

    expect(calcClosingPure("2026-07", records, [{ month: "2026-07", openingBalance: 0, note: "" }])).toBe(0.3);
  });
});
