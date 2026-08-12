/**
 * 烈酒 Excel 解析器
 * 基于「黎明前（2026）02烈酒.xlsx」真实数据结构
 *
 * 工作表结构：
 * - 烈酒盘点：列0=产品序号 列1=盘点分类 列2=中文名 列3=期初库存量 列4=期初单位成本
 *             列5=期初库存成本 列6=本月进货量 列7=本月进货成本 列8=期末库存量
 *             列9=单位成本 列10=期末库存成本 列11=消耗瓶数 列12=本期消耗量 列13=Check
 * - 至缘：行1=往来单位 行2=表头(行号/日期/商品名称/规格/数量/单价/应收增加) 行3+=数据
 *         列0=行号 列1=日期 列2=商品名称 列3=规格 列4=数量 列5=单价 列6=应收增加
 * - 戎恒/自采：同至缘格式，但本月可能为空
 * - 进货汇总：列0=序号 列1=中文名字 列2=Price 列3=Total quantity 列4=Total amount
 *             列5=至缘商品名 列6=至缘数量 列7=至缘金额 列8=采购单价 列9=每月价格对比
 *             列10=戎恒商品名 列11=戎恒数量 列12=戎恒金额
 * - 酒类信息：列0=产品序号 列1=盘点分类 列2=中文名 列3=英文名 列4=参考单价 列5=规格
 */
import { utils, read as xlsxRead } from "xlsx";
import { normalizeImportDate } from "../import/date-utils";
import { dominantPurchaseMonth } from "./import-bridge";
import {
  SpiritInventoryItem,
  SpiritPurchaseOrderItem,
  SpiritInfoItem,
  SpiritMonthlySnapshot,
  SpiritPriceChange,
} from "./types";

function uuid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/**
 * 解析至缘/戎恒/自采商品名格式
 * 「白占边（金宾波本）/Jim Beam White」→ { nameZh: "白占边（金宾波本）", nameEn: "Jim Beam White" }
 * 「利莱白利口酒（莉雷白）Lillet」→ { nameZh: "利莱白利口酒（莉雷白）Lillet", nameEn: "" }（无斜杠时整体作为中文名）
 */
export function parseSupplierName(raw: string): { nameZh: string; nameEn: string } {
  if (!raw) return { nameZh: "", nameEn: "" };
  const s = raw.trim();
  // 按 / 或 ／ 分割
  const slashIdx = s.indexOf("/");
  const fullSlashIdx = s.indexOf("／");
  const idx = slashIdx >= 0 ? slashIdx : fullSlashIdx >= 0 ? fullSlashIdx : -1;
  if (idx >= 0) {
    return {
      nameZh: s.slice(0, idx).trim(),
      nameEn: s.slice(idx + 1).trim(),
    };
  }
  // 没有斜杠：整体作为中文名（可能含英文后缀）
  return { nameZh: s, nameEn: "" };
}


/**
 * 解析「烈酒盘点」工作表（164 款有效数据）
 * 列：产品序号/盘点分类/中文名/期初库存量/期初单位成本/期初库存成本/
 *     本月进货量/本月进货成本/期末库存量/单位成本/期末库存成本/消耗瓶数/本期消耗量/Check
 */
function parseLedgerSheet(ws: any): SpiritInventoryItem[] {
  if (!ws) return [];
  const rows = utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  const items: SpiritInventoryItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const name = r[2];
    if (!name || typeof name !== "string" || !name.trim()) continue;
    items.push({
      seq: Number(r[0]) || i,
      category: String(r[1] || "Other").trim(),
      name: String(name).trim(),
      initQty: Number(r[3]) || 0,
      initUnitCost: Number(r[4]) || 0,
      initCost: Number(r[5]) || 0,
      purchaseQty: Number(r[6]) || 0,
      purchaseCost: Number(r[7]) || 0,
      endQty: Number(r[8]) || 0,
      unitCost: Number(r[9]) || 0,
      endCost: Number(r[10]) || 0,
      consumeBottles: Number(r[11]) || 0,
      consumeQty: Number(r[12]) || 0,
    });
  }
  return items;
}

