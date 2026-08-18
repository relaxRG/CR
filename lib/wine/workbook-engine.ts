import { utils, read as xlsxRead } from "xlsx";
import { normalizeImportDate } from "@/lib/import/date-utils";
import { dominantPurchaseMonth } from "@/lib/spirits/import-bridge";
import { multiplyMoney, roundMoney, sumMoney } from "@/lib/finance/money";
import type {
  WineImportBatch,
  WineInventoryItem,
  WineManualPurchase,
  WineMonthlySnapshot,
  WinePurchaseOrderItem,
} from "./types";

export interface WineWorkbookPurchaseLine extends Omit<WinePurchaseOrderItem, "amount"> {
  amount: number;
  sourceSheet: string;
  sourceRow: number;
  fingerprint: string;
}

export interface WineWorkbookImportPreview {
  month: string;
  monthLabel: string;
  sourceSheets: string[];
  sourceRows: { inventory: number; purchases: number; summary: number; purchaseSummary: number };
  items: WineInventoryItem[];
  purchaseLines: WineWorkbookPurchaseLine[];
  fileFingerprint: string;
  duplicateRowIndexes: number[];
  existingDuplicateRowIndexes: number[];
  conflicts: string[];
  warnings: string[];
  supplierTotals: Record<string, number>;
  totalPurchase: number;
  totalConsume: number;
  totalEndCost: number;
}

export interface WineWorkbookImportAssessment {
  exactFileDuplicate: WineImportBatch | null;
  duplicateRowIndexes: number[];
  existingDuplicateRowIndexes: number[];
  conflicts: string[];
  applicablePurchaseLines: WineWorkbookPurchaseLine[];
}

function countPopulatedRows(rows: unknown[][]): number {
  return rows.filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")).length;
}

