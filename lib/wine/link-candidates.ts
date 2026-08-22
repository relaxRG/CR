import { WineBottle, WineInventoryItem } from "./types";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s\-–—_()（）·.，,]/g, "");
}

function year(value: string): string | null {
  return value.match(/(?:19|20)\d{2}/)?.[0] ?? null;
}

function size(value: string): string | null {
  return value.match(/\b(?:187|375|500|700|720|750|1000|1500)\s*(?:ml|毫升)?\b/i)?.[0]?.replace(/\s+/g, "").toLowerCase() ?? null;
}

function nameScore(source: string, candidate: string): number {
  if (!source || !candidate) return 0;
  if (source === candidate) return 1;
  if (candidate.includes(source)) return 0.9;
  if (source.includes(candidate)) return 0.85;
  const shared = [...candidate].filter((character) => source.includes(character)).length;
  return shared / Math.max(source.length, candidate.length, 1);
}

export interface WineLinkCandidate { bottle: WineBottle; score: number; reasons: string[] }

/**
 * 仅供人工确认前排序；结果绝不写回库存或采购。低分候选被过滤，分数相同按名称稳定排序。
 */
export function rankWineLinkCandidates(item: Pick<WineInventoryItem, "name" | "supplier" | "wineType" | "category">, bottles: WineBottle[]): WineLinkCandidate[] {
  const sourceName = normalize(item.name);
  const itemYear = year(item.name);
  const itemSize = size(item.name);
  return bottles.map((bottle) => {
    const chinese = nameScore(sourceName, normalize(bottle.name));
    const english = nameScore(sourceName, normalize(bottle.nameEn));
    const base = Math.max(chinese, english);
    const reasons: string[] = [];
    if (chinese === 1 || english === 1) reasons.push("名称完全匹配");
    else if (base >= 0.85) reasons.push("名称高度相近");
    let score = base;
    if (normalize(item.supplier) && normalize(item.supplier) === normalize(bottle.supplier)) { score += 0.08; reasons.push("供应商一致"); }
    if ((item.category ?? item.wineType) && normalize(item.category ?? item.wineType) === normalize(bottle.style)) { score += 0.03; reasons.push("分类一致"); }
    if (itemYear && itemYear === year(`${bottle.name} ${bottle.nameEn} ${bottle.vintage}`)) { score += 0.04; reasons.push("年份一致"); }
    if (itemSize && itemSize === size(`${bottle.name} ${bottle.nameEn}`)) { score += 0.02; reasons.push("规格一致"); }
    return { bottle, score: Math.min(1, score), reasons };
  }).filter((candidate) => candidate.score >= 0.25)
    .sort((left, right) => right.score - left.score || left.bottle.name.localeCompare(right.bottle.name, "zh-CN"))
    .slice(0, 5);
}
