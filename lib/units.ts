/**
 * Shared unit conversion constants and the canonical unit system.
 *
 * Architecture:
 *   UNIT_ALIAS_MAP  — master alias table: every spelling/abbreviation → CanonicalUnit key
 *   canonicalizeUnit() — single entry point for all unit recognition (case-sensitive first)
 *   CANONICAL_TO_ML / CANONICAL_TO_G — conversion tables keyed by CanonicalUnit
 *   normalizeUnit()   — display normalizer (delegates to canonicalizeUnit)
 *   splitAmount()     — qty+unit splitter (delegates to canonicalizeUnit)
 *
 * To add a new unit or alias: add ONE entry to UNIT_ALIAS_MAP. Nothing else needs changing.
 *
 * Baseline: 1 oz (liquid) = 30 ml (bartender standard)
 */

// ─── Liquid units → ml ────────────────────────────────────────────────────────
/** 1 fl oz = 1 oz (liquid) = 30 ml */
export const ML_PER_OZ = 30;
/** 1 cl = 10 ml */
export const ML_PER_CL = 10;
/** 1 dl = 100 ml */
export const ML_PER_DL = 100;
/** 1 L = 1000 ml */
export const ML_PER_L = 1000;
/** 1 tsp = 5 ml */
export const ML_PER_TSP = 5;
/** 1 tbsp = 15 ml */
export const ML_PER_TBSP = 15;
/** 1 bar spoon = 5 ml */
export const ML_PER_BSP = 5;
/** 1 dash ≈ 0.9 ml */
export const ML_PER_DASH = 0.9;
/** 1 drop ≈ 0.05 ml */
export const ML_PER_DROP = 0.05;
/** 1 splash = 15 ml */
export const ML_PER_SPLASH = 15;
/** 1 shot / jigger = 45 ml */
export const ML_PER_SHOT = 45;
/** 1 pony = 22.5 ml */
export const ML_PER_PONY = 22.5;
/** 1 cup = 240 ml */
export const ML_PER_CUP = 240;
/** 1 pint = 480 ml */
export const ML_PER_PINT = 480;
/** 1 quart = 960 ml */
export const ML_PER_QUART = 960;
/** 1 gallon = 3840 ml */
export const ML_PER_GALLON = 3840;
/** 1 dsp (dessert spoon) = 10 ml */
export const ML_PER_DSP = 10;
/** 1 rinse ≈ 5 ml */
export const ML_PER_RINSE = 5;
/** 1 scsp (scruple-spoon) = 1.25 ml */
export const ML_PER_SCSP = 1.25;
/** 1 part — ratio unit, not convertible to ml */
export const ML_PER_PART = NaN;

// ─── Solid weight units → g ───────────────────────────────────────────────────
export const G_PER_G = 1;
export const G_PER_KG = 1000;
export const G_PER_MG = 0.001;
/** 1 oz (solid/avoirdupois) = 28 g */
export const G_PER_OZ_SOLID = 28;
/** 1 lb = 454 g */
export const G_PER_LB = 454;
export const G_PER_JIN = 500;
export const G_PER_LIANG = 50;
export const G_PER_QIAN = 5;
export const G_PER_STONE = 6350;
export const G_PER_TONNE = 1_000_000;

// ─── Unicode fraction map ─────────────────────────────────────────────────────
export const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5, "¼": 0.25, "¾": 0.75,
  "⅓": 1 / 3, "⅔": 2 / 3,
  "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
  "⅙": 1 / 6, "⅚": 5 / 6,
};
export const FRAC_CHARS = "½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚";

// ─── Canonical unit keys ──────────────────────────────────────────────────────
/**
 * Internal canonical unit keys. All alias lookups resolve to one of these.
 * Storage format uses these keys (or their display labels from normalizeUnit).
 */
