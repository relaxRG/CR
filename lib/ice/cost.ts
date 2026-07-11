/**
 * 冰块成本体系:一次设置,全部配方自动计入,无需逐配方填写。
 *
 * 冰款列表可自由添加/删除,每款独立规格与价格(不互相折算):
 * - pricing="perDrink": 按份计(如摇冰:一袋价格/可摇杯数)
 * - pricing="perGram":  按克计(规格克重+价格 → 元/g × 每杯用量)
 * - pricing="perPiece": 按颗计(单颗价格,如大冰球/直条冰)
 *
 * 智能链接:配方 ice 字段与调制方法通过每款冰的 match 关键词自动匹配,
 * 改名/调价后全部配方成本即时更新。
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type IcePricing = "perDrink" | "perGram" | "perPiece";

export interface IceKind {
  id: string;
  /** 中文名 */
  nameZh: string;
  /** 英文名 */
  nameEn: string;
  /** 计价方式 */
  pricing: IcePricing;
  /** 规格克重(g):perDrink/perGram 用 */
  packGrams: number;
  /** 规格价格(元):perDrink/perGram 用;perPiece 表示单颗价 */
  price: number;
  /** perDrink:一份规格可供杯数(如一袋摇冰摇 8 杯) */
  drinksPerPack: number;
  /** perGram:每杯用量(g) */
  gramsPerDrink: number;
  /** 匹配关键词(正则,匹配配方 ice 字段),智能链接的依据 */
  match: string;
  /** 是否为摇冰(摇和/搅拌调制环节默认消耗此款) */
  isShakeIce: boolean;
}

export interface IceSettings {
  /** 是否启用冰块成本 */
  enabled: boolean;
  /** 搅拌是否消耗一份摇冰(滤冰弃用),默认开 */
  stirConsumesIce: boolean;
  /** 冰款列表(可自由增删改) */
  kinds: IceKind[];
}

export const DEFAULT_ICE_KINDS: IceKind[] = [
  {
    id: "ice-shake",
    nameZh: "摇冰",
    nameEn: "Shaking Ice",
    pricing: "perDrink",
    packGrams: 1000,
    price: 10,
    drinksPerPack: 8,
    gramsPerDrink: 0,
    match: "摇冰|shak",
    isShakeIce: true,
  },
  {
    id: "ice-cubes",
    nameZh: "标准方冰",
    nameEn: "Ice Cubes",
    pricing: "perGram",
    packGrams: 1000,
    price: 12,
    drinksPerPack: 0,
    gramsPerDrink: 120,
    match: "方冰|块冰|标准|cube",
    isShakeIce: false,
  },
  {
    id: "ice-spear",
    nameZh: "直条冰",
    nameEn: "Ice Spear",
    pricing: "perPiece",
    packGrams: 0,
    price: 3,
    drinksPerPack: 0,
    gramsPerDrink: 0,
    match: "直条|条冰|长条|柱冰|spear|collins|stick",
    isShakeIce: false,
  },
  {
    id: "ice-crushed",
    nameZh: "碎冰",
    nameEn: "Crushed Ice",
    pricing: "perGram",
    packGrams: 1000,
    price: 10,
    drinksPerPack: 0,
    gramsPerDrink: 200,
    match: "碎冰|crush|pebble|shaved",
    isShakeIce: false,
  },
  {
    id: "ice-big",
    nameZh: "大冰 / 冰球",
    nameEn: "Big Cube / Sphere",
    pricing: "perPiece",
    packGrams: 0,
    price: 2,
    drinksPerPack: 0,
    gramsPerDrink: 0,
    match: "大方冰|大冰|球冰|冰球|老冰|big|large|sphere|ball|block",
    isShakeIce: false,
  },
];

export const DEFAULT_ICE_SETTINGS: IceSettings = {
  enabled: true,
  stirConsumesIce: true,
  kinds: DEFAULT_ICE_KINDS,
};

export const ICE_SETTINGS_KEY = "cocktail.iceSettings.v2";

