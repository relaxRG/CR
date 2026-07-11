/**
 * 同名分组引擎:同一鸡尾酒/自制品可能有多种配方或做法版本,
 * 列表中按规范化名称折叠为一组,展开查看各版本。
 *
 * 分组规则:中文名或英文名任一规范化后相同即视为同一产品的不同版本。
 */
import { Recipe } from "./types";
import { HomemadePrep } from "../homemade/types";

/** 名称规范化:小写、去空格与标点、去常见修饰后缀,用于同名判定 */
export function normalizeNameKey(raw: string): string {
  if (!raw) return "";
  let s = raw
    .toLowerCase()
    // 去括号内容:如 "尼格罗尼(经典)" -> "尼格罗尼"
    .replace(/[((][^))]*[))]/g, "")
    // 去空格与常见标点
    .replace(/[\s\-_·..,,'’&+/\\]/g, "");
  // 去常见版本修饰词(中英),如 "经典版" "改良" "no.2"
  s = s.replace(/(经典版?|改良版?|升级版?|版本?\d*|no\d+|v\d+|mkii+|classic|improved|variation|version\d*)$/g, "");
  return s;
}

/** 一组同名版本 */
export interface NameGroup<T> {
  /** 分组 key(规范化名称) */
  key: string;
  /** 组内条目(保持传入顺序) */
  items: T[];
}

/**
 * 通用同名分组:zhKey/enKey 提取双语名称,任一规范化名称相同即合并。
 * 使用 union-find 思想的简化实现:先按 zh key 建桶,再按 en key 合并。
 */
function groupByNames<T>(
  items: T[],
  getNames: (item: T) => { zh: string; en: string },
): NameGroup<T>[] {
  const groups: NameGroup<T>[] = [];
  /** 规范化名 -> 组索引 */
  const keyToGroup = new Map<string, number>();

  for (const item of items) {
    const { zh, en } = getNames(item);
    const keys = [normalizeNameKey(zh), normalizeNameKey(en)].filter(Boolean);
    // 找到任一已存在的组
    let gi: number | undefined;
    for (const k of keys) {
      const found = keyToGroup.get(k);
      if (found !== undefined) {
        gi = found;
        break;
      }
    }
    if (gi === undefined) {
      gi = groups.length;
      groups.push({ key: keys[0] ?? `item-${gi}`, items: [] });
    }
    groups[gi].items.push(item);
    for (const k of keys) {
      if (!keyToGroup.has(k)) keyToGroup.set(k, gi);
    }
  }
  return groups;
}

/** 配方同名分组(name=中文, nameEn=英文) */
export function groupRecipesByName(recipes: Recipe[]): NameGroup<Recipe>[] {
  return groupByNames(recipes, (r) => ({ zh: r.name ?? "", en: r.nameEn ?? "" }));
}

/** 自制品同名分组(name/nameAlt 中英不定,按双 key 合并即可) */
export function groupPrepsByName(preps: HomemadePrep[]): NameGroup<HomemadePrep>[] {
  return groupByNames(preps, (p) => ({ zh: p.name ?? "", en: p.nameAlt ?? "" }));
}
