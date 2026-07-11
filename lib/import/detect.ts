import {
  looksLikeIngredientLine,
  parseRecipeText,
  ParsedRecipe,
} from "../recipes/parser";
import { genId } from "../recipes/types";

/** 识别出的候选配方 */
export interface RecipeCandidate {
  id: string;
  /** cocktail = 鸡尾酒配方;prep = 自制(糖浆/浸渍/苦精等) */
  kind: "cocktail" | "prep";
  name: string;
  parsed: ParsedRecipe;
  /** 原始文本块,供审核时对照 */
  raw: string;
  /** 所在章节/页标题 */
  sectionTitle: string;
  /** 0-1 置信度 */
  confidence: number;
}

/** 名称中出现即判为自制配方的关键词 */
const PREP_NAME_RE =
  /糖浆|syrup|cordial|shrub|sherbet|oleo[\s-]?saccharum|orgeat|falernum|苦精|bitters|tincture|酊剂|infus(?:ion|ed)|浸渍|浸泡|solution|溶液|premix|pre-?batch|puree|果泥|自制|house[\s-]?made|grenadine|honey\s*mix|奶洗|milk[\s-]?wash|fat[\s-]?wash|油脂洗/i;

/** 明显不是配方名称的行(章节头/目录/版权等) */
const NOISE_NAME_RE =
  /^(chapter|contents?|index|copyright|introduction|foreword|acknowledg|appendix|目录|前言|序|版权|索引|附录|第[一二三四五六七八九十\d]+[章节])\b/i;

const SECTION_HEADER_RE =
  /^(配料|材料|成分|原料|用料|ingredients?|做法|步骤|制作|调制|方法|instructions?|method|directions?|steps?|preparation|装饰|garnish)\s*[::]?\s*$/i;

/** 一行是否适合作为配方名 */
function looksLikeName(line: string): boolean {
  const t = line.replace(/^##\s*/, "").trim();
  if (!t || t.length > 48) return false;
  if (looksLikeIngredientLine(t)) return false;
  if (SECTION_HEADER_RE.test(t)) return false;
  if (NOISE_NAME_RE.test(t)) return false;
  // 含句号/分号的长句不像名称
  if (/[。;;]/.test(t)) return false;
  if (/[.!?]\s*$/.test(t) && t.split(/\s+/).length > 6) return false;
  // 纯数字/页码
  if (/^\d+$/.test(t)) return false;
  return true;
}

interface Cluster {
  start: number;
  end: number; // inclusive
  ingCount: number;
}

/** 找出配料行密集簇(允许中间夹 1 行非配料行) */
function findClusters(lines: string[]): Cluster[] {
  const isIng = lines.map((l) => looksLikeIngredientLine(l));
  const clusters: Cluster[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isIng[i]) {
      i++;
      continue;
    }
    let end = i;
    let ingCount = 1;
    let j = i + 1;
    let gap = 0;
    while (j < lines.length) {
      if (isIng[j]) {
        end = j;
        ingCount++;
        gap = 0;
      } else {
        gap++;
        if (gap > 1) break;
      }
      j++;
    }
    clusters.push({ start: i, end, ingCount });
    i = end + 1;
  }
  return clusters.filter((c) => c.ingCount >= 2);
}

function scoreCandidate(parsed: ParsedRecipe, hasName: boolean): number {
  let score = 0.3;
  if (hasName) score += 0.2;
  if (parsed.ingredients.length >= 3) score += 0.2;
  else if (parsed.ingredients.length >= 2) score += 0.1;
  const withAmount = parsed.ingredients.filter((i) => i.amount).length;
  if (parsed.ingredients.length > 0 && withAmount / parsed.ingredients.length >= 0.6) score += 0.15;
  if (parsed.steps) score += 0.1;
  if (parsed.method || parsed.glass) score += 0.05;
  return Math.min(1, Math.round(score * 100) / 100);
}

