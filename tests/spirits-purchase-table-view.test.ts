import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSpiritsExcel } from "../lib/spirits/excel-import";
import {
  applySupplierPurchaseTableView,
  DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW,
  type SupplierPurchaseTableRow,
} from "../lib/spirits/purchase-table-view";

const rows: SupplierPurchaseTableRow[] = [
  { id: "a", month: "2026-08", date: "2026-08-01", rawName: "原始A", unit: "瓶", quantity: 2, unitPrice: 85, amount: 170, source: "excel", createdAt: "x", displayName: "添加利金酒", displayGroup: "帝亚吉欧" },
  { id: "b", month: "2026-08", date: "2026-08-02", rawName: "原始B", unit: "箱", quantity: 1, unitPrice: 720, amount: 720, source: "excel", createdAt: "x", displayName: "麦卡伦12年", displayGroup: "独立品牌" },
  { id: "c", month: "2026-08", date: "2026-08-03", rawName: "原始C", unit: "瓶", quantity: 6, unitPrice: 55, amount: 330, source: "manual", createdAt: "x", displayName: "泰象苏打水", displayGroup: "" },
];

describe("供应商进货表排序筛选与Excel隔离", () => {
  it("可按总价排序、按数量区间筛选，并且不修改原始进货记录顺序或金额", () => {
    const view = {
      sort: { key: "amount" as const, direction: "desc" as const },
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, quantityMin: "2" },
    };
    const visible = applySupplierPurchaseTableView(rows, view);

    expect(visible.map((row) => row.id)).toEqual(["c", "a"]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((row) => row.amount)).toEqual([170, 720, 330]);
  });

  it("支持名称关键词、集团多选和仅待填筛选，空集团不被错误归类", () => {
    const byName = applySupplierPurchaseTableView(rows, {
      ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW,
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, nameQuery: "利金" },
    });
    const byGroup = applySupplierPurchaseTableView(rows, {
      ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW,
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, groups: ["帝亚吉欧", "独立品牌"] },
    });
    const unassigned = applySupplierPurchaseTableView(rows, {
      ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW,
      filters: { ...DEFAULT_SUPPLIER_PURCHASE_TABLE_VIEW.filters, onlyUnassignedGroup: true },
    });

    expect(byName.map((row) => row.id)).toEqual(["a"]);
    expect(byGroup.map((row) => row.id)).toEqual(["a", "b"]);
    expect(unassigned.map((row) => row.id)).toEqual(["c"]);
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
