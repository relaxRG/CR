import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import * as XLSX from "xlsx";
import { sumMoney } from "@/lib/finance/money";
import type { WineAuditEntry, WineImportBatch, WineManualPurchase, WineMonthlySnapshot } from "./types";
import { wineMonthLabel } from "./workbook-engine";

export interface WineWorkbookExportData {
  month: string;
  snapshot: WineMonthlySnapshot | null;
  purchases: WineManualPurchase[];
  batches: WineImportBatch[];
  auditEntries: WineAuditEntry[];
}

export interface WineSupplierPurchaseSummary {
  supplier: string;
  monthQty: number;
  monthAmount: number;
  cumulativeQty: number;
  cumulativeAmount: number;
  productCount: number;
  lastPurchaseDate: string;
}

export interface WineProductPurchaseSummary {
  productName: string;
  supplier: string;
  monthQty: number;
  monthAmount: number;
  cumulativeQty: number;
  cumulativeAmount: number;
  latestUnitPrice: number;
  lastPurchaseDate: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function formatMoney(value: number): string {
  return sumMoney([value]).toFixed(2);
}

function exportFilename(month: string, suffix: string, extension: "xlsx" | "pdf") {
  return `${wineMonthLabel(month)}_葡萄酒${suffix}.${extension}`;
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: unknown[][], widths: number[] = []) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (widths.length > 0) sheet["!cols"] = widths.map((width) => ({ wch: width }));
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function monthPurchases(data: WineWorkbookExportData): WineManualPurchase[] {
  return data.purchases.filter((purchase) => purchase.date.startsWith(data.month));
}

function cumulativePurchases(data: WineWorkbookExportData): WineManualPurchase[] {
  const cutoff = `${data.month}-31`;
  return data.purchases.filter((purchase) => purchase.date <= cutoff);
}

export function summarizeWineSuppliers(data: WineWorkbookExportData): WineSupplierPurchaseSummary[] {
  const month = monthPurchases(data);
  const cumulative = cumulativePurchases(data);
  const suppliers = new Set([...month, ...cumulative].map((purchase) => purchase.supplier));
  return [...suppliers].map((supplier) => {
    const monthRows = month.filter((purchase) => purchase.supplier === supplier);
    const cumulativeRows = cumulative.filter((purchase) => purchase.supplier === supplier);
    return {
      supplier,
      monthQty: monthRows.reduce((total, purchase) => total + purchase.quantity, 0),
      monthAmount: sumMoney(monthRows.map((purchase) => purchase.amount)),
      cumulativeQty: cumulativeRows.reduce((total, purchase) => total + purchase.quantity, 0),
      cumulativeAmount: sumMoney(cumulativeRows.map((purchase) => purchase.amount)),
      productCount: new Set(cumulativeRows.map((purchase) => purchase.productName)).size,
      lastPurchaseDate: cumulativeRows.map((purchase) => purchase.date).sort().at(-1) ?? "",
    };
  }).sort((left, right) => right.monthAmount - left.monthAmount || right.cumulativeAmount - left.cumulativeAmount || left.supplier.localeCompare(right.supplier, "zh-CN"));
}

export function summarizeWineProducts(data: WineWorkbookExportData): WineProductPurchaseSummary[] {
  const month = monthPurchases(data);
  const cumulative = cumulativePurchases(data);
  const keys = new Set([...month, ...cumulative].map((purchase) => `${purchase.supplier}|${purchase.productName}`));
  return [...keys].map((key) => {
    const [supplier, productName] = key.split("|");
    const monthRows = month.filter((purchase) => purchase.supplier === supplier && purchase.productName === productName);
    const cumulativeRows = cumulative.filter((purchase) => purchase.supplier === supplier && purchase.productName === productName).sort((left, right) => left.date.localeCompare(right.date));
    const latest = cumulativeRows.at(-1);
    return {
      productName,
      supplier,
      monthQty: monthRows.reduce((total, purchase) => total + purchase.quantity, 0),
      monthAmount: sumMoney(monthRows.map((purchase) => purchase.amount)),
      cumulativeQty: cumulativeRows.reduce((total, purchase) => total + purchase.quantity, 0),
      cumulativeAmount: sumMoney(cumulativeRows.map((purchase) => purchase.amount)),
      latestUnitPrice: latest?.unitPrice ?? 0,
      lastPurchaseDate: latest?.date ?? "",
    };
  }).sort((left, right) => right.monthAmount - left.monthAmount || right.cumulativeAmount - left.cumulativeAmount || left.productName.localeCompare(right.productName, "zh-CN"));
}

export async function downloadWineWorkbookTemplate(month: string): Promise<void> {
  const workbook = XLSX.utils.book_new();
  appendSheet(workbook, "葡萄酒盘点", [["产品序号", "酒类", "盘点分类", "中文名", "期初单位成本", "期初库存量", "期初库存成本", "本月进货量（校验）", "本月进货成本（校验）", "期末库存量", "单位成本", "期末库存成本", "消耗瓶数", "本期消耗量"], ["填写说明：只填写期初、期末盘点和基础资料；进货字段由进货总单校验，不要重复入账。"]], [10, 14, 18, 28, 14, 14, 16, 16, 18, 14, 14, 16, 14, 16]);
  appendSheet(workbook, "进货总单", [[`葡萄酒当月进货 ${wineMonthLabel(month)}`], ["行号", "日期", "供应商", "商品名称", "单价", "数量", "应收增加"], [1, `${month}-01`, "示例供应商", "示例酒款（请替换）", 0, 0, 0]], [8, 14, 20, 30, 12, 12, 16]);
  appendSheet(workbook, "进货汇总", [["由 App 根据进货总单自动生成，请勿作为导入源。"]], [50]);
  appendSheet(workbook, "Summary", [["由 App 根据库存盘点与进货总单自动生成，请勿作为导入源。"]], [50]);
  const base64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
  const uri = `${FileSystem.cacheDirectory ?? "file://tmp/"}${exportFilename(month, "完整工作簿模板", "xlsx")}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", UTI: "com.microsoft.excel.xlsx", dialogTitle: `下载 ${wineMonthLabel(month)} 葡萄酒模板` });
}

export async function exportWineWorkbook(data: WineWorkbookExportData): Promise<void> {
  const workbook = XLSX.utils.book_new();
  const snapshot = data.snapshot;
  const monthly = monthPurchases(data);
  const suppliers = summarizeWineSuppliers(data);
  const products = summarizeWineProducts(data);
  const totalPurchase = sumMoney(monthly.map((purchase) => purchase.amount));
  const totalEndCost = snapshot?.totalEndCost ?? 0;

  appendSheet(workbook, "总结", [
    [`${wineMonthLabel(data.month)} 葡萄酒综合报表`], ["生成时间", new Date().toLocaleString("zh-CN")], ["导出结构版本", "wine_workbook_export_v1"], [],
    ["核心指标", "数值"], ["本月进货金额", formatMoney(totalPurchase)], ["本月进货笔数", monthly.length], ["期末库存成本", formatMoney(totalEndCost)], ["活跃供应商", suppliers.length], [],
    ["供应商", "本月数量", "本月金额", "累计数量", "累计金额", "酒款数", "最近进货"],
    ...suppliers.map((supplier) => [supplier.supplier, supplier.monthQty, formatMoney(supplier.monthAmount), supplier.cumulativeQty, formatMoney(supplier.cumulativeAmount), supplier.productCount, supplier.lastPurchaseDate]),
  ], [24, 18, 18, 18, 18, 14, 16]);

  appendSheet(workbook, "库存管理", [
    ["序号", "酒类", "供应商", "商品名称", "期初数量", "期初单价", "期初成本", "进货数量", "进货成本", "消耗瓶数", "消耗成本", "期末数量", "期末单价", "期末成本"],
    ...(snapshot?.items ?? []).map((item) => [item.seq, item.wineType, item.supplier, item.name, item.initQty, formatMoney(item.initUnitCost), formatMoney(item.initCost), item.purchaseQty, formatMoney(item.purchaseCost), item.consumeBottles, formatMoney(item.consumeQty), item.actualEndQty ?? item.endQty, formatMoney(item.unitCost), formatMoney(item.endCost)]),
  ], [8, 14, 18, 30, 12, 12, 14, 12, 14, 12, 14, 12, 12, 14]);

  appendSheet(workbook, "当月进货", [
    ["序号", "日期", "供应商", "商品名称", "数量", "单价", "总价", "来源", "导入批次", "原始行"],
    ...monthly.sort((left, right) => left.date.localeCompare(right.date)).map((purchase, index) => [index + 1, purchase.date, purchase.supplier, purchase.productName, purchase.quantity, formatMoney(purchase.unitPrice), formatMoney(purchase.amount), purchase.source === "workbook" ? "复杂工作簿" : "手动录入", purchase.importBatchId ?? "", purchase.sourceRow ?? ""]),
  ], [8, 14, 18, 30, 12, 12, 14, 14, 18, 10]);

  appendSheet(workbook, "供货商信息", [
    ["供应商", "本月进货数量", "本月进货金额", "累计进货数量", "累计进货金额", "关联酒款数", "最近进货日期"],
    ...suppliers.map((supplier) => [supplier.supplier, supplier.monthQty, formatMoney(supplier.monthAmount), supplier.cumulativeQty, formatMoney(supplier.cumulativeAmount), supplier.productCount, supplier.lastPurchaseDate]),
  ], [20, 16, 16, 18, 18, 14, 16]);

  appendSheet(workbook, "酒款累计进货", [
    ["商品名称", "供应商", "本月数量", "本月金额", "累计数量", "累计金额", "最近单价", "最近进货日期"],
    ...products.map((product) => [product.productName, product.supplier, product.monthQty, formatMoney(product.monthAmount), product.cumulativeQty, formatMoney(product.cumulativeAmount), formatMoney(product.latestUnitPrice), product.lastPurchaseDate]),
  ], [30, 18, 14, 14, 16, 16, 14, 16]);

  appendSheet(workbook, "导入与重建审计", [
    ["类型", "时间", "月份", "详情", "影响库存快照", "影响采购笔数", "影响批次"],
    ...data.auditEntries.filter((entry) => entry.month === data.month).map((entry) => [entry.action, entry.occurredAt, entry.month, entry.detail, entry.affected.snapshots, entry.affected.purchases, entry.affected.batches]),
    [], ["导入批次", "导入时间", "文件", "状态", "库存行", "进货行", "跳过重复", "冲突"],
    ...data.batches.filter((batch) => batch.month === data.month).map((batch) => [batch.id, batch.importedAt, batch.filename, batch.status, batch.appliedRows.inventory, batch.appliedRows.purchases, batch.appliedRows.skippedDuplicates, batch.appliedRows.conflicts]),
  ], [22, 20, 18, 54, 14, 14, 14, 14]);

  const base64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });
  const uri = `${FileSystem.cacheDirectory ?? "file://tmp/"}${exportFilename(data.month, "综合报表", "xlsx")}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", UTI: "com.microsoft.excel.xlsx", dialogTitle: `导出 ${wineMonthLabel(data.month)} 葡萄酒综合报表` });
}

export async function exportWinePdf(data: WineWorkbookExportData): Promise<void> {
  const snapshot = data.snapshot;
  const monthly = monthPurchases(data);
  const suppliers = summarizeWineSuppliers(data);
  const products = summarizeWineProducts(data);
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#202124;padding:22px;font-size:11px}h1{font-size:20px;margin:0 0 6px}h2{font-size:14px;margin:22px 0 8px;color:#1f5faa}table{width:100%;border-collapse:collapse;margin-bottom:14px}th{background:#1f5faa;color:#fff;padding:6px;text-align:left}td{padding:5px;border-bottom:1px solid #e7e9ec}tr:nth-child(even) td{background:#f7f8fa}.kpi{display:inline-block;min-width:150px;background:#f7f8fa;padding:10px;margin:0 8px 8px 0}.value{font-size:16px;font-weight:800}.muted{color:#687076}.page{page-break-before:always}
  </style></head><body><h1>${escapeHtml(wineMonthLabel(data.month))} 葡萄酒综合报表</h1><p class="muted">生成时间：${escapeHtml(new Date().toLocaleString("zh-CN"))}</p>
  <div class="kpi"><div class="value">¥${formatMoney(sumMoney(monthly.map((purchase) => purchase.amount)))}</div><div class="muted">本月进货金额</div></div><div class="kpi"><div class="value">${monthly.length} 笔</div><div class="muted">本月进货笔数</div></div><div class="kpi"><div class="value">¥${formatMoney(snapshot?.totalEndCost ?? 0)}</div><div class="muted">期末库存成本</div></div>
  <h2>供应商月度与累计进货</h2><table><tr><th>供应商</th><th>本月数量</th><th>本月金额</th><th>累计数量</th><th>累计金额</th></tr>${suppliers.map((supplier) => `<tr><td>${escapeHtml(supplier.supplier)}</td><td>${supplier.monthQty}</td><td>¥${formatMoney(supplier.monthAmount)}</td><td>${supplier.cumulativeQty}</td><td>¥${formatMoney(supplier.cumulativeAmount)}</td></tr>`).join("")}</table>
  <div class="page"></div><h2>库存管理</h2><table><tr><th>商品</th><th>供应商</th><th>期初</th><th>进货</th><th>消耗</th><th>期末</th><th>期末成本</th></tr>${(snapshot?.items ?? []).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.supplier)}</td><td>${item.initQty}</td><td>${item.purchaseQty}</td><td>${item.consumeBottles}</td><td>${item.actualEndQty ?? item.endQty}</td><td>¥${formatMoney(item.endCost)}</td></tr>`).join("")}</table>
  <div class="page"></div><h2>当月进货</h2><table><tr><th>日期</th><th>供应商</th><th>商品</th><th>数量</th><th>单价</th><th>金额</th></tr>${monthly.map((purchase) => `<tr><td>${escapeHtml(purchase.date)}</td><td>${escapeHtml(purchase.supplier)}</td><td>${escapeHtml(purchase.productName)}</td><td>${purchase.quantity}</td><td>¥${formatMoney(purchase.unitPrice)}</td><td>¥${formatMoney(purchase.amount)}</td></tr>`).join("")}</table>
  <div class="page"></div><h2>酒款累计进货</h2><table><tr><th>商品</th><th>供应商</th><th>本月数量</th><th>累计数量</th><th>累计金额</th></tr>${products.map((product) => `<tr><td>${escapeHtml(product.productName)}</td><td>${escapeHtml(product.supplier)}</td><td>${product.monthQty}</td><td>${product.cumulativeQty}</td><td>¥${formatMoney(product.cumulativeAmount)}</td></tr>`).join("")}</table></body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: `导出 ${wineMonthLabel(data.month)} 葡萄酒综合报表 PDF` });
}
