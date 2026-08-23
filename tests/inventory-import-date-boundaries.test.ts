import { beforeEach, describe, expect, it, vi } from "vitest";
import { utils, write } from "xlsx";

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn(),
}));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: vi.fn(),
  EncodingType: { Base64: "base64" },
}));

import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { parseWineWorkbook } from "../lib/wine/workbook-engine";
import { parseSupplierExcel } from "../lib/store/supplier-import";

function toBase64(sheets: Array<{ name: string; rows: unknown[][] }>): string {
  const workbook = utils.book_new();
  sheets.forEach(({ name, rows }) => utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), name));
  return write(workbook, { type: "base64", bookType: "xlsx" });
}

describe("葡萄酒库存导入日期边界", () => {
  it("跳过非法日期，继承合并单元格空日期，并按有效采购主月份生成快照标签", async () => {
    const base64 = toBase64([
      {
        name: "葡萄酒盘点",
        rows: [
          ["序号", "类型", "供应商", "名称", "期初单价", "期初数量", "期初成本", "进货数量", "进货成本", "期末数量", "单位成本", "期末成本", "消耗瓶数", "消耗量"],
          [1, "Red", "酒商A", "H5红酒", 100, 1, 100, 3, 360, 4, 120, 480, 0, 0],
        ],
      },
      {
        name: "进货总单",
        rows: [
          ["行号", "日期", "供应商", "商品名称", "单价", "数量", "金额"],
          ["说明", "", "", "", "", "", ""],
          [1, "2026-07-31", "酒商A", "H5红酒", 120, 1, 120],
          [2, null, "酒商A", "H5红酒", 120, 2, 240],
          [3, "2026-02-30", "酒商A", "不应导入", 100, 1, 100],
          [4, "2026年8月1日", "酒商A", "H5红酒", 120, 3, 360],
          [5, null, "酒商A", "H5红酒", 120, 1, 120],
        ],
      },
    ]);

    const preview = await parseWineWorkbook(base64, "2026-07");

    expect(preview?.purchaseLines.map((order) => order.date)).toEqual([
      "2026-07-31", "2026-07-31", "2026-08-01", "2026-08-01",
    ]);
    expect(preview?.purchaseLines.map((order) => order.productName)).not.toContain("不应导入");
    expect(preview?.monthLabel).toBe("2026年7月");
  });
});

describe("食品供应商导入日期边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("拒绝非法显式日期，仅继承已验证日期，并保留跨月有效采购的原始日期", async () => {
    const base64 = toBase64([
      {
        name: "供应商进货",
        rows: [
          ["往来单位", "食品供应商"],
          ["行号", "日期", "单据编号", "商品名称", "规格", "数量", "单价", "金额"],
          [1, "2026/07/31", "A-1", "青柠檬", "KG", 1, 10, 10],
          [2, null, "A-1", "薄荷", "KG", 2, 15, 30],
          [3, "2026-02-30", "A-2", "不应导入食材", "KG", 1, 99, 99],
          [4, "2026年8月1日", "A-3", "菠萝", "KG", 3, 20, 60],
        ],
      },
    ]);

    (DocumentPicker.getDocumentAsync as any).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://supplier.xlsx", name: "supplier.xlsx" }],
    });
    (FileSystem.readAsStringAsync as any).mockResolvedValue(base64);

    const preview = await parseSupplierExcel();

    expect(preview?.supplierName).toBe("食品供应商");
    expect(preview?.rows.map((row) => ({ name: row.rawName, date: row.date }))).toEqual([
      { name: "青柠檬", date: "2026-07-31" },
      { name: "薄荷", date: "2026-07-31" },
      { name: "菠萝", date: "2026-08-01" },
    ]);
    expect(preview?.rows.some((row) => row.rawName === "不应导入食材")).toBe(false);
    expect(preview?.totalAmount).toBe(100);
  });
});
