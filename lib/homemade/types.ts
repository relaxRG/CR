// Homemade preps library: syrups, infusions, cordials, batches, etc.
// English-first design with Chinese translations.
import { SourceRef } from "@/lib/recipes/types";

import { FRAC_CHARS } from "@/lib/units";

/** 自制库顶层分组:含酒精 / 无酒精(类似酒库的基酒库/酒款库/原材料库) */
export type PrepGroup = "alcoholic" | "non_alcoholic" | "garnish";

export const PREP_GROUPS: { key: PrepGroup; en: string; zh: string }[] = [
  { key: "alcoholic", en: "Alcoholic Preps", zh: "含酒精自制" },
  { key: "non_alcoholic", en: "Zero-Proof Preps", zh: "无酒精自制" },
  { key: "garnish", en: "Garnish", zh: "装饰" },
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
  // ---- 装饰分区专属字段（仅 abvGroup = "garnish" 的条目使用）----
  /** 计量单位（片/枝/颗/根/个/克），装饰条目默认按件计 */
  garnishUnit?: string;
  /** 一批制作产量（如 20 片），用于折算单件成本 */
  batchYield?: number;
  /** 一批制作总成本（元），与 batchYield 配合自动折算单件成本 */
  batchCost?: number;
  /** 单件成本（元/件），可直接填写或由 batchCost/batchYield 自动折算 */
  costPerUnit?: number;
  /** 保鲜期快捷选项 key（fresh/fridge3/fridge7/fridge14/ambient/custom） */
  shelfLifeKey?: string;
  /** 制作方式描述（如「削皮」「脱水 4 小时」「糖渍 48 小时」） */
  prepMethod?: string;
  /** 关联原材料库条目 ID 列表（装饰所用原料，成本可自动汇总） */
  linkedMaterialIds?: string[];
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
  /** 结构化引用来源（比 source 字符串更精细的版本，可选） */
  sourceRef?: SourceRef;
  notes: string;
  builtin: boolean;
  /** 自制品故事/介绍（AI 补全） */
  story?: string;
  /** 风格/口感描述（AI 补全） */
  styleDesc?: string;
  /** 风味标签（AI 补全，从预设列表中选） */
  flavorTags?: string[];
  /** 工艺标签（AI 识别，从 TECHNIQUES 中选） */
  techniques?: string[];
  /** 调酒用途说明（AI 补全） */
  usageNotes?: string;
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
  // ---- 装饰 Garnish ----
  { key: "misc", en: "Garnish & Other", zh: "装饰与其他", group: "garnish" },
  { key: "garnish-citrus", en: "Citrus Garnish", zh: "柑橘类装饰", group: "garnish" },
  { key: "garnish-herb-flower", en: "Herb & Flower", zh: "香草与花卉", group: "garnish" },
  { key: "garnish-fruit", en: "Fruit Garnish", zh: "果类装饰", group: "garnish" },
  { key: "garnish-skewer", en: "Skewer & Pick", zh: "串签类", group: "garnish" },
  { key: "garnish-rim", en: "Rim & Dust", zh: "杯口装饰", group: "garnish" },
  { key: "garnish-dehydrated", en: "Dehydrated", zh: "脱水类", group: "garnish" },
  { key: "garnish-other", en: "Other Garnish", zh: "其他装饰", group: "garnish" },
];

