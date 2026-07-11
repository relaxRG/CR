import { LabSpec } from "./types";

/**
 * 经典框架指引库:研发项目可选的起点模板。
 * 每个框架提供结构公式、槽位卡(角色 + 经典用量区间 + 替换方向提示)与专业提示。
 * 仅作辅助预填,完全可改可脱离。
 * 内容依据 Cocktail Codex 六大母方与 Death & Co / Liquid Intelligence 方法论。
 */

export interface LabSlot {
  /** 槽位角色,双语,如 "核心烈酒 Core Spirit" */
  role: { zh: string; en: string };
  /** 默认预填配料名(经典 spec) */
  defaultName: { zh: string; en: string };
  /** 经典用量(预填值) */
  defaultAmount: string;
  /** 经典用量区间提示 */
  amountRange: { zh: string; en: string };
  /** 替换方向提示(可换什么件) */
  swapHint: { zh: string; en: string };
}

export interface LabTemplate {
  id: string;
  name: { zh: string; en: string };
  /** 所属 Codex 家族(与 Recipe.codexFamily 同格式的混写值;衍生框架沿用母方家族) */
  codexFamily: string;
  /** 结构公式,如 "烈酒 + 糖 + 苦精" */
  formula: { zh: string; en: string };
  /** 一句话定位 */
  summary: { zh: string; en: string };
  slots: LabSlot[];
  /** 默认技法/杯型/冰/装饰 */
  method: string;
  glass: string;
  ice: string;
  garnish: { zh: string; en: string };
  /** 专业提示(平衡要点、稀释目标等) */
  tips: { zh: string; en: string }[];
}

const T = (zh: string, en: string) => ({ zh, en });

