/**
 * 离线酒款知识库查询工具
 *
 * 当网络不可用或 AI 调用失败时，从内置静态知识库中模糊匹配酒款信息。
 * 同时支持从用户书库的章节文本中提取相关段落作为补充。
 */

import offlineKbRaw from "./offline-kb.json";

// ── TF-IDF 向量语义搜索 ──────────────────────────────────────────────────────

/**
 * 中英文语义同义词词典：将用户输入的语义词映射到知识库中的关键词
 * 支持跨语言匹配（如"苦味调味剂" → "苦精"，"bitter" → "苦精"）
 */
const SEMANTIC_SYNONYMS: Record<string, string[]> = {
  // 苦精类
  "苦精": ["bitters", "bitter", "angostura", "安格式", "苦味", "苦味调味剂", "aromatic bitters", "orange bitters"],
  "安格式苦精": ["angostura", "angostura bitters", "安格式", "aromatic bitters"],
  // 威士忌类
  "威士忌": ["whisky", "whiskey", "scotch", "bourbon", "rye", "single malt", "blended", "苏格兰威士忌", "波本"],
  "苏格兰威士忌": ["scotch", "scotch whisky", "single malt scotch", "blended scotch"],
  "波本威士忌": ["bourbon", "bourbon whiskey", "kentucky", "straight bourbon"],
  // 金酒类
  "金酒": ["gin", "london dry", "genever", "老汤姆", "old tom", "杜松子酒"],
  // 朗姆类
  "朗姆": ["rum", "rhum", "ron", "agricole", "cachaça", "卡沙萨"],
  // 龙舌兰类
  "龙舌兰": ["tequila", "mezcal", "agave", "sotol", "梅斯卡尔"],
  // 白兰地类
  "白兰地": ["brandy", "cognac", "armagnac", "calvados", "pisco", "干邑", "雅文邑"],
  "干邑": ["cognac", "cognac vsop", "cognac xo", "cognac vs"],
  // 利口酒类
  "利口酒": ["liqueur", "triple sec", "cointreau", "chartreuse", "campari", "aperol"],
  "橙味利口酒": ["triple sec", "cointreau", "grand marnier", "orange liqueur", "curacao"],
  // 味美思类
  "味美思": ["vermouth", "dry vermouth", "sweet vermouth", "blanc vermouth", "苦艾酒"],
  // 开胃酒类
  "开胃酒": ["aperitif", "amaro", "campari", "aperol", "cynar", "fernet", "苦艾"],
  // 伏特加类
  "伏特加": ["vodka", "vodka wheat", "vodka rye", "vodka potato"],
  // 其他
  "清酒": ["sake", "junmai", "ginjo", "daiginjo", "nigori"],
  "烧酒": ["shochu", "soju", "mugi shochu", "imo shochu"],
  "中式白酒": ["baijiu", "maotai", "moutai", "酱香", "浓香", "清香"],
};

/** 将文本分词为 token 数组（支持中英文混合） */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase().trim();
  // 英文：按空格/标点分词
  const words = lower.split(/[\s\-·•·,，。、！!？?\/\\()（）\[\]【】]+/).filter((w) => w.length >= 2);
  // 中文：提取 2-4 字 n-gram
  const cjkNgrams: string[] = [];
  const cjk = lower.replace(/[^\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    cjkNgrams.push(cjk.slice(i, i + 2));
    if (i < cjk.length - 2) cjkNgrams.push(cjk.slice(i, i + 3));
  }
  return [...new Set([...words, ...cjkNgrams])];
}

/** 构建 TF-IDF 向量索引（启动时懒加载，一次性计算） */
interface TfIdfIndex {
  vectors: Map<number, Map<string, number>>;  // entryIdx → term → tfidf
  idf: Map<string, number>;                   // term → idf
  terms: Set<string>;
}

let _tfidfIndex: TfIdfIndex | null = null;

