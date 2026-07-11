// 制作工艺分类引擎:根据自制品名称/做法/备注文本的关键词自动识别制作工艺。
//
// 分类体系基于专业资料深度提炼(见 docs/technique-taxonomy-notes.md):
// - Nicolet College《Beverage Management》Ch.22 Modern Mixology & Liquid Intelligence
// - Dave Arnold《Liquid Intelligence》(rapid infusion / clarification / carbonation)
// - 88 Bamboo × Bar Trigona 访谈(fat washing / sous vide / sous pression / barrel aging)
// - SevenFifty Daily《The Science of Clarified Cocktails》(milk washing)
//
// 识别规则:特种工艺优先于通用工艺;同级按 TECHNIQUES 声明顺序。

import { HomemadePrep } from "./types";

export interface Technique {
  key: string;
  zh: string;
  en: string;
  /** 简介(用于详情展示,双语) */
  descZh: string;
  descEn: string;
  /** 匹配关键词(全部转小写比较;中文直接子串匹配) */
  keywords: string[];
  /** 优先级:数字越小越优先(特种工艺 0,加热 1,冷藏 2,常温 3) */
  tier: number;
}

export const TECHNIQUES: Technique[] = [
  {
    key: "rotovap",
    zh: "旋转蒸馏",
    en: "Rotary Evaporation",
    descZh: "真空减压低温蒸馏,捕获娇嫩香气制成风味蒸馏液,风味不受热损。",
    descEn: "Vacuum distillation at low temperature to capture delicate aromatics without heat damage.",
    keywords: ["旋转蒸馏", "旋蒸", "减压蒸馏", "重蒸馏", "rotovap", "rotary evapor", "vacuum distill", "redistill"],
    tier: 0,
  },
  {
    key: "centrifuge",
    zh: "离心分离",
    en: "Centrifuge",
    descZh: "高速旋转按密度分离固液,用于快速澄清果汁与浸渍液。",
    descEn: "High-speed spinning separates solids by density for fast clarification.",
    keywords: ["离心", "centrifug", "spin down"],
    tier: 0,
  },
  {
    key: "fat_wash",
    zh: "油脂洗",
    en: "Fat-washing",
    descZh: "脂溶性风味与烈酒融合后冷冻滤除固化油脂,得风味不得油腻(培根波本、椰子油金酒)。",
    descEn: "Infuse fat-soluble flavors, then freeze and strain out solidified fat (bacon bourbon, coconut-oil gin).",
    keywords: ["油脂洗", "脂洗", "油洗", "黄油洗", "奶洗朗姆", "fat wash", "fat-wash", "butter wash", "butter-wash", "bacon fat", "椰子油洗", "coconut oil wash"],
    tier: 0,
  },
  {
    key: "milk_wash",
    zh: "奶洗澄清",
    en: "Milk Wash / Clarification",
    descZh: "酸使奶蛋白凝结吸附杂质与单宁,滤后晶莹透亮、口感圆润,可保存数周。",
    descEn: "Acid curdles milk proteins that bind particulates and tannins; filtering yields crystal-clear, silky liquid.",
    keywords: ["奶洗", "牛奶澄清", "澄清", "凝乳", "milk wash", "milk-wash", "milk punch", "clarif", "curdle", "明胶澄清", "gelatin"],
    tier: 0,
  },
  {
    key: "rapid_infusion",
    zh: "快速风味注入",
    en: "Rapid (N2O) Infusion",
    descZh: "iSi 奶油枪 N2O 加压后急速泄压,分钟级完成萃取,适合娇嫩草本与新鲜水果。",
    descEn: "Pressurize with N2O in a whipping siphon, then vent rapidly; infuses in minutes, best for delicate herbs and fruit.",
    keywords: ["快速注入", "快速风味注入", "奶油枪", "N2O", "一氧化二氮", "isi", "rapid infusion", "pressure infusion", "whipping siphon", "siphon infusion", "加压注入"],
    tier: 0,
  },
  {
    key: "sous_pression",
    zh: "冷冻加压",
    en: "Sous Pression",
    descZh: "反向低温慢煮:真空袋冷冻产生压力压榨出风味,适合怕热的脆感水果(荔枝等)。",
    descEn: "Inverse sous vide: freezing generates pressure that leaches flavor; ideal for heat-sensitive crunchy fruit.",
    keywords: ["冷冻加压", "冻融萃取", "sous pression", "freeze-thaw", "freeze thaw"],
    tier: 0,
  },
  {
    key: "sous_vide",
    zh: "低温慢煮",
    en: "Sous Vide",
    descZh: "真空密封后精控水浴(50-60°C 萃取精细香气,1-4 小时),快速萃取且不浑浊、香气不流失。",
    descEn: "Vacuum-sealed, precisely controlled water bath (120-140°F for delicate aromatics, 1-4h); fast, clean extraction.",
    keywords: ["低温慢煮", "舒肥", "真空低温", "恒温水浴", "水浴锅", "sous vide", "sous-vide", "water bath", "immersion circulator"],
    tier: 0,
  },
  {
    key: "fermentation",
    zh: "发酵",
    en: "Fermentation",
    descZh: "微生物转化产生风味与气泡(姜汁啤酒、康普茶、自酿酒),常温数天,需消毒容器。",
    descEn: "Microbial transformation creating flavor and fizz (ginger beer, kombucha); days at room temp, sanitized vessels.",
    keywords: ["发酵", "自酿", "酵母", "菌种", "ferment", "yeast", "ginger bug", "kombucha", "康普茶", "brew"],
    tier: 0,
  },
  {
    key: "barrel_age",
    zh: "桶陈",
    en: "Barrel Aging",
    descZh: "预调酒入木桶/木盒陈放数周至数月,赋予木质香并使风味圆融。",
    descEn: "Rest pre-batched drinks in wood for weeks to months to impart oak notes and harmonize flavors.",
    keywords: ["桶陈", "入桶", "木桶陈", "过桶", "barrel", "cask", "oak age", "oak-age"],
    tier: 0,
  },
  {
    key: "carbonation",
    zh: "碳酸化",
    en: "Carbonation",
    descZh: "以 CO2 充气制作气泡饮或气泡鸡尾酒(苏打枪/加压碳酸化)。",
    descEn: "Force CO2 into liquids for sparkling drinks (soda siphon or forced carbonation).",
    keywords: ["碳酸化", "充气", "气泡化", "carbonat", "co2", "苏打枪", "sodastream", "soda siphon"],
    tier: 0,
  },
  {
    key: "smoke",
    zh: "烟熏",
    en: "Smoking",
    descZh: "烟熏枪或木片熏制,为液体或成品赋予烟熏香气。",
    descEn: "Impart smoky aromatics with a smoking gun or wood chips.",
    keywords: ["烟熏", "熏制", "smoke", "smoking gun", "smoked"],
    tier: 0,
  },
  {
    key: "acid_adjust",
    zh: "酸调",
    en: "Acid-adjusting",
    descZh: "以柠檬酸/苹果酸调整酸度或制作 super juice,延长柑橘汁寿命并稳定批次。",
    descEn: "Adjust acidity with citric/malic acid or make super juice to extend citrus shelf life.",
    keywords: ["酸调", "柠檬酸", "苹果酸", "citric acid", "malic acid", "super juice", "acid-adjust", "acid adjust"],
    tier: 0,
  },
  {
    key: "oleo",
    zh: "油糖萃取",
    en: "Oleo Saccharum",
    descZh: "糖吸附柑橘皮精油制成浓郁柑橘糖浆,19 世纪传统技法,静置数小时。",
    descEn: "Sugar draws essential oils from citrus peels into an intense syrup; a 19th-century technique.",
    keywords: ["oleo saccharum", "油糖", "糖渍果皮", "柑橘皮糖", "糖吸附"],
    tier: 0,
  },
  {
    key: "heat_cook",
    zh: "加热熬煮",
    en: "Heat / Simmer",
    descZh: "直火或加热搅拌溶解与浓缩,是糖浆类的主力工艺。",
    descEn: "Direct heat to dissolve and concentrate; the workhorse for syrups.",
    keywords: ["熬煮", "熬制", "煮沸", "小火煮", "加热搅拌", "加热至溶解", "煮", "熬", "simmer", "boil", "heat until", "heat and stir", "saucepan"],
    tier: 1,
  },
  {
    key: "cold_steep",
    zh: "冷藏静置",
    en: "Cold Steep",
    descZh: "冷藏低温慢萃(冷萃咖啡/茶、奶洗后静置),保护娇嫩风味并抑菌延长保质期。",
    descEn: "Slow extraction in the fridge (cold brew coffee/tea); protects delicate flavors and inhibits spoilage.",
    keywords: ["冷藏静置", "冷藏浸", "冷萃", "冰箱静置", "冷藏放置", "cold brew", "cold steep", "cold-steep", "refrigerate overnight", "fridge overnight", "冷藏过夜"],
    tier: 2,
  },
  {
    key: "room_steep",
    zh: "常温浸渍",
    en: "Room-temp Maceration",
    descZh: "传统常温浸泡,草本数小时、香料数天至数周,需定期尝味防过萃。",
    descEn: "Traditional ambient maceration; hours for herbs, days to weeks for spices—taste regularly.",
    keywords: ["常温浸渍", "常温静置", "常温浸泡", "室温浸", "浸泡", "浸渍", "静置", "macerate", "steep", "infuse"],
    tier: 3,
  },
];