/** 判断候选是鸡尾酒还是自制配方 */
export function classifyCandidateKind(name: string, parsed: ParsedRecipe): "cocktail" | "prep" {
  if (PREP_NAME_RE.test(name)) return "prep";
  // 名称不含关键词,但配料以糖/水/果为主且无烈酒 → 可能是自制
  const ingText = parsed.ingredients.map((i) => i.name).join(" ");
  const hasSpirit =
    /金酒|gin|朗姆|rum|伏特加|vodka|威士忌|whisk|波本|bourbon|龙舌兰|tequila|mezcal|白兰地|brandy|cognac|利口|liqueur|vermouth|味美思|aperitivo|amaro|wine|香槟|champagne|beer|啤酒/i.test(
      ingText,
    );
  const prepIngHint = /糖|sugar|蜂蜜|honey|水|water|果皮|peel|香料|spice|柠檬酸|citric/i.test(ingText);
  if (!hasSpirit && prepIngHint && /糖浆|syrup|浸渍|infus|solution|溶液/i.test(parsed.steps + " " + ingText))
    return "prep";
  return "cocktail";
}

/**
 * 扫描一段章节文本,识别其中的配方候选。
 * 策略:定位"配料行簇"(≥2 行带用量的行),向上找名称行,向下收做法段。
 */
export function detectRecipesInText(text: string, sectionTitle = ""): RecipeCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const clusters = findClusters(lines);
  const candidates: RecipeCandidate[] = [];

  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];

    // 向上最多回溯 4 行找名称(跳过分节标题行)
    let nameLine = "";
    let blockStart = c.start;
    const prevClusterEnd = ci > 0 ? clusters[ci - 1].end : -1;
    for (let k = c.start - 1; k >= Math.max(prevClusterEnd + 1, c.start - 4); k--) {
      const l = lines[k];
      if (SECTION_HEADER_RE.test(l)) {
        blockStart = k;
        continue;
      }
      if (looksLikeName(l)) {
        nameLine = l.replace(/^##\s*/, "").trim();
        blockStart = k;
      }
      break;
    }

    // 向下收做法:直到下一簇的名称边界或收满 10 行
    const nextClusterStart = ci + 1 < clusters.length ? clusters[ci + 1].start : lines.length;
    let blockEnd = c.end;
    for (let k = c.end + 1; k < Math.min(nextClusterStart, c.end + 11); k++) {
      const l = lines[k];
      // 下一簇的名称行(其后紧跟配料簇)不吞入当前块
      if (k >= nextClusterStart - 4 && looksLikeName(l) && ci + 1 < clusters.length) break;
      if (/^##\s/.test(l)) break;
      blockEnd = k;
    }

    const raw = lines.slice(blockStart, blockEnd + 1).join("\n");
    const parsed = parseRecipeText(raw);
    if (!parsed.name && nameLine) parsed.name = nameLine;
    if (parsed.ingredients.length < 2) continue;
    // 无名候选:置信度低,但仍保留供人工确认
    const kind = classifyCandidateKind(parsed.name, parsed);
    candidates.push({
      id: genId(),
      kind,
      name: parsed.name,
      parsed,
      raw,
      sectionTitle,
      confidence: scoreCandidate(parsed, !!parsed.name),
    });
  }
  return candidates;
}

/** 扫描整本书 */
export function detectRecipesInBook(sections: { title: string; text: string }[]): RecipeCandidate[] {
  const all: RecipeCandidate[] = [];
  for (const s of sections) all.push(...detectRecipesInText(s.text, s.title));
  // 同名去重,保留置信度更高的
  const byName = new Map<string, RecipeCandidate>();
  const unnamed: RecipeCandidate[] = [];
  for (const c of all) {
    const key = c.name.toLowerCase().trim();
    if (!key) {
      unnamed.push(c);
      continue;
    }
    const prev = byName.get(key);
    if (!prev || c.confidence > prev.confidence) byName.set(key, c);
  }
  return [...byName.values(), ...unnamed];
}
