// Classify an unknown recipe ingredient into one of three libraries:
//   - "bottle"   → the bottle library (spirits, liqueurs, mixers…)
//   - "material" → the raw-materials library (sugar, fruit, spice…)
//   - "homemade" → the homemade preps library (syrups, infusions, liqueurs made in-house…)
// Returns prefill data so the user can add it to the right library in one tap.
import { Bottle } from "./bottles/types";
import { migrateMaterialBottleV8 } from "./bottles/taxonomy";
import { HomemadePrep } from "./homemade/types";
import { matchPrep, suggestPrep } from "./homemade/match";

export type IngredientLibrary = "bottle" | "material" | "homemade";

export interface IngredientClassification {
  library: IngredientLibrary;
  /** Prefill: English-first name */
  name: string;
  /** Prefill: Chinese name (may be empty) */
  nameAlt: string;
  /** For bottle/material: bottle category (中文 key); for homemade: prep type key */
  category: string;
  /** Optional style suggestion for bottles/materials */
  style?: string;
  /** Confidence 0-1 (heuristic) */
  confidence: number;
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[()()【】\[\]「」]/g, " ")
    .replace(/\s+/g, " ");
}

const HAS_CJK = /[\u4e00-\u9fff]/;

/** Homemade cues: things that are made in-house rather than purchased */
const HOMEMADE_CUES: { re: RegExp; type: string }[] = [
  { re: /homemade|house[- ]?made|diy|自制|自製|现做/, type: "syrup" },
  { re: /infused|infusion|浸渍|浸泡|风味.*(伏特加|金酒|朗姆|龙舌兰|威士忌)/, type: "infusion" },
  { re: /tincture|酊剂/, type: "tincture" },
  { re: /milk[- ]?washed|奶洗|澄清/, type: "redistilled" },
  { re: /fat[- ]?washed|油洗/, type: "infusion" },
  { re: /oleo[- ]?saccharum|油糖/, type: "syrup" },
  { re: /shrub|果醋饮/, type: "shrub" },
  { re: /cordial|康迪奥/, type: "cordial" },
  { re: /(^|\s)(fresh|鲜榨|现榨).*(juice|汁)|(juice|汁)$/, type: "juice" },
  { re: /syrup|糖浆/, type: "syrup" },
  { re: /foam|espuma|泡沫/, type: "garnish-prep" },
  { re: /saline|solution|溶液|盐水/, type: "solution" },
  { re: /home.?brew|自酿/, type: "fermented" },
];

/** Bottle cues → bottle category (中文 key used by the bottle library) */
const BOTTLE_CUES: { re: RegExp; category: string; style?: string }[] = [
  { re: /\bgin\b|金酒|琴酒/, category: "金酒" },
  { re: /\brum\b|rhum|cacha[çc]a|朗姆|冧酒/, category: "朗姆" },
  { re: /vodka|伏特加/, category: "伏特加" },
  { re: /whisk(e)?y|bourbon|scotch|rye\b|威士忌|波本|黑麦/, category: "威士忌" },
  { re: /tequila|mezcal|sotol|raicilla|龙舌兰|特其拉|梅斯卡尔/, category: "龙舌兰" },
  { re: /cognac|brandy|armagnac|calvados|pisco|grappa|白兰地|干邑|皮斯科/, category: "白兰地" },
  { re: /amaro|aperitivo|fernet|aperol|campari|开胃酒|阿玛罗|金巴利/, category: "开胃酒" },
  { re: /vermouth|quinquina|americano\b|味美思|威末/, category: "味美思" },
  { re: /bitters?\b|苦精/, category: "苦精" },
  { re: /liqueur|cura[çc]ao|triple sec|amaretto|chartreuse|maraschino|利口酒|力娇/, category: "利口酒" },
  { re: /champagne|prosecco|cava|sparkling wine|香槟|普罗塞克|起泡酒/, category: "起泡酒" },
  { re: /sherry|port\b|madeira|wine\b|雪莉|波特|葡萄酒/, category: "葡萄酒" },
  { re: /sake|shochu|soju|umeshu|清酒|烧酒|梅酒/, category: "清酒烧酒" },
  { re: /baijiu|白酒|酱香|浓香/, category: "中式白酒" },
  { re: /tonic|soda\b|ginger (beer|ale)|cola|sparkling water|汤力|苏打|姜汁汽水|可乐|气泡水/, category: "软饮" },
];

