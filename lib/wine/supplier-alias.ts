import { WineBottle, WineSupplierAlias } from "./types";

/** 供应商与酒款名称仅用于确定性匹配；保留原始展示文本，不改变采购流水审计名称。 */
export function normalizeWineSupplierAlias(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s\-–—_()（）·.，,]/g, "");
}

export function normalizeWineProductAlias(value: string): string {
  return normalizeWineSupplierAlias(value);
}

export function createWineSupplierAlias(supplier: string, purchaseName: string): WineSupplierAlias {
  const normalizedSupplier = normalizeWineSupplierAlias(supplier);
  const normalizedName = normalizeWineProductAlias(purchaseName);
  if (!normalizedSupplier || !normalizedName) {
    throw new Error("供应商和采购名称不能为空");
  }
  return {
    supplier: supplier.trim(),
    purchaseName: purchaseName.trim(),
    normalizedSupplier,
    normalizedName,
  };
}

/**
 * 对一个酒款新增或更新供应商别名。相同供应商下同名写法只保留一条，避免匹配歧义。
 */
export function upsertWineSupplierAlias(
  aliases: readonly WineSupplierAlias[] | undefined,
  supplier: string,
  purchaseName: string,
): WineSupplierAlias[] {
  const next = createWineSupplierAlias(supplier, purchaseName);
  const existing = aliases ?? [];
  const withoutDuplicate = existing.filter((alias) => !(
    alias.normalizedSupplier === next.normalizedSupplier
    && alias.normalizedName === next.normalizedName
  ));
  return [...withoutDuplicate, next];
}

export function removeWineSupplierAlias(
  aliases: readonly WineSupplierAlias[] | undefined,
  aliasToRemove: WineSupplierAlias,
): WineSupplierAlias[] {
  return (aliases ?? []).filter((alias) => !(
    alias.normalizedSupplier === aliasToRemove.normalizedSupplier
    && alias.normalizedName === aliasToRemove.normalizedName
  ));
}

export type WineBottleMatchReason = "supplier-alias" | "supplier-canonical-name" | "unique-canonical-name";

export interface WineBottleMatch {
  bottle: WineBottle;
  reason: WineBottleMatchReason;
}

/**
 * 采购名称匹配优先级：供应商别名 > 该供应商的标准名/原文名 > 全库唯一标准名。
 * 多条候选时返回 null，禁止以模糊猜测生成错误 bottleId。
 */
export function resolveWineBottleForSupplierName(
  bottles: readonly WineBottle[],
  supplier: string,
  purchaseName: string,
): WineBottleMatch | null {
  const normalizedSupplier = normalizeWineSupplierAlias(supplier);
  const normalizedName = normalizeWineProductAlias(purchaseName);
  if (!normalizedName) return null;

  const aliasMatches = bottles.filter((bottle) => (bottle.supplierAliases ?? []).some((alias) =>
    alias.normalizedSupplier === normalizedSupplier && alias.normalizedName === normalizedName,
  ));
  if (aliasMatches.length === 1) return { bottle: aliasMatches[0], reason: "supplier-alias" };
  if (aliasMatches.length > 1) return null;

  const supplierCanonicalMatches = bottles.filter((bottle) =>
    normalizeWineSupplierAlias(bottle.supplier) === normalizedSupplier
    && [bottle.name, bottle.nameEn].some((name) => normalizeWineProductAlias(name) === normalizedName),
  );
  if (supplierCanonicalMatches.length === 1) return { bottle: supplierCanonicalMatches[0], reason: "supplier-canonical-name" };
  if (supplierCanonicalMatches.length > 1) return null;

  const canonicalMatches = bottles.filter((bottle) =>
    [bottle.name, bottle.nameEn].some((name) => normalizeWineProductAlias(name) === normalizedName),
  );
  return canonicalMatches.length === 1 ? { bottle: canonicalMatches[0], reason: "unique-canonical-name" } : null;
}

export function bottleHasWineSupplier(bottle: WineBottle, supplier: string): boolean {
  const normalizedSupplier = normalizeWineSupplierAlias(supplier);
  return normalizeWineSupplierAlias(bottle.supplier) === normalizedSupplier
    || (bottle.supplierAliases ?? []).some((alias) => alias.normalizedSupplier === normalizedSupplier);
}

export function getWinePurchaseNameForSupplier(bottle: WineBottle, supplier: string): string {
  const normalizedSupplier = normalizeWineSupplierAlias(supplier);
  return (bottle.supplierAliases ?? []).find((alias) => alias.normalizedSupplier === normalizedSupplier)?.purchaseName
    ?? bottle.name;
}

/** 历史快照中没有规范化字段时，首读规范化，避免旧数据无法匹配。 */
export function normalizeWineSupplierAliases(aliases: readonly WineSupplierAlias[] | undefined): WineSupplierAlias[] {
  const normalized: WineSupplierAlias[] = [];
  for (const alias of aliases ?? []) {
    const supplier = alias.supplier?.trim();
    const purchaseName = alias.purchaseName?.trim();
    if (!supplier || !purchaseName) continue;
    const next = createWineSupplierAlias(supplier, purchaseName);
    if (!normalized.some((entry) => entry.normalizedSupplier === next.normalizedSupplier && entry.normalizedName === next.normalizedName)) {
      normalized.push(next);
    }
  }
  return normalized;
}