export const LAB_TEMPLATES: LabTemplate[] = [
  {
    id: "old-fashioned",
    name: T("古典 Old Fashioned", "Old Fashioned"),
    codexFamily: "古典 Old-Fashioned",
    formula: T("烈酒 + 糖 + 苦精 + 水(冰)", "Spirit + Sugar + Bitters + Water (ice)"),
    summary: T(
      "以烈酒为绝对主角,糖与苦精只做衬托;搅拌低稀释,突出酒体本味。",
      "Spirit-forward with sugar and bitters as seasoning; stirred, low dilution.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("波本威士忌", "Bourbon"),
        defaultAmount: "60ml",
        amountRange: T("经典 55-60ml", "Classic 55-60ml"),
        swapHint: T("黑麦/干邑/陈年朗姆/龙舌兰,或拆分双基酒", "Rye, cognac, aged rum, tequila, or split base"),
      },
      {
        role: T("甜味剂", "Sweetener"),
        defaultName: T("单糖浆", "Simple Syrup"),
        defaultAmount: "5ml",
        amountRange: T("5-10ml(或方糖 1 颗)", "5-10ml (or 1 sugar cube)"),
        swapHint: T("德梅拉拉糖浆/枫糖浆/蜂蜜糖浆(甜度需再校准)", "Demerara, maple, honey syrup (re-balance sweetness)"),
      },
      {
        role: T("苦精", "Bitters"),
        defaultName: T("安高天娜苦精", "Angostura Bitters"),
        defaultAmount: "2 dash",
        amountRange: T("2-4 dash", "2-4 dashes"),
        swapHint: T("橙味/巧克力/核桃苦精,或组合使用", "Orange, chocolate, walnut bitters, or combos"),
      },
    ],
    method: "搅拌",
    glass: "古典杯",
    ice: "大方冰",
    garnish: T("橙皮", "Orange twist"),
    tips: [
      T("一次只改一个变量,便于归因每版差异", "Change one variable at a time for clear attribution"),
      T("搅拌目标稀释约 20-25%;大方冰减缓后续稀释", "Stir to ~20-25% dilution; large cube slows further melt"),
      T("换甜味剂时注意甜度差:蜂蜜糖浆比单糖浆更甜更厚", "Mind sweetness gaps: honey syrup is sweeter/thicker than simple"),
    ],
  },
  {
    id: "daiquiri",
    name: T("大吉利 Daiquiri", "Daiquiri"),
    codexFamily: "大吉利 Daiquiri",
    formula: T("烈酒 + 柑橘酸 + 糖", "Spirit + Citrus + Sugar"),
    summary: T(
      "Sour 母方:酸甜平衡是灵魂;摇制充分降温稀释,口感明亮。",
      "The sour mother recipe: balance of acid and sugar, shaken bright and cold.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("白朗姆", "White Rum"),
        defaultAmount: "60ml",
        amountRange: T("50-60ml", "50-60ml"),
        swapHint: T("金酒(Gimlet 方向)/龙舌兰(Margarita 方向)/威士忌(Whiskey Sour 方向)", "Gin (Gimlet), tequila (Margarita), whiskey (Whiskey Sour)"),
      },
      {
        role: T("酸", "Sour"),
        defaultName: T("青柠汁", "Lime Juice"),
        defaultAmount: "25ml",
        amountRange: T("20-30ml", "20-30ml"),
        swapHint: T("柠檬汁/酸化果汁(调至约 6% 酸度)", "Lemon, or acid-adjusted juice (~6% acidity)"),
      },
      {
        role: T("甜", "Sweet"),
        defaultName: T("单糖浆", "Simple Syrup"),
        defaultAmount: "20ml",
        amountRange: T("15-25ml(经典酸甜比约 1:0.8)", "15-25ml (classic ~1:0.8 sour:sweet)"),
        swapHint: T("风味糖浆/利口酒替代部分糖(同时补充风味)", "Flavored syrups or liqueur replacing part of sugar"),
      },
    ],
    method: "摇和",
    glass: "碟形杯",
    ice: "无冰",
    garnish: T("青柠角", "Lime wedge"),
    tips: [
      T("摇制稀释约为总量 50-60%(Liquid Intelligence 口径),冰量要足", "Shake dilution ~50-60% by volume (Liquid Intelligence); use plenty of ice"),
      T("先定酸甜比再动基酒;每次只微调 2-5ml", "Lock the sour:sweet ratio before swapping base; adjust 2-5ml at a time"),
    ],
  },
  {
    id: "martini",
    name: T("马天尼 Martini", "Martini"),
    codexFamily: "马天尼 Martini",
    formula: T("烈酒 + 加香葡萄酒", "Spirit + Aromatized Wine"),
    summary: T(
      "烈酒与味美思的二元对话;比例即个性,搅拌冷冽丝滑。",
      "A duet of spirit and vermouth; the ratio is the personality. Stirred, silky cold.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("金酒", "Gin"),
        defaultAmount: "60ml",
        amountRange: T("50-75ml", "50-75ml"),
        swapHint: T("伏特加/老汤姆金酒;或换比例走 50/50", "Vodka, Old Tom gin; or go 50/50 ratio"),
      },
      {
        role: T("加香酒", "Aromatized Wine"),
        defaultName: T("干味美思", "Dry Vermouth"),
        defaultAmount: "10ml",
        amountRange: T("10-30ml(比例 6:1 至 2:1)", "10-30ml (ratios 6:1 to 2:1)"),
        swapHint: T("白利莱/雪莉(Bamboo 方向)/甜味美思(Martinez 方向)", "Lillet Blanc, sherry (Bamboo), sweet vermouth (Martinez)"),
      },
      {
        role: T("点睛(可选)", "Accent (optional)"),
        defaultName: T("橙味苦精", "Orange Bitters"),
        defaultAmount: "1 dash",
        amountRange: T("0-2 dash", "0-2 dashes"),
        swapHint: T("橄榄盐水(Dirty)/苦艾酒涮杯", "Olive brine (Dirty), absinthe rinse"),
      },
    ],
    method: "搅拌",
    glass: "马天尼杯",
    ice: "无冰",
    garnish: T("柠檬皮或橄榄", "Lemon twist or olive"),
    tips: [
      T("味美思新鲜度决定成败;开瓶冷藏并尽快用完", "Vermouth freshness is critical; refrigerate after opening"),
      T("迭代时先固定烈酒试比例,再固定比例换烈酒", "Iterate ratio with fixed spirit first, then swap spirits at fixed ratio"),
    ],
  },
  {
    id: "sidecar",
    name: T("边车 Sidecar", "Sidecar"),
    codexFamily: "边车 Sidecar",
    formula: T("烈酒 + 柑橘酸 + 利口酒(甜)", "Spirit + Citrus + Liqueur (sweet)"),
    summary: T(
      "以风味利口酒充当甜味剂的 Sour 分支;利口酒同时贡献风味层次。",
      "A sour where the liqueur is the sweetener, adding its own flavor layer.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("干邑", "Cognac"),
        defaultAmount: "45ml",
        amountRange: T("40-50ml", "40-50ml"),
        swapHint: T("波本(换向 Whiskey Sidecar)/龙舌兰(Margarita 亲缘)", "Bourbon, or tequila (Margarita kin)"),
      },
      {
        role: T("酸", "Sour"),
        defaultName: T("柠檬汁", "Lemon Juice"),
        defaultAmount: "20ml",
        amountRange: T("15-25ml", "15-25ml"),
        swapHint: T("青柠汁(更锐利)", "Lime for sharper acidity"),
      },
      {
        role: T("甜味利口酒", "Sweet Liqueur"),
        defaultName: T("君度", "Cointreau"),
        defaultAmount: "20ml",
        amountRange: T("15-25ml", "15-25ml"),
        swapHint: T("其他橙皮酒/风味利口酒(甜度不同需再校准)", "Other triple secs / liqueurs (re-balance sweetness)"),
      },
    ],
    method: "摇和",
    glass: "碟形杯",
    ice: "无冰",
    garnish: T("橙皮(可糖圈)", "Orange twist (optional sugar rim)"),
    tips: [
      T("利口酒甜度低于糖浆,酸量应比 Daiquiri 略收", "Liqueurs are less sweet than syrup; pull back acid vs a Daiquiri"),
      T("必要时补 5ml 单糖浆兜底平衡", "A 5ml simple syrup backstop can fix balance"),
    ],
  },
  {
    id: "highball",
    name: T("高球 Highball", "Highball"),
    codexFamily: "高球 Highball",
    formula: T("烈酒 + 气泡/软饮(约 1:2~1:4)", "Spirit + Sparkling/Soft (about 1:2-1:4)"),
    summary: T(
      "低门槛长饮:烈酒被气泡拉长;温度与气泡感是品质关键。",
      "A long drink: spirit lengthened by bubbles; temperature and carbonation are king.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("威士忌", "Whisky"),
        defaultAmount: "45ml",
        amountRange: T("40-60ml", "40-60ml"),
        swapHint: T("金酒(G&T 方向)/朗姆(Cuba Libre 方向)/阿玛罗", "Gin (G&T), rum (Cuba Libre), amaro"),
      },
      {
        role: T("延展液", "Lengthener"),
        defaultName: T("苏打水", "Soda Water"),
        defaultAmount: "120ml",
        amountRange: T("90-150ml", "90-150ml"),
        swapHint: T("汤力水/姜汁汽水/气泡茶/康普茶", "Tonic, ginger ale/beer, sparkling tea, kombucha"),
      },
      {
        role: T("点睛(可选)", "Accent (optional)"),
        defaultName: T("柠檬皮", "Lemon Twist"),
        defaultAmount: "1 条",
        amountRange: T("适量", "To taste"),
        swapHint: T("苦精数滴/风味糖浆 5-10ml", "Dashes of bitters, 5-10ml flavored syrup"),
      },
    ],
    method: "直调",
    glass: "高球杯",
    ice: "长条冰",
    garnish: T("柠檬皮", "Lemon twist"),
    tips: [
      T("杯、酒、气泡水全冰镇;沿冰轻倒保气", "Chill glass, spirit and soda; pour gently down the ice to keep fizz"),
      T("比例是核心变量:1:2 浓郁,1:4 清爽", "Ratio is the key variable: 1:2 rich, 1:4 crisp"),
    ],
  },
  {
    id: "flip",
    name: T("菲丽普 Flip", "Flip"),
    codexFamily: "菲丽普 Flip",
    formula: T("烈酒/加强酒 + 糖 + 全蛋/奶油", "Spirit/Fortified + Sugar + Whole Egg/Cream"),
    summary: T(
      "以蛋或奶油构建的丰腴质地;甜点化的一族,重点在质地与香料。",
      "Rich texture built on egg or cream; dessert-like, all about texture and spice.",
    ),
    slots: [
      {
        role: T("核心酒", "Core"),
        defaultName: T("波特酒", "Port"),
        defaultAmount: "60ml",
        amountRange: T("45-60ml", "45-60ml"),
        swapHint: T("白兰地/朗姆/雪莉;或烈酒+加强酒拆分", "Brandy, rum, sherry; or split spirit + fortified"),
      },
      {
        role: T("甜", "Sweet"),
        defaultName: T("单糖浆", "Simple Syrup"),
        defaultAmount: "15ml",
        amountRange: T("10-20ml", "10-20ml"),
        swapHint: T("德梅拉拉/香料糖浆", "Demerara or spiced syrup"),
      },
      {
        role: T("质地", "Texture"),
        defaultName: T("全蛋", "Whole Egg"),
        defaultAmount: "1 个",
        amountRange: T("全蛋 1 个或奶油 30ml", "1 whole egg or 30ml cream"),
        swapHint: T("奶油(White Russian 方向)/蛋白(更轻盈)", "Cream (White Russian direction), egg white (lighter)"),
      },
    ],
    method: "干摇后摇和",
    glass: "碟形杯",
    ice: "无冰",
    garnish: T("现磨肉豆蔻", "Grated nutmeg"),
    tips: [
      T("先干摇乳化再加冰摇透;蛋要新鲜", "Dry shake to emulsify, then shake with ice; use fresh eggs"),
      T("香料装饰(肉豆蔻/肉桂)是风味变量之一", "Spice garnish (nutmeg/cinnamon) is a real flavor variable"),
    ],
  },
  {
    id: "negroni",
    name: T("尼格罗尼 Negroni", "Negroni"),
    codexFamily: "马天尼 Martini",
    formula: T("烈酒 + 苦味利口酒 + 甜味美思(1:1:1)", "Spirit + Bitter Liqueur + Sweet Vermouth (1:1:1)"),
    summary: T(
      "等分三元结构,苦甜平衡;换任一元即成新酒(Boulevardier/白色尼格罗尼…)。",
      "Equal-parts trio balancing bitter and sweet; swap any leg for a new drink.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("金酒", "Gin"),
        defaultAmount: "30ml",
        amountRange: T("30ml(可升至 45ml 更烈)", "30ml (up to 45ml spirit-forward)"),
        swapHint: T("波本(Boulevardier)/气泡酒(Sbagliato)/梅斯卡尔", "Bourbon (Boulevardier), prosecco (Sbagliato), mezcal"),
      },
      {
        role: T("苦味利口酒", "Bitter Liqueur"),
        defaultName: T("金巴利", "Campari"),
        defaultAmount: "30ml",
        amountRange: T("20-30ml", "20-30ml"),
        swapHint: T("阿佩罗(更轻)/苏兹(白色方向)/其他阿玛罗", "Aperol (lighter), Suze (white), other amari"),
      },
      {
        role: T("甜味美思", "Sweet Vermouth"),
        defaultName: T("甜味美思", "Sweet Vermouth"),
        defaultAmount: "30ml",
        amountRange: T("20-30ml", "20-30ml"),
        swapHint: T("白味美思/雪莉/波特", "Bianco vermouth, sherry, port"),
      },
    ],
    method: "搅拌",
    glass: "古典杯",
    ice: "大方冰",
    garnish: T("橙皮", "Orange twist"),
    tips: [
      T("从 1:1:1 出发,再按目标微调三边比例", "Start 1:1:1, then skew the triangle toward your goal"),
      T("换苦味利口酒时先小比例替换(拆分槽位)", "When swapping the bitter leg, try split-slot blends first"),
    ],
  },
  {
    id: "collins",
    name: T("柯林斯 Collins", "Collins"),
    codexFamily: "高球 Highball",
    formula: T("烈酒 + 柑橘酸 + 糖 + 苏打", "Spirit + Citrus + Sugar + Soda"),
    summary: T(
      "Sour 拉长为气泡长饮;清爽解渴,骨架依然是酸甜平衡。",
      "A sour lengthened with soda; refreshing, still anchored by sour-sweet balance.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("金酒", "Gin"),
        defaultAmount: "45ml",
        amountRange: T("40-50ml", "40-50ml"),
        swapHint: T("伏特加/威士忌(John Collins)/朗姆", "Vodka, whiskey (John Collins), rum"),
      },
      {
        role: T("酸", "Sour"),
        defaultName: T("柠檬汁", "Lemon Juice"),
        defaultAmount: "25ml",
        amountRange: T("20-30ml", "20-30ml"),
        swapHint: T("青柠/酸化果汁", "Lime or acid-adjusted juice"),
      },
      {
        role: T("甜", "Sweet"),
        defaultName: T("单糖浆", "Simple Syrup"),
        defaultAmount: "20ml",
        amountRange: T("15-25ml", "15-25ml"),
        swapHint: T("风味糖浆(果茸方向)", "Flavored syrups / purées"),
      },
      {
        role: T("延展液", "Lengthener"),
        defaultName: T("苏打水", "Soda Water"),
        defaultAmount: "60ml",
        amountRange: T("60-90ml", "60-90ml"),
        swapHint: T("气泡酒(French 75 方向)", "Sparkling wine (French 75 direction)"),
      },
    ],
    method: "摇和后兑苏打",
    glass: "柯林斯杯",
    ice: "标准方冰",
    garnish: T("柠檬片与樱桃", "Lemon wheel & cherry"),
    tips: [T("先按 Sour 调平衡,再兑苏打;苏打会稀释甜酸感", "Balance as a sour first; soda dilutes perceived sweet/sour")],
  },
  {
    id: "margarita",
    name: T("玛格丽特 Margarita", "Margarita"),
    codexFamily: "大吉利 Daiquiri",
    formula: T("龙舌兰 + 青柠 + 橙皮酒", "Tequila + Lime + Orange Liqueur"),
    summary: T(
      "Daiquiri 与 Sidecar 的交汇:利口酒与糖共担甜位。",
      "Where Daiquiri meets Sidecar: liqueur shares the sweet slot.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("特其拉", "Tequila Blanco"),
        defaultAmount: "50ml",
        amountRange: T("45-60ml", "45-60ml"),
        swapHint: T("梅斯卡尔(烟熏)/微陈 Reposado", "Mezcal (smoky), reposado"),
      },
      {
        role: T("酸", "Sour"),
        defaultName: T("青柠汁", "Lime Juice"),
        defaultAmount: "25ml",
        amountRange: T("20-30ml", "20-30ml"),
        swapHint: T("酸化橙汁等", "Acid-adjusted orange juice, etc."),
      },
      {
        role: T("甜味利口酒", "Sweet Liqueur"),
        defaultName: T("君度", "Cointreau"),
        defaultAmount: "20ml",
        amountRange: T("15-25ml", "15-25ml"),
        swapHint: T("龙舌兰糖浆替代部分(Tommy's 方向)", "Agave syrup instead (Tommy's Margarita)"),
      },
    ],
    method: "摇和",
    glass: "古典杯",
    ice: "标准方冰",
    garnish: T("盐圈与青柠角", "Salt rim & lime wedge"),
    tips: [T("盐圈半圈即可,给饮者选择", "Half salt rim gives the drinker a choice")],
  },
  {
    id: "whiskey-sour",
    name: T("威士忌酸 Whiskey Sour", "Whiskey Sour"),
    codexFamily: "大吉利 Daiquiri",
    formula: T("威士忌 + 柠檬 + 糖(可选蛋白)", "Whiskey + Lemon + Sugar (optional egg white)"),
    summary: T(
      "Sour 的威士忌分支;蛋白泡沫是质地变量。",
      "The whiskey branch of the sour; egg-white foam is a texture variable.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("波本威士忌", "Bourbon"),
        defaultAmount: "50ml",
        amountRange: T("45-60ml", "45-60ml"),
        swapHint: T("黑麦(更辛)/加红酒漂浮(New York Sour)", "Rye (spicier); red wine float (New York Sour)"),
      },
      {
        role: T("酸", "Sour"),
        defaultName: T("柠檬汁", "Lemon Juice"),
        defaultAmount: "25ml",
        amountRange: T("20-30ml", "20-30ml"),
        swapHint: T("柠檬+青柠混合", "Lemon-lime blend"),
      },
      {
        role: T("甜", "Sweet"),
        defaultName: T("单糖浆", "Simple Syrup"),
        defaultAmount: "20ml",
        amountRange: T("15-25ml", "15-25ml"),
        swapHint: T("蜂蜜糖浆(Gold Rush 方向)", "Honey syrup (Gold Rush direction)"),
      },
      {
        role: T("质地(可选)", "Texture (optional)"),
        defaultName: T("蛋白", "Egg White"),
        defaultAmount: "15ml",
        amountRange: T("0-30ml", "0-30ml"),
        swapHint: T("鹰嘴豆水(纯素替代)", "Aquafaba (vegan)"),
      },
    ],
    method: "干摇后摇和",
    glass: "古典杯",
    ice: "大方冰",
    garnish: T("苦精点画", "Bitters art on foam"),
    tips: [T("加蛋白需干摇;不加则同 Daiquiri 流程", "Dry shake with egg white; otherwise standard sour process")],
  },
  {
    id: "julep",
    name: T("朱丽普 Julep", "Julep"),
    codexFamily: "古典 Old-Fashioned",
    formula: T("烈酒 + 糖 + 薄荷 + 碎冰", "Spirit + Sugar + Mint + Crushed Ice"),
    summary: T(
      "Old Fashioned 的碎冰香草分支;碎冰持续稀释,清凉芬芳。",
      "The crushed-ice, herbal branch of the Old Fashioned; continuous dilution.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("波本威士忌", "Bourbon"),
        defaultAmount: "60ml",
        amountRange: T("60-75ml(碎冰会持续稀释)", "60-75ml (crushed ice keeps diluting)"),
        swapHint: T("干邑/黑朗姆;或拆分基酒", "Cognac, dark rum; or split base"),
      },
      {
        role: T("甜", "Sweet"),
        defaultName: T("单糖浆", "Simple Syrup"),
        defaultAmount: "10ml",
        amountRange: T("8-15ml", "8-15ml"),
        swapHint: T("蜂蜜/桃子糖浆(经典南方风)", "Honey or peach syrup (Southern classic)"),
      },
      {
        role: T("香草", "Herb"),
        defaultName: T("薄荷叶", "Mint Leaves"),
        defaultAmount: "8-10 片",
        amountRange: T("轻拍不捣碎", "Slap, don't muddle to bits"),
        swapHint: T("罗勒/紫苏等香草替换", "Basil, shiso, other herbs"),
      },
    ],
    method: "直调",
    glass: "朱丽普杯",
    ice: "碎冰",
    garnish: T("薄荷束", "Mint bouquet"),
    tips: [T("烈酒浓度要高于常规,预留碎冰稀释空间", "Go stronger than usual; crushed ice will dilute over time")],
  },
  {
    id: "espresso-martini",
    name: T("浓缩咖啡马天尼 Espresso Martini", "Espresso Martini"),
    codexFamily: "边车 Sidecar",
    formula: T("伏特加 + 咖啡利口酒 + 浓缩咖啡 + 糖", "Vodka + Coffee Liqueur + Espresso + Sugar"),
    summary: T(
      "现代经典:咖啡的苦与油脂泡沫构成骨架;甜度决定成败。",
      "Modern classic: coffee bitterness and crema foam form the frame; sweetness decides it.",
    ),
    slots: [
      {
        role: T("核心烈酒", "Core Spirit"),
        defaultName: T("伏特加", "Vodka"),
        defaultAmount: "40ml",
        amountRange: T("35-50ml", "35-50ml"),
        swapHint: T("陈年朗姆/波本(更厚)", "Aged rum or bourbon for depth"),
      },
      {
        role: T("咖啡利口酒", "Coffee Liqueur"),
        defaultName: T("咖啡利口酒", "Coffee Liqueur"),
        defaultAmount: "20ml",
        amountRange: T("15-25ml", "15-25ml"),
        swapHint: T("不同品牌甜度差异大,需再校准", "Brands vary widely in sweetness; re-balance"),
      },
      {
        role: T("咖啡", "Coffee"),
        defaultName: T("浓缩咖啡", "Espresso"),
        defaultAmount: "30ml",
        amountRange: T("25-40ml(现萃)", "25-40ml (freshly pulled)"),
        swapHint: T("冷萃(更柔)", "Cold brew (softer)"),
      },
      {
        role: T("甜(可选)", "Sweet (optional)"),
        defaultName: T("单糖浆", "Simple Syrup"),
        defaultAmount: "5ml",
        amountRange: T("0-10ml", "0-10ml"),
        swapHint: T("香草糖浆", "Vanilla syrup"),
      },
    ],
    method: "摇和",
    glass: "马天尼杯",
    ice: "无冰",
    garnish: T("咖啡豆 3 颗", "3 coffee beans"),
    tips: [T("用力摇出油脂泡沫;咖啡现萃现用", "Shake hard for crema; use espresso immediately")],
  },
  {
    id: "tiki-maitai",
    name: T("迈泰 Mai Tai(Tiki)", "Mai Tai (Tiki)"),
    codexFamily: "大吉利 Daiquiri",
    formula: T("朗姆(拆分) + 青柠 + 橙皮酒 + 杏仁糖浆", "Split Rums + Lime + Orange Liqueur + Orgeat"),
    summary: T(
      "Tiki 代表作:拆分基酒与坚果糖浆制造复杂度;Daiquiri 的华丽扩展。",
      "Tiki flagship: split rums and orgeat build complexity on a Daiquiri frame.",
    ),
    slots: [
      {
        role: T("核心烈酒(拆分)", "Core Spirits (split)"),
        defaultName: T("牙买加朗姆 + 农业朗姆", "Jamaican + Agricole Rum"),
        defaultAmount: "30ml + 30ml",
        amountRange: T("合计 50-60ml", "50-60ml total"),
        swapHint: T("多支朗姆自由拆分,构建层次", "Blend multiple rums freely for depth"),
      },
      {
        role: T("酸", "Sour"),
        defaultName: T("青柠汁", "Lime Juice"),
        defaultAmount: "25ml",
        amountRange: T("20-30ml", "20-30ml"),
        swapHint: T("保留青柠壳做装饰", "Keep the spent lime shell as garnish"),
      },
      {
        role: T("甜味利口酒", "Sweet Liqueur"),
        defaultName: T("橙皮酒", "Orange Curaçao"),
        defaultAmount: "15ml",
        amountRange: T("10-20ml", "10-20ml"),
        swapHint: T("君度(更干净)", "Cointreau (cleaner)"),
      },
      {
        role: T("坚果糖浆", "Nut Syrup"),
        defaultName: T("杏仁糖浆", "Orgeat"),
        defaultAmount: "10ml",
        amountRange: T("8-15ml", "8-15ml"),
        swapHint: T("开心果/澳洲坚果糖浆", "Pistachio or macadamia orgeat"),
      },
    ],
    method: "摇和",
    glass: "古典杯",
    ice: "碎冰",
    garnish: T("薄荷束与青柠壳", "Mint sprig & lime shell"),
    tips: [T("拆分基酒是 Tiki 的核心变量:一支香一支厚", "Split base is the Tiki variable: one aromatic, one rich")],
  },
];

export function getLabTemplate(id: string): LabTemplate | undefined {
  return LAB_TEMPLATES.find((t) => t.id === id);
}

/** 用模板生成预填 spec(配料名按界面语言取值) */
export function specFromTemplate(
  tpl: LabTemplate,
  lang: "zh" | "en",
  genId: () => string,
): LabSpec {
  return {
    ingredients: tpl.slots.map((s) => ({
      id: genId(),
      name: lang === "en" ? s.defaultName.en : s.defaultName.zh,
      amount: s.defaultAmount,
    })),
    method: tpl.method,
    glass: tpl.glass,
    ice: tpl.ice,
    garnish: lang === "en" ? tpl.garnish.en : tpl.garnish.zh,
  };
}
