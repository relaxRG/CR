/**
 * 烈酒库存管理 — 导出引擎 v1
 *
 * 支持两种格式：
 * 1. Excel (.xlsx) — 多 Sheet 工作簿，使用 xlsx 库生成，expo-file-system 写入，expo-sharing 分享
 * 2. PDF           — HTML 模板 → expo-print.printToFileAsync → expo-sharing 分享
 *
 * 导出内容（4个章节）：
 * Sheet1 / 章节1: 月度总结（核心指标 + 分类汇总）
 * Sheet2 / 章节2: 库存台账（每款酒期初/进货/消耗/期末）
 * Sheet3 / 章节3: 进货流水（本月所有进货记录）
 * Sheet4 / 章节4: 供应商汇总
 */

import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { SpiritItem, SpiritPurchaseRecord, SpiritLedgerEntry } from "./types";

// ─── 类型定义 ─────────────────────────────────────────────────────────────────
export interface ExportData {
  month: string;                          // YYYY-MM
  items: SpiritItem[];
  purchases: SpiritPurchaseRecord[];
  ledger: SpiritLedgerEntry[];
  getRefPrice: (itemId: string, month: string) => number;
  categorySummary: Record<string, { openingQty: number; purchaseQty: number; consumeQty: number; closingQty: number }>;
  supplierSummary: Record<string, { qty: number; amount: number; items: number }>;
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────
function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${y}年${Number(m)}月`;
}

function fmt(n: number, decimals = 0) {
  return n.toFixed(decimals);
}

function now() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Excel 导出 ───────────────────────────────────────────────────────────────
export async function exportToExcel(data: ExportData): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require("xlsx") as typeof import("xlsx");
  const { month, items, purchases, ledger, getRefPrice, categorySummary, supplierSummary } = data;
  const monthPurchases = purchases.filter((p) => p.month === month);
  const monthLedger = ledger.filter((e) => e.month === month);

  const wb = XLSX.utils.book_new();

  // ── Sheet 1: 月度总结 ────────────────────────────────────────────────────────
  const totalPurchaseAmt = monthPurchases.reduce((s, p) => s + p.amount, 0);
  const totalClosingCost = monthLedger.reduce((s, e) => s + e.closingCost, 0);
  const totalConsumeQty = monthLedger.reduce((s, e) => s + e.consumeQty, 0);
  const supplierCount = new Set(monthPurchases.map((p) => p.supplier ?? "未知")).size;

  const summaryData: any[][] = [
    [`${monthLabel(month)} 烈酒库存管理月度报告`],
    [`生成时间: ${new Date().toLocaleString("zh-CN")}`],
    [],
    ["一、核心指标"],
    ["指标", "数值"],
    ["本月进货总额", `¥${fmt(totalPurchaseAmt)}`],
    ["本月进货笔数", `${monthPurchases.length} 笔`],
    ["本月消耗总量", `${fmt(totalConsumeQty, 1)} 瓶`],
    ["期末库存成本", `¥${fmt(totalClosingCost)}`],
    ["活跃供应商数", `${supplierCount} 家`],
    [],
    ["二、分类汇总"],
    ["分类", "期初库存(瓶)", "本月进货(瓶)", "本月消耗(瓶)", "期末库存(瓶)"],
    ...Object.entries(categorySummary).map(([cat, v]) => [
      cat, v.openingQty, v.purchaseQty, v.consumeQty, v.closingQty,
    ]),
    [],
    ["三、供应商汇总"],
    ["供应商", "进货量(瓶)", "进货金额(¥)", "品种数"],
    ...Object.entries(supplierSummary).map(([sup, v]) => [
      sup, v.qty, fmt(v.amount), v.items,
    ]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
  ws1["!cols"] = [{ wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws1, "月度总结");

  // ── Sheet 2: 库存台账 ────────────────────────────────────────────────────────
  const ledgerHeader = [
    "序号", "中文名", "英文名", "分类", "单位",
    "期初库存(瓶)", "期初单价(¥)", "期初成本(¥)",
    "本月进货(瓶)", "本月进货成本(¥)",
    "本月消耗(瓶)",
    "期末库存(瓶)", "期末单价(¥)", "期末成本(¥)",
    "参考单价(¥)", "供应商",
  ];
  const ledgerRows = monthLedger.map((e, idx) => {
    const item = items.find((i) => i.id === e.itemId);
    const refPrice = getRefPrice(e.itemId, month);
    return [
      idx + 1,
      item?.name ?? "-",
      item?.nameEn ?? "",
      item?.category ?? "-",
      item?.unit ?? "瓶",
      e.openingQty,
      fmt(e.openingUnitCost, 2),
      fmt(e.openingQty * e.openingUnitCost),
      e.purchaseQty,
      fmt(e.purchaseCost),
      e.consumeQty,
      e.closingQty,
      fmt(e.closingUnitCost, 2),
      fmt(e.closingCost),
      refPrice > 0 ? fmt(refPrice, 2) : "",
      item?.supplier ?? "",
    ];
  });
  // 合计行
  const ledgerTotal = [
    "合计", "", "", "", "",
    monthLedger.reduce((s, e) => s + e.openingQty, 0),
    "", fmt(monthLedger.reduce((s, e) => s + e.openingQty * e.openingUnitCost, 0)),
    monthLedger.reduce((s, e) => s + e.purchaseQty, 0),
    fmt(monthLedger.reduce((s, e) => s + e.purchaseCost, 0)),
    monthLedger.reduce((s, e) => s + e.consumeQty, 0),
    monthLedger.reduce((s, e) => s + e.closingQty, 0),
    "", fmt(monthLedger.reduce((s, e) => s + e.closingCost, 0)),
    "", "",
  ];
  const ws2 = XLSX.utils.aoa_to_sheet([ledgerHeader, ...ledgerRows, ledgerTotal]);
  ws2["!cols"] = [
    { wch: 6 }, { wch: 20 }, { wch: 25 }, { wch: 12 }, { wch: 6 },
    { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 14 },
    { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, "库存台账");

  // ── Sheet 3: 进货流水 ────────────────────────────────────────────────────────
  const purchaseHeader = [
    "序号", "日期", "商品名称", "英文名", "分类", "规格", "数量(瓶)", "单价(¥)", "金额(¥)", "供应商", "来源",
  ];
  const purchaseRows = monthPurchases
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p, idx) => {
      const item = items.find((i) => i.id === p.itemId);
      return [
        idx + 1,
        p.date,
        p.rawName,
        item?.nameEn ?? "",
        item?.category ?? "",
        p.unit,
        p.quantity,
        fmt(p.unitPrice, 2),
        fmt(p.amount),
        p.supplier ?? "",
        p.source === "excel" ? "Excel导入" : p.source === "pdf" ? "PDF导入" : "手动录入",
      ];
    });
  const purchaseTotal = [
    "合计", "", "", "", "", "",
    monthPurchases.reduce((s, p) => s + p.quantity, 0),
    "",
    fmt(monthPurchases.reduce((s, p) => s + p.amount, 0)),
    "", "",
  ];
  const ws3 = XLSX.utils.aoa_to_sheet([purchaseHeader, ...purchaseRows, purchaseTotal]);
  ws3["!cols"] = [
    { wch: 6 }, { wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 12 },
    { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, "进货流水");

  // ── Sheet 4: 进货汇总（每款酒 × 每供应商）────────────────────────────────────
  const supplierNames = [...new Set(monthPurchases.map((p) => p.supplier ?? "未知"))].sort();
  const byItem: Record<string, { item: SpiritItem; bySupplier: Record<string, { qty: number; amount: number }> }> = {};
  monthPurchases.forEach((p) => {
    const item = items.find((i) => i.id === p.itemId);
    if (!item) return;
    if (!byItem[item.id]) byItem[item.id] = { item, bySupplier: {} };
    const sup = p.supplier ?? "未知";
    if (!byItem[item.id].bySupplier[sup]) byItem[item.id].bySupplier[sup] = { qty: 0, amount: 0 };
    byItem[item.id].bySupplier[sup].qty += p.quantity;
    byItem[item.id].bySupplier[sup].amount += p.amount;
  });

  const summaryHeader = ["商品名称", "分类", "参考单价(¥)",
    ...supplierNames.flatMap((s) => [`${s}(瓶)`, `${s}(¥)`]),
    "合计(瓶)", "合计(¥)",
  ];
  const summaryRows2 = Object.values(byItem).map(({ item, bySupplier }) => {
    const refPrice = getRefPrice(item.id, month);
    const supCols = supplierNames.flatMap((s) => [
      bySupplier[s]?.qty ?? 0,
      bySupplier[s] ? fmt(bySupplier[s].amount) : "0",
    ]);
    const totalQty = Object.values(bySupplier).reduce((s, v) => s + v.qty, 0);
    const totalAmt = Object.values(bySupplier).reduce((s, v) => s + v.amount, 0);
    return [item.name, item.category, refPrice > 0 ? fmt(refPrice, 2) : "", ...supCols, totalQty, fmt(totalAmt)];
  });
  const ws4 = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows2]);
  ws4["!cols"] = [{ wch: 22 }, { wch: 12 }, { wch: 12 }, ...supplierNames.flatMap(() => [{ wch: 10 }, { wch: 12 }]), { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws4, "进货汇总");

  // ── 写入文件并分享 ────────────────────────────────────────────────────────────
  const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
  const fileName = `烈酒库存_${month}_${now()}.xlsx`;
  const cacheDir = FileSystem.cacheDirectory ?? "file://tmp/";
  const fileUri = `${cacheDir}${fileName}`;
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("当前设备不支持文件分享");
  await Sharing.shareAsync(fileUri, {
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: `导出 ${monthLabel(month)} 烈酒库存报告`,
    UTI: "com.microsoft.excel.xlsx",
  });
}

// ─── PDF 导出 ─────────────────────────────────────────────────────────────────
export async function exportToPdf(data: ExportData): Promise<void> {
  const { month, items, purchases, ledger, getRefPrice, categorySummary, supplierSummary } = data;
  const monthPurchases = purchases.filter((p) => p.month === month);
  const monthLedger = ledger.filter((e) => e.month === month);

  const totalPurchaseAmt = monthPurchases.reduce((s, p) => s + p.amount, 0);
  const totalClosingCost = monthLedger.reduce((s, e) => s + e.closingCost, 0);
  const totalConsumeQty = monthLedger.reduce((s, e) => s + e.consumeQty, 0);
  const supplierCount = new Set(monthPurchases.map((p) => p.supplier ?? "未知")).size;

  // ── HTML 模板 ─────────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${monthLabel(month)} 烈酒库存管理报告</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; padding: 20px; }
  h1 { font-size: 20px; font-weight: 800; color: #7F1D1D; text-align: center; margin-bottom: 4px; }
  .subtitle { text-align: center; color: #6B7280; font-size: 11px; margin-bottom: 24px; }
  h2 { font-size: 14px; font-weight: 700; color: #991B1B; margin: 20px 0 10px; padding-left: 8px; border-left: 4px solid #EF4444; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 8px; }
  .kpi-card { background: #FEF2F2; border-radius: 10px; padding: 12px; text-align: center; }
  .kpi-value { font-size: 18px; font-weight: 800; color: #EF4444; }
  .kpi-label { font-size: 10px; color: #6B7280; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
  th { background: #7F1D1D; color: #fff; padding: 6px 8px; text-align: center; font-weight: 600; }
  td { padding: 5px 8px; border-bottom: 1px solid #F3F4F6; }
  tr:nth-child(even) td { background: #FEF2F2; }
  .total-row td { background: #FEF2F2 !important; font-weight: 700; color: #991B1B; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .red { color: #EF4444; font-weight: 700; }
  .green { color: #10B981; font-weight: 700; }
  .page-break { page-break-before: always; }
  .footer { text-align: center; color: #9CA3AF; font-size: 10px; margin-top: 30px; padding-top: 12px; border-top: 1px solid #E5E7EB; }
</style>
</head>
<body>

<h1>${monthLabel(month)} 烈酒库存管理报告</h1>
<p class="subtitle">生成时间：${new Date().toLocaleString("zh-CN")}</p>

<!-- 核心指标 -->
<h2>一、核心指标</h2>
<div class="kpi-grid">
  <div class="kpi-card"><div class="kpi-value">¥${fmt(totalPurchaseAmt)}</div><div class="kpi-label">本月进货总额</div></div>
  <div class="kpi-card"><div class="kpi-value">${monthPurchases.length}</div><div class="kpi-label">进货笔数</div></div>
  <div class="kpi-card"><div class="kpi-value">${fmt(totalConsumeQty, 1)}</div><div class="kpi-label">消耗总量(瓶)</div></div>
  <div class="kpi-card"><div class="kpi-value">¥${fmt(totalClosingCost)}</div><div class="kpi-label">期末库存成本</div></div>
  <div class="kpi-card"><div class="kpi-value">${supplierCount}</div><div class="kpi-label">活跃供应商</div></div>
  <div class="kpi-card"><div class="kpi-value">${monthLedger.length}</div><div class="kpi-label">库存品种数</div></div>
</div>

<!-- 分类汇总 -->
<h2>二、分类汇总</h2>
<table>
  <thead><tr><th>分类</th><th>期初(瓶)</th><th>进货(瓶)</th><th>消耗(瓶)</th><th>期末(瓶)</th></tr></thead>
  <tbody>
    ${Object.entries(categorySummary).map(([cat, v]) => `
    <tr><td>${cat}</td><td class="text-right">${v.openingQty}</td><td class="text-right">${v.purchaseQty}</td><td class="text-right">${v.consumeQty}</td><td class="text-right">${v.closingQty}</td></tr>
    `).join("")}
    <tr class="total-row">
      <td>合计</td>
      <td class="text-right">${Object.values(categorySummary).reduce((s, v) => s + v.openingQty, 0)}</td>
      <td class="text-right">${Object.values(categorySummary).reduce((s, v) => s + v.purchaseQty, 0)}</td>
      <td class="text-right">${Object.values(categorySummary).reduce((s, v) => s + v.consumeQty, 0)}</td>
      <td class="text-right">${Object.values(categorySummary).reduce((s, v) => s + v.closingQty, 0)}</td>
    </tr>
  </tbody>
</table>

<!-- 供应商汇总 -->
<h2>三、供应商汇总</h2>
<table>
  <thead><tr><th>供应商</th><th>进货量(瓶)</th><th>进货金额(¥)</th><th>品种数</th></tr></thead>
  <tbody>
    ${Object.entries(supplierSummary).sort((a, b) => b[1].amount - a[1].amount).map(([sup, v]) => `
    <tr><td>${sup}</td><td class="text-right">${v.qty}</td><td class="text-right red">¥${fmt(v.amount)}</td><td class="text-right">${v.items}</td></tr>
    `).join("")}
  </tbody>
</table>

<!-- 库存台账 -->
<div class="page-break"></div>
<h2>四、库存台账</h2>
<table>
  <thead>
    <tr>
      <th>序</th><th>商品名称</th><th>分类</th>
      <th>期初(瓶)</th><th>期初成本(¥)</th>
      <th>进货(瓶)</th><th>进货成本(¥)</th>
      <th>消耗(瓶)</th>
      <th>期末(瓶)</th><th>期末成本(¥)</th>
    </tr>
  </thead>
  <tbody>
    ${monthLedger.map((e, idx) => {
      const item = items.find((i) => i.id === e.itemId);
      const isNeg = e.closingQty < 0;
      return `<tr>
        <td class="text-center">${idx + 1}</td>
        <td>${item?.name ?? "-"}</td>
        <td class="text-center">${item?.category ?? "-"}</td>
        <td class="text-right">${e.openingQty}</td>
        <td class="text-right">¥${fmt(e.openingQty * e.openingUnitCost)}</td>
        <td class="text-right">${e.purchaseQty}</td>
        <td class="text-right">¥${fmt(e.purchaseCost)}</td>
        <td class="text-right">${e.consumeQty}</td>
        <td class="text-right ${isNeg ? "red" : ""}">${e.closingQty}</td>
        <td class="text-right">¥${fmt(e.closingCost)}</td>
      </tr>`;
    }).join("")}
    <tr class="total-row">
      <td colspan="3">合计</td>
      <td class="text-right">${monthLedger.reduce((s, e) => s + e.openingQty, 0)}</td>
      <td class="text-right">¥${fmt(monthLedger.reduce((s, e) => s + e.openingQty * e.openingUnitCost, 0))}</td>
      <td class="text-right">${monthLedger.reduce((s, e) => s + e.purchaseQty, 0)}</td>
      <td class="text-right">¥${fmt(monthLedger.reduce((s, e) => s + e.purchaseCost, 0))}</td>
      <td class="text-right">${monthLedger.reduce((s, e) => s + e.consumeQty, 0)}</td>
      <td class="text-right">${monthLedger.reduce((s, e) => s + e.closingQty, 0)}</td>
      <td class="text-right">¥${fmt(monthLedger.reduce((s, e) => s + e.closingCost, 0))}</td>
    </tr>
  </tbody>
</table>

<!-- 进货流水 -->
<div class="page-break"></div>
<h2>五、进货流水明细</h2>
<table>
  <thead>
    <tr><th>序</th><th>日期</th><th>商品名称</th><th>规格</th><th>数量</th><th>单价(¥)</th><th>金额(¥)</th><th>供应商</th></tr>
  </thead>
  <tbody>
    ${monthPurchases.sort((a, b) => a.date.localeCompare(b.date)).map((p, idx) => `
    <tr>
      <td class="text-center">${idx + 1}</td>
      <td class="text-center">${p.date}</td>
      <td>${p.rawName}</td>
      <td class="text-center">${p.unit}</td>
      <td class="text-right">${p.quantity}</td>
      <td class="text-right">¥${fmt(p.unitPrice, 2)}</td>
      <td class="text-right red">¥${fmt(p.amount)}</td>
      <td>${p.supplier ?? "-"}</td>
    </tr>
    `).join("")}
    <tr class="total-row">
      <td colspan="4">合计</td>
      <td class="text-right">${monthPurchases.reduce((s, p) => s + p.quantity, 0)}</td>
      <td></td>
      <td class="text-right">¥${fmt(monthPurchases.reduce((s, p) => s + p.amount, 0))}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<div class="footer">本报告由烈酒库存管理系统自动生成 · ${monthLabel(month)}</div>
</body>
</html>`;

  // ── 生成 PDF 文件并分享 ────────────────────────────────────────────────────────
  const { uri } = await Print.printToFileAsync({ html });
  // expo-print 生成的文件已在缓存目录，直接分享该 uri
  // （避免 moveAsync 在部分设备上失败）
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error("当前设备不支持文件分享");
  await Sharing.shareAsync(uri, {
    mimeType: "application/pdf",
    dialogTitle: `导出 ${monthLabel(month)} 烈酒库存报告`,
    UTI: "com.adobe.pdf",
  });
}