export type CanonicalUnit =
  // liquid precise
  | "ml" | "cl" | "dl" | "L"
  // oz variants
  | "oz" | "fl_oz"
  // US volume
  | "cup" | "pint" | "quart" | "gallon"
  // bar measures
  | "shot" | "pony"
  // spoons
  | "tbsp" | "tsp" | "bsp" | "dsp" | "scsp"
  // micro liquid
  | "dash" | "drop" | "splash" | "rinse" | "pinch"
  // weight
  | "g" | "kg" | "mg" | "lb" | "oz_s"
  // Chinese weight
  | "jin" | "liang" | "qian" | "stone" | "tonne"
  // ratio
  | "part"
  // count — individual items
  | "pc" | "slice" | "sprig" | "cube" | "strip"
  | "wheel" | "twist" | "wedge" | "leaf" | "whole"
  | "root" | "clove_c" | "handful" | "stalk" | "pod"
  | "drop_c" | "bunch" | "sheet" | "can" | "bottle_c" | "bag" | "box"
  // fuzzy
  | "fuzzy_taste" | "fuzzy_pinch" | "fuzzy_top"
  | "unknown";

// ─── Master alias table ───────────────────────────────────────────────────────
/**
 * THE single source of truth for unit recognition.
 * Keys are exact spellings (case-sensitive lookup first, then lowercase fallback).
 * To add a new alias: add one line here. Nothing else needs changing.
 *
 * Ordering note: longer/more-specific aliases are preferred because canonicalizeUnit
 * does exact string matching, not regex, so order doesn't matter here.
 */
