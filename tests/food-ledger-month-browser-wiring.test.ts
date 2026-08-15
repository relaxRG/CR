import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("components/store/inventory.tsx", "utf8");

describe("食材月度台账与统一月份浏览器", () => {
  it("食材的月度行和采购、消耗、盘点原子流水都参与可浏览月份边界", () => {
    expect(source).toContain("...foodStore.ledgerEntries.map((entry) => entry.month)");
    expect(source).toContain("...foodStore.ledgerMovements.flatMap((movement) => [movement.month, movement.date])");
  });
});
