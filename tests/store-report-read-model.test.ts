import { describe, expect, it, vi } from "vitest";
import { buildStoreReportReadModel, loadStoreReportFacts, type StoreReportFacts } from "@/lib/store/report-read-model";

describe("StoreReportReadModel", () => {
  it("按月份聚合跨域事实且不修改原始数组或记录", () => {
    const facts: StoreReportFacts = {
      payslips: [
        { month: "2026-08", employeeId: "e1", totalEmployerCost: 1000.125, finalSalary: 800.125 },
        { month: "2026-08", employeeId: "e2", totalEmployerCost: 2000, finalSalary: 1600 },
        { month: "2026-07", employeeId: "old", totalEmployerCost: 999, finalSalary: 999 },
      ],
      pettyRecords: [
        { date: "2026-08-01", code: "N0", amount: 500 },
        { date: "2026-08-02", code: "N3", amount: 10 },
        { date: "2026-08-03", code: "A1", amount: 120.555 },
      ],
      revenueRecords: [
        { date: "2026-08-01", category: "revenue", amount: 1000 },
        { date: "2026-08-01", category: "food_cost", amount: -120 },
        { date: "2026-07-31", category: "revenue", amount: 888 },
      ],
      purchases: [
        { id: "p1", date: "2026-08-03", supplier: "甲", amount: 90 },
        { id: "p2", date: "2026-08-04", supplier: "乙", amount: 120 },
        { id: "old", date: "2026-07-04", supplier: "甲", amount: 999 },
      ],
      inventory: [{ id: "i1", month: "2026-08", purchaseCost: 110, consumptionCost: 40, endingValue: 300 }],
    };
    const before = JSON.stringify(facts);

    const model = buildStoreReportReadModel("2026-08", facts);

    expect(model.labor).toEqual({ employeeCount: 2, employerCost: 3000.13, netPaid: 2400.13 });
    expect(model.petty).toEqual({ inflow: 500, otherIncome: 10, expense: 120.56 });
    expect(model.inventory).toEqual({ purchaseCost: 110, consumptionCost: 40, endingValue: 300 });
    expect(model.suppliers).toEqual([{ supplier: "乙", purchaseAmount: 120 }, { supplier: "甲", purchaseAmount: 90 }]);
    expect(model.analyticsByDate).toEqual([
      { date: "2026-07-31", amounts: { revenue: 888 } },
      { date: "2026-08-01", amounts: { revenue: 1000, food_cost: -120, petty_cash: 500 } },
      { date: "2026-08-02", amounts: { petty_cash: 10 } },
      { date: "2026-08-03", amounts: { petty_cash: 120.56 } },
    ]);
    expect(JSON.stringify(facts)).toBe(before);
    expect(Object.isFrozen(model)).toBe(true);
    expect(model.sourceVersion.length).toBeLessThan(32);

    const changed = buildStoreReportReadModel("2026-08", {
      ...facts,
      purchases: [...facts.purchases.slice(0, 1), { ...facts.purchases[1]!, amount: 121 }],
    });
    expect(changed.sourceVersion).not.toBe(model.sourceVersion);
  });

  it("只读快照加载仅调用 multiGet，不允许写入跨域事实", async () => {
    const multiGet = vi.fn().mockResolvedValue([["labor.payslips", "[]"], ["store.petty.v1", "{}"]]);
    const decode = vi.fn(() => ({ payslips: [], pettyRecords: [], purchases: [], inventory: [] }));

    const facts = await loadStoreReportFacts({ multiGet }, ["labor.payslips", "store.petty.v1"], decode);

    expect(multiGet).toHaveBeenCalledOnce();
    expect(multiGet).toHaveBeenCalledWith(["labor.payslips", "store.petty.v1"]);
    expect(decode).toHaveBeenCalledOnce();
    expect(facts).toEqual({ payslips: [], pettyRecords: [], purchases: [], inventory: [] });
  });
});
