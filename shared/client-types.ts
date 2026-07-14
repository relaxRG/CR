/**
 * 客户端类型定义（独立于 server/routers.ts）
 * 这些类型与 server/routers.ts 中的 schema 保持一致，但不依赖服务端代码
 * 目的：让 App 端完全脱离 Manus server 依赖
 */

/** 批量补全瓶子的简要结果（用于 recipe/[id].tsx 的缺失原材料补全） */
export type EnrichedProduct = {
  query: string;
  found: boolean;
  nameZh: string;
  nameEn: string;
  category: string;
  style: string;
  brand: string;
  origin: string;
  volume: string;
  abv: number;
  priceCny: number;
  notes: string;
  confidence: "high" | "medium" | "low";
};

/** 批量导入条目类型 */
export type BulkImportItem = {
  type: "bottle" | "prep" | "recipe" | "material";
  nameZh: string;
  nameEn: string;
  category: string;
  style: string;
  brand: string;
  origin: string;
  volume: string;
  abv: number;
  priceCny: number;
  prepIngredients: string[];
  prepRecipe: string;
  prepYield: string;
  shelfLife: string;
  storage: string;
  baseSpirit: string;
  glass: string;
  method: string;
  ingredients: Array<{ name: string; amount: string }>;
  steps: string;
  garnish: string;
  source: string;
  variantOf: string;
  codexFamily: string;
  notes: string;
};