export function normalizeWineMonth(value: string | null | undefined): string | null {
  const matched = String(value ?? "").trim().match(/^(\d{4})[/-](\d{1,2})$/);
  if (!matched) return null;
  const month = Number(matched[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${matched[1]}-${String(month).padStart(2, "0")}`;
}

export function wineMonthLabel(month: string): string {
  const normalized = normalizeWineMonth(month);
  if (!normalized) return month;
  const [year, numericMonth] = normalized.split("-");
  return `${year}年${Number(numericMonth)}月`;
}

export function normalizeWineIdentity(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/[\s\-_./()（）]+/g, "");
}

/**
 * 不依赖平台加密 API 的稳定工作簿摘要。它用于本机幂等与误重复拦截，
 * 并与月份共同作为导入批次的唯一标识，不承担安全签名职责。
 */
export function createWineFileFingerprint(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${content.length}`;
}

export function createWinePurchaseFingerprint(month: string, purchase: Pick<WinePurchaseOrderItem, "date" | "supplier" | "productName" | "unitPrice" | "quantity" | "amount">): string {
  return [
    month,
    purchase.date,
    normalizeWineIdentity(purchase.supplier),
    normalizeWineIdentity(purchase.productName),
    roundMoney(purchase.quantity),
    roundMoney(purchase.unitPrice),
    roundMoney(purchase.amount),
  ].join("|");
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().replace(/[\s\-_./()（）]+/g, "").toLocaleLowerCase("zh-CN");
}

function findHeaderRow(rows: unknown[][], required: string[]): number {
  return rows.findIndex((row) => {
    const cells = row.map(normalizeHeader);
    return required.every((field) => cells.some((cell) => cell.includes(normalizeHeader(field))));
  });
}

function findColumn(headers: unknown[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  // 先精确匹配，防止“单位成本”被同表更靠前的“期初单位成本”抢占。
  for (const alias of aliases) {
    const index = normalized.findIndex((header) => header === normalizeHeader(alias));
    if (index >= 0) return index;
  }
  for (const alias of aliases) {
    const index = normalized.findIndex((header) => header.includes(normalizeHeader(alias)));
    if (index >= 0) return index;
  }
  return -1;
}

function at(row: unknown[], column: number): unknown {
  return column >= 0 ? row[column] : null;
}

function readInventoryRows(rows: unknown[][]): WineInventoryItem[] {
  const headerRow = rows.findIndex((row) => {
    const cells = row.map(normalizeHeader);
    const has = (aliases: string[]) => aliases.some((alias) => cells.some((cell) => cell.includes(normalizeHeader(alias))));
    return has(["中文名", "商品名称", "名称"]) && has(["期初库存量", "期初数量"]) && has(["期末库存量", "期末数量"]);
  });
  if (headerRow < 0) return [];
  const headers = rows[headerRow] as unknown[];
  const column = {
    seq: findColumn(headers, ["产品序号", "序号"]),
    wineType: findColumn(headers, ["酒类", "酒款分类"]),
    supplier: findColumn(headers, ["盘点分类", "供应商"]),
    name: findColumn(headers, ["中文名", "商品名称"]),
    initUnitCost: findColumn(headers, ["期初单位成本", "期初单价"]),
    initQty: findColumn(headers, ["期初库存量", "期初数量"]),
    initCost: findColumn(headers, ["期初库存成本", "期初成本"]),
    purchaseQty: findColumn(headers, ["本月进货量", "进货数量"]),
    purchaseCost: findColumn(headers, ["本月进货成本", "进货成本"]),
    endQty: findColumn(headers, ["期末库存量", "期末数量"]),
    unitCost: findColumn(headers, ["单位成本", "期末单位成本", "期末单价"]),
    endCost: findColumn(headers, ["期末库存成本", "期末成本"]),
    consumeBottles: findColumn(headers, ["消耗瓶数"]),
    consumeQty: findColumn(headers, ["本期消耗量", "消耗成本"]),
  };
  const items: WineInventoryItem[] = [];
  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index] as unknown[];
    const name = at(row, column.name);
    if (!name || typeof name !== "string" || !name.trim()) continue;
    items.push({
      seq: Number(at(row, column.seq)) || index - headerRow,
      wineType: String(at(row, column.wineType) ?? "").trim(),
      supplier: String(at(row, column.supplier) ?? "").trim(),
      name: String(name).trim(),
      initUnitCost: Number(at(row, column.initUnitCost)) || 0,
      initQty: Number(at(row, column.initQty)) || 0,
      initCost: Number(at(row, column.initCost)) || 0,
      purchaseQty: Number(at(row, column.purchaseQty)) || 0,
      purchaseCost: Number(at(row, column.purchaseCost)) || 0,
      endQty: Number(at(row, column.endQty)) || 0,
      unitCost: Number(at(row, column.unitCost)) || 0,
      endCost: Number(at(row, column.endCost)) || 0,
      consumeBottles: Number(at(row, column.consumeBottles)) || 0,
      consumeQty: Number(at(row, column.consumeQty)) || 0,
    });
  }
  return items;
}

function readPurchaseRows(rows: unknown[][]): Omit<WineWorkbookPurchaseLine, "fingerprint">[] {
  const headerRow = findHeaderRow(rows, ["日期", "供应商", "商品名称"]);
  if (headerRow < 0) return [];
  const headers = rows[headerRow] as unknown[];
  const column = {
    date: findColumn(headers, ["日期"]),
    supplier: findColumn(headers, ["供应商"]),
    productName: findColumn(headers, ["商品名称", "中文名"]),
    unitPrice: findColumn(headers, ["单价", "参考单价price"]),
    quantity: findColumn(headers, ["数量", "采购purchasen"]),
    amount: findColumn(headers, ["应收增加", "总价", "金额", "采购purchaseta"]),
  };
  const purchases: Omit<WineWorkbookPurchaseLine, "fingerprint">[] = [];
  let lastValidDate = "";
  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index] as unknown[];
    const dateValue = at(row, column.date);
    const supplier = at(row, column.supplier);
    const productName = at(row, column.productName);
    if (!supplier || !productName) continue;
    const parsedDate = normalizeImportDate(dateValue);
    const hasDateValue = dateValue !== null && dateValue !== undefined && String(dateValue).trim() !== "";
    if (hasDateValue && !parsedDate) continue;
    const date = parsedDate ?? lastValidDate;
    if (!date) continue;
    if (parsedDate) lastValidDate = parsedDate;
    const unitPrice = Number(at(row, column.unitPrice)) || 0;
    const quantity = Number(at(row, column.quantity)) || 0;
    const declaredAmount = Number(at(row, column.amount));
    const amount = Number.isFinite(declaredAmount) && declaredAmount > 0
      ? roundMoney(declaredAmount)
      : multiplyMoney(quantity, unitPrice);
    purchases.push({
      date,
      supplier: String(supplier).trim(),
      productName: String(productName).trim(),
      unitPrice,
      quantity,
      amount,
      sourceSheet: "进货总单",
      sourceRow: index + 1,
    });
  }
  return purchases;
}