/** Material cues → material style sub-category */
const MATERIAL_CUES: { re: RegExp; style: string }[] = [
  { re: /sugar|honey|agave nectar|maple|糖|蜂蜜|龙舌兰蜜|枫糖/, style: "Sugar & Sweetener" },
  { re: /lime\b|lemon\b|orange\b|grapefruit|pineapple|berry|mango|apple\b|青柠|柠檬|橙|西柚|菠萝|莓|芒果|苹果|百香果|passion/, style: "Fruit & Citrus" },
  { re: /cinnamon|clove|star anise|pepper|cardamom|ginger\b|vanilla|肉桂|丁香|八角|胡椒|豆蔻|姜|香草荚/, style: "Spice & Botanical" },
  { re: /almond|walnut|coffee|espresso|tea\b|matcha|earl grey|杏仁|核桃|咖啡|茶|抹茶/, style: "Nut / Tea / Coffee" },
  { re: /cream\b|milk\b|egg( white| yolk)?|yogurt|奶油|牛奶|蛋白|蛋黄|酸奶/, style: "Dairy & Egg" },
  { re: /citric acid|malic acid|tartaric|salt\b|柠檬酸|苹果酸|酒石酸|盐/, style: "Acid & Additive" },
  { re: /mint\b|basil|rosemary|thyme|sage|薄荷|罗勒|迷迭香|百里香|鼠尾草/, style: "Herb" },
];

