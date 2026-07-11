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
export function matchPrep(ingredientName: string, preps: HomemadePrep[]): HomemadePrep | null {
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
      }
    }
  }
  // Require a reasonable overlap to avoid weak short matches
  return bestScore >= 54 ? best : null;
}

export interface PrepSuggestion {
  /** Prefill values for the homemade form */
  name: string;
  nameAlt: string;
  type: string;
}

/**
 * Well-known homemade products: if an ingredient looks like one of these
 * but has no match in the library, offer a one-tap "add to homemade" action.
 */
const KNOWN_PREPS: { re: RegExp; name: string; nameAlt: string; type: string }[] = [
  { re: /simple syrup|单糖浆|糖浆.*1:1|1:1.*糖浆/, name: "Simple Syrup (1:1)", nameAlt: "单糖浆(1:1)", type: "syrup" },
  { re: /rich (simple )?syrup|浓糖浆|2:1.*糖浆/, name: "Rich Simple Syrup (2:1)", nameAlt: "浓糖浆(2:1)", type: "syrup" },
  { re: /demerara syrup|德梅拉拉糖浆|粗糖糖浆/, name: "Demerara Syrup (2:1)", nameAlt: "德梅拉拉糖浆(2:1)", type: "syrup" },
  { re: /honey syrup|蜂蜜糖浆/, name: "Honey Syrup (3:1)", nameAlt: "蜂蜜糖浆(3:1)", type: "syrup" },
  { re: /ginger syrup|姜糖浆|薑糖漿/, name: "Ginger Syrup", nameAlt: "姜糖浆", type: "syrup" },
  { re: /orgeat|杏仁糖浆/, name: "Orgeat", nameAlt: "杏仁糖浆", type: "syrup" },
  { re: /grenadine|红石榴糖浆|石榴糖浆/, name: "Grenadine", nameAlt: "红石榴糖浆", type: "syrup" },
  { re: /cinnamon syrup|肉桂糖浆/, name: "Cinnamon Syrup", nameAlt: "肉桂糖浆", type: "syrup" },
  { re: /vanilla syrup|香草糖浆/, name: "Vanilla Syrup", nameAlt: "香草糖浆", type: "syrup" },
  { re: /raspberry syrup|覆盆子糖浆/, name: "Raspberry Syrup", nameAlt: "覆盆子糖浆", type: "syrup" },
  { re: /passion ?fruit syrup|百香果糖浆/, name: "Passion Fruit Syrup", nameAlt: "百香果糖浆", type: "syrup" },
  { re: /agave syrup|龙舌兰糖浆/, name: "Agave Syrup", nameAlt: "龙舌兰糖浆", type: "syrup" },
  { re: /falernum|法勒南/, name: "Falernum", nameAlt: "法勒南香料糖浆", type: "cordial" },
  { re: /lime cordial|青柠康迪奥|青柠糖浆/, name: "Lime Cordial", nameAlt: "青柠康迪奥", type: "cordial" },
  { re: /shrub|果醋饮/, name: "Shrub", nameAlt: "果醋饮", type: "shrub" },
  { re: /saline|salt solution|盐溶液|盐水/, name: "Saline Solution (20%)", nameAlt: "盐溶液(20%)", type: "solution" },
  { re: /citric acid solution|柠檬酸溶液/, name: "Citric Acid Solution", nameAlt: "柠檬酸溶液", type: "solution" },
  { re: /infused|浸渍|浸泡/, name: "", nameAlt: "", type: "infusion" },
  { re: /tincture|酊剂/, name: "", nameAlt: "", type: "tincture" },
  { re: /coffee liqueur|咖啡利口酒/, name: "Coffee Liqueur", nameAlt: "自制咖啡利口酒", type: "liqueur" },
  { re: /limoncello|柠檬切罗/, name: "Limoncello", nameAlt: "柠檬切罗利口酒", type: "liqueur" },
  { re: /orange bitters|橙味苦精/, name: "Orange Bitters", nameAlt: "自制橙味苦精", type: "bitters" },
  { re: /milk[- ]?washed|奶洗/, name: "", nameAlt: "", type: "redistilled" },
  { re: /ginger beer|姜汁啤酒/, name: "Ginger Beer (Homebrew)", nameAlt: "自酿姜汁啤酒", type: "fermented" },
  { re: /oleo[- ]?saccharum|油糖/, name: "Oleo Saccharum", nameAlt: "柑橘油糖", type: "syrup" },
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
      };
    }
  }
  return null;
}