/** Prep types (English-first, with zh translation and section grouping) */
export const PREP_TYPES: { key: string; en: string; zh: string; section: string }[] = [
  // ---- 含酒精 ----
  // 浸渍烈酒 Infused Spirits
  { key: "infusion", en: "Infused Spirit", zh: "浸渍烈酒", section: "infused-spirit" },
  { key: "fat-wash", en: "Fat-Washed Spirit", zh: "油脂洗烈酒", section: "infused-spirit" },
  { key: "butter-wash", en: "Butter-Washed Spirit", zh: "黄油洗烈酒", section: "infused-spirit" },
  { key: "oil-wash", en: "Oil-Washed Spirit", zh: "油脂洗烈酒(植物油)", section: "infused-spirit" },
  { key: "rapid-infusion", en: "Rapid Infusion (iSi)", zh: "快速加压浸渍", section: "infused-spirit" },
  { key: "sous-vide-infusion", en: "Sous Vide Infusion", zh: "真空低温浸渍", section: "infused-spirit" },
  { key: "ultrasonic-infusion", en: "Ultrasonic Infusion", zh: "超声波浸渍", section: "infused-spirit" },
  { key: "rotovap", en: "Rotary Evaporation (Rotovap)", zh: "旋转蒸发精华", section: "infused-spirit" },
  { key: "cold-brew-spirit", en: "Cold Brew Infusion", zh: "冷萃浸渍", section: "infused-spirit" },
  { key: "smoke-infusion", en: "Smoke-Infused Spirit", zh: "烟熏浸渍烈酒", section: "infused-spirit" },
  // 自制利口酒 House Liqueurs & Cordials
  { key: "liqueur", en: "House Liqueur", zh: "自制利口酒", section: "homemade-liqueur" },
  { key: "fruit-liqueur", en: "Fruit Liqueur", zh: "自制果味利口酒", section: "homemade-liqueur" },
  { key: "herbal-liqueur", en: "Herbal Liqueur", zh: "自制草本利口酒", section: "homemade-liqueur" },
  { key: "nut-liqueur", en: "Nut Liqueur / Nocino", zh: "坚果利口酒", section: "homemade-liqueur" },
  { key: "cream-liqueur", en: "Cream Liqueur", zh: "自制奶油利口酒", section: "homemade-liqueur" },
  { key: "amaro", en: "Amaro / Bitter Liqueur", zh: "自制苦酒", section: "homemade-liqueur" },
  { key: "falernum", en: "Falernum / Spiced Cordial", zh: "法勒南香料酒", section: "homemade-liqueur" },
  // 苦精与酊剂 Bitters & Tinctures
  { key: "bitters", en: "House Bitters", zh: "自制苦精", section: "bitters-tincture" },
  { key: "aromatic-bitters", en: "Aromatic Bitters", zh: "芳香苦精", section: "bitters-tincture" },
  { key: "citrus-bitters", en: "Citrus Bitters", zh: "柑橘苦精", section: "bitters-tincture" },
  { key: "herbal-bitters", en: "Herbal Bitters", zh: "草本苦精", section: "bitters-tincture" },
  { key: "tincture", en: "Tincture", zh: "酊剂", section: "bitters-tincture" },
  { key: "spice-tincture", en: "Spice Tincture", zh: "香料酊", section: "bitters-tincture" },
  { key: "citrus-tincture", en: "Citrus Tincture", zh: "柑橘酊", section: "bitters-tincture" },
  // 改制与预调 Washed & Batched
  { key: "redistilled", en: "Milk-Washed / Clarified Spirit", zh: "奶洗澄清烈酒", section: "modified-spirit" },
  { key: "batch", en: "Batched Cocktail Mix", zh: "批量预调", section: "modified-spirit" },
  { key: "bottled-cocktail", en: "Bottled Cocktail", zh: "瓶装鸡尾酒", section: "modified-spirit" },
  { key: "barrel-aged", en: "Barrel-Aged Batch", zh: "桶陈预调", section: "modified-spirit" },
  { key: "fortified", en: "Fortified / Aromatized", zh: "自制加强酒", section: "modified-spirit" },
  // 自酿发酵酒 Ferments & Brews
  { key: "fermented", en: "Fermented / Brewed", zh: "自酿发酵酒", section: "homemade-spirit" },
  { key: "homebrew-beer", en: "Home Brew Beer", zh: "自酿啤酒", section: "homemade-spirit" },
  { key: "homebrew-wine", en: "Home Brew Wine / Sake", zh: "自酿葡萄酒/米酒", section: "homemade-spirit" },
  // ---- 无酒精 ----
  // 自制糖浆 Syrups & Sweeteners
  { key: "syrup", en: "Simple Syrup", zh: "简单糖浆", section: "homemade-syrup" },
  { key: "rich-syrup", en: "Rich / Honey / Agave Syrup", zh: "浓糖浆与蜜糖浆", section: "homemade-syrup" },
  { key: "spiced-syrup", en: "Spiced Syrup", zh: "香料糖浆", section: "homemade-syrup" },
  { key: "herbal-syrup", en: "Herbal Syrup", zh: "草本糖浆", section: "homemade-syrup" },
  { key: "floral-syrup", en: "Floral Syrup", zh: "花卉糖浆", section: "homemade-syrup" },
  { key: "fruit-syrup", en: "Fruit Syrup", zh: "果味糖浆", section: "homemade-syrup" },
  { key: "caramel-syrup", en: "Caramel / Demerara Syrup", zh: "焦糖糖浆", section: "homemade-syrup" },
  { key: "coffee-tea-syrup", en: "Coffee / Tea Syrup", zh: "咖啡与茶糖浆", section: "homemade-syrup" },
  { key: "orgeat", en: "Orgeat / Nut Syrup", zh: "杏仁糖浆", section: "homemade-syrup" },
  { key: "oleo", en: "Oleo Saccharum", zh: "油糖", section: "homemade-syrup" },
  // 鲜榨与康迪奥 Juices & Cordials
  { key: "juice", en: "Fresh Juice", zh: "鲜榨汁", section: "juice-cordial" },
  { key: "clarified-juice", en: "Clarified Juice", zh: "澄清果汁", section: "juice-cordial" },
  { key: "super-juice", en: "Super Juice", zh: "超级果汁", section: "juice-cordial" },
  { key: "cordial", en: "Cordial (NA)", zh: "康迪奥", section: "juice-cordial" },
  { key: "solution", en: "Solution (Acid / Saline)", zh: "溶液(酸/盐)", section: "juice-cordial" },
  { key: "acid-adjusted", en: "Acid-Adjusted Juice", zh: "酸度调整汁", section: "juice-cordial" },
  // 醋饮 Shrubs & Vinegars
  { key: "shrub", en: "Shrub / Drinking Vinegar", zh: "果醋饮", section: "shrub-vinegar" },
  { key: "lacto-ferment-drink", en: "Lacto-Fermented Drink", zh: "乳酸发酵饮", section: "shrub-vinegar" },
  // 零度替代 Zero-Proof Alternatives
  { key: "zero-spirit", en: "Zero-Proof Spirit", zh: "零度烈酒替代", section: "zero-proof" },
  { key: "na-bitters", en: "NA Bitters", zh: "无酒精苦精", section: "zero-proof" },
  { key: "na-liqueur", en: "NA Liqueur", zh: "无酒精利口酒", section: "zero-proof" },
  // 无酒精发酵 NA Ferments
  { key: "kombucha", en: "Kombucha", zh: "康普茶", section: "na-ferment" },
  { key: "water-kefir", en: "Water Kefir", zh: "水开菲尔", section: "na-ferment" },
  { key: "ginger-beer", en: "Ginger Beer / Ginger Bug", zh: "姜汁啤酒", section: "na-ferment" },
  { key: "tepache", en: "Tepache / Wild Ferment", zh: "发酵果汁/野生发酵", section: "na-ferment" },
  { key: "jun", en: "Jun / Milk Kefir", zh: "Jun茶/乳开菲尔", section: "na-ferment" },
  // 装饰与其他 Garnish & Other
  { key: "foam", en: "Foam / Air", zh: "泡沫", section: "misc" },
  { key: "spherification-prep", en: "Spherification", zh: "球化", section: "misc" },
  { key: "garnish", en: "Garnish Prep", zh: "装饰预制", section: "misc" },
  { key: "other", en: "Other", zh: "其他", section: "misc" },
  // ---- 装饰分区专属类型 ----
  { key: "garnish-citrus-peel", en: "Citrus Peel / Twist", zh: "柑橘皮卷", section: "garnish-citrus" },
  { key: "garnish-citrus-wheel", en: "Citrus Wheel / Slice", zh: "柑橘片/轮", section: "garnish-citrus" },
  { key: "garnish-dehydrated-citrus", en: "Dehydrated Citrus", zh: "脱水柑橘", section: "garnish-dehydrated" },
  { key: "garnish-candied-fruit", en: "Candied / Preserved Fruit", zh: "糖渍/腌渍果类", section: "garnish-fruit" },
  { key: "garnish-fresh-herb", en: "Fresh Herb Sprig", zh: "新鲜香草枝", section: "garnish-herb-flower" },
  { key: "garnish-dried-herb", en: "Dried Herb / Spice", zh: "干燥香草/香料", section: "garnish-herb-flower" },
  { key: "garnish-edible-flower", en: "Edible Flower", zh: "食用花卉", section: "garnish-herb-flower" },
  { key: "garnish-salt-rim", en: "Salt / Sugar Rim", zh: "盐边/糖边", section: "garnish-rim" },
  { key: "garnish-spiced-rim", en: "Spiced Rim Mix", zh: "香料杯口", section: "garnish-rim" },
  { key: "garnish-skewer-olive", en: "Olive / Onion Skewer", zh: "橄榄/洋葱串", section: "garnish-skewer" },
  { key: "garnish-skewer-fruit", en: "Fruit Skewer", zh: "果类串签", section: "garnish-skewer" },
  { key: "garnish-ice-sphere", en: "Flavored Ice / Ice Sphere", zh: "风味冰块/冰球", section: "garnish-other" },
  { key: "garnish-chocolate", en: "Chocolate / Candy", zh: "巧克力/糖果", section: "garnish-other" },
  { key: "garnish-misc", en: "Other Handmade Garnish", zh: "其他手工装饰", section: "garnish-other" },
];

