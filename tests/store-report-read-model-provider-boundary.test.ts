import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(`${process.cwd()}/${relative}`, "utf8");

describe("报表只读物化视图边界", () => {
  it("只批量读取登记的跨域事实键，并在卸载时注销 reload 订阅", () => {
    const provider = source("components/providers/StoreReportReadModelProvider.tsx");

    expect(provider).toContain('"store.revenue.v1"');
    expect(provider).toContain('"store.petty.v1"');
    expect(provider).toContain('"labor_employees_v1"');
    expect(provider).toContain('"labor_payslips_v1"');
    expect(provider).toContain("loadStoreReportFacts(AsyncStorage, REPORT_SNAPSHOT_KEYS");
    expect(provider).toContain("const unregister = registerStoreReload(guardedRefresh)");
    expect(provider).toContain("unregister();");
    expect(provider).not.toContain("AsyncStorage.setItem");
    expect(provider).not.toContain("notifySyncChange");
  });

  it("月报工资同步、付款展示和月结汇总只消费报表工资投影", () => {
    const summary = source("app/monthly-summary.tsx");

    expect(summary).toContain("useStoreReportReadModel");
    expect(summary).toContain("const { employees, paySlips, deptOrder } = reportReadModel.laborDetails");
    expect(summary).not.toContain("useEmployeeStore");
    expect(summary).not.toContain("usePaySlipStore");
    expect(summary).not.toContain("useDeptOrderStore");
  });
});
