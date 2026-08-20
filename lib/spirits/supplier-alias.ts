import type { SpiritItem, SpiritSupplierAlias } from "./types";

/** 与烈酒导入规范一致：忽略包装单位、空白及常见标点，仅用于确定性匹配。 */
export function normalizeSpiritSupplierAlias(value: string): string {
  return value
    .toLowerCase()
    .replace(/[（）()\[\]{}<>]/g, "")
    .replace(/[\s·・_\-/\\,，。:：]/g, "")
    .replace(/\d+(?:\.\d+)?(?:ml|cl|l|oz|瓶|箱|件|支|罐|袋|盒)/gi, "")
    .trim();
}

export function createSpiritSupplierAlias(supplier: string, purchaseName: string): SpiritSupplierAlias {
  const normalizedSupplier = normalizeSpiritSupplierAlias(supplier);
  const normalizedName = normalizeSpiritSupplierAlias(purchaseName);
  if (!normalizedSupplier || !normalizedName) throw new Error("供应商和采购名称不能为空");
  return { supplier: supplier.trim(), purchaseName: purchaseName.trim(), normalizedSupplier, normalizedName };
}

export function normalizeSpiritSupplierAliases(aliases: readonly SpiritSupplierAlias[] | undefined): SpiritSupplierAlias[] {
  const result: SpiritSupplierAlias[] = [];
  for (const alias of aliases ?? []) {
    if (!alias?.supplier?.trim() || !alias?.purchaseName?.trim()) continue;
    const next = createSpiritSupplierAlias(alias.supplier, alias.purchaseName);
    if (!result.some((entry) => entry.normalizedSupplier === next.normalizedSupplier && entry.normalizedName === next.normalizedName)) result.push(next);
  }
  return result;
}

export function upsertSpiritSupplierAlias(
  aliases: readonly SpiritSupplierAlias[] | undefined,
  supplier: string,
  purchaseName: string,
): SpiritSupplierAlias[] {
  const next = createSpiritSupplierAlias(supplier, purchaseName);
  return [...(aliases ?? []).filter((entry) => !(entry.normalizedSupplier === next.normalizedSupplier && entry.normalizedName === next.normalizedName)), next];
}

export function removeSpiritSupplierAlias(
  aliases: readonly SpiritSupplierAlias[] | undefined,
  target: SpiritSupplierAlias,
): SpiritSupplierAlias[] {
  return (aliases ?? []).filter((entry) => !(entry.normalizedSupplier === target.normalizedSupplier && entry.normalizedName === target.normalizedName));
}

export type SpiritSupplierMatchReason = "supplier-alias" | "supplier-canonical-name" | "unique-canonical-name";
export interface SpiritSupplierMatch { item: SpiritItem; reason: SpiritSupplierMatchReason; }

/**
 * 优先级：供应商别名 > 主要供应商下标准名/原文名 > 全库唯一标准名。
 * 任何歧义均返回 null，随后交由既有人工确认/模糊匹配流程处理。
 */
export function resolveSpiritItemForSupplierName(
  items: readonly SpiritItem[],
  supplier: string | undefined,
  purchaseName: string,
): SpiritSupplierMatch | null {
  const normalizedSupplier = normalizeSpiritSupplierAlias(supplier ?? "");
  const normalizedName = normalizeSpiritSupplierAlias(purchaseName);
  // 已归档酒款不能作为默认导入匹配目标；调用方可显式提示恢复或新建。
  const activeItems = items.filter((item) => item.active);
  if (!normalizedName) return null;

  const aliases = activeItems.filter((item) => (item.supplierAliases ?? []).some((alias) =>
    alias.normalizedSupplier === normalizedSupplier && alias.normalizedName === normalizedName,
  ));
  if (aliases.length === 1) return { item: aliases[0], reason: "supplier-alias" };
  if (aliases.length > 1) return null;

  const supplierCanonical = activeItems.filter((item) =>
    normalizeSpiritSupplierAlias(item.supplier ?? "") === normalizedSupplier
    && [item.name, item.nameEn ?? ""].some((name) => normalizeSpiritSupplierAlias(name) === normalizedName),
  );
  if (supplierCanonical.length === 1) return { item: supplierCanonical[0], reason: "supplier-canonical-name" };
  if (supplierCanonical.length > 1) return null;

  const canonical = activeItems.filter((item) => [item.name, item.nameEn ?? ""].some((name) => normalizeSpiritSupplierAlias(name) === normalizedName));
  return canonical.length === 1 ? { item: canonical[0], reason: "unique-canonical-name" } : null;
}
