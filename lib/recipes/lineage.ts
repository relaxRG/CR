/**
 * 经典鸡尾酒变体智能识别引擎(Classic Lineage Engine)。
 *
 * 理论与文献依据(详见 research/variant-lineage-research.md):
 * - 《Cocktail Codex》(Day/Fauchald/Kaplan/Tarby, 2018):六大母配方(Old Fashioned/
 *   Martini/Daiquiri/Sidecar/Highball/Flip)与 Core/Balance/Seasoning 角色框架
 * - Gary Regan《The Joy of Mixology》(2003):French-Italian 族、New Orleans Sour 族、
 *   Milanese 族(金巴利系)、Duos & Trios 等家族分类法
 * - David Embury《The Fine Art of Mixing Drinks》(1948):Base/Modifier/Accent 三分法、
 *   Aromatic vs Sour 两大类、"Roll Your Own" 换件变体方法论
 * - David Wondrich《Imbibe!》(2007) 与 Robert Simonson《The Old-Fashioned》(2014):
 *   1806 Cock-tail 定义 → Improved Cocktail → 1880 Old-Fashioned 历史因果
 * - Difford's Guide:Martini ← Martinez ← Manhattan 谱系考证、36 家族(Collins/Fizz/
 *   Buck/Daisy/Crusta/Julep/Flip/Colada 等)服务形式判定
 * - Death & Co《Welcome Home》:"Mr. Potato Head" 同角色换件法与二级变体(riffs on riffs)
 *
 * 判定流程:
 * 1. 角色归约(复用 structure.ts 的 19 种结构角色)
 * 2. 母家族判定(Codex 决策树:碳酸→Highball;全蛋→Flip;柑橘+糖→Daiquiri;
 *    柑橘+利口酒→Sidecar;无柑橘+加强酒/苦酒→Martini;无柑橘+糖+苦精→Old Fashioned)
 * 3. 经典锚点加权匹配(基酒 30 + 修饰结构 30 + 方法 15 + 排他特征 15 + 服务形式 10)
 * 4. 变体手法推导(换基酒/换酸/换甜/加修饰/改服务形式)
 * 5. 置信度分档:>=80 判定;60-79 判定+备选;<60 仅归母家族
 */
import type { Ingredient, Recipe } from "./types";
import { analyzeStructure, type StructureRole } from "./structure";

/* ---------------------------------- 类型 ---------------------------------- */

export type FamilyKey =
  | "old_fashioned"
  | "martini"
  | "daiquiri"
  | "sidecar"
  | "highball"
  | "flip"
  | "duo_trio"
  | "snapper"
  | "tropical"
  | "julep"
  | "unknown";

export const FAMILY_LABELS: Record<FamilyKey, { zh: string; en: string }> = {
  old_fashioned: { zh: "古典 Old-Fashioned 族", en: "Old-Fashioned Family" },
  martini: { zh: "马天尼 Martini 族", en: "Martini Family" },
  daiquiri: { zh: "大吉利 Daiquiri 族", en: "Daiquiri Family" },
  sidecar: { zh: "边车 Sidecar 族", en: "Sidecar Family" },
  highball: { zh: "高球 Highball 族", en: "Highball Family" },
  flip: { zh: "菲利普 Flip 族", en: "Flip Family" },
  duo_trio: { zh: "双料/三料 Duo & Trio 族", en: "Duo & Trio Family" },
  snapper: { zh: "咸鲜 Snapper 族", en: "Snapper Family" },
  tropical: { zh: "热带 Tropical 族", en: "Tropical Family" },
  julep: { zh: "朱莉普 Julep 族", en: "Julep Family" },
  unknown: { zh: "待考家族", en: "Unclassified" },
};

/** 基酒类别(匹配用粗粒度) */
type SpiritClass =
  | "whiskey" | "gin" | "vodka" | "rum" | "agave" | "brandy"
  | "liqueur" | "wine" | "fortified" | "bitter" | "other" | "none";

export interface ClassicAnchor {
  /** 经典名(中/英) */
  zh: string;
  en: string;
  family: FamilyKey;
  /** 期望基酒类别(任一命中即得分) */
  spirits: SpiritClass[];
  /**
   * 必需的排他特征:每个元素是一个「特征组」(同义词数组,组内任一命中即整组命中)。
   * 例如 [K.campari, K.sweetVermouth] 表示需要同时含金巴利系与甜味美思系。
   */
  signature: string[][];
  /** 期望出现的结构角色 */
  roles: StructureRole[];
  /** 不应出现的角色(出现则扣分) */
  excludeRoles?: StructureRole[];
  /** 期望制作方法关键词(摇和/搅拌/直调/搅打) */
  methods?: string[];
  /** 谱系说明:先祖链 + 历史因果(生成论证文本用) */
  lineage: { zh: string };
  /** 文献出处 */
  refs: string[];
  /** 范式/模板类锚点(如 Highball、Buck/Mule):非具体经典,展示时用「××家族」口径 */
  paradigm?: boolean;
}

export interface LineageVerdict {
  /** 最近经典(高/中置信度时给出) */
  classic: ClassicAnchor | null;
  /** 匹配得分 0-100 */
  score: number;
  /** 备选(中置信度时展示) */
  runnersUp: { anchor: ClassicAnchor; score: number }[];
  /** 母家族 */
  family: FamilyKey;
  /** 变体手法描述(与经典的差异) */
  deviations: string[];
  /** 完整「变体说明」论证文本(纯文本) */
  narrative: string;
  /** 置信度 */
  confidence: "high" | "medium" | "low";
}

/* ------------------------------- 关键词工具 ------------------------------- */

const W = (s: string) => s.toLowerCase();
const textHas = (text: string, words: string[]) => {
  const t = W(text);
  return words.some((w) => t.includes(W(w)));
};

const SPIRIT_WORDS: Record<Exclude<SpiritClass, "none">, string[]> = {
  whiskey: ["威士忌", "波本", "黑麦", "苏格兰", "whisky", "whiskey", "bourbon", "rye", "scotch"],
  gin: ["金酒", "琴酒", "杜松子", "gin", "genever"],
  vodka: ["伏特加", "vodka"],
  rum: ["朗姆", "rum", "cachaca", "cachaça"],
  agave: ["特其拉", "龙舌兰", "梅斯卡尔", "tequila", "mezcal"],
  brandy: ["白兰地", "干邑", "雅文邑", "卡尔瓦多斯", "苹果杰克", "皮斯科", "brandy", "cognac", "armagnac", "calvados", "applejack", "pisco"],
  liqueur: ["利口酒", "liqueur"],
  wine: ["香槟", "起泡", "普罗塞克", "葡萄酒", "champagne", "prosecco", "sparkling", "wine", "cava"],
  fortified: ["味美思", "雪莉", "波特", "利莱", "金鸡纳", "vermouth", "sherry", "port", "lillet"],
  bitter: ["金巴利", "阿佩罗", "阿玛罗", "campari", "aperol", "amaro"],
  other: [],
};

/** 判定配方主基酒类别(取用量最大的烈酒类配料) */
function detectSpiritClass(ingredients: Ingredient[], baseSpirit: string): SpiritClass {
  const joined = ingredients.map((i) => i.name).join(" ") + " " + baseSpirit;
  const order: Exclude<SpiritClass, "none" | "other">[] = [
    "whiskey", "agave", "brandy", "gin", "vodka", "rum", "bitter", "fortified", "wine", "liqueur",
  ];
  for (const k of order) {
    if (textHas(joined, SPIRIT_WORDS[k])) return k;
  }
  return "other";
}

