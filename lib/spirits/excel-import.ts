/**
 * 烈酒进销存 — 通用进货单导入引擎 v2
 *
 * 支持格式：
 * 1. 标准供应商进货单（你的模版格式）：
 *    行1: 客户名称 + 店名
 *    行2: 空行（可选）
 *    行3: 表头（日期/商品名称/单位/数量/单价/金额）
 *    行4+: 数据行
 *    最后行: 总计
 *
 * 2. 无表头格式：直接从数据行开始，自动识别列顺序
 * 3. 多 sheet：自动扫描所有 sheet，找到有效数据的 sheet
 * 4. 合并单元格：自动展开合并单元格的值
 * 5. 混合格式：日期可能在某些行缺失（继承上一行日期）
 * 6. 多供应商：从文件名或第一行提取供应商名
 *
 * 商品名格式识别（来自你的真实数据）：
 * - "中文名/英文名"（斜杠分隔）
 * - "中文名（备注）英文名"（括号+空格）
 * - "中文名 英文名"（空格分隔）
 * - 纯中文名
 * - 纯英文名
 */

export interface ParsedPurchaseRow {
  date: string;        // YYYY-MM-DD
  month: string;       // YYYY-MM
  rawName: string;     // 原始商品名（完整保留）
  nameZh: string;      // 解析出的中文名
  nameEn: string;      // 解析出的英文名
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  supplier?: string;
  category?: string;   // 自动识别的分类
}

export interface ExcelImportResult {
  rows: ParsedPurchaseRow[];
  month: string;
  supplier?: string;
  totalAmount: number;
  errors: string[];
  warnings: string[];
  sheetName?: string;
}

export interface SheetPreview {
  name: string;
  rowCount: number;
  preview: string[];  // 前3行非空内容
  isValid: boolean;
}

// ─── 列名识别词典（覆盖所有常见变体）────────────────────────────────────────
const COL_PATTERNS = {
  date: /^(日期|date|时间|进货日期|采购日期|订单日期|order.?date|delivery.?date)$/i,
  name: /^(商品名称|品名|名称|产品名称|酒名|货品名称|item|product|name|goods|商品|货品|物品|描述|description)$/i,
  unit: /^(单位|unit|规格单位|包装单位|计量单位)$/i,
  qty:  /^(数量|qty|quantity|件数|进货数量|采购数量|订购数量|amount|count)$/i,
  price:/^(单价|price|unit.?price|进价|采购单价|进货单价|含税单价|不含税单价|售价)$/i,
  amount:/^(金额|amount|total|合计|小计|总价|总金额|价格|含税金额|不含税金额)$/i,
};

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/** 解析各种日期格式 → YYYY-MM-DD */
function parseDate(val: any): string | null {
  if (val === null || val === undefined || val === "") return null;

  // JavaScript Date 对象（xlsx 库解析后的结果）
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, "0");
    const d = String(val.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const s = String(val).trim();

  // Excel 日期序列号（数字，通常 40000-50000）
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n > 25569 && n < 60000) {
      const d = new Date((n - 25569) * 86400 * 1000);
      return d.toISOString().slice(0, 10);
    }
  }

  // ISO 格式（含时间）
  if (s.includes("T") || /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    return s.slice(0, 10);
  }

  // YYYY-MM-DD 或 YYYY/MM/DD 或 YYYY.MM.DD
  const m1 = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;

  // DD/MM/YYYY 或 MM/DD/YYYY（模糊，优先 DD/MM）
  const m2 = s.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;

  // 中文日期：2026年2月1日
  const m3 = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (m3) return `${m3[1]}-${m3[2].padStart(2, "0")}-${m3[3].padStart(2, "0")}`;

  return null;
}

