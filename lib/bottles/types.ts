/** 酒款分类 */
export const BOTTLE_CATEGORIES = [
  "金酒",
  "朗姆",
  "伏特加",
  "威士忌",
  "龙舌兰",
  "白兰地",
  "利口酒",
  "苦精",
  "味美思",
  "开胃酒",
  "起泡酒",
  "葡萄酒",
  "清酒烧酒",
  "中式白酒",
  "糖浆",
  "软饮",
  "果汁",
  "糖与甜味剂",
  "果蔬",
  "香料与草本",
  "花卉",
  "茶咖与可可",
  "坚果与谷物",
  "乳蛋",
  "酸类与添加剂",
  "其他",
] as const;
export type BottleCategory = (typeof BOTTLE_CATEGORIES)[number];

/**
 * 顶层分组:基酒库(base spirits)、酒款库(modifiers & mixers)、软饮库(soft drinks & juices)与原材料库(raw materials)。
 * 动态归属以 lib/bottles/taxonomy 为准,此处为静态默认(旧代码/测试兼容)。
 */
export type BottleGroupKey = "spirits" | "bottles" | "softdrinks" | "materials";

export const BOTTLE_GROUPS: { key: BottleGroupKey; zh: string; en: string }[] = [
  { key: "spirits", zh: "基酒库", en: "Base Spirits" },
  { key: "bottles", zh: "酒款库", en: "Bottles" },
  { key: "softdrinks", zh: "软饮库", en: "Soft Drinks" },
  { key: "materials", zh: "原材料库", en: "Raw Materials" },
];

const DEFAULT_SPIRIT_CATEGORIES = [
  "金酒",
  "伏特加",
  "朗姆",
  "威士忌",
  "龙舌兰",
  "白兰地",
  "清酒烧酒",
  "中式白酒",
];

/** v8 材料库分类(静态默认;动态归属以 taxonomy 为准) */
export const DEFAULT_MATERIAL_CATEGORIES = [
  "糖与甜味剂",
  "果蔬",
  "香料与草本",
  "花卉",
  "茶咖与可可",
  "坚果与谷物",
  "乳蛋",
  "酸类与添加剂",
];

/** v9 软饮库分类(静态默认;动态归属以 taxonomy 为准) */
export const DEFAULT_SOFTDRINKS_CATEGORIES = ["软饮", "果汁"];

export function bottleGroupOf(category: string): BottleGroupKey {
  if (category === "原材料" || DEFAULT_MATERIAL_CATEGORIES.includes(category))
    return "materials";
  if (DEFAULT_SPIRIT_CATEGORIES.includes(category)) return "spirits";
  if (DEFAULT_SOFTDRINKS_CATEGORIES.includes(category)) return "softdrinks";
  return "bottles";
}

/** 分组下的分类列表 */
export function categoriesOfGroup(group: BottleGroupKey): string[] {
  if (group === "materials")
    return BOTTLE_CATEGORIES.filter((c) => DEFAULT_MATERIAL_CATEGORIES.includes(c));
  if (group === "spirits")
    return BOTTLE_CATEGORIES.filter((c) => DEFAULT_SPIRIT_CATEGORIES.includes(c));
  if (group === "softdrinks")
    return BOTTLE_CATEGORIES.filter((c) => DEFAULT_SOFTDRINKS_CATEGORIES.includes(c));
  return BOTTLE_CATEGORIES.filter(
    (c) =>
      !DEFAULT_MATERIAL_CATEGORIES.includes(c) && !DEFAULT_SPIRIT_CATEGORIES.includes(c),
  );
}

/** 酒款分类英文映射(界面语言为英文时显示) */
export const BOTTLE_CATEGORY_EN: Record<string, string> = {
  金酒: "Gin",
  朗姆: "Rum",
  伏特加: "Vodka",
  威士忌: "Whisky",
  龙舌兰: "Agave",
  白兰地: "Brandy",
  利口酒: "Liqueur",
  苦精: "Bitters",
  味美思: "Vermouth",
  开胃酒: "Aperitif/Amaro",
  起泡酒: "Sparkling",
  葡萄酒: "Wine",
  清酒烧酒: "Sake/Shochu",
  中式白酒: "Baijiu",
  糖浆: "Syrups",
  软饮: "Soft Drinks",
  软饮糖浆: "Mixers/Syrups",
  原材料: "Raw Materials",
  糖与甜味剂: "Sugars & Sweeteners",
  果蔬: "Fruits & Vegetables",
  香料与草本: "Spices & Botanicals",
  花卉: "Flowers & Florals",
  茶咖与可可: "Tea, Coffee & Cacao",
  坚果与谷物: "Nuts & Grains",
  乳蛋: "Dairy & Egg",
  酸类与添加剂: "Acids & Additives",
  其他: "Others",
};

