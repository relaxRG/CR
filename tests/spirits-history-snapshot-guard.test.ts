import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolveSpiritItemForSupplierName } from "@/lib/spirits/supplier-alias";

const storeSource = readFileSync("lib/spirits/crud-store.tsx", "utf8");
const workspaceSource = readFileSync("components/inventory/SpiritsInventoryWorkspaceScreen.tsx", "utf8");

describe("烈酒历史分类与归档保护", () => {
  it("当前分类迁移只修改酒款主档，不改写历史采购分类快照", () => {
    expect(storeSource).toContain("采购分类是发生时快照");
    expect(storeSource).toContain("历史采购分类永久保留原始快照");
    expect(storeSource).not.toContain('type: "BATCH_UPDATE_PURCHASES_CATEGORY"');
  });

  it("批量分类和删除都必须受归档月门禁，参考价历史项目只能归档", () => {
    expect(workspaceSource).toContain("if (!assertSpiritsWritable() || selectedLedgerItemIds.size === 0) return;");
    expect(workspaceSource).toContain("store.refPrices.some((entry) => entry.itemId === item.id)");
  });

  it("已归档酒款不再作为供应商名称导入的默认匹配目标", () => {
    const matched = resolveSpiritItemForSupplierName([
      { id: "archived", name: "君度", nameEn: "Cointreau", supplier: "供应商A", supplierAliases: [], active: false },
      { id: "active", name: "君度", nameEn: "Cointreau", supplier: "供应商A", supplierAliases: [], active: true },
    ] as any, "供应商A", "君度");
    expect(matched?.item.id).toBe("active");
  });
});