/** Try to split a bilingual ingredient into EN + ZH parts */
export function splitBilingualName(raw: string): { en: string; zh: string } {
  const s = raw.trim();
  const zhMatch = s.match(/[\u4e00-\u9fff][\u4e00-\u9fff\s·、()()0-9:%.]*/g);
  const zh = (zhMatch ?? []).join(" ").trim();
  const en = s
    .replace(/[\u4e00-\u9fff·、]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { en, zh };
}

/**
 * Classify an unknown ingredient (not matched in any library).
 * Priority: homemade cues > bottle cues > material cues.
 * Fallback: alcoholic-looking → bottle/其他; otherwise material.
 */
export function classifyIngredient(ingredientName: string): IngredientClassification | null {
  const raw = norm(ingredientName);
  if (!raw || raw.replace(/[^a-z\u4e00-\u9fff]/g, "").length < 2) return null;
  const { en, zh } = splitBilingualName(ingredientName);

  // 1) Known homemade template first (rich prefill)
  const known = suggestPrep(ingredientName);
  if (known) {
    return {
      library: "homemade",
      name: known.name || en || ingredientName.trim(),
      nameAlt: known.nameAlt || zh,
      category: known.type,
      confidence: 0.9,
    };
  }

  // 2) Homemade cues (made in-house): but "X-infused gin" style stays homemade
  for (const cue of HOMEMADE_CUES) {
    if (cue.re.test(raw)) {
      return {
        library: "homemade",
        name: en || ingredientName.trim(),
        nameAlt: zh,
        category: cue.type,
        confidence: 0.75,
      };
    }
  }

  // 3) Bottle cues (purchasable alcohol & mixers)
  for (const cue of BOTTLE_CUES) {
    if (cue.re.test(raw)) {
      return {
        library: cue.category === "软饮" ? "bottle" : "bottle",
        name: en || ingredientName.trim(),
        nameAlt: zh,
        category: cue.category,
        style: cue.style,
        confidence: 0.8,
      };
    }
  }

  // 4) Material cues (raw ingredients)
  for (const cue of MATERIAL_CUES) {
    if (cue.re.test(raw)) {
      const moved = migrateMaterialBottleV8({ category: "原材料", name: en, nameZh: zh || ingredientName });
      return {
        library: "material",
        name: en || ingredientName.trim(),
        nameAlt: zh,
        category: moved?.category ?? "酸类与添加剂",
        style: moved?.style ?? cue.style,
        confidence: 0.7,
      };
    }
  }

  // 5) Weak fallback: unknown → material (most unknown recipe items are perishables)
  const fallbackMoved = migrateMaterialBottleV8({ category: "原材料", name: en, nameZh: zh || ingredientName });
  return {
    library: "material",
    name: en || ingredientName.trim(),
    nameAlt: zh,
    category: fallbackMoved?.category ?? "酸类与添加剂",
    style: fallbackMoved?.style,
    confidence: 0.3,
  };
}

/**
 * Full analysis for a recipe-form ingredient row:
 * returns null when the ingredient already exists in some library
 * (bottle / material / homemade), otherwise a classification suggestion.
 */
export function analyzeUnknownIngredient(
  ingredientName: string,
  bottles: Bottle[],
  preps: HomemadePrep[],
): IngredientClassification | null {
  const raw = norm(ingredientName);
  if (!raw || raw.replace(/[^a-z\u4e00-\u9fff]/g, "").length < 3) return null;

  // Already a homemade prep → nothing to add
  if (matchPrep(ingredientName, preps)) return null;

  // Already in bottle/material library (bidirectional containment on either name)
  const q = raw;
  const hit = bottles.some((b) => {
    const en = norm(b.nameEn);
    const zhName = norm(b.nameZh);
    // A library name contained in the query only counts when it covers most of
    // the query — otherwise "Rosemary Honey Syrup" would be swallowed by the
    // raw material "Honey".
    const enCovers = en.length >= 2 && q.includes(en) && en.length / q.length >= 0.7;
    const zhCovers =
      zhName.length >= 2 && q.includes(zhName) && zhName.length / q.replace(/\s/g, "").length >= 0.7;
    return (
      (en.length >= 2 && (en === q || enCovers || (en.includes(q) && q.length >= 3))) ||
      (zhName.length >= 2 &&
        (zhName === q || zhCovers || (zhName.includes(q) && q.length >= 2 && HAS_CJK.test(q))))
    );
  });
  if (hit) return null;

  // Generic category-level names (e.g. "Gin", "London Dry Gin", "汤力水"):
  // if the query is fully covered by a category/style keyword of an existing
  // bottle category that has entries, treat it as already available.
  const classified = classifyIngredient(ingredientName);
  if (classified && classified.library === "bottle") {
    const generic = isGenericCategoryName(raw, classified.category);
    if (generic && bottles.some((b) => b.category === classified.category)) return null;
  }
  return classified;
}

/** Generic names per bottle category: adding them as a new bottle adds no info */
const GENERIC_CATEGORY_NAMES: Record<string, RegExp> = {
  金酒: /^((london )?dry )?gin$|^金酒$|^琴酒$/,
  朗姆: /^((white|light|dark|gold|aged) )?rum$|^朗姆(酒)?$/,
  伏特加: /^vodka$|^伏特加$/,
  威士忌: /^(bourbon|rye|scotch|irish)?\s?whisk(e)?y$|^威士忌$|^波本$/,
  龙舌兰: /^(tequila|mezcal)( blanco| reposado| añejo| anejo| joven)?$|^龙舌兰(酒)?$|^梅斯卡尔$/,
  白兰地: /^(cognac|brandy)$|^白兰地$|^干邑$/,
  利口酒: /^(orange )?liqueur$|^triple sec$|^利口酒$/,
  苦精: /^(aromatic |orange )?bitters$|^苦精$/,
  味美思: /^(dry |sweet |blanc )?vermouth$|^味美思$/,
  起泡酒: /^(champagne|prosecco|cava|sparkling wine)$|^香槟$|^起泡酒$/,
  葡萄酒: /^(red |white |dry )?wine$|^sherry$|^port$|^葡萄酒$|^雪莉(酒)?$|^波特(酒)?$/,
  清酒烧酒: /^(sake|shochu|soju)$|^清酒$|^烧酒$/,
  中式白酒: /^baijiu$|^白酒$/,
  软饮: /^(tonic( water)?|soda( water)?|ginger (beer|ale)|cola|sparkling water)$|^汤力水?$|^苏打水?$|^姜汁汽水$|^可乐$|^气泡水$/,
};

function isGenericCategoryName(rawNorm: string, category: string): boolean {
  const re = GENERIC_CATEGORY_NAMES[category];
  return re ? re.test(rawNorm) : false;
}

/** @deprecated retained for API stability; use analyzeUnknownIngredient */
export function __classifyOnly(ingredientName: string): IngredientClassification | null {
  return classifyIngredient(ingredientName);
}
