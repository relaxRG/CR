// Automatic cocktail ABV estimation.
//
// Formula (industry standard, cf. Darcy O'Neil "Art of Drink" & Derek Brown /
// Epicurious ABV calculator):
//
//   ABV% = (Σ ingredient_volume × ingredient_abv) / (Σ ingredient_volume × (1 + dilution)) × 100
//
// where `dilution` is the extra water melted from ice, depending on preparation:
//   - built / poured over ice (直调):     +20%
//   - stirred with ice, served up (搅拌): +25%
//   - shaken with ice (摇和):             +30%
//   - blended / whipped (搅打):           +40%  (crushed ice)
//   - layered / no ice (分层):            +0%
//
// Ingredient ABVs come from, in priority order:
//   1) matched bottle in the bottle library (bottle.abv)
//   2) matched homemade prep (heuristic by prep type)
//   3) built-in keyword table for common ingredients
//   4) zero-ABV fallback for anything unrecognized (juice, syrup, garnish…)
import { Ingredient, Strength, StrengthBand, strengthOfBand } from "./types";
import { Bottle } from "../bottles/types";
import { matchBottle, parseAmountToMl } from "../bottles/cost";
import { HomemadePrep } from "../homemade/types";
import { matchPrep } from "../homemade/match";

/** Dilution factors by preparation method (fraction of total ingredient volume) */
export const METHOD_DILUTION: Record<string, number> = {
  摇和: 0.3, // shaken with ice
  搅拌: 0.25, // stirred with ice, served up
  直调: 0.2, // built over ice
  分层: 0, // layered, no ice
  搅打: 0.4, // blended with crushed ice
};

export function dilutionOfMethod(method: string): number {
  return METHOD_DILUTION[method] ?? 0.25;
}

/** Heuristic ABV by homemade prep type (liqueurs/infusions have alcohol) */
const PREP_TYPE_ABV: Record<string, number> = {
  liqueur: 25,
  amaro: 25,
  infusion: 40,
  tincture: 45,
  bitters: 44,
  fermented: 4,
  fortified: 17,
  redistilled: 35,
  batch: 0, // unknown mix; treated as 0 unless matched elsewhere
};

/** Extract an explicit ABV notation like "25%" / "abv 40" from prep text fields */
function abvFromPrepText(p: HomemadePrep): number | null {
  const text = `${p.name} ${p.nameAlt} ${p.notes} ${p.recipe}`;
  const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:abv|vol|酒精)?/i) || text.match(/abv\s*[:约~≈]?\s*(\d+(?:\.\d+)?)/i);
  if (m) {
    const v = Number(m[1]);
    if (isFinite(v) && v > 0 && v <= 96) return v;
  }
  return null;
}

export function abvOfPrep(p: HomemadePrep): number {
  const explicit = abvFromPrepText(p);
  if (explicit !== null) return explicit;
  return PREP_TYPE_ABV[p.type] ?? 0;
}

/** Built-in ABV keyword table for common ingredients (bilingual, specific → generic) */
const KEYWORD_ABV: [RegExp, number][] = [
  [/overproof|navy\s*strength|151/i, 60],
  [/everclear|neutral\s*(grain\s*)?spirit|食用酒精/i, 95],
  [/absinthe|苦艾酒/i, 60],
  [/chartreuse|查特/i, 55],
  [/cask\s*strength|barrel\s*proof|原桶/i, 55],
  [/\bgin\b|金酒/i, 43],
  [/\bvodka\b|伏特加/i, 40],
  [/whisk(e)?y|bourbon|\brye\b|scotch|威士忌|波本/i, 43],
  [/tequila|mezcal|龙舌兰|梅斯卡尔/i, 40],
  [/\brum\b|rhum|cachaça|cacha[cç]a|朗姆|卡莎萨/i, 40],
  [/cognac|brandy|armagnac|calvados|pisco|白兰地|干邑|皮斯科/i, 40],
  [/baijiu|白酒/i, 52],
  [/bitters|苦精/i, 44],
  [/campari|金巴利/i, 25],
  [/aperol|阿佩罗/i, 11],
  [/fernet|菲奈特/i, 39],
  [/amaro|阿玛罗/i, 28],
  [/cointreau|triple\s*sec|curacao|grand\s*marnier|橙皮利口酒|君度/i, 40],
  [/maraschino|马拉斯奇诺/i, 32],
  [/falernum|法勒南/i, 11],
  [/st[.\s-]*germain|elderflower\s*liqueur|接骨木花利口酒/i, 20],
  [/kahlua|coffee\s*liqueur|咖啡利口酒/i, 20],
  [/baileys|irish\s*cream|百利甜/i, 17],
  [/amaretto|杏仁利口酒/i, 28],
  [/liqueur|利口酒/i, 25],
  [/vermouth|味美思/i, 17],
  [/sherry|port\b|madeira|雪莉|波特|马德拉/i, 19],
  [/sake|清酒/i, 15],
  [/shochu|soju|烧酒/i, 25],
  [/umeshu|梅酒/i, 12],
  [/champagne|prosecco|cava|sparkling\s*wine|香槟|起泡酒|普罗塞克/i, 12],
  [/\bwine\b|葡萄酒|红酒|白葡萄酒/i, 13],
  [/\bbeer\b|ginger\s*beer\s*\(alcoholic\)|啤酒/i, 5],
  [/hard\s*cider|苹果酒/i, 5],
];