export const UNIT_ALIAS_MAP: Record<string, CanonicalUnit> = {
  // ── ml ──────────────────────────────────────────────────────────────────────
  "ml": "ml", "mL": "ml", "ml.": "ml", "mL.": "ml",
  "milliliter": "ml", "millilitre": "ml", "milliliters": "ml", "millilitres": "ml",
  "毫升": "ml", "cc": "ml", "CC": "ml",

  // ── cl ──────────────────────────────────────────────────────────────────────
  "cl": "cl", "cL": "cl", "cl.": "cl", "cL.": "cl",
  "centiliter": "cl", "centilitre": "cl", "centiliters": "cl", "centilitres": "cl",
  "厘升": "cl",

  // ── dl ──────────────────────────────────────────────────────────────────────
  "dl": "dl", "dL": "dl", "dl.": "dl", "dL.": "dl",
  "deciliter": "dl", "decilitre": "dl", "deciliters": "dl", "decilitres": "dl",
  "分升": "dl",

  // ── L ───────────────────────────────────────────────────────────────────────
  "L": "L", "l": "L", "L.": "L", "l.": "L",
  "lt": "L", "lt.": "L", "ltr": "L", "ltr.": "L",
  "liter": "L", "litre": "L", "liters": "L", "litres": "L",
  "升": "L",

  // ── fl oz ────────────────────────────────────────────────────────────────────
  "fl oz": "fl_oz", "fl. oz": "fl_oz", "fl.oz": "fl_oz", "fl oz.": "fl_oz",
  "fl. oz.": "fl_oz", "fl.oz.": "fl_oz",
  "fluid oz": "fl_oz", "fluid oz.": "fl_oz",
  "fluid ounce": "fl_oz", "fluid ounces": "fl_oz",

  // ── oz (liquid, resolved by context) ────────────────────────────────────────
  "oz": "oz", "oz.": "oz",
  "ounce": "oz", "ounces": "oz",
  "盎司": "oz", "安士": "oz",

  // ── cup ─────────────────────────────────────────────────────────────────────
  // IMPORTANT: "c." requires the dot to avoid matching bare "c" in ingredient names
  "cup": "cup", "cups": "cup", "c.": "cup",
  "杯": "cup",

  // ── pint ────────────────────────────────────────────────────────────────────
  "pint": "pint", "pints": "pint", "pt": "pint", "pt.": "pint",
  "品脱": "pint",

  // ── quart ───────────────────────────────────────────────────────────────────
  "quart": "quart", "quarts": "quart", "qt": "quart", "qt.": "quart",
  "夸脱": "quart",

  // ── gallon ──────────────────────────────────────────────────────────────────
  "gallon": "gallon", "gallons": "gallon", "gal": "gallon", "gal.": "gallon",
  "加仑": "gallon",

  // ── shot / pony ─────────────────────────────────────────────────────────────
  "shot": "shot", "shots": "shot", "jigger": "shot", "jiggers": "shot",
  "pony": "pony",

  // ── tbsp ────────────────────────────────────────────────────────────────────
  // NOTE: "T." (uppercase) = tbsp; "t." (lowercase) = tsp — case-sensitive lookup handles this
  "tbsp": "tbsp", "tbsp.": "tbsp", "Tbsp": "tbsp", "Tbsp.": "tbsp",
  "T.": "tbsp",
  "tablespoon": "tbsp", "tablespoons": "tbsp",
  "汤匙": "tbsp", "大勺": "tbsp",

  // ── tsp ─────────────────────────────────────────────────────────────────────
  "tsp": "tsp", "tsp.": "tsp", "Tsp": "tsp", "Tsp.": "tsp",
  "t.": "tsp",
  "teaspoon": "tsp", "teaspoons": "tsp",
  "茶匙": "tsp", "小勺": "tsp",

  // ── bsp ─────────────────────────────────────────────────────────────────────
  "bsp": "bsp", "bsp.": "bsp", "bs.": "bsp",
  "bar spoon": "bsp", "bar spoons": "bsp", "barspoon": "bsp", "barspoons": "bsp",
  "吧勺": "bsp",

  // ── dsp ─────────────────────────────────────────────────────────────────────
  "dsp": "dsp", "dsp.": "dsp", "ds.": "dsp",
  "dessert spoon": "dsp", "dessert spoons": "dsp",
  "dessertspoon": "dsp", "dessertspoons": "dsp",

  // ── scsp ────────────────────────────────────────────────────────────────────
  "scsp": "scsp", "scsp.": "scsp",
  "scruple spoon": "scsp", "scruple spoons": "scsp",
  "scruplespoon": "scsp",

  // ── dash ────────────────────────────────────────────────────────────────────
  "dash": "dash", "dashes": "dash", "抖": "dash",

  // ── drop ────────────────────────────────────────────────────────────────────
  "drop": "drop", "drops": "drop", "滴": "drop",

  // ── splash ──────────────────────────────────────────────────────────────────
  "splash": "splash", "splashes": "splash",

  // ── rinse ───────────────────────────────────────────────────────────────────
  "rinse": "rinse",

  // ── pinch ───────────────────────────────────────────────────────────────────
  "pinch": "pinch", "pinches": "pinch", "撮": "pinch",

  // ── g ───────────────────────────────────────────────────────────────────────
  "g": "g", "g.": "g",
  "gr": "g", "gr.": "g",   // old-style abbreviation
  "gram": "g", "grams": "g",
  "克": "g",

  // ── kg ──────────────────────────────────────────────────────────────────────
  "kg": "kg", "kg.": "kg",
  "kilogram": "kg", "kilograms": "kg",
  "千克": "kg", "公斤": "kg",

  // ── mg ──────────────────────────────────────────────────────────────────────
  "mg": "mg", "mg.": "mg",
  "milligram": "mg", "milligrams": "mg",
  "毫克": "mg",

  // ── lb ──────────────────────────────────────────────────────────────────────
  "lb": "lb", "lb.": "lb", "lbs": "lb", "lbs.": "lb",
  "pound": "lb", "pounds": "lb",
  "磅": "lb",

  // ── oz_s (solid oz, resolved by context in normalizeIngredientAmount) ────────
  // oz itself is in "oz" key above; oz_s is used only as picker label
  "oz_s": "oz_s", "oz(solid)": "oz_s",

  // ── Chinese weight ───────────────────────────────────────────────────────────
  "斤": "jin", "市斤": "jin",
  "两": "liang", "市两": "liang",
  "钱": "qian", "市钱": "qian",
  "stone": "stone", "英石": "stone",
  "tonne": "tonne", "公吨": "tonne",

  // ── part ────────────────────────────────────────────────────────────────────
  "part": "part", "parts": "part", "份": "part", "比例": "part",

  // ── count: individual items ──────────────────────────────────────────────────
  "pc": "pc", "pcs": "pc",
  "piece": "pc", "pieces": "pc",
  "个": "pc", "枚": "pc", "粒": "pc",

  "slice": "slice", "slices": "slice",
  "片": "slice",

  "sprig": "sprig", "sprigs": "sprig",
  "枝": "sprig",

  "cube": "cube", "cubes": "cube",
  "块": "cube",

  "strip": "strip", "strips": "strip",
  "条": "strip",

  "wheel": "wheel", "wheels": "wheel",
  "圈": "wheel",

  "twist": "twist", "twists": "twist",
  "peel": "twist", "peels": "twist",
  "扭": "twist",

  "wedge": "wedge", "wedges": "wedge",
  "楔": "wedge",

  "leaf": "leaf", "leaves": "leaf",
  "叶": "leaf",

  "whole": "whole", "egg": "whole", "eggs": "whole",
  "只": "whole",

  // ── count: botanical / culinary ──────────────────────────────────────────────
  "root": "root", "roots": "root",
  "根": "root",                          // ← 新增：根（姜根、香草根等）

  "clove": "clove_c", "cloves": "clove_c",
  "瓣": "clove_c",                       // ← 新增：瓣（大蒜瓣等）

  "stalk": "stalk", "stalks": "stalk",
  "stem": "stalk", "stems": "stalk",
  "茎": "stalk", "梗": "stalk",          // ← 新增：茎/梗（芹菜梗等）

  "pod": "pod", "pods": "pod",
  "荚": "pod",                           // ← 新增：荚（香草荚等）

  "bunch": "bunch", "bunches": "bunch",
  "束": "bunch", "把": "bunch",          // ← 新增：束/把（香草束等）

  "handful": "handful",
  "一把": "handful",                     // ← 新增：一把

  "sheet": "sheet", "sheets": "sheet",
  "张": "sheet", "片张": "sheet",        // ← 新增：张（明胶片等）

  "bean": "pc", "beans": "pc",           // vanilla bean → pc
  "颗": "pc",

  // ── count: containers ────────────────────────────────────────────────────────
  "can": "can", "cans": "can",
  "听": "can", "罐": "can",              // ← 新增：听/罐

  "bottle": "bottle_c", "bottles": "bottle_c",
  "瓶": "bottle_c",                      // ← 新增：瓶

  "bag": "bag", "bags": "bag",
  "袋": "bag", "包": "bag",              // ← 新增：袋/包

  "box": "box", "boxes": "box",
  "盒": "box",                           // ← 新增：盒

  // ── fuzzy ────────────────────────────────────────────────────────────────────
  "to taste": "fuzzy_taste",
  "as needed": "fuzzy_taste",
  "as required": "fuzzy_taste",
  "适量": "fuzzy_taste",
  "酌量": "fuzzy_taste",

  "a pinch": "fuzzy_pinch",
  "a bit": "fuzzy_pinch",
  "少许": "fuzzy_pinch",

  "to top": "fuzzy_top",
  "top up": "fuzzy_top",
  "top off": "fuzzy_top",
};

