import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { utils, write } from "xlsx";
import { normalizeImportDate } from "../lib/import/date-utils";
import { parseSpiritsExcel } from "../lib/spirits/excel-import";
import { parseSpiritInventoryExcel } from "../lib/spirits/excel-parser";
import { normalizeLLMRows } from "../lib/spirits/pdf-import";
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
    expect(normalizeImportDate(46238)).toBe("2026-08-04");
    expect(normalizeImportDate(new Date("2026-08-03T00:00:00.000Z"))).toBe("2026-08-03");
    expect(normalizeImportDate("2026/8/3 10:30:00")).toBe("2026-08-03");
    expect(normalizeImportDate("2026年8月3日")).toBe("2026-08-03");
    expect(normalizeImportDate("2026-02-30")).toBeNull();
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


describe("烈酒导入日期边界：非法日期与跨月采购", () => {
  it("跳过非法自然日，保留空日期继承行，并将跨月有效采购分别归入自身月份", () => {
    const parsed = parseSpiritsExcel([
      ["日期", "商品名称", "单位", "数量", "单价", "金额"],
      ["2026-07-31", "金宾波本", "瓶", 1, 118, 118],
      [null, "金宾波本", "瓶", 2, 118, 236],
      ["2026-02-30", "不应导入的酒款", "瓶", 1, 100, 100],
      ["2026年8月1日", "金宾波本", "瓶", 3, 118, 354],
      [null, "金宾波本", "瓶", 1, 118, 118],
    ]);

    expect(parsed.rows.map((row) => ({ date: row.date, month: row.month, name: row.rawName }))).toEqual([
      { date: "2026-07-31", month: "2026-07", name: "金宾波本" },
      { date: "2026-07-31", month: "2026-07", name: "金宾波本" },
      { date: "2026-08-01", month: "2026-08", name: "金宾波本" },
      { date: "2026-08-01", month: "2026-08", name: "金宾波本" },
    ]);
    expect(parsed.warnings.some((warning) => warning.includes("不应导入的酒款") && warning.includes("日期无法识别"))).toBe(true);

    const orders = parsed.rows.map((row) => order({
      rawName: row.rawName,
      nameZh: row.nameZh,
      nameEn: row.nameEn,
      date: row.date,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      amount: row.amount,
    }));
    const { records, unmatched } = buildImportedPurchaseRecords(orders, [item], "2026-07");

    expect(unmatched).toEqual([]);
    expect(records.map((record) => record.month)).toEqual(["2026-07", "2026-07", "2026-08", "2026-08"]);
    expect(records.reduce((total, record) => total + record.amount, 0)).toBe(826);
  });
});


describe("烈酒普通手动录入即时库存更新", () => {
  it("将刚创建的单笔采购作为待写入记录合并进当月台账输入，且页面不得依赖下一次状态刷新", () => {
    const manualPending: SpiritPurchaseRecord = {
      id: "manual-pending",
      month: "2026-08",
      date: "2026-08-15",
      itemId: item.id,
      rawName: item.name,
      unit: "瓶",
      quantity: 1,
      unitPrice: 128,
      amount: 128,
      supplier: "至缘",
      category: "Whisky",
      source: "manual",
      createdAt: "2026-08-15T00:00:00.000Z",
    };

    expect(purchasesForMonth([], [manualPending], "2026-08")).toEqual([manualPending]);

    const inventoryPage = readFileSync(resolve(process.cwd(), "app/spirits-inventory.tsx"), "utf8");
    const storeSource = readFileSync(resolve(process.cwd(), "lib/spirits/crud-store.tsx"), "utf8");
    expect(storeSource).toContain("addPurchase: (data: Omit<SpiritPurchaseRecord, \"id\" | \"createdAt\">) => SpiritPurchaseRecord;");
    expect(storeSource).toContain("return record;");
    expect(inventoryPage).toContain("const pending = addPurchase({ ...data, supplier });");
    expect(inventoryPage).toContain("syncLedgerFromPurchases(pending.month, [pending]);");
  });
});


describe("烈酒PDF进货导入日期边界", () => {
  it("只继承已验证日期，跳过非法或首行缺日期，并按实际月份保留有效采购", () => {
    const result = normalizeLLMRows({
      supplier: "至缘",
      rows: [
        { date: null, rawName: "首行缺日期", quantity: 1, unitPrice: 100, amount: 100 },
        { date: "2026-07-31", rawName: "七月金宾", quantity: 1, unitPrice: 118, amount: 118 },
        { date: "", rawName: "继承七月日期", quantity: 2, unitPrice: 118, amount: 236 },
        { date: "2026-02-30", rawName: "非法日期酒款", quantity: 1, unitPrice: 100, amount: 100 },
        { date: "2026年8月1日", rawName: "八月金宾", quantity: 1, unitPrice: 118, amount: 118 },
      ],
    });

    expect(result.rows.map((row) => ({ name: row.rawName, date: row.date, month: row.month }))).toEqual([
      { name: "七月金宾", date: "2026-07-31", month: "2026-07" },
      { name: "继承七月日期", date: "2026-07-31", month: "2026-07" },
      { name: "八月金宾", date: "2026-08-01", month: "2026-08" },
    ]);
    expect(result.month).toBe("2026-07");
    expect(result.totalAmount).toBe(472);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("首行缺日期"),
      expect.stringContaining("非法日期酒款"),
    ]));
  });
});
