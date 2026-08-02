/** 葡萄酒风格 */
export type WineStyle = "red" | "white" | "rose" | "sparkling" | "sweet" | "fortified" | "other";

/** 葡萄酒条目 */
export interface WineBottle {
  id: string;
  /** 中文名称 */
  name: string;
  /** 英文/原文名称 */
  nameEn: string;
  /** 年份 */
  vintage: string;
  /** 产区（如：波尔多、勃艮第、纳帕谷） */
  region: string;
  /** 品种（如：赤霞珠、霞多丽） */
  grape: string;
  /** 酒庄/品牌 */
  winery: string;
  /** 风格 */
  style: WineStyle;
  /** 酒精度（%） */
  abv: number | null;
  /** 进价（元） */
  costPrice: number | null;
  /** 售价（元） */
  salePrice: number | null;
  /** 当前库存（瓶） */
  stock: number;
  /** 评分（0-100，WS/RP风格） */
  rating: number | null;
  /** 品鉴笔记 */
  notes: string;
  /** 照片 URI */
  photoUri: string;
  /** 供应商 */
  supplier: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

export const WINE_STYLE_LABELS: Record<WineStyle, string> = {
  red: "红葡萄酒",
  white: "白葡萄酒",
  rose: "桃红葡萄酒",
  sparkling: "起泡酒",
  sweet: "甜酒",
  fortified: "加强酒",
  other: "其他",
};
