import type { SpiritItem } from "./types";

/**
 * 商品整理只使用于人工复核的候选发现；不会在导入或打开页面时自动合并数据。
 *
 * 规范化范围故意很窄：Unicode 兼容形式、零宽字符、空白和大小写差异会被折叠；
 * 其他字符、规格、年份和容量仍然保留，以免把不同酒款误判为同一条目。
 */
export function normalizeSpiritIdentityName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, "")
    .toLocaleLowerCase()
    .trim();
}

export interface SpiritDuplicateCandidateGroup {
  normalizedName: string;
  itemIds: string[];
  /** 完全同名（忽略空白/Unicode/大小写）的主档才进入本组。 */
  match: "exact-normalized";
}

/**
 * 仅识别 100% 的规范化名称重复。中文、英文各自形成独立键，但同一条目的双语名
 * 会被去重；没有名称或仅一个条目的键永远不返回。近似名称不得被此函数自动合并。
 */
export function findExactSpiritItemDuplicateGroups(items: readonly SpiritItem[]): SpiritDuplicateCandidateGroup[] {
  const byKey = new Map<string, Set<string>>();
  for (const item of items) {
    const keys = new Set([normalizeSpiritIdentityName(item.name), normalizeSpiritIdentityName(item.nameEn)]);
    for (const key of keys) {
      if (!key) continue;
      const ids = byKey.get(key) ?? new Set<string>();
      ids.add(item.id);
      byKey.set(key, ids);
    }
  }
  return [...byKey.entries()]
    .filter(([, itemIds]) => itemIds.size > 1)
    .map(([normalizedName, itemIds]) => ({ normalizedName, itemIds: [...itemIds].sort(), match: "exact-normalized" as const }))
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName, "zh-Hans-CN"));
}

export interface SpiritSharedBottleLinkGroup {
  bottleId: string;
  itemIds: string[];
}

/**
 * 共享同一鸡尾酒库档案只意味着“可能需要整理”，不等同于同一库存条目。
 * 调用方必须显式展示人工合并、保持分开或解除错误关联三个选择。
 */
export function findSharedBottleLinkGroups(items: readonly SpiritItem[]): SpiritSharedBottleLinkGroup[] {
  const byBottle = new Map<string, string[]>();
  for (const item of items) {
    if (!item.bottleId) continue;
    const ids = byBottle.get(item.bottleId) ?? [];
    ids.push(item.id);
    byBottle.set(item.bottleId, ids);
  }
  return [...byBottle.entries()]
    .filter(([, itemIds]) => itemIds.length > 1)
    .map(([bottleId, itemIds]) => ({ bottleId, itemIds: [...itemIds].sort() }))
    .sort((left, right) => left.bottleId.localeCompare(right.bottleId));
}

/**
 * 只有在用户已显式确认目标和来源时才允许进入合并流程。
 * 这条守卫不执行写入，只防止 UI 把同一条目、空数组或重复来源传给命令层。
 */
export function canPrepareSpiritItemConsolidation(targetItemId: string, sourceItemIds: readonly string[]): boolean {
  const uniqueSources = new Set(sourceItemIds.filter(Boolean));
  return Boolean(targetItemId) && uniqueSources.size > 0 && !uniqueSources.has(targetItemId);
}