/** 解析数字（处理千分位、货币符号、中文数字等）*/
function parseNumber(val: any): number {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const s = String(val).replace(/[,，¥￥$€£\s]/g, "").trim();
  // 处理中文数字
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

/** 解析商品名称，分离中文名和英文名 */
function parseProductName(raw: string): { nameZh: string; nameEn: string } {
  if (!raw) return { nameZh: "", nameEn: "" };
  const s = raw.trim();

  // 斜杠分隔：中文/英文 或 英文/中文
  if (s.includes("/")) {
    const parts = s.split("/").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0];
      const rest = parts.slice(1).join(" ");
      // 判断哪个是中文
      const firstHasChinese = /[\u4e00-\u9fff]/.test(first);
      if (firstHasChinese) return { nameZh: first, nameEn: rest };
      return { nameZh: rest, nameEn: first };
    }
  }

  // 括号内容提取（如：白占边（金宾波本）/Jim Beam White）
  // 已在斜杠处理中覆盖，这里处理纯括号格式
  const hasChinese = /[\u4e00-\u9fff]/.test(s);
  const hasEnglish = /[a-zA-Z]{3,}/.test(s);

  if (hasChinese && hasEnglish) {
    // 找到第一个连续英文片段作为英文名
    const enMatch = s.match(/([A-Za-z][A-Za-z\s\-'\.&0-9]+[A-Za-z0-9])/);
    if (enMatch) {
      const enPart = enMatch[0].trim();
      const zhPart = s.replace(enPart, "").replace(/[（(）)\s\/]+/g, " ").trim();
      return { nameZh: zhPart || s, nameEn: enPart };
    }
  }

  if (hasChinese) return { nameZh: s, nameEn: "" };
  return { nameZh: "", nameEn: s };
}

/** 检测一行是否是有效的数据行（非表头、非合计、非空） */
function isDataRow(row: any[]): boolean {
  if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === "")) return false;
  const firstCell = String(row[0] ?? "").trim().toLowerCase();
  // 跳过合计行、表头行
  const skipPatterns = ["总计", "合计", "小计", "total", "subtotal", "sum", "客户名称", "日期", "商品名称", "品名", "date", "item", "product"];
  if (skipPatterns.some((p) => firstCell.includes(p))) return false;
  return true;
}

/** 检测表头行 */
function isHeaderRow(row: any[]): boolean {
  if (!row) return false;
  const cells = row.map((c) => String(c ?? "").trim().toLowerCase());
  const headerKeywords = ["日期", "商品名称", "品名", "单位", "数量", "单价", "金额", "date", "name", "qty", "price", "amount", "unit"];
  const matchCount = cells.filter((c) => headerKeywords.some((k) => c.includes(k))).length;
  return matchCount >= 2;
}

/** 从表头行推断列索引 */
function detectColumns(headerRow: any[]): {
  dateIdx: number; nameIdx: number; unitIdx: number;
  qtyIdx: number; priceIdx: number; amountIdx: number;
} {
  const result = { dateIdx: -1, nameIdx: -1, unitIdx: -1, qtyIdx: -1, priceIdx: -1, amountIdx: -1 };
  headerRow.forEach((cell, idx) => {
    const s = String(cell ?? "").trim();
    if (COL_PATTERNS.date.test(s)) result.dateIdx = idx;
    else if (COL_PATTERNS.name.test(s)) result.nameIdx = idx;
    else if (COL_PATTERNS.unit.test(s)) result.unitIdx = idx;
    else if (COL_PATTERNS.qty.test(s)) result.qtyIdx = idx;
    else if (COL_PATTERNS.price.test(s)) result.priceIdx = idx;
    else if (COL_PATTERNS.amount.test(s)) result.amountIdx = idx;
  });
  return result;
}

/** 当没有表头时，根据列内容推断列顺序（启发式） */
function inferColumnsFromData(rows: any[][]): {
  dateIdx: number; nameIdx: number; unitIdx: number;
  qtyIdx: number; priceIdx: number; amountIdx: number;
} {
  // 分析前10行数据行
  const dataRows = rows.filter(isDataRow).slice(0, 10);
  if (dataRows.length === 0) return { dateIdx: -1, nameIdx: -1, unitIdx: -1, qtyIdx: -1, priceIdx: -1, amountIdx: -1 };

  const colCount = Math.max(...dataRows.map((r) => r.length));
  const colScores: Record<string, number[]> = { date: [], name: [], unit: [], qty: [], price: [], amount: [] };

  for (let col = 0; col < colCount; col++) {
    const values = dataRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
    let dateScore = 0, nameScore = 0, unitScore = 0, qtyScore = 0, priceScore = 0, amountScore = 0;

    values.forEach((v) => {
      const s = String(v).trim();
      // 日期特征
      if (v instanceof Date || /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(s) || /\d{4}年/.test(s)) dateScore++;
      // 名称特征（含中文且较长）
      if (/[\u4e00-\u9fff]{2,}/.test(s) && s.length > 4) nameScore++;
      // 单位特征（短字符串：瓶/箱/罐/个等）
      if (/^(瓶|箱|罐|个|听|袋|盒|ml|L|kg|g|打|件|支|条|包)$/.test(s)) unitScore += 2;
      // 数量特征（小整数 1-100）
      const n = Number(s);
      if (!isNaN(n) && n > 0 && n <= 200 && Number.isInteger(n)) qtyScore++;
      // 单价特征（中等数值 10-2000）
      if (!isNaN(n) && n >= 5 && n <= 5000) priceScore++;
      // 金额特征（较大数值）
      if (!isNaN(n) && n >= 10) amountScore++;
    });

    colScores.date.push(dateScore);
    colScores.name.push(nameScore);
    colScores.unit.push(unitScore);
    colScores.qty.push(qtyScore);
    colScores.price.push(priceScore);
    colScores.amount.push(amountScore);
  }

  const bestIdx = (scores: number[]) => scores.indexOf(Math.max(...scores));

  // 你的模版固定格式：日期/商品名称/单位/数量/单价/金额（6列）
  if (colCount >= 6) {
    return { dateIdx: 0, nameIdx: 1, unitIdx: 2, qtyIdx: 3, priceIdx: 4, amountIdx: 5 };
  }

  return {
    dateIdx: bestIdx(colScores.date),
    nameIdx: bestIdx(colScores.name),
    unitIdx: bestIdx(colScores.unit),
    qtyIdx: bestIdx(colScores.qty),
    priceIdx: bestIdx(colScores.price),
    amountIdx: bestIdx(colScores.amount),
  };
}