/* ------------------------------ 经典锚点指纹库 ------------------------------ */
/** 排他特征词组(便于复用) */
const K = {
  campari: ["金巴利", "campari"],
  sweetVermouth: ["甜味美思", "红味美思", "sweet vermouth", "rosso", "红威末"],
  dryVermouth: ["干味美思", "dry vermouth", "干威末"],
  lime: ["青柠", "莱姆", "lime"],
  lemon: ["柠檬", "lemon"],
  orangeLiqueur: ["君度", "橙皮酒", "库拉索", "橙味利口", "triple sec", "cointreau", "curacao", "curaçao", "grand marnier"],
  maraschino: ["马拉斯奇诺", "黑樱桃利口", "maraschino"],
  mint: ["薄荷", "mint"],
  soda: ["苏打", "soda"],
  tonic: ["汤力", "tonic"],
  gingerBeer: ["姜汁啤酒", "姜汁汽水", "ginger beer", "ginger ale"],
  cola: ["可乐", "cola"],
  coffee: ["咖啡", "coffee", "espresso", "kahlua"],
  cream: ["奶油", "cream"],
  cacao: ["可可", "cacao", "chocolate"],
  tomato: ["番茄", "tomato"],
  pineapple: ["菠萝", "pineapple"],
  coconut: ["椰", "coconut"],
  orgeat: ["杏仁糖浆", "orgeat"],
  absinthe: ["苦艾酒", "absinthe"],
  peychaud: ["peychaud", "培乔", "佩肖"],
  eggWhite: ["蛋白", "egg white"],
  wholeEgg: ["全蛋", "whole egg", "蛋黄", "egg yolk"],
  champagne: ["香槟", "起泡", "champagne", "prosecco", "sparkling", "cava"],
  cranberry: ["蔓越莓", "cranberry"],
  chartreuse: ["查特", "chartreuse"],
  benedictine: ["廊酒", "benedictine", "bénédictine"],
  elderflower: ["接骨木", "圣杰曼", "elderflower", "st-germain", "st germain"],
  sugar: ["糖", "sugar", "syrup", "蜂蜜", "honey", "龙舌兰蜜", "agave"],
  bitters: ["苦精", "bitters"],
  grapefruit: ["西柚", "葡萄柚", "grapefruit"],
  sloe: ["黑刺李", "sloe"],
  amaretto: ["杏仁利口", "amaretto"],
  applejack: ["苹果白兰地", "苹果杰克", "applejack", "calvados"],
  grenadine: ["红石榴", "grenadine"],
  falernum: ["法勒南", "falernum"],
  aperol: ["阿佩罗", "aperol"],
  fernet: ["菲奈特", "fernet"],
  drambuie: ["杜林标", "drambuie"],
  galliano: ["加利安奴", "galliano"],
  midori: ["蜜多丽", "midori"],
  violette: ["紫罗兰", "violette"],
  cherryLiqueur: ["樱桃白兰地", "樱桃利口", "cherry brandy", "cherry heering", "heering"],
};

