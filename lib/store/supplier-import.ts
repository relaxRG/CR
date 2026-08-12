/**
 * 供应商 Excel 导入解析器
 * - 支持「上海创略商贸」格式（行号/日期/单号/商品名/规格/数量/单价/金额）
 * - 中英文智能拆分：保留品牌名、完整中文名，英文作为副名
 * - 高精度模糊匹配：跨导入记忆 + 多策略评分
 * - 匹配置信度标注：高(≥80) / 中(50-79) / 低(<50)
 */
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as XLSX from "xlsx";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FoodIngredient, SupplierPurchaseItem } from "@/lib/food/types";
import { normalizeImportDate } from "@/lib/import/date-utils";

// ─── 常量 ─────────────────────────────────────────────────────────────────────

/** 匹配记忆 key：rawName → ingredientId，跨导入持久化 */
const MATCH_MEMORY_KEY = "supplier.match.memory.v1";

/** 置信度等级 */
export type MatchConfidence = "high" | "medium" | "low" | "none";

export function getConfidence(score: number): MatchConfidence {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  if (score >= 25) return "low";
  return "none";
}

export const CONFIDENCE_LABELS: Record<MatchConfidence, string> = {
  high: "高置信",
  medium: "中置信",
  low: "低置信",
  none: "未匹配",
};

export const CONFIDENCE_COLORS: Record<MatchConfidence, string> = {
  high: "#22C55E",
  medium: "#F59E0B",
  low: "#EF4444",
  none: "#9BA1A6",
};

// ─── 中英文拆分 ───────────────────────────────────────────────────────────────

export interface SplitName {
  zhName: string;    // 完整中文名（含品牌）
  enName: string;    // 英文名（含品牌英文）
  spec: string;      // 规格信息（如 1KG、250ml、100克）
  displayName: string; // 最终展示名（中文优先）
}

/**
 * 智能拆分商品名称：中英文分离，保留品牌名，提取规格
 * 示例：
 *   "雀巢牛奶 餐饮专供Nestle Milk" → { zh:"雀巢牛奶 餐饮专供", en:"Nestle Milk", spec:"" }
 *   "小盒装淡奶油250ml Cream"       → { zh:"小盒装淡奶油", en:"Cream", spec:"250ml" }
 *   "柿子米小种花生芥末味Snack Peanut Wasabi (1KG)" → { zh:"柿子米小种花生芥末味", en:"Snack Peanut Wasabi", spec:"1KG" }
 */
export function splitProductName(raw: string): SplitName {
  let s = raw.trim();

  // 1. 提取括号内规格（半角/全角）
  const specParts: string[] = [];
  // 全角括号内英文/数字（如 （1KG））
  s = s.replace(/（([A-Za-z0-9\s.]+)）/g, (_, p) => { specParts.push(p.trim()); return ""; });
  // 半角括号内规格（如 (1KG)）
  s = s.replace(/\(([A-Za-z0-9\s.]+)\)/g, (_, p) => { specParts.push(p.trim()); return ""; });

  // 2. 提取内嵌规格数字（如 250ml、100克、50克）
  const inlineSpec = s.match(/\d+(?:\.\d+)?(?:ml|ML|g|G|kg|KG|克|升|L|l)\b/g) ?? [];
  // 不从名称中移除，保留在中文名里（如"莳萝草100克"）

  // 3. 分离英文段（连续英文字母，至少2字符）
  // 注意：单独的 ml/g 等单位不算英文名
  const enSegments: string[] = [];
  // 先把 "单个价格" 这类纯中文描述性词去掉（不影响匹配）
  const cleaned = s.replace(/单个价格|餐饮专供/g, "");

  // 找英文段（至少2个字母，允许内部空格）
  const enPattern = /[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*/g;
  let enMatch: RegExpExecArray | null;
  while ((enMatch = enPattern.exec(cleaned)) !== null) {
    const seg = enMatch[0].trim();
    // 过滤纯单位词
    if (!/^(ml|kg|g|l|oz)$/i.test(seg)) {
      enSegments.push(seg);
    }
  }

  // 4. 去掉英文段后得到中文名
  let zhPart = cleaned;
  for (const seg of enSegments) {
    zhPart = zhPart.replace(seg, "");
  }
  // 清理残留空格、标点
  zhPart = zhPart.replace(/\s+/g, " ").replace(/^\s*[\s·\-]+|[\s·\-]+\s*$/g, "").trim();

  const enName = enSegments.join(" ").trim();
  const spec = [...specParts, ...inlineSpec.filter((s2) => !specParts.includes(s2))].join(" ").trim();

  // 5. displayName：优先中文，无中文则用英文
  const displayName = zhPart || enName || raw;

  return { zhName: zhPart, enName, spec, displayName };
}

// ─── 匹配记忆（跨导入持久化）────────────────────────────────────────────────

/** 读取匹配记忆 */
export async function loadMatchMemory(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(MATCH_MEMORY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 保存匹配记忆（rawName → ingredientId） */
export async function saveMatchMemory(memory: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(MATCH_MEMORY_KEY, JSON.stringify(memory));
}

/** 更新单条记忆 */
export async function rememberMatch(rawName: string, ingredientId: string): Promise<void> {
  const mem = await loadMatchMemory();
  mem[rawName] = ingredientId;
  await saveMatchMemory(mem);
}

// ─── 模糊匹配引擎 ─────────────────────────────────────────────────────────────

/** 归一化字符串：小写、去空格、去标点 */
function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[（）()\[\]【】\s\-_·。，、！？]/g, "")
    .replace(/进口|新鲜|单个价格|餐饮专供|小盒装|水果/g, "");
}

/** 计算两个字符串的字符重叠率（Jaccard on bigrams） */
function bigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  ba.forEach((g) => { if (bb.has(g)) inter++; });
  return (2 * inter) / (ba.size + bb.size);
}