/** 解析用户现有的四 Sheet 葡萄酒工作簿；汇总表只用于完整性校验，绝不二次入账。 */
export function parseWineWorkbook(base64: string, fallbackMonth: string): WineWorkbookImportPreview | null {
  try {
    const workbook = xlsxRead(base64, { type: "base64", cellDates: true });
    const inventorySheet = workbook.Sheets["葡萄酒盘点"];
    const purchaseSheet = workbook.Sheets["进货总单"];
    if (!inventorySheet && !purchaseSheet) return null;

    const inventoryRows = inventorySheet ? utils.sheet_to_json<unknown[]>(inventorySheet, { header: 1, defval: null }) : [];
    const purchaseRows = purchaseSheet ? utils.sheet_to_json<unknown[]>(purchaseSheet, { header: 1, defval: null }) : [];
    const items = readInventoryRows(inventoryRows);
    const rawPurchases = readPurchaseRows(purchaseRows);
    const fallback = normalizeWineMonth(fallbackMonth) ?? fallbackMonth;
    const month = dominantPurchaseMonth(rawPurchases, fallback);
    const purchaseLines = rawPurchases.map((purchase) => ({
      ...purchase,
      fingerprint: createWinePurchaseFingerprint(month, purchase),
    }));
    const seen = new Set<string>();
    const duplicateRowIndexes: number[] = [];
    purchaseLines.forEach((purchase, index) => {
      if (seen.has(purchase.fingerprint)) duplicateRowIndexes.push(index);
      seen.add(purchase.fingerprint);
    });
    const summarySheet = workbook.Sheets.Summary;
    const purchaseSummarySheet = workbook.Sheets["进货汇总"];
    const sourceSheets = [
      inventorySheet ? "葡萄酒盘点" : null,
      purchaseSheet ? "进货总单" : null,
      purchaseSummarySheet ? "进货汇总" : null,
      summarySheet ? "Summary" : null,
    ].filter((value): value is string => Boolean(value));
    const supplierTotals: Record<string, number> = {};
    purchaseLines.forEach((purchase) => {
      supplierTotals[purchase.supplier] = sumMoney([supplierTotals[purchase.supplier], purchase.amount]);
    });
    const warnings: string[] = [];
    if (!inventorySheet) warnings.push("未识别“葡萄酒盘点”工作表；本次仅导入逐笔进货，不会覆盖库存盘点。");
    if (!purchaseSheet) warnings.push("未识别“进货总单”工作表；本次仅导入库存盘点，进货字段将等待重新计算。");
    if (!summarySheet || !purchaseSummarySheet) warnings.push("未发现完整汇总表；App 将根据库存与逐笔进货重新生成总结。\n");
    return {
      month,
      monthLabel: wineMonthLabel(month),
      sourceSheets,
      sourceRows: {
        inventory: items.length,
        purchases: purchaseLines.length,
        summary: summarySheet ? countPopulatedRows(utils.sheet_to_json<unknown[]>(summarySheet, { header: 1, defval: null })) : 0,
        purchaseSummary: purchaseSummarySheet ? countPopulatedRows(utils.sheet_to_json<unknown[]>(purchaseSummarySheet, { header: 1, defval: null })) : 0,
      },
      items,
      purchaseLines,
      fileFingerprint: createWineFileFingerprint(base64),
      duplicateRowIndexes,
      existingDuplicateRowIndexes: [],
      conflicts: [],
      warnings,
      supplierTotals,
      totalPurchase: sumMoney(purchaseLines.map((purchase) => purchase.amount)),
      totalConsume: sumMoney(items.map((item) => item.consumeQty)),
      totalEndCost: sumMoney(items.map((item) => item.endCost)),
    };
  } catch {
    return null;
  }
}

