/**
 * 饮用时长(短饮/长饮)与饮用场合(餐前酒/餐后酒等)自动归类引擎。
 *
 * 分类依据(专业资料):
 * - IBA 官方分类:Before Dinner / After Dinner / All Day / Longdrink
 * - 传统 apéritif(餐前开胃,干型低甜、常含苦味或加强葡萄酒)与
 *   digestif(餐后助消化,甜润浓郁、常含奶油/咖啡/阿玛罗)体系
 * - 长短饮:短饮为无兑和小容量快饮(≤120ml,3-4口),长饮为加冰
 *   大容量慢饮(高球/柯林斯/提基,含大量软饮)
 */
import type { Recipe } from "./types";

/** 长饮杯型关键词(中/英) */
const LONG_GLASSES = [
  "高球", "柯林", "飓风", "提基", "铜杯", "朱莉普", "品脱", "马克杯",
  "highball", "collins", "hurricane", "tiki", "mug", "pint", "julep",
];

/** 短饮杯型关键词 */
const SHORT_GLASSES = [
  "马天尼", "库佩", "尼克诺拉", "子弹", "笛型", "郁金香", "雪莉", "利口",
  "coupe", "martini", "nick", "shot", "flute", "cordial", "sherry",
];

/** 兑和延长类配料(大量软饮 → 长饮) */
const LENGTHENERS = [
  "苏打水", "汤力", "姜汁啤酒", "姜汁汽水", "可乐", "雪碧", "气泡水",
  "啤酒", "香槟", "起泡酒", "菠萝汁", "橙汁", "西柚汁", "蔓越莓汁", "椰浆",
  "soda", "tonic", "ginger beer", "ginger ale", "cola", "sparkling",
  "beer", "champagne", "prosecco", "pineapple juice", "orange juice",
  "grapefruit juice", "cranberry", "coconut cream", "lemonade",
];

/** 餐后特征配料:奶油/咖啡/巧克力/甜利口 → 餐后酒 */
const DIGESTIF_INGREDIENTS = [
  "奶油", "淡奶油", "牛奶", "咖啡", "可可", "巧克力", "咖啡利口",
  "白可可", "黑可可", "薄荷利口", "杏仁利口", "榛子", "蛋黄",
  "cream", "milk", "coffee", "cacao", "chocolate", "kahlua", "espresso",
  "amaretto", "frangelico", "baileys", "creme de menthe", "advocaat",
];

/** 餐前特征配料:苦味/加强酒/干型开胃 → 餐前酒 */
const APERITIF_INGREDIENTS = [
  "金巴利", "阿佩罗", "味美思", "雪莉", "菲奈特", "苦味利口", "阿玛罗",
  "龙胆", "奎宁", "苦艾酒", "杜本内", "利莱",
  "campari", "aperol", "vermouth", "sherry", "fernet", "amaro",
  "gentian", "quinquina", "absinthe", "dubonnet", "lillet", "cynar",
  "suze", "byrrh",
];

const hit = (text: string, words: string[]) => {
  const lower = text.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
};

/** 推断饮用时长:返回"短饮"/"长饮",无法判断返回 "" */
export function inferDrinkDuration(r: Pick<Recipe, "categoryId" | "glass" | "ingredients" | "method">): string {
  // 1. 原始分类直接给出答案(Waldorf 数据集)
  if (r.categoryId === "cat-waldorf-short") return "短饮";
  if (r.categoryId === "cat-waldorf-long") return "长饮";
  const glass = r.glass ?? "";
  const ingText = (r.ingredients ?? []).map((i) => `${i.name} ${i.amount}`).join(" ");
  // 2. 杯型判断
  if (hit(glass, LONG_GLASSES)) return "长饮";
  // 3. 含大量延长类软饮 → 长饮
  if (hit(ingText, LENGTHENERS)) return "长饮";
  if (hit(glass, SHORT_GLASSES)) return "短饮";
  // 4. 古典杯等其余默认短饮(总量小、不兑和)
  if (glass.trim()) return "短饮";
  // 5. 无杯型时按方法:直调多为长饮,摇和/搅拌多为短饮
  if ((r.method ?? "").includes("直调")) return "长饮";
  if ((r.method ?? "").trim()) return "短饮";
  return "";
}

/** 推断饮用场合:返回 OCCASIONS 之一,无法判断返回 "" */
export function inferOccasion(
  r: Pick<Recipe, "categoryId" | "glass" | "ingredients" | "abv" | "codexFamily">,
): string {
  // 1. 原始分类直接给出答案
  if (r.categoryId === "cat-waldorf-aperitif") return "餐前酒";
  if (r.categoryId === "cat-waldorf-digestif") return "餐后酒";
  const ingText = (r.ingredients ?? []).map((i) => i.name).join(" ");
  // 2. 餐后特征:奶油/咖啡/巧克力类
  if (hit(ingText, DIGESTIF_INGREDIENTS)) return "餐后酒";
  // 3. 餐前特征:苦味开胃/加强酒,且酒精度不高(≤ 25%)
  if (hit(ingText, APERITIF_INGREDIENTS)) {
    if (r.abv === null || r.abv <= 25) return "餐前酒";
    // 高酒精 + 苦味(如尼格罗尼变体仍算餐前;烈性搅拌型如曼哈顿归睡前)
    return hit(ingText, ["金巴利", "阿佩罗", "campari", "aperol"]) ? "餐前酒" : "睡前酒";
  }
  // 4. 提基/热带与无酒精 → 派对/全天
  if (r.categoryId === "cat-waldorf-tiki" || hit(ingText, ["椰浆", "coconut"])) return "派对酒";
  if (r.categoryId === "cat-waldorf-na") return "全天酒";
  // 5. 按 ABV:>30% 烈性慢饮 → 睡前;<15% 清爽 → 全天;其余全天
  if (typeof r.abv === "number") {
    if (r.abv >= 30) return "睡前酒";
    return "全天酒";
  }
  return "全天酒";
}

/** 为缺少归类的配方补全,返回是否有修改 */
export function classifyRecipe(r: Recipe): boolean {
  let changed = false;
  if (!r.drinkDuration) {
    const d = inferDrinkDuration(r);
    if (d) {
      r.drinkDuration = d;
      changed = true;
    }
  }
  if (!r.occasion) {
    const o = inferOccasion(r);
    if (o) {
      r.occasion = o;
      changed = true;
    }
  }
  return changed;
}