/**
 * Cocktail Codex 风格子分类建议(英文优先)。
 * 按分类给出常见 style,表单中可快速选择,也允许自由填写。
 */
export const BOTTLE_STYLES: Record<string, string[]> = {
  金酒: ["London Dry", "Plymouth", "Old Tom", "Genever", "Contemporary", "Navy Strength", "Sloe Gin"],
  朗姆: ["Spanish Style (Blanco)", "Spanish Style (Añejo)", "English Style (Jamaican)", "English Style (Demerara)", "French Style (Agricole Blanc)", "French Style (Agricole Ambre)", "Overproof", "Black Rum", "Spiced Rum", "Cachaça"],
  伏特加: ["Wheat", "Rye", "Potato", "Corn", "Grape", "Flavored"],
  威士忌: ["Bourbon", "Rye", "Tennessee", "Scotch Blended", "Scotch Single Malt", "Islay Single Malt", "Irish", "Japanese", "Canadian"],
  龙舌兰: ["Tequila Blanco", "Tequila Reposado", "Tequila Añejo", "Mezcal Joven", "Mezcal Reposado", "Sotol", "Raicilla"],
  白兰地: ["Cognac VS", "Cognac VSOP", "Cognac XO", "Armagnac", "Calvados", "Pisco", "Apple Brandy", "Grappa", "Eau de Vie"],
  利口酒: ["Orange Liqueur", "Cherry Liqueur", "Coffee Liqueur", "Herbal Liqueur", "Amaro", "Cream Liqueur", "Nut Liqueur", "Fruit Liqueur", "Floral Liqueur", "Anise Liqueur"],
  苦精: ["Aromatic", "Orange", "Celery", "Chocolate", "Peach", "Tiki"],
  味美思: ["Dry Vermouth", "Blanc/Bianco", "Sweet Vermouth", "Ambrato", "Quinquina", "Americano"],
  开胃酒: ["Aperitivo", "Amaro Leggero", "Amaro Medio", "Amaro Denso", "Fernet", "Gentian"],
  起泡酒: ["Champagne", "Prosecco", "Cava", "Crémant", "Pét-Nat"],
  葡萄酒: ["Dry White", "Dry Red", "Sherry Fino", "Sherry Oloroso", "Sherry PX", "Port", "Madeira", "Sauternes"],
  清酒烧酒: ["Junmai", "Junmai Ginjo", "Junmai Daiginjo", "Nigori", "Umeshu", "Mugi Shochu", "Imo Shochu", "Kome Shochu", "Soju"],
  中式白酒: ["Sauce Aroma 酱香", "Strong Aroma 浓香", "Light Aroma 清香", "Rice Aroma 米香"],
  糖浆: ["Syrup", "Cordial", "Shrub", "Cream/Foam"],
  软饮: ["Soda", "Tonic", "Ginger Beer", "Ginger Ale", "Sparkling Water", "Cola"],
  软饮糖浆: ["Syrup", "Juice", "Soda", "Tonic", "Ginger Beer", "Cordial", "Shrub"],
  原材料: [
    "Sugar & Sweetener",
    "Fruit & Citrus",
    "Spice & Botanical",
    "Nut / Tea / Coffee",
    "Dairy & Egg",
    "Acid & Additive",
    "Herb",
  ],
  糖与甜味剂: ["Refined Sugar", "Raw / Dark Sugar", "Sugar Cube", "Honey & Nectar", "Molasses & Concentrate"],
  果蔬: ["Citrus", "Fresh Fruit", "Fresh Vegetable", "Dried Fruit", "Dried Vegetable"],
  香料与草本: ["Dried Spice", "Fresh Herb", "Bittering Botanical"],
  花卉: ["Dried Flowers", "Fresh Edible Flowers", "Floral Water"],
  茶咖与可可: ["Cacao", "Tea", "Coffee"],
  坚果与谷物: ["Nut", "Grain / Seed"],
  乳蛋: ["Milk / Cream", "Egg", "Butter / Cheese"],
  酸类与添加剂: ["Powdered Acid", "Vinegar", "Salt & Mineral", "Texture / Clarifier"],
};

/**
 * 旧分类 → 新分类迁移:v3 及以前的"软饮糖浆"合并分类拆分为"糖浆"与"软饮"。
 * 按 style 判断归属:糖浆类(Syrup/Cordial/Shrub)归"糖浆",其余归"软饮"。
 */