/** 关键词包含匹配：检查 query 的关键词是否都出现在 target 中 */
function keywordContains(query: string, target: string): number {
  const qWords = query.split(/\s+/).filter((w) => w.length >= 2);
  if (qWords.length === 0) return 0;
  const hits = qWords.filter((w) => target.includes(w)).length;
  return hits / qWords.length;
}

export interface MatchResult {
  ingredient: FoodIngredient | null;
  score: number;           // 0-100
  confidence: MatchConfidence;
  isMemorized: boolean;    // 来自跨导入记忆
  matchReason: string;     // 匹配原因描述
}

/**
 * 核心匹配函数：给定原始商品名，从 ingredients 库中找最佳匹配
 * 策略（按优先级）：
 * 1. 跨导入记忆（精确，score=100）
 * 2. 精确名称匹配（score=95）
 * 3. 中文名精确匹配（score=90）
 * 4. 归一化后精确匹配（score=85）
 * 5. 关键词全命中（score=75）
 * 6. Bigram 相似度（score=相似度*70）
 * 7. 英文名匹配（score=60）
 */
export function matchIngredient(
  rawName: string,
  split: SplitName,
  ingredients: FoodIngredient[],
  memory: Record<string, string>
): MatchResult {
  // 策略1：跨导入记忆
  if (memory[rawName]) {
    const found = ingredients.find((i) => i.id === memory[rawName]);
    if (found) {
      return { ingredient: found, score: 100, confidence: "high", isMemorized: true, matchReason: "记忆匹配" };
    }
  }

  const rawNorm = normalize(rawName);
  const zhNorm = normalize(split.zhName);
  const enNorm = split.enName.toLowerCase().replace(/\s+/g, "");

  let best: MatchResult = { ingredient: null, score: 0, confidence: "none", isMemorized: false, matchReason: "未匹配" };

  for (const ing of ingredients) {
    const ingNorm = normalize(ing.name);
    let score = 0;
    let reason = "";

    // 策略2：精确匹配
    if (ing.name === rawName) { score = 95; reason = "名称完全匹配"; }
    // 策略3：中文名精确匹配
    else if (split.zhName && ing.name === split.zhName) { score = 90; reason = "中文名精确匹配"; }
    // 策略4：归一化精确匹配
    else if (ingNorm === rawNorm || ingNorm === zhNorm) { score = 85; reason = "归一化精确匹配"; }
    // 策略5：关键词全命中
    else {
      const kwScore = keywordContains(zhNorm, ingNorm);
      const kwScoreRev = keywordContains(ingNorm, zhNorm);
      const kwBest = Math.max(kwScore, kwScoreRev);
      if (kwBest === 1.0) { score = 75; reason = "关键词全命中"; }
      else if (kwBest >= 0.6) { score = Math.round(kwBest * 65); reason = `关键词部分命中(${Math.round(kwBest * 100)}%)`; }
      else {
        // 策略6：Bigram 相似度
        const bgZh = bigramSimilarity(zhNorm, ingNorm);
        const bgRaw = bigramSimilarity(rawNorm, ingNorm);
        const bg = Math.max(bgZh, bgRaw);
        if (bg > 0.3) { score = Math.round(bg * 70); reason = `字形相似(${Math.round(bg * 100)}%)`; }
        // 策略7：英文名匹配
        else if (enNorm && ing.name.toLowerCase().replace(/\s+/g, "").includes(enNorm)) {
          score = 60; reason = "英文名匹配";
        } else if (enNorm) {
          const bgEn = bigramSimilarity(enNorm, normalize(ing.name));
          if (bgEn > 0.4) { score = Math.round(bgEn * 55); reason = `英文相似(${Math.round(bgEn * 100)}%)`; }
        }
      }
    }

    if (score > best.score) {
      best = { ingredient: ing, score, confidence: getConfidence(score), isMemorized: false, matchReason: reason };
    }
  }

  return best;
}

