/**
 * 离线资料回退工具。
 *
 * 发布包不得携带用户提供或测试用的业务酒库资料。网络不可用时，
 * 本模块只允许检索用户主动导入的书库文本；不会以任何内嵌酒款资料填充业务数据。
 */

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

export interface OfflineLookupResult {
  found: boolean;
  source: "offline_kb" | "book_text" | "none";
  score: number;
  entry: OfflineBottleEntry | null;
  bookSnippets: string[];
}

/**
 * 生产版本不包含离线业务酒库。保留函数签名，确保联网失败时安全回退而非注入示例数据。
 */
export function semanticSearchOfflineKb(_query: string, _topK = 5): Array<{ entry: OfflineBottleEntry; score: number }> {
  return [];
}

/**
 * 生产版本不从安装包提供酒款匹配数据；仅返回未命中，调用方可继续使用用户书库或联网检索。
 */
export function lookupInOfflineKb(_params: {
  nameZh?: string;
  nameEn?: string;
  brand?: string;
  category?: string;
}): OfflineLookupResult {
  return { found: false, source: "none", score: 0, entry: null, bookSnippets: [] };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\-·•,，。、！!？?]/g, "");
}

/**
 * 从用户主动导入的书库章节中提取最相关段落；该输入不来自 App 安装包。
 */
export function extractBookSnippets(params: {
  nameZh?: string;
  nameEn?: string;
  brand?: string;
  bookSections: { title: string; text: string }[];
}): string[] {
  const keywords = [params.nameZh, params.nameEn, params.brand]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalize);
  if (keywords.length === 0 || params.bookSections.length === 0) return [];

  const matches: Array<{ text: string; score: number }> = [];
  for (const section of params.bookSections) {
    for (const paragraph of section.text.split(/\n{2,}|\r\n{2,}/)) {
      const source = paragraph.trim();
      if (source.length < 20) continue;
      const normalized = normalize(source);
      const score = keywords.reduce((total, keyword) => total + (normalized.includes(keyword) ? keyword.length * 10 : 0), 0);
      if (score > 0) matches.push({ text: source.slice(0, 200) + (source.length > 200 ? "…" : ""), score });
    }
  }

  return matches
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((match) => match.text);
}

/** 将用户主动取得的酒款资料转换为现有富化结果格式。 */
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
