import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (relative: string) => readFileSync(`${process.cwd()}/${relative}`, "utf8");

describe("报表只读物化视图边界", () => {
  it("只批量读取登记的跨域事实键，并在卸载时注销 reload 订阅", () => {
    const provider = source("components/providers/StoreReportReadModelProvider.tsx");

    expect(provider).toContain("useStoreReportReadManifest");
    expect(provider).toContain("loadConsistentReportSnapshot");
    expect(provider).toContain("committedRevision: committedRevision.current");
    expect(provider).toContain("snapshot.unchanged");
    expect(provider).toContain("const unregister = registerStoreReload(guardedRefresh)");
    expect(provider).toContain("return unregister;");
    expect(provider).toContain("refreshController.current.dispose()");

    const manifest = source("lib/store/report-read-manifest.ts");
    expect(manifest).toContain('"store.revenue.v1"');
    expect(manifest).toContain('"store.petty.v1"');
    expect(manifest).toContain('"labor_employees_v1"');
    expect(manifest).toContain('"labor_payslips_v1"');
    expect(manifest).toContain('"labor_shifts_v1"');
    expect(manifest).toContain('"spirits.purchases.v3"');
    expect(manifest).toContain('"food.purchases.v1"');
    expect(manifest).toContain('"store.petty_labor_links.v1"');
    expect(manifest).toContain('"wine.snapshots.v2"');
    expect(manifest).toContain('"wine.manual_purchases.v1"');
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
    expect(summary).not.toContain("usePettyCashStore");
    expect(summary).not.toContain("useSpiritsInventoryStore");
    expect(summary).not.toContain("useSupplierPurchaseStore");
    expect(summary).not.toContain("useWineSnapshotStore");
    expect(summary).not.toContain("useWineManualPurchaseStore");
    expect(summary).not.toContain("usePettyLaborLinkStore");
    expect(summary).toContain("reportReadModel.monthlyDetails");
  });

  it("时段分析仅从报表投影读取排班与采购事实，营业时间和报告写命令仍由报表域所有", () => {
    const period = source("app/period-analysis.tsx");

    expect(period).toContain("useStoreReportReadModel");
    expect(period).toContain("const { shifts, purchases } = reportReadModel.periodDetails");
    expect(period).not.toContain("useSpiritsInventoryStore");
    expect(period).not.toContain("useSupplierPurchaseStore");
    expect(period).not.toContain("useShiftStore");
    expect(period).not.toContain("useEmployeeStore");
    expect(period).toContain("useScheduleStore");
    expect(period).toContain("usePeriodAnalysisStore");
  });
});
