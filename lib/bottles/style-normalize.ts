/**
 * 风格归一化：把 AI/外部来源返回的风格值映射到当前分类下 taxonomy 定义的规范 chip 值。
 * 规则（依次尝试）：
 * 1. 完全相等（含中文说明名 zh 相等）
 * 2. 忽略大小写、空格、斜杠间距差异后相等
 * 3. 常见别名映射（旧 Worker 值域 → 新 taxonomy 值域）
 * 4. 单向包含匹配（较长者包含较短者）
 * 未命中返回 null，调用方应把原值落入"自定义风格"输入框，不丢信息。
 */
import type { BottleStyleDef } from "./taxonomy";

const squash = (s: string) => s.toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();

/** 旧 Worker 值域及常见 AI 变体 → taxonomy name 的别名表 */
const STYLE_ALIASES: Record<string, string> = {
  "white/blanco": "White / Light", "white": "White / Light", "light": "White / Light", "blanco": "White / Light",
  "gold/oro": "Gold", "oro": "Gold",
  "dark/añejo": "Dark / Black", "dark/anejo": "Dark / Black", "dark": "Dark / Black", "black": "Dark / Black",
  "añejo": "Aged / Añejo", "anejo": "Aged / Añejo", "aged": "Aged / Añejo",
  "agricole": "Rhum Agricole Blanc", "cachaca": "Cachaça",
  "contemporary": "Contemporary / New Western", "new western": "Contemporary / New Western",
  "sloe gin": "Sloe & Flavored Gin", "compound": "Sloe & Flavored Gin",
  "rye": "Rye Whiskey", "scotch": "Scotch Blended",
  "reposado": "Tequila Reposado", "cristalino": "Tequila Cristalino", "mezcal": "Mezcal Joven",
  "apple brandy": "Apple Brandy / Applejack", "grappa": "Grappa / Pomace", "eau de vie": "Eau-de-Vie / Fruit Brandy",
  "orange liqueur": "Orange / Triple Sec", "triple sec": "Orange / Triple Sec",
  "cherry liqueur": "Cherry / Maraschino", "coffee liqueur": "Coffee", "herbal liqueur": "Herbal / Spiced",
  "cream liqueur": "Cream", "nut liqueur": "Nut", "fruit liqueur": "Fruit", "floral liqueur": "Floral",
  "anise liqueur": "Anise / Absinthe",
  "sweet vermouth": "Sweet / Rosso", "rosso": "Sweet / Rosso", "bianco": "Blanc / Bianco",
  "ambrato": "Rosé / Ambrato", "quinquina": "Quinquina / Americano", "americano": "Quinquina / Americano",
  "celery": "Celery / Savory", "chocolate": "Spice / Mole",
  "sherry fino": "Sherry Fino / Manzanilla", "port": "Port Ruby", "sauternes": "Sweet / Sauternes",
  "syrup": "Simple Syrup", "cream/foam": "Cream / Foam",
  "soda": "Soda Water", "tonic": "Tonic Water", "cola": "Cola & Soft Drinks",
};

/**
 * 把 rawStyle 归一化到 styleDefs（当前分类下的风格定义）中的规范 name。
 * @returns 命中的规范 name；未命中返回 null
 */
export function normalizeStyleToTaxonomy(
  rawStyle: string,
  styleDefs: Pick<BottleStyleDef, "name" | "zh">[],
): string | null {
  const raw = rawStyle?.trim();
  if (!raw) return null;
  // 1) 完全相等（name 或中文名）
  for (const d of styleDefs) {
    if (d.name === raw || (d.zh && d.zh === raw)) return d.name;
  }
  // 2) squash 后相等
  const target = squash(raw);
  for (const d of styleDefs) {
    if (squash(d.name) === target || (d.zh && squash(d.zh) === target)) return d.name;
  }
  // 3) 别名映射
  const alias = STYLE_ALIASES[raw.toLowerCase().trim()] ?? STYLE_ALIASES[target];
  if (alias && styleDefs.some((d) => d.name === alias)) return alias;
  // 4) 单向包含（避免过短误匹配：目标至少 3 字符）
  if (target.length >= 3) {
    for (const d of styleDefs) {
      const s = squash(d.name);
      if (s.includes(target) || target.includes(s)) return d.name;
    }
  }
  return null;
}
