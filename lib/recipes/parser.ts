import { Ingredient, genId } from "./types";
import { normalizeCodexFamilyDecl } from "./lineage";
import { buildUnitPattern, FRAC_CHARS } from "@/lib/units";

// ─── Modifier words (temperature/state/optional) ─────────────────────────────
/** Words that describe state/temperature/optionality — should NOT be parsed as amount */
export const MODIFIER_WORDS = [
  "chilled", "cold", "warm", "hot", "frozen", "iced",
  "room temperature", "room-temperature",
  "fresh", "freshly squeezed", "freshly pressed",
  "dry", "sweet", "extra dry", "extra-dry",
  "optional", "to taste", "as needed", "as desired",
  "unsalted", "salted", "smoked", "toasted", "roasted",
];

/** Regex matching a leading modifier word (case-insensitive, whole-word boundary) */
const MODIFIER_RE = new RegExp(
  `^(${MODIFIER_WORDS.map((w) => w.replace(/[-\s]/g, "[-\\s]?")).join("|")})\\b\\s*`,
  "i",
);

// ─── Title Case helper ────────────────────────────────────────────────────────
const LOWERCASE_WORDS = new Set([
  "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
  "at", "by", "in", "of", "on", "to", "up", "as", "if",
  "with", "from", "into", "onto", "over", "than", "that", "via",
]);

/**
 * Convert a string to Title Case (English only).
 * - First and last word always capitalised.
 * - Articles/prepositions/conjunctions stay lowercase unless first/last.
 * - Preserves ALL-CAPS abbreviations (e.g. "ABV").
 * - Preserves brand names with internal uppercase (e.g. "DeKuyper").
 * - Does NOT touch strings containing CJK characters.
 */
