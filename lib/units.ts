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
/** 1 dsp (dessert spoon) = 2 tsp = 10 ml */
export const ML_PER_DSP = 10;
/** 1 rinse ≈ 5 ml (absinthe/pastis rinse of a glass) */
export const ML_PER_RINSE = 5;
/** 1 scsp (scruple-spoon) = 2 dash = 1.25 ml */
export const ML_PER_SCSP = 1.25;
/** 1 part — ratio unit, not convertible to ml (context-dependent) */
export const ML_PER_PART = NaN;

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
/** 1 中国市斤 = 500 g */
export const G_PER_JIN = 500;
/** 1 中国两 = 50 g (1斤=10两) */
export const G_PER_LIANG = 50;
/** 1 中国钱 = 5 g (1两=10钱) */
export const G_PER_QIAN = 5;
/** 1 stone = 14 lb = 6350 g (英石) */
export const G_PER_STONE = 6350;
/** 1 tonne = 1,000,000 g (公吨，大宗进货) */
export const G_PER_TONNE = 1_000_000;

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
  return /\bto\s+taste\b|\bto\s+top\b|\btop\s+up\b|适量|少许|酌量|as\s+needed|a\s+bit|一点|若干|some\b|rinse/i.test(text);
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
  if (/^(斤|市斤|jin)$/.test(u)) return "斤";
  if (/^(两|市两|liang)$/.test(u)) return "两";
  if (/^(钱|市钱|qian)$/.test(u)) return "钱";
  if (/^(stone|英石)$/.test(u)) return "stone";
  if (/^(tonne|公吨|metric\s*ton)$/.test(u)) return "tonne";
  if (/^(ounce|盎司|安士)$/.test(u)) return "oz";
  if (/^(tablespoon|汤匙|大勺)$/.test(u)) return "tbsp";
  if (/^(teaspoon|茶匙|小勺)$/.test(u)) return "tsp";
  if (/^(bar\s*spoon|吧勺)$/.test(u)) return "bsp";
  if (/^(pint|品脱)$/.test(u)) return "pt";
  if (/^(quart|夸脱)$/.test(u)) return "qt";
  if (/^(gallon|加仑)$/.test(u)) return "gal";
  if (/^(cup|杯)$/.test(u)) return "cup";
  if (/^(shot|jigger)$/.test(u)) return "shot";
  if (/^(dessert[\s-]?spoon|dsp)$/.test(u)) return "dsp";
  if (/^(scruple[\s-]?spoon|scsp)$/.test(u)) return "scsp";
  if (/^(rinse)$/.test(u)) return "rinse";
  if (/^(parts?|份|比例)$/.test(u)) return "part";
  if (/^(pinch(?:es)?|撮)$/.test(u)) return "pinch";
  if (/^(splash(?:es)?)$/.test(u)) return "splash";
  if (/^(drops?|滴)$/.test(u)) return "drop";
  if (/^(dash(?:es)?|抖)$/.test(u)) return "dash";
  if (/^(个|枚|颗|粒|颗粒|pcs?|piece|pieces)$/.test(u)) return "个";
  if (/^(片|slices?|slice)$/.test(u)) return "片";
  if (/^(枝|sprigs?|sprig)$/.test(u)) return "枝";
  if (/^(块|cubes?|cube)$/.test(u)) return "块";
  if (/^(条|strips?|strip)$/.test(u)) return "条";
  if (/^(圈|wheels?|wheel)$/.test(u)) return "圈";
  if (/^(扭|twists?|twist|peels?|peel)$/.test(u)) return "扭";
  if (/^(楔|wedges?|wedge)$/.test(u)) return "楔";
  if (/^(叶|leaves?|leaf)$/.test(u)) return "叶";
  if (/^(只|eggs?|egg|whole)$/.test(u)) return "只";
  if (/^(适量|to\s+taste|as\s+needed)$/i.test(u)) return "适量";
  if (/^(少许|a\s+pinch|a\s+bit|pinch)$/i.test(u)) return "少许";
  if (/^(to\s+top|top\s+up)$/i.test(u)) return "to top";
  return unit.trim();
}

// ─── Amount split / merge ─────────────────────────────────────────────────────

/**
 * Fuzzy units that don't require a numeric quantity.
 * When selected, the quantity input should be hidden/disabled.
 */
export const FUZZY_UNITS = new Set([
  "适量", "少许", "to top", "rinse", "酌量", "to taste", "a pinch",
]);

/**
 * Split a stored amount string like "60 ml" or "1.5 oz" into
 * { qty: "60", unit: "ml" } for structured editing.
 *
 * Handles:
 * - "60 ml" → { qty: "60", unit: "ml" }
 * - "1.5oz" → { qty: "1.5", unit: "oz" }
 * - "1/2 oz" → { qty: "1/2", unit: "oz" }
 * - "1½ oz" → { qty: "1½", unit: "oz" }
 * - "适量" → { qty: "", unit: "适量" }
 * - "少许" → { qty: "", unit: "少许" }
 * - "to top" → { qty: "", unit: "to top" }
 * - "2 dash" → { qty: "2", unit: "dash" }
 * - "" → { qty: "", unit: "" }
 */
