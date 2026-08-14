import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpiritsExcel } from "../lib/spirits/excel-import";
import {
  applySupplierPurchaseTableView,
  collectSupplierPurchaseNameOptions,
  DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW,
  type SupplierPurchaseTableRow,
} from "../lib/spirits/purchase-table-view";

const rows: SupplierPurchaseTableRow[] = [
  {
    id: "a", month: "2026-08", date: "2026-08-01", itemId: "gin-001", rawName: "添加利金酒/Tanqueray Gin", unit: "瓶", quantity: 2, unitPrice: 85, amount: 170, source: "excel", createdAt: "x",
    nameKey: "item:gin-001", isMatched: true, searchableName: "添加利金酒 Tanqueray Gin 添加利金酒/Tanqueray Gin", displayName: "添加利金酒", displayGroup: "帝亚吉欧",
  },
  {
    id: "b", month: "2026-08", date: "2026-08-02", itemId: "macallan-012", rawName: "麦卡伦12年/Macallan 12", unit: "箱", quantity: 1, unitPrice: 720, amount: 720, source: "excel", createdAt: "x",
    nameKey: "item:macallan-012", isMatched: true, searchableName: "麦卡伦12年 Macallan 12 麦卡伦12年/Macallan 12", displayName: "麦卡伦12年", displayGroup: "独立品牌",
  },
  {
    id: "c", month: "2026-08", date: "2026-08-03", rawName: "泰象苏打水/Chang Soda", unit: "瓶", quantity: 6, unitPrice: 55, amount: 330, source: "manual", createdAt: "x",
    nameKey: "raw:泰象苏打水/chang soda", isMatched: false, searchableName: "泰象苏打水 Chang Soda 泰象苏打水/Chang Soda", displayName: "泰象苏打水", displayGroup: "",
  },
];

const view = (overrides: Partial<typeof DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW> = {}) => ({
  ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW,
  ...overrides,
  filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, ...(overrides.filters ?? {}) },
});

describe("供应商进货表排序筛选与Excel隔离", () => {
  it("可按总价排序、按数量区间筛选，并且不修改原始进货记录顺序或金额", () => {
    const visible = applySupplierPurchaseTableView(rows, view({
      sort: { key: "amount", direction: "desc" },
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, quantityMin: "2" },
    }));

    expect(visible.map((row) => row.id)).toEqual(["c", "a"]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.amount)).toEqual([170, 720, 330]);
  });

  it("支持名称关键词、集团多选和仅待填筛选，空集团不被错误归类", () => {
    const byName = applySupplierPurchaseTableView(rows, view({
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, nameQuery: "利金" },
    }));
    const byGroup = applySupplierPurchaseTableView(rows, view({
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, groups: ["帝亚吉欧", "独立品牌"] },
    }));
    const unassigned = applySupplierPurchaseTableView(rows, view({
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, onlyUnassignedGroup: true },
    }));

    expect(byName.map((row) => row.id)).toEqual(["a"]);
    expect(byGroup.map((row) => row.id)).toEqual(["a", "b"]);
    expect(unassigned.map((row) => row.id)).toEqual(["c"]);
  });

  it("中英文显示切换后，已选名称使用稳定键保持不变", () => {
    const selectedKey = "item:gin-001";
    const chineseRows = rows.map((row) => ({ ...row }));
    const englishRows = rows.map((row) => row.id === "a" ? { ...row, displayName: "Tanqueray Gin" } : row.id === "b" ? { ...row, displayName: "Macallan 12" } : { ...row, displayName: "Chang Soda" });
    const selectedView = view({
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, nameKeys: [selectedKey] },
    });

    expect(collectSupplierPurchaseNameOptions(chineseRows).find((option) => option.key === selectedKey)?.label).toBe("添加利金酒");
    expect(collectSupplierPurchaseNameOptions(englishRows).find((option) => option.key === selectedKey)?.label).toBe("Tanqueray Gin");
    expect(applySupplierPurchaseTableView(chineseRows, selectedView).map((row) => row.nameKey)).toEqual([selectedKey]);
    expect(applySupplierPurchaseTableView(englishRows, selectedView).map((row) => row.nameKey)).toEqual([selectedKey]);
  });

  it("名称多选、数量区间、集团和未匹配筛选按交集计算", () => {
    const intersection = applySupplierPurchaseTableView(rows, view({
      filters: {
        ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters,
        nameKeys: ["item:gin-001", "raw:泰象苏打水/chang soda"],
        quantityMin: "2",
        groups: ["帝亚吉欧"],
      },
    }));
    const unmatched = applySupplierPurchaseTableView(rows, view({
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, onlyUnmatchedNames: true },
    }));

    expect(intersection.map((row) => row.id)).toEqual(["a"]);
    expect(unmatched.map((row) => row.id)).toEqual(["c"]);
  });

  it("中英文显示、字段重排和排序筛选不参与Excel导入列解析或导出字段定义", () => {
    const parsed = parseSpiritsExcel([
      ["日期", "商品名称", "单位", "数量", "单价", "金额"],
      ["2026-08-03", "金宾波本/Jim Beam White", "瓶", 2, 118, 236],
    ]);
    expect(parsed.rows[0]).toMatchObject({ rawName: "金宾波本/Jim Beam White", unit: "瓶", quantity: 2, unitPrice: 118, amount: 236 });

    const parser = readFileSync(resolve(process.cwd(), "lib/spirits/excel-parser.ts"), "utf8");
    const exporter = readFileSync(resolve(process.cwd(), "lib/spirits/export.ts"), "utf8");
    const screen = readFileSync(resolve(process.cwd(), "app/spirits-inventory.tsx"), "utf8");

    expect(parser).toContain("列：0=行号 1=日期 2=商品名称 3=规格 4=数量 5=单价 6=应收增加");
    expect(exporter).toContain('"序号", "日期", "商品名称", "英文名", "分类", "规格", "数量(瓶)", "单价(¥)", "金额(¥)", "供应商", "来源"');
    expect(screen).toContain("applySupplierPurchaseTableView");
    expect(screen).not.toContain("sortPurchaseRecordsAndPersist");
  });
});
