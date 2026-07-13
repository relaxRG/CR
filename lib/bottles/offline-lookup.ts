/**
 * 离线酒款知识库查询工具
 *
 * 当网络不可用或 AI 调用失败时，从内置静态知识库中模糊匹配酒款信息。
 * 同时支持从用户书库的章节文本中提取相关段落作为补充。
 */

import offlineKbRaw from "./offline-kb.json";

export interface OfflineBottleEntry {
  nameZh: string;
  nameEn: string;
  category: string;
  style: string;
  brand: string;
  origin: string;
  abv: number;
  priceCny: number;
  notes: string;
  flavorTags: string[];
  story: string;
  confidence: "high" | "medium" | "low";
}

const OFFLINE_KB: OfflineBottleEntry[] = offlineKbRaw as OfflineBottleEntry[];

/**
 * 标准化字符串用于比较：转小写、去除空格和标点
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\-·•·,，。、！!？?]/g, "");
}

/**
 * 计算两个字符串的相似度分数（0-100）
 * 基于字符级别的包含关系和公共子串
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 85;
  // 检查是否有足够长的公共子串
  const minLen = Math.min(na.length, nb.length);
  if (minLen < 2) return 0;
  let maxCommon = 0;
  for (let i = 0; i < na.length; i++) {
    for (let j = i + 2; j <= na.length; j++) {
      const sub = na.slice(i, j);
      if (nb.includes(sub) && sub.length > maxCommon) {
        maxCommon = sub.length;
      }
    }
  }
  return Math.round((maxCommon / Math.max(na.length, nb.length)) * 70);
}

export interface OfflineLookupResult {
  found: boolean;
  source: "offline_kb" | "book_text" | "none";
  score: number;
  entry: OfflineBottleEntry | null;
  bookSnippets: string[];
}

/**
 * 在离线知识库中查找最匹配的酒款
 */
export function lookupInOfflineKb(params: {
  nameZh?: string;
  nameEn?: string;
  brand?: string;
  category?: string;
}): OfflineLookupResult {
  const { nameZh = "", nameEn = "", brand = "", category = "" } = params;
  if (!nameZh && !nameEn && !brand) {
    return { found: false, source: "none", score: 0, entry: null, bookSnippets: [] };
  }

  let bestScore = 0;
  let bestEntry: OfflineBottleEntry | null = null;

  for (const entry of OFFLINE_KB) {
    let score = 0;

    // 中文名匹配（权重最高）
    if (nameZh) {
      const s = similarity(nameZh, entry.nameZh);
      score = Math.max(score, s * 1.2);
    }
    // 英文名匹配
    if (nameEn) {
      const s = similarity(nameEn, entry.nameEn);
      score = Math.max(score, s);
    }
    // 品牌名匹配（加分项）
    if (brand && entry.brand) {
      const s = similarity(brand, entry.brand);
      if (s > 60) score += s * 0.3;
    }
    // 分类匹配（加分项）
    if (category && entry.category === category) {
      score += 10;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  // 阈值：分数 >= 60 才认为匹配成功
  if (bestScore >= 60 && bestEntry) {
    return {
      found: true,
      source: "offline_kb",
      score: Math.min(100, Math.round(bestScore)),
      entry: bestEntry,
      bookSnippets: [],
    };
  }

  return { found: false, source: "none", score: 0, entry: null, bookSnippets: [] };
}

/**
 * 从书库章节文本中提取包含酒款名称的相关段落
 * 返回最多 3 个最相关的文本片段（每段 200 字以内）
 */
export function extractBookSnippets(params: {
  nameZh?: string;
  nameEn?: string;
  brand?: string;
  bookSections: { title: string; text: string }[];
}): string[] {
  const { nameZh = "", nameEn = "", brand = "", bookSections } = params;
  const keywords = [nameZh, nameEn, brand].filter(Boolean).map(normalize);
  if (keywords.length === 0 || bookSections.length === 0) return [];

  const snippets: { text: string; score: number }[] = [];

  for (const section of bookSections) {
    const text = section.text;
    if (!text || text.length < 10) continue;

    // 按段落分割
    const paragraphs = text.split(/\n{2,}|\r\n{2,}/).filter((p) => p.trim().length > 20);

    for (const para of paragraphs) {
      const normPara = normalize(para);
      let score = 0;
      for (const kw of keywords) {
        if (kw.length >= 2 && normPara.includes(kw)) {
          score += kw.length * 10;
        }
      }
      if (score > 0) {
        // 截取最相关的 200 字
        const trimmed = para.trim().slice(0, 200) + (para.length > 200 ? "…" : "");
        snippets.push({ text: trimmed, score });
      }
    }
  }

  // 按分数排序，取前 3 个
  snippets.sort((a, b) => b.score - a.score);
  return snippets.slice(0, 3).map((s) => s.text);
}

/**
 * 将离线知识库条目转换为与 enrichBottleFull 返回值相同的格式
 */
export function offlineEntryToEnrichResult(entry: OfflineBottleEntry, bookSnippets: string[] = []) {
  const snippetNote = bookSnippets.length > 0
    ? `\n\n📚 书库相关段落：${bookSnippets.slice(0, 2).join(" | ")}`
    : "";
  return {
    found: true,
    nameZh: entry.nameZh,
    nameEn: entry.nameEn,
    category: entry.category,
    style: entry.style,
    brand: entry.brand,
    origin: entry.origin,
    volume: "",
    abv: entry.abv,
    priceCny: entry.priceCny,
    notes: entry.notes + snippetNote,
    flavorTags: entry.flavorTags,
    story: entry.story,
    styleDesc: "",
    distilleryInfo: "",
    pairingNotes: "",
    usageNotes: "",
    seasonality: "",
    confidence: entry.confidence,
  };
}
