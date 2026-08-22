import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manager = fs.readFileSync(path.join(root, "components/spirits/inventory-category-manager.tsx"), "utf8");
const workspace = fs.readFileSync(path.join(root, "components/inventory/SpiritsInventoryWorkspaceScreen.tsx"), "utf8");

describe("烈酒分类管理与库存多选 UI 契约", () => {
  it("编辑分类卡将取消和保存固定在卡片内部，外层分类页只保留关闭操作", () => {
    expect(manager).toContain('testID="inventory-category-manager-close"');
    expect(manager).toContain('testID="inventory-category-edit-cancel"');
    expect(manager).toContain('testID="inventory-category-edit-save"');
    expect(manager).toContain("S.editCardFooter");
    expect(manager).toContain(">进销存分类</Text>");
    expect(manager).toContain("分类颜色");
    expect(manager).toContain("inventory-category-color-");
    expect(manager).not.toContain('testID="inventory-category-manager-save"');
  });

  it("所有分类均支持删除，有酒款时统一迁移到目标分类或未分类", () => {
    expect(manager).toContain("所有分类都可删除");
    expect(manager).toContain("迁移并删除");
    expect(manager).toContain("删除前必须先迁移分类归属或设为未分类");
    expect(manager).toContain("inventory-category-delete-");
    expect(manager).not.toContain("!category.builtin ?");
  });

  it("分类管理抽屉和编辑卡在 iPad 浮窗与 Mac 窗口中保持适中最大宽度", () => {
    expect(manager).toContain('sheet: { width: "100%", maxWidth: 720, alignSelf: "center"');
    expect(manager).toContain('dialog: { width: "100%", maxWidth: 540, alignSelf: "center"');
  });

  it("库存表头不显示排序符号，提供紧凑列宽和选择后的批量分类、归档删除", () => {
    expect(workspace).toContain('>序号</Text>');
    expect(workspace).not.toContain("{label}⌄");
    expect(workspace).toContain('["商品名称", "name", 140]');
    expect(workspace).toContain('testID="spirits-ledger-select-toggle"');
    expect(workspace).toContain('testID="spirits-ledger-batch-toolbar"');
    expect(workspace).toContain("requestBatchLedgerCategory");
    expect(workspace).toContain("requestBatchLedgerRemove");
  });
});
