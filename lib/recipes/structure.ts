/**
 * 结构构成公式(structural formula)智能分析引擎。
 *
 * 理论依据(专业书籍与资料):
 * - 《Cocktail Codex》(Alex Day 等): core(核心) / balance(平衡) / seasoning(调味) 三要素框架与六大根源家族
 * - David Embury《The Fine Art of Mixing Drinks》(1948): base(基酒) / modifier(修饰剂) / accent(点缀) 三分法
 * - Proof Cocktails "Anatomy of the Cocktail": 8:3:2 基酒-修饰-点缀比例结构
 * - IBA 官方配方结构惯例
 *
 * 每条配料被赋予一个精密结构角色,输出形如:
 * 陈酿烈酒基酒 (60ml) + 鲜榨柑橘酸度调节剂 (20ml) + 糖浆基甜度平衡剂 (15ml) + 芳香苦精调味剂 (2 dash)
 */
import type { Ingredient } from "./types";
import { parseAmountLoose } from "./smart-cost";

/** 结构角色 key */
export type StructureRole =
  | "base_aged" // 陈酿烈酒基酒(威士忌/白兰地/陈年朗姆等)
  | "base_white" // 纯正烈酒基酒(金酒/伏特加/白朗姆等)
  | "base_agave" // 龙舌兰烈酒基酒(特其拉/梅斯卡尔)
  | "base_liqueur" // 利口酒基核心(利口酒作主体)
  | "base_wine" // 葡萄酒/起泡酒基核心
  | "fortified" // 加强酒修饰核心(味美思/雪莉等)
  | "bitter_modifier" // 苦味修饰剂(金巴利/阿玛罗,量级大)
  | "acid_citrus" // 鲜榨柑橘酸度调节剂
  | "acid_other" // 变奏酸度调节剂(醋/酸性溶液等)
  | "sweet_syrup" // 糖浆基甜度平衡剂
  | "sweet_liqueur" // 利口酒基复合平衡剂(甜+风味)
  | "bitters" // 芳香苦精调味剂(dash 级)
  | "lengthener_carbonated" // 碳酸延长剂
  | "lengthener_juice" // 果汁延长剂
  | "texture_egg" // 蛋白质构剂
  | "texture_dairy" // 乳脂质构剂
  | "aromatic_accent" // 芳香点缀(涮杯/表面滴洒)
  | "dilution" // 稀释调节水体
  | "other"; // 特色风味成分

/** 角色 → 中/英精密描述 */
export const STRUCTURE_ROLE_LABELS: Record<StructureRole, { zh: string; en: string }> = {
  base_aged: { zh: "陈酿烈酒基酒", en: "Aged Spirit Core" },
  base_white: { zh: "纯正烈酒基酒", en: "White Spirit Core" },
  base_agave: { zh: "龙舌兰烈酒基酒", en: "Agave Spirit Core" },
  base_liqueur: { zh: "利口酒基核心", en: "Liqueur Core" },
  base_wine: { zh: "葡萄酒基核心", en: "Wine Core" },
  fortified: { zh: "加强酒修饰核心", en: "Fortified Wine Modifier" },
  bitter_modifier: { zh: "苦味修饰剂", en: "Bitter Modifier" },
  acid_citrus: { zh: "鲜榨柑橘酸度调节剂", en: "Fresh Citrus Acid Regulator" },
  acid_other: { zh: "变奏酸度调节剂", en: "Alternative Acid Regulator" },
  sweet_syrup: { zh: "糖浆基甜度平衡剂", en: "Syrup Sweetness Balancer" },
  sweet_liqueur: { zh: "利口酒基复合平衡剂", en: "Liqueur Compound Balancer" },
  bitters: { zh: "芳香苦精调味剂", en: "Aromatic Bitters Seasoning" },
  lengthener_carbonated: { zh: "碳酸延长剂", en: "Carbonated Lengthener" },
  lengthener_juice: { zh: "果汁延长剂", en: "Juice Lengthener" },
  texture_egg: { zh: "蛋白质构剂", en: "Egg Texturizer" },
  texture_dairy: { zh: "乳脂质构剂", en: "Dairy Texturizer" },
  aromatic_accent: { zh: "芳香点缀剂", en: "Aromatic Accent" },
  dilution: { zh: "稀释调节水体", en: "Dilution Medium" },
  other: { zh: "特色风味成分", en: "Signature Flavor Component" },
};

