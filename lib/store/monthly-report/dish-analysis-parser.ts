/**
 * 菜品分析 Excel 解析器 (Build 135)
 *
 * 支持识别并解析以下报表类型：
 *   - 菜品销售统计（菜品名称）
 *   - 菜品销售统计（菜品大类）
 *   - 菜品销售统计（菜品小类）
 *   - 菜品销售统计（菜品名称+规格）
 *   - 营业收入与收款统计
 *   - 综合收款统计（日度，含套餐明细）
 *   - 餐时段营业统计（订单创建时间）
 *   - 餐时段营业统计（结账时间）
 *   - 营业概览（已有，此处补充识别逻辑）
 */
import * as XLSX from "xlsx";
import {
  ReportFileType,
  DishCategoryData,
  DishSubCategoryData,
  DishItemData,
  DishSpecData,
  RevenueStatement,
  DailyPaymentDetail,
  DishAnalysisSnapshot,
} from "./dish-analysis-types";

function safeNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "string" ? parseFloat(v.replace(/,/g, "")) : Number(v);
  return isNaN(n) ? 0 : n;
}

function safeStr(v: any): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── 文件类型识别（基于文件名 + 内容） ────────────────────────────────────────
/**
 * 通过文件名快速识别报表类型
 * 文件名识别优先，内容识别兜底
 */
export function detectReportTypeByFilename(filename: string): ReportFileType {
  const n = filename.toLowerCase();
  if (n.includes("营业概览")) return "overview";
  if (n.includes("综合收款统计")) return "daily_payment";
  if (n.includes("营业收入与收款统计")) return "revenue_statement";
  if (n.includes("餐时段营业统计")) return "time_slot_order"; // 先标为 order，内容识别区分
  if (n.includes("菜品销售统计")) return "dish_by_name"; // 先标为 name，内容识别区分
  return "unknown";
}

/**
 * 通过 Excel 内容精确识别报表类型（读取第2行的统计方式说明）
 */
export function detectReportTypeByContent(base64: string): ReportFileType {
  try {
    const wb = XLSX.read(base64, { type: "base64" });
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    // 营业概览：有多个工作表（营业/收款/菜品/顾客）
    if (wb.SheetNames.includes("营业") && wb.SheetNames.includes("收款")) {
      return "overview";
    }

    // 读取第1行（标题）和第2行（统计说明）
    const row0 = safeStr(rows[0]?.[0]);
    const row1 = safeStr(rows[1]?.[0]);

    if (row0 === "营业收入与收款统计") return "revenue_statement";

    if (row0 === "综合收款统计") return "daily_payment";

    if (row0 === "餐时段营业统计") {
      if (row1.includes("订单创建时间")) return "time_slot_order";
      if (row1.includes("结账时间")) return "time_slot_checkout";
      return "time_slot_order";
    }

    if (row0 === "菜品销售统计") {
      if (row1.includes("菜品名称+规格")) return "dish_by_spec";
      if (row1.includes("菜品小类")) return "dish_by_subcategory";
      if (row1.includes("菜品大类")) return "dish_by_category";
      if (row1.includes("菜品名称")) return "dish_by_name";
      return "dish_by_name";
    }

    return "unknown";
  } catch {
    return "unknown";
  }
}

// ─── 提取月份字符串 ────────────────────────────────────────────────────────────
function extractMonthFromRow1(row1: string): string {
  // 格式：【2026/07/01-2026/07/31】 或 【2026/07/01 至 2026/07/31】
  const m = row1.match(/【(\d{4})[/\-](\d{2})[/\-]\d{2}/);
  if (m) return `${m[1]}/${m[2]}`;
  const m2 = row1.match(/(\d{4})[/\-](\d{2})[/\-]\d{2}/);
  if (m2) return `${m2[1]}/${m2[2]}`;
  return "";
}

