// Homemade preps library: syrups, infusions, cordials, batches, etc.
// English-first design with Chinese translations.

/** 自制库顶层分组:含酒精 / 无酒精(类似酒库的基酒库/酒款库/原材料库) */
export type PrepGroup = "alcoholic" | "non_alcoholic";

export const PREP_GROUPS: { key: PrepGroup; en: string; zh: string }[] = [
  { key: "alcoholic", en: "Alcoholic Preps", zh: "含酒精自制" },
  { key: "non_alcoholic", en: "Zero-Proof Preps", zh: "无酒精自制" },
];

export function prepGroupLabel(key: string, lang: "zh" | "en"): string {
  const g = PREP_GROUPS.find((x) => x.key === key);
  if (!g) return key;
  return lang === "en" ? g.en : g.zh;
}

export interface HomemadePrep {
  id: string;
  /** Primary display name (English-first) */
  name: string;
  /** Alt name / translation (e.g. Chinese) */
  nameAlt: string;
  /** Type key, see PREP_TYPES */
  type: string;
  /**
   * 酒精属性分组覆盖:null 表示跟随类型/分区推断结果,
   * 显式设置后优先生效(用户可手动调整)。
   */
  abvGroup: PrepGroup | null;
  /** Ingredient list, one per line or comma separated */
  ingredients: string[];
  /** Recipe / method free text */
  recipe: string;
  /** e.g. "~750ml" */
  yield: string;
  /** e.g. "2 weeks refrigerated" */
  shelfLife: string;
  /** e.g. "Refrigerate in sealed bottle" */
  storage: string;
  /**
   * 引用来源,与配方 source 标准一致:
   * 如 "The Waldorf Astoria Bar Book · Frank Caiafa · 2016" 或 "店名 · 创作者 · 年份"。
   */
  source: string;
  notes: string;
  builtin: boolean;
  /** 做过/未做过:是否已亲手制作过该自制品 */
  made: boolean;
  /** 评分:1-10 整数,null 表示未评分(无半星) */
  rating: number | null;
  /** 手动排序序号:越小越靠前,null 表示未手动排序过 */
  sortIndex: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Prep sections: professional taxonomy grouped by alcohol content.
 * 依据 Cocktail Codex / Liquid Intelligence / Difford's Guide 等专业体系:
 * 含酒精 = 浸渍烈酒/自制利口酒/苦精酊剂/改制预调/自酿发酵;
 * 无酒精 = 糖浆/鲜榨与康迪奥/醋饮/零度替代/无酒精发酵/装饰其他。
 */
export const PREP_SECTIONS: { key: string; en: string; zh: string; group: PrepGroup }[] = [
  // ---- 含酒精 Alcoholic ----
  { key: "infused-spirit", en: "Infused Spirits", zh: "浸渍烈酒", group: "alcoholic" },
  { key: "homemade-liqueur", en: "House Liqueurs & Cordials", zh: "自制利口酒", group: "alcoholic" },
  { key: "bitters-tincture", en: "Bitters & Tinctures", zh: "苦精与酊剂", group: "alcoholic" },
  { key: "modified-spirit", en: "Washed & Batched", zh: "改制与预调", group: "alcoholic" },
  { key: "homemade-spirit", en: "Ferments & Brews (ABV)", zh: "自酿发酵酒", group: "alcoholic" },
  // ---- 无酒精 Zero-Proof ----
  { key: "homemade-syrup", en: "Syrups & Sweeteners", zh: "自制糖浆", group: "non_alcoholic" },
  { key: "juice-cordial", en: "Juices & Cordials", zh: "鲜榨与康迪奥", group: "non_alcoholic" },
  { key: "shrub-vinegar", en: "Shrubs & Vinegars", zh: "醋饮", group: "non_alcoholic" },
  { key: "zero-proof", en: "Zero-Proof Alternatives", zh: "零度替代", group: "non_alcoholic" },
  { key: "na-ferment", en: "NA Ferments", zh: "无酒精发酵", group: "non_alcoholic" },
  { key: "misc", en: "Garnish & Other", zh: "装饰与其他", group: "non_alcoholic" },
];

/** Prep types (English-first, with zh translation and section grouping) */
export const PREP_TYPES: { key: string; en: string; zh: string; section: string }[] = [
  // ---- 含酒精 ----
  // 浸渍烈酒 Infused Spirits
  { key: "infusion", en: "Infused Spirit", zh: "浸渍烈酒", section: "infused-spirit" },
  { key: "fat-wash", en: "Fat-Washed Spirit", zh: "油脂洗烈酒", section: "infused-spirit" },
  { key: "rapid-infusion", en: "Rapid Infusion (iSi)", zh: "快速浸渍", section: "infused-spirit" },
  // 自制利口酒 House Liqueurs & Cordials
  { key: "liqueur", en: "House Liqueur", zh: "自制利口酒", section: "homemade-liqueur" },
  { key: "amaro", en: "Amaro / Bitter Liqueur", zh: "自制苦酒", section: "homemade-liqueur" },
  { key: "falernum", en: "Falernum / Spiced Cordial", zh: "法勒南香料酒", section: "homemade-liqueur" },
  // 苦精与酊剂 Bitters & Tinctures
  { key: "bitters", en: "House Bitters", zh: "自制苦精", section: "bitters-tincture" },
  { key: "tincture", en: "Tincture", zh: "酊剂", section: "bitters-tincture" },
  // 改制与预调 Washed & Batched
  { key: "redistilled", en: "Milk-Washed / Clarified", zh: "奶洗澄清", section: "modified-spirit" },
  { key: "batch", en: "Batched Mix", zh: "预调批次", section: "modified-spirit" },
  { key: "fortified", en: "Fortified / Aromatized", zh: "自制加强酒", section: "modified-spirit" },
  // 自酿发酵酒 Ferments & Brews
  { key: "fermented", en: "Fermented / Brewed", zh: "自酿发酵", section: "homemade-spirit" },
  // ---- 无酒精 ----
  // 自制糖浆 Syrups & Sweeteners
  { key: "syrup", en: "Syrup", zh: "糖浆", section: "homemade-syrup" },
  { key: "rich-syrup", en: "Rich / Honey / Agave Syrup", zh: "浓糖浆与蜜糖浆", section: "homemade-syrup" },
  { key: "orgeat", en: "Orgeat / Nut Syrup", zh: "杏仁糖浆", section: "homemade-syrup" },
  { key: "oleo", en: "Oleo Saccharum", zh: "油糖", section: "homemade-syrup" },
  // 鲜榨与康迪奥 Juices & Cordials
  { key: "juice", en: "Fresh Juice", zh: "鲜榨汁", section: "juice-cordial" },
  { key: "cordial", en: "Cordial (NA)", zh: "康迪奥", section: "juice-cordial" },
  { key: "solution", en: "Solution (Acid/Saline)", zh: "溶液(酸/盐)", section: "juice-cordial" },
  // 醋饮 Shrubs & Vinegars
  { key: "shrub", en: "Shrub", zh: "果醋饮", section: "shrub-vinegar" },
  // 零度替代 Zero-Proof Alternatives
  { key: "zero-spirit", en: "Zero-Proof Spirit", zh: "零度烈酒替代", section: "zero-proof" },
  { key: "na-bitters", en: "NA Bitters", zh: "无酒精苦精", section: "zero-proof" },
  // 无酒精发酵 NA Ferments
  { key: "kombucha", en: "Kombucha / Water Kefir", zh: "康普茶与水开菲尔", section: "na-ferment" },
  // 装饰与其他 Garnish & Other
  { key: "garnish", en: "Garnish Prep", zh: "装饰预制", section: "misc" },
  { key: "other", en: "Other", zh: "其他", section: "misc" },
];

export function prepTypeLabel(key: string, lang: "zh" | "en"): string {
  const t = PREP_TYPES.find((p) => p.key === key);
  if (!t) return key;
  return lang === "en" ? t.en : t.zh;
}

/** Resolve the section key for a prep type (defaults to "misc") */
export function prepSectionOf(typeKey: string): string {
  return PREP_TYPES.find((p) => p.key === typeKey)?.section ?? "misc";
}

export function prepSectionLabel(sectionKey: string, lang: "zh" | "en"): string {
  const s = PREP_SECTIONS.find((x) => x.key === sectionKey);
  if (!s) return sectionKey;
  return lang === "en" ? s.en : s.zh;
}

/** 用户可管理的分区/类型条目(持久化于 homemade store) */
export interface PrepSection {
  key: string;
  en: string;
  zh: string;
  /** 顶层分组归属:含酒精/无酒精,缺省视为 non_alcoholic */
  group?: PrepGroup;
}

export interface PrepType {
  key: string;
  en: string;
  zh: string;
  section: string;
}

export function buildDefaultPrepSections(): PrepSection[] {
  return PREP_SECTIONS.map((s) => ({ key: s.key, en: s.en, zh: s.zh, group: s.group }));
}

export function buildDefaultPrepTypes(): PrepType[] {
  return PREP_TYPES.map((t) => ({ key: t.key, en: t.en, zh: t.zh, section: t.section }));
}

/** 基于自定义列表的标签函数(回退到默认常量) */
export function prepTypeLabelIn(types: PrepType[], key: string, lang: "zh" | "en"): string {
  const t = types.find((p) => p.key === key);
  if (!t) return prepTypeLabel(key, lang);
  return lang === "en" ? t.en : t.zh;
}

export function prepSectionOfIn(types: PrepType[], typeKey: string): string {
  return types.find((p) => p.key === typeKey)?.section ?? prepSectionOf(typeKey);
}

export function prepSectionLabelIn(
  sections: PrepSection[],
  sectionKey: string,
  lang: "zh" | "en",
): string {
  const s = sections.find((x) => x.key === sectionKey);
  if (!s) return prepSectionLabel(sectionKey, lang);
  return lang === "en" ? s.en : s.zh;
}

/** 分区的顶层分组(优先自定义列表,回退默认常量,再回退 non_alcoholic) */
export function prepGroupOfSection(sections: PrepSection[], sectionKey: string): PrepGroup {
  const custom = sections.find((s) => s.key === sectionKey)?.group;
  if (custom === "alcoholic" || custom === "non_alcoholic") return custom;
  return PREP_SECTIONS.find((s) => s.key === sectionKey)?.group ?? "non_alcoholic";
}

/** 条目的最终分组:显式 abvGroup 优先,否则按类型→分区推断 */
export function prepGroupOf(
  prep: Pick<HomemadePrep, "type" | "abvGroup">,
  sections: PrepSection[],
  types: PrepType[],
): PrepGroup {
  if (prep.abvGroup === "alcoholic" || prep.abvGroup === "non_alcoholic") return prep.abvGroup;
  return prepGroupOfSection(sections, prepSectionOfIn(types, prep.type));
}

// ---- 智能酒精属性识别引擎 ----
const ALCOHOLIC_HINTS =
  /浸渍|浸泡|infus|fat.?wash|油脂洗|奶洗|milk.?wash|milk punch|澄清奶|clarified milk|利口酒|liqueur|cordial liqueur|amaro|苦酒|falernum|法勒南|苦精|bitters(?!.*(无酒精|non|na|zero))|酊剂|tincture|加强酒|fortified|vermouth|味美思|自酿|酿造|brew|米酒|果酒|梅酒|umeshu|预调|batch|batched|伏特加|vodka|威士忌|whisk|朗姆|rum|金酒|\bgin\b|龙舌兰|tequila|白兰地|brandy|烈酒基|酒基|spirit.?based/i;
const NA_HINTS =
  /无酒精|non.?alcoholic|zero.?proof|alcohol.?free|\bna\b|糖浆|syrup|orgeat|杏仁糖浆|oleo|油糖|鲜榨|果汁|juice|shrub|醋饮|果醋|康普茶|kombucha|水开菲尔|kefir|盐水|saline|酸液|acid solution|柠檬酸|苏打|soda|装饰|garnish|脱水|dehydrat/i;

/**
 * 根据名称/类型/配料/做法智能判断酒精属性分组。
 * 判定标准:基液或配料含烈酒/酒基浸渍萃取 → alcoholic;
 * 水/糖/醋/果汁基且无酒精添加 → non_alcoholic。
 */
export function classifyPrepGroup(input: {
  name?: string;
  nameAlt?: string;
  type?: string;
  ingredients?: string[];
  recipe?: string;
  notes?: string;
  sections?: PrepSection[];
  types?: PrepType[];
}): PrepGroup {
  const secList = input.sections ?? buildDefaultPrepSections();
  const typList = input.types ?? buildDefaultPrepTypes();
  // 1) 类型已明确归属的直接按分区分组(类型是最强信号)
  if (input.type && typList.some((t) => t.key === input.type)) {
    return prepGroupOfSection(secList, prepSectionOfIn(typList, input.type));
  }
  // 2) 文本关键词判定:配料表权重最高(是否含烈酒/酒基)
  const ingText = (input.ingredients ?? []).join(" ");
  if (ALCOHOLIC_HINTS.test(ingText)) return "alcoholic";
  const nameText = `${input.name ?? ""} ${input.nameAlt ?? ""}`;
  if (NA_HINTS.test(nameText) && !ALCOHOLIC_HINTS.test(nameText)) return "non_alcoholic";
  if (ALCOHOLIC_HINTS.test(nameText)) return "alcoholic";
  const rest = `${input.recipe ?? ""} ${input.notes ?? ""}`;
  if (ALCOHOLIC_HINTS.test(rest) && !NA_HINTS.test(rest)) return "alcoholic";
  return "non_alcoholic";
}

/**
 * 智能推断类型 key:按名称/文本匹配类型词与常见别名。
 * 供表单预填与批量导入归类使用;返回 null 表示无法判断。
 */
export function guessPrepType(
  text: string,
  types?: PrepType[],
): string | null {
  const t = text.toLowerCase();
  const typList = types ?? buildDefaultPrepTypes();
  const has = (k: string) => typList.some((x) => x.key === k);
  const rules: { key: string; re: RegExp }[] = [
    { key: "fat-wash", re: /fat.?wash|油脂洗|脂洗/i },
    { key: "rapid-infusion", re: /rapid|isi|快速浸/i },
    { key: "falernum", re: /falernum|法勒南/i },
    { key: "amaro", re: /amaro|苦酒/i },
    { key: "liqueur", re: /liqueur|利口酒/i },
    { key: "na-bitters", re: /(无酒精|non.?alcoholic|na|zero).{0,6}(苦精|bitters)/i },
    { key: "bitters", re: /苦精|bitters/i },
    { key: "tincture", re: /tincture|酊剂/i },
    { key: "redistilled", re: /奶洗|milk.?wash|milk punch|澄清|clarif/i },
    { key: "batch", re: /预调|batch/i },
    { key: "fortified", re: /加强酒|fortified|味美思|vermouth/i },
    { key: "kombucha", re: /康普茶|kombucha|开菲尔|kefir/i },
    { key: "fermented", re: /自酿|发酵|ferment|brew|米酒|果酒|梅酒/i },
    { key: "zero-spirit", re: /零度|zero.?proof|无酒精.{0,4}(烈酒|金酒|威士忌|spirit)/i },
    { key: "oleo", re: /oleo|油糖/i },
    { key: "orgeat", re: /orgeat|杏仁糖浆/i },
    { key: "rich-syrup", re: /rich|浓糖浆|蜂?蜜糖浆|honey syrup|agave/i },
    { key: "shrub", re: /shrub|醋饮|果醋/i },
    { key: "cordial", re: /cordial|康迪奥/i },
    { key: "solution", re: /溶液|solution|saline|酸液/i },
    { key: "juice", re: /鲜榨|果汁|juice/i },
    { key: "syrup", re: /糖浆|syrup/i },
    { key: "infusion", re: /浸渍|浸泡|infus/i },
    { key: "garnish", re: /装饰|garnish|脱水|dehydrat/i },
  ];
  for (const r of rules) {
    if (has(r.key) && r.re.test(t)) return r.key;
  }
  return null;
}

/** 旧类型 key → 新类型 key 迁移映射(v1 → v2) */
export const PREP_TYPE_MIGRATION: Record<string, string> = {
  // 旧 flavored-liquid 区的类型保留 key,仅分区变化,无需映射
};

/** 旧分区 key → 新分区 key 迁移映射 */
export const PREP_SECTION_MIGRATION: Record<string, string> = {
  "flavored-liquid": "bitters-tincture",
};

export function normalizePrep(p: Partial<HomemadePrep> & { id: string }): HomemadePrep {
  return {
    id: p.id,
    name: p.name ?? "",
    nameAlt: p.nameAlt ?? "",
    type: p.type ?? "other",
    abvGroup:
      p.abvGroup === "alcoholic" || p.abvGroup === "non_alcoholic" ? p.abvGroup : null,
    ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
    recipe: p.recipe ?? "",
    yield: p.yield ?? "",
    shelfLife: p.shelfLife ?? "",
    storage: p.storage ?? "",
    notes: p.notes ?? "",
    source: p.source ?? "",
    builtin: p.builtin ?? false,
    made: p.made === true,
    rating:
      typeof p.rating === "number" && isFinite(p.rating) && Math.round(p.rating) >= 1 && Math.round(p.rating) <= 10
        ? Math.round(p.rating)
        : null,
    sortIndex: typeof p.sortIndex === "number" && isFinite(p.sortIndex) ? p.sortIndex : null,
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}

/**
 * Split a stored ingredient line like "200g white sugar 白砂糖" into
 * { amount: "200g", name: "white sugar 白砂糖" } for structured editing.
 * Lines without a leading quantity return an empty amount.
 */
const LEADING_QTY_RE =
  /^((?:约|~|≈)?\s*\d+(?:[.\/]\d+)?(?:\s*[-–]\s*\d+(?:[.\/]\d+)?)?\s*(?:kg|g|克|千克|公斤|ml|毫升|l|升|oz|盎司|dash(?:es)?|滴|tsp|茶匙|tbsp|汤匙|bar\s?spoons?|吧勺|cups?|杯|drops?|个|枚|颗|粒|根|片|只|条|瓣|把|包|袋|听|罐|瓶)?\.?)\s+(.+)$/i;

export function splitPrepIngredientLine(line: string): { amount: string; name: string } {
  const trimmed = line.trim();
  if (!trimmed) return { amount: "", name: "" };
  const m = trimmed.match(LEADING_QTY_RE);
  if (m && m[2]) {
    return { amount: m[1].trim(), name: m[2].trim() };
  }
  return { amount: "", name: trimmed };
}

/** Re-join a structured ingredient row into the stored line format. */
export function joinPrepIngredient(amount: string, name: string): string {
  const a = amount.trim();
  const n = name.trim();
  if (a && n) return `${a} ${n}`;
  return a || n;
}
