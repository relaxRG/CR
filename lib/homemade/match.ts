// Match recipe ingredients against the homemade preps library (bilingual fuzzy match),
// and suggest quick-add templates for common homemade products not yet in the library.
import { HomemadePrep } from "./types";

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[()()【】\[\]「」]/g, " ")
    .replace(/\s+/g, " ");
}

/** Strip common qualifiers that don't affect identity */
function stripQualifiers(s: string): string {
  return s
    .replace(/\b(fresh|homemade|house[- ]?made|diy|自制|自製|鲜榨|新鲜|现做)\b/g, "")
    .replace(/自制|鲜榨|新鲜|现做/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 从配料名中提取变体暗示词：检查 preps 中所有 variantLabel，
 * 若配料名包含某个 variantLabel，返回该 label（用于同名变体精细匹配）。
 */
export function extractVariantHint(name: string, preps: HomemadePrep[]): string | undefined {
  const n = norm(name);
  for (const p of preps) {
    if (p.variantLabel) {
      const label = norm(p.variantLabel);
      if (label && n.includes(label)) return p.variantLabel;
    }
  }
  return undefined;
}

/**
 * 同物异名别名表(《Waldorf》书内确证):
 * 配料名匹配左侧正则时,直接链接到英文名含右侧关键词的自制条目。
 */
const PREP_ALIASES: [RegExp, string][] = [
  [/raspberry syrup|覆盆子糖浆/, "berry syrup"],
  [/strawberry syrup|草莓糖浆/, "berry syrup"],
  [/blackberry syrup|黑莓糖浆/, "berry syrup"],
  [/可可粉混合物|可可混合物|cocoa mix(?!.*white)|hot.*cocoa|冷热可可/, "hot (cold) cocoa mix"],
  [/gomme syrup|gum syrup|阿拉伯胶糖浆/, "gum syrup"],
  [/chocolate bitters|巧克力苦精(?!.*fee)/, "cocoa bitters"],
];

/**
 * Match an ingredient name against homemade preps.
 * Checks both name (English-first) and nameAlt (Chinese) with bidirectional containment.
 */
/**
 * Match an ingredient name against homemade preps.
 * @param variantHint 可选变体暗示词，用于同名变体的第二轮精细匹配
 */
export function matchPrep(
  ingredientName: string,
  preps: HomemadePrep[],
  variantHint?: string,
): HomemadePrep | null {
  const raw = norm(ingredientName);
  if (!raw || raw.length < 2) return null;
  for (const [re, target] of PREP_ALIASES) {
    if (re.test(raw)) {
      const hit = preps.find((p) => p.name.toLowerCase().includes(target));
      if (hit) return hit;
    }
  }
  const stripped = stripQualifiers(raw);
  const queries = stripped && stripped !== raw ? [raw, stripped] : [raw];

  let best: HomemadePrep | null = null;
  let bestScore = 0;
  const scored: { prep: HomemadePrep; score: number }[] = [];
  for (const p of preps) {
    const candidates = [p.name, p.nameAlt]
      .map(norm)
      .filter((c) => c.length >= 2)
      .flatMap((c) => {
        const cs = stripQualifiers(c);
        return cs && cs !== c ? [c, cs] : [c];
      });
    for (const c of candidates) {
      for (const q of queries) {
        let score = 0;
        if (c === q) score = 1000;
        else if (q.includes(c)) score = 100 + c.length;
        else if (c.includes(q) && q.length >= 4 && q.length / c.length >= 0.5) score = 50 + q.length;
        else if (c.includes(q) && /[\u4e00-\u9fff]/.test(q) && q.length >= 3) score = 50 + q.length;
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
        if (score > 0) scored.push({ prep: p, score });
      }
    }
  }
  if (bestScore < 54) return null;

  // 收集接近最高分的候选（90% 阈值），检查是否有同名变体需要区分
  const threshold = bestScore * 0.9;
  const topCandidates = scored.filter((s) => s.score >= threshold);
  const uniquePreps = [...new Map(topCandidates.map((s) => [s.prep.id, s.prep])).values()];

  // 只有一个候选，直接返回（现有行为）
  if (uniquePreps.length === 1) return uniquePreps[0];

  // 多个同名变体：用 variantHint 做第二轮精细匹配
  const hint = variantHint ?? extractVariantHint(ingredientName, uniquePreps);
  if (hint) {
    const hintNorm = norm(hint);
    const byLabel = uniquePreps.find(
      (p) => p.variantLabel && norm(p.variantLabel).includes(hintNorm),
    );
    if (byLabel) return byLabel;
  }

  // 无法区分：优先返回无 variantLabel 的（"默认版本"语义），否则返回最高分
  return uniquePreps.find((p) => !p.variantLabel) ?? best;
}

export interface PrepSuggestion {
  /** Prefill values for the homemade form */
  name: string;
  nameAlt: string;
  type: string;
  /** Suggested section in the homemade library */
  section: string;
}

/**
 * Well-known homemade products: if an ingredient looks like one of these
 * but has no match in the library, offer a one-tap "add to homemade" action.
 */
const KNOWN_PREPS: { re: RegExp; name: string; nameAlt: string; type: string; section: string }[] = [
  // ── 糖浆 Syrups ──────────────────────────────────────────────────────
  { re: /simple syrup|单糖浆|糖浆.*1:1|1:1.*糖浆/, name: "Simple Syrup (1:1)", nameAlt: "单糖浆(1:1)", type: "syrup", section: "homemade-syrup" },
  { re: /rich (simple )?syrup|浓糖浆|2:1.*糖浆/, name: "Rich Simple Syrup (2:1)", nameAlt: "浓糖浆(2:1)", type: "syrup", section: "homemade-syrup" },
  { re: /oleo[- ]?saccharum|油糖/, name: "Oleo Saccharum", nameAlt: "柑橘油糖", type: "oleo", section: "homemade-syrup" },
  { re: /orgeat|杏仁糖浆|杏仁奶/, name: "Orgeat", nameAlt: "杏仁糖浆", type: "orgeat", section: "homemade-syrup" },
  { re: /demerara syrup|德梅拉拉糖浆|粗糖糖浆/, name: "Demerara Syrup (2:1)", nameAlt: "德梅拉拉糖浆(2:1)", type: "caramel-syrup", section: "homemade-syrup" },
  { re: /honey syrup|蜂蜜糖浆/, name: "Honey Syrup (3:1)", nameAlt: "蜂蜜糖浆(3:1)", type: "syrup", section: "homemade-syrup" },
  { re: /ginger syrup|姜糖浆|薑糖漿/, name: "Ginger Syrup", nameAlt: "姜糖浆", type: "spiced-syrup", section: "homemade-syrup" },
  { re: /grenadine|红石榴糖浆|石榴糖浆/, name: "Grenadine", nameAlt: "红石榴糖浆", type: "fruit-syrup", section: "homemade-syrup" },
  { re: /cinnamon syrup|肉桂糖浆/, name: "Cinnamon Syrup", nameAlt: "肉桂糖浆", type: "spiced-syrup", section: "homemade-syrup" },
  { re: /vanilla syrup|香草糖浆/, name: "Vanilla Syrup", nameAlt: "香草糖浆", type: "spiced-syrup", section: "homemade-syrup" },
  { re: /raspberry syrup|覆盆子糖浆/, name: "Raspberry Syrup", nameAlt: "覆盆子糖浆", type: "fruit-syrup", section: "homemade-syrup" },
  { re: /passion ?fruit syrup|百香果糖浆/, name: "Passion Fruit Syrup", nameAlt: "百香果糖浆", type: "fruit-syrup", section: "homemade-syrup" },
  { re: /agave syrup|龙舌兰糖浆/, name: "Agave Syrup", nameAlt: "龙舌兰糖浆", type: "syrup", section: "homemade-syrup" },
  { re: /caramel syrup|焦糖糖浆/, name: "Caramel Syrup", nameAlt: "焦糖糖浆", type: "caramel-syrup", section: "homemade-syrup" },
  { re: /coffee syrup|咖啡糖浆/, name: "Coffee Syrup", nameAlt: "咖啡糖浆", type: "coffee-tea-syrup", section: "homemade-syrup" },
  { re: /tea syrup|茶糖浆/, name: "Tea Syrup", nameAlt: "茶糖浆", type: "coffee-tea-syrup", section: "homemade-syrup" },
  { re: /lavender syrup|薰衣草糖浆/, name: "Lavender Syrup", nameAlt: "薰衣草糖浆", type: "floral-syrup", section: "homemade-syrup" },
  { re: /rose syrup|玫瑰糖浆/, name: "Rose Syrup", nameAlt: "玫瑰糖浆", type: "floral-syrup", section: "homemade-syrup" },
  { re: /hibiscus syrup|洛神花糖浆/, name: "Hibiscus Syrup", nameAlt: "洛神花糖浆", type: "floral-syrup", section: "homemade-syrup" },
  { re: /elderflower syrup|接骨木花糖浆/, name: "Elderflower Syrup", nameAlt: "接骨木花糖浆", type: "floral-syrup", section: "homemade-syrup" },
  { re: /floral syrup|花卉糖浆/, name: "", nameAlt: "", type: "floral-syrup", section: "homemade-syrup" },
  { re: /strawberry syrup|草莓糖浆/, name: "Strawberry Syrup", nameAlt: "草莓糖浆", type: "fruit-syrup", section: "homemade-syrup" },
  { re: /peach syrup|桃子糖浆/, name: "Peach Syrup", nameAlt: "桃子糖浆", type: "fruit-syrup", section: "homemade-syrup" },
  { re: /mango syrup|芒果糖浆/, name: "Mango Syrup", nameAlt: "芒果糖浆", type: "fruit-syrup", section: "homemade-syrup" },
  { re: /fruit syrup|果味糖浆/, name: "", nameAlt: "", type: "fruit-syrup", section: "homemade-syrup" },
  { re: /cardamom syrup|豆蔻糖浆/, name: "Cardamom Syrup", nameAlt: "豆蔻糖浆", type: "spiced-syrup", section: "homemade-syrup" },
  { re: /spiced syrup|香料糖浆/, name: "", nameAlt: "", type: "spiced-syrup", section: "homemade-syrup" },
  { re: /herbal syrup|草本糖浆/, name: "", nameAlt: "", type: "herbal-syrup", section: "homemade-syrup" },
  { re: /\bsyrup\b|糖浆/, name: "", nameAlt: "", type: "syrup", section: "homemade-syrup" },
  // ── 鲜榨与康迪奥 Juices & Cordials ───────────────────────────────────
  { re: /falernum|法勒南/, name: "Falernum", nameAlt: "法勒南香料糖浆", type: "falernum", section: "juice-cordial" },
  { re: /lime cordial|青柠康迪奥|青柠糖浆/, name: "Lime Cordial", nameAlt: "青柠康迪奥", type: "cordial", section: "juice-cordial" },
  { re: /elderflower cordial|接骨木花康迪奥/, name: "Elderflower Cordial", nameAlt: "接骨木花康迪奥", type: "cordial", section: "juice-cordial" },
  { re: /\bcordial\b|康迪奥/, name: "", nameAlt: "", type: "cordial", section: "juice-cordial" },
  { re: /super[- ]?juice|超级果汁/, name: "", nameAlt: "", type: "super-juice", section: "juice-cordial" },
  { re: /clarified juice|澄清果汁/, name: "", nameAlt: "", type: "clarified-juice", section: "juice-cordial" },
  { re: /acid[- ]?adjusted juice|酸度调整汁/, name: "", nameAlt: "", type: "acid-adjusted", section: "juice-cordial" },
  { re: /saline solution|salt solution|盐溶液|盐水/, name: "Saline Solution (20%)", nameAlt: "盐溶液(20%)", type: "solution", section: "juice-cordial" },
  { re: /citric acid solution|柠檬酸溶液/, name: "Citric Acid Solution", nameAlt: "柠檬酸溶液", type: "solution", section: "juice-cordial" },
  { re: /tartaric acid|酒石酸溶液/, name: "Tartaric Acid Solution", nameAlt: "酒石酸溶液", type: "solution", section: "juice-cordial" },
  { re: /malic acid|苹果酸溶液/, name: "Malic Acid Solution", nameAlt: "苹果酸溶液", type: "solution", section: "juice-cordial" },
  { re: /\bsolution\b|溶液/, name: "", nameAlt: "", type: "solution", section: "juice-cordial" },
  { re: /fresh juice|鲜榨汁|freshly squeezed/, name: "", nameAlt: "", type: "juice", section: "juice-cordial" },
  // ── 醋饮 Shrubs & Vinegars ────────────────────────────────────────────
  { re: /lacto[- ]?fermented? (drink|beverage)|乳酸发酵饮/, name: "", nameAlt: "", type: "lacto-ferment-drink", section: "shrub-vinegar" },
  { re: /drinking vinegar|果醋饮|shrub/, name: "Shrub", nameAlt: "果醋饮", type: "shrub", section: "shrub-vinegar" },
  // ── 苦精与酊剂 Bitters & Tinctures ──────────────────────────────────
  { re: /citrus bitters|柑橘苦精/, name: "Citrus Bitters", nameAlt: "柑橘苦精", type: "citrus-bitters", section: "bitters-tincture" },
  { re: /aromatic bitters|芳香苦精/, name: "Aromatic Bitters", nameAlt: "芳香苦精", type: "aromatic-bitters", section: "bitters-tincture" },
  { re: /herbal bitters|草本苦精/, name: "Herbal Bitters", nameAlt: "草本苦精", type: "herbal-bitters", section: "bitters-tincture" },
  { re: /orange bitters|橙味苦精/, name: "Orange Bitters", nameAlt: "自制橙味苦精", type: "citrus-bitters", section: "bitters-tincture" },
  { re: /lemon bitters|柠檬苦精/, name: "Lemon Bitters", nameAlt: "柠檬苦精", type: "citrus-bitters", section: "bitters-tincture" },
  { re: /pepsin bitters|胃蛋白酶苦精/, name: "Pepsin Bitters", nameAlt: "胃蛋白酶苦精", type: "bitters", section: "bitters-tincture" },
  { re: /chocolate bitters|cocoa bitters|巧克力苦精|可可苦精/, name: "Chocolate Bitters", nameAlt: "巧克力苦精", type: "bitters", section: "bitters-tincture" },
  { re: /mole bitters|墨西哥辣椒苦精/, name: "Mole Bitters", nameAlt: "墨西哥辣椒苦精", type: "bitters", section: "bitters-tincture" },
  { re: /walnut bitters|核桃苦精/, name: "Walnut Bitters", nameAlt: "核桃苦精", type: "bitters", section: "bitters-tincture" },
  { re: /celery bitters|芹菜苦精/, name: "Celery Bitters", nameAlt: "芹菜苦精", type: "bitters", section: "bitters-tincture" },
  { re: /\bbitters\b|苦精/, name: "", nameAlt: "", type: "bitters", section: "bitters-tincture" },
  { re: /citrus tincture|柑橘酊/, name: "", nameAlt: "", type: "citrus-tincture", section: "bitters-tincture" },
  { re: /spice tincture|香料酊/, name: "", nameAlt: "", type: "spice-tincture", section: "bitters-tincture" },
  { re: /tincture|酊剂/, name: "", nameAlt: "", type: "tincture", section: "bitters-tincture" },
  // ── 浸渍烈酒 Infused Spirits ──────────────────────────────────────────
  { re: /fat[- ]?wash(ed)?|脂洗烈酒|培根.*烈酒/, name: "", nameAlt: "", type: "fat-wash", section: "infused-spirit" },
  { re: /butter[- ]?wash(ed)?|黄油洗/, name: "", nameAlt: "", type: "butter-wash", section: "infused-spirit" },
  { re: /oil[- ]?wash(ed)?(?!.*butter)|油脂洗(?!.*黄油)/, name: "", nameAlt: "", type: "oil-wash", section: "infused-spirit" },
  { re: /rapid infusion|isi infusion|快速加压浸渍/, name: "", nameAlt: "", type: "rapid-infusion", section: "infused-spirit" },
  { re: /sous[- ]?vide infusion|真空低温浸渍|低温浸渍/, name: "", nameAlt: "", type: "sous-vide-infusion", section: "infused-spirit" },
  { re: /ultrasonic infusion|超声波浸渍/, name: "", nameAlt: "", type: "ultrasonic-infusion", section: "infused-spirit" },
  { re: /rotovap|rotary evap|旋转蒸发/, name: "", nameAlt: "", type: "rotovap", section: "infused-spirit" },
  { re: /cold[- ]?brew (spirit|infusion)|冷萃浸渍|冷萃/, name: "", nameAlt: "", type: "cold-brew-spirit", section: "infused-spirit" },
  { re: /smoke[- ]?infused?|烟熏浸渍|烟熏烈酒/, name: "", nameAlt: "", type: "smoke-infusion", section: "infused-spirit" },
  { re: /infused|浸渍|浸泡/, name: "", nameAlt: "", type: "infusion", section: "infused-spirit" },
  // ── 自制利口酒 House Liqueurs ─────────────────────────────────────────
  { re: /amaretto|杏仁利口酒/, name: "Amaretto", nameAlt: "自制杏仁利口酒", type: "nut-liqueur", section: "homemade-liqueur" },
  { re: /nocino|核桃利口酒/, name: "Nocino", nameAlt: "核桃利口酒", type: "nut-liqueur", section: "homemade-liqueur" },
  { re: /nut liqueur|坚果利口酒/, name: "", nameAlt: "", type: "nut-liqueur", section: "homemade-liqueur" },
  { re: /cream liqueur|奶油利口酒|irish cream/, name: "", nameAlt: "", type: "cream-liqueur", section: "homemade-liqueur" },
  { re: /\bamaro\b|bitter liqueur|自制苦酒|苦味利口酒/, name: "", nameAlt: "", type: "amaro", section: "homemade-liqueur" },
  { re: /spiced cordial|香料康迪奥/, name: "", nameAlt: "", type: "falernum", section: "homemade-liqueur" },
  { re: /fruit liqueur|果味利口酒/, name: "", nameAlt: "", type: "fruit-liqueur", section: "homemade-liqueur" },
  { re: /herbal liqueur|草本利口酒/, name: "", nameAlt: "", type: "herbal-liqueur", section: "homemade-liqueur" },
  { re: /coffee liqueur|咖啡利口酒/, name: "Coffee Liqueur", nameAlt: "自制咖啡利口酒", type: "liqueur", section: "homemade-liqueur" },
  { re: /limoncello|柠檬切罗/, name: "Limoncello", nameAlt: "柠檬切罗利口酒", type: "liqueur", section: "homemade-liqueur" },
  { re: /house liqueur|自制利口酒/, name: "", nameAlt: "", type: "liqueur", section: "homemade-liqueur" },
  // ── 改制与预调 Modified Spirits ───────────────────────────────────────
  { re: /milk[- ]?washed?|奶洗|clarified (spirit|cocktail)|澄清烈酒/, name: "", nameAlt: "", type: "redistilled", section: "modified-spirit" },
  { re: /batched cocktail|batch(ed)? (mix|cocktail)|批量预调/, name: "", nameAlt: "", type: "batch", section: "modified-spirit" },
  { re: /bottled cocktail|瓶装鸡尾酒/, name: "", nameAlt: "", type: "bottled-cocktail", section: "modified-spirit" },
  { re: /barrel[- ]?aged (batch|cocktail)|桶陈预调/, name: "", nameAlt: "", type: "barrel-aged", section: "modified-spirit" },
  { re: /fortified|aromatized|加强酒|自制加强/, name: "", nameAlt: "", type: "fortified", section: "modified-spirit" },
  // ── 自酿发酵酒 Ferments & Brews ───────────────────────────────────────
  { re: /homebrew beer|home brew beer|自酿啤酒/, name: "Home Brew Beer", nameAlt: "自酿啤酒", type: "homebrew-beer", section: "homemade-spirit" },
  { re: /homebrew wine|home brew wine|sake|自酿葡萄酒|米酒/, name: "", nameAlt: "", type: "homebrew-wine", section: "homemade-spirit" },
  { re: /fermented|brewed|自酿发酵/, name: "", nameAlt: "", type: "fermented", section: "homemade-spirit" },
  // ── 无酒精发酵 NA Ferments ────────────────────────────────────────────
  { re: /kombucha|康普茶/, name: "Kombucha", nameAlt: "康普茶", type: "kombucha", section: "na-ferment" },
  { re: /water kefir|水开菲尔/, name: "Water Kefir", nameAlt: "水开菲尔", type: "water-kefir", section: "na-ferment" },
  { re: /ginger beer|ginger bug|姜汁啤酒/, name: "Ginger Beer", nameAlt: "自酿姜汁啤酒", type: "ginger-beer", section: "na-ferment" },
  { re: /tepache|wild ferment|发酵果汁/, name: "Tepache", nameAlt: "发酵果汁", type: "tepache", section: "na-ferment" },
  { re: /jun tea|milk kefir|jun茶|乳开菲尔/, name: "", nameAlt: "", type: "jun", section: "na-ferment" },
  // ── 零度替代 Zero-Proof ───────────────────────────────────────────────
  { re: /na bitters|non[- ]?alcoholic bitters|无酒精苦精/, name: "", nameAlt: "", type: "na-bitters", section: "zero-proof" },
  { re: /na liqueur|non[- ]?alcoholic liqueur|无酒精利口酒/, name: "", nameAlt: "", type: "na-liqueur", section: "zero-proof" },
  { re: /zero[- ]?proof (spirit|gin|rum|whiskey)|无酒精烈酒替代/, name: "", nameAlt: "", type: "zero-spirit", section: "zero-proof" },
  // ── 装饰 Garnish ──────────────────────────────────────────────────────
  { re: /foam|air (cocktail|drink)|泡沫/, name: "", nameAlt: "", type: "foam", section: "misc" },
  { re: /spherification|球化/, name: "", nameAlt: "", type: "spherification-prep", section: "misc" },
  { re: /dehydrated citrus|脱水柑橘/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /candied (fruit|cherry|orange)|糖渍|腌渍/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /citrus (peel|twist|zest)|柑橘皮卷|橙皮卷|柠檬皮卷/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /citrus (wheel|slice|round)|柑橘片|橙片|柠檬片/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /edible flower|食用花卉/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /fresh herb (sprig|garnish)|新鲜香草枝/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /dried herb|干燥香草|干香料/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /salt rim|sugar rim|盐边|糖边/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /spiced rim|香料杯口/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /olive (skewer|pick)|洋葱串|橄榄串/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /fruit skewer|果类串签/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /flavored ice|ice sphere|风味冰块|冰球/, name: "", nameAlt: "", type: "garnish", section: "misc" },
  { re: /chocolate (garnish|decoration)|candy garnish|巧克力装饰|糖果装饰/, name: "", nameAlt: "", type: "garnish", section: "misc" },
];

/**
 * Suggest a homemade prep template for an unmatched ingredient.
 * Returns null if the ingredient doesn't look like a homemade product.
 */
export function suggestPrep(ingredientName: string): PrepSuggestion | null {
  const raw = norm(ingredientName);
  if (!raw) return null;
  for (const k of KNOWN_PREPS) {
    if (k.re.test(raw)) {
      return {
        name: k.name || ingredientName.trim(),
        nameAlt: k.nameAlt,
        type: k.type,
        section: k.section,
      };
    }
  }
  return null;
}
