import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("门店大规模压力基准", () => {
  it("固定覆盖 500 名员工、万级换休/提醒流水及万级收入/备用金流水", () => {
    const benchmark = readFileSync(resolve(process.cwd(), "scripts/store-performance-stress.ts"), "utf8");
    expect(benchmark).toContain("const EMPLOYEE_COUNT = 500");
    expect(benchmark).toContain("const COMP_OFF_ENTRY_COUNT = 10_000");
    expect(benchmark).toContain("const CASH_RECORD_COUNT = 12_000");
    expect(benchmark).toContain("employee_cards_repeated_scan");
    expect(benchmark).toContain("employee_cards_parent_index");
    expect(benchmark).toContain("analytics_two_pass_filters");
    expect(benchmark).toContain("analytics_single_pass");
    expect(benchmark).toContain("const SHOP_ITEM_COUNT = 1_000");
    expect(benchmark).toContain("const SHOP_PURCHASE_COUNT = 10_000");
    expect(benchmark).toContain("const SHOP_CONSUME_COUNT = 10_000");
    expect(benchmark).toContain("shop_ledger_repeated_filters");
    expect(benchmark).toContain("shop_ledger_indexed_records_and_opening");
  });
});
