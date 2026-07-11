/**
 * 联网补全结果 → 酒款更新的共享应用逻辑:
 * 只填充空字段,不覆盖用户已有数据;分类仅在自动添加的空壳条目上采用 LLM 归类。
 */
import type { EnrichedProduct } from "../../server/routers";
import type { Bottle } from "./types";
import { BOTTLE_CATEGORIES } from "./types";
import type { BottleDraft } from "./store";

const norm = (s: string) => s.trim().toLowerCase();

/** 用于联网查询的名称(中英合并,信息量最大) */
export function enrichQueryName(b: Bottle): string {
  return [b.nameZh, b.nameEn].filter(Boolean).join(" ");
}

/** 按 query 匹配返回条目,兜底按索引对位(服务端承诺不增删条目) */
export function matchEnrichedItem(
  items: EnrichedProduct[],
  names: string[],
  i: number,
): EnrichedProduct | undefined {
  return (
    items.find((it) => it.found && norm(it.query) === norm(names[i])) ??
    (items[i]?.found ? items[i] : undefined)
  );
}

/** 合并补全结果到现有酒款,返回更新草稿;无任何变化时返回 null */
export function applyEnrichedToBottle(b: Bottle, item: EnrichedProduct): BottleDraft | null {
  const validCat = (BOTTLE_CATEGORIES as readonly string[]).includes(item.category);
  const isAutoAdded = b.notes.startsWith("自动添加");
  const draft: BottleDraft = {
    nameZh: b.nameZh || item.nameZh,
    nameEn: b.nameEn || item.nameEn,
    category: validCat && isAutoAdded ? item.category : b.category,
    style: b.style || item.style,
    brand: b.brand || item.brand,
    origin: b.origin || item.origin,
    volume: b.volume || item.volume,
    abv: b.abv > 0 ? b.abv : item.abv,
    priceCny: b.priceCny > 0 ? b.priceCny : item.priceCny,
    notes: isAutoAdded || !b.notes ? item.notes || b.notes : b.notes,
    flavorTags: [],
    story: "",
    styleDesc: "",
    rating: b.rating,
  };
  const changed =
    draft.nameZh !== b.nameZh ||
    draft.nameEn !== b.nameEn ||
    draft.category !== b.category ||
    draft.style !== b.style ||
    draft.brand !== b.brand ||
    draft.origin !== b.origin ||
    draft.volume !== b.volume ||
    draft.abv !== b.abv ||
    draft.priceCny !== b.priceCny ||
    draft.notes !== b.notes;
  return changed ? draft : null;
}