export function migrateBottleCategory(b: Pick<Bottle, "category" | "style" | "nameEn" | "nameZh">): string {
  if (b.category !== "软饮糖浆") return b.category;
  const s = (b.style || "").toLowerCase();
  const name = `${b.nameEn} ${b.nameZh}`.toLowerCase();
  if (
    s === "syrup" ||
    s === "cordial" ||
    s === "shrub" ||
    /syrup|cordial|shrub|orgeat|grenadine|糖浆|椰浆|奶油|蛋白|cream|egg white/.test(name)
  ) {
    return "糖浆";
  }
  return "软饮";
}

/** 酒款(酒类数据库条目) */
export interface Bottle {
  id: string;
  /** 中文名 */
  nameZh: string;
  /** 英文名 */
  nameEn: string;
  /** 分类 */
  category: string;
  /** 风格子分类(Cocktail Codex 风格,如 "London Dry" / "Bourbon"),可为空 */
  style: string;
  /** 品牌 */
  brand: string;
  /** 产地 */
  origin: string;
  /** 规格,如 "700ml" */
  volume: string;
  /** 酒精度数(% ABV),如 40 */
  abv: number;
  /** 中国市场参考价(人民币),0 表示未知 */
  priceCny: number;
  /** 备注 */
  notes: string;
  /** 风味标签(多选,用于鸡尾酒风味分析) */
  flavorTags: string[];
  /** 产品故事/介绍(文字描述) */
  story: string;
  /** 风格说明(详细描述,区别于 style 子分类标签) */
  styleDesc: string;
  /** 蒸馏厂/酒厂简介（基酒库专用） */
  distilleryInfo?: string;
  /** 搭配建议（酒款库专用） */
  pairingNotes?: string;
  /** 调酒用途说明（原材料库专用） */
  usageNotes?: string;
  /** 季节性说明（原材料库专用） */
  seasonality?: string;
  /** 英文简介（双语补全，国际场合使用） */
  notesEn?: string;
  /** 英文故事/介绍（双语补全） */
  storyEn?: string;
  /** 可替代的酒款（跨酒款关联推理：在用户酒库中可替代的酒款名） */
  substituteFor?: string;
  /** 搭配使用的酒款（跨酒款关联推理：与用户酒库中哪些酒款搭配效果好） */
  pairsWith?: string;
  /** 是否内置数据(内置数据也可编辑/删除) */
  builtin: boolean;
  /** 评分:1-10 整数,null 表示未评分(无半星) */
  rating: number | null;
  /** 手动排序序号:null 表示未手动排序(排在已排序项之后) */
  sortIndex: number | null;
  /**
   * 形态换算系数(可选):形态词 → 占整件商品的比例或克数系数,
   * 覆盖内置 FORM_FACTORS。如 { "皮": 1/6, "片": 1/8 }。
   */
  formFactors?: Record<string, number>;
  createdAt: number;
  updatedAt: number;
  /** 手动覆盖"开瓶易失效"标记。undefined = 由系统自动判断；true/false = 用户手动设置 */
  perishableOnOpen?: boolean;
  /**
   * 手动指定库归属。undefined = 系统自动判断（根据 category）；
   * 'homemade' = 用户手动归入自制库（条目仍存储在 bottles store，但在列表中显示于自制库）
   */
  libraryOverride?: 'homemade' | 'spirits' | 'bottles' | 'softdrinks' | 'materials';
  /** 当 libraryOverride = 'homemade' 时，指定自制库分区 */
  homemadeGroup?: 'alcoholic' | 'non_alcoholic' | 'garnish' | 'other';
  /** 当 libraryOverride = 'homemade' 时，指定自制库类型（对应 PREP_TYPES.key） */
  homemadeType?: string;
  /**
   * 三段式定价 — 包装数量（纯数字）。
   * 与 packUnit 配合使用：packQty + packUnit → priceCny
   * 例：packQty=10, packUnit="个", priceCny=8 → 每个 ¥0.8
   * 若未填，计算引擎回退到解析 volume 字符串（兼容旧数据）。
   */
  packQty?: number;
  /**
   * 三段式定价 — 包装单位。
   * 支持：ml/cl/L（液体）、g/kg/斤/两/lb（重量）、个/听/瓶/袋/罐（计件）
   */
  packUnit?: string;
  /** 多供货渠道列表（供应商/自采电商） */
  supplierChannels?: SupplierChannel[];
  /** 当前成本计算基准渠道 ID，对应 supplierChannels 中某个 channel.id */
  costChannelId?: string;
}

