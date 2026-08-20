import type { Bottle, SupplierChannel } from "./types";
import { getSupplierChannelPurchaseNames } from "./types";

export type BottleLinkConfidence = "channel-exact" | "catalog-exact";

export interface BottleChannelResolution {
  bottle: Bottle;
  channel?: SupplierChannel;
  confidence: BottleLinkConfidence;
}

export function normalizeBottleSupplierText(value: string | undefined | null): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[（）()\[\]【】]/g, "")
    .replace(/[\s·•\-_/]/g, "");
}

function uniqueResolution(candidates: BottleChannelResolution[]): BottleChannelResolution | null {
  if (candidates.length !== 1) return null;
  return candidates[0];
}

/**
 * 以“渠道名称 + 采购名称”优先解析鸡尾酒库酒款。
 * 任意多匹配均返回 null，要求人工选择，绝不自动误绑。
 */
export function resolveBottleForSupplierProductName(
  bottles: Bottle[],
  supplier: string | undefined,
  rawName: string,
): BottleChannelResolution | null {
  const supplierKey = normalizeBottleSupplierText(supplier);
  const nameKey = normalizeBottleSupplierText(rawName);
  if (!nameKey) return null;

  const channelMatches: BottleChannelResolution[] = [];
  for (const bottle of bottles) {
    for (const channel of bottle.supplierChannels ?? []) {
      if (supplierKey && normalizeBottleSupplierText(channel.name) !== supplierKey) continue;
      if (getSupplierChannelPurchaseNames(channel).some((entry) => entry.normalizedName === nameKey)) {
        channelMatches.push({ bottle, channel, confidence: "channel-exact" });
      }
    }
  }
  const exactChannel = uniqueResolution(channelMatches);
  if (exactChannel) return exactChannel;
  if (channelMatches.length > 1) return null;

  const catalogMatches = bottles
    .filter((bottle) => [bottle.nameZh, bottle.nameEn, bottle.brand].some((name) => normalizeBottleSupplierText(name) === nameKey))
    .map((bottle) => ({ bottle, confidence: "catalog-exact" as const }));
  return uniqueResolution(catalogMatches);
}
