/**
 * 缺失原材料自动入库引擎。
 *
 * 场景:
 * 1. 配方成本估算/装饰成本拆分时,片段名在酒库+自制库均无匹配 → 自动生成
 *    Bottle 草稿(classifyIngredient 智能归类到 v8 材料分类)即时入库,成本先按未知价显示。
 * 2. 原材料库手动/批量入库时,名称含连接词(或/与/及等)→ 拆分为多个独立草稿分别入库。
 *
 * 去重:与现有酒库中英名规范化全等则跳过;同批次内部也去重。
 */
import type { Bottle } from "../bottles/types";
import type { HomemadePrep } from "../homemade/types";
import type { BottleDraft } from "../bottles/store";
import { classifyIngredient, splitBilingualName } from "../classify";
import { splitGarnish } from "./garnish-split";
import { stripForm } from "./form-fold";
import { smartLinkIngredient } from "./smart-link";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** 名称是否已存在于酒库(中/英名规范化全等) */
export function bottleNameExists(name: string, bottles: Bottle[]): boolean {
  const key = norm(name);
  if (!key) return false;
  return bottles.some((b) => norm(b.nameZh) === key || norm(b.nameEn) === key);
}

/** 由片段名生成材料/瓶装草稿:classifyIngredient 智能归 v8 分类;返回 null 表示不适合入库 */
export function draftFromName(rawName: string): BottleDraft | null {
  const name = rawName.trim();
  if (!name || name.replace(/[^a-zA-Z\u4e00-\u9fff]/g, "").length < 2) return null;
  // 剥离形态词:入库母条目("柠檬皮"→"柠檬"),避免形态碎片污染库
  const stripped = stripForm(name);
  const base = stripped.form ? stripped.base : name;
  const cls = classifyIngredient(base);
  if (!cls) return null;
  // 自制类不入酒库(由自制库流程处理)
  if (cls.library === "homemade") return null;
  const { en, zh } = splitBilingualName(base);
  return {
    nameZh: zh || (/[\u4e00-\u9fff]/.test(base) ? base : ""),
    nameEn: en || (!/[\u4e00-\u9fff]/.test(base) ? base : ""),
    category: cls.category ?? "酸类与添加剂",
    style: cls.style ?? "",
    brand: "",
    origin: "",
    volume: "",
    abv: cls.library === "bottle" ? 0 : 0,
    priceCny: 0,
    notes: "自动添加:配方成本估算发现库中缺失",
    flavorTags: [],
    story: "",
    styleDesc: "",
  };
}

/**
 * 拆分含连接词的名称为多个独立名称(用于原材料库入库拆分):
 * "青柠与柠檬" → ["青柠","柠檬"];"薄荷或罗勒" → ["薄荷","罗勒"];无连接词返回单元素。
 */
export function splitCompoundName(rawName: string): string[] {
  const groups = splitGarnish(rawName);
  const names: string[] = [];
  for (const g of groups) {
    for (const p of g.parts) {
      if (p.name && !names.some((n) => norm(n) === norm(p.name))) names.push(p.name);
    }
  }
  return names.length > 0 ? names : [rawName.trim()].filter(Boolean);
}

/**
 * 从"未匹配名称列表"生成待入库草稿(已存在的/无法归类的自动跳过,批内去重)。
 */
export function buildAutoAddDrafts(
  unmatchedNames: string[],
  bottles: Bottle[],
  preps: HomemadePrep[],
): BottleDraft[] {
  const drafts: BottleDraft[] = [];
  const seen = new Set<string>();
  for (const raw of unmatchedNames) {
    for (const name of splitCompoundName(raw)) {
      // 双保险:smartLink 再确认确实无匹配(含形态折叠)
      if (smartLinkIngredient(name, bottles, preps)) continue;
      const draft = draftFromName(name);
      if (!draft) continue;
      const key = norm(draft.nameZh || draft.nameEn);
      if (!key || seen.has(key)) continue;
      if (bottleNameExists(draft.nameZh, bottles) || bottleNameExists(draft.nameEn, bottles))
        continue;
      seen.add(key);
      drafts.push(draft);
    }
  }
  return drafts;
}