// ─── Canonical unit → ml conversion ──────────────────────────────────────────
/** Returns ml per unit for liquid canonical units; NaN for non-liquid; null for unknown */
export const CANONICAL_TO_ML: Partial<Record<CanonicalUnit, number>> = {
  ml: 1, cl: ML_PER_CL, dl: ML_PER_DL, L: ML_PER_L,
  oz: ML_PER_OZ, fl_oz: ML_PER_OZ,
  cup: ML_PER_CUP,
  pint: ML_PER_PINT, quart: ML_PER_QUART, gallon: ML_PER_GALLON,
  shot: ML_PER_SHOT, pony: ML_PER_PONY,
  tbsp: ML_PER_TBSP, tsp: ML_PER_TSP, bsp: ML_PER_BSP,
  dsp: ML_PER_DSP, scsp: ML_PER_SCSP,
  dash: ML_PER_DASH, drop: ML_PER_DROP, splash: ML_PER_SPLASH,
  rinse: ML_PER_RINSE,
  pinch: ML_PER_DASH * 2,
  part: NaN,
};

// ─── Canonical unit → g conversion ───────────────────────────────────────────
export const CANONICAL_TO_G: Partial<Record<CanonicalUnit, number>> = {
  g: G_PER_G, kg: G_PER_KG, mg: G_PER_MG,
  lb: G_PER_LB, oz_s: G_PER_OZ_SOLID,
  jin: G_PER_JIN, liang: G_PER_LIANG, qian: G_PER_QIAN,
  stone: G_PER_STONE, tonne: G_PER_TONNE,
};

