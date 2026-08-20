import type { Bottle, SupplierChannel } from "@/lib/bottles/types";
import { createSupplierChannelPurchaseName, getSupplierChannelPurchaseNames, normalizeSupplierChannels, resolveCostChannelId } from "@/lib/bottles/types";
import { resolveBottleForSupplierProductName } from "@/lib/bottles/supplier-channel-resolver";
import type { SpiritItem } from "./types";
import { normalizeSpiritSupplierAlias } from "./supplier-alias";

export interface SpiritBottleChannelMigration {
  bottleUpdates: Bottle[];
  itemPatches: Array<{ id: string; patch: Pick<SpiritItem, "bottleId" | "bottleLinkConfidence"> }>;
  unresolvedItemIds: string[];
}

function makeMigratedChannelId(bottle: Bottle, existing: SupplierChannel[]): string {
  let index = existing.length + 1;
  let id = `legacy-channel-${bottle.id}-${index}`;
  while (existing.some((channel) => channel.id === id)) id = `legacy-channel-${bottle.id}-${++index}`;
  return id;
}

function addNamesToChannel(channel: SupplierChannel, names: string[], now: string): SupplierChannel {
  const merged = [
    ...getSupplierChannelPurchaseNames(channel),
    ...names.map((name) => createSupplierChannelPurchaseName(name, now)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  ];
  const normalized = normalizeSupplierChannels([{ ...channel, purchaseNames: merged }]);
  return normalized[0] ?? channel;
}

/**
 * 将烈酒旧 supplier/supplierAliases 安全迁入已关联或唯一可解析的鸡尾酒库酒款渠道。
 * 无法唯一匹配的项目保留待关联状态，绝不自动创建或错误合并酒款。
 */
export function migrateSpiritAliasesToBottleChannels(items: SpiritItem[], bottles: Bottle[], now = new Date().toISOString()): SpiritBottleChannelMigration {
  const working = bottles.map((bottle) => ({ ...bottle, supplierChannels: normalizeSupplierChannels(bottle.supplierChannels, bottle.costChannelId) }));
  const bottleUpdates: Bottle[] = [];
  const itemPatches: SpiritBottleChannelMigration["itemPatches"] = [];
  const unresolvedItemIds: string[] = [];

  for (const item of items) {
    const bottle = item.bottleId
      ? working.find((candidate) => candidate.id === item.bottleId)
      : resolveBottleForSupplierProductName(working, item.supplier, item.name)?.bottle;
    if (!bottle) {
      unresolvedItemIds.push(item.id);
      continue;
    }

    if (item.bottleId !== bottle.id || item.bottleLinkConfidence !== "auto") {
      itemPatches.push({ id: item.id, patch: { bottleId: bottle.id, bottleLinkConfidence: "auto" } });
    }

    const sourceBySupplier = new Map<string, { supplier: string; names: string[] }>();
    const collect = (supplier: string | undefined, name: string | undefined) => {
      const supplierText = supplier?.trim();
      const nameText = name?.trim();
      if (!supplierText || !nameText) return;
      const key = normalizeSpiritSupplierAlias(supplierText);
      const current = sourceBySupplier.get(key) ?? { supplier: supplierText, names: [] };
      current.names.push(nameText);
      sourceBySupplier.set(key, current);
    };
    collect(item.supplier, item.name);
    for (const alias of item.supplierAliases ?? []) collect(alias.supplier, alias.purchaseName);

    if (sourceBySupplier.size === 0) continue;
    let nextChannels = bottle.supplierChannels ?? [];
    for (const entry of sourceBySupplier.values()) {
      const supplierKey = normalizeSpiritSupplierAlias(entry.supplier);
      const existing = nextChannels.find((channel) => normalizeSpiritSupplierAlias(channel.name) === supplierKey);
      if (existing) {
        nextChannels = nextChannels.map((channel) => channel.id === existing.id ? addNamesToChannel(channel, entry.names, now) : channel);
        continue;
      }
      const purchaseNames = entry.names.map((name) => createSupplierChannelPurchaseName(name, now)).filter((name): name is NonNullable<typeof name> => Boolean(name));
      nextChannels = [...nextChannels, {
        id: makeMigratedChannelId(bottle, nextChannels),
        type: "supplier",
        name: entry.supplier,
        ...(purchaseNames[0] ? { supplierProductName: purchaseNames[0].name } : {}),
        ...(purchaseNames.length > 0 ? { purchaseNames } : {}),
        latestPrice: item.refPrice > 0 ? item.refPrice : 0,
        unit: item.unit || "瓶",
        isCostBasis: false,
        ...(item.refPrice > 0 ? { priceHistory: [{ date: now.slice(0, 10), price: item.refPrice, source: "烈酒历史迁移" }] } : {}),
        createdAt: now,
        updatedAt: now,
      }];
    }
    const requestedCostChannelId = resolveCostChannelId(nextChannels, bottle.costChannelId)
      ?? nextChannels.find((channel) => channel.latestPrice > 0)?.id;
    const normalizedChannels = normalizeSupplierChannels(nextChannels, requestedCostChannelId);
    const nextBottle = {
      ...bottle,
      supplierChannels: normalizedChannels,
      ...(requestedCostChannelId ? { costChannelId: requestedCostChannelId } : {}),
      ...(normalizedChannels.find((channel) => channel.id === requestedCostChannelId) ? { priceCny: normalizedChannels.find((channel) => channel.id === requestedCostChannelId)!.latestPrice } : {}),
    };
    const position = working.findIndex((candidate) => candidate.id === bottle.id);
    if (position >= 0) working[position] = nextBottle;
    bottleUpdates.push(nextBottle);
  }

  return { bottleUpdates, itemPatches, unresolvedItemIds };
}