/** 兼容处理:为缺字段的酒款补默认值 */
export function normalizeBottle(b: Partial<Bottle> & Pick<Bottle, "id" | "nameZh">): Bottle {
  return {
    nameEn: "",
    category: "其他",
    style: "",
    brand: "",
    origin: "",
    volume: "",
    abv: 0,
    priceCny: 0,
    notes: "",
    builtin: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...b,
    ...(typeof b.sortIndex === "number" && isFinite(b.sortIndex)
      ? { sortIndex: b.sortIndex }
      : { sortIndex: null }),
    ...(typeof b.rating === "number" &&
    isFinite(b.rating) &&
    Math.round(b.rating) >= 1 &&
    Math.round(b.rating) <= 10
      ? { rating: Math.round(b.rating) }
      : { rating: null }),
    flavorTags: Array.isArray(b.flavorTags) ? b.flavorTags : [],
    story: b.story ?? "",
    styleDesc: b.styleDesc ?? "",
    ...(b.libraryOverride ? { libraryOverride: b.libraryOverride } : {}),
    ...(b.homemadeGroup ? { homemadeGroup: b.homemadeGroup } : {}),
    ...(b.homemadeType ? { homemadeType: b.homemadeType } : {}),
    ...(typeof b.packQty === "number" && isFinite(b.packQty) && b.packQty > 0 ? { packQty: b.packQty } : {}),
    ...(b.packUnit ? { packUnit: b.packUnit } : {}),
    ...(normalizeSupplierChannels(b.supplierChannels, b.costChannelId).length > 0
      ? { supplierChannels: normalizeSupplierChannels(b.supplierChannels, b.costChannelId) }
      : {}),
    ...(resolveCostChannelId(normalizeSupplierChannels(b.supplierChannels, b.costChannelId), b.costChannelId)
      ? { costChannelId: resolveCostChannelId(normalizeSupplierChannels(b.supplierChannels, b.costChannelId), b.costChannelId) }
      : {}),
  };
}

// ─── 供货渠道 ─────────────────────────────────────────────────────────────────

/** 渠道下可被导入、手动录入和智能匹配识别的一个采购名称。 */
export interface SupplierChannelPurchaseName {
  name: string;
  normalizedName: string;
  createdAt?: string;
}

/** 一个供货渠道（供应商或自采电商） */
export interface SupplierChannel {
  id: string;
  /** 渠道类型：supplier=供应商, self=自采电商 */
  type: "supplier" | "self";
  /** 供应商/渠道名称，如「至缘」「京东自采」「1919」 */
  name: string;
  /** 兼容旧数据的首个采购名称；新逻辑统一读取 purchaseNames。 */
  supplierProductName?: string;
  /** 供应商或电商对这款酒的现名、旧名、简称等多个采购名称。 */
  purchaseNames?: SupplierChannelPurchaseName[];
  /** 最新进货价（元/瓶或元/箱等） */
  latestPrice: number;
  /** 进货单位，如「瓶」「箱」 */
  unit: string;
  /** 购买链接（自采渠道，如京东/淘宝/1919 链接，支持一键跳转） */
  purchaseUrl?: string;
  /** 是否为成本计算基准渠道（只能有一个为 true） */
  isCostBasis: boolean;
  /** 历史进货价记录 */
  priceHistory?: SupplierPriceRecord[];
  /** 备注 */
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

function normalizeChannelName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase().replace(/[（）()\[\]【】]/g, "").replace(/[\s·•\-_/]/g, "")
    : "";
}

/** 创建可用于渠道匹配的采购名称；无效空名称返回 null。 */
export function createSupplierChannelPurchaseName(value: string, createdAt?: string): SupplierChannelPurchaseName | null {
  const name = value.trim();
  const normalizedName = normalizeChannelName(name);
  if (!name || !normalizedName) return null;
  return { name, normalizedName, ...(createdAt ? { createdAt } : {}) };
}

/** 读取渠道的全部采购名称，兼容旧 supplierProductName 字段并去重。 */
export function getSupplierChannelPurchaseNames(channel: Partial<Pick<SupplierChannel, "supplierProductName" | "purchaseNames">>): SupplierChannelPurchaseName[] {
  const source = [
    ...(Array.isArray(channel.purchaseNames) ? channel.purchaseNames : []),
    ...(channel.supplierProductName ? [{ name: channel.supplierProductName }] : []),
  ];
  const seen = new Set<string>();
  return source.reduce<SupplierChannelPurchaseName[]>((result, entry) => {
    const createdAt = "createdAt" in entry && typeof entry.createdAt === "string" ? entry.createdAt : undefined;
    const created = createSupplierChannelPurchaseName(typeof entry.name === "string" ? entry.name : "", createdAt);
    if (!created || seen.has(created.normalizedName)) return result;
    seen.add(created.normalizedName);
    result.push(created);
    return result;
  }, []);
}