export function abvOfKeyword(name: string): number | null {
  const t = name.trim();
  if (!t) return null;
  // Explicit "xx%" in the ingredient name wins
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    const v = Number(pct[1]);
    if (isFinite(v) && v > 0 && v <= 96) return v;
  }
  for (const [re, abv] of KEYWORD_ABV) {
    if (re.test(t)) return abv;
  }
  return null;
}

export interface IngredientAbv {
  ingredient: Ingredient;
  /** Parsed volume in ml, null if not parseable / non-liquid */
  volumeMl: number | null;
  /** Resolved ABV %, 0 for non-alcoholic */
  abv: number;
  /** Where the ABV came from */
  source: "bottle" | "homemade" | "keyword" | "none";
}

export interface RecipeAbvEstimate {
  items: IngredientAbv[];
  /** Total ingredient volume before dilution (ml) */
  totalMl: number;
  /** Pure alcohol volume (ml) */
  alcoholMl: number;
  /** Dilution fraction applied (by method) */
  dilution: number;
  /** Final estimated ABV % after dilution, null when volume unknown */
  abv: number | null;
  /** Auto-matched strength band, null when abv unknown */
  band: StrengthBand | null;
  /** Auto-matched broad strength, null when abv unknown */
  strength: Strength | null;
}

/** Map a computed ABV% to its StrengthBand */
export function bandOfAbv(abv: number): StrengthBand {
  if (abv < 10) return "lt10";
  if (abv < 15) return "b10_15";
  if (abv < 20) return "b15_20";
  if (abv < 25) return "b20_25";
  if (abv < 30) return "b25_30";
  if (abv < 35) return "b30_35";
  return "gt35";
}

/** Amounts that are garnish-like and shouldn't count toward liquid volume */
const NON_LIQUID_RE =
  /片|个|颗|枝|块|条|只|适量|少许|叶|把|抹|圈|针|slice|wedge|sprig|lea(f|ves)|piece|cube|pinch|twist|peel|wheel|whole|rim|salt|rind|zest|mint|berr|cherr|olive|clove|small|large|toasted/i;
/** "top up" style amounts: assume a highball top of ~90ml */
const TOP_UP_RE = /to\s*top|top\s*up|加满|适量补满/i;

/**
 * Estimate the final ABV of a recipe from its ingredients.
 * Volume-weighted average of ingredient ABVs, divided by (1 + dilution).
 */
export function estimateRecipeAbv(
  ingredients: Ingredient[],
  method: string,
  bottles: Bottle[],
  preps: HomemadePrep[],
): RecipeAbvEstimate {
  const items: IngredientAbv[] = ingredients
    .filter((ing) => ing.name.trim())
    .map((ing) => {
      const name = ing.name.trim();
      const amount = ing.amount.trim();
      // Volume
      let volumeMl: number | null = null;
      if (TOP_UP_RE.test(amount)) volumeMl = 90;
      else if (!NON_LIQUID_RE.test(amount)) volumeMl = parseAmountToMl(amount);
      // ABV resolution: bottle → homemade → keyword → 0
      let abv = 0;
      let source: IngredientAbv["source"] = "none";
      const bottle = matchBottle(name, bottles);
      if (bottle && bottle.abv > 0) {
        abv = bottle.abv;
        source = "bottle";
      } else {
        const prep = matchPrep(name, preps);
        const prepAbv = prep ? abvOfPrep(prep) : 0;
        if (prep && prepAbv > 0) {
          abv = prepAbv;
          source = "homemade";
        } else {
          const kw = abvOfKeyword(name);
          if (kw !== null) {
            abv = kw;
            source = "keyword";
          }
        }
      }
      return { ingredient: ing, volumeMl, abv, source };
    });

  const withVolume = items.filter((i) => i.volumeMl !== null);
  const totalMl = withVolume.reduce((s, i) => s + (i.volumeMl ?? 0), 0);
  const alcoholMl = withVolume.reduce((s, i) => s + ((i.volumeMl ?? 0) * i.abv) / 100, 0);
  const dilution = dilutionOfMethod(method);

  // Need at least some measurable volume, and alcoholic ingredients must have volume
  if (totalMl <= 0) {
    return { items, totalMl: 0, alcoholMl: 0, dilution, abv: null, band: null, strength: null };
  }
  const abv = (alcoholMl / (totalMl * (1 + dilution))) * 100;
  const rounded = Math.round(abv * 10) / 10;
  const band = bandOfAbv(rounded);
  return {
    items,
    totalMl,
    alcoholMl,
    dilution,
    abv: rounded,
    band,
    strength: strengthOfBand(band),
  };
}