// ─── Core lookup function ─────────────────────────────────────────────────────
/**
 * Resolve any unit spelling to its CanonicalUnit key.
 *
 * Lookup order:
 *   1. Exact match (case-sensitive) — distinguishes "T." (tbsp) from "t." (tsp)
 *   2. Lowercase match (case-insensitive fallback)
 *   3. Strip trailing dot and retry (handles "oz." → "oz")
 *   4. Returns "unknown" if nothing matches
 */
export function canonicalizeUnit(raw: string): CanonicalUnit {
  const trimmed = raw.trim();
  if (!trimmed) return "unknown";

  // 1. Exact match (case-sensitive) — critical for T. vs t.
  if (UNIT_ALIAS_MAP[trimmed] !== undefined) return UNIT_ALIAS_MAP[trimmed];

  // 2. Lowercase fallback
  const lower = trimmed.toLowerCase();
  if (UNIT_ALIAS_MAP[lower] !== undefined) return UNIT_ALIAS_MAP[lower];

  // 3. Strip trailing dot and retry (e.g. "oz." → "oz", "tbsp." → "tbsp")
  if (trimmed.endsWith(".")) {
    const stripped = trimmed.slice(0, -1);
    if (UNIT_ALIAS_MAP[stripped] !== undefined) return UNIT_ALIAS_MAP[stripped];
    const strippedLower = stripped.toLowerCase();
    if (UNIT_ALIAS_MAP[strippedLower] !== undefined) return UNIT_ALIAS_MAP[strippedLower];
  }

  return "unknown";
}

// ─── Display label for canonical units ───────────────────────────────────────
/** Maps CanonicalUnit → short display string shown in UI */
const CANONICAL_DISPLAY: Record<CanonicalUnit, string> = {
  ml: "ml", cl: "cl", dl: "dl", L: "L",
  oz: "oz", fl_oz: "fl oz",
  cup: "cup", pint: "pt", quart: "qt", gallon: "gal",
  shot: "shot", pony: "pony",
  tbsp: "tbsp", tsp: "tsp", bsp: "bsp", dsp: "dsp", scsp: "scsp",
  dash: "dash", drop: "drop", splash: "splash", rinse: "rinse", pinch: "pinch",
  g: "g", kg: "kg", mg: "mg", lb: "lb", oz_s: "oz(s)",
  jin: "斤", liang: "两", qian: "钱", stone: "stone", tonne: "tonne",
  part: "part",
  pc: "个", slice: "片", sprig: "枝", cube: "块", strip: "条",
  wheel: "圈", twist: "扭", wedge: "楔", leaf: "叶", whole: "只",
  root: "根", clove_c: "瓣", handful: "把", stalk: "茎", pod: "荚",
  drop_c: "滴", bunch: "束", sheet: "张", can: "听", bottle_c: "瓶", bag: "袋", box: "盒",
  fuzzy_taste: "适量", fuzzy_pinch: "少许", fuzzy_top: "to top",
  unknown: "",
};

