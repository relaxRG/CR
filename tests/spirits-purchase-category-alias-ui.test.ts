import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const workspace = fs.readFileSync(path.join(process.cwd(), "components/inventory/SpiritsInventoryWorkspaceScreen.tsx"), "utf8");
const types = fs.readFileSync(path.join(process.cwd(), "lib/spirits/types.ts"), "utf8");
const bridge = fs.readFileSync(path.join(process.cwd(), "lib/spirits/import-bridge.ts"), "utf8");

describe("烈酒当月进货分类与供应商名称 UI 契约", () => {
  it("库存管理与当月进货的名称详情卡均提供不关闭卡片的快速分类选择，并写入当前酒款主档", () => {
    expect(workspace).toContain('testID="spirits-ledger-quick-category"');
    expect(workspace).toContain('testID="spirits-purchase-quick-category"');
    expect(workspace).toContain("快速选择分类");
    expect(workspace).toContain('updateItem(selectedLedgerItem.id, { category: category.name, categorySource: "manual" })');
    expect(workspace).toContain('updateItem(previewItem.id, { category: category.name, categorySource: "manual" })');
    expect(workspace).toContain('setPreviewItem((current) => current ? { ...current, category: category.name, categorySource: "manual" } : null)');
    expect(workspace).not.toContain("修改分类：${selectedLedgerItem.name}");
  });

  it("酒款档案提供供应商采购名称管理，而不是复制酒款主档", () => {
    expect(workspace).toContain('testID="spirits-supplier-alias-form"');
    expect(workspace).toContain("供应商采购名称");
    expect(workspace).toContain("不会新增重复酒款");
    expect(workspace).toContain("upsertSpiritSupplierAlias");
    expect(types).toContain("supplierAliases?: SpiritSupplierAlias[]");
  });

  it("手工和 Excel 录入均先按供应商别名关联唯一酒款主档", () => {
    expect(workspace).toContain("resolveSpiritItemForSupplierName(items, supplier, rawName.trim())");
    expect(bridge).toContain("resolveSpiritItemForSupplierName(items, order.supplier, name)");
    expect(bridge).toContain("supplierMatch");
  });
});
