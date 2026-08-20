import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manager = fs.readFileSync(path.join(root, "components/spirits/inventory-category-manager.tsx"), "utf8");
const workspace = fs.readFileSync(path.join(root, "components/inventory/SpiritsInventoryWorkspaceScreen.tsx"), "utf8");

describe("烈酒分类管理与库存多选 UI 契约", () => {
  it("分类管理将取消、标题和保存固定在同一页面式卡片内，并支持颜色编辑", () => {
    expect(manager).toContain('testID="inventory-category-manager-cancel"');
    expect(manager).toContain('testID="inventory-category-manager-save"');
    expect(manager).toContain(">进销存分类</Text>");
    expect(manager).toContain("分类颜色");
    expect(manager).toContain("inventory-category-color-");
  });

  it("自定义分类支持删除，且有酒款时必须迁移到目标分类或未分类", () => {
    expect(manager).toContain("迁移并删除");
    expect(manager).toContain("删除前必须先迁移分类归属或设为未分类");
    expect(manager).toContain("inventory-category-delete-");
    expect(manager).toContain("内置");
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
