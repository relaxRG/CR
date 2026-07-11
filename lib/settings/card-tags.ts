import { usePersistedState } from "@/hooks/use-persisted-state";
import { CardTagSlot, CARD_TAG_SLOTS, FLAVOR_TAGS } from "@/lib/recipes/types";

/** 风味标签行分配：1 = 第一排，2 = 第二排 */
export type FlavorTagRow = 1 | 2;

/** 单个风味标签的配置 */
export interface FlavorTagConfig {
  visible: boolean;
  row: FlavorTagRow;
  color: string;
}

/** Settings for card tag display */
export interface CardTagSettings {
  /** Show flavor tags on bottle cards */
  showBottleFlavorTags: boolean;
  /** Show flavor tags on homemade cards */
  showHomemadeTags: boolean;
  /** Max number of flavor tags to show per card (0 = all) */
  maxTagsPerCard: number;
  /** Show style tag on bottle cards */
  showBottleStyle: boolean;
  /** Show ABV on bottle cards */
  showBottleAbv: boolean;
  /** Show origin on bottle cards */
  showBottleOrigin: boolean;
  /** Show rating on bottle cards */
  showBottleRating: boolean;
  /** Show volume on bottle cards */
  showBottleVolume: boolean;
  /** Recipe card: slot display order (all 7 slots, user-sorted) */
  recipeCardSlotOrder: CardTagSlot[];
  /** Recipe card: which slots are hidden */
  recipeCardSlotHidden: CardTagSlot[];
  /** Recipe card: which slots appear in row 1 (identity row). Remaining visible slots go to row 2. */
  recipeCardRow1Slots: CardTagSlot[];
  /** Recipe card: custom hex color per slot (empty string = use default) */
  recipeCardColors: Partial<Record<CardTagSlot, string>>;
  /** 风味标签全局配置：每个标签的可见性、行分配、颜色 */
  flavorTagConfigs: Partial<Record<string, FlavorTagConfig>>;
  /** 风味标签显示顺序（存标签中文名） */
  flavorTagOrder: string[];
}

/** 17 个精炼风味标签的默认颜色（按分层） */
export const FLAVOR_TAG_DEFAULT_COLORS: Record<string, string> = {
  酸: "#FF6B35",
  甜: "#FF9500",
  苦: "#5856D6",
  烈: "#FF3B30",
  鲜: "#34C759",
  柑橘: "#FF9500",
  热带: "#FF2D55",
  草本: "#34C759",
  花香: "#AF52DE",
  烟熏: "#8E8E93",
  木桶: "#A2845E",
  香料: "#FF6B35",
  坚果可可: "#795548",
  清爽: "#00C7BE",
  浓郁: "#5856D6",
  干爽: "#007AFF",
  复杂: "#AF52DE",
};

/** 默认风味标签行分配：香气特征+口感维度在第一排，基础味觉在第二排 */
export const FLAVOR_TAG_DEFAULT_ROW: Record<string, FlavorTagRow> = {
  酸: 2, 甜: 2, 苦: 2, 烈: 2, 鲜: 2,
  柑橘: 1, 热带: 1, 草本: 1, 花香: 1, 烟熏: 1, 木桶: 1, 香料: 1, 坚果可可: 1,
  清爽: 1, 浓郁: 1, 干爽: 1, 复杂: 1,
};

export const DEFAULT_CARD_TAG_SETTINGS: CardTagSettings = {
  showBottleFlavorTags: true,
  showHomemadeTags: true,
  maxTagsPerCard: 3,
  showBottleStyle: true,
  showBottleAbv: true,
  showBottleOrigin: false,
  showBottleRating: true,
  showBottleVolume: true,
  recipeCardSlotOrder: [...CARD_TAG_SLOTS],
  recipeCardSlotHidden: [],
  recipeCardRow1Slots: ["category", "codexFamily", "baseSpirit"],
  recipeCardColors: {},
  flavorTagConfigs: {},
  flavorTagOrder: [...FLAVOR_TAGS],
};

/** 获取某个风味标签的有效配置（合并默认值） */
export function getFlavorTagConfig(
  tag: string,
  configs: Partial<Record<string, FlavorTagConfig>>,
): FlavorTagConfig {
  const saved = configs[tag];
  return {
    visible: saved?.visible ?? true,
    row: saved?.row ?? (FLAVOR_TAG_DEFAULT_ROW[tag] ?? 1),
    color: saved?.color ?? FLAVOR_TAG_DEFAULT_COLORS[tag] ?? "#007AFF",
  };
}

export function useCardTagSettings() {
  return usePersistedState<CardTagSettings>("card.tag.settings.v2", DEFAULT_CARD_TAG_SETTINGS);
}
