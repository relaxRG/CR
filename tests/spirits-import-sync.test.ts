import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { normalizeSpiritImportDate } from "../lib/spirits/date-utils";
import { parseSpiritsExcel } from "../lib/spirits/excel-import";
import { parseSpiritInventoryExcel } from "../lib/spirits/excel-parser";
import {
  buildImportedPurchaseRecords,
  dominantPurchaseMonth,
  purchasesForMonth,
} from "../lib/spirits/import-bridge";
import type { SpiritItem, SpiritPurchaseOrderItem, SpiritPurchaseRecord } from "../lib/spirits/types";

const item: SpiritItem = {
  id: "jim-beam",
  name: "金宾波本 700ML",
  nameEn: "Jim Beam White",
  category: "Whisky",
  unit: "瓶",
  refPrice: 118,
  active: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const order = (overrides: Partial<SpiritPurchaseOrderItem> = {}): SpiritPurchaseOrderItem => ({
  supplier: "至缘",
  rawName: "金宾波本/Jim Beam White",
  nameZh: "金宾波本",
  nameEn: "Jim Beam White",
  unitPrice: 118,
  quantity: 2,
  amount: 236,
  spec: "700ML",
  date: "2026-08-03",
  ...overrides,
});

describe("烈酒当月进货导入与库存同步", () => {
  it("统一归一化Excel序列号、日期对象、斜杠日期和中文日期，并拒绝不存在的自然日", () => {
    expect(normalizeSpiritImportDate(46238)).toBe("2026-08-04");
    expect(normalizeSpiritImportDate(new Date("2026-08-03T00:00:00.000Z"))).toBe("2026-08-03");
    expect(normalizeSpiritImportDate("2026/8/3 10:30:00")).toBe("2026-08-03");
    expect(normalizeSpiritImportDate("2026年8月3日")).toBe("2026-08-03");
    expect(normalizeSpiritImportDate("2026-02-30")).toBeNull();
  });

  it("通用进货导入只继承已验证日期，不会把首行空日期或无效日期错误归入今天", () => {
    const result = parseSpiritsExcel([
      ["日期", "商品名称", "单位", "数量", "单价", "金额"],
      ["2026年8月3日", "金宾波本", "瓶", 2, 118, 236],
      [null, "金宾波本", "瓶", 1, 118, 118],
      ["2026-02-30", "无效日期酒款", "瓶", 1, 100, 100],
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((row) => row.date)).toEqual(["2026-08-03", "2026-08-03"]);
    expect(result.rows.every((row) => row.month === "2026-08")).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("无效日期酒款") && warning.includes("已跳过"))).toBe(true);
  });

  it("盘点工作簿的供应商空日期继承上行日期，月份由有效订单主月份决定", () => {
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ["产品序号", "盘点分类", "中文名", "期初库存量", "期初单位成本", "期初库存成本", "本月进货量", "本月进货成本", "期末库存量", "单位成本", "期末库存成本", "消耗瓶数", "本期消耗量"],
      [1, "Whisky", "金宾波本 700ML", 1, 100, 100, 3, 354, 4, 118, 472, 0, 0],
    ]), "烈酒盘点");
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([
      ["供应商", "至缘"],
      ["行号", "日期", "商品名称", "规格", "数量", "单价", "应收增加"],
      [1, "2026/08/03", "金宾波本/Jim Beam White", "700ML", 2, 118, 236],
      [2, null, "金宾波本/Jim Beam White", "700ML", 1, 118, 118],
      [3, "2026-02-30", "应被忽略", "700ML", 1, 100, 100],
    ]), "至缘");

    const parsed = parseSpiritInventoryExcel(write(workbook, { type: "base64", bookType: "xlsx" }));
    expect(parsed.snapshot?.monthLabel).toBe("2026年8月");
    expect(parsed.snapshot?.purchaseOrders.map((purchase) => purchase.date)).toEqual(["2026-08-03", "2026-08-03"]);
  });

  it("采购流水会关联匹配库存档案且不丢失未匹配行，并将每行归属到自身月份", () => {
    const { records, unmatched } = buildImportedPurchaseRecords([
      order(),
      order({ rawName: "新酒款", nameZh: "新酒款", nameEn: "", date: "2026-09-01" }),
    ], [item], "2026-08");

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ itemId: item.id, month: "2026-08", category: "Whisky" });
    expect(records[1]).toMatchObject({ itemId: undefined, month: "2026-09", rawName: "新酒款" });
    expect(unmatched.map((row) => row.rawName)).toEqual(["新酒款"]);
    expect(dominantPurchaseMonth([order({ date: "2026-07-31" }), order(), order({ date: "2026-08-04" })], "2026-01")).toBe("2026-08");
  });

  it("台账重算输入合并已持久化与同批待写入采购，避免React状态尚未刷新时遗漏本次导入", () => {
    const persisted: SpiritPurchaseRecord[] = [{
      id: "persisted", month: "2026-08", date: "2026-08-01", itemId: item.id,
      rawName: item.name, unit: "瓶", quantity: 1, unitPrice: 100, amount: 100,
      source: "manual", createdAt: "2026-08-01T00:00:00.000Z",
    }];
    const pending = buildImportedPurchaseRecords([order()], [item], "2026-08").records;

    expect(purchasesForMonth(persisted, pending, "2026-08")).toHaveLength(2);
    expect(purchasesForMonth(persisted, pending, "2026-09")).toHaveLength(0);
  });
});