/** 60+ 经典锚点指纹库(依据 IBA 官方配方 + Codex + Waldorf + Difford's) */
export const CLASSIC_ANCHORS: ClassicAnchor[] = [
  // ---------- Old Fashioned 族 ----------
  {
    zh: "古典鸡尾酒", en: "Old Fashioned", family: "old_fashioned",
    spirits: ["whiskey"], signature: [K.bitters], roles: ["sweet_syrup", "bitters"],
    excludeRoles: ["acid_citrus", "fortified", "lengthener_carbonated", "texture_egg"],
    methods: ["搅拌", "直调"],
    lineage: { zh: "1806 年 Harry Croswell 首次定义 Cock-tail 为「烈酒+糖+水+苦精」;19 世纪中叶 Improved Cocktail 加入利口酒引发保守派反弹,1880 年「Old-Fashioned Whiskey Cocktail」之名首见印刷,意为回归老式做法" },
    refs: ["Wondrich《Imbibe!》", "Simonson《The Old-Fashioned》", "Cocktail Codex"],
  },
  {
    zh: "萨泽拉克", en: "Sazerac", family: "old_fashioned",
    spirits: ["whiskey", "brandy"], signature: [K.absinthe, K.peychaud], roles: ["sweet_syrup"],
    excludeRoles: ["acid_citrus", "lengthener_carbonated"],
    methods: ["搅拌"],
    lineage: { zh: "19 世纪中叶新奥尔良 Sazerac Coffee House 以干邑与本地 Peychaud's 苦精调制的 Old Fashioned 式变体,phylloxera 疫病后干邑改为黑麦威士忌,苦艾酒涮杯成为其标志" },
    refs: ["Wondrich《Imbibe!》", "Difford's Guide"],
  },
  {
    zh: "香槟鸡尾酒", en: "Champagne Cocktail", family: "old_fashioned",
    spirits: ["wine", "brandy"], signature: [K.champagne, K.bitters], roles: ["bitters"],
    lineage: { zh: "Jerry Thomas 1862《How to Mix Drinks》即收录:方糖浸苦精再注香槟,是 1806 Cock-tail 公式以香槟为基的直接移植" },
    refs: ["Jerry Thomas 1862", "IBA 官方配方"],
  },
  {
    zh: "改良式鸡尾酒", en: "Improved Cocktail", family: "old_fashioned",
    spirits: ["whiskey", "brandy", "gin"], signature: [K.maraschino], roles: ["sweet_liqueur", "bitters"],
    excludeRoles: ["acid_citrus", "fortified"],
    methods: ["搅拌"],
    lineage: { zh: "1870s「Improved Cocktail」在 1806 公式上添加马拉斯奇诺/苦艾酒等,正是它促使保守顾客发明了「Old-Fashioned」一词" },
    refs: ["Wondrich《Imbibe!》", "Jerry Thomas 1876"],
  },
  // ---------- Martini 族 ----------
  {
    zh: "干马天尼", en: "Dry Martini", family: "martini",
    spirits: ["gin", "vodka"], signature: [K.dryVermouth], roles: ["fortified"],
    excludeRoles: ["acid_citrus", "sweet_syrup", "lengthener_carbonated"],
    methods: ["搅拌"],
    lineage: { zh: "Difford's 谱系考证:Martini ← Martinez(1884 首载,标注为 Manhattan 变体)← Manhattan;1888 Harry Johnson 首载 Martini(甜型),1904-1906 随 London Dry 金酒与 Martini & Rossi 干味美思营销转干,库拉索与糖浆逐步退出" },
    refs: ["Difford's Guide Martini History", "O.H. Byron 1884", "Harry Johnson 1888"],
  },
  {
    zh: "曼哈顿", en: "Manhattan", family: "martini",
    spirits: ["whiskey"], signature: [K.sweetVermouth], roles: ["fortified", "bitters"],
    excludeRoles: ["acid_citrus", "lengthener_carbonated"],
    methods: ["搅拌"],
    lineage: { zh: "1870s 纽约诞生的「威士忌+甜味美思+苦精」范式,Regan 归入 French-Italian 族;是 Martinez 与 Martini 的直系先祖,换苏格兰威士忌即 Rob Roy,换朗姆即 Palmetto" },
    refs: ["Regan《The Joy of Mixology》", "Difford's Guide"],
  },
  {
    zh: "马丁内斯", en: "Martinez", family: "martini",
    spirits: ["gin"], signature: [K.sweetVermouth, K.maraschino], roles: ["fortified", "sweet_liqueur"],
    methods: ["搅拌"],
    lineage: { zh: "1884 年 O.H. Byron《The Modern Bartender》首载并明确标注为 Manhattan 的金酒变体,是 Manhattan 通往 Dry Martini 的中间环节" },
    refs: ["O.H. Byron 1884", "Difford's Guide"],
  },
  {
    zh: "尼格罗尼", en: "Negroni", family: "martini",
    spirits: ["gin"], signature: [K.campari, K.sweetVermouth], roles: ["bitter_modifier", "fortified"],
    excludeRoles: ["acid_citrus"],
    lineage: { zh: "谱系链:Milano-Torino(1860s 米兰,金巴利+甜味美思)→ Americano(加苏打长饮)→ 1919-20 佛罗伦萨 Camillo Negroni 伯爵要求以金酒替代苏打水(Picchi 2002 考证);Regan 称金巴利系为 Milanese 族" },
    refs: ["Picchi《Sulle Tracce del Conte》2002", "Regan《The Joy of Mixology》", "Wikipedia/Wondrich 考证"],
  },
  {
    zh: "花花公子", en: "Boulevardier", family: "martini",
    spirits: ["whiskey"], signature: [K.campari, K.sweetVermouth], roles: ["bitter_modifier", "fortified"],
    lineage: { zh: "1927 年巴黎(Harry McElhone 记载):Negroni 骨架换波本/黑麦,即 Mr. Potato Head 式换基酒变体;同期 Old Pal 用黑麦+干味美思" },
    refs: ["Harry McElhone《Barflies and Cocktails》1927", "Death & Co 方法论"],
  },
  {
    zh: "美国佬", en: "Americano", family: "highball",
    spirits: ["bitter", "fortified"], signature: [K.campari, K.sweetVermouth, K.soda], roles: ["lengthener_carbonated"],
    lineage: { zh: "Milano-Torino 加苏打水的长饮形态,因美国游客喜爱得名;是 Negroni 的直接母体" },
    refs: ["Wikipedia Negroni 词条文献学考证", "Difford's Guide"],
  },
  {
    zh: "维苏卡雷", en: "Vieux Carré", family: "martini",
    spirits: ["whiskey", "brandy"], signature: [K.benedictine, K.sweetVermouth], roles: ["fortified", "sweet_liqueur", "bitters"],
    lineage: { zh: "1930s 新奥尔良 Hotel Monteleone:Manhattan 拆分基酒(黑麦+干邑)加廊酒与 Peychaud's,属 Death & Co 所称「二级变体」(riffs on riffs)" },
    refs: ["Stanley Clisby Arthur 1937", "Death & Co《Welcome Home》"],
  },
  {
    zh: "罗布罗伊", en: "Rob Roy", family: "martini",
    spirits: ["whiskey"], signature: [["苏格兰", "scotch"]], roles: ["fortified", "bitters"],
    methods: ["搅拌"],
    lineage: { zh: "1894 年纽约 Waldorf 酒店:Manhattan 换苏格兰威士忌的换基酒变体,Regan French-Italian 族标准案例" },
    refs: ["The Waldorf Astoria Bar Book", "Regan《The Joy of Mixology》"],
  },
  {
    zh: "内格罗尼·斯巴利亚托", en: "Negroni Sbagliato", family: "martini",
    spirits: ["bitter", "wine"], signature: [K.campari, K.sweetVermouth, K.champagne], roles: ["bitter_modifier"],
    lineage: { zh: "1972 米兰 Bar Basso,调错的 Negroni:气泡酒误替金酒(sbagliato 意为「错误的」)" },
    refs: ["Difford's Guide", "Wikipedia Negroni Variations"],
  },
  // ---------- Daiquiri 族 ----------
  {
    zh: "大吉利", en: "Daiquiri", family: "daiquiri",
    spirits: ["rum"], signature: [K.lime], roles: ["acid_citrus", "sweet_syrup"],
    excludeRoles: ["lengthener_carbonated", "sweet_liqueur", "texture_egg"],
    methods: ["摇和"],
    lineage: { zh: "1898 古巴 Daiquirí 矿区(Jennings Cox 记载):朗姆+青柠+糖的裸酸公式,Codex 六大母配方之一;Embury 称 Daiquiri 即「威士忌酸换朗姆+青柠」" },
    refs: ["Embury 1948", "Cocktail Codex", "IBA 官方配方"],
  },
  {
    zh: "威士忌酸", en: "Whiskey Sour", family: "daiquiri",
    spirits: ["whiskey"], signature: [K.lemon], roles: ["acid_citrus", "sweet_syrup"],
    excludeRoles: ["lengthener_carbonated", "fortified"],
    methods: ["摇和"],
    lineage: { zh: "1862 Jerry Thomas 收录的 Sour 范式(烈酒+柠檬+糖),是 Daiquiri/Margarita 等一切酸酒的模板;加蛋白即 Boston Sour,加红酒漂浮即 New York Sour" },
    refs: ["Jerry Thomas 1862", "Regan Sours 族"],
  },
  {
    zh: "莫吉托", en: "Mojito", family: "daiquiri",
    spirits: ["rum"], signature: [K.mint, K.lime], roles: ["acid_citrus", "sweet_syrup"],
    lineage: { zh: "古巴:Daiquiri 公式加薄荷与苏打的长饮化变体,可上溯 16 世纪 El Draque(aguardiente+薄荷+青柠+糖)" },
    refs: ["Difford's Guide", "Cocktail Codex Daiquiri 章"],
  },
  {
    zh: "吉姆雷特", en: "Gimlet", family: "daiquiri",
    spirits: ["gin"], signature: [K.lime], roles: ["acid_citrus"],
    excludeRoles: ["lengthener_carbonated", "texture_egg"],
    methods: ["摇和", "搅拌"],
    lineage: { zh: "19 世纪英国海军以 Rose's 青柠汁防坏血病配金酒而生;结构上是 Daiquiri 的金酒换基变体" },
    refs: ["Difford's Guide", "Cocktail Codex"],
  },
  {
    zh: "海明威大吉利", en: "Hemingway Daiquiri", family: "daiquiri",
    spirits: ["rum"], signature: [K.grapefruit, K.maraschino], roles: ["acid_citrus"],
    lineage: { zh: "1930s 哈瓦那 El Floridita 为海明威特调:Daiquiri 减糖、加西柚汁与马拉斯奇诺(Papa Doble)" },
    refs: ["Difford's Guide", "Death & Co"],
  },
  {
    zh: "临别一语", en: "Last Word", family: "sidecar",
    spirits: ["gin"], signature: [K.chartreuse, K.maraschino, K.lime], roles: ["acid_citrus", "sweet_liqueur"],
    methods: ["摇和"],
    lineage: { zh: "1916 底特律运动员俱乐部,禁酒令前经典;等比四分结构成为现代变体模板(Naked & Famous、Paper Plane 均由其等比骨架衍生)" },
    refs: ["Ted Saucier《Bottoms Up》1951", "Death & Co"],
  },
  {
    zh: "南方", en: "Southside", family: "daiquiri",
    spirits: ["gin"], signature: [K.mint, K.lime], roles: ["acid_citrus", "sweet_syrup"],
    lineage: { zh: "金酒版加薄荷的 Sour:Daiquiri 骨架换金酒+薄荷调味,禁酒令时期纽约 21 Club 招牌" },
    refs: ["Difford's Guide"],
  },
  {
    zh: "盘尼西林", en: "Penicillin", family: "daiquiri",
    spirits: ["whiskey"], signature: [["蜂蜜", "姜", "honey", "ginger", "艾雷", "islay", "peat"]], roles: ["acid_citrus"],
    lineage: { zh: "2005 纽约 Milk & Honey(Sam Ross):Whisky Sour 换蜂蜜姜糖浆+艾雷泥煤威士忌漂浮,现代经典中 Sour 变体的标杆" },
    refs: ["Death & Co", "Regan Sours 族"],
  },
  {
    zh: "皮斯科酸", en: "Pisco Sour", family: "daiquiri",
    spirits: ["brandy"], signature: [K.eggWhite, ["皮斯科", "pisco"]], roles: ["acid_citrus", "texture_egg"],
    methods: ["摇和"],
    lineage: { zh: "1920s 利马 Morris' Bar:Sour 公式换皮斯科加蛋白与苦精点缀,秘鲁国饮" },
    refs: ["Difford's Guide", "IBA 官方配方"],
  },
  {
    zh: "三叶草俱乐部", en: "Clover Club", family: "daiquiri",
    spirits: ["gin"], signature: [K.eggWhite, K.grenadine], roles: ["acid_citrus", "texture_egg"],
    lineage: { zh: "禁酒令前费城 Clover Club 文人社团:金酒 Sour 加覆盆子/红石榴与蛋白的丝滑变体" },
    refs: ["The Waldorf Astoria Bar Book", "Difford's Guide"],
  },
  {
    zh: "黛西/玛格丽特先祖", en: "Daisy", family: "sidecar",
    spirits: ["gin", "whiskey", "brandy"], signature: [K.orangeLiqueur, K.grenadine], roles: ["acid_citrus"],
    lineage: { zh: "1876 前的 Daisy 族:烈酒+橙皮利口酒/风味糖浆+柠汁;Wondrich 认为 Sidecar 真正的前身即 Daisy,而 Margarita 在西语中就是「雏菊」" },
    refs: ["Wondrich《Imbibe!》", "PUNCH Crusta 考"],
  },
  // ---------- Sidecar 族 ----------
  {
    zh: "边车", en: "Sidecar", family: "sidecar",
    spirits: ["brandy"], signature: [K.orangeLiqueur, K.lemon], roles: ["acid_citrus", "sweet_liqueur"],
    excludeRoles: ["lengthener_carbonated"],
    methods: ["摇和"],
    lineage: { zh: "1920s 巴黎/伦敦(Harry's Bar 与 Buck's Club 均有主张):干邑+橙皮利口酒+柠檬;其骨架承自 1850s 新奥尔良 Brandy Crusta(Joseph Santini),糖圈装饰亦沿袭 Crusta" },
    refs: ["PUNCH「What the Hell Is a Crusta?」", "Regan New Orleans Sour 族", "IBA"],
  },
  {
    zh: "玛格丽特", en: "Margarita", family: "sidecar",
    spirits: ["agave"], signature: [K.orangeLiqueur, K.lime], roles: ["acid_citrus", "sweet_liqueur"],
    methods: ["摇和"],
    lineage: { zh: "Regan 明确将 Margarita 归入 New Orleans Sour(Sidecar)族:特其拉换干邑、青柠换柠檬、盐圈换糖圈;名称即西语「雏菊 Daisy」,呼应其 Daisy 谱系" },
    refs: ["Regan《The Joy of Mixology》", "PUNCH", "IBA"],
  },
  {
    zh: "大都会", en: "Cosmopolitan", family: "sidecar",
    spirits: ["vodka"], signature: [K.cranberry, K.orangeLiqueur], roles: ["acid_citrus", "sweet_liqueur"],
    lineage: { zh: "1988 Toby Cecchini(纽约 Odeon)定型:柑橘伏特加+君度+青柠+蔓越莓,是 Kamikaze/Daisy 骨架的粉色变体,仍属 Sidecar 族" },
    refs: ["Regan New Orleans Sour 族", "Difford's Guide"],
  },
  {
    zh: "白色丽人", en: "White Lady", family: "sidecar",
    spirits: ["gin"], signature: [K.orangeLiqueur, K.lemon], roles: ["acid_citrus", "sweet_liqueur"],
    methods: ["摇和"],
    lineage: { zh: "1920s Harry MacElhone:Sidecar 换金酒的直接变体(初版用薄荷利口酒,1929 定型为金酒+君度+柠檬)" },
    refs: ["Harry MacElhone《ABC of Mixing Cocktails》", "IBA"],
  },
  {
    zh: "白兰地克鲁斯塔", en: "Brandy Crusta", family: "sidecar",
    spirits: ["brandy"], signature: [K.orangeLiqueur, K.bitters, K.lemon], roles: ["sweet_liqueur", "bitters"],
    lineage: { zh: "1850s 新奥尔良 Joseph Santini 创制,Jerry Thomas 1862 收录:首个糖圈装饰鸡尾酒,白兰地+库拉索+微量柠檬+苦精,被普遍视为 Sidecar 先祖" },
    refs: ["Jerry Thomas 1862", "PUNCH", "Wondrich《Imbibe!》"],
  },
  {
    zh: "神风特攻队", en: "Kamikaze", family: "sidecar",
    spirits: ["vodka"], signature: [K.orangeLiqueur, K.lime], roles: ["acid_citrus", "sweet_liqueur"],
    lineage: { zh: "1970s:伏特加+橙皮利口酒+青柠等比,Sidecar 公式的伏特加换基变体,亦是 Cosmopolitan 的前身" },
    refs: ["Difford's Guide"],
  },
  // ---------- Highball 族 ----------
  {
    zh: "高球/嗨棒", en: "Highball", family: "highball",
    paradigm: true,
    spirits: ["whiskey"], signature: [K.soda], roles: ["lengthener_carbonated"],
    excludeRoles: ["acid_citrus"],
    methods: ["直调"],
    lineage: { zh: "1890s(Chris Lawlor 首载):烈酒+碳酸的极简公式,Difford 判据为「不含柑橘汁」;Codex 六大母配方之一" },
    refs: ["Difford's Guide 36 家族", "Cocktail Codex"],
  },
  {
    zh: "金汤力", en: "Gin & Tonic", family: "highball",
    spirits: ["gin"], signature: [K.tonic], roles: ["lengthener_carbonated"],
    methods: ["直调"],
    lineage: { zh: "19 世纪英属印度:金酒兑奎宁汤力水防疟疾,Highball 公式的汤力变体" },
    refs: ["Difford's Guide"],
  },
  {
    zh: "自由古巴", en: "Cuba Libre", family: "highball",
    spirits: ["rum"], signature: [K.cola, K.lime], roles: ["lengthener_carbonated"],
    methods: ["直调"],
    lineage: { zh: "1900 年前后哈瓦那:朗姆+可乐+青柠,Highball 加柑橘的变奏(严格 Highball 无柑橘,故属过渡形态)" },
    refs: ["Difford's Guide", "IBA"],
  },
  {
    zh: "莫斯科骡子", en: "Moscow Mule", family: "highball",
    spirits: ["vodka"], signature: [K.gingerBeer, K.lime], roles: ["lengthener_carbonated", "acid_citrus"],
    methods: ["直调"],
    lineage: { zh: "1941 洛杉矶(铜杯营销):伏特加+姜汁啤酒+青柠,结构上属 Difford 所列 Buck 族(烈酒+姜汁啤酒+青柠),Dark 'n' Stormy 为其黑朗姆同族" },
    refs: ["Difford's Guide Buck 族"],
  },
  {
    zh: "黑暗风暴", en: "Dark 'n' Stormy", family: "highball",
    spirits: ["rum"], signature: [K.gingerBeer, ["黑朗姆", "达克朗姆", "dark rum", "black rum", "gosling"]], roles: ["lengthener_carbonated"],
    lineage: { zh: "百慕大 Gosling's:黑朗姆漂浮于姜汁啤酒,Buck 族(姜汁啤酒系 Highball)标准成员" },
    refs: ["Difford's Guide Buck 族"],
  },
  {
    zh: "巴克/骡子范式", en: "Buck / Mule", family: "highball",
    paradigm: true,
    spirits: ["whiskey", "gin", "rum", "agave", "brandy", "vodka", "other"],
    signature: [K.gingerBeer], roles: ["lengthener_carbonated"],
    lineage: { zh: "Difford Buck 族(又称 Mule):任意烈酒+姜汁啤酒/干姜水+柑橘,1910s 起的 Highball 亚族;Moscow Mule(1941)与 Dark 'n' Stormy 皆其成员" },
    refs: ["Difford's Guide Buck 族", "Regan《The Joy of Mixology》"],
  },
  {
    zh: "汤姆柯林斯", en: "Tom Collins", family: "highball",
    spirits: ["gin"], signature: [K.lemon, K.soda], roles: ["acid_citrus", "sweet_syrup", "lengthener_carbonated"],
    lineage: { zh: "1814 伦敦起源、1876 Jerry Thomas 收录:金酒+柠檬+糖+苏打加冰长饮;Difford 判据「加冰的 Fizz 即 Collins」" },
    refs: ["Difford's Guide Collins 族", "Jerry Thomas 1876"],
  },
  {
    zh: "金菲兹", en: "Gin Fizz", family: "highball",
    spirits: ["gin"], signature: [K.lemon, K.soda], roles: ["acid_citrus", "sweet_syrup", "lengthener_carbonated"],
    methods: ["摇和"],
    lineage: { zh: "1870s 新奥尔良晨间饮品:摇和后无冰高杯注苏打;加蛋白即 Silver Fizz(Ramos Gin Fizz 1888 为其奶油化极致变体)" },
    refs: ["Difford's Guide Fizz 族"],
  },
  {
    zh: "帕洛玛", en: "Paloma", family: "highball",
    spirits: ["agave"], signature: [K.grapefruit, K.soda], roles: ["lengthener_carbonated"],
    lineage: { zh: "墨西哥国民 Highball:特其拉+西柚汽水+青柠,Highball 公式的风味汽水变体" },
    refs: ["Difford's Guide"],
  },
  {
    zh: "阿佩罗橙光", en: "Aperol Spritz", family: "highball",
    spirits: ["bitter", "wine"], signature: [K.aperol, K.champagne], roles: ["lengthener_carbonated", "bitter_modifier"],
    lineage: { zh: "威尼托 Spritz 传统(19 世纪奥地利士兵兑水稀释当地酒):Aperol+普罗塞克+苏打 3:2:1,苦味开胃 Highball" },
    refs: ["Difford's Guide", "IBA"],
  },
  {
    zh: "法兰西 75", en: "French 75", family: "highball",
    spirits: ["gin"], signature: [K.champagne, K.lemon], roles: ["acid_citrus", "sweet_syrup"],
    lineage: { zh: "1915 巴黎 Harry's New York Bar:金酒 Sour 以香槟延长,Clarke 列为 Champagne Cocktail 族;因后劲如 75mm 野战炮得名" },
    refs: ["Harry MacElhone 1919", "Serious Eats Clarke 分类"],
  },
  // ---------- Julep / Tropical / Flip / Duo 等 ----------
  {
    zh: "薄荷朱莉普", en: "Mint Julep", family: "julep",
    spirits: ["whiskey"], signature: [K.mint], roles: ["sweet_syrup"],
    excludeRoles: ["acid_citrus", "lengthener_carbonated"],
    lineage: { zh: "1634 年即见于文献的美国南方碎冰薄荷饮,1938 起为肯塔基赛马会官方饮品;Difford Julep 族:烈酒+薄荷+糖+碎冰" },
    refs: ["Difford's Guide Julep 族", "Wondrich《Imbibe!》"],
  },
  {
    zh: "迈泰", en: "Mai Tai", family: "tropical",
    spirits: ["rum"], signature: [K.orgeat, K.orangeLiqueur, K.lime], roles: ["acid_citrus"],
    lineage: { zh: "1944 奥克兰 Trader Vic:牙买加朗姆+库拉索+杏仁糖浆+青柠,结构上是 Sidecar 式(利口酒作甜)的提基化变体" },
    refs: ["Trader Vic's Bartender's Guide 1947", "Regan Tropical 族"],
  },
  {
    zh: "椰林飘香", en: "Piña Colada", family: "tropical",
    spirits: ["rum"], signature: [K.pineapple, K.coconut], roles: ["lengthener_juice", "texture_dairy"],
    methods: ["搅打"],
    lineage: { zh: "1954 圣胡安 Caribe Hilton:朗姆+菠萝+椰浆搅打,Difford Colada 族(西语「过滤」)代表" },
    refs: ["Difford's Guide Colada 族", "IBA"],
  },
  {
    zh: "僵尸", en: "Zombie", family: "tropical",
    spirits: ["rum"], signature: [K.falernum, K.grenadine], roles: ["acid_citrus"],
    lineage: { zh: "1934 好莱坞 Don the Beachcomber:多朗姆拆分基酒+法勒南+多重果汁香料,提基复合 Sour 的开山之作" },
    refs: ["Sippin' Safari (Jeff Berry)", "Regan Tropical 族"],
  },
  {
    zh: "菲利普", en: "Flip", family: "flip",
    spirits: ["brandy", "rum", "fortified"], signature: [K.wholeEgg], roles: ["texture_egg", "sweet_syrup"],
    lineage: { zh: "1600s 英格兰(原以烧红铁棒加热):烈酒/加强酒+糖+全蛋;Difford 判据「无奶为 Flip,加奶即 Egg Nog」;Codex 六大母配方之一" },
    refs: ["Difford's Guide Flip 族", "Cocktail Codex"],
  },
  {
    zh: "白兰地亚历山大", en: "Brandy Alexander", family: "flip",
    spirits: ["brandy", "gin"], signature: [K.cacao, K.cream], roles: ["texture_dairy", "sweet_liqueur"],
    lineage: { zh: "1910s(初版为金酒 Alexander):烈酒+可可利口酒+奶油等比摇和;Regan 归 Duos & Trios 族——加奶油的 Trio 即甜点化 Duo" },
    refs: ["Regan Duos & Trios 族", "Hugo Ensslin 1916"],
  },
  {
    zh: "白俄罗斯", en: "White Russian", family: "duo_trio",
    spirits: ["vodka"], signature: [K.coffee, K.cream], roles: ["sweet_liqueur", "texture_dairy"],
    lineage: { zh: "1965 前后:Black Russian(1949 布鲁塞尔,伏特加+咖啡利口酒 Duo)加奶油即成 Trio;Regan Duos & Trios 族标准案例" },
    refs: ["Regan《The Joy of Mixology》Duos & Trios"],
  },
  {
    zh: "黑俄罗斯", en: "Black Russian", family: "duo_trio",
    spirits: ["vodka"], signature: [K.coffee], roles: ["sweet_liqueur"],
    excludeRoles: ["texture_dairy", "acid_citrus"],
    lineage: { zh: "1949 布鲁塞尔 Hotel Metropole:伏特加+咖啡利口酒两件式 Duo,加奶油衍生 White Russian" },
    refs: ["Regan Duos & Trios 族"],
  },
  {
    zh: "锈钉", en: "Rusty Nail", family: "duo_trio",
    spirits: ["whiskey"], signature: [K.drambuie], roles: ["sweet_liqueur"],
    lineage: { zh: "苏格兰威士忌+杜林标蜂蜜利口酒的 Duo 范式(Regan 分类),1960s 鼠帮时代流行" },
    refs: ["Regan Duos & Trios 族"],
  },
  {
    zh: "教父", en: "Godfather", family: "duo_trio",
    spirits: ["whiskey"], signature: [K.amaretto], roles: ["sweet_liqueur"],
    lineage: { zh: "1970s:苏格兰威士忌+杏仁利口酒 Duo,与 Rusty Nail 同构换甜味利口酒" },
    refs: ["Regan Duos & Trios 族"],
  },
  {
    zh: "血腥玛丽", en: "Bloody Mary", family: "snapper",
    spirits: ["vodka"], signature: [K.tomato], roles: ["lengthener_juice"],
    lineage: { zh: "1920s 巴黎 Harry's New York Bar(Fernand Petiot):伏特加+番茄汁+咸鲜调味,Regan 单列 Snapper(咸鲜)族;金酒版即 Red Snapper" },
    refs: ["Regan Snappers 族", "Difford's Guide"],
  },
  {
    zh: "浓缩咖啡马天尼", en: "Espresso Martini", family: "duo_trio",
    spirits: ["vodka"], signature: [K.coffee], roles: ["sweet_liqueur"],
    methods: ["摇和"],
    lineage: { zh: "1983 伦敦 Dick Bradsell:伏特加+咖啡利口酒+现萃浓缩,名为 Martini 实为咖啡 Duo 的摇和变体(V 杯命名潮流产物)" },
    refs: ["Difford's Guide", "Death & Co"],
  },
  {
    zh: "阿玛雷托酸", en: "Amaretto Sour", family: "daiquiri",
    spirits: ["liqueur"], signature: [K.amaretto, K.amaretto, K.lemon], roles: ["acid_citrus"],
    lineage: { zh: "1970s:杏仁利口酒作基的 Sour 变体(利口酒基核心),现代常按 Morgenthaler 改良加高度波本与蛋白" },
    refs: ["Regan Sours 族", "Jeffrey Morgenthaler"],
  },
  {
    zh: "杰克玫瑰", en: "Jack Rose", family: "daiquiri",
    spirits: ["brandy"], signature: [K.applejack, K.grenadine], roles: ["acid_citrus"],
    lineage: { zh: "1900s 前后:苹果白兰地+柠/青柠+红石榴,Embury 六大基础鸡尾酒之一,Sour 公式的果味甜化变体" },
    refs: ["Embury 1948 六大基础", "Difford's Guide"],
  },
  {
    zh: "飞行", en: "Aviation", family: "sidecar",
    spirits: ["gin"], signature: [K.maraschino, K.violette, K.lemon], roles: ["acid_citrus", "sweet_liqueur"],
    lineage: { zh: "1916 Hugo Ensslin:金酒+马拉斯奇诺+紫罗兰利口酒+柠檬,利口酒作甜的 Sour(Sidecar 式),紫罗兰呈天空色得名" },
    refs: ["Hugo Ensslin《Recipes for Mixed Drinks》1916"],
  },
  {
    zh: "新加坡司令", en: "Singapore Sling", family: "highball",
    spirits: ["gin"], signature: [K.cherryLiqueur, K.pineapple], roles: ["acid_citrus", "lengthener_juice"],
    lineage: { zh: "1915 前后新加坡 Raffles 酒店(Ngiam Tong Boon):金酒 Sling(Sling 即 1806 前「烈酒+糖+水」)的樱桃利口酒+菠萝热带化长饮变体" },
    refs: ["Difford's Guide", "IBA"],
  },
  {
    zh: "长岛冰茶", en: "Long Island Iced Tea", family: "highball",
    spirits: ["vodka"], signature: [K.cola, K.orangeLiqueur], roles: ["lengthener_carbonated", "acid_citrus"],
    lineage: { zh: "1972 长岛 Oak Beach Inn(Robert Butt):五烈酒拆分基酒+柠檬+可乐,Sour 公式的极限拆分+Highball 化" },
    refs: ["Difford's Guide"],
  },
  {
    zh: "特其拉日出", en: "Tequila Sunrise", family: "highball",
    spirits: ["agave"], signature: [K.grenadine, ["橙汁", "orange juice"], ["特其拉", "龙舌兰", "tequila"]], roles: ["lengthener_juice"],
    lineage: { zh: "1970s 加州 Sausalito:特其拉+橙汁+红石榴分层,果汁 Highball 的视觉分层变体" },
    refs: ["IBA", "Difford's Guide"],
  },
  {
    zh: "纸飞机", en: "Paper Plane", family: "sidecar",
    spirits: ["whiskey"], signature: [K.aperol, K.lemon, K.amaretto], roles: ["acid_citrus", "bitter_modifier"],
    lineage: { zh: "2008 Sam Ross:波本+Aperol+Amaro Nonino+柠檬等比,Last Word 等比骨架的现代苦味变体(Super Mr. Potato Head 案例)" },
    refs: ["Death & Co《Welcome Home》", "Sam Ross"],
  },
];