const W = (s: string) => s.toLowerCase();
const has = (name: string, words: string[]) => {
  const n = W(name);
  return words.some((w) => n.includes(W(w)));
};

const AGED_SPIRITS = [
  "威士忌", "波本", "黑麦", "苏格兰", "白兰地", "干邑", "雅文邑", "卡尔瓦多斯",
  "陈年朗姆", "黑朗姆", "金朗姆", "达克朗姆", "皮斯科",
  "whisky", "whiskey", "bourbon", "rye", "scotch", "brandy", "cognac",
  "armagnac", "calvados", "dark rum", "aged rum", "gold rum", "demerara rum", "pisco",
];
const WHITE_SPIRITS = [
  "金酒", "琴酒", "伏特加", "白朗姆", "淡朗姆", "朗姆", "烧酒", "清酒", "杜松子",
  "gin", "vodka", "white rum", "light rum", "rum", "cachaca", "cacha\u00e7a", "genever", "aquavit", "shochu", "soju",
];
const AGAVE_SPIRITS = ["特其拉", "龙舌兰", "梅斯卡尔", "tequila", "mezcal", "sotol"];
const FORTIFIED = [
  "味美思", "威末", "雪莉", "波特", "马德拉", "利莱", "杜本内", "金鸡纳", "苦艾酒",
  "vermouth", "sherry", "port", "madeira", "lillet", "dubonnet", "quinquina", "byrrh", "cocchi americano",
];
const BITTER_MODIFIERS = [
  "金巴利", "阿佩罗", "阿玛罗", "意式苦酒", "菲奈特", "苦味利口", "龙胆", "西娜尔", "苏兹",
  "campari", "aperol", "amaro", "fernet", "cynar", "suze", "gentian", "averna", "montenegro", "ramazzotti",
];
const CITRUS_ACIDS = [
  "柠檬汁", "青柠汁", "莱姆汁", "西柚汁", "葡萄柚汁", "柚子汁", "橙汁",
  "lemon juice", "lime juice", "grapefruit juice", "yuzu",
];
const OTHER_ACIDS = ["醋", "酸性", "酸溶液", "康普茶", "verjus", "acid", "vinegar", "shrub", "kombucha"];
const SYRUPS = [
  "糖浆", "糖", "蜂蜜", "枫糖", "杏仁糖浆", "红石榴", "orgeat", "syrup", "sugar",
  "honey", "maple", "grenadine", "agave nectar", "demerara",
];
const SWEET_LIQUEURS = [
  "利口酒", "君度", "橙皮酒", "库拉索", "黑加仑", "樱桃白兰地", "马拉斯奇诺", "查特",
  "廊酒", "圣杰曼", "接骨木花", "咖啡利口", "可可利口", "杏仁利口", "苹果利口", "香蕉利口",
  "liqueur", "cointreau", "triple sec", "curacao", "cura\u00e7ao", "cassis", "maraschino",
  "chartreuse", "benedictine", "st-germain", "st germain", "elderflower", "kahlua",
  "amaretto", "falernum", "drambuie", "galliano", "midori", "creme de", "banane",
];
const BITTERS_DASH = ["苦精", "bitters", "比特"];
const CARBONATED = [
  "苏打水", "汤力", "姜汁啤酒", "姜汁汽水", "可乐", "气泡水", "香槟", "起泡酒", "普罗塞克", "卡瓦", "啤酒", "苹果酒",
  "soda", "tonic", "ginger beer", "ginger ale", "cola", "sparkling", "champagne", "prosecco", "cava", "beer", "lemonade", "cider",
];
const JUICES = [
  "菠萝汁", "蔓越莓汁", "苹果汁", "番茄汁", "桃汁", "芒果汁", "百香果",
  "pineapple juice", "cranberry juice", "apple juice", "tomato juice", "passion fruit", "peach",
];
const EGG = ["蛋白", "全蛋", "蛋黄", "egg"];
const DAIRY = ["奶油", "牛奶", "椰浆", "椰奶", "炼乳", "cream", "milk", "coconut cream", "coconut milk", "condensed"];
const WATER = ["水", "冰水", "热水", "冷水", "water", "ice"];
const WINE = ["葡萄酒", "红酒", "白葡萄酒", "wine"];

