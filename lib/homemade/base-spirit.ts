// 基酒维度识别引擎:识别含酒精自制品所用的基酒(base spirit)。
// 依据配料表(权重最高)、名称、做法文本中的关键词匹配。
import type { HomemadePrep } from "./types";

export interface BaseSpirit {
  key: string;
  zh: string;
  en: string;
  /** 匹配正则(不区分大小写) */
  re: RegExp;
}

/** 基酒清单(按常见度排序;先专后泛避免误配) */
export const BASE_SPIRITS: BaseSpirit[] = [
  { key: "gin", zh: "金酒", en: "Gin", re: /金酒|琴酒|\bgin\b/i },
  { key: "vodka", zh: "伏特加", en: "Vodka", re: /伏特加|vodka/i },
  { key: "rum", zh: "朗姆", en: "Rum", re: /朗姆|冧酒|\brum\b|rhum|cachaça|cachaca|卡莎萨/i },
  {
    key: "agave",
    zh: "龙舌兰",
    en: "Agave (Tequila/Mezcal)",
    re: /龙舌兰|特其拉|梅斯卡尔|tequila|mezcal/i,
  },
  {
    key: "whisky",
    zh: "威士忌",
    en: "Whisk(e)y",
    re: /威士忌|波本|黑麦威|苏格兰威|bourbon|whisk(?:e)?y|\brye\b|scotch/i,
  },
  {
    key: "brandy",
    zh: "白兰地",
    en: "Brandy / Cognac",
    re: /白兰地|干邑|雅文邑|皮斯科|brandy|cognac|armagnac|pisco|calvados|苹果白兰地/i,
  },
  {
    key: "baijiu-shochu",
    zh: "白酒与烧酒",
    en: "Baijiu / Shochu / Soju",
    re: /白酒|烧酒|烧酎|清酒|米酒|baijiu|shochu|soju|sake/i,
  },
  {
    key: "liqueur",
    zh: "利口酒基",
    en: "Liqueur Base",
    re: /利口酒|力娇|liqueur|苦艾酒|absinthe|金巴利|campari|阿佩罗|aperol|查特|chartreuse/i,
  },
  {
    key: "wine",
    zh: "葡萄酒与加强酒",
    en: "Wine / Fortified",
    re: /葡萄酒|红酒|白葡萄|波特|雪莉|味美思|香槟|起泡酒|\bwine\b|port\b|sherry|vermouth|champagne|prosecco/i,
  },
  {
    key: "neutral",
    zh: "中性烈酒",
    en: "Neutral Spirit",
    re: /中性烈酒|食用酒精|高度酒精|everclear|neutral (?:grain )?spirit|谷物烈酒/i,
  },
];

export function baseSpiritLabel(key: string, lang: "zh" | "en"): string {
  const s = BASE_SPIRITS.find((x) => x.key === key);
  if (!s) return key;
  return lang === "en" ? s.en : s.zh;
}

/** 从任意文本识别基酒 key 列表(按 BASE_SPIRITS 声明顺序) */
export function detectBaseSpiritsInText(text: string): string[] {
  if (!text.trim()) return [];
  return BASE_SPIRITS.filter((s) => s.re.test(text)).map((s) => s.key);
}

/**
 * 识别自制品的基酒:配料表优先(最可信),否则回退名称,再回退做法/备注。
 * 返回按声明顺序排列的 key 数组;无法识别返回空数组。
 */
export function detectPrepBaseSpirits(prep: HomemadePrep): string[] {
  const ing = detectBaseSpiritsInText(prep.ingredients.join(" "));
  if (ing.length > 0) return ing;
  const name = detectBaseSpiritsInText(`${prep.name} ${prep.nameAlt}`);
  if (name.length > 0) return name;
  return detectBaseSpiritsInText(`${prep.recipe} ${prep.notes}`);
}

/** 主基酒(第一个识别结果) */
export function primaryBaseSpirit(prep: HomemadePrep): string | null {
  return detectPrepBaseSpirits(prep)[0] ?? null;
}
