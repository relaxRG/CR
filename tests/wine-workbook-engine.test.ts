import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import {
  assessWineWorkbookImport,
  createWineFileFingerprint,
  createWinePurchaseFingerprint,
  createWineWorkbookSnapshot,
  parseWineWorkbook,
  rebuildWineSnapshotFromPurchases,
} from "@/lib/wine/workbook-engine";
import type { WineManualPurchase } from "@/lib/wine/types";

function workbookBase64() {
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ["产品序号", "酒类", "盘点分类", "中文名", "期初单位成本", "期初库存量", "期初库存成本", "本月进货量", "本月进货成本", "期末库存量", "单位成本", "期末库存成本", "消耗瓶数", "本期消耗量"],
    [1, "Red", "甘澧", "测试红葡萄酒", 100, 2, 200, 3, 330, 4, 110, 440, 1, 90],
  ]), "葡萄酒盘点");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([
    ["行号", "日期", "供应商", "商品名称", "单价", "数量", "应收增加"],
    [1, "2026-02-12", "甘澧", "测试红葡萄酒", 110, 3, 330],
  ]), "进货总单");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["产品序号", "进货数量"], [1, 3]]), "进货汇总");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["供应商", "月进货额"], ["甘澧", 330]]), "Summary");
  return write(workbook, { type: "base64", bookType: "xlsx" });
}

function purchase(overrides: Partial<WineManualPurchase> = {}): WineManualPurchase {
  return {
    id: "p-1", date: "2026-02-12", supplier: "甘澧", bottleId: null, productName: "测试红葡萄酒",
    unitPrice: 110, quantity: 3, amount: 330, notes: "", createdAt: "2026-02-12T00:00:00.000Z", ...overrides,
  };
}

describe("复杂葡萄酒工作簿引擎", () => {
  it("将四 Sheet 工作簿分配为盘点输入、逐笔进货和仅校验的汇总表", () => {
    const base64 = workbookBase64();
    const preview = parseWineWorkbook(base64, "2026-02");
    expect(preview?.month).toBe("2026-02");
    expect(preview?.sourceSheets).toEqual(["葡萄酒盘点", "进货总单", "进货汇总", "Summary"]);
    expect(preview?.sourceRows).toEqual({ inventory: 1, purchases: 1, purchaseSummary: 2, summary: 2 });
    expect(preview?.items).toHaveLength(1);
    expect(preview?.purchaseLines).toHaveLength(1);
    expect(preview?.supplierTotals).toEqual({ 甘澧: 330 });
    expect(preview?.totalPurchase).toBe(330);
    expect(preview?.fileFingerprint).toBe(createWineFileFingerprint(base64));
  });

  it("阻止重复文件和已存在的采购流水，但不把它们再次写入", () => {
    const preview = parseWineWorkbook(workbookBase64(), "2026-02")!;
    const current = purchase({ importFingerprint: preview.purchaseLines[0].fingerprint });
    const assessment = assessWineWorkbookImport(preview, [current], [{
      id: "batch-1", month: "2026-02", filename: "wine.xlsx", fileFingerprint: preview.fileFingerprint,
      sourceSchema: "wine_workbook_v1", status: "imported", importedAt: "2026-02-13T00:00:00.000Z", sourceSheets: preview.sourceSheets,
      parsedRows: preview.sourceRows, appliedRows: { inventory: 1, purchases: 1, skippedDuplicates: 0, conflicts: 0 },
    }]);
    expect(assessment.exactFileDuplicate?.id).toBe("batch-1");
    expect(assessment.existingDuplicateRowIndexes).toEqual([0]);
    expect(assessment.applicablePurchaseLines).toEqual([]);
  });

  it("以唯一采购流水重建库存派生字段，保留期初和期末盘点输入", () => {
    const preview = parseWineWorkbook(workbookBase64(), "2026-02")!;
    const snapshot = createWineWorkbookSnapshot("snapshot-1", preview, [purchase()]);
    const rebuilt = rebuildWineSnapshotFromPurchases(snapshot, [purchase()]);
    expect(rebuilt.items[0]).toMatchObject({
      initQty: 2,
      initUnitCost: 100,
      initCost: 200,
      purchaseQty: 3,
      purchaseCost: 330,
      endQty: 4,
      endCost: 440,
      consumeBottles: 1,
      consumeQty: 90,
    });
    expect(rebuilt.totalPurchase).toBe(330);
    expect(rebuilt.supplierTotals).toEqual({ 甘澧: 330 });
  });

  it("采购指纹会区分供应商、商品、数量、单价和金额", () => {
    const key = createWinePurchaseFingerprint("2026-02", purchase());
    expect(key).not.toBe(createWinePurchaseFingerprint("2026-02", purchase({ quantity: 4, amount: 440 })));
    expect(key).not.toBe(createWinePurchaseFingerprint("2026-02", purchase({ supplier: "另一供应商" })));
  });
});