export function splitAmount(amount: string): { qty: string; unit: string } {
  const text = amount.trim();
  if (!text) return { qty: "", unit: "" };

  // Check for fuzzy-only units first (no numeric prefix expected)
  if (/^(适量|少许|酌量|to\s+taste|as\s+needed|to\s+top|top\s+up|rinse|a\s+pinch|a\s+bit)$/i.test(text)) {
    return { qty: "", unit: normalizeUnit(text) };
  }

  // Number part: integer, decimal, slash fraction, mixed fraction, Unicode fraction
  const numPart = `(?:约|~|≈)?\\s*(?:\\d+\\s*[${FRAC_CHARS}]|[${FRAC_CHARS}]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:[.,]\\d+)?)`;
  const m = text.match(new RegExp(`^(${numPart})\\s*(.*)$`, "i"));
  if (!m) return { qty: "", unit: text };

  const qty = m[1].trim();
  const unitRaw = m[2].trim();
  const unit = unitRaw ? normalizeUnit(unitRaw) : "";
  return { qty, unit };
}

/**
 * Merge qty + unit back into a canonical amount string.
 * Ensures exactly one space between number and unit.
 *
 * - ("60", "ml") → "60 ml"
 * - ("1.5", "oz") → "1.5 oz"
 * - ("", "适量") → "适量"
 * - ("2", "") → "2"
 * - ("", "") → ""
 */
export function mergeAmount(qty: string, unit: string): string {
  const q = qty.trim();
  const u = unit.trim();
  if (!q && !u) return "";
  if (!q) return u;
  if (!u) return q;
  return `${q} ${u}`;
}

// ─── Unit preset list (for UI pickers) ───────────────────────────────────────

export interface UnitPresetGroup {
  /** Group label key for i18n */
  labelKey: string;
  /** Units for Chinese locale */
  unitsZh: string[];
  /** Units for English locale (falls back to unitsZh if empty) */
  unitsEn?: string[];
  /** @deprecated Use unitsZh/unitsEn via getUnitPresetGroups(lang) */
  units: string[];
}

/**
 * Returns unit preset groups with locale-appropriate unit labels.
 * COUNT units use Chinese characters in zh mode, English abbreviations in en mode.
 * FUZZY units use Chinese in zh mode, English in en mode.
 */
export function getUnitPresetGroups(lang: "zh" | "en"): { labelKey: string; units: string[] }[] {
  return UNIT_PRESET_GROUPS.map((g) => ({
    labelKey: g.labelKey,
    units: lang === "en" && g.unitsEn ? g.unitsEn : g.unitsZh,
  }));
}

/** Mapping from internal zh storage key → en display label */
const ZH_TO_EN_UNIT: Record<string, string> = {
  "个": "pc", "片": "slice", "颗": "pcs", "枝": "sprig",
  "块": "cube", "条": "strip", "圈": "wheel", "扭": "twist",
  "楔": "wedge", "叶": "leaf", "只": "whole",
  "适量": "to taste", "少许": "a pinch",
  "斤": "jin(500g)", "两": "liang(50g)", "钱": "qian(5g)",
  "stone": "stone", "tonne": "tonne",
};

/**
 * Returns the display label for a unit in the given language.
 * Internal storage uses Chinese keys; this converts them for display.
 */
export function unitDisplayLabel(unit: string, lang: "zh" | "en"): string {
  if (lang === "en" && ZH_TO_EN_UNIT[unit]) return ZH_TO_EN_UNIT[unit];
  return unit;
}

/**
 * Grouped unit preset list for the unit picker UI.
 * Ordered from most-common to least-common within each group.
 * Source: Difford's Guide + Elemental Mixology + common bar practice.
 */
export const UNIT_PRESET_GROUPS: UnitPresetGroup[] = [
  {
    labelKey: "unit.group.liquid",
    unitsZh: ["ml", "oz", "cl", "dl", "L"],
    get units() { return this.unitsZh; },
  },
  {
    labelKey: "unit.group.weight",
    unitsZh: ["g", "kg", "斤", "两", "钱", "oz_s", "lb", "stone", "tonne"],
    unitsEn: ["g", "kg", "jin(500g)", "liang(50g)", "qian(5g)", "oz(solid)", "lb", "stone", "tonne"],
    get units() { return this.unitsZh; },
  },
  {
    labelKey: "unit.group.spoon",
    unitsZh: ["dash", "drop", "tsp", "bsp", "tbsp", "dsp", "splash", "rinse"],
    get units() { return this.unitsZh; },
  },
  {
    labelKey: "unit.group.count",
    unitsZh: ["个", "片", "颗", "枝", "块", "条", "圈", "扭", "楔", "叶", "只"],
    unitsEn: ["pc", "slice", "pcs", "sprig", "cube", "strip", "wheel", "twist", "wedge", "leaf", "whole"],
    get units() { return this.unitsZh; },
  },
  {
    labelKey: "unit.group.ratio",
    unitsZh: ["part"],
    get units() { return this.unitsZh; },
  },
  {
    labelKey: "unit.group.fuzzy",
    unitsZh: ["适量", "少许", "to top"],
    unitsEn: ["to taste", "a pinch", "to top"],
    get units() { return this.unitsZh; },
  },
];

/** Flat list of all preset units (for quick lookup, includes both zh and en variants) */
export const ALL_PRESET_UNITS: string[] = [
  ...UNIT_PRESET_GROUPS.flatMap((g) => g.unitsZh),
  ...UNIT_PRESET_GROUPS.flatMap((g) => g.unitsEn ?? []),
];