const CANONICAL_DISPLAY_EN: Partial<Record<CanonicalUnit, string>> = {
  pc: "pc", slice: "slice", sprig: "sprig", cube: "cube", strip: "strip",
  wheel: "wheel", twist: "twist", wedge: "wedge", leaf: "leaf", whole: "whole",
  root: "root", clove_c: "clove", handful: "handful", stalk: "stalk", pod: "pod",
  drop_c: "drop", bunch: "bunch", sheet: "sheet", can: "can", bottle_c: "bottle", bag: "bag", box: "box",
  jin: "jin(500g)", liang: "liang(50g)", qian: "qian(5g)",
  fuzzy_taste: "to taste", fuzzy_pinch: "a pinch", fuzzy_top: "to top",
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a raw unit string to its canonical short display form.
 * e.g. "tablespoon" → "tbsp", "c." → "cup", "T." → "tbsp", "t." → "tsp"
 */
export function normalizeUnit(unit: string, lang: "zh" | "en" = "zh"): string {
  const canonical = canonicalizeUnit(unit);
  if (canonical === "unknown") return unit.trim();
  if (lang === "en" && CANONICAL_DISPLAY_EN[canonical]) return CANONICAL_DISPLAY_EN[canonical]!;
  return CANONICAL_DISPLAY[canonical] || unit.trim();
}

/**
 * Returns true if the amount/line contains a fuzzy (unquantifiable) unit.
 */
export function isFuzzyUnit(text: string): boolean {
  return /\bto\s+taste\b|\bto\s+top\b|\btop\s+up\b|适量|少许|酌量|as\s+needed|a\s+bit|一点|若干|some\b|rinse/i.test(text);
}

/**
 * Returns true if the ingredient line clearly refers to a liquid context.
 */
export function isLiquidContext(line: string): boolean {
  return /juice|syrup|spirit|liqueur|bitters?|water|wine|rum|gin|vodka|tequila|whisky|whiskey|brandy|cognac|vermouth|beer|cider|水|汁|酒|糖浆|苦精/i.test(line);
}

/**
 * Fuzzy units that don't require a numeric quantity.
 */
export const FUZZY_UNITS = new Set([
  "适量", "少许", "to top", "rinse", "酌量", "to taste", "a pinch",
]);

/**
 * Split a stored amount string like "60 ml" or "1.5 oz" into { qty, unit }.
 * Unit is normalized via canonicalizeUnit → display label.
 */
export function splitAmount(amount: string): { qty: string; unit: string } {
  const text = amount.trim();
  if (!text) return { qty: "", unit: "" };

  // Fuzzy-only units (no numeric prefix expected)
  if (/^(适量|少许|酌量|to\s+taste|as\s+needed|to\s+top|top\s+up|rinse|a\s+pinch|a\s+bit)$/i.test(text)) {
    return { qty: "", unit: normalizeUnit(text) };
  }

  // Number part
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
 */
export function mergeAmount(qty: string, unit: string): string {
  const q = qty.trim();
  const u = unit.trim();
  if (!q && !u) return "";
  if (!q) return u;
  if (!u) return q;
  return `${q} ${u}`;
}

// ─── Unit display label (for locale-aware display) ────────────────────────────
/** Mapping from internal zh storage key → en display label (legacy compat) */
const ZH_TO_EN_UNIT: Record<string, string> = {
  "个": "pc", "片": "slice", "颗": "pcs", "枝": "sprig",
  "块": "cube", "条": "strip", "圈": "wheel", "扭": "twist",
  "楔": "wedge", "叶": "leaf", "只": "whole",
  "根": "root", "瓣": "clove", "茎": "stalk", "荚": "pod",
  "束": "bunch", "把": "handful", "张": "sheet",
  "听": "can", "瓶": "bottle", "袋": "bag", "盒": "box",
  "适量": "to taste", "少许": "a pinch",
  "斤": "jin(500g)", "两": "liang(50g)", "钱": "qian(5g)",
  "stone": "stone", "tonne": "tonne",
};

export function unitDisplayLabel(unit: string, lang: "zh" | "en"): string {
  if (lang === "en" && ZH_TO_EN_UNIT[unit]) return ZH_TO_EN_UNIT[unit];
  return unit;
}

// ─── Unit preset groups (for UI pickers) ─────────────────────────────────────

export interface UnitPresetGroup {
  labelKey: string;
  unitsZh: string[];
  unitsEn?: string[];
  /** @deprecated Use unitsZh/unitsEn via getUnitPresetGroups(lang) */
  units: string[];
}

export function getUnitPresetGroups(lang: "zh" | "en"): { labelKey: string; units: string[] }[] {
  return UNIT_PRESET_GROUPS.map((g) => ({
    labelKey: g.labelKey,
    units: lang === "en" && g.unitsEn ? g.unitsEn : g.unitsZh,
  }));
}

export const UNIT_PRESET_GROUPS: UnitPresetGroup[] = [
  {
    labelKey: "unit.group.liquid",
    unitsZh: ["ml", "oz", "cl", "dl", "L"],
    get units() { return this.unitsZh; },
  },
  {
    labelKey: "unit.group.us_volume",
    unitsZh: ["cup", "pt", "qt", "gal"],
    unitsEn: ["cup", "pt", "qt", "gal"],
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
    unitsZh: ["dash", "drop", "tsp", "bsp", "tbsp", "dsp", "splash", "rinse", "pinch"],
    get units() { return this.unitsZh; },
  },
  {
    // 计数：植物/食材类
    labelKey: "unit.group.count_botanical",
    unitsZh: ["个", "颗", "粒", "片", "根", "瓣", "枝", "叶", "茎", "荚", "束", "把"],
    unitsEn: ["pc", "pcs", "pcs", "slice", "root", "clove", "sprig", "leaf", "stalk", "pod", "bunch", "handful"],
    get units() { return this.unitsZh; },
  },
  {
    // 计数：形状/处理类
    labelKey: "unit.group.count_shape",
    unitsZh: ["块", "条", "圈", "扭", "楔", "张", "只"],
    unitsEn: ["cube", "strip", "wheel", "twist", "wedge", "sheet", "whole"],
    get units() { return this.unitsZh; },
  },
  {
    // 计数：容器类
    labelKey: "unit.group.count_container",
    unitsZh: ["听", "瓶", "袋", "盒"],
    unitsEn: ["can", "bottle", "bag", "box"],
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

export const ALL_PRESET_UNITS: string[] = [
  ...UNIT_PRESET_GROUPS.flatMap((g) => g.unitsZh),
  ...UNIT_PRESET_GROUPS.flatMap((g) => g.unitsEn ?? []),
];

/**
 * Unit preset groups for yield/output fields in homemade prep forms.
 */
export const YIELD_UNIT_PRESET_GROUPS: { labelKey: string; units: string[] }[] = [
  { labelKey: "unit.group.liquid", units: ["ml", "L", "oz", "cl"] },
  { labelKey: "unit.group.weight", units: ["g", "kg", "斤"] },
  { labelKey: "unit.group.count", units: ["个", "份", "批", "罐", "瓶", "袋", "盒"] },
];

export const ALL_YIELD_UNITS: string[] = YIELD_UNIT_PRESET_GROUPS.flatMap((g) => g.units);

export function yieldUnitDimension(unit: string): "liquid" | "weight" | "count" | "unknown" {
  const LIQUID = new Set(["ml", "L", "oz", "cl", "dl"]);
  const WEIGHT = new Set(["g", "kg", "斤", "两", "钱", "oz_s", "lb"]);
  const COUNT = new Set(["个", "份", "批", "罐", "瓶", "袋", "盒", "听", "杯"]);
  if (LIQUID.has(unit)) return "liquid";
  if (WEIGHT.has(unit)) return "weight";
  if (COUNT.has(unit)) return "count";
  return "unknown";
}

// ─── Build unit regex pattern from alias map (for parser use) ─────────────────
/**
 * Returns a regex alternation string of all known unit aliases, sorted longest-first
 * to prevent short aliases from shadowing longer ones (e.g. "t." before "tbsp").
 * Suitable for embedding in larger regexes.
 */
export function buildUnitPattern(): string {
  return Object.keys(UNIT_ALIAS_MAP)
    .sort((a, b) => b.length - a.length)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}
