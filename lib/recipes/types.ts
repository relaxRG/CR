export interface Ingredient {
  id: string;
  name: string;
  amount: string;
}

export type Strength = "light" | "medium" | "strong";

/** 全部烈度值(筛选面板等场景使用) */
export const STRENGTHS: Strength[] = ["light", "medium", "strong"];

/** 细化烈度档位:按成品酒精度(ABV)区间划分 */
export type StrengthBand =
  | "lt10" // <10%
  | "b10_15" // 10-15%
  | "b15_20" // 15-20%
  | "b20_25" // 20-25%
  | "b25_30" // 25-30%
  | "b30_35" // 30-35%
  | "gt35"; // >35%

export const STRENGTH_BANDS: StrengthBand[] = [
  "lt10",
  "b10_15",
  "b15_20",
  "b20_25",
  "b25_30",
  "b30_35",
  "gt35",
];

/** 档位显示标签(中英) */
export const STRENGTH_BAND_LABELS: Record<StrengthBand, { zh: string; en: string }> = {
  lt10: { zh: "<10%", en: "<10%" },
  b10_15: { zh: "10-15%", en: "10-15%" },
  b15_20: { zh: "15-20%", en: "15-20%" },
  b20_25: { zh: "20-25%", en: "20-25%" },
  b25_30: { zh: "25-30%", en: "25-30%" },
  b30_35: { zh: "30-35%", en: "30-35%" },
  gt35: { zh: ">35%", en: ">35%" },
};

/** 每个 ABV 档位自动归入的大类:<15% 轻盈,15-25% 适中,25%+ 浓烈 */
export function strengthOfBand(band: StrengthBand): Strength {
  if (band === "lt10" || band === "b10_15") return "light";
  if (band === "b15_20" || band === "b20_25") return "medium";
  return "strong";
}

/** 大类下包含的档位(用于表单分组展示) */
export function bandsOfStrength(s: Strength): StrengthBand[] {
  return STRENGTH_BANDS.filter((b) => strengthOfBand(b) === s);
}

/** 旧数据迁移:仅有三档大类时给出代表性档位;空字符串表示未细分 */
export function defaultBandForStrength(s: Strength): StrengthBand {
  if (s === "light") return "b10_15";
  if (s === "medium") return "b15_20";
  return "b25_30";
}

/** Cocktail Codex 六大根源分类 */
export const CODEX_FAMILIES = [
  "古典 Old-Fashioned",
  "马天尼 Martini",
  "大吉利 Daiquiri",
  "边车 Sidecar",
  "高球 Highball",
  "菲兹 Flip",
] as const;
export type CodexFamily = (typeof CODEX_FAMILIES)[number];

/**
 * Codex 家族按界面语言显示:值存储为 "中文 English" 混写(如 "古典 Old-Fashioned"),
 * 中文界面取中文段,英文界面取英文段。
 */
export function codexFamilyLabel(family: string, lang: string): string {
  const raw = (family ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/^([\u4e00-\u9fa5·]+)\s+(.+)$/);
  if (!m) return raw;
  return lang === "en" ? m[2] : m[1];
}

/** 风味标签(可多选) */
export const FLAVOR_TAGS = [
  // 基础味觉 (5)
  "酸",
  "甜",
  "苦",
  "烈",
  "鲜",
  // 香气特征 (8)
  "柑橘",
  "热带",
  "草本",
  "花香",
  "烟熏",
  "木桶",
  "香料",
  "坚果可可",
  // 口感维度 (4)
  "清爽",
  "浓郁",
  "干爽",
  "复杂",
] as const;

/** 风味标签分层子集 */
export const FLAVOR_TASTE_TAGS = ["酸", "甜", "苦", "烈", "鲜"] as const;
export const FLAVOR_AROMA_TAGS = ["柑橘", "热带", "草本", "花香", "烟熏", "木桶", "香料", "坚果可可"] as const;
export const FLAVOR_TEXTURE_TAGS = ["清爽", "浓郁", "干爽", "复杂"] as const;

/** 风味标签分层标签（中英） */
export const FLAVOR_LAYER_LABELS = {
  taste:   { zh: "基础味觉", en: "Taste" },
  aroma:   { zh: "香气特征", en: "Aroma" },
  texture: { zh: "口感维度", en: "Texture" },
} as const;