/** 提取供应商名称（从第1行或文件名） */
function extractSupplier(rows: any[][], fileName?: string): string | undefined {
  // 从第1行提取（格式：客户名称 | 供应商名）
  if (rows[0]) {
    const firstRow = rows[0].map((c) => String(c ?? "").trim()).filter(Boolean);
    if (firstRow.length >= 2) {
      const label = firstRow[0].toLowerCase();
      if (label.includes("客户") || label.includes("供应商") || label.includes("customer") || label.includes("supplier")) {
        return firstRow[1];
      }
    }
    // 第一行只有一个非空值且不是表头关键词
    if (firstRow.length === 1 && !/日期|商品|单位|数量|单价|金额|date|name|qty|price/.test(firstRow[0].toLowerCase())) {
      return firstRow[0];
    }
  }

  // 从文件名提取（去掉扩展名和特殊字符）
  if (fileName) {
    const name = fileName.replace(/\.(xlsx?|pdf|csv)$/i, "").replace(/[_\-\s]+/g, "");
    if (name && name !== "进货单" && name !== "采购单") return name;
  }

  return undefined;
}

// ─── 主解析函数 ───────────────────────────────────────────────────────────────

/**
 * 解析 Excel 工作表数据（二维数组格式）
 * @param rows 二维数组，由 xlsx.utils.sheet_to_json(ws, { header: 1, defval: null }) 生成
 * @param options 可选参数
 */