/** dash/drop/rinse 级微量判断 */
const isAccentAmount = (amount: string) => {
  const a = W(amount);
  return /dash|drop|rinse|涮|滴|喷/.test(a);
};

/** 识别单条配料的结构角色 */
export function inferStructureRole(ing: Ingredient, maxMl: number): StructureRole {
  const name = ing.name;
  const ml = parseAmountLoose(ing.amount ?? "");
  // 微量点缀优先
  if (has(name, BITTERS_DASH)) return "bitters";
  if (isAccentAmount(ing.amount ?? "") ) return "aromatic_accent";
  if (has(name, EGG)) return "texture_egg";
  if (has(name, DAIRY)) return "texture_dairy";
  if (has(name, CARBONATED)) return "lengthener_carbonated";
  if (has(name, CITRUS_ACIDS)) {
    // 大量橙汁按延长剂
    if (has(name, ["橙汁", "orange juice"]) && ml !== null && ml >= 60) return "lengthener_juice";
    return "acid_citrus";
  }
  if (has(name, OTHER_ACIDS)) return "acid_other";
  if (has(name, JUICES)) return ml !== null && ml >= 60 ? "lengthener_juice" : "other";
  if (has(name, BITTER_MODIFIERS)) return "bitter_modifier";
  if (has(name, FORTIFIED)) return "fortified";
  if (has(name, SYRUPS) && !has(name, SWEET_LIQUEURS)) return "sweet_syrup";
  if (has(name, AGAVE_SPIRITS)) return "base_agave";
  if (has(name, AGED_SPIRITS)) return "base_aged";
  if (has(name, WHITE_SPIRITS)) return "base_white";
  if (has(name, SWEET_LIQUEURS)) {
    // 利口酒量大到主体(≥ 全配方最大量且 ≥30ml)视为利口酒基核心
    if (ml !== null && ml >= 30 && ml >= maxMl) return "base_liqueur";
    return "sweet_liqueur";
  }
  if (has(name, WINE)) return "base_wine";
  if (has(name, WATER) && W(name).length <= 6) return "dilution";
  return "other";
}

export interface StructureItem {
  ingredient: Ingredient;
  role: StructureRole;
  /** 展示用角色描述 */
  label: { zh: string; en: string };
}

/** 角色排序权重:基酒 → 修饰 → 酸 → 甜 → 调味 → 延长 → 质构 → 其他 */
const ROLE_ORDER: StructureRole[] = [
  "base_aged", "base_white", "base_agave", "base_liqueur", "base_wine",
  "fortified", "bitter_modifier", "acid_citrus", "acid_other",
  "sweet_syrup", "sweet_liqueur", "bitters", "lengthener_carbonated",
  "lengthener_juice", "texture_egg", "texture_dairy", "aromatic_accent",
  "dilution", "other",
];

/** 分析整份配方,返回按结构权重排序的角色列表 */
export function analyzeStructure(ingredients: Ingredient[]): StructureItem[] {
  const valid = (ingredients ?? []).filter((i) => i.name.trim());
  const maxMl = valid.reduce((m, i) => {
    const v = parseAmountLoose(i.amount ?? "");
    return v !== null && v > m ? v : m;
  }, 0);
  const items = valid.map((ing) => {
    const role = inferStructureRole(ing, maxMl);
    return { ingredient: ing, role, label: STRUCTURE_ROLE_LABELS[role] };
  });
  return items.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

/** 生成结构公式文本:陈酿烈酒基酒 (60ml) + 鲜榨柑橘酸度调节剂 (20ml) + ... */
export function structuralFormula(
  ingredients: Ingredient[],
  lang: "zh" | "en",
  formatAmount?: (amount: string) => string,
): string {
  const items = analyzeStructure(ingredients);
  if (items.length === 0) return "";
  return items
    .map((it) => {
      const label = lang === "en" ? it.label.en : it.label.zh;
      const raw = (it.ingredient.amount ?? "").trim();
      const amt = raw && formatAmount ? formatAmount(raw) : raw;
      return amt ? `${label} (${amt})` : label;
    })
    .join(" + ");
}
