import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("调休兑现唯一事件账本门禁", () => {
  it("PaySlip 模型不允许重新声明旧的直接兑现金额字段", () => {
    const types = read("lib/labor/types.ts");
    expect(types).not.toMatch(/^\s*compOffCashOut\??\s*:/m);
    expect(types).toContain("compOffCashOutSettlement?: CompOffCashOutSettlementSnapshot");
    expect(types).toContain("payrollDataQuarantine?: readonly PayrollDataQuarantineRecord[]");
  });

  it("生产重建、展示与导出只能读取账本快照，不得读取旧裸字段", () => {
    const productionFiles = [
      "lib/labor/store.tsx",
      "lib/labor/payroll-reconciliation.ts",
      "lib/labor/payroll-draft-reconciliation.ts",
      "app/labor.tsx",
      "app/labor-attendance.tsx",
      "components/labor/PayrollReconciliationPanel.tsx",
      "lib/labor/export.ts",
    ];
    for (const path of productionFiles) {
      expect(read(path), path).not.toMatch(/\bcompOffCashOut\b/);
    }
  });

  it("旧字段兼容读取只能位于迁移器，且必须删除裸字段并留下隔离证据", () => {
    const migration = read("lib/labor/comp-off-cashout-settlement.ts");
    expect(migration).toContain('Object.prototype.hasOwnProperty.call(rawSlip, "compOffCashOut")');
    expect(migration).toContain("delete (next as unknown as Record<string, unknown>).compOffCashOut");
    expect(migration).toContain("payrollDataQuarantine");
    expect(migration).toContain("auditCompOffCashOutIntegrity");
  });

  it("开发规范明确禁止裸金额回流并要求事件账本快照", () => {
    const standard = read("docs/dev-standards.md");
    expect(standard).toContain("绝对禁止");
    expect(standard).toContain("CompOffCashOutSettlementSnapshot");
    expect(standard).toContain("auditCompOffCashOutIntegrity()");
  });
});
