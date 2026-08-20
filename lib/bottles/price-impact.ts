import type { Bottle, SupplierChannel } from "./types";

export interface ChannelPriceImpact {
  channelId: string;
  channelName: string;
  previousPrice: number | null;
  currentPrice: number;
  delta: number;
  deltaPercent: number | null;
  isCostBasis: boolean;
}

export function getChannelPriceImpact(channel: SupplierChannel): ChannelPriceImpact | null {
  const currentPrice = Number(channel.latestPrice);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;
  const history = [...(channel.priceHistory ?? [])]
    .filter((entry) => Number.isFinite(entry.price) && entry.price > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const previousPrice = history.length >= 2 ? history[history.length - 2].price : null;
  const delta = previousPrice === null ? 0 : currentPrice - previousPrice;
  return {
    channelId: channel.id,
    channelName: channel.name,
    previousPrice,
    currentPrice,
    delta,
    deltaPercent: previousPrice && previousPrice > 0 ? delta / previousPrice : null,
    isCostBasis: channel.isCostBasis,
  };
}

export function getBottleCostPriceImpact(bottle: Bottle): ChannelPriceImpact | null {
  const basis = (bottle.supplierChannels ?? []).find((channel) => channel.id === bottle.costChannelId)
    ?? (bottle.supplierChannels ?? []).find((channel) => channel.isCostBasis);
  return basis ? getChannelPriceImpact(basis) : null;
}
