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
 * 顶层分组:基酒库(base spirits)、酒款库(modifiers & mixers)与原材料库(raw materials)。
 * 动态归属以 lib/bottles/taxonomy 为准,此处为静态默认(旧代码/测试兼容)。
 */
export type BottleGroupKey = "spirits" | "bottles" | "materials";

export const BOTTLE_GROUPS: { key: BottleGroupKey; zh: string; en: string }[] = [
  { key: "spirits", zh: "基酒库", en: "Base Spirits" },
  { key: "bottles", zh: "酒款库", en: "Bottles" },
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

export function bottleGroupOf(category: string): BottleGroupKey {
  if (category === "原材料" || DEFAULT_MATERIAL_CATEGORIES.includes(category))
    return "materials";
  if (DEFAULT_SPIRIT_CATEGORIES.includes(category)) return "spirits";
  return "bottles";
}

/** 分组下的分类列表 */
export function categoriesOfGroup(group: BottleGroupKey): string[] {
  if (group === "materials")
    return BOTTLE_CATEGORIES.filter((c) => DEFAULT_MATERIAL_CATEGORIES.includes(c));
  if (group === "spirits")
    return BOTTLE_CATEGORIES.filter((c) => DEFAULT_SPIRIT_CATEGORIES.includes(c));
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
  };
}