/* -------------------------------- 家族判定 -------------------------------- */

/** Codex 决策树:由结构角色集合判定母家族 */
export function inferFamily(
  roles: Set<StructureRole>,
  ingText: string,
  method: string,
): FamilyKey {
  const hasCitrus = roles.has("acid_citrus") || roles.has("acid_other");
  if (textHas(ingText, K.tomato)) return "snapper";
  if (roles.has("texture_egg") && textHas(ingText, K.wholeEgg)) return "flip";
  if (roles.has("lengthener_carbonated")) return "highball";
  if (textHas(ingText, K.mint) && !hasCitrus) return "julep";
  if (textHas(ingText, [...K.pineapple, ...K.coconut, ...K.falernum, ...K.orgeat]))
    return "tropical";
  if (hasCitrus) {
    // 柑橘 + 利口酒作甜 → Sidecar;柑橘 + 糖 → Daiquiri
    if (roles.has("sweet_liqueur") && !roles.has("sweet_syrup")) return "sidecar";
    return "daiquiri";
  }
  // 无柑橘短饮
  if (roles.has("fortified") || roles.has("bitter_modifier")) return "martini";
  if (roles.has("texture_dairy") || (roles.has("sweet_liqueur") && !roles.has("bitters")))
    return "duo_trio";
  // Duo:烈酒 + 利口酒直接作双基(如 君度+干邑 的 Bird、Godfather、Rusty Nail),
  // 利口酒即甜源,无其他修饰 → Duo/Trio(Codex 归 OF 族甜源变体)
  if (
    roles.has("base_liqueur") &&
    (roles.has("base_aged") || roles.has("base_white")) &&
    !roles.has("sweet_syrup")
  )
    return "duo_trio";
  if (roles.has("sweet_syrup") || roles.has("bitters")) return "old_fashioned";
  return "unknown";
}

