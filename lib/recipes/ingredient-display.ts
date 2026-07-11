/**
 * 配料/装饰/做法的双语显示工具。
 * 解决历史配方(如 Waldorf 数据集)中配料名混写存储、
 * 在英文界面显示中文或在中文界面显示英文的混杂问题。
 *
 * 匹配优先级:
 * 1. Waldorf 别名映射(903 条原始名 → 规范中英名)
 * 2. 酒库条目(nameZh / nameEn 双语)
 * 3. 自制库条目(name 英文 / nameAlt 中文)
 * 4. 常用调酒词词典(冷水/柠檬皮/薄荷叶等通用词)
 * 5. 回退:原文显示(不生造翻译)
 */
import { WALDORF_ALIAS_MAP, WALDORF_STEPS_EN } from "../bottles/waldorf-ingredients";
import type { Bottle } from "../bottles/types";
import type { HomemadePrep } from "../homemade/types";

export type Lang = "zh" | "en";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const hasCJK = (s: string) => /[\u4e00-\u9fa5]/.test(s);

/** 常用调酒通用词双语词典(中文 → 英文) */
const COMMON_ZH_EN: Record<string, string> = {
  冷水: "Cold Water",
  热水: "Hot Water",
  水: "Water",
  苏打水: "Soda Water",
  汤力水: "Tonic Water",
  姜汁啤酒: "Ginger Beer",
  姜汁汽水: "Ginger Ale",
  柠檬皮: "Lemon Twist",
  柠檬角: "Lemon Wedge",
  柠檬片: "Lemon Wheel",
  青柠角: "Lime Wedge",
  青柠片: "Lime Wheel",
  青柠皮: "Lime Twist",
  橙皮: "Orange Twist",
  橙片: "Orange Wheel",
  橙角: "Orange Wedge",
  薄荷叶: "Mint Leaves",
  薄荷枝: "Mint Sprig",
  蛋清: "Egg White",
  蛋黄: "Egg Yolk",
  全蛋: "Whole Egg",
  牛奶: "Milk",
  奶油: "Cream",
  重奶油: "Heavy Cream",
  肉豆蔻: "Nutmeg",
  肉桂: "Cinnamon",
  盐: "Salt",
  糖: "Sugar",
  方糖: "Sugar Cube",
  黄瓜片: "Cucumber Slice",
  樱桃: "Cherry",
  酒渍樱桃: "Brandied Cherry",
  马拉斯奇诺樱桃: "Maraschino Cherry",
  白兰地樱桃: "Brandied Cherry",
  橄榄: "Olive",
  菠萝角: "Pineapple Wedge",
  草莓: "Strawberry",
  覆盆子: "Raspberry",
  黑莓: "Blackberry",
  蓝莓: "Blueberry",
  葡萄柚皮: "Grapefruit Twist",
  西柚皮: "Grapefruit Twist",
  简单糖浆: "Simple Syrup",
  红石榴糖浆: "Grenadine",
  蜂蜜糖浆: "Honey Syrup",
  鲜柠檬汁: "Fresh Lemon Juice",
  鲜青柠汁: "Fresh Lime Juice",
  鲜橙汁: "Fresh Orange Juice",
  鲜葡萄柚汁: "Fresh Grapefruit Juice",
  菠萝汁: "Pineapple Juice",
  蔓越莓汁: "Cranberry Juice",
  番茄汁: "Tomato Juice",
  苹果汁: "Apple Juice",
  无装饰: "No garnish",
};
const COMMON_EN_ZH: Record<string, string> = Object.fromEntries(
  Object.entries(COMMON_ZH_EN).map(([zh, en]) => [norm(en), zh]),
);

/** Waldorf 别名反查索引(规范化小写名 → {en, zh}),懒构建 */
let aliasIndex: Map<string, { en: string; zh: string }> | null = null;
function getAliasIndex(): Map<string, { en: string; zh: string }> {
  if (!aliasIndex) {
    aliasIndex = new Map();
    for (const [alias, v] of Object.entries(WALDORF_ALIAS_MAP)) {
      aliasIndex.set(norm(alias), { en: v.en, zh: v.zh });
      aliasIndex.set(norm(v.en), { en: v.en, zh: v.zh });
      aliasIndex.set(norm(v.zh), { en: v.en, zh: v.zh });
    }
  }
  return aliasIndex;
}

/** 解析配料名的规范中英文名;返回 null 表示无法解析(调用方回退原文) */
export function resolveIngredientNames(
  rawName: string,
  bottles?: Bottle[],
  preps?: HomemadePrep[],
): { en: string; zh: string } | null {
  const key = norm(rawName);
  if (!key) return null;
  const hit = getAliasIndex().get(key);
  if (hit && hit.en && hit.zh) return hit;
  if (bottles) {
    const b = bottles.find((x) => norm(x.nameZh) === key || norm(x.nameEn) === key);
    if (b && b.nameZh && b.nameEn) return { en: b.nameEn, zh: b.nameZh };
  }
  if (preps) {
    const p = preps.find((x) => norm(x.name) === key || norm(x.nameAlt) === key);
    if (p && p.name && p.nameAlt) return { en: p.name, zh: p.nameAlt };
  }
  const trimmed = rawName.trim();
  if (COMMON_ZH_EN[trimmed]) return { en: COMMON_ZH_EN[trimmed], zh: trimmed };
  if (COMMON_EN_ZH[key]) return { en: trimmed, zh: COMMON_EN_ZH[key] };
  if (hit) return { en: hit.en || trimmed, zh: hit.zh || trimmed };
  return null;
}

/** 按界面语言返回配料显示名(无法解析时返回原文) */
export function ingredientDisplayName(
  rawName: string,
  lang: Lang,
  bottles?: Bottle[],
  preps?: HomemadePrep[],
): string {
  const r = resolveIngredientNames(rawName, bottles, preps);
  if (!r) return rawName;
  return lang === "en" ? r.en || r.zh || rawName : r.zh || r.en || rawName;
}

/** 装饰文本按语言显示:整体解析,失败则按分隔符逐段解析 */
export function garnishDisplayText(
  raw: string,
  lang: Lang,
  bottles?: Bottle[],
  preps?: HomemadePrep[],
): string {
  const t = raw.trim();
  if (!t) return t;
  if (lang === "zh" && hasCJK(t) && !/[A-Za-z]{3,}/.test(t)) return t;
  if (lang === "en" && !hasCJK(t)) return t;
  if (lang === "en" && WALDORF_STEPS_EN[t]) return WALDORF_STEPS_EN[t];
  const whole = resolveIngredientNames(t, bottles, preps);
  if (whole) return lang === "en" ? whole.en || t : whole.zh || t;
  const parts = t.split(/([,,;;、/]|\s+和\s+|\s+and\s+)/);
  let changed = false;
  const out = parts.map((seg) => {
    if (!seg || /^[,,;;、/]$/.test(seg) || /^\s+(和|and)\s+$/.test(seg)) return seg;
    const r = resolveIngredientNames(seg, bottles, preps);
    if (r) {
      changed = true;
      return lang === "en" ? r.en || seg : r.zh || seg;
    }
    return seg;
  });
  return changed ? out.join("") : t;
}

/** 做法步骤按语言显示:英文界面逐行查翻译映射,查不到的行保留原文 */
export function stepsDisplayText(raw: string, lang: Lang): string {
  if (lang !== "en") return raw;
  const lines = raw.split("\n");
  return lines
    .map((ln) => {
      const t = ln.trim();
      if (!t || !hasCJK(t)) return ln;
      return WALDORF_STEPS_EN[t] ?? ln;
    })
    .join("\n");
}

