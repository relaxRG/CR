import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const workspace = fs.readFileSync(path.join(process.cwd(), "components/inventory/SpiritsInventoryWorkspaceScreen.tsx"), "utf8");
const bridge = fs.readFileSync(path.join(process.cwd(), "lib/spirits/import-bridge.ts"), "utf8");
const bottleForm = fs.readFileSync(path.join(process.cwd(), "app/bottle-form.tsx"), "utf8");
const channelPage = fs.readFileSync(path.join(process.cwd(), "app/bottle-channels.tsx"), "utf8");

describe("烈酒分类与统一供应渠道 UI 契约", () => {
  it("库存管理与当月进货的名称详情卡均提供不关闭卡片的快速分类选择，并同步写回当前采购记录", () => {
    expect(workspace).toContain('testID="spirits-ledger-quick-category"');
    expect(workspace).toContain('testID="spirits-purchase-quick-category"');
    expect(workspace).toContain("快速选择分类");
    expect(workspace).toContain('updateItem(selectedLedgerItem.id, { category: category.name, categorySource: "manual" })');
    expect(workspace).toContain('updateItem(previewItem.id, { category: category.name, categorySource: "manual" })');
    expect(workspace).toContain("setPreviewPurchaseId(p.id)");
    expect(workspace).toContain("buildPurchaseCategorySelection(previewItem.id, category.name)");
    expect(workspace).toContain("syncLedgerFromPurchases(month)");
  });

  it("烈酒库存不再维护重复别名表单，编辑酒款会进入已有酒款详情或名称预填的新建表单", () => {
    expect(workspace).not.toContain('testID="spirits-supplier-alias-form"');
    expect(workspace).toContain("openBottleForSpiritItem");
    expect(workspace).toContain('pathname: "/bottle/[id]"');
    expect(workspace).toContain('pathname: "/bottle-form"');
    expect(workspace).toContain("sourceSpiritItemId: item.id");
    expect(bottleForm).toContain("sourceSpiritItemId");
    expect(bottleForm).toContain('bottleLinkConfidence: "confirmed"');
    expect(channelPage).toContain("采购名称：");
  });

  it("手工、Excel 与 PDF 录入优先使用鸡尾酒库统一供应渠道，旧别名仅作为兼容回退", () => {
    expect(bridge).toContain("resolveBottleForSupplierProductName");
    expect(bridge).toContain("bottles: Bottle[] = []");
    expect(workspace).toContain("resolveBottleForSupplierProductName(bottles, supplier, rawName.trim())");
    expect(workspace).toContain("buildImportedPurchaseRecords(orders, resolvedItems, month, importPreviewSource, bottles)");
    expect(workspace).toContain("migrateSpiritAliasesToBottleChannels");
  });

  it("库存表使用紧凑无箭头表头，并提供真实多选、批量分类和安全归档删除入口", () => {
    expect(workspace).toContain(">序号</Text>");
    expect(workspace).not.toContain("{label}⌄");
    expect(workspace).toContain('testID="spirits-ledger-select-toggle"');
    expect(workspace).toContain('testID="spirits-ledger-batch-toolbar"');
    expect(workspace).toContain("批量修改分类");
    expect(workspace).toContain("有采购、盘点或月结历史，将归档");
    expect(workspace).toContain('fontWeight: "500"');
  });
});
