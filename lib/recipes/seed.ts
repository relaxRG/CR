import { Category, Recipe, genId, splitBilingualName } from "./types";

export function buildDefaultCategories(): Category[] {
  const now = Date.now();
  return [
    { id: "cat-classic", name: "经典", nameEn: "Classic", color: "#C0841A", createdAt: now },
    { id: "cat-original", name: "自创", nameEn: "Original", color: "#7B5EA7", createdAt: now + 1 },
    { id: "cat-fresh", name: "清爽", nameEn: "Refreshing", color: "#3E7A5E", createdAt: now + 2 },
    { id: "cat-strong", name: "浓烈", nameEn: "Strong", color: "#B0413E", createdAt: now + 3 },
  ];
}

export function buildSampleRecipes(): Recipe[] {
  const now = Date.now();
  const mk = (
    partial: Omit<
      Recipe,
      "id" | "createdAt" | "updatedAt" | "favorite" | "notes" | "variantOf" | "codexFamily" | "flavors" | "drinkDuration" | "occasion" | "source" | "story" | "flavorDesc" | "strengthBand" | "abv" | "nameEn" | "made" | "rating" | "sortIndex" | "cardTagOrder"
    > & {
      notes?: string;
      favorite?: boolean;
      made?: boolean;
      rating?: number | null;
      sortIndex?: number | null;
      variantOf?: string;
      codexFamily?: string;
      flavors?: string[];
      drinkDuration?: string;
      occasion?: string;
      source?: string;
      story?: string;
      flavorDesc?: string;
      strengthBand?: Recipe["strengthBand"];
      abv?: Recipe["abv"];
      nameEn?: string;
    },
    offset: number,
  ): Recipe => {
    // 种子数据的混写名("尼格罗尼 Negroni")自动拆分为独立中英字段
    const split = partial.nameEn ? null : splitBilingualName(partial.name);
    return {
      id: genId() + "-" + offset,
      favorite: partial.favorite ?? false,
      made: partial.made ?? false,
      notes: partial.notes ?? "",
      variantOf: partial.variantOf ?? "",
      codexFamily: partial.codexFamily ?? "",
      flavors: partial.flavors ?? [],
      drinkDuration: partial.drinkDuration ?? "",
      occasion: partial.occasion ?? "",
      source: partial.source ?? "",
      story: partial.story ?? "",
      flavorDesc: partial.flavorDesc ?? "",
      strengthBand: partial.strengthBand ?? "",
      abv: partial.abv ?? null,
      nameEn: partial.nameEn ?? split?.en ?? "",
      rating: partial.rating ?? null,
      sortIndex: partial.sortIndex ?? null,
      cardTagOrder: null,
      createdAt: now + offset,
      updatedAt: now + offset,
      ...partial,
      ...(partial.rating === undefined ? { rating: null } : {}),
      ...(partial.sortIndex === undefined ? { sortIndex: null } : {}),
      ...(split ? { name: split.zh } : {}),
    };
  };

  return [
    mk(
      {
        name: "尼格罗尼 Negroni",
        categoryId: "cat-classic",
        baseSpirit: "金酒",
        glass: "古典杯",
        method: "搅拌",
        ice: "",
        strength: "strong",
        codexFamily: "马天尼 Martini",
        flavors: ["苦韵", "草本"],
        source: "IBA 官方配方",
        ingredients: [
          { id: "i1", name: "金酒", amount: "30ml" },
          { id: "i2", name: "金巴利", amount: "30ml" },
          { id: "i3", name: "甜味美思", amount: "30ml" },
        ],
        steps: "1. 古典杯中加满冰块\n2. 依次倒入三种酒液\n3. 吧勺搅拌约20秒至充分冷却\n4. 以橙皮装饰",
        garnish: "橙皮",
        notes: "苦甜平衡的经典餐前酒,1:1:1 比例最稳妥。",
        favorite: true,
      },
      0,
    ),
    mk(
      {
        name: "莫吉托 Mojito",
        categoryId: "cat-fresh",
        baseSpirit: "朗姆",
        glass: "高球杯",
        method: "直调",
        ice: "",
        strength: "light",
        codexFamily: "高球 Highball",
        flavors: ["草本", "酸爽", "柑橘"],
        ingredients: [
          { id: "i1", name: "白朗姆", amount: "45ml" },
          { id: "i2", name: "青柠汁", amount: "20ml" },
          { id: "i3", name: "糖浆", amount: "15ml" },
          { id: "i4", name: "薄荷叶", amount: "8-10片" },
          { id: "i5", name: "苏打水", amount: "适量" },
        ],
        steps: "1. 杯中放入薄荷叶与糖浆,轻压出香\n2. 加入青柠汁与朗姆酒\n3. 加碎冰搅拌\n4. 补满苏打水,薄荷枝装饰",
        garnish: "薄荷枝、青柠角",
        notes: "薄荷轻压即可,避免压碎出苦味。",
      },
      1,
    ),
    mk(
      {
        name: "玛格丽特 Margarita",
        categoryId: "cat-classic",
        baseSpirit: "龙舌兰",
        glass: "库佩杯",
        method: "摇和",
        ice: "",
        strength: "medium",
        variantOf: "边车 Sidecar",
        codexFamily: "边车 Sidecar",
        flavors: ["柑橘", "酸爽", "咸鲜"],
        ingredients: [
          { id: "i1", name: "龙舌兰", amount: "50ml" },
          { id: "i2", name: "橙皮利口酒", amount: "20ml" },
          { id: "i3", name: "青柠汁", amount: "15ml" },
        ],
        steps: "1. 杯口抹青柠后蘸盐边\n2. 摇酒壶加冰,倒入所有材料\n3. 大力摇和10-15秒\n4. 双重过滤入杯",
        garnish: "盐边、青柠圈",
        notes: "",
      },
      2,
    ),
    mk(
      {
        name: "威士忌酸 Whiskey Sour",
        categoryId: "cat-classic",
        baseSpirit: "威士忌",
        glass: "古典杯",
        method: "摇和",
        ice: "",
        strength: "medium",
        codexFamily: "大吉利 Daiquiri",
        flavors: ["酸爽", "果味"],
        ingredients: [
          { id: "i1", name: "波本威士忌", amount: "45ml" },
          { id: "i2", name: "柠檬汁", amount: "25ml" },
          { id: "i3", name: "糖浆", amount: "15ml" },
          { id: "i4", name: "蛋白(可选)", amount: "1个" },
        ],
        steps: "1. 如加蛋白先干摇10秒\n2. 加冰再摇15秒\n3. 滤入加冰的古典杯\n4. 滴上安高天娜苦精装饰",
        garnish: "柠檬皮、苦精",
        notes: "加蛋白口感更绵密,干摇是关键。",
      },
      3,
    ),
  ];
}