/**
 * 解析供应商工作表（至缘/戎恒/自采）
 * 格式：行1=往来单位信息 行2=表头 行3+=数据
 * 列：行号/日期/商品名称/规格/数量/单价/应收增加
 */
function parseSupplierSheet(ws: any, supplierName: string): SpiritPurchaseOrderItem[] {
  if (!ws) return [];
  const rows = utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  const items: SpiritPurchaseOrderItem[] = [];
  let lastValidDate = "";

  // 数据从第3行开始（index=2），跳过往来单位行和表头行
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    // 列：0=行号 1=日期 2=商品名称 3=规格 4=数量 5=单价 6=应收增加
    const rawName = String(r[2] || "").trim();
    if (!rawName) continue;
    const qty = Number(r[4]) || 0;
    const price = Number(r[5]) || 0;
    const amount = Number(r[6]) || (qty * price);
    if (qty === 0 && price === 0 && amount === 0) continue;

    const rawDate = r[1];
    const parsedDate = normalizeImportDate(rawDate);
    const hasDateValue = rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== "";
    if (hasDateValue && !parsedDate) continue;
    const date = parsedDate ?? lastValidDate;
    if (!date) continue;
    if (parsedDate) lastValidDate = parsedDate;

    const { nameZh, nameEn } = parseSupplierName(rawName);
    items.push({
      supplier: supplierName,
      rawName,
      nameZh,
      nameEn,
      unitPrice: price,
      quantity: qty,
      amount,
      spec: String(r[3] || "").trim(),
      date,
    });
  }
  return items;
}

/**
 * 解析「进货汇总」工作表
 * 用于提取价格对比信息（每月价格对比列）
 * 列：序号/中文名字/Price/Total quantity/Total amount/至缘商品名/至缘数量/至缘金额/采购单价/每月价格对比/戎恒商品名/戎恒数量/戎恒金额
 */
function parsePurchaseSummarySheet(ws: any): SpiritPriceChange[] {
  if (!ws) return [];
  const rows = utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  const changes: SpiritPriceChange[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const name = String(r[1] || "").trim();
    const refPrice = Number(r[2]) || 0;
    const priceCompare = r[9]; // 每月价格对比列
    if (!name || !priceCompare || priceCompare === "-" || priceCompare === 0) continue;
    const diff = Number(priceCompare);
    if (isNaN(diff) || diff === 0) continue;
    const avgPrice = Number(r[8]) || 0; // 采购单价
    changes.push({
      name,
      prevPrice: refPrice - diff, // 上期价格 = 参考价 - 变动
      currPrice: avgPrice > 0 ? avgPrice : refPrice,
      changePct: refPrice > 0 ? (diff / refPrice) * 100 : 0,
      changeAmt: diff,
      supplier: "至缘", // 进货汇总主要来自至缘
    });
  }
  return changes;
}

/**
 * 解析「酒类信息」工作表（208 款）
 * 列：产品序号/盘点分类/中文名/英文名/参考单价Price/Specifications
 */
function parseInfoSheet(ws: any): SpiritInfoItem[] {
  if (!ws) return [];
  const rows = utils.sheet_to_json<any[]>(ws, { header: 1, defval: null });
  const items: SpiritInfoItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const nameZh = String(r[2] || "").trim();
    if (!nameZh) continue;
    items.push({
      nameZh,
      nameEn: String(r[3] || "").trim(),
      refPrice: Number(r[4]) || 0,
      spec: String(r[5] || "").trim(),
    });
  }
  return items;
}

/**
 * 主解析函数：解析烈酒 Excel 文件
 */