/* -------------------------------- 锚点匹配 -------------------------------- */

function scoreAnchor(
  anchor: ClassicAnchor,
  spirit: SpiritClass,
  roles: Set<StructureRole>,
  ingText: string,
  method: string,
  family: FamilyKey,
): number {
  let score = 0;
  // 基酒 25(换基变体兜底 8:Mr. Potato Head 换基法)
  if (anchor.spirits.includes(spirit)) score += 25;
  else score += 8;
  // 修饰结构 25:期望角色命中率
  if (anchor.roles.length > 0) {
    const hitCount = anchor.roles.filter((r) => roles.has(r)).length;
    score += Math.round((hitCount / anchor.roles.length) * 25);
  } else {
    score += 13;
  }
  // 排他特征 35(主导信号):signature 词命中率(至少一半才计分;大面积未命中则重扣,
  // 避免仅靠角色骨架相似抢分——如「金酒+味美思+金巴利」被 Dry Martini 误判)
  if (anchor.signature.length > 0) {
    const groups = anchor.signature;
    const hits = groups.filter((wds) => textHas(ingText, wds)).length;
    const ratio = hits / groups.length;
    if (ratio >= 0.5) score += Math.round(ratio * 35);
    else score -= Math.round((1 - ratio) * 20);
  } else {
    score += 18;
  }
  // 方法 10
  if (anchor.methods && anchor.methods.length > 0) {
    if (anchor.methods.some((m) => method.includes(m))) score += 10;
    else if (!method.trim()) score += 5;
  } else {
    score += 7;
  }
  // 家族一致 5
  if (anchor.family === family) score += 5;
  // 反特征扣分
  if (anchor.excludeRoles) {
    for (const r of anchor.excludeRoles) {
      if (roles.has(r)) score -= 12;
    }
  }
  return Math.max(0, Math.min(100, score));
}

