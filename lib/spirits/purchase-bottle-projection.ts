import {
  createSupplierChannelPurchaseName,
  getSupplierChannelPurchaseNames,
  normalizeSupplierChannels,
  resolveCostChannelId,
  type Bottle,
  type SupplierChannel,
  type SupplierPriceRecord,
} from "@/lib/bottles/types";
import { normalizeBottleSupplierText } from "@/lib/bottles/supplier-channel-resolver";
import type { SpiritPurchaseRecord } from "@/lib/spirits/types";

export interface BottlePurchaseProjection {
  supplierChannels: SupplierChannel[];
  costChannelId?: string;
  priceCny: number;
}

function channelTypeForPurchase(purchase: SpiritPurchaseRecord): "supplier" | "self" {
  return purchase.supplier?.trim() === "自采" ? "self" : "supplier";
}

function sourceLabel(source: SpiritPurchaseRecord["source"]): string {
  return source === "excel" ? "Excel 导入" : source === "pdf" ? "PDF 导入" : "手动录入";
}

function purchaseHistoryRecord(purchase: SpiritPurchaseRecord): SupplierPriceRecord {
  return {
    date: purchase.date,
    price: purchase.unitPrice,
    quantity: purchase.quantity,
    source: sourceLabel(purchase.source),
    sourcePurchaseId: purchase.id,
  };
}

function isNewerPurchase(left: SpiritPurchaseRecord, right: SpiritPurchaseRecord) {
  return `${left.date}|${left.createdAt}|${left.id}`.localeCompare(`${right.date}|${right.createdAt}|${right.id}`) > 0;
}

function stableProjectionValue(projection: BottlePurchaseProjection) {
  return JSON.stringify({
    supplierChannels: projection.supplierChannels.map((channel) => ({
      ...channel,
      updatedAt: undefined,
      createdAt: undefined,
    })),
    costChannelId: projection.costChannelId,
    priceCny: projection.priceCny,
  });
}

/**
 * 将已链接到某个酒库酒款的采购记录投影为该酒款的供应渠道与价格历史。
 * 渠道及价格不能在这里被凭空创建：每一个新增渠道、采购名称和 sourcePurchaseId
 * 都能回溯到一笔真实采购记录。旧版无 sourcePurchaseId 的遗留价格会被保留兼容。
 */
export function projectBottleSupplierChannelsFromPurchases(
  bottle: Bottle,
  purchases: SpiritPurchaseRecord[],
): BottlePurchaseProjection {
  const existingChannels = normalizeSupplierChannels(bottle.supplierChannels, bottle.costChannelId);
  const grouped = new Map<string, SpiritPurchaseRecord[]>();

  purchases
    .filter((purchase) => purchase.supplier?.trim() && purchase.rawName.trim() && purchase.unitPrice > 0)
    .forEach((purchase) => {
      const key = normalizeBottleSupplierText(purchase.supplier);
      if (!key) return;
      grouped.set(key, [...(grouped.get(key) ?? []), purchase]);
    });

  const projectedKeys = new Set(grouped.keys());
  const channels: SupplierChannel[] = [];

  // 仍无采购驱动来源的旧渠道仅为历史兼容保留；一旦渠道存在采购来源，则完全按采购重建。
  existingChannels
    .filter((channel) => {
      const key = normalizeBottleSupplierText(channel.name);
      const hasPurchaseProjection = (channel.priceHistory ?? []).some((record) => Boolean(record.sourcePurchaseId));
      return !projectedKeys.has(key) && !hasPurchaseProjection;
    })
    .forEach((channel) => channels.push(channel));

  grouped.forEach((records, supplierKey) => {
    const existing = existingChannels.find((channel) => normalizeBottleSupplierText(channel.name) === supplierKey);
    const newest = records.reduce((latest, current) => isNewerPurchase(current, latest) ? current : latest);
    const legacyHistory = (existing?.priceHistory ?? []).filter((record) => !record.sourcePurchaseId);
    const priceHistory = [
      ...records.map(purchaseHistoryRecord),
      ...legacyHistory,
    ].sort((left, right) => `${right.date}|${right.sourcePurchaseId ?? ""}`.localeCompare(`${left.date}|${left.sourcePurchaseId ?? ""}`));
    const purchaseNames = [
      ...getSupplierChannelPurchaseNames(existing ?? {}),
      ...records.map((purchase) => createSupplierChannelPurchaseName(purchase.rawName, purchase.createdAt)).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    ];
    const normalizedPurchaseNames = purchaseNames.reduce<NonNullable<typeof purchaseNames>>((result, entry) => {
      if (!result.some((existingName) => existingName.normalizedName === entry.normalizedName)) result.push(entry);
      return result;
    }, []);
    const channel: SupplierChannel = {
      id: existing?.id ?? `purchase-channel-${bottle.id}-${supplierKey}`,
      type: existing?.type ?? channelTypeForPurchase(newest),
      name: newest.supplier!.trim(),
      ...(normalizedPurchaseNames[0] ? { supplierProductName: normalizedPurchaseNames[0].name } : {}),
      ...(normalizedPurchaseNames.length > 0 ? { purchaseNames: normalizedPurchaseNames } : {}),
      latestPrice: newest.unitPrice,
      unit: newest.unit || existing?.unit || "瓶",
      ...(existing?.purchaseUrl ? { purchaseUrl: existing.purchaseUrl } : {}),
      isCostBasis: false,
      priceHistory,
      ...(existing?.notes ? { notes: existing.notes } : {}),
      createdAt: existing?.createdAt ?? newest.createdAt,
      updatedAt: newest.createdAt,
    };
    channels.push(channel);
  });

  const requestedCostChannelId = resolveCostChannelId(channels, bottle.costChannelId) ?? channels[0]?.id;
  const supplierChannels = normalizeSupplierChannels(
    channels.map((channel) => ({ ...channel, isCostBasis: channel.id === requestedCostChannelId })),
    requestedCostChannelId,
  );
  const costChannelId = resolveCostChannelId(supplierChannels, requestedCostChannelId);
  const hadPurchaseProjection = existingChannels.some((channel) =>
    (channel.priceHistory ?? []).some((record) => Boolean(record.sourcePurchaseId)),
  );
  const hasLegacyChannel = existingChannels.some((channel) =>
    (channel.priceHistory ?? []).some((record) => !record.sourcePurchaseId),
  );
  const costPrice = costChannelId
    ? supplierChannels.find((channel) => channel.id === costChannelId)?.latestPrice ?? bottle.priceCny
    // 仅由采购投影形成的价格在解除最后一笔采购后必须归零；旧人工渠道仍保留其原有参考价。
    : hadPurchaseProjection && !hasLegacyChannel ? 0 : bottle.priceCny;

  // 始终写入 costChannelId，令重链 / 解除链接能覆盖旧基准而不留下悬挂 ID。
  return { supplierChannels, costChannelId, priceCny: costPrice };
}

export function hasBottlePurchaseProjectionChanged(bottle: Bottle, projection: BottlePurchaseProjection) {
  const current: BottlePurchaseProjection = {
    supplierChannels: normalizeSupplierChannels(bottle.supplierChannels, bottle.costChannelId),
    ...(resolveCostChannelId(normalizeSupplierChannels(bottle.supplierChannels, bottle.costChannelId), bottle.costChannelId)
      ? { costChannelId: resolveCostChannelId(normalizeSupplierChannels(bottle.supplierChannels, bottle.costChannelId), bottle.costChannelId) }
      : {}),
    priceCny: bottle.priceCny,
  };
  return stableProjectionValue(current) !== stableProjectionValue(projection);
}