export function toTitleCase(str: string): string {
  if (!str) return str;
  if (/[\u4e00-\u9fa5\u3040-\u30ff]/.test(str)) return str;
  const words = str.split(/\s+/);
  return words
    .map((word, idx) => {
      if (!word) return word;
      if (/^[A-Z]{2,}$/.test(word)) return word;
      if (/[A-Z]/.test(word.slice(1))) return word;
      const lower = word.toLowerCase();
      if (idx === 0 || idx === words.length - 1) {
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }
      if (LOWERCASE_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** 解析结果:与表单字段对应,均为可选 */
export interface ParsedRecipe {
  name: string;
  ingredients: Ingredient[];
  steps: string;
  glass: string;
  method: string;
  garnish: string;
  baseSpirit: string;
  variantOf: string;
  /** 文本明确声明的 Codex 六大家族(已规范化为六值之一,非法为 "") */
  codexFamily: string;
  source: string;
}

/** 常见分节标题 */
const SECTION_PATTERNS: { key: keyof typeof SECTION_KEYS; re: RegExp }[] = [
  { key: "ingredients", re: /^(配料|材料|成分|原料|用料|ingredients?)\s*[::]?\s*$/i },
  { key: "steps", re: /^(做法|步骤|制作|调制|方法|instructions?|method|directions?|steps?|preparation)\s*[::]?\s*$/i },
  { key: "garnish", re: /^(装饰|garnish)\s*[::]?\s*$/i },
];

const SECTION_KEYS = {
  ingredients: "ingredients",
  steps: "steps",
  garnish: "garnish",
} as const;

/** 行内用量模式：从主别名表自动生成单位部分，确保与 canonicalizeUnit() 保持同步 */
const _amountUnitPat = buildUnitPattern();
const AMOUNT_RE = new RegExp(
  `(\\d+(?:\\.\\d+)?(?:\\s*\\/\\s*\\d+)?(?:\\s+\\d+\\s*\\/\\s*\\d+)?|[${FRAC_CHARS}]|\\d+\\s*[${FRAC_CHARS}])\\s*(${_amountUnitPat})\\b` +
  `|适量|少许|to\\s*taste|top(?:\\s*up)?|as\\s*needed`,
  "i",
);

/**
 * 杯型关键词(宽松模式:用于显式"杯型:"字段值归一化,英文可省略 glass 后缀)
 */
const GLASS_WORDS: [RegExp, string][] = [
  [/马天尼杯|martini(\s*glass)?/i, "马天尼杯"],
  [
    /古典杯|老式杯|岩石杯|rocks(\s*glass)?|old[\s-]*fashioned\s*glass|\bdof\b|double\s*old[\s-]*fashioned|lowball/i,
    "古典杯",
  ],
  [/高球杯|highball(\s*glass)?/i, "高球杯"],
  [/柯林杯|collins(\s*glass)?/i, "柯林杯"],
  [/库佩杯|碟形杯|coupe(tte)?(\s*glass)?/i, "库佩杯"],
  [/飓风杯|hurricane(\s*glass)?/i, "飓风杯"],
  [/子弹杯|shot\s*glass|shooter/i, "子弹杯"],
  [/笛型杯|香槟杯|flute(\s*glass)?|champagne\s*flute/i, "笛型杯"],
  [/郁金香杯|tulip(\s*glass)?/i, "郁金香杯"],
  [/铜杯|copper\s*mug|mule\s*mug|moscow\s*mule\s*mug/i, "铜杯"],
  [/提基杯|tiki(\s*mug)?/i, "提基杯"],
  [/尼克诺拉杯|nick\s*(&|and)\s*nora(\s*glass)?/i, "尼克诺拉杯"],
  [/朱莉普杯|julep\s*(cup|tin)/i, "朱莉普杯"],
  [/红酒杯|葡萄酒杯|wine\s*glass|goblet/i, "红酒杯"],
];

/**
 * 杯型关键词(严格模式:用于从全文推断,英文需带 glass/mug 等后缀,
 * 避免 "Martini Rosso"、"Tulip syrup" 等配料名被误判为杯型)
 */
const GLASS_WORDS_STRICT: [RegExp, string][] = [
  [/马天尼杯|martini\s*glass/i, "马天尼杯"],
  [
    /古典杯|老式杯|岩石杯|rocks\s*glass|old[\s-]*fashioned\s*glass|double\s*old[\s-]*fashioned|lowball/i,
    "古典杯",
  ],
  [/高球杯|highball(\s*glass)?/i, "高球杯"],
  [/柯林杯|collins(\s*glass)?/i, "柯林杯"],
  [/库佩杯|碟形杯|coupe(tte)?(\s*glass)?/i, "库佩杯"],
  [/飓风杯|hurricane(\s*glass)?/i, "飓风杯"],
  [/子弹杯|shot\s*glass/i, "子弹杯"],
  [/笛型杯|香槟杯|flute(\s*glass)?|champagne\s*flute/i, "笛型杯"],
  [/郁金香杯|tulip\s*glass/i, "郁金香杯"],
  [/铜杯|copper\s*mug|mule\s*mug/i, "铜杯"],
  [/提基杯|tiki\s*mug/i, "提基杯"],
  [/尼克诺拉杯|nick\s*(&|and)\s*nora(\s*glass)?/i, "尼克诺拉杯"],
  [/朱莉普杯|julep\s*(cup|tin)/i, "朱莉普杯"],
  [/红酒杯|葡萄酒杯|wine\s*glass/i, "红酒杯"],
];

/** 制作方法关键词 */
const METHOD_WORDS: [RegExp, string][] = [
  [/摇和|摇制|shake|shaken/i, "摇和"],
  [/搅拌|搅和|stir|stirred/i, "搅拌"],
  [/直调|build|built/i, "直调"],
  [/分层|layer(ed)?/i, "分层"],
  [/搅打|blend(ed)?/i, "搅打"],
];

/** 基酒关键词 */
const SPIRIT_WORDS: [RegExp, string][] = [
  [/金酒|gin/i, "金酒"],
  [/朗姆|rum/i, "朗姆"],
  [/伏特加|vodka/i, "伏特加"],
  [/威士忌|whisk(e)?y|波本|bourbon/i, "威士忌"],
  [/龙舌兰|tequila|梅斯卡尔|mezcal/i, "龙舌兰"],
  [/白兰地|brandy|干邑|cognac/i, "白兰地"],
];

/** 判断一行是否像配料行(名称 + 用量) */
export function looksLikeIngredientLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  return AMOUNT_RE.test(t);
}

/** 从配料行拆出 名称 + 用量 + 修饰词 */
export function splitIngredientLine(
  line: string,
  opts?: { lang?: "zh" | "en"; applyTitleCase?: boolean },
): { name: string; amount: string; modifier?: string; alternatives?: string[] } {
  const lang = opts?.lang ?? "zh";
  const applyTitleCase = opts?.applyTitleCase ?? (lang === "en");
  let t = line
    .trim()
    .replace(/^[-•·*▪◦●]+\s*/, "") // 去列表符号(不吞行首数字,避免破坏"2 dash xx")
    .replace(/^\d+[.、)]\s+/, "") // 去"1. / 1、/ 1) "式序号(需带分隔符+空格)
    .replace(/\s{2,}/g, " ");

  // Strip leading modifier words before trying to parse amount
  let modifier: string | undefined;
  const modMatch = t.match(MODIFIER_RE);
  if (modMatch) {
    modifier = modMatch[1].toLowerCase().replace(/[-\s]+/g, " ").trim();
    t = t.slice(modMatch[0].length).trim();
  }

  const m = t.match(AMOUNT_RE);
  if (!m) {
    const name = applyTitleCase ? toTitleCase(t) : t;
    return normalizeOrSplit({ name, amount: "", modifier }, applyTitleCase);
  }
  const amount = m[0].trim();
  // 名称 = 去掉用量后的剩余部分
  let name = t.replace(m[0], "").trim();
  name = name.replace(/^[::\-–—,,]+|[::\-–—,,]+$/g, "").trim();
  // 处理"金酒 45ml"与"45ml 金酒"两种顺序
  if (!name) {
    const fallback = applyTitleCase ? toTitleCase(t) : t;
    return normalizeOrSplit({ name: fallback, amount: "", modifier }, applyTitleCase);
  }
  if (applyTitleCase) name = toTitleCase(name);
  return normalizeOrSplit({ name, amount, modifier }, applyTitleCase);
}

// ─── or 备选识别 ──────────────────────────────────────────────────────────────

/**
 * 形容词状态词列表：这类词出现在 or 两侧时，表示同一食材的不同状态，
 * 不应产生 alternatives，而是剥离形容词后合并为同一食材名称。
 * 例："fresh or frozen cranberries" → "cranberries"（不产生备选）
 */
const STATE_ADJ_RE = /^(fresh|frozen|dried|canned|bottled|fresh-squeezed|freshly\s+squeezed|homemade|house-made|house\s+made|roasted|toasted|smoked|unsalted|salted|raw|cooked|whole|ground|crushed|powdered|pitted|peeled|sliced|diced|chopped|minced|grated|zested)$/i;

/**
 * 检测 or 两侧是否都是形容词（同一食材的不同状态）。
 * 例："fresh or frozen" → true（都是状态形容词）
 * 例："Rye Whiskey or Bourbon" → false（不同食材）
 */
function isStateAdjectivePair(parts: string[]): boolean {
  // 每个 part 的第一个词是形容词，且最后一个 part 有名词尾部
  return parts.slice(0, -1).every((p) => {
    const words = p.trim().split(/\s+/);
    return words.length === 1 && STATE_ADJ_RE.test(words[0]);
  });
}

/**
 * 对解析结果进行 or 备选规范化：
 * 1. 检测名称中是否含有 " or " / " 或 "
 * 2. 若两侧都是状态形容词 → 剥离形容词，合并为同一食材
 * 3. 否则 → 拆分为 name + alternatives
 */
function normalizeOrSplit(
  parsed: { name: string; amount: string; modifier?: string },
  applyTitleCase: boolean,
): { name: string; amount: string; modifier?: string; alternatives?: string[] } {
  const { name, amount, modifier } = parsed;
  // 检测 or / 或
  const OR_RE = /\s+(?:or|或)\s+/i;
  if (!OR_RE.test(name)) return parsed;

  const parts = name.split(OR_RE).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return parsed;

  // 形容词 or 检测：如 "fresh or frozen cranberries"
  if (isStateAdjectivePair(parts)) {
    // 取最后一个 part（含名词），剥离其开头的形容词
    const lastPart = parts[parts.length - 1];
    const lastWords = lastPart.split(/\s+/);
    const cleanName = STATE_ADJ_RE.test(lastWords[0])
      ? lastWords.slice(1).join(" ")
      : lastPart;
    const finalName = applyTitleCase ? toTitleCase(cleanName) : cleanName;
    return { name: finalName, amount, modifier };
  }

  // 普通 or 备选：name = 第一项，alternatives = 其余项
  const primaryName = applyTitleCase ? toTitleCase(parts[0]) : parts[0];
  const alts = parts.slice(1).map((p) => (applyTitleCase ? toTitleCase(p) : p));
  return { name: primaryName, amount, modifier, alternatives: alts };
}

/**
 * 对已存储的 Ingredient 进行 or 规范化（兼容旧数据）。
 * 旧数据中 name 可能含有 " or "，此函数自动拆分。
 */
export function normalizeIngredient(ing: { name: string; amount: string; alternatives?: string[] }): { name: string; amount: string; alternatives?: string[] } {
  if (ing.alternatives) return ing; // 已规范化，直接返回
  const result = normalizeOrSplit({ name: ing.name, amount: ing.amount }, false);
  return { name: result.name, amount: result.amount, alternatives: result.alternatives };
}

/**
 * 解析粘贴的配方文本,尽力提取各字段。
 * 支持两种常见格式:
 * 1. 有分节标题(配料:/做法:)
 * 2. 无标题——自动把"像配料"的行归为配料,其余归为做法
 */
export function parseRecipeText(text: string, lang?: "zh" | "en"): ParsedRecipe {
  const useTitleCase = lang === "en";
  const result: ParsedRecipe = {
    name: "",
    ingredients: [],
    steps: "",
    glass: "",
    method: "",
    garnish: "",
    baseSpirit: "",
    variantOf: "",
    codexFamily: "",
    source: "",
  };
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rawLines.length === 0) return result;

  // 行内键值:杯型:古典杯 / 装饰:橙皮 / 来源:xxx
  const kvHandlers: [RegExp, (v: string) => void][] = [
    [/^(杯型|杯具|glass(?:ware)?)\s*[::]\s*(.+)$/i, (v) => (result.glass = v)],
    [/^(装饰|garnish)\s*[::]\s*(.+)$/i, (v) => (result.garnish = v)],
    [/^(做法|方法|method)\s*[::]\s*(.+)$/i, (v) => (result.steps = result.steps ? result.steps + "\n" + v : v)],
    [/^(来源|出处|source)\s*[::]\s*(.+)$/i, (v) => (result.source = v)],
    [/^(变体|variant\s*of|变体来源)\s*[::]\s*(.+)$/i, (v) => (result.variantOf = v)],
    [
      /^(家族|六大家族|母配方|codex(?:\s*family)?|family)\s*[::]\s*(.+)$/i,
      (v) => (result.codexFamily = normalizeCodexFamilyDecl(v)),
    ],
    [/^(名称|酒名|name)\s*[::]\s*(.+)$/i, (v) => (result.name = v)],
  ];

  let section: keyof typeof SECTION_KEYS | null = null;
  const stepLines: string[] = [];
  const bodyLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // 键值行
    let handled = false;
    for (const [re, fn] of kvHandlers) {
      const m = line.match(re);
      if (m) {
        fn(m[2].trim());
        handled = true;
        break;
      }
    }
    if (handled) continue;

    // 分节标题行
    const sec = SECTION_PATTERNS.find((s) => s.re.test(line));
    if (sec) {
      section = sec.key;
      continue;
    }

    if (section === "ingredients") {
      if (looksLikeIngredientLine(line)) {
        const { name, amount, alternatives } = splitIngredientLine(line, { lang, applyTitleCase: useTitleCase });
        result.ingredients.push({ id: genId(), name, amount, ...(alternatives ? { alternatives } : {}) });
      } else {
        // 配料节中不像配料的行，可能是无用量配料（如"薄荷叶"）
        const rawName = line.replace(/^[-•·*\d]+[.、)\s]*\s*/, "");
        result.ingredients.push({ id: genId(), name: useTitleCase ? toTitleCase(rawName) : rawName, amount: "" });
      }
      continue;
    }
    if (section === "steps") {
      stepLines.push(line);
      continue;
    }
    if (section === "garnish") {
      result.garnish = result.garnish ? result.garnish + "、" + line : line;
      continue;
    }
    bodyLines.push(line);
  }

  // 无分节标题时的自动归类
  for (const line of bodyLines) {
    if (looksLikeIngredientLine(line)) {
      const { name, amount, alternatives } = splitIngredientLine(line, { lang, applyTitleCase: useTitleCase });
      result.ingredients.push({ id: genId(), name, amount, ...(alternatives ? { alternatives } : {}) });
    } else if (!result.name && line.length <= 25 && !/[。;;.]/.test(line)) {
      // 第一条简短且不含句号的行 → 酒名
      result.name = line.replace(/^[##\s]+/, "");
    } else {
      stepLines.push(line);
    }
  }

  if (stepLines.length > 0) {
    const prefix = result.steps ? result.steps + "\n" : "";
    result.steps = prefix + stepLines.join("\n");
  }

  const allText = text;
  // 杯型/方法/基酒从全文推断(若未显式给出)
  if (!result.glass) {
    const g = GLASS_WORDS_STRICT.find(([re]) => re.test(allText));
    if (g) result.glass = g[1];
  }
  // 显式给出的英文杯型也归一化为中文标签(如 "coupe" -> 库佩杯)
  if (result.glass && !/[\u4e00-\u9fa5]/.test(result.glass)) {
    const g = GLASS_WORDS.find(([re]) => re.test(result.glass));
    if (g) result.glass = g[1];
  }
  if (!result.method) {
    for (const [re, label] of METHOD_WORDS) {
      if (re.test(allText)) {
        result.method = label;
        break;
      }
    }
  }
  const ingText = result.ingredients.map((i) => i.name).join(" ");
  for (const [re, label] of SPIRIT_WORDS) {
    if (re.test(ingText)) {
      result.baseSpirit = label;
      break;
    }
  }

  return result;
}

/** 根据配料名推断基酒标签(与 parseRecipeText 同源词表);无法判断返回空串 */
export function inferBaseSpiritFromIngredients(
  ingredients: { name: string }[],
): string {
  const ingText = ingredients.map((i) => i.name).join(" ");
  for (const [re, label] of SPIRIT_WORDS) {
    if (re.test(ingText)) return label;
  }
  return "";
}