/* ------------------------------ 变体手法推导 ------------------------------ */

const SPIRIT_LABELS: Record<SpiritClass, string> = {
  whiskey: "威士忌", gin: "金酒", vodka: "伏特加", rum: "朗姆",
  agave: "龙舌兰系烈酒", brandy: "白兰地/干邑", liqueur: "利口酒",
  wine: "葡萄酒/气泡酒", fortified: "加强酒", bitter: "苦味利口酒",
  other: "其他基酒", none: "无基酒",
};

function deriveDeviations(
  anchor: ClassicAnchor,
  spirit: SpiritClass,
  roles: Set<StructureRole>,
  ingText: string,
): string[] {
  const out: string[] = [];
  if (!anchor.spirits.includes(spirit) && spirit !== "other") {
    out.push(`换基酒:以${SPIRIT_LABELS[spirit]}替代经典的${anchor.spirits.map((s) => SPIRIT_LABELS[s]).join("/")}(Embury「Roll Your Own」换基法)`);
  }
  const missingRoles = anchor.roles.filter((r) => !roles.has(r));
  if (missingRoles.length > 0) {
    out.push("结构精简:省略了经典中的部分修饰角色,骨架更为直接");
  }
  const extraNotable: [StructureRole, string][] = [
    ["texture_egg", "增加蛋白质构:向 Silver Fizz/Boston Sour 方向的丝滑化改良"],
    ["texture_dairy", "增加乳脂质构:向 Trio(Regan 分类)方向的甜点化改良"],
    ["lengthener_carbonated", "碳酸延长:向 Highball/Collins 服务形式的长饮化改良"],
    ["bitter_modifier", "苦味修饰强化:引入金巴利/阿玛罗系(Regan Milanese 族手法)"],
  ];
  for (const [role, desc] of extraNotable) {
    if (roles.has(role) && !anchor.roles.includes(role) && !(anchor.excludeRoles ?? []).includes(role)) {
      out.push(desc);
    }
  }
  if (out.length === 0) {
    out.push("结构与经典规格基本一致,差异主要在比例微调与用料品牌选择");
  }
  return out;
}