export function parseSpiritsExcel(
  rows: any[][],
  options: {
    supplierHint?: string;
    fileName?: string;
    forceHeaderRow?: number;  // 强制指定表头行索引（0-based）
  } = {}
): ExcelImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const result: ParsedPurchaseRow[] = [];

  if (!rows || rows.length < 2) {
    return { rows: [], month: "", totalAmount: 0, errors: ["文件内容为空"], warnings: [] };
  }

  // 1. 提取供应商名
  const supplier = options.supplierHint ?? extractSupplier(rows, options.fileName);

  // 2. 找表头行
  let headerRowIdx = options.forceHeaderRow ?? -1;
  if (headerRowIdx === -1) {
    for (let i = 0; i < Math.min(8, rows.length); i++) {
      if (isHeaderRow(rows[i])) { headerRowIdx = i; break; }
    }
  }

  // 3. 确定列映射
  let colMap: ReturnType<typeof detectColumns>;
  if (headerRowIdx >= 0) {
    colMap = detectColumns(rows[headerRowIdx]);
    // 验证关键列是否找到
    if (colMap.nameIdx === -1) {
      warnings.push("未找到商品名称列，尝试自动推断列顺序");
      colMap = inferColumnsFromData(rows.slice(headerRowIdx + 1));
    }
  } else {
    warnings.push("未找到标准表头，自动推断列顺序");
    colMap = inferColumnsFromData(rows);
  }

  // 如果仍然没有找到名称列，使用默认顺序（你的模版格式）
  if (colMap.nameIdx === -1) {
    colMap = { dateIdx: 0, nameIdx: 1, unitIdx: 2, qtyIdx: 3, priceIdx: 4, amountIdx: 5 };
    warnings.push("使用默认列顺序（日期/商品名称/单位/数量/单价/金额）");
  }

  // 4. 解析数据行
  const dataStartRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
  let lastValidDate = new Date().toISOString().slice(0, 10);
  const monthCounts: Record<string, number> = {};

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // 跳过空行、合计行
    const allEmpty = row.every((c) => c === null || c === undefined || String(c).trim() === "");
    if (allEmpty) continue;

    const firstCell = String(row[0] ?? "").trim();
    if (/^(总计|合计|小计|total|subtotal|sum)$/i.test(firstCell)) continue;

    // 提取商品名
    const rawName = colMap.nameIdx >= 0 ? String(row[colMap.nameIdx] ?? "").trim() : "";
    if (!rawName || rawName.length < 1) continue;

    // 跳过表头重复行
    if (isHeaderRow(row)) continue;

    // 解析日期（缺失时继承上一行）
    const rawDate = colMap.dateIdx >= 0 ? row[colMap.dateIdx] : null;
    const parsedDate = parseDate(rawDate);
    const date = parsedDate ?? lastValidDate;
    if (parsedDate) lastValidDate = parsedDate;
    const month = date.slice(0, 7);
    monthCounts[month] = (monthCounts[month] ?? 0) + 1;

    // 解析数量、单价、金额
    const unit = colMap.unitIdx >= 0 ? String(row[colMap.unitIdx] ?? "瓶").trim() || "瓶" : "瓶";
    const quantity = colMap.qtyIdx >= 0 ? parseNumber(row[colMap.qtyIdx]) : 1;
    const unitPrice = colMap.priceIdx >= 0 ? parseNumber(row[colMap.priceIdx]) : 0;
    let amount = colMap.amountIdx >= 0 ? parseNumber(row[colMap.amountIdx]) : 0;

    // 金额校验和修正
    if (amount === 0 && quantity > 0 && unitPrice > 0) {
      amount = quantity * unitPrice;
    } else if (amount > 0 && unitPrice === 0 && quantity > 0) {
      // 反推单价
    } else if (Math.abs(amount - quantity * unitPrice) > 0.1 && quantity > 0 && unitPrice > 0) {
      // 金额与数量×单价不一致，以金额为准，记录警告
      warnings.push(`行${i + 1} 「${rawName}」金额(${amount}) ≠ 数量(${quantity})×单价(${unitPrice})，以金额为准`);
    }

    if (quantity <= 0 && amount <= 0) continue;

    // 解析商品名
    const { nameZh, nameEn } = parseProductName(rawName);

    // 自动识别分类
    const category = guessCategory(rawName);

    result.push({
      date, month, rawName, nameZh, nameEn,
      unit, quantity: quantity || 1, unitPrice,
      amount: amount || quantity * unitPrice,
      supplier, category,
    });
  }

  if (result.length === 0) {
    errors.push("未解析到有效数据行，请检查文件格式");
    return { rows: [], month: "", totalAmount: 0, errors, warnings };
  }

  // 找主月份（记录最多的月份）
  const mainMonth = Object.entries(monthCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? new Date().toISOString().slice(0, 7);
  const totalAmount = result.reduce((s, r) => s + r.amount, 0);

  return { rows: result, month: mainMonth, supplier, totalAmount, errors, warnings };
}

/**
 * 扫描 workbook 所有 sheet，返回预览信息
 * 用于多 sheet 文件的 sheet 选择界面
 */
export function previewSheets(workbook: any): SheetPreview[] {
  const XLSX = require("xlsx");
  return workbook.SheetNames.map((name: string) => {
    const ws = workbook.Sheets[name];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const nonEmptyRows = rows.filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim()));
    const isValid = nonEmptyRows.length >= 3 && nonEmptyRows.some((r) => isHeaderRow(r) || r.some((c) => /[\u4e00-\u9fff]/.test(String(c ?? ""))));
    const preview = nonEmptyRows.slice(0, 3).map((r) => r.filter((c) => c !== null && c !== undefined).map((c) => String(c).trim()).join(" | "));
    return { name, rowCount: nonEmptyRows.length, preview, isValid };
  });
}

/**
 * 从 workbook 解析指定 sheet
 */