/**
 * 工艺标签（TECHNIQUES）- 基于 Liquid Intelligence / The Bar Book / Cocktail Codex 等专业资料
 * 描述制作过程中使用的具体技术手段，与 PREP_TYPES（成品类型）正交。
 * 一个自制品可同时具有多个工艺标签（如「脂洗 + 真空低温浸渍」）。
 */
// 工艺标签请使用 lib/homemade/technique.ts 中的 TECHNIQUES 常量（权威版本）。

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
  if (custom === "alcoholic" || custom === "non_alcoholic" || custom === "garnish") return custom;
  const found = PREP_SECTIONS.find((s) => s.key === sectionKey)?.group;
  return found ?? "non_alcoholic";
}

/** 条目的最终分组:显式 abvGroup 优先,否则按类型→分区推断 */
export function prepGroupOf(
  prep: Pick<HomemadePrep, "type" | "abvGroup">,
  sections: PrepSection[],
  types: PrepType[],
): PrepGroup {
  if (prep.abvGroup === "alcoholic" || prep.abvGroup === "non_alcoholic" || prep.abvGroup === "garnish") return prep.abvGroup;
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
    { key: "butter-wash", re: /butter.?wash|黄油洗/i },
    { key: "oil-wash", re: /oil.?wash|植物油洗/i },
    { key: "sous-vide-infusion", re: /sous.?vide|真空低温浸渍/i },
    { key: "ultrasonic-infusion", re: /ultrasonic|超声波浸渍/i },
    { key: "rotovap", re: /rotovap|rotary.?evap|旋转蒸发/i },
    { key: "cold-brew-spirit", re: /cold.?brew.*(spirit|whisky|gin|rum|vodka|烈酒)|冷萃浸渍/i },
    { key: "smoke-infusion", re: /smoke.?infus|烟熏浸渍/i },
    { key: "falernum", re: /falernum|法勒南/i },
    { key: "amaro", re: /amaro|苦酒/i },
    { key: "fruit-liqueur", re: /fruit.?liqueur|果味利口酒/i },
    { key: "herbal-liqueur", re: /herbal.?liqueur|草本利口酒/i },
    { key: "nut-liqueur", re: /nocino|nut.?liqueur|坚果利口酒/i },
    { key: "cream-liqueur", re: /cream.?liqueur|奶油利口酒/i },
    { key: "liqueur", re: /liqueur|利口酒/i },
    { key: "na-bitters", re: /(无酒精|non.?alcoholic|na|zero).{0,6}(苦精|bitters)/i },
    { key: "aromatic-bitters", re: /aromatic.?bitters|芳香苦精/i },
    { key: "citrus-bitters", re: /citrus.?bitters|柑橘苦精/i },
    { key: "herbal-bitters", re: /herbal.?bitters|草本苦精/i },
    { key: "bitters", re: /苦精|bitters/i },
    { key: "spice-tincture", re: /spice.?tincture|香料酊/i },
    { key: "citrus-tincture", re: /citrus.?tincture|柑橘酊/i },
    { key: "tincture", re: /tincture|酊剂/i },
    { key: "redistilled", re: /奶洗|milk.?wash|milk punch|澄清|clarif/i },
    { key: "bottled-cocktail", re: /bottled.?cocktail|瓶装鸡尾酒/i },
    { key: "barrel-aged", re: /barrel.?aged|桶陈预调/i },
    { key: "batch", re: /预调|batch/i },
    { key: "fortified", re: /加强酒|fortified|味美思|vermouth/i },
    { key: "homebrew-beer", re: /home.?brew.?beer|自酿啤酒/i },
    { key: "homebrew-wine", re: /home.?brew.*(wine|sake)|自酿葡萄酒|自酿米酒/i },
    { key: "fermented", re: /自酿|发酵|ferment|brew|米酒|果酒|梅酒/i },
    { key: "zero-spirit", re: /零度|zero.?proof|无酒精.{0,4}(烈酒|金酒|威士忌|spirit)/i },
    { key: "na-liqueur", re: /无酒精利口酒|na.?liqueur/i },
    { key: "oleo", re: /oleo|油糖/i },
    { key: "orgeat", re: /orgeat|杏仁糖浆/i },
    { key: "rich-syrup", re: /rich.?syrup|浓糖浆|蜂?蜜糖浆|honey syrup|agave/i },
    { key: "spiced-syrup", re: /spiced.?syrup|香料糖浆/i },
    { key: "herbal-syrup", re: /herbal.?syrup|草本糖浆/i },
    { key: "floral-syrup", re: /floral.?syrup|花卉糖浆|花糖浆/i },
    { key: "fruit-syrup", re: /fruit.?syrup|果味糖浆/i },
    { key: "caramel-syrup", re: /caramel|demerara.?syrup|焦糖糖浆/i },
    { key: "coffee-tea-syrup", re: /coffee.?syrup|tea.?syrup|咖啡糖浆|茶糖浆/i },
    { key: "shrub", re: /shrub|醋饮|果醋/i },
    { key: "lacto-ferment-drink", re: /lacto.?ferment|乳酸发酵饮/i },
    { key: "cordial", re: /cordial|康迪奥/i },
    { key: "clarified-juice", re: /clarified.?juice|澄清果汁/i },
    { key: "super-juice", re: /super.?juice|超级果汁/i },
    { key: "acid-adjusted", re: /acid.?adjust|酸度调整汁/i },
    { key: "solution", re: /溶液|solution|saline|酸液/i },
    { key: "juice", re: /鲜榨|果汁|juice/i },
    { key: "syrup", re: /糖浆|syrup/i },
    { key: "infusion", re: /浸渍|浸泡|infus/i },
    { key: "kombucha", re: /康普茶|kombucha/i },
    { key: "water-kefir", re: /water.?kefir|水开菲尔/i },
    { key: "ginger-beer", re: /ginger.?beer|ginger.?bug|姜汁啤酒/i },
    { key: "tepache", re: /tepache|野生发酵/i },
    { key: "jun", re: /\bjun\b|milk.?kefir|乳开菲尔/i },
    { key: "foam", re: /foam|泡沫/i },
    { key: "spherification-prep", re: /spherif|球化/i },
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
    // 装饰专属字段
    ...(p.abvGroup === "garnish" ? { abvGroup: "garnish" as PrepGroup } : {}),
    ingredients: Array.isArray(p.ingredients) ? p.ingredients : [],
    recipe: p.recipe ?? "",
    yield: p.yield ?? "",
    shelfLife: p.shelfLife ?? "",
    storage: p.storage ?? "",
    notes: p.notes ?? "",
    source: p.source ?? "",
    sourceRef: p.sourceRef ?? undefined,
    builtin: p.builtin ?? false,
    made: p.made === true,
    rating:
      typeof p.rating === "number" && isFinite(p.rating) && Math.round(p.rating) >= 1 && Math.round(p.rating) <= 10
        ? Math.round(p.rating)
        : null,
    sortIndex: typeof p.sortIndex === "number" && isFinite(p.sortIndex) ? p.sortIndex : null,
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
    // 装饰专属字段（可选，仅 garnish 分组条目使用）
    ...(p.garnishUnit !== undefined ? { garnishUnit: p.garnishUnit } : {}),
    ...(p.batchYield !== undefined ? { batchYield: p.batchYield } : {}),
    ...(p.batchCost !== undefined ? { batchCost: p.batchCost } : {}),
    ...(p.costPerUnit !== undefined ? { costPerUnit: p.costPerUnit } : {}),
    ...(p.shelfLifeKey !== undefined ? { shelfLifeKey: p.shelfLifeKey } : {}),
    ...(p.prepMethod !== undefined ? { prepMethod: p.prepMethod } : {}),
    ...(Array.isArray(p.linkedMaterialIds) ? { linkedMaterialIds: p.linkedMaterialIds } : {}),
  };
}