/* ------------------------------ 论证文本生成 ------------------------------ */

function buildNarrative(
  verdict: Omit<LineageVerdict, "narrative">,
  recipeName: string,
): string {
  const fam = FAMILY_LABELS[verdict.family].zh;
  const parts: string[] = [];
  if (verdict.classic) {
    const c = verdict.classic;
    const conf =
      verdict.confidence === "high"
        ? "结构证据充分"
        : "结构证据总体支持,存在少量差异";
    parts.push(
      `【经典源流判定】本配方判定为「${c.zh} ${c.en}」的变体(匹配度 ${verdict.score}/100,${conf}),按 Cocktail Codex 六大母配方体系归入${fam}。`,
    );
    parts.push(
      `【底层架构重合】${c.zh}的结构骨架为:${describeAnchorSkeleton(c)}。本配方的配料经 Core/Balance/Seasoning 角色归约(Codex 框架;Embury 称 Base/Modifier/Accent)后,与该骨架的关键角色逐一对应,构成同源判定的结构学依据。`,
    );
    parts.push(`【改良逻辑】${verdict.deviations.join(";")}。`);
    parts.push(`【历史演变因果】${c.lineage.zh}。`);
    if (verdict.runnersUp.length > 0) {
      const alts = verdict.runnersUp
        .map((r) => `${r.anchor.zh} ${r.anchor.en}(${r.score}/100)`)
        .join("、");
      parts.push(`【备选谱系】结构上亦接近:${alts},供交叉参考。`);
    }
    parts.push(`【文献依据】${c.refs.join(";")}。`);
  } else {
    parts.push(
      `【经典源流判定】暂未匹配到高置信度的具体经典锚点,按结构骨架归入${fam}。`,
    );
    parts.push(
      `【判定依据】依据 Cocktail Codex 六大母配方决策树(碳酸长饮→Highball;全蛋→Flip;鲜柑橘+糖→Daiquiri;鲜柑橘+利口酒→Sidecar;无柑橘含加强酒/苦味酒→Martini;无柑橘+糖+苦精→Old Fashioned)与 Gary Regan《The Joy of Mixology》家族分类法综合判定。`,
    );
    parts.push(
      `【说明】该配方可能为自创配方、多家族杂糅或资料库尚未覆盖的经典;可在编辑页人工填写「变体来源」字段覆盖本判定。`,
    );
  }
  return parts.join("\n\n");
}

function describeAnchorSkeleton(c: ClassicAnchor): string {
  const roleZh: Partial<Record<StructureRole, string>> = {
    fortified: "加强酒修饰",
    bitter_modifier: "苦味修饰",
    acid_citrus: "鲜柑橘酸",
    sweet_syrup: "糖类甜味剂",
    sweet_liqueur: "利口酒甜味剂",
    bitters: "苦精调味",
    lengthener_carbonated: "碳酸延长",
    lengthener_juice: "果汁延长",
    texture_egg: "蛋质构",
    texture_dairy: "乳脂质构",
  };
  const spiritDesc = c.spirits.map((s) => SPIRIT_LABELS[s]).join("/");
  const roleDesc = c.roles.map((r) => roleZh[r] ?? r).join(" + ");
  return `${spiritDesc}基酒${roleDesc ? " + " + roleDesc : ""}`;
}

/* -------------------------------- 主入口 -------------------------------- */