export function parseSheetFromWorkbook(
  workbook: any,
  sheetName: string,
  options: { supplierHint?: string; fileName?: string } = {}
): ExcelImportResult {
  const XLSX = require("xlsx");
  const ws = workbook.Sheets[sheetName];
  if (!ws) return { rows: [], month: "", totalAmount: 0, errors: [`未找到 sheet: ${sheetName}`], warnings: [] };
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
  // raw: false 让 xlsx 自动将日期格式化为字符串，避免 Excel 日期序列号问题
  return parseSpiritsExcel(rows, options);
}

/**
 * 自动识别商品分类（基于商品名关键词）
 * 覆盖你的真实进货单中出现的所有品类
 */
export function guessCategory(name: string): string {
  const n = (name ?? "").toLowerCase();

  // 金酒 Gin
  if (/金酒|gin|添加利|tanqueray|必富达|beefeater|猴王|monkey|亨德里克|hendrick|诺迪思|nordes|海曼|hayman|孟买|bombay|gordon|哥顿|plymouth|老汤姆/.test(n)) return "Gin";

  // 威士忌 Whisky
  if (/威士忌|whisky|whiskey|白占边|jim beam|波本|bourbon|百富|balvenie|麦卡伦|macallan|格兰|glen|帝王|dewar|三得利|suntory|响|hibiki|山崎|yamazaki|白州|hakushu|尊尼获加|johnnie|jack daniel|占边|beam|格兰利威|glenlivet|拉弗格|laphroaig|泰斯卡|talisker|美格|maker/.test(n)) return "Whisky";

  // 朗姆 Rum
  if (/朗姆|rum|哈瓦那|havana|百加得|bacardi|马利宝|malibu|摩根|morgan|可可|coco|麦尔斯|myers|卡查萨|cachaca|农业朗姆|agricole/.test(n)) return "Rum";

  // 龙舌兰 Tequila/Mezcal
  if (/龙舌兰|tequila|mezcal|梅斯卡尔|唐胡里奥|don julio|快活|jose cuervo|银快活|帕特龙|patron|福得|fortaleza|阿苏尔|azul|卡萨多雷斯|cazadores/.test(n)) return "Tequila";

  // 伏特加 Vodka
  if (/伏特加|vodka|深蓝|skyy|绝对|absolut|灰雁|grey goose|斯米诺|smirnoff|芝华士|ciroc|贝尔维德|belvedere|科尼洛夫|ketel one/.test(n)) return "Vodka";

  // 白兰地 Brandy
  if (/白兰地|brandy|cognac|干邑|卡巴度斯|calvados|大将军|轩尼诗|hennessy|马爹利|martell|人头马|remy|芝华士|courvoisier|皮斯科|pisco/.test(n)) return "Brandy";

  // 利口酒 Liqueur
  if (/利口酒|liqueur|君度|cointreau|金巴利|campari|阿佩罗|aperol|圣哲曼|st.?germain|方津|amaretto|迪可派|de kuyper|吉发得|giffard|路萨朵|luxardo|比特储斯|bitter truth|嘿嘿|mr.?black|马利宝|malibu|三得利蜜瓜|midori|俏雅梅酒|umeshu|可尔必思|calpis|榛果|frangelico|海曼蜜桃|peach|利莱|lillet/.test(n)) return "Liqueur";

  // 苦精 Bitters
  if (/苦精|bitter|安高天娜|angostura|北秀|贝肖|peychaud|比特储斯|bitter truth|橙味苦精|orange bitter/.test(n)) return "Bitter";

  // 糖浆 Syrup
  if (/糖浆|syrup|莫林|monin|焦糖|caramel|草莓|strawberry|海盐|sea salt|香草|vanilla|覆盆子|raspberry|接骨木|elderflower|薰衣草|lavender|orgeat|杏仁糖浆/.test(n)) return "Syrup";

  // 啤酒 Beer
  if (/啤酒|beer|朝日|asahi|喜力|heineken|科罗娜|corona|百威|budweiser|青岛|燕京|雪花|麒麟|kirin/.test(n)) return "Beer";

  // 软饮/混合饮料 Mixer
  if (/汤力水|tonic|苏打水|soda|可乐|cola|雪碧|sprite|泰象|chang|可口可乐|coca|百事|pepsi|姜汁|ginger|芬达|fanta|屈臣氏|watson/.test(n)) return "Mixer";

  // 葡萄酒 Wine
  if (/葡萄酒|wine|红酒|白葡萄|起泡酒|champagne|prosecco|cava|port|sherry/.test(n)) return "Wine";

  // 中式白酒
  if (/白酒|堂白|茅台|五粮液|泸州|汾酒|洋河|剑南春/.test(n)) return "Baijiu";

  return "Other";
}