// ─── Excel 解析（创略商贸格式）────────────────────────────────────────────────

export interface ParsedRow {
  rowNo: number;
  date: string;
  orderNo: string;
  rawName: string;
  split: SplitName;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface SupplierImportPreview {
  supplierName: string;
  periodLabel: string;
  rows: ParsedRow[];
  /** 聚合后每个商品最新单价（同名取最后一次） */
  latestPrices: Record<string, number>;
  totalAmount: number;
}

/** 选择并解析创略商贸 Excel 文件 */
export async function parseSupplierExcel(): Promise<SupplierImportPreview | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "*/*",
    ],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;

  const uri = result.assets[0].uri;
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    throw new Error("无法读取文件，请确认文件权限");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(base64, { type: "base64" });
  } catch {
    throw new Error("文件格式不支持，请使用 .xlsx 文件");
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel 文件为空");
  const sheet = workbook.Sheets[sheetName];
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  // 自动识别列头行（含"商品名称"的行）
  let headerRowIdx = -1;
  let supplierName = "上海创略商贸";
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const row = allRows[i] as string[];
    const joined = row.join("");
    if (joined.includes("商品名称") || joined.includes("品名")) {
      headerRowIdx = i;
    }
    if (joined.includes("往来单位") || joined.includes("供应商")) {
      const labelIndex = row.findIndex((cell) => String(cell ?? "").includes("往来单位") || String(cell ?? "").includes("供应商"));
      const nameCell = labelIndex >= 0
        ? row.slice(labelIndex + 1).find((cell) => String(cell ?? "").trim())
        : undefined;
      if (nameCell) supplierName = String(nameCell).trim();
    }
  }
  if (headerRowIdx < 0) headerRowIdx = 2; // 默认第3行为列头

  const header = (allRows[headerRowIdx] as string[]).map((h) => String(h).trim());
  const colIdx = {
    no: header.findIndex((h) => h === "行号" || h === "序号"),
    date: header.findIndex((h) => h.includes("日期")),
    orderNo: header.findIndex((h) => h.includes("单据编号") || h.includes("单号")),
    name: header.findIndex((h) => h.includes("商品名称") || h.includes("品名")),
    unit: header.findIndex((h) => h === "规格" || h === "单位"),
    qty: header.findIndex((h) => h.includes("数量")),
    price: header.findIndex((h) => h.includes("单价")),
    amount: header.findIndex((h) => h.includes("金额")),
  };

  const rows: ParsedRow[] = [];
  const latestPrices: Record<string, number> = {};
  let totalAmount = 0;
  let lastValidDate = "";

  for (let i = headerRowIdx + 1; i < allRows.length; i++) {
    const row = allRows[i] as unknown[];
    const rawName = colIdx.name >= 0 ? String(row[colIdx.name] ?? "").trim() : "";
    if (!rawName) continue;
    const qty = colIdx.qty >= 0 ? Number(row[colIdx.qty]) || 0 : 0;
    const price = colIdx.price >= 0 ? Number(row[colIdx.price]) || 0 : 0;
    const amount = colIdx.amount >= 0 ? Number(row[colIdx.amount]) || (qty * price) : qty * price;
    if (!rawName || (qty === 0 && price === 0)) continue;

    const split = splitProductName(rawName);
    const rawDate = colIdx.date >= 0 ? row[colIdx.date] : null;
    const parsedDate = normalizeImportDate(rawDate);
    const hasDateValue = rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== "";
    if (hasDateValue && !parsedDate) continue;
    const date = parsedDate ?? lastValidDate;
    if (!date) continue;
    if (parsedDate) lastValidDate = parsedDate;
    const orderNo = colIdx.orderNo >= 0 ? String(row[colIdx.orderNo] ?? "").trim() : "";
    const unit = colIdx.unit >= 0 ? String(row[colIdx.unit] ?? "").trim() : "";

    rows.push({
      rowNo: colIdx.no >= 0 ? Number(row[colIdx.no]) || i : i,
      date, orderNo, rawName, split, unit, quantity: qty, unitPrice: price, amount,
    });
    latestPrices[rawName] = price;
    totalAmount += amount;
  }

  // 推断账期
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  let periodLabel = "未知账期";
  if (dates.length > 0) {
    const first = dates[0];
    const m = first.match(/^(\d{4})-(\d{2})/);
    if (m) {
      const monthNames = ["一","二","三","四","五","六","七","八","九","十","十一","十二"];
      periodLabel = `${m[1]}年${monthNames[parseInt(m[2]) - 1]}月`;
    }
  }

  return { supplierName, periodLabel, rows, latestPrices, totalAmount };
}
