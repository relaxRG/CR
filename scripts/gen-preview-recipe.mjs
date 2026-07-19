// 临时脚本：生成一条完整字段的示例配方 JSON，用于 web 预览注入 localStorage
const now = Date.now();
const recipe = {
  id: "preview-negroni-1",
  name: "尼格罗尼",
  nameEn: "Negroni",
  categoryId: "cat-classic",
  baseSpirit: "金酒",
  glass: "古典杯",
  method: "搅拌",
  ice: "大方冰",
  strength: "strong",
  strengthBand: "",
  abv: null,
  variantOf: "",
  codexFamily: "高球 Highball",
  flavors: ["苦韵", "草本", "柑橘"],
  drinkDuration: "慢饮",
  occasion: "餐前",
  source: "IBA 官方配方",
  story: "",
  flavorDesc: "",
  ingredients: [
    { id: "i1", name: "金酒", amount: "30ml" },
    { id: "i2", name: "金巴利", amount: "30ml" },
    { id: "i3", name: "甜味美思", amount: "30ml" },
  ],
  steps: "1. 古典杯中加满冰块\n2. 依次倒入三种酒液\n3. 吧勺搅拌约20秒至充分冷却\n4. 以橙皮装饰",
  garnish: "橙皮",
  notes: "苦甜平衡的经典餐前酒，1:1:1 比例最稳妥。",
  favorite: true,
  made: true,
  rating: 9,
  sortIndex: null,
  cardTagOrder: null,
  photoUris: [],
  createdAt: now,
  updatedAt: now,
};
const categories = [
  { id: "cat-classic", name: "经典", nameEn: "Classic", color: "#C0841D" },
];
console.log(JSON.stringify({ recipes: [recipe], categories }));
