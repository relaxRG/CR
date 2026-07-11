/**
 * 形态族分组引擎:同一原材料的不同形态条目(柠檬 / 柠檬汁 / 柠檬皮 / 柠檬片…)
 * 在原材料库中聚合为一个"形态族"——母条目卡片 + 折叠的形态子条目。
 *
 * 与 form-fold.ts(系数换算)的区别:
 * - 这里的每个形态都是库内真实条目,可独立维护价格/规格;
 * - 展示上折叠到母条目之下;配方匹配时优先精确命中形态条目,
 *   只有库内没有该形态条目时才回退母条目 × 系数换算(见 smart-link)。
 */
import { stripForm } from "../recipes/form-fold";
import type { Bottle } from "./types";
import { bottleGroupOf } from "./types";

/** 形态族:母条目(base)+形态子条目(variants) */
export interface FormFamily {
  /** 族键(母名归一化) */
  key: string;
  /** 母条目(库内名恰为母名的条目);可能不存在(只有形态条目) */
  base: Bottle | null;
  /** 形态子条目(柠檬汁/柠檬皮…),按名称排序 */
  variants: Bottle[];
}

/** 汁类等 stripForm 未覆盖的形态后缀(库内条目名专用) */
const EXTRA_FORM_RE = /(汁|水|茸|泥|酱|蓉|juice|puree|paste)$/i;

const FRESH_RE = /^(新鲜|鲜|fresh)\s*/i;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(FRESH_RE, "");

/**
 * 提取库内条目的母名:先试 stripForm(皮/片/角…),再试汁/泥等后缀。
 * 返回 null 表示该条目本身就是母条目或无形态词。
 */
export function familyBaseOf(name: string): string | null {
  const raw = name.trim();
  if (!raw) return null;
  const s = stripForm(raw);
  if (s.form && s.base && s.base !== raw) return s.base;
  const m = raw.match(EXTRA_FORM_RE);
  if (m) {
    const base = raw.slice(0, raw.length - m[0].length).trim().replace(FRESH_RE, "").trim();
    const zhLen = (base.match(/[\u4e00-\u9fff]/g) || []).length;
    const enLen = base.replace(/[^a-zA-Z]/g, "").length;
    if (zhLen >= 1 || enLen >= 3) return base;
  }
  return null;
}

/**
 * 将材料组条目列表聚合为形态族。
 * - 仅当"库内存在同名母条目"或"同母名的形态条目 ≥ 2"时才成族折叠;
 *   孤立的"柠檬草"之类不折叠(避免误聚合)。
 * - 返回 families(有折叠的族)与 singles(平铺展示的条目,保持原顺序)。
 */
export function groupFormFamilies(list: Bottle[]): {
  families: FormFamily[];
  singles: Bottle[];
  /** 条目 id → 族键(被折叠的条目) */
  memberOf: Map<string, string>;
} {
  // 名称索引(仅材料组)
  const nameIndex = new Map<string, Bottle>();
  for (const b of list) {
    if (bottleGroupOf(b.category) !== "materials") continue;
    if (b.nameZh) nameIndex.set(norm(b.nameZh), b);
    if (b.nameEn) nameIndex.set(norm(b.nameEn), b);
  }

  // 候选:母名 → 形态子条目
  const candidates = new Map<string, Bottle[]>();
  const baseHit = new Map<string, Bottle>();
  // 中英族键合并:同一 Bottle 的中英母名指向同一族(以先出现的键为准)
  const keyAlias = new Map<string, string>();
  const canon = (k: string) => keyAlias.get(k) ?? k;
  for (const b of list) {
    if (bottleGroupOf(b.category) !== "materials") continue;
    const baseZh = familyBaseOf(b.nameZh || "");
    const baseEn = familyBaseOf(b.nameEn || "");
    const bases = [baseZh, baseEn].filter((x): x is string => !!x);
    // 同条目的中英母名互为别名(便于"fresh pineapple juice"与"鲜菠萝汁"共族)
    if (baseZh && baseEn) {
      const kz = canon(norm(baseZh));
      const ke = norm(baseEn);
      if (kz !== ke && !keyAlias.has(ke)) keyAlias.set(ke, kz);
    }
    let matched = false;
    for (const base of bases) {
      const k = canon(norm(base));
      const baseBottle = nameIndex.get(k);
      if (baseBottle && baseBottle.id !== b.id) {
        // 库内存在母条目 → 直接归族
        const fam = candidates.get(k) ?? [];
        fam.push(b);
        candidates.set(k, fam);
        baseHit.set(k, baseBottle);
        matched = true;
        break;
      }
    }
    if (!matched && bases.length > 0) {
      // 无母条目:按第一个母名试聚(之后若同母名条目≥2 也成族)
      const k = canon(norm(bases[0]));
      const fam = candidates.get(k) ?? [];
      fam.push(b);
      candidates.set(k, fam);
    }
  }

  const memberOf = new Map<string, string>();
  const families: FormFamily[] = [];
  for (const [k, variants] of candidates) {
    const base = baseHit.get(k) ?? null;
    if (!base && variants.length < 2) continue; // 孤立单条不折叠
    const sorted = [...variants].sort((a, b) =>
      (a.nameZh || a.nameEn).localeCompare(b.nameZh || b.nameEn, "zh"),
    );
    families.push({ key: k, base, variants: sorted });
    if (base) memberOf.set(base.id, k);
    for (const v of sorted) memberOf.set(v.id, k);
  }

  const singles = list.filter((b) => !memberOf.has(b.id));
  return { families, singles, memberOf };
}

/**
 * 库内精确形态匹配:配方写"柠檬皮"时,若库内存在名为"柠檬皮"(或同义)独立条目,
 * 直接返回该条目(优先于母条目系数换算)。
 */
export function findExactBottle(list: Bottle[], name: string): Bottle | null {
  const k = norm(name);
  if (!k) return null;
  for (const b of list) {
    if (norm(b.nameZh) === k || norm(b.nameEn) === k) return b;
  }
  return null;
}
