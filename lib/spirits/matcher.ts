/**
 * 烈酒智能匹配引擎
 * 将至缘商品名（含中英文）模糊匹配到 Bottle 库
 * 支持：精确匹配 → 中文模糊匹配 → 英文模糊匹配 → 记忆匹配
 */
import { Bottle } from "@/lib/bottles/types";
import { SpiritMatchRecord } from "./types";

/** 匹配结果 */
export interface MatchResult {
  bottleId: string | null;
  confidence: "high" | "medium" | "low" | "manual";
  matchedName: string;
  reason: string;
}

/**
 * 标准化字符串：去除标点、空格、括号内容，转小写
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（）()【】\[\]「」『』《》""'']/g, " ")
    .replace(/[^\u4e00-\u9fffa-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 计算两个字符串的相似度（简单 token 重叠率）
 */
function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalize(a).split(" ").filter((t) => t.length >= 2));
  const tokensB = new Set(normalize(b).split(" ").filter((t) => t.length >= 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  tokensA.forEach((t) => { if (tokensB.has(t)) overlap++; });
  return (2 * overlap) / (tokensA.size + tokensB.size);
}

/**
 * 中文字符重叠率
 */
function chineseSimilarity(a: string, b: string): number {
  const zhA = (a.match(/[\u4e00-\u9fff]/g) || []).join("");
  const zhB = (b.match(/[\u4e00-\u9fff]/g) || []).join("");
  if (!zhA || !zhB) return 0;
  let overlap = 0;
  const shorter = zhA.length < zhB.length ? zhA : zhB;
  const longer = zhA.length < zhB.length ? zhB : zhA;
  for (const ch of shorter) {
    if (longer.includes(ch)) overlap++;
  }
  return (2 * overlap) / (zhA.length + zhB.length);
}

/**
 * 主匹配函数：将供应商商品名匹配到 Bottle 库
 */
export function matchSpiritToBottle(
  rawName: string,
  nameZh: string,
  nameEn: string,
  bottles: Bottle[],
  existingRecord?: SpiritMatchRecord
): MatchResult {
  // 1. 已有人工确认记录，直接使用
  if (existingRecord?.confirmed && existingRecord.bottleId) {
    const bottle = bottles.find((b) => b.id === existingRecord.bottleId);
    if (bottle) {
      return {
        bottleId: bottle.id,
        confidence: "manual",
        matchedName: bottle.nameZh,
        reason: "人工确认",
      };
    }
  }

  // 2. 精确匹配（中文名完全相同）
  if (nameZh) {
    const exact = bottles.find(
      (b) => b.nameZh.trim() === nameZh.trim() || normalize(b.nameZh) === normalize(nameZh)
    );
    if (exact) {
      return { bottleId: exact.id, confidence: "high", matchedName: exact.nameZh, reason: "中文名精确匹配" };
    }
  }

  // 3. 英文名精确匹配
  if (nameEn) {
    const exactEn = bottles.find(
      (b) => b.nameEn && normalize(b.nameEn) === normalize(nameEn)
    );
    if (exactEn) {
      return { bottleId: exactEn.id, confidence: "high", matchedName: exactEn.nameZh, reason: "英文名精确匹配" };
    }
  }

  // 4. 中文模糊匹配（相似度 >= 0.7）
  let bestZh: { bottle: Bottle; score: number } | null = null;
  if (nameZh) {
    bottles.forEach((b) => {
      const score = chineseSimilarity(nameZh, b.nameZh);
      if (score >= 0.7 && (!bestZh || score > bestZh.score)) {
        bestZh = { bottle: b, score };
      }
    });
  }
  if (bestZh) {
    const { bottle, score } = bestZh as { bottle: Bottle; score: number };
    return {
      bottleId: bottle.id,
      confidence: score >= 0.85 ? "high" : "medium",
      matchedName: bottle.nameZh,
      reason: `中文模糊匹配 (${(score * 100).toFixed(0)}%)`,
    };
  }

  // 5. 英文 token 模糊匹配（相似度 >= 0.6）
  let bestEn: { bottle: Bottle; score: number } | null = null;
  if (nameEn) {
    bottles.forEach((b) => {
      if (!b.nameEn) return;
      const score = tokenSimilarity(nameEn, b.nameEn);
      if (score >= 0.6 && (!bestEn || score > bestEn.score)) {
        bestEn = { bottle: b, score };
      }
    });
  }
  if (bestEn) {
    const { bottle, score } = bestEn as { bottle: Bottle; score: number };
    return {
      bottleId: bottle.id,
      confidence: score >= 0.8 ? "medium" : "low",
      matchedName: bottle.nameZh,
      reason: `英文模糊匹配 (${(score * 100).toFixed(0)}%)`,
    };
  }

  // 6. 原始名称整体模糊匹配
  let bestRaw: { bottle: Bottle; score: number } | null = null;
  bottles.forEach((b) => {
    const score = Math.max(
      tokenSimilarity(rawName, b.nameZh),
      b.nameEn ? tokenSimilarity(rawName, b.nameEn) : 0
    );
    if (score >= 0.5 && (!bestRaw || score > bestRaw.score)) {
      bestRaw = { bottle: b, score };
    }
  });
  if (bestRaw) {
    const { bottle, score } = bestRaw as { bottle: Bottle; score: number };
    return {
      bottleId: bottle.id,
      confidence: "low",
      matchedName: bottle.nameZh,
      reason: `整体模糊匹配 (${(score * 100).toFixed(0)}%)`,
    };
  }

  return { bottleId: null, confidence: "low", matchedName: "", reason: "未找到匹配" };
}

/** 置信度颜色 */
export function confidenceColor(confidence: SpiritMatchRecord["confidence"]): string {
  switch (confidence) {
    case "high": return "#34C759";
    case "medium": return "#FF9500";
    case "low": return "#FF3B30";
    case "manual": return "#007AFF";
    default: return "#8E8E93";
  }
}

/** 置信度标签 */
export function confidenceLabel(confidence: SpiritMatchRecord["confidence"]): string {
  switch (confidence) {
    case "high": return "高";
    case "medium": return "中";
    case "low": return "低";
    case "manual": return "人工";
    default: return "?";
  }
}
