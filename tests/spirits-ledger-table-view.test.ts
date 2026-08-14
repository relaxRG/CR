import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { utils, write } from "xlsx";
import { parseSpiritInventoryExcel } from "../lib/spirits/excel-parser";
import {
  applyLedgerTableView,
  calculateLedgerTableTotals,
  DEFAULT_LEDGER_TABLE_VIEW,
  LEDGER_TABLE_COLUMNS,
  type LedgerTableRow,
} from "../lib/spirits/ledger-table-view";

const rows: LedgerTableRow[] = [
  {
    id: "gin", nameKey: "item:gin", searchableName: "添加利金酒 Tanqueray Gin", displayName: "添加利金酒", group: "帝亚吉欧",
    referencePrice: 85, openingQty: 2, openingUnitCost: 80, openingCost: 160,
    purchaseQty: 6, purchaseCost: 510, closingQty: 5, closingUnitCost: 83.75, closingCost: 418.75,
    consumeQty: 3, consumeCost: 251.25,
  },
  {
    id: "whisky", nameKey: "item:whisky", searchableName: "麦卡伦12年 Macallan 12", displayName: "麦卡伦12年", group: "独立品牌",
    referencePrice: 720, openingQty: 1, openingUnitCost: 700, openingCost: 700,
    purchaseQty: 1, purchaseCost: 720, closingQty: 1, closingUnitCost: 710, closingCost: 710,
    consumeQty: 1, consumeCost: 710,
  },
  {
    id: "unmatched", nameKey: "raw:未匹配原始名称", searchableName: "未匹配原始名称 Unmatched Raw Name", displayName: "未匹配原始名称", group: "",
    referencePrice: 50, openingQty: 0, openingUnitCost: 0, openingCost: 0,
    purchaseQty: 4, purchaseCost: 200, closingQty: 4, closingUnitCost: 50, closingCost: 200,
    consumeQty: 0, consumeCost: 0,
  },
];

const view = (filters: Partial<typeof DEFAULT_LEDGER_TABLE_VIEW.filters> = {}, sort = DEFAULT_LEDGER_TABLE_VIEW.sort) => ({
  sort,
  filters: { ...DEFAULT_LEDGER_TABLE_VIEW.filters, ...filters, ranges: { ...DEFAULT_LEDGER_TABLE_VIEW.filters.ranges, ...(filters.ranges ?? {}) } },
});

describe("完整库存Excel台账展示层", () => {
  it("固定保留商品名称、十一项库存成本字段及最右集团列", () => {
    expect(LEDGER_TABLE_COLUMNS).toEqual([
      "name", "referencePrice", "openingQty", "openingUnitCost", "openingCost", "purchaseQty", "purchaseCost",
      "closingQty", "closingUnitCost", "closingCost", "consumeQty", "consumeCost", "group",
    ]);
    expect(LEDGER_TABLE_COLUMNS.at(-1)).toBe("group");
  });

  it("名称多选、数量范围、成本范围和集团筛选按交集计算", () => {
    const visible = applyLedgerTableView(rows, view({
      nameKeys: ["item:gin", "raw:未匹配原始名称"],
      groups: ["帝亚吉欧"],
      ranges: { purchaseQty: { min: "2", max: "" }, closingCost: { min: "400", max: "" } },
    }));
    expect(visible.map((row) => row.id)).toEqual(["gin"]);
  });

  it("筛选后的合计只聚合可见行，不继续显示全量合计", () => {
    const visible = applyLedgerTableView(rows, view({ groups: ["帝亚吉欧"] }));
    expect(calculateLedgerTableTotals(visible)).toEqual({
      openingQty: 2, openingCost: 160, purchaseQty: 6, purchaseCost: 510,
      closingQty: 5, closingCost: 418.75, consumeQty: 3, consumeCost: 251.25,
    });
    expect(calculateLedgerTableTotals(rows).closingCost).toBe(1328.75);
  });

  it("排序仅重排可见行副本，不改写库存台账源记录", () => {
    const visible = applyLedgerTableView(rows, view({}, { key: "closingCost", direction: "desc" }));
    expect(visible.map((row) => row.id)).toEqual(["whisky", "gin", "unmatched"]);
    expect(rows.map((row) => row.id)).toEqual(["gin", "whisky", "unmatched"]);
  });

  it("Excel烈酒盘点导入字段与展示列、排序筛选及集团列隔离", () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ["产品序号", "盘点分类", "中文名", "期初库存量", "期初单位成本", "期初库存成本", "本月进货量", "本月进货成本", "期末库存量", "单位成本", "期末库存成本", "消耗瓶数", "本期消耗量"],
      [1, "Base (Gin)", "添加利金酒", 2, 80, 160, 6, 510, 5, 83.75, 418.75, 3, 251.25],
    ]), "烈酒盘点");
    const parsed = parseSpiritInventoryExcel(write(workbook, { type: "base64", bookType: "xlsx" }));
    expect(parsed.snapshot?.items[0]).toMatchObject({ name: "添加利金酒", initQty: 2, initUnitCost: 80, purchaseQty: 6, purchaseCost: 510, endQty: 5, unitCost: 83.75, endCost: 418.75, consumeBottles: 3, consumeCost: 251.25 });

    const parser = readFileSync(resolve(process.cwd(), "lib/spirits/excel-parser.ts"), "utf8");
    const exporter = readFileSync(resolve(process.cwd(), "lib/spirits/export.ts"), "utf8");
    expect(parser).toContain("0=行号 1=日期 2=商品名称 3=规格 4=数量 5=单价 6=应收增加");
    expect(exporter).toContain('"序号", "日期", "商品名称", "英文名", "分类", "规格", "数量(瓶)", "单价(¥)", "金额(¥)", "供应商", "来源"');
  });
});
