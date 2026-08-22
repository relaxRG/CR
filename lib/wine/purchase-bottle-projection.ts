import { WineBottle, WineManualPurchase, WinePurchaseChannelProjection } from "./types";

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s\-–—_()（）·.，,]/g, "");
}

function channelId(bottleId: string, supplier: string): string {
  return `wine-purchase-channel:${bottleId}:${normalize(supplier)}`;
}

function sameProjection(left: WinePurchaseChannelProjection[] | undefined, right: WinePurchaseChannelProjection[]): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right);
}

/**
 * WineManualPurchase 是唯一可写的采购事实。此函数只把已确认 bottleId 的事实投影到 WineBottle，
 * 不接收或推断名称匹配，因此解除链接、删除采购或重链时会自然撤回旧档案残留。
 */
export function projectWinePurchaseChannels(bottleId: string, purchases: WineManualPurchase[]): WinePurchaseChannelProjection[] {
  const matched = purchases
    .filter((purchase) => purchase.bottleId === bottleId)
    .sort((left, right) => left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const grouped = new Map<string, WineManualPurchase[]>();
  matched.forEach((purchase) => {
    const key = normalize(purchase.supplier);
    grouped.set(key, [...(grouped.get(key) ?? []), purchase]);
  });
  return [...grouped.entries()].map(([, channelPurchases]) => {
    const first = channelPurchases[0];
    const type: WinePurchaseChannelProjection["type"] = first.supplier.includes("自采") || first.supplier.includes("电商") ? "self_purchase" : "supplier";
    return {
      id: channelId(bottleId, first.supplier),
      supplier: first.supplier,
      type,
      supplierProductNames: [...new Set(channelPurchases.map((purchase) => purchase.productName.trim()).filter(Boolean))],
      priceHistory: channelPurchases.map((purchase) => ({
        sourcePurchaseId: purchase.id,
        date: purchase.date,
        unitPrice: purchase.unitPrice,
        quantity: purchase.quantity,
        amount: purchase.amount,
        supplierProductName: purchase.productName,
      })),
    };
  }).sort((left, right) => left.supplier.localeCompare(right.supplier, "zh-CN"));
}

/**
 * 若用户已选择且渠道仍存在，成本基准绝不被采购新增或编辑覆盖；
 * 只有没有基准、或原基准因解除链接/删除采购消失时，才选择最早可用渠道作为默认值。
 */
export function reconcileWineBottlePurchaseProjection(bottle: WineBottle, purchases: WineManualPurchase[]): Partial<WineBottle> | null {
  const projections = projectWinePurchaseChannels(bottle.id, purchases);
  const selectedChannel = projections.find((channel) => channel.id === bottle.costChannelId) ?? projections[0];
  const latestCost = selectedChannel?.priceHistory[selectedChannel.priceHistory.length - 1]?.unitPrice ?? bottle.costPrice;
  const nextCostChannelId = selectedChannel?.id;
  const unchanged = sameProjection(bottle.purchaseChannelProjections, projections)
    && bottle.costChannelId === nextCostChannelId
    && bottle.costPrice === latestCost;
  if (unchanged) return null;
  return {
    purchaseChannelProjections: projections,
    ...(nextCostChannelId ? { costChannelId: nextCostChannelId } : { costChannelId: undefined }),
    ...(latestCost !== undefined ? { costPrice: latestCost } : {}),
  };
}