/** 获取风味标签所属分层 */
export function flavorTagLayer(tag: string): "taste" | "aroma" | "texture" | null {
  if ((FLAVOR_TASTE_TAGS as readonly string[]).includes(tag)) return "taste";
  if ((FLAVOR_AROMA_TAGS as readonly string[]).includes(tag)) return "aroma";
  if ((FLAVOR_TEXTURE_TAGS as readonly string[]).includes(tag)) return "texture";
  return null;
}

/** 17 个精炼风味标签的英文名映射 */
export const FLAVOR_TAG_EN: Record<string, string> = {
  酸: "Sour",
  甜: "Sweet",
  苦: "Bitter",
  烈: "Boozy",
  鲜: "Umami",
  柑橘: "Citrus",
  热带: "Tropical",
  草本: "Herbal",
  花香: "Floral",
  烟熏: "Smoky",
  木桶: "Oaky",
  香料: "Spiced",
  坚果可可: "Nutty/Cacao",
  清爽: "Refreshing",
  浓郁: "Rich",
  干爽: "Dry",
  复杂: "Complex",
};

/** 卡片标签槽位 */
export type CardTagSlot = "category" | "codexFamily" | "baseSpirit" | "flavors" | "strength" | "rating" | "cost";
export const CARD_TAG_SLOTS: CardTagSlot[] = ["category", "codexFamily", "baseSpirit", "flavors", "strength", "rating", "cost"];
export const CARD_TAG_SLOT_LABELS: Record<CardTagSlot, { zh: string; en: string }> = {
  category:    { zh: "分类",       en: "Category" },
  codexFamily: { zh: "Codex 家族", en: "Codex Family" },
  baseSpirit:  { zh: "基酒",       en: "Base Spirit" },
  flavors:     { zh: "风味",       en: "Flavors" },
  strength:    { zh: "烈度",       en: "Strength" },
  rating:      { zh: "评分",       en: "Rating" },
  cost:        { zh: "成本",       en: "Cost" },
};

export interface Recipe {
  id: string;
  name: string;
  /** 英文名(与酒库一致的双语独立字段);空字符串表示未填写 */
  nameEn: string;
  categoryId: string | null;
  baseSpirit: string;
  glass: string;
  method: string;
  /** 冰块类型:标准方冰/大方冰/球冰/碎冰/长条冰/无冰;空字符串表示未选择 */
  ice: string;
  strength: Strength;
  /** 细化烈度档位(ABV 区间);空字符串表示未细分,仅有大类 */
  strengthBand: StrengthBand | "";
  /** 自动计算的成品酒精度(%);null 表示无法计算(配料缺用量) */
  abv: number | null;
  /** 是哪款经典鸡尾酒的变体,如"尼格罗尼";空字符串表示非变体 */
  variantOf: string;
  /** Cocktail Codex 六大根源分类,空字符串表示未选择 */
  codexFamily: string;
  /** 风味标签,多选 */
  flavors: string[];
  /** 饮用时长标签(长饮/短饮等,存标签中文名);空字符串表示未选择 */
  drinkDuration: string;
  /** 饮用场合标签(餐前酒/餐后酒等,存标签中文名);空字符串表示未选择 */
  occasion: string;
  /** 引用来源:书籍、网站、调酒师等,如"Cocktail Codex, p.120" */
  source: string;
  /** 配方故事:历史、来历、创作背景 */
  story: string;
  /** 风味描述:口感与风味的文字描述 */
  flavorDesc: string;
  ingredients: Ingredient[];
  steps: string;
  garnish: string;
  /** 注意事项(原 notes) */
  notes: string;
  favorite: boolean;
  /** 做过/未做过:是否已亲手制作过该配方 */
  made: boolean;
  /** 评分:1-10 整数,null 表示未评分(无半星) */
  rating: number | null;
  /** 手动排序序号:越小越靠前,null 表示未手动排序过 */
  sortIndex: number | null;
  /** 卡片标签顺序与可见性:null 表示使用默认顺序(全部显示) */
  cardTagOrder: CardTagSlot[] | null;
  createdAt: number;
  updatedAt: number;
}

/** 规范化评分:限制 1-10 的整数,其余返回 null */
export function normalizeRating(v: unknown): number | null {
  if (typeof v !== "number" || !isFinite(v)) return null;
  const n = Math.round(v);
  return n >= 1 && n <= 10 ? n : null;
}