export function parseSpiritInventoryExcel(base64: string): {
  snapshot: SpiritMonthlySnapshot | null;
  infoItems: SpiritInfoItem[];
  priceChanges: SpiritPriceChange[];
  error?: string;
} {
  try {
    const wb = xlsxRead(base64, { type: "base64", cellDates: true });

    // ── 烈酒盘点（必须存在） ──
    const ledgerWs = wb.Sheets["烈酒盘点"];
    const items = parseLedgerSheet(ledgerWs);

    if (items.length === 0) {
      return { snapshot: null, infoItems: [], priceChanges: [], error: "未找到「烈酒盘点」工作表或数据为空" };
    }

    // ── 供应商工作表（动态识别：排除已知非供应商 Sheet） ──
    const purchaseOrders: SpiritPurchaseOrderItem[] = [];
    // 排除已知的非供应商 Sheet
    const NON_SUPPLIER_SHEETS = new Set(["烈酒盘点", "进货汇总", "酒类信息", "汇总", "Sheet1", "Sheet2", "Sheet3"]);
    const supplierSheetNames = wb.SheetNames.filter((name: string) => !NON_SUPPLIER_SHEETS.has(name));
    supplierSheetNames.forEach((sup: string) => {
      const sheetRows = utils.sheet_to_json<any[]>(wb.Sheets[sup], { header: 1, defval: null });
      // 判断是否是供应商进货单（包含商品名称列）
      const hasProductCol = sheetRows.slice(0, 5).some((r: any[]) =>
        r && r.some((c: any) => /商品名称|品名|名称|货品/.test(String(c ?? "")))
      );
      if (hasProductCol) {
        purchaseOrders.push(...parseSupplierSheet(wb.Sheets[sup], sup));
      }
    });

    // ── 价格对比（从进货汇总表） ──
    const priceChanges = parsePurchaseSummarySheet(wb.Sheets["进货汇总"]);

    // ── 酒类信息 ──
    const infoItems = parseInfoSheet(wb.Sheets["酒类信息"]);

    // ── 供应商汇总 ──
    const supplierTotals: Record<string, number> = {};
    purchaseOrders.forEach((po) => {
      supplierTotals[po.supplier] = (supplierTotals[po.supplier] ?? 0) + po.amount;
    });
    // 如果供应商工作表为空，从盘点表计算
    if (purchaseOrders.length === 0) {
      items.forEach((item) => {
        if (item.purchaseCost > 0) {
          supplierTotals["至缘"] = (supplierTotals["至缘"] ?? 0) + item.purchaseCost;
        }
      });
    }

    // ── 分类汇总 ──
    const categoryTotals: Record<string, number> = {};
    items.forEach((item) => {
      if (item.purchaseCost > 0) {
        categoryTotals[item.category] = (categoryTotals[item.category] ?? 0) + item.purchaseCost;
      }
    });

    // ── 月份标签 ──
    const now = new Date();
    const fallbackMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const snapshotMonth = dominantPurchaseMonth(purchaseOrders, fallbackMonth);
    const [year, month] = snapshotMonth.split("-");
    const monthLabel = `${year}年${Number(month)}月`;

    const totalPurchase =
      Object.values(supplierTotals).reduce((s, v) => s + v, 0) ||
      items.reduce((s, i) => s + i.purchaseCost, 0);
    const totalConsume = items.reduce((s, i) => s + i.consumeQty, 0);
    const totalEndCost = items.reduce((s, i) => s + i.endCost, 0);

    const snapshot: SpiritMonthlySnapshot = {
      id: uuid(),
      monthLabel,
      importedAt: new Date().toISOString(),
      items,
      purchaseOrders,
      supplierTotals,
      categoryTotals,
      totalPurchase,
      totalConsume,
      totalEndCost,
    };

    return { snapshot, infoItems, priceChanges };
  } catch (e) {
    console.error("烈酒 Excel 解析失败", e);
    return { snapshot: null, infoItems: [], priceChanges: [], error: String(e) };
  }
}
