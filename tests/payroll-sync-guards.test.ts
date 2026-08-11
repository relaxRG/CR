import { describe, expect, it } from "vitest";
import { describePayrollAutoSync, shouldAutoSyncPayrollMonth } from "../lib/labor/payroll-sync-guards";

describe("薪资自动重算月度状态守卫", () => {
  it("DRAFT 月份允许排班自动同步", () => {
    expect(shouldAutoSyncPayrollMonth("draft")).toBe(true);
    expect(describePayrollAutoSync("draft")).toBe("自动重算：草稿月份");
  });

  it("ADJUSTING 月份允许受控自动同步", () => {
    expect(shouldAutoSyncPayrollMonth("adjusting")).toBe(true);
    expect(describePayrollAutoSync("adjusting")).toBe("自动重算：调整中月份");
  });

  it("FROZEN 月份禁止任何自动重算", () => {
    expect(shouldAutoSyncPayrollMonth("frozen")).toBe(false);
    expect(describePayrollAutoSync("frozen")).toBe("不自动重算：已冻结月份");
  });
});