/** 兼容旧数据:为缺少新字段的配方补默认值 */
export function normalizeRecipe(r: Partial<Recipe> & Pick<Recipe, "id" | "name">): Recipe {
  const base: Recipe = {
    nameEn: "",
    categoryId: null,
    baseSpirit: "其他",
    glass: "",
    method: "",
    ice: "",
    strength: "medium",
    strengthBand: "",
    abv: null,
    variantOf: "",
    codexFamily: "",
    flavors: [],
    drinkDuration: "",
    occasion: "",
    source: "",
    story: "",
    flavorDesc: "",
    ingredients: [],
    steps: "",
    garnish: "",
    notes: "",
    favorite: false,
    made: false,
    rating: null,
    sortIndex: null,
    cardTagOrder: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...r,
  };
  base.variantOf = r.variantOf ?? "";
  base.codexFamily = r.codexFamily ?? "";
  base.flavors = Array.isArray(r.flavors) ? r.flavors : [];
  base.drinkDuration = r.drinkDuration ?? "";
  base.occasion = r.occasion ?? "";
  base.source = r.source ?? "";
  base.story = r.story ?? "";
  base.flavorDesc = r.flavorDesc ?? "";
  base.strengthBand = (r.strengthBand ?? "") as StrengthBand | "";
  base.abv = typeof r.abv === "number" && isFinite(r.abv) ? r.abv : null;
  base.nameEn = r.nameEn ?? "";
  base.ice = r.ice ?? "";
  base.made = r.made === true;
  base.rating = normalizeRating(r.rating);
  base.sortIndex =
    typeof r.sortIndex === "number" && isFinite(r.sortIndex) ? r.sortIndex : null;
  base.cardTagOrder = Array.isArray(r.cardTagOrder) ? r.cardTagOrder as CardTagSlot[] : null;
  // 旧数据迁移:混写名("尼格罗尼 Negroni")自动拆分为中英字段
  if (!base.nameEn) {
    const split = splitBilingualName(base.name);
    if (split) {
      base.name = split.zh;
      base.nameEn = split.en;
    }
  }
  // 一致性保护:档位与大类不一致时,以档位为准修正大类
  if (base.strengthBand) base.strength = strengthOfBand(base.strengthBand);
  return base;
}

/**
 * 拆分"中文名 English Name"混写:要求同时含中文段与英文段。
 * 例:"尼格罗尼 Negroni" → { zh: "尼格罗尼", en: "Negroni" };纯中文/纯英文返回 null。
 */