/** 规范化渠道并保证成本基准只有一个。 */
export function normalizeSupplierChannels(rawChannels: unknown, requestedCostChannelId?: string): SupplierChannel[] {
  if (!Array.isArray(rawChannels)) return [];
  const channels = rawChannels
    .filter((channel): channel is Partial<SupplierChannel> => Boolean(channel && typeof channel === "object"))
    .map((channel) => {
      const purchaseNames = getSupplierChannelPurchaseNames(channel);
      const id = typeof channel.id === "string" && channel.id ? channel.id : "";
      const createdAt = typeof channel.createdAt === "string" ? channel.createdAt : new Date(0).toISOString();
      const updatedAt = typeof channel.updatedAt === "string" ? channel.updatedAt : createdAt;
      return {
        id,
        type: channel.type === "self" ? "self" : "supplier",
        name: typeof channel.name === "string" ? channel.name.trim() : "",
        ...(purchaseNames[0] ? { supplierProductName: purchaseNames[0].name } : {}),
        ...(purchaseNames.length > 0 ? { purchaseNames } : {}),
        latestPrice: typeof channel.latestPrice === "number" && Number.isFinite(channel.latestPrice) ? channel.latestPrice : 0,
        unit: typeof channel.unit === "string" && channel.unit.trim() ? channel.unit.trim() : "瓶",
        ...(typeof channel.purchaseUrl === "string" && channel.purchaseUrl.trim() ? { purchaseUrl: channel.purchaseUrl.trim() } : {}),
        isCostBasis: Boolean(channel.isCostBasis),
        ...(Array.isArray(channel.priceHistory) ? { priceHistory: channel.priceHistory.filter((record): record is SupplierPriceRecord => Boolean(record && typeof record === "object" && typeof record.date === "string" && typeof record.price === "number" && Number.isFinite(record.price))) } : {}),
        ...(typeof channel.notes === "string" && channel.notes.trim() ? { notes: channel.notes.trim() } : {}),
        createdAt,
        updatedAt,
      } satisfies SupplierChannel;
    })
    .filter((channel) => Boolean(channel.id && channel.name));
  const basisId = resolveCostChannelId(channels, requestedCostChannelId);
  return channels.map((channel) => ({ ...channel, isCostBasis: Boolean(basisId && channel.id === basisId) }));
}

/** 解析唯一成本基准渠道，优先显式 costChannelId，再兼容旧 isCostBasis。 */
export function resolveCostChannelId(channels: SupplierChannel[], requestedCostChannelId?: string): string | undefined {
  if (requestedCostChannelId && channels.some((channel) => channel.id === requestedCostChannelId)) return requestedCostChannelId;
  return channels.find((channel) => channel.isCostBasis)?.id;
}

/** 历史进货价记录 */
export interface SupplierPriceRecord {
  date: string;       // YYYY-MM-DD
  price: number;
  quantity?: number;
  source?: string;    // 来源说明，如「Excel导入」「手动录入」
  /** 源烈酒采购记录 ID；存在时由采购投影维护，用于覆盖、撤销与重复防护。 */
  sourcePurchaseId?: string;
}

/**
 * 获取某 Bottle 的有效成本价：
 * 1. 若有 costChannelId 对应的渠道，使用该渠道的 latestPrice
 * 2. 否则使用 isCostBasis=true 的渠道价格
 * 3. 否则回退到 priceCny
 */
export function getEffectiveCostPrice(bottle: Bottle): number {
  const channels = normalizeSupplierChannels(bottle.supplierChannels, bottle.costChannelId);
  if (channels.length === 0) return bottle.priceCny;
  // 优先使用指定的成本基准渠道
  if (bottle.costChannelId) {
    const ch = channels.find((c) => c.id === bottle.costChannelId);
    if (ch && ch.latestPrice > 0) return ch.latestPrice;
  }
  // 其次找 isCostBasis=true 的渠道
  const basisCh = channels.find((c) => c.isCostBasis);
  if (basisCh && basisCh.latestPrice > 0) return basisCh.latestPrice;
  // 回退到 priceCny
  return bottle.priceCny;
}