// ─── 解析菜品大类 ──────────────────────────────────────────────────────────────
export function parseDishCategories(base64: string): {
  categories: DishCategoryData[];
  month: string;
} {
  try {
    const wb = XLSX.read(base64, { type: "base64" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { categories: [], month: "" };
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    const month = extractMonthFromRow1(safeStr(rows[1]?.[0]));
    const categories: DishCategoryData[] = [];

    // 表头在第3行（index 2），数据从第5行（index 4）开始
    for (let i = 4; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const name = safeStr(row[0]);
      if (!name || name === "合计") continue;
      categories.push({
        name,
        salesQty: safeNum(row[1]),
        salesQtyPct: safeNum(row[2]),
        salesAmount: safeNum(row[3]),
        salesAmountPct: safeNum(row[4]),
        revenue: safeNum(row[5]),
        revenuePct: safeNum(row[6]),
        discount: safeNum(row[7]),
      });
    }
    return { categories, month };
  } catch {
    return { categories: [], month: "" };
  }
}

// ─── 解析菜品小类 ──────────────────────────────────────────────────────────────
export function parseDishSubCategories(base64: string): {
  subCategories: DishSubCategoryData[];
  month: string;
} {
  try {
    const wb = XLSX.read(base64, { type: "base64" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { subCategories: [], month: "" };
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    const month = extractMonthFromRow1(safeStr(rows[1]?.[0]));
    const subCategories: DishSubCategoryData[] = [];

    for (let i = 4; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const category = safeStr(row[0]);
      const subCategory = safeStr(row[1]);
      if (!category || !subCategory || category === "合计") continue;
      subCategories.push({
        category,
        subCategory,
        salesQty: safeNum(row[2]),
        salesQtyPct: safeNum(row[3]),
        salesAmount: safeNum(row[4]),
        salesAmountPct: safeNum(row[5]),
        revenue: safeNum(row[6]),
        revenuePct: safeNum(row[7]),
        discount: safeNum(row[8]),
      });
    }
    return { subCategories, month };
  } catch {
    return { subCategories: [], month: "" };
  }
}

// ─── 解析菜品明细（菜品名称） ──────────────────────────────────────────────────
export function parseDishItems(base64: string): {
  items: DishItemData[];
  month: string;
} {
  try {
    const wb = XLSX.read(base64, { type: "base64" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { items: [], month: "" };
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    const month = extractMonthFromRow1(safeStr(rows[1]?.[0]));
    const items: DishItemData[] = [];

    // 表头跨两行（第3、4行），数据从第5行开始
    for (let i = 4; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const name = safeStr(row[0]);
      if (!name || name === "合计") continue;
      items.push({
        name,
        itemType: safeStr(row[1]) || undefined,
        saleStatus: safeStr(row[2]) || undefined,
        salesQty: safeNum(row[3]),
        salesQtyPct: safeNum(row[4]),
        salesAmount: safeNum(row[5]),
        salesAmountPct: safeNum(row[6]),
        revenue: safeNum(row[7]),
        revenuePct: safeNum(row[8]),
        discount: safeNum(row[9]),
      });
    }
    return { items, month };
  } catch {
    return { items: [], month: "" };
  }
}

// ─── 解析菜品规格（菜品名称+规格） ────────────────────────────────────────────
export function parseDishSpecs(base64: string): {
  specs: DishSpecData[];
  month: string;
} {
  try {
    const wb = XLSX.read(base64, { type: "base64" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { specs: [], month: "" };
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    const month = extractMonthFromRow1(safeStr(rows[1]?.[0]));
    const specs: DishSpecData[] = [];

    for (let i = 4; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const name = safeStr(row[0]);
      if (!name || name === "合计") continue;
      specs.push({
        name,
        spec: safeStr(row[1]) || "--",
        salesQty: safeNum(row[2]),
        salesQtyPct: safeNum(row[3]),
        salesAmount: safeNum(row[4]),
        salesAmountPct: safeNum(row[5]),
        revenue: safeNum(row[6]),
        revenuePct: safeNum(row[7]),
        discount: safeNum(row[8]),
      });
    }
    return { specs, month };
  } catch {
    return { specs: [], month: "" };
  }
}

// ─── 解析营业收入与收款统计 ────────────────────────────────────────────────────
export function parseRevenueStatement(base64: string): {
  statement: RevenueStatement;
  month: string;
} {
  try {
  const wb = XLSX.read(base64, { type: "base64" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { statement: {} as RevenueStatement, month: "" };
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const month = extractMonthFromRow1(safeStr(rows[1]?.[0]));

  // 按行号提取（固定格式）
  const getVal = (rowIdx: number): number => safeNum(rows[rowIdx]?.[2]);

  const statement: RevenueStatement = {
    grossRevenue: getVal(3),      // 行4：营业额
    totalDiscount: getVal(4),     // 行5：优惠金额
    discountBreakdown: {
      memberCard: getVal(5),      // 行6：会员卡
      meituan: getVal(6),         // 行7：美团/大众点评团购
      manualDiscount: getVal(7),  // 行8：手动折扣
      roundOff: getVal(8),        // 行9：抹零
    },
    netRevenue: getVal(9),        // 行10：营业收入
    otherRevenue: getVal(10),     // 行11：其他业务收款
    totalReceipts: getVal(11),    // 行12：收款合计
    totalFinancialFees: getVal(12), // 行13：财务费用
    financialFees: {
      scanPayFee: getVal(13),     // 行14：扫码支付手续费
      meituanServiceFee: getVal(14), // 行15：美团/点评团购服务费
    },
    estimatedReceived: getVal(15), // 行16：预计到账
  };

  return { statement, month };
  } catch {
    return { statement: {} as RevenueStatement, month: "" };
  }
}

// ─── 解析综合收款统计（日度，含套餐明细） ─────────────────────────────────────
export function parseDailyPayments(base64: string): {
  dailyPayments: DailyPaymentDetail[];
  month: string;
} {
  try {
  const wb = XLSX.read(base64, { type: "base64" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { dailyPayments: [], month: "" };
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const month = extractMonthFromRow1(safeStr(rows[1]?.[0]));

  // 表头跨两行（第3、4行），需要合并列头
  // 第3行：营业日期/业务大类/收款小计/扫码支付/会员卡/美团/大众点评团购
  // 第4行：微信/支付宝/银联二维码（储蓄卡）/银联二维码（信用卡）/卡余额消费-储值余额/套餐名称...
  const headerRow3 = rows[2] ?? [];
  const headerRow4 = rows[3] ?? [];

  // 找美团套餐列的起始位置（第4行中，从第6列开始是套餐名称）
  const meituanPackageHeaders: string[] = [];
  for (let c = 5; c < headerRow4.length; c++) {
    const h = safeStr(headerRow4[c]);
    if (h && h !== "微信" && h !== "支付宝" && !h.includes("银联") && !h.includes("卡余额")) {
      meituanPackageHeaders.push(h);
    }
  }

  const dailyPayments: DailyPaymentDetail[] = [];
  const dateMap: Map<string, DailyPaymentDetail> = new Map();

  for (let i = 4; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;
    const dateRaw = safeStr(row[0]);
    if (!dateRaw.match(/\d{4}\/\d{2}\/\d{2}/)) continue;
    const date = dateRaw.replace(/\//g, "-");
    const businessType = safeStr(row[1]);

    if (!dateMap.has(date)) {
      dateMap.set(date, {
        date,
        businessType,
        subtotal: 0,
        wechat: 0,
        alipay: 0,
        unionpayDebit: 0,
        unionpayCredit: 0,
        memberCard: 0,
        meituanPackages: [],
        meituanTotal: 0,
      });
    }

    const entry = dateMap.get(date)!;
    entry.subtotal += safeNum(row[2]);
    entry.wechat += safeNum(row[3]);
    entry.alipay += safeNum(row[4]);
    // 银联储蓄/信用/会员卡在第4行对应列
    // 简化处理：直接取第5-8列
    entry.unionpayDebit += safeNum(row[5]);
    entry.unionpayCredit += safeNum(row[6]);
    entry.memberCard += safeNum(row[7]);

    // 美团套餐（从第8列开始）
    let meituanSum = 0;
    for (let c = 8; c < row.length; c++) {
      const amt = safeNum(row[c]);
      if (amt > 0) {
        const pkgName = meituanPackageHeaders[c - 8] ?? `套餐${c - 7}`;
        const existing = entry.meituanPackages.find((p) => p.name === pkgName);
        if (existing) {
          existing.amount += amt;
        } else {
          entry.meituanPackages.push({ name: pkgName, amount: amt });
        }
        meituanSum += amt;
      }
    }
    entry.meituanTotal += meituanSum;
  }

  return { dailyPayments: Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date)), month };
  } catch {
    return { dailyPayments: [], month: "" };
  }
}

// ─── 主解析函数：根据类型分发 ──────────────────────────────────────────────────
export interface ParseDishAnalysisInput {
  /** 文件列表（base64 + 文件名） */
  files: { base64: string; filename: string }[];
  /** 已有快照（用于合并更新） */
  existingSnapshot?: DishAnalysisSnapshot;
}

export interface ParseDishAnalysisResult {
  snapshot: DishAnalysisSnapshot;
  /** 识别结果（每个文件的类型） */
  fileTypes: { filename: string; type: ReportFileType; success: boolean; error?: string }[];
  /** 缺失的必要报表 */
  missingRequired: ReportFileType[];
  /** 已导入的报表 */
  importedTypes: ReportFileType[];
}

export function parseDishAnalysis(input: ParseDishAnalysisInput): ParseDishAnalysisResult {
  const fileTypes: ParseDishAnalysisResult["fileTypes"] = [];
  let month = "";

  // 初始化快照（合并已有数据）
  const snapshot: DishAnalysisSnapshot = input.existingSnapshot
    ? { ...input.existingSnapshot, importedAt: new Date().toISOString() }
    : {
        id: uuid(),
        month: "",
        monthLabel: "",
        importedAt: new Date().toISOString(),
        categories: [],
        subCategories: [],
        items: [],
        specs: [],
        dailyPayments: [],
        importedReports: {
          categories: false,
          subCategories: false,
          items: false,
          specs: false,
          revenueStatement: false,
          dailyPayments: false,
          timeSlotsByOrder: false,
          timeSlotsByCheckout: false,
        },
      };

  const importedTypes: ReportFileType[] = [];

  for (const { base64, filename } of input.files) {
    // 先按文件名识别，再按内容精确识别
    let type = detectReportTypeByFilename(filename);
    if (type === "unknown" || type === "dish_by_name" || type === "time_slot_order") {
      const contentType = detectReportTypeByContent(base64);
      if (contentType !== "unknown") type = contentType;
    }

    try {
      switch (type) {
        case "dish_by_category": {
          const { categories, month: m } = parseDishCategories(base64);
          snapshot.categories = categories;
          snapshot.importedReports.categories = true;
          if (m) month = m;
          importedTypes.push(type);
          break;
        }
        case "dish_by_subcategory": {
          const { subCategories, month: m } = parseDishSubCategories(base64);
          snapshot.subCategories = subCategories;
          snapshot.importedReports.subCategories = true;
          if (m) month = m;
          importedTypes.push(type);
          break;
        }
        case "dish_by_name": {
          const { items, month: m } = parseDishItems(base64);
          snapshot.items = items;
          snapshot.importedReports.items = true;
          if (m) month = m;
          importedTypes.push(type);
          break;
        }
        case "dish_by_spec": {
          const { specs, month: m } = parseDishSpecs(base64);
          snapshot.specs = specs;
          snapshot.importedReports.specs = true;
          if (m) month = m;
          importedTypes.push(type);
          break;
        }
        case "revenue_statement": {
          const { statement, month: m } = parseRevenueStatement(base64);
          snapshot.revenueStatement = statement;
          snapshot.importedReports.revenueStatement = true;
          if (m) month = m;
          importedTypes.push(type);
          break;
        }
        case "daily_payment": {
          const { dailyPayments, month: m } = parseDailyPayments(base64);
          snapshot.dailyPayments = dailyPayments;
          snapshot.importedReports.dailyPayments = true;
          if (m) month = m;
          importedTypes.push(type);
          break;
        }
        case "time_slot_order":
          snapshot.importedReports.timeSlotsByOrder = true;
          importedTypes.push(type);
          break;
        case "time_slot_checkout":
          snapshot.importedReports.timeSlotsByCheckout = true;
          importedTypes.push(type);
          break;
        default:
          break;
      }
      fileTypes.push({ filename, type, success: true });
    } catch (e: any) {
      fileTypes.push({ filename, type, success: false, error: e?.message ?? "解析失败" });
    }
  }

  // 更新月份
  if (month) {
    snapshot.month = month.replace("/", "-");
    const [y, m] = month.split("/");
    snapshot.monthLabel = `${y}年${Number(m)}月`;
  }

  // 检测缺失的必要报表
  const REQUIRED: ReportFileType[] = ["dish_by_category", "dish_by_name"];
  const missingRequired = REQUIRED.filter((t) => !importedTypes.includes(t));

  return { snapshot, fileTypes, missingRequired, importedTypes };
}