export function assessWineWorkbookImport(
  preview: WineWorkbookImportPreview,
  purchases: WineManualPurchase[],
  batches: WineImportBatch[],
): WineWorkbookImportAssessment {
  const exactFileDuplicate = batches.find((batch) => batch.month === preview.month && batch.fileFingerprint === preview.fileFingerprint && batch.status === "imported") ?? null;
  const existingFingerprints = new Set(
    purchases
      .filter((purchase) => purchase.date.startsWith(preview.month))
      .map((purchase) => purchase.importFingerprint ?? createWinePurchaseFingerprint(preview.month, purchase)),
  );
  const existingDuplicateRowIndexes = preview.purchaseLines
    .map((purchase, index) => existingFingerprints.has(purchase.fingerprint) ? index : -1)
    .filter((index) => index >= 0);
  const duplicateIndexes = new Set([...preview.duplicateRowIndexes, ...existingDuplicateRowIndexes]);
  const conflicts = preview.purchaseLines
    .filter((purchase) => !duplicateIndexes.has(preview.purchaseLines.indexOf(purchase)))
    .filter((purchase) => purchases.some((current) =>
      current.date === purchase.date
      && normalizeWineIdentity(current.supplier) === normalizeWineIdentity(purchase.supplier)
      && normalizeWineIdentity(current.productName) === normalizeWineIdentity(purchase.productName)
      && (roundMoney(current.unitPrice) !== roundMoney(purchase.unitPrice) || roundMoney(current.quantity) !== roundMoney(purchase.quantity)),
    ))
    .map((purchase) => `${purchase.sourceSheet} 第${purchase.sourceRow}行：${purchase.supplier}／${purchase.productName}`);
  return {
    exactFileDuplicate,
    duplicateRowIndexes: preview.duplicateRowIndexes,
    existingDuplicateRowIndexes,
    conflicts,
    applicablePurchaseLines: preview.purchaseLines.filter((_, index) => !duplicateIndexes.has(index)),
  };
}

/** 从唯一采购流水重建本月库存派生字段；真实期初／期末盘点输入保持不变。 */
export function rebuildWineSnapshotFromPurchases(snapshot: WineMonthlySnapshot, purchases: WineManualPurchase[]): WineMonthlySnapshot {
  const month = normalizeWineMonth(snapshot.monthLabel.replace("年", "-").replace("月", "")) ?? snapshot.monthLabel;
  const monthPurchases = purchases.filter((purchase) => purchase.date.startsWith(month));
  const byIdentity = new Map<string, WineManualPurchase[]>();
  monthPurchases.forEach((purchase) => {
    const key = `${normalizeWineIdentity(purchase.supplier)}|${normalizeWineIdentity(purchase.productName)}`;
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), purchase]);
  });
  const items = snapshot.items.map((item) => {
    const key = `${normalizeWineIdentity(item.supplier)}|${normalizeWineIdentity(item.name)}`;
    const matching = byIdentity.get(key) ?? [];
    const purchaseQty = roundMoney(matching.reduce((total, purchase) => total + purchase.quantity, 0));
    const purchaseCost = sumMoney(matching.map((purchase) => purchase.amount));
    const initCost = multiplyMoney(item.initQty, item.initUnitCost);
    const endQty = item.actualEndQty ?? item.endQty;
    const endCost = multiplyMoney(endQty, item.unitCost);
    const consumeBottles = Math.max(0, roundMoney(item.initQty + purchaseQty - endQty));
    const consumeQty = Math.max(0, roundMoney(initCost + purchaseCost - endCost));
    return { ...item, initCost, purchaseQty, purchaseCost, endQty, endCost, consumeBottles, consumeQty };
  });
  const supplierTotals: Record<string, number> = {};
  monthPurchases.forEach((purchase) => {
    supplierTotals[purchase.supplier] = sumMoney([supplierTotals[purchase.supplier], purchase.amount]);
  });
  const purchaseOrders: WinePurchaseOrderItem[] = monthPurchases.map((purchase) => ({
    date: purchase.date,
    supplier: purchase.supplier,
    productName: purchase.productName,
    unitPrice: purchase.unitPrice,
    quantity: purchase.quantity,
    amount: purchase.amount,
  }));
  return {
    ...snapshot,
    items,
    purchaseOrders,
    supplierTotals,
    totalPurchase: sumMoney(monthPurchases.map((purchase) => purchase.amount)),
    totalConsume: sumMoney(items.map((item) => item.consumeQty)),
    totalEndCost: sumMoney(items.map((item) => item.endCost)),
  };
}

export function createWineWorkbookSnapshot(id: string, preview: WineWorkbookImportPreview, purchases: WineManualPurchase[]): WineMonthlySnapshot {
  const base: WineMonthlySnapshot = {
    id,
    monthLabel: preview.monthLabel,
    importedAt: new Date().toISOString(),
    items: preview.items,
    purchaseOrders: [],
    supplierTotals: {},
    totalPurchase: 0,
    totalConsume: 0,
    totalEndCost: 0,
  };
  return rebuildWineSnapshotFromPurchases(base, purchases);
}

export function createWineImportBatch(input: Omit<WineImportBatch, "id" | "importedAt" | "sourceSchema"> & { id: string; importedAt?: string }): WineImportBatch {
  return {
    ...input,
    sourceSchema: "wine_workbook_v1",
    importedAt: input.importedAt ?? new Date().toISOString(),
  };
}