export async function loadIceSettings(): Promise<IceSettings> {
  try {
    const raw = await AsyncStorage.getItem(ICE_SETTINGS_KEY);
    if (!raw) return DEFAULT_ICE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<IceSettings>;
    return {
      ...DEFAULT_ICE_SETTINGS,
      ...parsed,
      kinds: Array.isArray(parsed.kinds) && parsed.kinds.length > 0 ? parsed.kinds : DEFAULT_ICE_KINDS,
    };
  } catch {
    return DEFAULT_ICE_SETTINGS;
  }
}

export async function saveIceSettings(s: IceSettings): Promise<void> {
  await AsyncStorage.setItem(ICE_SETTINGS_KEY, JSON.stringify(s));
}

/** 单杯成本(按该款计价方式) */
export function iceKindCostPerDrink(k: IceKind): number {
  if (k.pricing === "perDrink") {
    const n = k.drinksPerPack > 0 ? k.drinksPerPack : 1;
    return k.price / n;
  }
  if (k.pricing === "perGram") {
    const g = k.packGrams > 0 ? k.packGrams : 1000;
    return (k.price / g) * k.gramsPerDrink;
  }
  return k.price; // perPiece
}

/** 智能匹配冰款:按 match 关键词匹配 ice 字段文本 */
export function matchIceKind(iceText: string, kinds: IceKind[]): IceKind | null {
  const t = (iceText || "").trim();
  if (!t) return null;
  // 更长的匹配片段视为更具体(如"大方冰"应优先命中大冰而非方冰)
  let best: IceKind | null = null;
  let bestLen = 0;
  for (const k of kinds) {
    if (!k.match) continue;
    try {
      const m = t.match(new RegExp(k.match, "i"));
      if (m && m[0].length > bestLen) {
        best = k;
        bestLen = m[0].length;
      }
    } catch {
      if (t.includes(k.match) && k.match.length > bestLen) {
        best = k;
        bestLen = k.match.length;
      }
    }
  }
  return best;
}

export interface IceCostItem {
  /** 冰用途:shake=摇冰, stir=搅拌冰, serve=出品杯用冰 */
  use: "shake" | "stir" | "serve";
  kind: IceKind;
  cost: number;
}

export interface IceCost {
  items: IceCostItem[];
  total: number;
}

const NO_ICE_RE = /无冰|不加冰|neat|no\s*ice|^up$/i;

/**
 * 智能冰块成本:调制方法决定摇冰消耗,ice 字段智能匹配出品杯冰款。
 */
export function estimateIceCost(method: string, ice: string, s: IceSettings): IceCost {
  const items: IceCostItem[] = [];
  if (!s || !s.enabled) return { items, total: 0 };
  const kinds = Array.isArray(s.kinds) ? s.kinds : DEFAULT_ICE_KINDS;
  const m = (method || "").trim();
  const i = (ice || "").trim();
  const shakeKind = kinds.find((k) => k.isShakeIce) ?? null;

  // 1) 调制环节用冰(滤冰弃用)
  if (shakeKind) {
    if (/摇和|shake/i.test(m)) {
      items.push({ use: "shake", kind: shakeKind, cost: iceKindCostPerDrink(shakeKind) });
    } else if (/搅拌|stir/i.test(m) && s.stirConsumesIce) {
      items.push({ use: "stir", kind: shakeKind, cost: iceKindCostPerDrink(shakeKind) });
    }
  }

  // 2) 出品杯用冰:智能匹配冰款
  if (i && !NO_ICE_RE.test(i)) {
    const k = matchIceKind(i, kinds.filter((x) => !x.isShakeIce));
    if (k) items.push({ use: "serve", kind: k, cost: iceKindCostPerDrink(k) });
  } else if (!i && /搅打|blend/i.test(m)) {
    const crushed = kinds.find((k) => /碎冰|crush/i.test(k.nameZh + k.match));
    if (crushed) items.push({ use: "serve", kind: crushed, cost: iceKindCostPerDrink(crushed) });
  }

  const total = items.reduce((sum, x) => sum + x.cost, 0);
  return { items, total: Math.round(total * 100) / 100 };
}