/**
 * Split a stored ingredient line like "200g white sugar 白砂糖" into
 * { amount: "200g", name: "white sugar 白砂糖" } for structured editing.
 * Lines without a leading quantity return an empty amount.
 */
const LEADING_QTY_RE =
  // Number part: supports integer, decimal, slash fraction, mixed fraction,
  //   Unicode vulgar fraction alone, integer + Unicode vulgar fraction (e.g. 1¼)
  // Unit part: all liquid, weight, count, and fuzzy units
  new RegExp(
    "^(" +
      "(?:约|~|≈)?\\s*" +
      "(?:" +
        `\\d+\\s*[${FRAC_CHARS}]` + // integer + Unicode fraction e.g. 1¼
        `|[${FRAC_CHARS}]` +         // pure Unicode fraction e.g. ¼
        "|\\d+\\s+\\d+\\/\\d+" +     // mixed fraction e.g. 1 1/2
        "|\\d+\\/\\d+" +             // slash fraction e.g. 1/2
        "|\\d+(?:[.,]\\d+)?" +       // integer or decimal e.g. 1.5
      ")" +
      "(?:\\s*[-–~]\\s*" +           // optional range e.g. 1-2
        "(?:" +
          `\\d+\\s*[${FRAC_CHARS}]` +
          `|[${FRAC_CHARS}]` +
          "|\\d+\\/\\d+" +
          "|\\d+(?:[.,]\\d+)?" +
        ")" +
      ")?" +
      "\\s*" +
      "(?:" +
        // liquid precise
        "fl\\.?\\s*oz|fluid\\s*oz?" +
        "|ml|mL|毫升|cc" +
        "|cl|cL|厘升" +
        "|dl|dL|分升" +
        "|[Ll](?:iter|itre)?|升" +
        "|shots?|jiggers?" +
        "|pony" +
        "|pints?|pt|品脱" +
        "|quarts?|qt|夸脱" +
        "|gallons?|gal|加仑" +
        // spoons
        "|tbsp\\.?|tablespoons?" +
        "|tsp\\.?|teaspoons?" +
        "|bar\\s?spoons?|bsp|吧勺" +
        "|dash(?:es)?" +
        "|drops?" +
        "|splash(?:es)?" +
        // weight
        "|kg|千克|公斤" +
        "|mg|毫克" +
        "|g|克" +
        "|lbs?|磅|pounds?" +
        // count
        "|个|枚|颗|粒|根|片|只|条|瓣|把|包|袋|听|罐|瓶|块|枝|叶" +
        "|pieces?|pcs?|sticks?|stalks?|slices?|leaves?|leaf|sprigs?" +
        "|pods?|cloves?|beans?|cubes?|wedges?|twists?|eggs?" +
        // cups
        "|cups?|杯" +
        // fuzzy (recognise but don't convert)
        "|pinch(?:es)?|撮|handful|把" +
        // additional industry units
        "|dessert[\\s-]?spoons?|dsp" +
        "|scruple[\\s-]?spoons?|scsp" +
        "|rinse" +
        "|parts?|份|比例" +
        "|圈|wheels?" +
        "|扭|twists?|peels?" +
        "|楔|wedges?" +
      ")?\\.?" +
    ")\\s+(.+)$",
    "i",
  );

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

