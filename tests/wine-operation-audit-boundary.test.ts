import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const types = readFileSync("lib/wine/types.ts", "utf8");
const exportSource = readFileSync("lib/wine/workbook-export.ts", "utf8");

describe("葡萄酒操作审计边界", () => {
  it("葡萄酒保留独立的恢复点与月度操作审计，不复用烈酒酒款供应渠道模型", () => {
    expect(types).toContain("export interface WineAuditEntry");
    expect(types).toContain('reason: "before_clear_purchases" | "before_recalculate" | "before_replace_import"');
    expect(types).not.toContain("SupplierChannel");
  });

  it("葡萄酒导出包含本月导入与重建审计，便于跨设备恢复核对", () => {
    expect(exportSource).toContain("导入与重建审计");
    expect(exportSource).toContain("data.auditEntries.filter((entry) => entry.month === data.month)");
  });
});
