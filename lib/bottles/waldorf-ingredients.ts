/**
 * 《The Waldorf Astoria Bar Book》配料数据集导入模块。
 * 数据来自 assets/waldorf-ingredients.json:
 * - bottles: 481 条酒款/生鲜原料(规范中英名 + 中国电商偏低参考价)
 * - preps: 63 条自制品(糖浆等)
 * - aliasMap: 903 条"配方原始配料名 → 规范中英名"映射(双语显示用)
 * - stepsEn: 中文调制步骤/装饰句 → 英文翻译映射
 */
import type { Bottle } from "./types";
import { BOTTLE_CATEGORIES } from "./types";
import { migrateMaterialBottleV8 } from "./taxonomy";
import type { HomemadePrep } from "../homemade/types";

interface WaldorfBottleRow {
  nameEn: string;
  nameZh: string;
  category: string;
  kind: "bottle" | "fresh";
  priceCny: number | null;
  volume: string;
  note: string;
}
interface WaldorfPrepRow {
  nameEn: string;
  nameZh: string;
  category: string;
  note: string;
}
interface WaldorfIngredientData {
  bottles: WaldorfBottleRow[];
  preps: WaldorfPrepRow[];
  aliasMap: Record<string, { en: string; zh: string }>;
  stepsEn: Record<string, string>;
}
interface WaldorfFullPrepRow {
  srcName?: string;
  nameEn: string;
  nameZh: string;
  type: string;
  ingredients: string[];
  recipe: string;
  yield: string;
  shelfLife: string;
  storage: string;
  notes: string;
  source?: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DATA = require("../../assets/waldorf-ingredients.json") as WaldorfIngredientData;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FULL_PREPS = (require("../../assets/waldorf-preps.json") as { preps: WaldorfFullPrepRow[] })
  .preps;

export const WALDORF_ALIAS_MAP: Record<string, { en: string; zh: string }> = DATA.aliasMap;
export const WALDORF_STEPS_EN: Record<string, string> = DATA.stepsEn;

/** 数据源分类 → 应用酒库分类(不在 BOTTLE_CATEGORIES 内的映射到最接近项) */
const CATEGORY_MAP: Record<string, string> = {
  金酒: "金酒",
  朗姆: "朗姆",
  伏特加: "伏特加",
  威士忌: "威士忌",
  龙舌兰: "龙舌兰",
  白兰地: "白兰地",
  利口酒: "利口酒",
  苦精: "苦精",
  味美思: "味美思",
  开胃酒: "开胃酒",
  葡萄酒香槟: "葡萄酒",
  葡萄酒: "葡萄酒",
  起泡酒: "起泡酒",
  苹果酒: "葡萄酒",
  啤酒: "软饮",
  苦艾酒: "利口酒",
  糖浆: "糖浆",
  软饮: "软饮",
  水果: "果蔬",
  果汁: "果蔬",
  香草香料: "香料与草本",
  乳蛋: "乳蛋",
  其他: "其他",
};

function mapCategory(
  cat: string,
  kind: string,
  nameZh: string,
  nameEn: string,
): { category: string; style: string } {
  // 原材料(fresh 或旧材料大类):按名称关键词智能归入 v8 专业分类与子风格
  const legacyMaterial =
    kind === "fresh" || ["水果", "果汁", "香草香料", "乳蛋"].includes(cat);
  if (legacyMaterial) {
    const moved = migrateMaterialBottleV8({
      category: "原材料",
      name: nameEn,
      nameZh,
    });
    if (moved) return { category: moved.category, style: moved.style ?? "" };
  }
  const m = CATEGORY_MAP[cat];
  if (m && (BOTTLE_CATEGORIES as readonly string[]).includes(m))
    return { category: m, style: "" };
  return { category: "其他", style: "" };
}

/** 构建酒库条目(id 稳定,便于去重与幂等导入) */
export function buildWaldorfBottles(): Bottle[] {
  const now = Date.now();
  return DATA.bottles.map((b, i) => {
    const mapped = mapCategory(b.category, b.kind, b.nameZh, b.nameEn);
    return {
    id: `waldorf-b-${i}`,
    nameZh: b.nameZh,
    nameEn: b.nameEn,
    category: mapped.category,
    style: mapped.style,
    brand: "",
    origin: "",
    volume: b.volume || "",
    abv: 0,
    priceCny: typeof b.priceCny === "number" && isFinite(b.priceCny) ? b.priceCny : 0,
    notes: b.note || "",
    flavorTags: [],
    story: "",
    styleDesc: "",
    builtin: true,
    rating: null,
    sortIndex: null,
    createdAt: now + i,
    updatedAt: now + i,
    };
  });
}

/** 数据源自制分类 → PREP_TYPES key */
function mapPrepType(cat: string, nameEn: string): string {
  const n = nameEn.toLowerCase();
  if (/honey|rich|agave|maple/.test(n)) return "rich-syrup";
  if (/orgeat|almond/.test(n)) return "orgeat";
  if (/oleo/.test(n)) return "oleo";
  if (/cordial/.test(n)) return "cordial";
  if (/shrub/.test(n)) return "shrub";
  if (/juice/.test(n)) return "juice";
  if (/saline|solution|acid/.test(n)) return "solution";
  if (/infus/.test(n) || cat === "浸渍") return "infusion";
  if (/syrup/.test(n) || cat === "糖浆") return "syrup";
  return "other";
}

/** 归一化名称:去 house-made/homemade/chilled 等前缀与括号备选,便于新旧条目匹配 */
export function normalizePrepName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(house-?made|homemade|chilled|cooled|brewed)\b/g, " ")
    .replace(/\bor\b.*$/g, " ") // "simple syrup or gomme syrup" → simple syrup
    .replace(/[^a-z\u4e00-\u9fff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** 旧 63 条空壳名 → 完整数据集条目的手工映射(同物异名,书内确证) */
const OLD_TO_FULL: Record<string, string> = {
  "homemade cacao bitters": "Cocoa Bitters",
  "homemade chocolate bitters": "Cocoa Bitters",
  "homemade white cacao mix": "White Cocoa Mix",
  "chilled homemade hot/cold cocoa mix": "Hot (Cold) Cocoa Mix",
  "chocolate mix": "Hot (Cold) Cocoa Mix",
  "homemade honey ginger syrup": "Honey and Ginger Syrup",
  "homemade bacardi elixir": "Bacardi Elixir Cordial",
  "house-made raspberry syrup": "Berry Syrup (Raspberry, Strawberry, Etc.)",
  "homemade raspberry syrup": "Berry Syrup (Raspberry, Strawberry, Etc.)",
  "homemade strawberry syrup": "Berry Syrup (Raspberry, Strawberry, Etc.)",
  "gomme syrup": "Gum Syrup",
  "spiced rum infusion": "Spiced Rum Infusion (Amber Rum)",
  "henry mckenna bourbon (black cherry infused)": "Black Cherry-Infused Bourbon (Henry McKenna)",
  "chilled strawberry and pink peppercorn-infused galliano l'autentico":
    "Strawberry and Pink Peppercorn-Infused Galliano",
};

/**
 * 构建自制库条目:以书中提取的 48 条完整数据(配料/做法/产量/保存)为主体,
 * 旧 63 条名称经归一/手工映射与之合并去重;确实独立的旧条目保留为简条目。
 */
export function buildWaldorfPreps(): HomemadePrep[] {
  const now = Date.now();
  const list: HomemadePrep[] = FULL_PREPS.map((p, i) => ({
    id: `waldorf-full-${i}`,
    name: p.nameEn,
    nameAlt: p.nameZh,
    type: p.type,
    abvGroup: null,
    ingredients: p.ingredients,
    recipe: p.recipe,
    yield: p.yield,
    shelfLife: p.shelfLife,
    storage: p.storage,
    source: p.source
      ? `The Waldorf Astoria Bar Book · Frank Caiafa · ${p.source}`
      : "The Waldorf Astoria Bar Book · Frank Caiafa · Chapter 3 House-Made Recipes",
    notes: p.notes || "",
    builtin: true,
    made: false,
    rating: null,
    sortIndex: null,
    createdAt: now + i,
    updatedAt: now + i,
  }));
  const fullKeys = new Set<string>();
  for (const p of FULL_PREPS) {
    fullKeys.add(normalizePrepName(p.nameEn));
    fullKeys.add(p.nameZh.trim());
  }
  // 旧 63 条:映射/归一后已被覆盖的跳过,独有的保留为简条目
  let extra = 0;
  for (const p of DATA.preps) {
    const low = p.nameEn.trim().toLowerCase();
    if (OLD_TO_FULL[low]) continue;
    const norm = normalizePrepName(p.nameEn);
    if (fullKeys.has(norm) || fullKeys.has(p.nameZh.trim())) continue;
    // 归一名互为包含也视为同物(demerara syrup ⊂ house-made demerara syrup)
    if ([...fullKeys].some((k) => k.length > 3 && (norm.includes(k) || k.includes(norm)))) continue;
    fullKeys.add(norm);
    fullKeys.add(p.nameZh.trim());
    list.push({
      id: `waldorf-p-${extra}`,
      name: p.nameEn,
      nameAlt: p.nameZh,
      type: mapPrepType(p.category, p.nameEn),
      abvGroup: null,
      ingredients: [],
      recipe: "",
      yield: "",
      shelfLife: "",
      storage: "",
      source: "The Waldorf Astoria Bar Book · Frank Caiafa",
      notes: p.note || "",
      builtin: true,
      made: false,
      rating: null,
      sortIndex: null,
      createdAt: now + 1000 + extra,
      updatedAt: now + 1000 + extra,
    });
    extra += 1;
  }
  return list;
}

/** 供 store 做 v2 回填:按归一名/手工映射查完整条目(仅返回有做法的) */
export function findFullPrepByName(name: string): HomemadePrep | null {
  const low = name.trim().toLowerCase();
  const mapped = OLD_TO_FULL[low];
  const norm = normalizePrepName(name);
  for (const p of buildWaldorfPreps()) {
    if (!p.recipe) continue;
    if (mapped && p.name === mapped) return p;
    const pn = normalizePrepName(p.name);
    if (pn === norm || p.nameAlt.trim() === name.trim()) return p;
    if (pn.length > 3 && norm.length > 3 && (pn.includes(norm) || norm.includes(pn))) return p;
  }
  return null;
}