/**
 * 计算装饰条目的单件成本：
 * 优先使用 costPerUnit，其次由 batchCost/batchYield 折算，否则返回 null
 */
export function calcGarnishCostPerUnit(prep: HomemadePrep): number | null {
  if (prep.costPerUnit != null && prep.costPerUnit > 0) return prep.costPerUnit;
  if (prep.batchCost != null && prep.batchYield != null && prep.batchYield > 0) {
    return prep.batchCost / prep.batchYield;
  }
  return null;
}

/** 保鲜期快捷选项 */
export const SHELF_LIFE_OPTIONS: { key: string; en: string; zh: string }[] = [
  { key: "fresh", en: "Use immediately", zh: "现做现用" },
  { key: "fridge3", en: "Refrigerate 3 days", zh: "冷藏 3 天" },
  { key: "fridge7", en: "Refrigerate 7 days", zh: "冷藏 7 天" },
  { key: "fridge14", en: "Refrigerate 14 days", zh: "冷藏 14 天" },
  { key: "ambient", en: "Ambient / Room temp", zh: "常温保存" },
  { key: "custom", en: "Custom", zh: "自定义" },
];

export function shelfLifeLabel(key: string | undefined, lang: "zh" | "en", custom?: string): string {
  if (!key || key === "custom") return custom || (lang === "zh" ? "自定义" : "Custom");
  const opt = SHELF_LIFE_OPTIONS.find((o) => o.key === key);
  if (!opt) return key;
  return lang === "zh" ? opt.zh : opt.en;
}