export function techniqueLabel(key: string, lang: "zh" | "en"): string {
  const t = TECHNIQUES.find((x) => x.key === key);
  if (!t) return key;
  return lang === "en" ? t.en : t.zh;
}

export function techniqueDesc(key: string, lang: "zh" | "en"): string {
  const t = TECHNIQUES.find((x) => x.key === key);
  if (!t) return "";
  return lang === "en" ? t.descEn : t.descZh;
}

/**
 * 从自由文本中识别全部命中的工艺(按优先级 tier 升序、声明顺序稳定排序)。
 */
export function detectTechniquesInText(text: string): string[] {
  const lower = text.toLowerCase();
  if (!lower.trim()) return [];
  const hits: Technique[] = [];
  for (const tech of TECHNIQUES) {
    if (tech.keywords.some((k) => lower.includes(k.toLowerCase()))) {
      hits.push(tech);
    }
  }
  hits.sort((a, b) => a.tier - b.tier);
  return hits.map((h) => h.key);
}

/**
 * 识别自制品的制作工艺:综合名称/译名/做法/备注/储存文本。
 * 返回全部命中的工艺 key(主工艺在前);未识别返回空数组。
 */
export function detectPrepTechniques(prep: HomemadePrep): string[] {
  const text = [prep.name, prep.nameAlt, prep.recipe, prep.notes, prep.storage].join("\n");
  const found = detectTechniquesInText(text);
  // 特殊修正:类型为发酵但文本未命中时,按类型兜底
  if (found.length === 0 && prep.type === "fermented") return ["fermentation"];
  // 奶洗/澄清类型兜底
  if (found.length === 0 && prep.type === "redistilled") return ["milk_wash"];
  return found;
}

/** 主工艺(第一个命中项),未识别返回 null */
export function primaryTechnique(prep: HomemadePrep): string | null {
  const all = detectPrepTechniques(prep);
  return all.length > 0 ? all[0] : null;
}
