/**
 * Shared unit conversion constants for all three parsing layers:
 * - lib/homemade/types.ts  (LEADING_QTY_RE — form split)
 * - lib/homemade/cost.ts   (parseQuantity — batch cost)
 * - lib/bottles/cost.ts    (UNIT_TO_ML — recipe cost)
 *
 * Baseline: 1 oz (liquid) = 30 ml (bartender standard)
 * All other liquid units are derived from this baseline.
 */

// ─── Liquid units → ml ────────────────────────────────────────────────────────
/** 1 fl oz = 1 oz (liquid) = 30 ml */
export const ML_PER_OZ = 30;
/** 1 cl = 10 ml (metric, independent) */
export const ML_PER_CL = 10;
/** 1 dl = 100 ml (metric, independent) */
export const ML_PER_DL = 100;
/** 1 L = 1000 ml */
export const ML_PER_L = 1000;
/** 1 tsp = oz / 6 = 5 ml */
export const ML_PER_TSP = 5;
/** 1 tbsp = oz / 2 = 15 ml */
export const ML_PER_TBSP = 15;
/** 1 bar spoon = 1 tsp = 5 ml */
export const ML_PER_BSP = 5;
/** 1 dash ≈ 0.9 ml */
export const ML_PER_DASH = 0.9;
/** 1 drop ≈ 0.05 ml */
export const ML_PER_DROP = 0.05;
/** 1 splash = 1 tbsp = 15 ml */
export const ML_PER_SPLASH = 15;
/** 1 shot / jigger = 1.5 oz = 45 ml */
export const ML_PER_SHOT = 45;
/** 1 pony = 0.75 oz = 22.5 ml */
export const ML_PER_PONY = 22.5;
/** 1 cup = 8 oz = 240 ml */
export const ML_PER_CUP = 240;
/** 1 pint = 16 oz = 480 ml */
export const ML_PER_PINT = 480;
/** 1 quart = 32 oz = 960 ml */
export const ML_PER_QUART = 960;
/** 1 gallon = 128 oz = 3840 ml */
export const ML_PER_GALLON = 3840;

// ─── Solid weight units → g ───────────────────────────────────────────────────
/** 1 g = 1 g (base) */
export const G_PER_G = 1;
/** 1 kg = 1000 g */
export const G_PER_KG = 1000;
/** 1 mg = 0.001 g */
export const G_PER_MG = 0.001;
/** 1 oz (solid/avoirdupois) = 28 g (rounded from 28.3495) */
export const G_PER_OZ_SOLID = 28;
/** 1 lb = 16 solid oz = 454 g (rounded from 453.592) */
export const G_PER_LB = 454;

// ─── Unicode fraction map ─────────────────────────────────────────────────────
/** Map of Unicode vulgar fraction characters to their decimal values */
export const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
  "⅕": 0.2,
  "⅖": 0.4,
  "⅗": 0.6,
  "⅘": 0.8,
  "⅙": 1 / 6,
  "⅚": 5 / 6,
};

/** Unicode fraction character class (for use in RegExp) */
export const FRAC_CHARS = "½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚";

// ─── Liquid keyword detector (for oz ambiguity resolution) ───────────────────
/**
 * Returns true if the ingredient line clearly refers to a liquid context,
 * used to resolve oz ambiguity (liquid oz = 30ml vs solid oz = 28g).
 */
export function isLiquidContext(line: string): boolean {
  return /juice|syrup|spirit|liqueur|bitters?|water|wine|rum|gin|vodka|tequila|whisky|whiskey|brandy|cognac|vermouth|beer|cider|水|汁|酒|糖浆|苦精/i.test(line);
}

// ─── Fuzzy unit detector ──────────────────────────────────────────────────────
/**
 * Returns true if the amount/line contains a fuzzy (unquantifiable) unit.
 * These should NOT be included in cost calculations.
 */
export function isFuzzyUnit(text: string): boolean {
  return /\bto\s+taste\b|适量|少许|酌量|as\s+needed|a\s+bit|一点|若干|some\b/i.test(text);
}

// ─── Unit normalizer ──────────────────────────────────────────────────────────
/**
 * Normalize a unit string to its canonical short form for display.
 * e.g. "tablespoon" → "tbsp", "fluid ounce" → "fl oz", "milliliter" → "ml"
 */
export function normalizeUnit(unit: string): string {
  const u = unit.trim().toLowerCase();
  if (/^(milliliter|millilitre|毫升|cc)$/.test(u)) return "ml";
  if (/^(centiliter|centilitre|厘升)$/.test(u)) return "cl";
  if (/^(deciliter|decilitre|分升)$/.test(u)) return "dl";
  if (/^(liter|litre|升)$/.test(u)) return "L";
  if (/^(kilogram|千克|公斤)$/.test(u)) return "kg";
  if (/^(milligram|毫克)$/.test(u)) return "mg";
  if (/^(gram|克)$/.test(u)) return "g";
  if (/^(pound|磅)$/.test(u)) return "lb";
  if (/^(fluid\s*ounce|fl\.?\s*oz)$/.test(u)) return "fl oz";
  if (/^(ounce|盎司|安士)$/.test(u)) return "oz";
  if (/^(tablespoon|汤匙|大勺)$/.test(u)) return "tbsp";
  if (/^(teaspoon|茶匙|小勺)$/.test(u)) return "tsp";
  if (/^(bar\s*spoon|吧勺)$/.test(u)) return "bsp";
  if (/^(pint|品脱)$/.test(u)) return "pt";
  if (/^(quart|夸脱)$/.test(u)) return "qt";
  if (/^(gallon|加仑)$/.test(u)) return "gal";
  if (/^(cup|杯)$/.test(u)) return "cup";
  if (/^(shot|jigger)$/.test(u)) return "shot";
  return unit.trim();
}
