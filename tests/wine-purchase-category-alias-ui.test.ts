import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const screen = fs.readFileSync(path.join(root, "app/wine-inventory.tsx"), "utf8");
const form = fs.readFileSync(path.join(root, "app/wine-form.tsx"), "utf8");

describe("葡萄酒当月进货分类与供应商别名 UI 契约", () => {
  it("商品名称点击打开分类快速选择卡，不再只使用系统 Alert", () => {
    expect(screen).toContain('testID="wine-purchase-category-sheet"');
    expect(screen).toContain("快速选择分类");
    expect(screen).toContain("wine-purchase-category-");
    expect(screen).toContain("setSelectedPurchaseForCategory(row)");
  });

  it("分类修改只写入当前采购流水，并保留酒款档案入口与删除操作", () => {
    expect(screen).toContain("updateManualPurchase(purchase.id, { category })");
    expect(screen).toContain("分类仅影响这笔采购的展示与筛选");
    expect(screen).toContain("查看酒款档案");
    expect(screen).toContain("新建酒款档案");
  });

  it("酒款档案可维护供应商采购名称别名，并由从进货卡发起的新建流程自动预填", () => {
    expect(form).toContain("供应商采购名称");
    expect(form).toContain("添加供应商名称");
    expect(form).toContain("supplierAliases");
    expect(form).toContain("purchaseName");
  });
});
