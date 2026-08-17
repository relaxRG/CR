import { read as xlsxRead, utils } from "xlsx";
import type { MeituanDishCategoryRow, MeituanMonthlyRevenueRow } from "./monthly-import";

export interface MeituanWorkbookParseResult<T> {
  rows: T[];
  sheetName: string;
  headerRowIndex: number;
  warnings: string[];
}

type Row = unknown[];

const HEADER_ALIASES = {
  storeId: ["门店id", "门店编码", "apppoicode", "门店编号", "poi id"],
  storeName: ["门店名称", "门店"],
  month: ["营业月份", "月份", "账期", "统计月份", "营业日期"],
  revenue: ["营业收入", "菜品收入", "实收金额", "实收"],
  turnover: ["营业额", "销售额", "折前营业额"],
  discountAmount: ["优惠金额", "优惠", "折扣金额"],
  orderCount: ["订单量", "订单数", "结账单数"],
  categoryName: ["菜品大类", "品类", "菜品分类", "大类名称"],
  salesQty: ["销售数量", "销量", "销售份数"],
  salesAmount: ["销售额", "折前金额"],
} as const;

function text(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function headerKey(value: unknown): string {
  return text(value).toLocaleLowerCase("en-US").replace(/[（）()【】\[\]：:]/g, "");
}

function findAliasIndex(headers: Row, aliases: readonly string[]): number {
  const normalizedAliases = aliases.map(headerKey);
  return headers.findIndex((header) => normalizedAliases.includes(headerKey(header)));
}

function findHeaderRow(rows: Row, required: readonly (readonly string[])[]): { index: number; indexes: number[] } | null {
  for (let index = 0; index < Math.min(rows.length, 30); index += 1) {
    const candidate = rows[index];
    const row: Row = Array.isArray(candidate) ? candidate : [];
    const indexes = required.map((aliases) => findAliasIndex(row, aliases));
    if (indexes.every((value) => value >= 0)) return { index, indexes };
  }
  return null;
}

function selectSheet(base64: string, required: readonly (readonly string[])[], preferredSheetName?: string): { sheetName: string; rows: Row[]; header: { index: number; indexes: number[] } } {
  const workbook = xlsxRead(base64, { type: "base64" });
  const candidates = preferredSheetName
    ? [preferredSheetName, ...workbook.SheetNames.filter((name) => name !== preferredSheetName)]
    : workbook.SheetNames;
  for (const sheetName of candidates) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = utils.sheet_to_json<Row>(sheet, { header: 1, defval: "" });
    const header = findHeaderRow(rows, required);
    if (header) return { sheetName, rows, header };
  }
  throw new Error("未找到美团管家可识别的表头；请上传包含门店、月份和目标指标的原始导出文件");
}

function value(row: Row, index: number): string | number {
  const raw = row[index];
  return typeof raw === "number" ? raw : text(raw);
}

/**
 * 解析美团管家智能版的按门店、按月营业收入表。
 * 目标门店 ID 必须存在于原文件，禁止只用门店名称推断归属。
 */
export function parseMeituanMonthlyRevenueWorkbook(base64: string, preferredSheetName?: string): MeituanWorkbookParseResult<MeituanMonthlyRevenueRow> {
  const required = [HEADER_ALIASES.storeId, HEADER_ALIASES.month, HEADER_ALIASES.revenue] as const;
  const selected = selectSheet(base64, required, preferredSheetName);
  const header = selected.rows[selected.header.index];
  const storeIdIndex = findAliasIndex(header, HEADER_ALIASES.storeId);
  const monthIndex = findAliasIndex(header, HEADER_ALIASES.month);
  const revenueIndex = findAliasIndex(header, HEADER_ALIASES.revenue);
  const turnoverIndex = findAliasIndex(header, HEADER_ALIASES.turnover);
  const discountIndex = findAliasIndex(header, HEADER_ALIASES.discountAmount);
  const orderCountIndex = findAliasIndex(header, HEADER_ALIASES.orderCount);
  const rows: MeituanMonthlyRevenueRow[] = [];
  const warnings: string[] = [];

  selected.rows.slice(selected.header.index + 1).forEach((row, offset) => {
    const storeId = text(value(row, storeIdIndex));
    const month = text(value(row, monthIndex));
    const revenue = value(row, revenueIndex);
    if (!storeId && !month && !text(revenue)) return;
    if (!storeId || !month) {
      warnings.push(`第 ${selected.header.index + offset + 2} 行缺少门店 ID 或月份，已跳过`);
      return;
    }
    rows.push({
      storeId,
      month,
      revenue,
      turnover: turnoverIndex >= 0 ? value(row, turnoverIndex) : undefined,
      discountAmount: discountIndex >= 0 ? value(row, discountIndex) : undefined,
      orderCount: orderCountIndex >= 0 ? value(row, orderCountIndex) : undefined,
    });
  });
  return { rows, sheetName: selected.sheetName, headerRowIndex: selected.header.index, warnings };
}

/** 解析美团管家智能版“菜品销售统计—大类”表。 */
export function parseMeituanDishCategoriesWorkbook(base64: string, preferredSheetName?: string): MeituanWorkbookParseResult<MeituanDishCategoryRow> {
  const required = [HEADER_ALIASES.storeId, HEADER_ALIASES.month, HEADER_ALIASES.categoryName, HEADER_ALIASES.revenue] as const;
  const selected = selectSheet(base64, required, preferredSheetName);
  const header = selected.rows[selected.header.index];
  const storeIdIndex = findAliasIndex(header, HEADER_ALIASES.storeId);
  const monthIndex = findAliasIndex(header, HEADER_ALIASES.month);
  const categoryIndex = findAliasIndex(header, HEADER_ALIASES.categoryName);
  const revenueIndex = findAliasIndex(header, HEADER_ALIASES.revenue);
  const salesQtyIndex = findAliasIndex(header, HEADER_ALIASES.salesQty);
  const salesAmountIndex = findAliasIndex(header, HEADER_ALIASES.salesAmount);
  const discountIndex = findAliasIndex(header, HEADER_ALIASES.discountAmount);
  const rows: MeituanDishCategoryRow[] = [];
  const warnings: string[] = [];

  selected.rows.slice(selected.header.index + 1).forEach((row, offset) => {
    const storeId = text(value(row, storeIdIndex));
    const month = text(value(row, monthIndex));
    const categoryName = text(value(row, categoryIndex));
    const revenue = value(row, revenueIndex);
    if (!storeId && !month && !categoryName && !text(revenue)) return;
    if (!storeId || !month || !categoryName) {
      warnings.push(`第 ${selected.header.index + offset + 2} 行缺少门店 ID、月份或菜品大类，已跳过`);
      return;
    }
    rows.push({
      storeId,
      month,
      categoryName,
      revenue,
      salesQty: salesQtyIndex >= 0 ? value(row, salesQtyIndex) : undefined,
      salesAmount: salesAmountIndex >= 0 ? value(row, salesAmountIndex) : undefined,
      discountAmount: discountIndex >= 0 ? value(row, discountIndex) : undefined,
      sourceRow: selected.header.index + offset + 2,
    });
  });
  return { rows, sheetName: selected.sheetName, headerRowIndex: selected.header.index, warnings };
}