export function splitBilingualName(name: string): { zh: string; en: string } | null {
  const t = name.trim();
  if (!t) return null;
  const m = t.match(/^([\u4e00-\u9fa5][\u4e00-\u9fa5\s·、()()0-9]*?)\s+([A-Za-z][A-Za-z0-9'’.&\-\s()]*)$/);
  if (!m) return null;
  const zh = m[1].trim();
  const en = m[2].trim();
  if (!zh || !en) return null;
  return { zh, en };
}

export interface Category {
  id: string;
  name: string;
  /** 英文名(独立字段,按界面语言优先展示) */
  nameEn?: string;
  color: string;
  createdAt: number;
}

/** 可自定义标签的种类:基酒 / 杯型 / 风味 / 饮用时长 / 饮用场合 */
export type TagKind = "spirit" | "glass" | "flavor" | "duration" | "occasion";

/** 通用自定义标签(基酒、杯型、风味) */
export interface TagItem {
  id: string;
  kind: TagKind;
  name: string;
  /** 英文名(独立字段,按界面语言优先展示) */
  nameEn?: string;
  color: string;
  /** 所属分组 id(可选,未分组时为空) */
  groupId?: string | null;
  createdAt: number;
}

/** 标签分组:每个标签种类下可自定义分组并排序 */
export interface TagGroup {
  id: string;
  kind: TagKind;
  name: string;
  /** 英文名(独立字段,按界面语言优先展示) */
  nameEn?: string;
  createdAt: number;
}

export const TAG_KIND_LABELS: Record<TagKind, string> = {
  spirit: "基酒",
  glass: "杯型",
  flavor: "风味",
  duration: "饮用时长",
  occasion: "饮用场合",
};

/** 常用标签中英对照词典(zh -> en),用于自动补全译名与旧数据迁移 */
export const TAG_NAME_DICT: Record<string, string> = {
  // 基酒
  金酒: "Gin",
  朗姆: "Rum",
  朗姆酒: "Rum",
  伏特加: "Vodka",
  威士忌: "Whiskey",
  龙舌兰: "Tequila",
  白兰地: "Brandy",
  利口酒: "Liqueur",
  无酒精: "Non-Alcoholic",
  梅斯卡尔: "Mezcal",
  皮斯科: "Pisco",
  清酒: "Sake",
  烧酒: "Shochu",
  金巴利: "Campari",
  味美思: "Vermouth",
  苦艾酒: "Absinthe",
  雪莉酒: "Sherry",
  波特酒: "Port",
  香槟: "Champagne",
  其他: "Other",
  // 杯型
  马天尼杯: "Martini Glass",
  古典杯: "Rocks Glass",
  高球杯: "Highball Glass",
  柯林杯: "Collins Glass",
  库佩杯: "Coupe Glass",
  飓风杯: "Hurricane Glass",
  子弹杯: "Shot Glass",
  尼克诺拉杯: "Nick & Nora Glass",
  郁金香杯: "Tulip Glass",
  笛型杯: "Flute Glass",
  提基杯: "Tiki Mug",
  铜杯: "Copper Mug",
  红酒杯: "Wine Glass",
  朱莉普杯: "Julep Cup",
  // 风味
  // 17 个精炼风味标签
  酸: "Sour",
  甜: "Sweet",
  苦: "Bitter",
  烈: "Boozy",
  鲜: "Umami",
  柑橘: "Citrus",
  热带: "Tropical",
  草本: "Herbal",
  花香: "Floral",
  烟熏: "Smoky",
  木桶: "Oaky",
  香料: "Spiced",
  坚果可可: "Nutty/Cacao",
  清爽: "Refreshing",
  浓郁: "Rich",
  干爽: "Dry",
  复杂: "Complex",
  // 保留旧词条兼容性（旧数据迁移用）
  草本旧: "Herbal",
  果味: "Fruity",
  甜润: "Sweet",
  酸爽: "Sour",
  苦韵: "Bitter",
  辛香: "Spicy",
  咸鲜: "Savory",
  坚果: "Nutty",
  奶油: "Creamy",
  气泡: "Sparkling",
  焦糖: "Caramel",
  咖啡: "Coffee",
  巧克力: "Chocolate",
  // 分类
  经典: "Classic",
  自创: "Original",
  浓烈: "Strong",
  低度: "Low-ABV",
  餐前: "Aperitif",
  餐后: "Digestif",
  热饮: "Hot",
  提基: "Tiki",
  // 饮用时长
  短饮: "Short Drink",
  长饮: "Long Drink",
  // 饮用场合(IBA 分类 + 传统 apéritif/digestif 体系)
  餐前酒: "Aperitif",
  餐后酒: "Digestif",
  全天酒: "All Day",
  佐餐酒: "With Dinner",
  睡前酒: "Nightcap",
  派对酒: "Party",
  // 制作方法
  摇和: "Shake",
  搅拌: "Stir",
  直调: "Build",
  分层: "Layer",
  搅打: "Blend",
  // 冰块类型
  标准方冰: "Standard Cubes",
  大方冰: "Large Cube",
  球冰: "Ice Sphere",
  碎冰: "Crushed Ice",
  长条冰: "Collins Spear",
  无冰: "No Ice (Up)",
};

/** 反向词典(en 小写 -> zh) */
const TAG_NAME_DICT_REV: Record<string, string> = Object.fromEntries(
  Object.entries(TAG_NAME_DICT).map(([zh, en]) => [en.toLowerCase(), zh]),
);

const hasCJK = (s: string) => /[\u4e00-\u9fff]/.test(s);

/**
 * 根据输入的名称自动补全另一语言译名。
 * 返回 { name(中文优先), nameEn }:输入中文查词典补英文;输入英文查反向词典补中文,
 * 查不到时中文侧回退为输入原文,保证 name 始终有值(name 是配方引用主键)。
 */
export function autoFillTagNames(input: string): { name: string; nameEn: string } {
  const raw = input.trim();
  if (!raw) return { name: "", nameEn: "" };
  if (hasCJK(raw)) {
    return { name: raw, nameEn: TAG_NAME_DICT[raw] ?? "" };
  }
  const zh = TAG_NAME_DICT_REV[raw.toLowerCase()];
  return zh ? { name: zh, nameEn: raw } : { name: raw, nameEn: raw };
}

/** 旧英文译名 → 新译名升级映射(词典修订后自动迁移已存数据) */
const TAG_NAME_EN_UPGRADES: Record<string, string> = {
  Martini: "Martini Glass",
  Rocks: "Rocks Glass",
  Highball: "Highball Glass",
  Collins: "Collins Glass",
  Coupe: "Coupe Glass",
  Hurricane: "Hurricane Glass",
  Shot: "Shot Glass",
  "Nick & Nora": "Nick & Nora Glass",
  Tulip: "Tulip Glass",
  Flute: "Flute Glass",
};

/** 为旧标签数据补全英文名(词典可查且 nameEn 为空),并升级已修订的旧译名 */
export function migrateTagNameEn<T extends { name: string; nameEn?: string }>(item: T): T {
  if (item.nameEn) {
    // 仅当该中文名的词典译名已修订、且存量 nameEn 等于旧译名时才升级,
    // 避免覆盖用户自定义的英文名
    const upgraded = TAG_NAME_EN_UPGRADES[item.nameEn.trim()];
    if (upgraded && TAG_NAME_DICT[item.name.trim()] === upgraded) {
      return { ...item, nameEn: upgraded };
    }
    return item;
  }
  const en = TAG_NAME_DICT[item.name.trim()];
  if (en) return { ...item, nameEn: en };
  if (!hasCJK(item.name)) return { ...item, nameEn: item.name };
  return item;
}

/**
 * 按界面语言返回标签/分类等名称的本地化显示。
 * - lang=en:优先 nameEn,其次查词典翻译中文名,查不到回退原名
 * - lang=zh:优先中文 name,查不到回退英文
 */
export function localizedTagName(
  name: string | null | undefined,
  nameEn: string | null | undefined,
  lang: string,
): string {
  const zh = (name ?? "").trim();
  const en = (nameEn ?? "").trim();
  if (lang === "en") {
    if (en) return en;
    if (zh && TAG_NAME_DICT[zh]) return TAG_NAME_DICT[zh];
    return zh;
  }
  if (zh) return zh;
  return en;
}

/** 构建默认标签集合(首次启动时初始化,之后完全由用户管理) */
export function buildDefaultTags(): TagItem[] {
  const now = Date.now();
  let i = 0;
  const mk = (kind: TagKind, name: string, color: string): TagItem => ({
    id: `tag-${kind}-${i}`,
    kind,
    name,
    nameEn: TAG_NAME_DICT[name] ?? "",
    color,
    createdAt: now + i++,
  });
  return [
    ...BASE_SPIRITS.map((n, idx) =>
      mk("spirit", n, CATEGORY_COLORS[idx % CATEGORY_COLORS.length]),
    ),
    ...GLASSES.map((n, idx) =>
      mk("glass", n, CATEGORY_COLORS[(idx + 3) % CATEGORY_COLORS.length]),
    ),
    ...FLAVOR_TAGS.map((n, idx) =>
      mk("flavor", n, CATEGORY_COLORS[(idx + 5) % CATEGORY_COLORS.length]),
    ),
    ...DRINK_DURATIONS.map((n, idx) =>
      mk("duration", n, CATEGORY_COLORS[(idx + 1) % CATEGORY_COLORS.length]),
    ),
    ...OCCASIONS.map((n, idx) =>
      mk("occasion", n, CATEGORY_COLORS[(idx + 4) % CATEGORY_COLORS.length]),
    ),
  ];
}

/** 饮用时长默认标签:短饮(无冰快饮,3-4口)/长饮(加冰慢饮,大容量) */
export const DRINK_DURATIONS = ["短饮", "长饮"] as const;

/**
 * 饮用场合默认标签,依据 IBA 官方分类(Before/After Dinner、All Day、Longdrink)
 * 与传统 apéritif/digestif 体系,补充中文调酒常用的佐餐/睡前/派对场景。
 */
export const OCCASIONS = [
  "餐前酒",
  "餐后酒",
  "全天酒",
  "佐餐酒",
  "睡前酒",
  "派对酒",
] as const;

export const BASE_SPIRITS = [
  "金酒",
  "朗姆",
  "伏特加",
  "威士忌",
  "龙舌兰",
  "白兰地",
  "利口酒",
  "无酒精",
  "其他",
] as const;

export const METHODS = ["摇和", "搅拌", "直调", "分层", "搅打"] as const;

/** 冰块类型选项(成品用冰) */
export const ICE_TYPES = ["标准方冰", "大方冰", "球冰", "碎冰", "长条冰", "无冰"] as const;

export const GLASSES = [
  "马天尼杯",
  "古典杯",
  "高球杯",
  "柯林杯",
  "库佩杯",
  "飓风杯",
  "子弹杯",
  "其他",
] as const;

export const STRENGTH_LABELS: Record<Strength, string> = {
  light: "轻盈",
  medium: "适中",
  strong: "浓烈",
};

export const CATEGORY_COLORS = [
  "#007AFF",
  "#FF3B30",
  "#34C759",
  "#5856D6",
  "#FF9500",
  "#AF52DE",
  "#00C7BE",
  "#FF2D55",
] as const;

export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