/** 分析配方谱系,返回完整判定结果 */
export function analyzeLineage(
  r: Pick<Recipe, "name" | "nameEn" | "ingredients" | "method" | "baseSpirit" | "glass">,
): LineageVerdict {
  const items = analyzeStructure(r.ingredients ?? []);
  const roles = new Set<StructureRole>(items.map((i) => i.role));
  const ingText =
    (r.ingredients ?? []).map((i) => i.name).join(" ") + " " + (r.glass ?? "");
  const method = r.method ?? "";
  const spirit = detectSpiritClass(r.ingredients ?? [], r.baseSpirit ?? "");
  const family = inferFamily(roles, ingText, method);

  // 名称直接命中经典(配方本身就是经典):得分拉满
  const nameNorm = W(`${r.name} ${r.nameEn ?? ""}`);
  const scored = CLASSIC_ANCHORS.map((anchor) => {
    let s = scoreAnchor(anchor, spirit, roles, ingText, method, family);
    // 签名核心未过半命中的锚点,判定上限压至 59(家族级):
    // 排他特征是经典身份的必要条件,仅靠骨架相似不足以断言"某具体经典的变体"
    if (anchor.signature.length > 0) {
      const hits = anchor.signature.filter((wds) => textHas(ingText, wds)).length;
      if (hits / anchor.signature.length < 0.5) s = Math.min(s, 59);
    }
    if (
      nameNorm.includes(W(anchor.en)) ||
      (anchor.zh.length >= 3 && nameNorm.includes(anchor.zh))
    ) {
      s = Math.max(s, 95);
    }
    return { anchor, score: s };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  const confidence: LineageVerdict["confidence"] =
    top.score >= 80 ? "high" : top.score >= 60 ? "medium" : "low";
  const classic = confidence === "low" ? null : top.anchor;
  const runnersUp =
    confidence === "medium"
      ? scored.slice(1, 3).filter((s) => s.score >= 55)
      : [];
  const deviations = classic
    ? deriveDeviations(classic, spirit, roles, ingText)
    : [];
  const partial = {
    classic,
    score: top.score,
    runnersUp,
    family: classic ? classic.family : family,
    deviations,
    confidence,
  };
  return { ...partial, narrative: buildNarrative(partial, r.name) };
}

/** 供 variantOf 字段自动回填:返回 "尼格罗尼 Negroni" 式文本,低置信度返回 "" */
export function inferVariantOf(
  r: Pick<Recipe, "name" | "nameEn" | "ingredients" | "method" | "baseSpirit" | "glass">,
): string {
  const v = analyzeLineage(r);
  if (!v.classic) return "";
  // 配方本身即经典时不标注"变体"
  const nameNorm = W(`${r.name} ${r.nameEn ?? ""}`);
  if (nameNorm.includes(W(v.classic.en)) || nameNorm.includes(v.classic.zh)) return "";
  return `${v.classic.zh} ${v.classic.en}`;
}

/* --------------------------- Codex Family 智能识别 --------------------------- */

/**
 * CODEX_FAMILIES 六值(与 types.ts 存量字符串严格一致):
 * "古典 Old-Fashioned" | "马天尼 Martini" | "大吉利 Daiquiri" | "边车 Sidecar" | "高球 Highball" | "菲兹 Flip"
 */
const CODEX_OF = "古典 Old-Fashioned";
const CODEX_MARTINI = "马天尼 Martini";
const CODEX_DAIQUIRI = "大吉利 Daiquiri";
const CODEX_SIDECAR = "边车 Sidecar";
const CODEX_HIGHBALL = "高球 Highball";
const CODEX_FLIP = "菲兹 Flip";

/**
 * 引擎 FamilyKey → Codex 六族映射(依据 Cocktail Codex 原著归族,见
 * research/variant-lineage-research.md §八):
 * - julep → Old Fashioned 族(原著:Mint Julep 为 OF 官方衍生)
 * - tropical → 椰浆/乳脂类(Piña Colada)→ Flip 族;柑橘酸甜类(Mai Tai)→ Daiquiri 族
 * - duo_trio → 含乳脂(Trio: White Russian/Alexander)→ Flip 族;纯利口酒(Duo)→ OF 族
 * - snapper/unknown → 不妄断,返回 ""
 */
export function toCodexFamily(
  family: FamilyKey,
  roles: Set<StructureRole>,
  ingText: string,
): string {
  switch (family) {
    case "old_fashioned": return CODEX_OF;
    case "martini": return CODEX_MARTINI;
    case "daiquiri": return CODEX_DAIQUIRI;
    case "sidecar": return CODEX_SIDECAR;
    case "highball": return CODEX_HIGHBALL;
    case "flip": return CODEX_FLIP;
    case "julep": return CODEX_OF;
    case "tropical":
      return textHas(ingText, [...K.coconut, ...K.cream]) || roles.has("texture_dairy")
        ? CODEX_FLIP
        : CODEX_DAIQUIRI;
    case "duo_trio":
      return roles.has("texture_dairy") || textHas(ingText, K.cream)
        ? CODEX_FLIP
        : CODEX_OF;
    default:
      return "";
  }
}

/**
 * 规范化文本中明确声明的 Codex Family(导入解析用):
 * 支持中英正名与常见别名/范式名(Sour→Daiquiri、Daisy→Sidecar、Spirit-forward→Martini 等);
 * 无法确认合法时返回 ""(交由引擎判定)。
 */
export function normalizeCodexFamilyDecl(raw: string): string {
  const t = W((raw ?? "").trim());
  if (!t) return "";
  const table: [string[], string][] = [
    [["old-fashioned", "old fashioned", "古典", "元祖", "ancestral"], CODEX_OF],
    [["julep", "朱莉普", "toddy", "托蒂"], CODEX_OF],
    [["martini", "马天尼", "马提尼", "spirit-forward", "spirit forward", "french-italian", "法意"], CODEX_MARTINI],
    [["daiquiri", "大吉利", "德贵丽", "sour", "酸酒", "酸味"], CODEX_DAIQUIRI],
    [["sidecar", "边车", "赛德卡", "daisy", "雏菊", "new orleans sour"], CODEX_SIDECAR],
    [["highball", "高球", "嗨棒", "collins", "柯林斯", "fizz", "菲斯", "buck", "mule", "骡子", "spritz"], CODEX_HIGHBALL],
    [["flip", "菲利普", "蛋酒", "nog", "colada", "可乐达", "trio", "alexander", "亚历山大"], CODEX_FLIP],
  ];
  // 先精确匹配六值原文
  const exact = [CODEX_OF, CODEX_MARTINI, CODEX_DAIQUIRI, CODEX_SIDECAR, CODEX_HIGHBALL, CODEX_FLIP]
    .find((v) => W(v) === t || v === raw.trim());
  if (exact) return exact;
  for (const [words, value] of table) {
    if (words.some((w) => t.includes(w))) return value;
  }
  return "";
}

/**
 * 供 codexFamily 字段自动回填(引擎判定级):
 * 优先随 Variant of 判定的经典锚点归族;否则用结构决策树家族映射。
 */
export function inferCodexFamily(
  r: Pick<Recipe, "name" | "nameEn" | "ingredients" | "method" | "baseSpirit" | "glass">,
): string {
  if (!r.ingredients || r.ingredients.length === 0) return "";
  const v = analyzeLineage(r);
  const items = analyzeStructure(r.ingredients);
  const roles = new Set<StructureRole>(items.map((i) => i.role));
  const ingText = r.ingredients.map((i) => i.name).join(" ") + " " + (r.glass ?? "");
  return toCodexFamily(v.family, roles, ingText);
}
