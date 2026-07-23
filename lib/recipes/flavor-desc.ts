/**
 * 三段式风味描述工具函数
 *
 * 格式约定（buildFlavorDesc 输出）：
 *   核心基调: <tone>
 *   风味演变: <evolution>
 *   整体质感: <texture>
 *
 * parseFlavorDesc 支持中英文标签，以及全角/半角冒号。
 * 容错：若字符串不含任何已知标签，将整段文字兜底放入「核心基调」字段。
 */

export interface FlavorDescParts {
  tone: string;
  evolution: string;
  texture: string;
}

const ZH_LABELS = ["核心基调", "风味演变", "整体质感"] as const;
const EN_LABELS = ["Core profile", "Flavor evolution", "Overall texture"] as const;

/**
 * 将 flavorDesc 字符串解析为三段结构。
 *
 * 容错规则：若整个字符串中没有任何已知标签（中文或英文），
 * 则将原始文本整体放入 tone（核心基调），evolution 和 texture 留空。
 * 这样旧数据在编辑时不会出现三段全空的情况。
 */
export function parseFlavorDesc(raw: string): FlavorDescParts {
  const result: FlavorDescParts = { tone: "", evolution: "", texture: "" };
  if (!raw || !raw.trim()) return result;

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  let matched = false;

  for (const line of lines) {
    // 支持全角冒号「：」和半角冒号「:」
    const colonIdx = line.search(/[：:]/);
    if (colonIdx > 0) {
      const label = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      const zhIdx = ZH_LABELS.indexOf(label as typeof ZH_LABELS[number]);
      const enIdx = EN_LABELS.indexOf(label as typeof EN_LABELS[number]);
      const idx = zhIdx >= 0 ? zhIdx : enIdx >= 0 ? enIdx : -1;
      if (idx === 0) { result.tone = value; matched = true; }
      else if (idx === 1) { result.evolution = value; matched = true; }
      else if (idx === 2) { result.texture = value; matched = true; }
    }
  }

  // 容错：无任何已知标签时，将整段文字兜底放入「核心基调」
  if (!matched) {
    result.tone = raw.trim();
  }

  return result;
}

/**
 * 将三段结构合并为 flavorDesc 字符串。
 * 空段自动跳过，不写入结果。
 */
export function buildFlavorDesc(tone: string, evolution: string, texture: string): string {
  const parts: string[] = [];
  if (tone.trim()) parts.push(`核心基调: ${tone.trim()}`);
  if (evolution.trim()) parts.push(`风味演变: ${evolution.trim()}`);
  if (texture.trim()) parts.push(`整体质感: ${texture.trim()}`);
  return parts.join("\n");
}