function buildTfIdfIndex(): TfIdfIndex {
  if (_tfidfIndex) return _tfidfIndex;

  const N = OFFLINE_KB.length;
  // 每个条目的文档文本（名称 + 分类 + 风味标签 + 故事摘要 + 同义词扩展）
  const docs: string[][] = OFFLINE_KB.map((entry) => {
    const synonymExpansion: string[] = [];
    // 查找该条目名称在同义词词典中的扩展词
    for (const [key, syns] of Object.entries(SEMANTIC_SYNONYMS)) {
      const entryText = `${entry.nameZh} ${entry.nameEn} ${entry.category}`.toLowerCase();
      if (entryText.includes(key.toLowerCase()) || syns.some((s) => entryText.includes(s.toLowerCase()))) {
        synonymExpansion.push(key, ...syns);
      }
    }
    const text = [
      entry.nameZh, entry.nameEn, entry.category, entry.style, entry.brand,
      entry.origin, ...(entry.flavorTags || []),
      entry.story?.slice(0, 100) || "",
      ...synonymExpansion,
    ].join(" ");
    return tokenize(text);
  });

  // 计算 IDF
  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const term of seen) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, count] of df.entries()) {
    idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
  }

  // 计算 TF-IDF 向量
  const vectors = new Map<number, Map<string, number>>();
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const tf = new Map<string, number>();
    for (const term of doc) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }
    const vec = new Map<string, number>();
    for (const [term, count] of tf.entries()) {
      const tfidf = (count / doc.length) * (idf.get(term) || 1);
      vec.set(term, tfidf);
    }
    vectors.set(i, vec);
  }

  _tfidfIndex = { vectors, idf, terms: new Set(df.keys()) };
  return _tfidfIndex;
}

/** 余弦相似度计算 */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  for (const [term, val] of a.entries()) {
    dot += val * (b.get(term) || 0);
    normA += val * val;
  }
  for (const val of b.values()) {
    normB += val * val;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 语义搜索：使用 TF-IDF 向量相似度在离线知识库中查找最匹配的酒款
 * 支持跨语言语义匹配（"苦味调味剂" → "苦精"，"Angostura" ↔ "安格式苦精"）
 */
export function semanticSearchOfflineKb(query: string, topK = 5): Array<{ entry: OfflineBottleEntry; score: number }> {
  if (!query || query.trim().length < 2) return [];

  // 扩展查询词（同义词扩展）
  const expandedQuery = [query];
  const queryLower = query.toLowerCase();
  for (const [key, syns] of Object.entries(SEMANTIC_SYNONYMS)) {
    if (queryLower.includes(key.toLowerCase()) || syns.some((s) => queryLower.includes(s.toLowerCase()))) {
      expandedQuery.push(key, ...syns);
    }
  }
  const queryTokens = tokenize(expandedQuery.join(" "));

  const index = buildTfIdfIndex();

  // 构建查询向量
  const queryTf = new Map<string, number>();
  for (const term of queryTokens) {
    queryTf.set(term, (queryTf.get(term) || 0) + 1);
  }
  const queryVec = new Map<string, number>();
  for (const [term, count] of queryTf.entries()) {
    const idfVal = index.idf.get(term) || 0.5; // 未知词给低权重
    queryVec.set(term, (count / queryTokens.length) * idfVal);
  }

  // 计算与每个条目的余弦相似度
  const scores: Array<{ idx: number; score: number }> = [];
  for (let i = 0; i < OFFLINE_KB.length; i++) {
    const vec = index.vectors.get(i);
    if (!vec) continue;
    const score = cosineSimilarity(queryVec, vec);
    if (score > 0.05) {
      scores.push({ idx: i, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK).map(({ idx, score }) => ({
    entry: OFFLINE_KB[idx],
    score: Math.round(score * 100),
  }));
}

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

  // ── 关键词匹配失败，回退到 TF-IDF 语义搜索 ──────────────────────────────
  const queryText = [nameZh, nameEn, brand, category].filter(Boolean).join(" ");
  const semanticResults = semanticSearchOfflineKb(queryText, 1);
  if (semanticResults.length > 0 && semanticResults[0].score >= 30) {
    return {
      found: true,
      source: "offline_kb",
      score: semanticResults[0].score,
      entry: semanticResults[0].entry,
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
    notesEn: "",
    storyEn: "",
    substituteFor: "",
    pairsWith: "",
  };
}
