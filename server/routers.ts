import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { z } from "zod";
import { invokeLLM, type MessageContent } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { normalizeTagToZh } from "../lib/recipes/types";
import {
  getAppConfigValue,
  getSyncData,
  setAppConfigValue,
  upsertSyncData,
} from "./db";

/**
 * Server 端：将 AI 返回的任意语言标签规范化到中文白名单。
 * 策略：精确匹配 → normalizeTagToZh 转中文后匹配 → 模糊包含匹配 → 返回空字符串
 */
function resolveToZhWhitelistServer(raw: string, whitelist: readonly string[]): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (whitelist.includes(trimmed)) return trimmed;
  const zh = normalizeTagToZh(trimmed);
  if (whitelist.includes(zh)) return zh;
  const zhLower = zh.toLowerCase();
  for (const w of whitelist) {
    const wLower = w.toLowerCase();
    if (zhLower.includes(wLower) || wLower.includes(zhLower)) return w;
    const rawLower = trimmed.toLowerCase();
    if (rawLower.includes(wLower) || wLower.includes(rawLower)) return w;
  }
  return "";
}

/** 服务端用的完整杯型白名单（含用户常用扩展杯型，与 prompt 中 glassList 保持一致） */
const SERVER_VALID_GLASSES = [
  "马天尼杯","古典杯","高球杯","柯林杯","库佩杯","飓风杯","子弹杯",
  "尼克诺拉杯","郁金香杯","笛型杯","提基杯","铜杯","朱莉普杯","红酒杯","其他",
] as const;

/** 服务端用的基酒白名单 */
const SERVER_VALID_SPIRITS = [
  "金酒","朗姆","伏特加","威士忌","龙舌兰","白兰地","梅斯卡尔","卡沙萨","皮斯科","利口酒","无酒精","其他",
] as const;

const OWNER_KEY = "ownerOpenId";

/**
 * 访问控制:应用为私人使用。
 * 第一个登录的用户自动成为 owner;之后仅 owner 可访问同步数据。
 */
async function ensureOwner(user: { id: number; openId: string }) {
  const owner = await getAppConfigValue(OWNER_KEY);
  if (!owner) {
    await setAppConfigValue(OWNER_KEY, user.openId);
    return true;
  }
  return owner === user.openId;
}

/** 批量导入:从文件 base64 提取纯文本(xlsx/docx/csv/txt;pdf 走 LLM file_url) */
async function extractFileText(
  fileBase64: string,
  fileName: string,
): Promise<{ text?: string; pdfBase64?: string }> {
  const lower = fileName.toLowerCase();
  const buf = Buffer.from(fileBase64, "base64");
  if (lower.endsWith(".pdf")) {
    return { pdfBase64: fileBase64 };
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      if (csv.trim()) parts.push(`## Sheet: ${name}\n${csv}`);
    }
    return { text: parts.join("\n\n") };
  }
  if (lower.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    return { text: result.value };
  }
  // csv / txt / md 等按 UTF-8 文本处理
  return { text: buf.toString("utf-8") };
}

const EXTRACT_SYSTEM_PROMPT = `你是一个鸡尾酒应用的数据导入助手。用户会提供一段文本(可能来自 PDF/Excel/Word/粘贴),内容可能包含:
1. bottle(酒库条目):市售的瓶装酒/原料,如金酒、威士忌、利口酒、苦精、糖浆、果汁、软饮等
2. prep(自制库条目):自制的糖浆、利口酒、风味液体、浸渍酒等,通常有做法/保质期/储存方式
3. recipe(酒单配方):鸡尾酒配方,有配料表和调制步骤
4. material(原材料库条目):新鲜水果、香草香料、糖类、蛋奶、茶咖等调酒原材料,常见于供应商报价表/采购单

特别注意——供应商报价表/采购价目表(如"水果报价表"):
- 表格通常有 品名/规格/单位/单价 等列,每行一条原料
- 只提取对调酒有用的原料(如柠檬、青柠、橙、西柚、菠萝、百香果、草莓、黄瓜、薄荷、姜等常用于鸡尾酒的水果/香草);明显与调酒无关的条目(如榴莲整箱、大宗蔬菜)跳过
- 这类条目 type 输出 "material",category 固定填 "原材料",style 按性质填以下之一:Fruit & Citrus(水果柑橘)/Herb(新鲜香草)/Spice & Botanical(香料草本)/Sugar & Sweetener(糖与甜味剂)/Dairy & Egg(乳制品蛋类)/Nut / Tea / Coffee(坚果茶咖)/Acid & Additive(酸剂添加剂)
- 价格换算:报价常为 元/斤 或 元/箱(含规格),尽量折算为该条目 volume 规格对应的价格;无法折算时保留原单价并在 notes 注明计价单位(如"报价 8元/斤")

请从文本中提取所有可识别的条目,输出 JSON:
{"items":[{
  "type":"bottle"|"prep"|"recipe"|"material",
  "nameZh":"中文名(没有则译)","nameEn":"英文名(没有则译或拼音)",
  "category":"bottle分类,如 金酒/威士忌/利口酒/苦精/糖浆/果汁/软饮;material固定为 原材料","style":"风格子分类,如 London Dry/Bourbon;material如 Fruit & Citrus","brand":"品牌","origin":"产地","volume":"规格如 700ml/500g/1斤","abv":40,"priceCny":0,
  "prepIngredients":["prep配料一行一条"],"prepRecipe":"做法","prepYield":"产量如 ~750ml","shelfLife":"保质期","storage":"储存方式",
  "baseSpirit":"recipe基酒,如 金酒","glass":"杯型","method":"调制法,如 摇和/搅拌","ingredients":[{"name":"配料名","amount":"用量如 45ml"}],"steps":"步骤(可多行)","garnish":"装饰","source":"出处",
  "variantOf":"文本明确写明的经典变体来源(如 '尼格罗尼的变体'/'Variant of Sidecar'),没写则空","codexFamily":"文本明确写明的 Codex 六大家族/母配方归属(如 'Family: Sidecar'/'六大家族:大吉利'),仅在文本明确声明时填写原文,没写则空",
  "notes":"备注"
}]}
规则:
- 数值字段 abv/priceCny 输出数字,未知填 0
- 未知的字符串字段填 ""
- variantOf/codexFamily 只在原文明确声明时提取(不要自行推断)
- source(引用来源)对 recipe 与 prep 都要尽力提取:书名/作者/酒吧/网站/年份等来源信息(如 "The Waldorf Astoria Bar Book · Frank Caiafa"),并且不要把来源信息重复写进 notes
- nameZh 与 nameEn 必须都给出:缺英文名时给出通用英文译名(如 柠檬→Lemon,百香果→Passion Fruit),缺中文名时给出通用中文译名
- 不要编造文本中不存在的条目;表格中每一行通常是一个条目
- 类型判断:有配料+步骤的是 recipe;有做法/保质期且是自制物的是 prep;新鲜水果/香草/糖/蛋奶等非瓶装酒水原料是 material;其余瓶装商品是 bottle
- 最多提取 60 条`;

const bulkItemSchema = z.object({
  type: z.enum(["bottle", "prep", "recipe", "material"]),
  nameZh: z.string().catch(""),
  nameEn: z.string().catch(""),
  category: z.string().catch(""),
  style: z.string().catch(""),
  brand: z.string().catch(""),
  origin: z.string().catch(""),
  volume: z.string().catch(""),
  abv: z.number().catch(0),
  priceCny: z.number().catch(0),
  prepIngredients: z.array(z.string()).catch([]),
  prepRecipe: z.string().catch(""),
  prepYield: z.string().catch(""),
  shelfLife: z.string().catch(""),
  storage: z.string().catch(""),
  baseSpirit: z.string().catch(""),
  glass: z.string().catch(""),
  method: z.string().catch(""),
  ingredients: z
    .array(z.object({ name: z.string().catch(""), amount: z.string().catch("") }))
    .catch([]),
  steps: z.string().catch(""),
  garnish: z.string().catch(""),
  source: z.string().catch(""),
  variantOf: z.string().catch(""),
  codexFamily: z.string().catch(""),
  notes: z.string().catch(""),
});

export type BulkImportItem = z.infer<typeof bulkItemSchema>;

type LLMContent = Parameters<typeof invokeLLM>[0]["messages"][number]["content"];

async function llmExtract(userContent: LLMContent): Promise<BulkImportItem[]> {
  const signal = AbortSignal.timeout(60_000);
  let response;
  try {
    response = await invokeLLM({
      messages: [
        { role: "system", content: EXTRACT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      response_format: { type: "json_object" },
      signal,
    });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(isTimeout ? "AI 提取超时，请缩短文本后重试" : `AI 提取失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  const raw = response.choices[0]?.message?.content;
  const text = typeof raw === "string" ? raw : "";
  let parsed: unknown = { items: [] };
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = { items: [] };
      }
    }
  }
  const arr = Array.isArray((parsed as { items?: unknown[] })?.items)
    ? (parsed as { items: unknown[] }).items
    : [];
  const items: BulkImportItem[] = [];
  for (const it of arr.slice(0, 60)) {
    const r = bulkItemSchema.safeParse(it);
    if (r.success && (r.data.nameZh.trim() || r.data.nameEn.trim())) items.push(r.data);
  }
  return items;
}

const OCR_SYSTEM_PROMPT = `你是一个精准的书页文字转写(OCR)助手。用户提供书页图片或扫描版 PDF,请把全部可读文字按原始阅读顺序完整转写为纯文本:
- 章节标题或配方名称行加 "## " 前缀
- 配料行保持"名称 用量"格式,一行一条
- 保留换行与条目边界,不要合并不同配方
- 只输出转写文本:不要解释、不要翻译、不要 markdown 代码块
- 页面没有文字时输出空字符串`;

async function llmOcr(content: MessageContent[]): Promise<string> {
  const signal = AbortSignal.timeout(90_000);
  let response;
  try {
    response = await invokeLLM({
      messages: [
        { role: "system", content: OCR_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      signal,
    });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(isTimeout ? "OCR 超时，请减少图片数量后重试" : `OCR 失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  const raw = response.choices[0]?.message?.content;
  return typeof raw === "string" ? raw.trim() : "";
}

const TRANSLATE_SYSTEM_PROMPT = (target: "zh" | "en") =>
  `你是专业的调酒书籍译者。把用户 JSON 中的每个配方条目翻译成${
    target === "zh" ? "中文" : "英文(English)"
  }。规则:
- 使用调酒行业标准术语(如 gin↔金酒、shake↔摇和、coupe↔库佩杯)
- amount 用量中的数字与单位保持原样(如 45ml、2 dash、1 bar spoon)
- 品牌等专有名词保留原文
- id 原样返回;不得增删条目
- 已是目标语言的内容原样保留
输出 JSON:{"items":[{"id":"","name":"","ingredients":[{"name":"","amount":""}],"steps":"","garnish":"","glass":"","method":""}]}`;

const translatedItemSchema = z.object({
  id: z.string().catch(""),
  name: z.string().catch(""),
  ingredients: z
    .array(z.object({ name: z.string().catch(""), amount: z.string().catch("") }))
    .catch([]),
  steps: z.string().catch(""),
  garnish: z.string().catch(""),
  glass: z.string().catch(""),
  method: z.string().catch(""),
});

export type TranslatedRecipeItem = z.infer<typeof translatedItemSchema>;

const ENRICH_SYSTEM_PROMPT = `你是一个鸡尾酒/酒类知识专家。用户会给出一个或多个酒、原料或产品的名称(可能含品牌、也可能附照片),它们在用户的私人库中暂无资料。请根据你已有的行业知识,尽力还原每件产品的真实资料,补全为结构化条目。
你是专业的烈酒/饮料/原材料知识专家，深度研习以下权威资料与档案库：

【鸡尾酒与调酒 — 英文权威书籍】
· Jerry Thomas《Bartender's Guide / How to Mix Drinks》(1862) — 最早鸡尾酒配方书，Old Tom Gin 时代基准
· Harry Johnson《Bartenders' Manual》(1882/1888) — Martini/Manhattan 早期文献记录
· Hugo Ensslin《Recipes for Mixed Drinks》(1916) — Aviation 首次记录，禁酒令前纽约最后一本配方书
· Harry Craddock《The Savoy Cocktail Book》(1930) — 禁酒令时代伦敦权威，750+ 配方
· David A. Embury《The Fine Art of Mixing Drinks》(1948) — 六大基础鸡尾酒分类理论奠基
· Trader Vic《Bartender's Guide》(1947) — Tiki 文化奠基，Mai Tai/Zombie 原始配方
· Mr. Boston Official Bartender's Guide (1935–现代版) — 美国最畅销调酒参考书
· Gary Regan《The Joy of Mixology》(2003) — 家族分类法（New Sours/Old Sours/Duos/Trios）
· David Wondrich《Imbibe!》(2007, 2015修订) — 美国鸡尾酒历史权威考证，James Beard Award
· David Wondrich《Punch》(2010) — 潘趣酒历史与配方考证
· David Wondrich & Noah Rothbaum《The Oxford Companion to Spirits & Cocktails》(2021) — 最权威的烈酒与鸡尾酒百科全书
· Death & Co《Cocktail Codex》(2018) — 六大母配方体系权威定义（Alex Day, Nick Fauchald, David Kaplan）
· Jim Meehan《The PDT Cocktail Book》(2011) — 纽约 PDT 酒吧经典配方
· Jim Meehan《Meehan's Bartender Manual》(2017) — 现代调酒全面参考
· Jeffrey Morgenthaler《The Bar Book》(2014) — 技术导向调酒参考，自制糖浆/浸渍权威
· Dale DeGroff《The Craft of the Cocktail》(2002) — Rainbow Room 传奇调酒师
· Dale DeGroff《The Essential Cocktail》(2008) — 经典配方精选
· Ted Haigh《Vintage Spirits and Forgotten Cocktails》(2009) — 复古配方复兴运动
· Angus Winchester & Simon Difford《Difford's Guide to Cocktails》(多版) — 3000+ 配方权威数据库
· Robert Hess《The Essential Bartender's Guide》(2008)
· Sasha Petraske《Regarding Cocktails》(2016) — Milk & Honey 极简主义
· Toby Cecchini《Cosmopolitan》(2003) — Cosmo 配方考证
· Charles H. Baker Jr.《The Gentleman's Companion》(1939) — 世界旅行调酒笔记
· Frank Caiafa《The Waldorf Astoria Bar Book》(2016) — 百年酒店调酒传承
· Harry MacElhone《ABC of Mixing Cocktails》(1922) — 巴黎 Harry's Bar 传奇
· Patrick Gavin Duffy《The Official Mixer's Manual》(1934)
· IBA (International Bartenders Association) Official Cocktail List — 国际调酒师协会官方认定 77 款
· Kindred Cocktails Database (kindredcocktails.com) — 历史配方考证数据库
· CocktailDB / The Cocktail DB — 开放配方数据库

【鸡尾酒与调酒 — 中文/繁体中文权威书籍】
· 《調酒師手冊》(台灣版) — 繁體中文調酒職業培訓標準教材
· 《世界雞尾酒大全》(台灣版) — 繁體中文最全面雞尾酒百科
· 《經典雞尾酒》方正出版 — 中文經典配方權威參考
· 《調酒學》林一峰著 (香港) — 香港調酒師協會推薦教材
· 《雞尾酒聖經》(台灣翻譯版) — 涵蓋 IBA 全系列配方
· 《調酒的科學》(台灣版) — 風味化學與調酒技術結合
· 《日本調酒師協會 (NBA) 調酒教本》(中文版) — 日式調酒技法標準
· 《调酒师手册》(中国轻工业出版社) — 大陆调酒职业培训标准教材
· 《鸡尾酒调制技术》(中国旅游出版社) — 大陆调酒教材
· 台灣調酒協會 (TBSA) 資料庫 — 台灣調酒考證與認證標準
· 香港調酒師協會 (HKBA) 資料庫 — 港式調酒傳承與創新記錄
· 澳門調酒師協會資料庫 — 澳門調酒傳承記錄

【威士忌 — 英文/中文/繁體書籍與資料】
· Jim Murray《Whisky Bible》(年度版，2004–) — 全球最具影響力威士忌評分指南
· Jim Murray《威士忌聖經》(中文版/繁體版) — 風味描述參考標準
· Michael Jackson《Malt Whisky Companion》(1989, 多版) — 蘇格蘭麥芽威士忌百科
· Michael Jackson《Complete Guide to Single Malt Scotch》(多版)
· Dave Broom《The World Atlas of Whisky》(2010, 2014修訂) — 全球威士忌產區地圖
· Dave Broom《Whisky: The Manual》(2014)
· Charles MacLean《Scotch Whisky: A Liquid History》(2003)
· Charles MacLean《MacLean's Miscellany of Whisky》(2004)
· Gavin D. Smith《The A-Z of Whisky》(1997)
· Ian Buxton《101 Whiskies to Try Before You Die》(多版)
· Fred Minnick《Bourbon: The Rise, Fall, and Rebirth of an American Whiskey》(2016)
· Fred Minnick《Whiskey Women》(2013)
· Chuck Cowdery《Bourbon, Straight》(2004)
· Clay Risen《American Whiskey, Bourbon & Rye》(2013)
· Lew Bryson《Tasting Whiskey》(2014)
· Dominic Roskrow《1000 Whiskies》(2012)
· Serge Valentin (Whiskyfun.com) — 蘇格蘭威士忌最大獨立評分數據庫
· Whisky Advocate (whiskyadvocate.com) — 美國最具影響力威士忌媒體
· Whisky Magazine (UK) — 英國威士忌專業雜誌
· Malt Maniacs / Malt Whisky Yearbook — 獨立評分與年度報告
· 《威士忌學》邱德夫著 (台灣) — 繁體中文最系統威士忌教科書
· 《威士忌品飲事典》(台灣翻譯版)
· 《蘇格蘭威士忌》(台灣版) — 產區風土詳解
· 《波本威士忌》(台灣版) — 美國威士忌全解析
· 《日本威士忌》(台灣版) — 日威風土與蒸餾廠介紹
· SWA (Scotch Whisky Association) 官方資料 — 蘇格蘭威士忌法規與產區定義
· TTB (Alcohol and Tobacco Tax and Trade Bureau) — 美國烈酒法規標準

【金酒 — 英文/中文/繁體書籍與資料】
· Geraldine Coates《The Mixellany Guide to Gin》(2009)
· Aaron Knoll《Gin: The Art and Craft of the Artisan Revival》(2015)
· Lesley Jacobs Solmonson《Gin: A Global History》(2012)
· David T. Smith《The Craft of Gin》(2015)
· Difford's Guide to Gin — 2000+ 金酒品牌數據庫
· WSET Spirits Level 3 — 金酒產區與工藝標準
· 《金酒全書》(台灣翻譯版) — 繁體中文金酒百科
· Gin Foundry (ginfoundry.com) — 全球金酒品牌資料庫
· The Gin Guild 官方資料 — 英國金酒行業協會

【朗姆酒 — 英文/中文/繁體書籍與資料】
· Dave Broom《Rum》(2003, 2016修訂) — 朗姆酒全球產區百科
· Ian Williams《Rum: A Social and Sociable History》(2005)
· Wayne Curtis《And a Bottle of Rum》(2006) — 朗姆酒歷史考證
· Luca Gargano / Velier 產品資料 — 牙買加/圭亞那朗姆酒權威
· Ministry of Rum (ministryofrum.com) — 全球朗姆酒數據庫
· The Floating Rum Shack — 獨立朗姆酒評分
· 《朗姆酒全書》(台灣翻譯版)
· AOC Rhum Agricole 法規 — 法國農業朗姆酒法定產區標準

【龍舌蘭與梅斯卡爾 — 英文/中文/繁體書籍與資料】
· Chantal Martineau《How the Gringos Stole Tequila》(2015)
· Tomas Estes《The Tequila Ambassador》(2012)
· Ian Chadwick《In Search of the Blue Agave》(在線資料庫)
· Mezcalistas (mezcalistas.com) — 梅斯卡爾獨立研究資料庫
· CRT (Consejo Regulador del Tequila) — 龍舌蘭法規與品牌認證
· COMERCAM — 梅斯卡爾法規與品牌認證
· 《龍舌蘭與梅斯卡爾》(台灣翻譯版)
· NOM 數據庫 — 墨西哥蒸餾廠官方編號系統

【白蘭地/干邑/雅文邑/卡爾瓦多斯 — 英文/中文/繁體書籍與資料】
· Nicholas Faith《Cognac》(1986, 多版) — 干邑歷史與產區權威
· Clive Coates《Cognac and Other Brandies》(1989)
· BNIC (Bureau National Interprofessionnel du Cognac) 官方資料 — 干邑法規與產區
· CIVB (Conseil Interprofessionnel du Vin de Bordeaux) 資料
· 《干邑白蘭地》(台灣翻譯版)
· 《白蘭地品飲事典》(台灣版)
· Armagnac Producers Association 官方資料

【伏特加 — 英文/中文/繁體書籍與資料】
· Ian Wisniewski《Vodka》(2003)
· Desmond Begg《The Vodka Companion》(1998)
· 《伏特加全書》(台灣翻譯版)
· CEEV (Comité Européen des Entreprises Vins) 資料

【葡萄酒/味美思/加強型葡萄酒 — 英文/中文/繁體書籍與資料】
· Jancis Robinson《The Oxford Companion to Wine》(1994, 多版) — 葡萄酒最權威百科全書
· Jancis Robinson《Wine Grapes》(2012) — 1368 個葡萄品種完整記錄
· Hugh Johnson & Jancis Robinson《The World Atlas of Wine》(多版) — 全球葡萄酒產區地圖
· Wine Spectator (winespecialist.com) — 全球最具影響力葡萄酒媒體
· Robert Parker《Wine Advocate》— 100 分制評分標準奠基
· Wine Enthusiast — 美國葡萄酒媒體
· Decanter Magazine — 英國葡萄酒媒體
· WSET Wine Level 1-4 官方教材 — 葡萄酒教育標準
· Court of Master Sommeliers 教材 — 侍酒師認證標準
· 《味美思》(Vermouth) Luca Pirola 著 — 味美思歷史與品牌全解析
· 《雪莉酒》Julian Jeffs《Sherry》(多版) — 雪莉酒最權威資料
· 《波特酒》Richard Mayson《Port and the Douro》(多版)
· 《葡萄酒品飲事典》(台灣翻譯版)
· 《葡萄酒全書》林裕森著 (台灣) — 繁體中文最系統葡萄酒教科書
· 《侍酒師的葡萄酒品飲》(台灣版)
· 《法國葡萄酒》《義大利葡萄酒》《西班牙葡萄酒》(台灣版系列)
· 中國葡萄酒資訊網 (winechina.com) — 大陸葡萄酒資料庫

【利口酒/苦精/開胃酒/阿瑪羅 — 英文/中文/繁體書籍與資料】
· Gary Regan《The Bartender's Gin Compendium》(2009)
· Brad Thomas Parsons《Bitters》(2011) — 苦精歷史與配方權威
· Brad Thomas Parsons《Amaro》(2016) — 阿瑪羅/義式苦味酒全解析
· Eric Seed / Haus Alpenz 產品資料 — 稀有利口酒進口商
· 《苦精聖經》(台灣翻譯版)
· 《利口酒全書》(台灣翻譯版)
· DISCUS (Distilled Spirits Council) 資料 — 美國烈酒行業協會

【清酒/燒酎/日本烈酒 — 英文/中文/繁體書籍與資料】
· John Gauntner《The Sake Handbook》(多版) — 清酒英文最權威入門
· John Gauntner《Sake Confidential》(2014)
· Philip Harper《The Insider's Guide to Sake》(1998)
· 《清酒的世界》(台灣翻譯版)
· 《日本酒入門》(台灣版) — 繁體中文清酒教材
· 《燒酎入門》(台灣版)
· SSI (Sake Service Institute) 官方教材 — 清酒服務研究白金教本
· JSA (Japan Sake and Shochu Makers Association) 官方資料
· 《梅酒大全》(台灣版)

【中式白酒/黃酒 — 中文/繁體書籍與資料】
· 《中國白酒香型與工藝》(中國輕工業出版社) — 六大香型標準教材
· 《白酒釀造技術》(中國輕工業出版社)
· 《中國名酒》(中國輕工業出版社)
· 《黃酒釀造》(中國輕工業出版社)
· GB/T 國家標準 — 中國白酒各香型國家標準（醬香/濃香/清香/米香/兼香/鳳香/芝麻香/老白乾香/特香/豉香）
· 中國食品工業協會白酒專業委員會資料
· 《台灣高粱酒》金門酒廠官方資料
· 《馬祖老酒》馬祖酒廠官方資料

【啤酒 — 英文/中文/繁體書籍與資料】
· Randy Mosher《Tasting Beer》(2009, 2017修訂) — 精釀啤酒品飲標準
· Michael Jackson《The World Guide to Beer》(1977) — 啤酒世界地圖奠基作
· Garrett Oliver《The Oxford Companion to Beer》(2011) — 啤酒最權威百科
· BJCP (Beer Judge Certification Program) Style Guidelines — 啤酒風格分類標準
· Brewers Association Style Guidelines — 美國精釀啤酒風格標準
· 《精釀啤酒聖經》(台灣翻譯版)
· 《啤酒品飲事典》(台灣版)

【調酒技術/風味科學 — 英文/中文/繁體書籍與資料】
· Dave Arnold《Liquid Intelligence》(2014) — 分子調酒/技術調酒聖經，澄清/碳酸化/旋轉蒸發
· Eben Klemm《The Cocktail Lab》(2012)
· Ryan Chetiyawardana (Mr Lyan)《Good Things to Drink》(2015)
· Cocktail Chemistry (YouTube/書籍) — 現代調酒技術科普
· 《調酒的科學》(台灣版) — 風味化學與調酒技術
· 《分子料理與調酒》(台灣翻譯版)

【學術論文與科學資料】
· Journal of Agricultural and Food Chemistry — 鸡尾酒/烈酒風味化合物分析
· Food Quality and Preference — 感官評價方法論
· Flavour journal (BioMed Central) — 風味感知跨學科研究
· Chemical Senses — 嗅覺/味覺神經科學
· Food Chemistry — 食品化學與風味分析
· Journal of the Institute of Brewing — 釀造科學
· American Journal of Enology and Viticulture — 葡萄酒科學
· Australian Journal of Grape and Wine Research — 葡萄酒研究
· Molecules (MDPI) — 天然化合物與風味
· 《食品科學》(中國) — 大陸食品科學核心期刊
· 《釀酒科技》(中國) — 大陸白酒/啤酒/葡萄酒科學核心期刊
· 《中國釀造》(中國) — 發酵與釀造科學

【行業認證與協會資料】
· WSET (Wine & Spirit Education Trust) Level 1-4 官方教材 — 全球最廣泛烈酒教育標準
· CMS (Court of Master Sommeliers) 教材
· SWA (Scotch Whisky Association) 法規資料
· DISCUS (Distilled Spirits Council of the United States) 資料
· IWSR (International Wine and Spirits Research) 報告 — 全球烈酒市場數據
· Drinks International — 全球烈酒行業媒體
· The Spirits Business — 英國烈酒行業媒體
· Whisky Magazine / Rum Magazine / Gin Magazine
· Tales of the Cocktail Foundation — 全球最大調酒師行業盛會資料
· Bar Convent Berlin (BCB) 行業資料
· 台灣菸酒股份有限公司官方資料 — 台灣在地烈酒品牌
· 金門酒廠/馬祖酒廠官方資料

用户会给出一个或多个酒、原料或产品的名称(可能含品牌、也可能附照片),请根据上述权威资料补全为结构化条目。

请输出 JSON:
{"items":[{
  "query":"原样返回用户给出的名称(附照片且无名称时填识别出的名称)",
  "found": true,
  "nameZh":"中文名(中国市场通用译名,如 君度橙酒)","nameEn":"英文名(品牌官方英文名,如 Cointreau)",
  "category":"必须从以下枚举精确选一:金酒/朗姆/伏特加/威士忌/龙舌兰/白兰地/利口酒/苦精/味美思/开胃酒/起泡酒/葡萄酒/清酒烧酒/中式白酒/糖浆/软饮/糖与甜味剂/果蔬/香料与草本/花卉/茶咖与可可/坚果与谷物/乳蛋/酸类与添加剂/其他",
  "style":"风格子分类(如 London Dry / Bourbon / Orange Liqueur),不确定填 \\"\\"",
  "brand":"品牌(如 Cointreau)","origin":"产地精确到国家/地区(如 苏格兰高地)","volume":"常见规格如 700ml","abv":40,"priceCny":170,
  "notes":"一句话简介:风味特征、常见用途、代表配方等(中文,50 字内)",
  "flavorTags":["草本","果味"] 从["草本","果味","柑橘","花香","甜润","酸爽","苦韵","辛香","烟熏","咸鲜","清爽","浓郁","坚果","奶油","干爽","热带","焦糖","咖啡","巧克力","泥煤","蜂蜜","香草"]中选2-4个,
  "story":"产品故事/介绍(中文,80字内,描述历史背景与风味特点),不确定填\\"\\"",
  "styleDesc":"风格特点详细描述(中文,50字内),不确定填\\"\\"",
  "distilleryInfo":"蒸馏厂/酒厂简介(基酒库专用,中文,60字内),其他类型填\\"\\"",
  "pairingNotes":"搭配建议(酒款库专用,中文,40字内),其他类型填\\"\\"",
  "usageNotes":"调酒用途说明(原材料库专用,中文,60字内),其他类型填\\"\\"",
  "seasonality":"季节性说明(原材料库专用,中文,20字内),其他类型填\\"\\"",
  "confidence":"high"|"medium"|"low"
}]}
规则:
- 每个名称对应一个条目,不得增删;完全无法识别的名称输出 {"query":"原名","found":false}
- 数值字段 abv/priceCny 输出数字:abv 未知填 0;priceCny 参考中国市场主流电商(京东/天猫)零售价给出合理估计,完全无从估计填 0
- nameZh 使用中国市场通用译名;nameEn 使用品牌官方英文名称
- 产地精确到国家/地区(如"苏格兰高地""墨西哥哈利斯科州")
- 未知字符串字段填 ""
- category 必须严格落在上述枚举中,选最贴切的一个;是自制/新鲜原料时也归入最接近的分类
- flavorTags 只能从给定列表中选,不能自造新标签
- 不要编造不存在的品牌;不确定品牌就留空但仍可给出通用品类资料
- confidence:资料把握程度(知名大牌 high,通用品类 medium,勉强猜测 low)`;

const enrichSchema = z.object({
  query: z.string().catch(""),
  found: z.boolean().catch(true),
  nameZh: z.string().catch(""),
  nameEn: z.string().catch(""),
  category: z.string().catch(""),
  style: z.string().catch(""),
  brand: z.string().catch(""),
  origin: z.string().catch(""),
  volume: z.string().catch(""),
  abv: z.number().catch(0),
  priceCny: z.number().catch(0),
  notes: z.string().catch(""),
  confidence: z.enum(["high", "medium", "low"]).catch("medium"),
});

export type EnrichedProduct = z.infer<typeof enrichSchema>;

/** 扩展 schema：包含深度字段（全字段补全） */
const enrichSchemaFull = enrichSchema.extend({
  flavorTags: z.array(z.string()).catch([]),
  story: z.string().catch(""),
  styleDesc: z.string().catch(""),
  distilleryInfo: z.string().catch(""),
  pairingNotes: z.string().catch(""),
  usageNotes: z.string().catch(""),
  seasonality: z.string().catch(""),
});
export type EnrichedProductFull = z.infer<typeof enrichSchemaFull>;

function parseJsonObjectLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  bulkImport: router({
    /** 智能提取:文本或文件(base64) → 结构化条目列表 */
    extract: publicProcedure
      .input(
        z.object({
          text: z.string().max(200_000).optional(),
          fileBase64: z.string().max(14_000_000).optional(),
          fileName: z.string().max(255).optional(),
          imageBase64: z.string().max(14_000_000).optional(),
          imageMime: z.string().max(64).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        if (input.imageBase64) {
          const mime = input.imageMime || "image/jpeg";
          const items = await llmExtract([
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${input.imageBase64}` },
            },
            {
              type: "text",
              text: "请识别这张照片中的中英文内容(可能是配方书页、酒瓶标签、价目表、手写笔记等),提取全部条目。",
            },
          ] as LLMContent);
          return { items };
        }
        if (input.fileBase64 && input.fileName) {
          const { text, pdfBase64 } = await extractFileText(input.fileBase64, input.fileName);
          if (pdfBase64) {
            const items = await llmExtract([
              {
                type: "file_url",
                file_url: {
                  url: `data:application/pdf;base64,${pdfBase64}`,
                  mime_type: "application/pdf",
                },
              },
              { type: "text", text: "请从这份 PDF 中提取条目。" },
            ] as LLMContent);
            return { items };
          }
          const content = (text ?? "").trim();
          if (!content) return { items: [] as BulkImportItem[] };
          return { items: await llmExtract(content.slice(0, 100_000)) };
        }
        const content = (input.text ?? "").trim();
        if (!content) return { items: [] as BulkImportItem[] };
        return { items: await llmExtract(content.slice(0, 100_000)) };
      }),
  }),

  bookImport: router({
    /** 扫描版/图片书:LLM 视觉 OCR → 纯文本(供客户端本地配方检测) */
    ocr: publicProcedure
      .input(
        z.object({
          pdfBase64: z.string().max(14_000_000).optional(),
          images: z
            .array(z.object({ base64: z.string().max(3_500_000), mime: z.string().max(64) }))
            .max(8)
            .optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const parts: MessageContent[] = [];
        if (input.pdfBase64) {
          parts.push({
            type: "file_url",
            file_url: {
              url: `data:application/pdf;base64,${input.pdfBase64}`,
              mime_type: "application/pdf",
            },
          });
        }
        for (const img of input.images ?? []) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${img.mime};base64,${img.base64}` },
          });
        }
        if (parts.length === 0) return { text: "" };
        parts.push({ type: "text", text: "请完整转写以上书页中的全部文字。" });
        return { text: await llmOcr(parts) };
      }),

    /** 配方候选批量翻译(用量单位保留原样) */
    translate: publicProcedure
      .input(
        z.object({
          target: z.enum(["zh", "en"]),
          items: z
            .array(
              z.object({
                id: z.string().max(64),
                name: z.string().max(200),
                ingredients: z
                  .array(z.object({ name: z.string().max(200), amount: z.string().max(64) }))
                  .max(40),
                steps: z.string().max(6000),
                garnish: z.string().max(500),
                glass: z.string().max(100),
                method: z.string().max(100),
              }),
            )
            .min(1)
            .max(20),
        }),
      )
      .mutation(async ({ input }) => {
        const signal = AbortSignal.timeout(45_000);
        let response;
        try {
          response = await invokeLLM({
            messages: [
              { role: "system", content: TRANSLATE_SYSTEM_PROMPT(input.target) },
              { role: "user", content: JSON.stringify({ items: input.items }) },
            ],
            response_format: { type: "json_object" },
            signal,
          });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new Error(isTimeout ? "翻译超时，请减少批次数量后重试" : `翻译失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const raw = response.choices[0]?.message?.content;
        const parsed = parseJsonObjectLoose(typeof raw === "string" ? raw : "");
        const arr = Array.isArray((parsed as { items?: unknown[] })?.items)
          ? (parsed as { items: unknown[] }).items
          : [];
        const items: TranslatedRecipeItem[] = [];
        for (const it of arr.slice(0, 20)) {
          const r = translatedItemSchema.safeParse(it);
          if (r.success && r.data.id) items.push(r.data);
        }
        return { items };
      }),
  }),

  lookup: router({
    /** 鸡尾酒风味/故事/来源联网补全:根据配方名称与配料自动推断 */
    enrichRecipe: publicProcedure
      .input(
        z.object({
          name: z.string().max(200),
          nameEn: z.string().max(200).optional(),
          baseSpirit: z.string().max(100).optional(),
          method: z.string().max(100).optional(),
          ingredients: z.array(z.string().max(200)).max(30).optional(),
          ingredientsWithAmounts: z.array(z.object({ name: z.string().max(200), amount: z.string().max(100) })).max(30).optional(),
          source: z.string().max(500).optional(),
          story: z.string().max(2000).optional(),
          flavorDesc: z.string().max(2000).optional(),
          existingSpirits: z.array(z.string().max(100)).max(50).optional(),
          existingGlasses: z.array(z.string().max(100)).max(50).optional(),
          /** 书库导入时的原始文字片段（用于 AI 推断创作者/年份） */
          rawText: z.string().max(2000).optional(),
          /** 书库导入时的书名（用于 AI 推断创作者/年份） */
          bookTitle: z.string().max(300).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        // ── 固定标签白名单（与客户端保持一致）──────────────────────────────
        const VALID_FLAVOR_TAGS = ["酸","甜","苦","烈","鲜","柑橘","热带","草本","花香","烟熏","木桶","香料","坚果可可","清爽","浓郁","干爽","复杂"];
        const VALID_DURATIONS   = ["短饮","长饮"];
        const VALID_OCCASIONS   = ["餐前酒","餐后酒","全天酒","佐餐酒","睡前酒","派对酒"];
        const VALID_METHODS     = ["摇和","搅拌","直调","分层","搅打"];
        const VALID_ICE         = ["标准方冰","大方冰","球冰","碎冰","长条冰","无冰"];
        const VALID_STRENGTHS   = ["清爽","适中","浓烈"];
        const CODEX_LIST        = ["古典 Old-Fashioned","马天尼 Martini","大吉利 Daiquiri","边车 Sidecar","高球 Highball","菲兹 Flip"];

        const spiritList = (input.existingSpirits ?? []).join("、") || "金酒、朗姆、伏特加、威士忌、龙舌兰、白兰地、梅斯卡尔、卡沙萨、皮斯科、利口酒、无酒精、其他";
        const glassList  = (input.existingGlasses ?? []).join("、") || "马天尼杯、古典杯、高球杯、柯林杯、库佩杯、飓风杯、子弹杯、尼克诺拉杯、郁金香杯、笛型杯、提基杯、铜杯、朱莉普杯、其他";
        const rawTextSection  = input.rawText   ? `\n原始文字片段（来自书籍，供推断创作者/年份参考）:\n${input.rawText.slice(0, 800)}`  : "";
        const bookTitleSection = input.bookTitle ? `\n书名: ${input.bookTitle}` : "";

        const ingredientLine = (input.ingredientsWithAmounts ?? []).length > 0
          ? `配料（含用量，用量最大的含酒精原料即为基酒）: ${(input.ingredientsWithAmounts ?? []).map(i => i.amount ? `${i.name} ${i.amount}` : i.name).join(", ")}`
          : (input.ingredients ?? []).length > 0
            ? `配料: ${(input.ingredients ?? []).join(", ")}`
            : "";

        const systemPrompt = `你是专业调酒知识专家兼鸡尾酒历史学家，精通中英文繁体中文调酒文献。根据配方信息进行全面深度分析，返回 JSON。

【权威知识库 — 请基于以下资料判断配方谱系与置信度】
【鸡尾酒/调酒 — 英文权威书籍与资料】
· Jerry Thomas《Bartender's Guide / How to Mix Drinks》(1862) — 最早鸡尾酒配方书，Old Tom Gin 时代基准
· Harry Johnson《Bartenders' Manual》(1882/1888) — Martini/Manhattan 早期文献记录
· Hugo Ensslin《Recipes for Mixed Drinks》(1916) — Aviation 首次记录，禁酒令前纽约最后一本配方书
· Harry Craddock《The Savoy Cocktail Book》(1930) — 禁酒令时代伦敦权威，750+ 配方
· David A. Embury《The Fine Art of Mixing Drinks》(1948) — 六大基础鸡尾酒分类理论奠基
· Trader Vic《Bartender's Guide》(1947) — Tiki 文化奠基，Mai Tai/Zombie 原始配方
· Mr. Boston Official Bartender's Guide (1935–现代版) — 美国最畅销调酒参考书
· Charles H. Baker Jr.《The Gentleman's Companion》(1939) — 世界旅行调酒笔记
· Harry MacElhone《ABC of Mixing Cocktails》(1922) — 巴黎 Harry's Bar 传奇
· Patrick Gavin Duffy《The Official Mixer's Manual》(1934)
· Gary Regan《The Joy of Mixology》(2003) — 家族分类法（New Sours/Old Sours/Duos/Trios）
· David Wondrich《Imbibe!》(2007, 2015修订) — 美国鸡尾酒历史权威考证，James Beard Award
· David Wondrich《Punch》(2010) — 潘趣酒历史与配方考证
· David Wondrich & Noah Rothbaum《The Oxford Companion to Spirits & Cocktails》(2021) — 最权威烈酒与鸡尾酒百科全书
· Death & Co《Cocktail Codex》(2018) — 六大母配方体系权威定义（Alex Day, Nick Fauchald, David Kaplan）
· Jim Meehan《The PDT Cocktail Book》(2011) — 纽约 PDT 酒吧经典配方
· Jim Meehan《Meehan's Bartender Manual》(2017) — 现代调酒全面参考
· Jeffrey Morgenthaler《The Bar Book》(2014) — 技术导向调酒参考，自制糖浆/浸渍权威
· Dale DeGroff《The Craft of the Cocktail》(2002) — Rainbow Room 传奇调酒师
· Dale DeGroff《The Essential Cocktail》(2008)
· Ted Haigh《Vintage Spirits and Forgotten Cocktails》(2009) — 复古配方复兴
· Angus Winchester & Simon Difford《Difford's Guide to Cocktails》(多版) — 3000+ 配方权威数据库
· Sasha Petraske《Regarding Cocktails》(2016) — Milk & Honey 极简主义
· Frank Caiafa《The Waldorf Astoria Bar Book》(2016) — 百年酒店调酒传承
· Dave Arnold《Liquid Intelligence》(2014) — 分子调酒/技术调酒圣经，澄清/碳酸化/旋转蒸发
· Robert Hess《The Essential Bartender's Guide》(2008)
· IBA (International Bartenders Association) Official Cocktail List — 国际调酒师协会官方认定 77 款
· Difford's Guide (diffordsguide.com) — 3000+ 配方在线权威数据库
· Kindred Cocktails Database (kindredcocktails.com) — 历史配方考证数据库
· CocktailDB / The Cocktail DB — 开放配方数据库
· Tales of the Cocktail Foundation — 全球最大调酒师行业盛会资料
· Bar Convent Berlin (BCB) 行业资料
现代创作参考（英文）：
· Death & Co New York (2006–) — Phil Ward/Brian Miller/Joaquín Simó 等
· Attaboy NYC (Sam Ross, Michael McIlroy) — Paper Plane/Penicillin 发源地
· The Aviary Chicago (Grant Achatz) — 分子调酒前沿
· Employees Only NYC — 经典复兴代表
· PDT/Please Don't Tell NYC — 隐秘酒吧文化
【鸡尾酒/调酒 — 简体中文权威书籍与资料】
· 《调酒师手册》(中国轻工业出版社) — 大陆调酒职业培训标准教材
· 《鸡尾酒调制技术》(中国旅游出版社) — 大陆调酒教材
· 《世界鸡尾酒》(上海文化出版社) — 大陆鸡尾酒百科
· 《调酒学》(高等教育出版社) — 大陆高校调酒专业教材
· 《经典鸡尾酒》方正出版 — 中文经典配方权威参考
· 《鸡尾酒圣经》(中文简体翻译版) — 涵盖 IBA 全系列配方
· 中国调酒师协会 (CBSA) 资料库 — 大陆调酒考证与认证标准
· 《调酒技艺》(人民邮电出版社) — 大陆调酒技术参考
· WSET 烈酒课程官方教材《烈酒品鉴》(简体中文版)
【鸡尾酒/调酒 — 繁体中文权威书籍与资料】
· 《調酒師手冊》(台灣版) — 繁體中文調酒職業培訓標準教材
· 《世界雞尾酒大全》(台灣版) — 繁體中文最全面雞尾酒百科
· 《調酒學》林一峰著 (香港) — 香港調酒師協會推薦教材
· 《雞尾酒聖經》(台灣翻譯版) — 涵蓋 IBA 全系列配方
· 《調酒的科學》(台灣版) — 風味化學與調酒技術結合
· 《日本調酒師協會 (NBA) 調酒教本》(中文版) — 日式調酒技法標準
· 台灣調酒協會 (TBSA) 資料庫 — 台灣調酒考證與認證標準
· 香港調酒師協會 (HKBA) 資料庫 — 港式調酒傳承與創新記錄
· 澳門調酒師協會資料庫
· WSET 烈酒課程官方教材《烈酒品鑑》(繁體中文版)
【葡萄酒/味美思/加强型葡萄酒 — 英文权威书籍与资料】
· Jancis Robinson《The Oxford Companion to Wine》(1994, 多版) — 葡萄酒最权威百科全书
· Jancis Robinson《Wine Grapes》(2012) — 1368 个葡萄品种完整记录
· Hugh Johnson & Jancis Robinson《The World Atlas of Wine》(多版) — 全球葡萄酒产区地图
· Jancis Robinson《How to Taste》(2000) — 葡萄酒品鉴方法论
· Wine Spectator (winespecialist.com) — 全球最具影响力葡萄酒媒体，100分制
· Robert Parker《Wine Advocate》— 100 分制评分标准奠基
· Wine Enthusiast — 美国葡萄酒媒体
· Decanter Magazine — 英国葡萄酒媒体，年度大赛权威
· WSET Wine Level 1-4 官方教材 — 葡萄酒教育标准
· Court of Master Sommeliers 教材 — 侍酒师认证标准
· Luca Pirola《Vermouth》— 味美思历史与品牌全解析
· Julian Jeffs《Sherry》(多版) — 雪莉酒最权威资料
· Richard Mayson《Port and the Douro》(多版) — 波特酒权威
· Nicolas Faith《Cognac》(1986, 多版)
· Tom Stevenson《World Encyclopedia of Champagne & Sparkling Wine》
· Oz Clarke《Pocket Wine Book》(年度版)
· Michael Broadbent《Wine Tasting》(多版)
· Emile Peynaud《The Taste of Wine》
· Alexis Lichine《Alexis Lichine's New Encyclopedia of Wines & Spirits》
【葡萄酒/味美思/加强型葡萄酒 — 简体中文权威书籍与资料】
· 《葡萄酒品鉴》(中国轻工业出版社) — 大陆葡萄酒教材
· 《世界葡萄酒地图》(中文简体版) — Hugh Johnson & Jancis Robinson 中文版
· 《葡萄酒鉴赏手册》(上海科学技术出版社)
· 《认识葡萄酒》(中国农业出版社) — WSET 认证配套教材
· WSET 葡萄酒教材《葡萄酒品鉴》(简体中文版)
· 《侍酒师葡萄酒品鉴》(简体中文版)
· 中国葡萄酒信息网 (winechina.com) — 大陆葡萄酒资料库
· 《中国葡萄酒》(中国农业出版社) — 大陆产区与品种
· 《雪莉酒》(简体中文翻译版)
· 《波特酒》(简体中文翻译版)
· 《味美思》(简体中文翻译版)
【葡萄酒/味美思/加强型葡萄酒 — 繁体中文权威书籍与资料】
· 《葡萄酒全書》林裕森著 (台灣) — 繁體中文最系統葡萄酒教科書
· 《葡萄酒品飲事典》(台灣版)
· 《侍酒師的葡萄酒品飲》(台灣版)
· 《法國葡萄酒》《義大利葡萄酒》《西班牙葡萄酒》《新世界葡萄酒》(台灣版系列)
· 《世界葡萄酒地圖》(繁體中文版) — Hugh Johnson & Jancis Robinson 繁體版
· 《雪莉酒》(繁體中文翻譯版)
· 《波特酒》(繁體中文翻譯版)
· 《香檳》(繁體中文翻譯版)
· 《味美思》(繁體中文翻譯版)
· WSET 葡萄酒教材《葡萄酒品鑑》(繁體中文版)
· 台灣侍酒師協會 (TSA) 資料庫
【利口酒/苦精/阿玛罗/开胃酒 — 英文权威书籍与资料】
· Brad Thomas Parsons《Bitters》(2011) — 苦精历史与配方权威，James Beard Award
· Brad Thomas Parsons《Amaro》(2016) — 阿玛罗/意式苦味酒全解析
· Gary Regan《The Bartender's Gin Compendium》(2009)
· Eric Seed / Haus Alpenz 产品资料 — 稀有利口酒进口商
· Difford's Guide to Liqueurs & Fortified Wines — 利口酒与加强型葡萄酒数据库
· DISCUS (Distilled Spirits Council) 资料 — 美国烈酒行业协会
· The Bitter Truth 产品资料 — 现代苦精品牌
· Angostura 官方资料 — 全球最畅销苦精历史
· Peychaud's Bitters 官方资料 — 新奥尔良苦精历史
· Campari Group 官方资料 — Campari/Aperol/Cinzano/Grand Marnier 等
· Martini & Rossi 官方资料 — 味美思品牌历史
· Noilly Prat 官方资料 — 法式味美思权威
· Dolin 官方资料 — 萨瓦味美思
· Cocchi 官方资料 — 意式味美思/阿玛罗
【利口酒/苦精/阿玛罗/开胃酒 — 简体中文权威书籍与资料】
· 《苦精圣经》(简体中文翻译版)
· 《利口酒全书》(简体中文翻译版)
· 《阿玛罗》(简体中文翻译版)
· 《开胃酒指南》(简体中文版)
· 中国酒业协会利口酒分会资料
【利口酒/苦精/阿玛罗/开胃酒 — 繁体中文权威书籍与资料】
· 《苦精聖經》(繁體中文翻譯版)
· 《利口酒全書》(繁體中文翻譯版)
· 《阿瑪羅》(繁體中文翻譯版)
· 《開胃酒指南》(繁體中文版)
【烈酒品种大全 — 英文权威书籍与资料（威士忌）】
· Jim Murray《Whisky Bible》(年度版，2004–) — 全球最具影响力威士忌评分指南
· Michael Jackson《Malt Whisky Companion》(1989, 多版) — 苏格兰麦芽威士忌百科
· Michael Jackson《Complete Guide to Single Malt Scotch》(多版)
· Dave Broom《The World Atlas of Whisky》(2010, 2014修订) — 全球威士忌产区地图
· Dave Broom《Whisky: The Manual》(2014)
· Charles MacLean《Scotch Whisky: A Liquid History》(2003)
· Gavin D. Smith《The A-Z of Whisky》(1997)
· Ian Buxton《101 Whiskies to Try Before You Die》(多版)
· Fred Minnick《Bourbon: The Rise, Fall, and Rebirth of an American Whiskey》(2016)
· Fred Minnick《Whiskey Women》(2013)
· Chuck Cowdery《Bourbon, Straight》(2004)
· Clay Risen《American Whiskey, Bourbon & Rye》(2013)
· Lew Bryson《Tasting Whiskey》(2014)
· Dominic Roskrow《1000 Whiskies》(2012)
· Serge Valentin (Whiskyfun.com) — 苏格兰威士忌最大独立评分数据库
· Whisky Advocate (whiskyadvocate.com) — 美国最具影响力威士忌媒体
· Whisky Magazine (UK) — 英国威士忌专业杂志
· Malt Maniacs / Malt Whisky Yearbook — 独立评分与年度报告
· SWA (Scotch Whisky Association) 官方资料 — 苏格兰威士忌法规与产区定义
· TTB (Alcohol and Tobacco Tax and Trade Bureau) — 美国烈酒法规标准
【烈酒品种大全 — 简体中文权威书籍与资料（威士忌）】
· 《威士忌圣经》Jim Murray (简体中文版) — 风味描述参考标准
· 《威士忌学》(简体中文版) — 系统威士忌知识
· 《苏格兰威士忌》(简体中文版) — 产区风土详解
· 《波本威士忌》(简体中文版) — 美国威士忌全解析
· 《日本威士忌》(简体中文版) — 日威风土与蒸馏厂介绍
· 《威士忌品鉴手册》(中国轻工业出版社)
· 《单一麦芽威士忌》(简体中文版)
· 中国酒业协会威士忌分会资料
· 《烈酒品鉴》WSET Level 3 教材 (简体中文版)
【烈酒品种大全 — 繁体中文权威书籍与资料（威士忌）】
· 《威士忌學》邱德夫著 (台灣) — 繁體中文最系統威士忌教科書
· 《威士忌聖經》Jim Murray (繁體中文版)
· 《蘇格蘭威士忌》(台灣版) — 產區風土詳解
· 《波本威士忌》(台灣版) — 美國威士忌全解析
· 《日本威士忌》(台灣版) — 日威風土與蒸餾廠介紹
· 《威士忌品飲事典》(台灣版)
· 《單一麥芽威士忌》(台灣版)
· 台灣威士忌協會資料庫
【烈酒品种大全 — 英文权威书籍与资料（金酒/朗姆/龙舌兰/白兰地/伏特加）】
· Aaron Knoll《Gin: The Art and Craft of the Artisan Revival》(2015) — 金酒品牌与工艺
· Lesley Jacobs Solmonson《Gin: A Global History》(2012)
· Geraldine Coates《The Mixellany Guide to Gin》(2009)
· Gin Foundry (ginfoundry.com) — 全球金酒品牌资料库
· The Gin Guild 官方资料 — 英国金酒行业协会
· Dave Broom《Rum》(2003, 2016修订) — 朗姆酒全球产区百科
· Wayne Curtis《And a Bottle of Rum》(2006) — 朗姆酒历史考证
· Ministry of Rum (ministryofrum.com) — 全球朗姆酒数据库
· Chantal Martineau《How the Gringos Stole Tequila》(2015)
· Tomas Estes《The Tequila Ambassador》(2012)
· Ian Chadwick《In Search of the Blue Agave》— 龙舌兰在线资料库
· Mezcalistas (mezcalistas.com) — 梅斯卡尔独立研究资料库
· CRT (Consejo Regulador del Tequila) — 龙舌兰法规与品牌认证
· COMERCAM — 梅斯卡尔法规与品牌认证
· NOM 数据库 — 墨西哥蒸馏厂官方编号系统
· Nicholas Faith《Cognac》(1986, 多版) — 干邑历史与产区权威
· BNIC (Bureau National Interprofessionnel du Cognac) 官方资料
· Ian Wisniewski《Vodka》(2003)
· Desmond Begg《The Vodka Companion》(1998)
· Dave Broom《The World Atlas of Spirits》
【烈酒品种大全 — 简体中文权威书籍与资料（金酒/朗姆/龙舌兰/白兰地/伏特加）】
· 《金酒全书》(简体中文翻译版)
· 《朗姆酒全书》(简体中文翻译版)
· 《龙舌兰与梅斯卡尔》(简体中文翻译版)
· 《干邑白兰地》(简体中文翻译版)
· 《白兰地品鉴手册》(简体中文版)
· 《伏特加全书》(简体中文翻译版)
· 《烈酒品鉴》WSET Level 3 教材 (简体中文版)
· 中国酒业协会各烈酒分会资料
【烈酒品种大全 — 繁体中文权威书籍与资料（金酒/朗姆/龙舌兰/白兰地/伏特加）】
· 《金酒全書》(繁體中文翻譯版)
· 《朗姆酒全書》(繁體中文翻譯版)
· 《龍舌蘭與梅斯卡爾》(繁體中文翻譯版)
· 《干邑白蘭地》(繁體中文翻譯版)
· 《白蘭地品飲事典》(台灣版)
· 《伏特加全書》(繁體中文翻譯版)
· 《烈酒品鑑》WSET Level 3 教材 (繁體中文版)
【清酒/烧酎/日本烈酒 — 英文/简体/繁体权威书籍与资料】
· John Gauntner《The Sake Handbook》(多版) — 清酒英文最权威入门
· John Gauntner《Sake Confidential》(2014)
· Philip Harper《The Insider's Guide to Sake》(1998)
· SSI (Sake Service Institute) 官方教材 — 清酒服务研究白金教本
· JSA (Japan Sake and Shochu Makers Association) 官方资料
· 《清酒入门》(简体中文翻译版)
· 《日本酒全书》(简体中文翻译版)
· 《烧酎入门》(简体中文翻译版)
· 《清酒的世界》(繁體中文翻譯版)
· 《日本酒入門》(台灣版) — 繁體中文清酒教材
· 《燒酎入門》(台灣版)
· 《梅酒大全》(台灣版)
【中式白酒/黄酒 — 简体中文/繁体中文权威书籍与资料】
· 《中国白酒香型与工艺》(中国轻工业出版社) — 六大香型标准教材
· 《白酒酿造技术》(中国轻工业出版社)
· 《中国名酒》(中国轻工业出版社)
· 《黄酒酿造》(中国轻工业出版社)
· GB/T 国家标准 — 中国白酒各香型国家标准（酱香/浓香/清香/米香/兼香/凤香/芝麻香/老白干香/特香/豉香）
· 中国食品工业协会白酒专业委员会资料
· 《釀酒科技》期刊(中国) — 大陆白酒/啤酒/葡萄酒科学核心期刊
· 《台湾高粱酒》金门酒厂官方资料
· 《台灣高粱酒》金門酒廠官方資料 (繁體)
· 《馬祖老酒》馬祖酒廠官方資料 (繁體)
【原材料 — 英文权威书籍与资料】
· Jeffrey Morgenthaler《The Bar Book》(2014) — 自制糖浆/浸渍/酸类权威
· Dave Arnold《Liquid Intelligence》(2014) — 原材料科学处理权威
· Eben Klemm《The Cocktail Lab》(2012) — 风味萃取实验
· Harold McGee《On Food and Cooking》(2004) — 食材科学圣经
· Harold McGee《Nose Dive: A Field Guide to the World's Smells》(2020) — 香气化合物百科
· Gary Regan《The Joy of Mixology》(2003) — 原材料分类与用途
· Cocktail Chemistry — 现代调酒原材料科普
· The Flavor Bible (Karen Page & Andrew Dornenburg) — 食材风味搭配圣经
· Difford's Guide — 原材料与糖浆数据库
【原材料 — 简体中文权威书籍与资料】
· 《调酒原材料手册》(中国旅游出版社)
· 《调酒的科学》(简体中文版) — 风味化学与调酒技术
· 《食材风味搭配手册》(简体中文翻译版)
· 《香料与草本植物百科》(简体中文版)
· 《柑橘类水果全书》(简体中文版)
· 《糖与甜味剂》(中国轻工业出版社)
· 《茶叶品鉴》(中国农业出版社)
· 《咖啡品鉴》(简体中文版)
【原材料 — 繁体中文权威书籍与资料】
· 《調酒的科學》(台灣版) — 風味化學與調酒技術
· 《食材風味搭配手冊》(繁體中文翻譯版)
· 《香料與草本植物百科》(繁體中文版)
· 《柑橘類水果全書》(繁體中文版)
· 《糖與甜味劑》(繁體中文版)
· 《茶葉品鑑》(台灣版)
· 《咖啡品鑑》(台灣版)
【学术论文与科学资料（三语通用）】
· Journal of Agricultural and Food Chemistry — 鸡尾酒/烈酒风味化合物分析
· Food Quality and Preference — 感官评价方法论
· Flavour journal (BioMed Central) — 风味感知跨学科研究
· Chemical Senses — 嗅觉/味觉神经科学
· Food Chemistry — 食品化学与风味分析
· Journal of the Institute of Brewing — 酿造科学
· American Journal of Enology and Viticulture — 葡萄酒科学
· Australian Journal of Grape and Wine Research — 葡萄酒研究
· Molecules (MDPI) — 天然化合物与风味
· 《食品科学》(中国) — 大陆食品科学核心期刊
· 《酿酒科技》(中国) — 大陆白酒/啤酒/葡萄酒科学核心期刊
· 《中国酿造》(中国) — 发酵与酿造科学

【variantOf 置信度规则】
- high：在上述权威资料中有明确记载的经典/变体关系
- medium：业界公认但无单一权威来源
- low：推断，不确定

【风味描述格式】必须严格三行，不得增减：
第一行：核心基调：[2-3个核心风味词]
第二行：风味演变：[前段] ➔ [中段] ➔ [后段余韵]
第三行：整体质感：[2-3个酒体结构质感词]

【引用来源识别规则】
- 书籍格式：书名 + 年份，如 "The Savoy Cocktail Book, 1930"
- IBA 官方：如 "IBA Official Cocktail"
- 破折号署名：如原文含 "— Harry McElhone" 则 creator="Harry McElhone"，source="ABC of Mixing Cocktails"
- 创作者≠书的作者（书作者只是记录者）

【重要】所有标签字段必须使用中文，不得使用英文单词。`;

        const userPrompt = `请分析以下鸡尾酒配方，返回完整 JSON：

配方名称: ${input.name}${input.nameEn ? ` (${input.nameEn})` : ""}
${input.baseSpirit ? `基酒: ${input.baseSpirit}` : ""}
${input.method ? `调制方式: ${input.method}` : ""}
${ingredientLine}${rawTextSection}${bookTitleSection}

可选基酒列表（只能从此列表选）: ${spiritList}
可选杯型列表（只能从此列表选）: ${glassList}

请输出以下 JSON（不确定的字段返回空字符串 ""）:
{
  "flavors": ["酸","甜"] // 从 ${JSON.stringify(VALID_FLAVOR_TAGS)} 中选2-5个，只能选列表中的值,
  "flavorConfidence": "high"|"medium"|"low",
  "story": "${input.story ? "(已有内容，如有更好信息可补充，否则返回\"\")" : "历史来历与创作故事（中文，100字内）"}",
  "flavorDesc": "${input.flavorDesc ? "(已有内容，如有更好信息可补充，否则返回\"\")" : "严格三行格式：\\n核心基调：...\\n风味演变：... ➔ ... ➔ ...\\n整体质感：..."}",
  "source": "${input.source ? "(已有内容，不要修改，返回\"\")" : "引用来源（书名/IBA/调酒师名等）"}",
  "confidence": "high"|"medium"|"low",
  "suggestedBaseSpirit": "${input.baseSpirit ? "(已有基酒，返回\"\")" : "从可选基酒列表中选，若两种等量用逗号分隔如：威士忌,白兰地"}",
  "suggestedBaseSpiritConfidence": "high"|"medium"|"low",
  "suggestedGlass": "从可选杯型列表中选",
  "suggestedGlassConfidence": "high"|"medium"|"low",
  "suggestedIce": "从 ${JSON.stringify(VALID_ICE)} 中选一个",
  "suggestedIceConfidence": "high"|"medium"|"low",
  "suggestedMethod": "从 ${JSON.stringify(VALID_METHODS)} 中选一个",
  "suggestedStrength": "从 ${JSON.stringify(VALID_STRENGTHS)} 中选一个",
  "suggestedDrinkDuration": "从 ${JSON.stringify(VALID_DURATIONS)} 中选一个。判断规则：含苏打水/汤力水/姜汁啤酒/果汁大量=长饮；纯烈酒+利口酒少量=短饮",
  "suggestedDurationConfidence": "high"|"medium"|"low",
  "suggestedOccasion": "从 ${JSON.stringify(VALID_OCCASIONS)} 中选一个。判断规则：含苦味开胃酒/金巴利/阿佩罗=餐前酒；含奶油/咖啡/巧克力=餐后酒；无酒精=全天酒；高ABV烈性=睡前酒；热带/派对风格=派对酒；其他=全天酒",
  "suggestedOccasionConfidence": "high"|"medium"|"low",
  "suggestedCodexFamily": "从 ${JSON.stringify(CODEX_LIST)} 中选一个，不确定返回\"\"",
  "suggestedVariantOf": "【必填，三选一，禁止留空】：'CLASSIC_ORIGINAL'（本配方本身就是经典原版，如 Negroni/Daiquiri/Old Fashioned 本身）| '[母配方名]'（本配方是某经典的变体，如 '尼格罗尼 Negroni'）| 'MODERN_ORIGINAL'（现代创作或无法确认经典来源）",
  "variantOfDetail": "展开内容（150-250字中文，必须信息丰富）：CLASSIC_ORIGINAL→历史背景（年代/地点/创作者）+首次文献记载来源+配方演变脉络+在鸡尾酒史上的地位；[母配方名]→母配方简介（起源/年代）+本配方与母配方的具体差异（改了哪些原料/比例/技法/风格）+变体创作背景；MODERN_ORIGINAL→【必须包含所有已知信息】创作者全名+创作年份+创作地点/酒吧名+创作背景故事+配方设计理念+在当代调酒界的影响力（如：Penicillin由Sam Ross于2005年在纽约Milk & Honey创作，以调和苏格兰威士忌为基底，用姜汁蜂蜜糖浆平衡泥煤烟熏，成为21世纪最具代表性的现代经典之一）。完全不详则写'现代创作，创作背景暂无可靠文献记载'",
  "variantOfConfidence": "high（权威资料明确记载）| medium（业界公认但无单一权威来源）| low（推断）",
  "creator": "配方创作者姓名（调酒师/酒吧名），注意：创作者≠书的作者",
  "creatorConfidence": "high"|"medium"|"low",
  "createdYear": "创作年份或年代（如 '1930' / 'circa 1920s'）",
  "createdYearConfidence": "high"|"medium"|"low"
}`;

        // 35s timeout（claude-sonnet 需要更长时间）
        const signal = AbortSignal.timeout(35_000);
        let response;
        try {
          response = await invokeLLM({
            model: "claude-sonnet",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            maxTokens: 1200,
            response_format: { type: "json_object" },
            signal,
          });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new Error(isTimeout ? "AI 分析超时，请稍后重试" : `AI 分析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const raw = typeof response === "string" ? response : (response as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? "";
        const parsed = parseJsonObjectLoose(typeof raw === "string" ? raw : "");
        const p = parsed as Record<string, unknown>;

        const validConf = (v: unknown): "high" | "medium" | "low" =>
          (["high", "medium", "low"] as const).includes(v as "high") ? v as "high" | "medium" | "low" : "medium";

        // ── 严格白名单过滤 ──────────────────────────────────────────────────
        const rawFlavors = Array.isArray(p.flavors) ? (p.flavors as string[]) : [];
        const validFlavors = rawFlavors.filter((f) => VALID_FLAVOR_TAGS.includes(f)).slice(0, 6);

        const rawDuration = typeof p.suggestedDrinkDuration === "string" ? p.suggestedDrinkDuration.trim() : "";
        const validDuration = VALID_DURATIONS.includes(rawDuration) ? rawDuration : "";

        const rawOccasion = typeof p.suggestedOccasion === "string" ? p.suggestedOccasion.trim() : "";
        const validOccasion = VALID_OCCASIONS.includes(rawOccasion) ? rawOccasion : "";

        const rawMethod = typeof p.suggestedMethod === "string" ? p.suggestedMethod.trim() : "";
        const validMethod = VALID_METHODS.includes(rawMethod) ? rawMethod : "";

        const rawStrength = typeof p.suggestedStrength === "string" ? p.suggestedStrength.trim() : "";
        const validStrength = VALID_STRENGTHS.includes(rawStrength) ? rawStrength : "";

        const rawIce = typeof p.suggestedIce === "string" ? p.suggestedIce.trim() : "";
        const validIce = VALID_ICE.includes(rawIce) ? rawIce : "";

        const rawCodex = typeof p.suggestedCodexFamily === "string" ? p.suggestedCodexFamily.trim() : "";
        const validCodex = CODEX_LIST.find(c => c === rawCodex || c.startsWith(rawCodex) || rawCodex.includes(c.split(" ")[0])) ?? "";

        // ── flavorDesc 三行格式校验 ──────────────────────────────────────────
        const rawFlavorDesc = typeof p.flavorDesc === "string" ? p.flavorDesc.trim() : "";
        const flavorDescLines = rawFlavorDesc.split("\n").filter(l => l.trim());
        const isValidFlavorDesc = flavorDescLines.length === 3
          && flavorDescLines[0].includes("核心基调")
          && flavorDescLines[1].includes("➔")
          && flavorDescLines[2].includes("整体质感");
        const validFlavorDesc = isValidFlavorDesc ? rawFlavorDesc : "";

        return {
          flavors: validFlavors,
          flavorConfidence: validConf(p.flavorConfidence),
          story: typeof p.story === "string" ? p.story.trim() : "",
          flavorDesc: validFlavorDesc,
          source: typeof p.source === "string" ? p.source.trim() : "",
          confidence: validConf(p.confidence),
          suggestedBaseSpirit: typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",
          isMultiBaseSpirit: typeof p.suggestedBaseSpirit === "string" && p.suggestedBaseSpirit.includes(","),
          suggestedBaseSpiritConfidence: validConf(p.suggestedBaseSpiritConfidence),
          suggestedGlass: resolveToZhWhitelistServer(
            typeof p.suggestedGlass === "string" ? p.suggestedGlass.trim() : "",
            SERVER_VALID_GLASSES,
          ),
          suggestedGlassConfidence: validConf(p.suggestedGlassConfidence),
          suggestedIce: validIce,
          suggestedIceConfidence: validConf(p.suggestedIceConfidence),
          suggestedMethod: validMethod,
          suggestedStrength: validStrength,
          // ── 新增：饮用时长 / 场合（严格白名单） ──
          suggestedDrinkDuration: validDuration,
          suggestedDurationConfidence: validConf(p.suggestedDurationConfidence),
          suggestedOccasion: validOccasion,
          suggestedOccasionConfidence: validConf(p.suggestedOccasionConfidence),
          // ── 新增：Codex 家族 / 变体来源 ──
          suggestedCodexFamily: validCodex,
          suggestedVariantOf: typeof p.suggestedVariantOf === "string" && p.suggestedVariantOf.trim() ? p.suggestedVariantOf.trim() : "MODERN_ORIGINAL",
          variantOfDetail: typeof p.variantOfDetail === "string" ? p.variantOfDetail.trim() : "",
          variantOfConfidence: validConf(p.variantOfConfidence),
          // ── 创作者信息 ──
          creator: typeof p.creator === "string" ? p.creator.trim() : "",
          creatorConfidence: validConf(p.creatorConfidence),
          createdYear: typeof p.createdYear === "string" ? p.createdYear.trim() : "",
          createdYearConfidence: validConf(p.createdYearConfidence),
          // 标记为全字段深度分析（供 recipe-form 判断是否应用所有字段）
          isDeepAnalysis: true,
        };
      }),


    /** 深度解析配方：联网搜索 + 强模型 + 全字段补全（分类/基酒/Codex/变体/风味/制作/烈度/冰块/风味描述/引用来源/故事） */
    deepAnalyzeRecipe: publicProcedure
      .input(
        z.object({
          name: z.string().max(200).optional(),
          nameEn: z.string().optional(),
          ingredients: z.string().optional(), // comma-separated ingredient names
          baseSpirit: z.string().optional(),
          source: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { name, nameEn, ingredients, baseSpirit, source } = input;
        const recipeName = (name ?? "") || (nameEn ?? "") || "";
        if (!recipeName) return { confidence: "low" as const };

        // Build a rich prompt with all available context
        const contextParts: string[] = [];
        if (name) contextParts.push(`中文名: ${name}`);
        if (nameEn) contextParts.push(`英文名: ${nameEn}`);
        if (ingredients) contextParts.push(`配料: ${ingredients}`);
        if (baseSpirit) contextParts.push(`基酒: ${baseSpirit}`);
        if (source) contextParts.push(`来源: ${source}`);
        const context = contextParts.join("\n");

        const systemPrompt = `你是一位专业调酒师和鸡尾酒历史学家，精通中英文繁体中文调酒文献。请根据提供的配方信息，进行全面深度分析，返回 JSON 格式结果。

【权威知识库 — 鸡尾酒/调酒 英文】Jerry Thomas《Bartender's Guide》(1862) · Hugo Ensslin《Recipes for Mixed Drinks》(1916) · Harry Craddock《The Savoy Cocktail Book》(1930) · David A. Embury《The Fine Art of Mixing Drinks》(1948) · Trader Vic《Bartender's Guide》(1947) · Harry MacElhone《ABC of Mixing Cocktails》(1922) · Charles H. Baker Jr.《The Gentleman's Companion》(1939) · Gary Regan《The Joy of Mixology》(2003) · David Wondrich《Imbibe!》(2007, 2015修订) · David Wondrich《Punch》(2010) · David Wondrich & Noah Rothbaum《The Oxford Companion to Spirits & Cocktails》(2021) · Death & Co《Cocktail Codex》(2018) · Jim Meehan《The PDT Cocktail Book》(2011) · Jim Meehan《Meehan's Bartender Manual》(2017) · Jeffrey Morgenthaler《The Bar Book》(2014) · Dale DeGroff《The Craft of the Cocktail》(2002) · Ted Haigh《Vintage Spirits and Forgotten Cocktails》(2009) · Dave Arnold《Liquid Intelligence》(2014) · Sasha Petraske《Regarding Cocktails》(2016) · Frank Caiafa《The Waldorf Astoria Bar Book》(2016) · IBA Official Cocktail List · Difford's Guide · Kindred Cocktails Database · Tales of the Cocktail Foundation
【权威知识库 — 鸡尾酒/调酒 简体中文】《调酒师手册》(中国轻工业出版社) · 《鸡尾酒调制技术》(中国旅游出版社) · 《调酒学》(高等教育出版社) · 《经典鸡尾酒》方正出版 · 《鸡尾酒圣经》(简体翻译版) · 中国调酒师协会(CBSA)资料库 · WSET《烈酒品鉴》(简体中文版)
【权威知识库 — 鸡尾酒/调酒 繁体中文】《調酒師手冊》(台灣版) · 《世界雞尾酒大全》(台灣版) · 《調酒學》林一峰著(香港) · 《雞尾酒聖經》(台灣翻譯版) · 《調酒的科學》(台灣版) · 台灣調酒協會(TBSA)資料庫 · 香港調酒師協會(HKBA)資料庫 · WSET《烈酒品鑑》(繁體中文版)
【权威知识库 — 葡萄酒/味美思/利口酒/苦精 英文】Jancis Robinson《The Oxford Companion to Wine》(多版) · Jancis Robinson《Wine Grapes》(2012) · Hugh Johnson & Jancis Robinson《The World Atlas of Wine》(多版) · Wine Spectator · Robert Parker《Wine Advocate》· Decanter Magazine · WSET Wine Level 1-4 · Court of Master Sommeliers · Luca Pirola《Vermouth》· Julian Jeffs《Sherry》(多版) · Richard Mayson《Port and the Douro》(多版) · Brad Thomas Parsons《Bitters》(2011) · Brad Thomas Parsons《Amaro》(2016) · Campari/Aperol/Martini & Rossi/Noilly Prat/Dolin/Cocchi 官方资料
【权威知识库 — 葡萄酒/味美思/利口酒/苦精 简体中文】《葡萄酒品鉴》(中国轻工业出版社) · 《世界葡萄酒地图》(简体中文版) · WSET葡萄酒教材(简体中文版) · 《苦精圣经》(简体翻译版) · 《利口酒全书》(简体翻译版) · 《阿玛罗》(简体翻译版) · 中国葡萄酒信息网(winechina.com)
【权威知识库 — 葡萄酒/味美思/利口酒/苦精 繁体中文】《葡萄酒全書》林裕森著(台灣) · 《葡萄酒品飲事典》(台灣版) · 《侍酒師的葡萄酒品飲》(台灣版) · 《世界葡萄酒地圖》(繁體中文版) · 《雪莉酒》《波特酒》《香檳》《味美思》(繁體翻譯版) · 《苦精聖經》《利口酒全書》《阿瑪羅》(繁體翻譯版) · 台灣侍酒師協會(TSA)資料庫
【权威知识库 — 烈酒品种大全 英文】Jim Murray《Whisky Bible》(年度版) · Michael Jackson《Malt Whisky Companion》(多版) · Dave Broom《The World Atlas of Whisky》(2014) · Fred Minnick《Bourbon》(2016) · Aaron Knoll《Gin: The Art and Craft of the Artisan Revival》(2015) · Dave Broom《Rum》(2016) · Wayne Curtis《And a Bottle of Rum》(2006) · Chantal Martineau《How the Gringos Stole Tequila》(2015) · Nicholas Faith《Cognac》(多版) · John Gauntner《The Sake Handbook》(多版) · Garrett Oliver《The Oxford Companion to Beer》(2011) · Whisky Advocate · Whisky Magazine · SWA/TTB/CRT/COMERCAM 法规资料 · Gin Foundry · Ministry of Rum · Mezcalistas · Serge Valentin (Whiskyfun.com)
【权威知识库 — 烈酒品种大全 简体中文】《威士忌圣经》Jim Murray(简体版) · 《威士忌学》(简体版) · 《苏格兰威士忌》《波本威士忌》《日本威士忌》(简体版) · 《金酒全书》《朗姆酒全书》《龙舌兰与梅斯卡尔》《干邑白兰地》《伏特加全书》(简体翻译版) · 《中国白酒香型与工艺》(中国轻工业出版社) · GB/T国家标准(白酒各香型) · WSET《烈酒品鉴》(简体版) · 《釀酒科技》期刊
【权威知识库 — 烈酒品种大全 繁体中文】《威士忌學》邱德夫著(台灣) · 《威士忌聖經》Jim Murray(繁體版) · 《蘇格蘭威士忌》《波本威士忌》《日本威士忌》《單一麥芽威士忌》(台灣版) · 《金酒全書》《朗姆酒全書》《龍舌蘭與梅斯卡爾》《干邑白蘭地》《伏特加全書》(繁體翻譯版) · 《清酒的世界》《日本酒入門》《燒酎入門》(台灣版) · 台灣威士忌協會資料庫
【权威知识库 — 原材料 英文/简体/繁体】Harold McGee《On Food and Cooking》(2004) · Harold McGee《Nose Dive》(2020) · The Flavor Bible (Karen Page & Andrew Dornenburg) · Jeffrey Morgenthaler《The Bar Book》(2014) · Dave Arnold《Liquid Intelligence》(2014) · 《调酒的科学》(简体版) · 《食材风味搭配手册》(简体版) · 《調酒的科學》(台灣版) · 《食材風味搭配手冊》(繁體版)
【学术资料】Journal of Agricultural and Food Chemistry · Food Chemistry · Food Quality and Preference · Flavour journal · Chemical Senses · Journal of the Institute of Brewing · American Journal of Enology and Viticulture · Molecules (MDPI) · 《食品科学》(中国) · 《酿酒科技》(中国) · 《中国酿造》(中国)

【variantOf 置信度规则】high=权威资料明确记载；medium=业界公认但无单一权威来源；low=推断

风味描述必须严格使用以下三行固定结构（不得增减行数，不得改变格式）：
第一行：核心基调：[列举2-3个核心风味词]
第二行：风味演变：[前段风味] ➔ [中段骨架] ➔ [后段余韵]
第三行：整体质感：[2-3个关于酒体结构的质感词汇]

重要规则：所有标签字段（杯型、基酒、制作方法、冰块、风味、分类等）必须使用中文，不得使用英文。`;

        const userPrompt = `请分析以下鸡尾酒配方，返回完整的 JSON 分析结果：

${context}

请返回以下 JSON 格式（所有字段均可选，不确定的留空字符串）：
{
  "story": "配方的历史来历与创作背景（2-4句话）",
  "flavorDesc": "核心基调：...\n风味演变：... ➔ ... ➔ ...\n整体质感：...",
  "source": "来源书籍或出处",
  "creator": "调酒师或创作者姓名",
  "createdYear": "创作年份（如 2012）",
  "suggestedCategories": ["经典", "短饮"],
  "suggestedBaseSpirit": "主要基酒，必须从以下中文名称中选择：金酒/朗姆/伏特加/威士忌/龙舌兰/白兰地/梅斯卡尔/利口酒/皮斯科/卡沙萨/无酒精/其他，不能使用英文或品牌名",
  "suggestedCodexFamily": "Codex六大分类之一，必须使用以下格式之一：古典 Old-Fashioned/马天尼 Martini/大吉利 Daiquiri/边车 Sidecar/高球 Highball/菲兹 Flip，不确定留空",
  "suggestedVariantOf": "【必填，三选一，禁止留空】：'CLASSIC_ORIGINAL'（本配方本身就是经典原版）| '[母配方名]'（本配方是某经典的变体，如 '尼格罗尼 Negroni'）| 'MODERN_ORIGINAL'（现代创作或无法确认经典来源）",
  "variantOfDetail": "展开内容（150-250字中文，必须信息丰富）：CLASSIC_ORIGINAL→历史背景（年代/地点/创作者）+首次文献记载来源+配方演变脉络+在鸡尾酒史上的地位；[母配方名]→母配方简介（起源/年代）+本配方与母配方的具体差异（改了哪些原料/比例/技法/风格）+变体创作背景；MODERN_ORIGINAL→【必须包含所有已知信息】创作者全名+创作年份+创作地点/酒吧名+创作背景故事+配方设计理念+在当代调酒界的影响力（如：Paper Plane由Sam Ross于2007年创作，四等分结构，波本/阿佩罗/黄查特/柠檬汁各等量，成为当代经典）。完全不详则写'现代创作，创作背景暂无可靠文献记载'",
  "variantOfConfidence": "high | medium | low",
  "suggestedMethod": "制作方法，必须从以下中文名称中选择：摇和/搅拌/直调/分层/搅打",
  "suggestedStrength": "烈度，必须从以下中文名称中选择：清爽/适中/浓烈",
  "suggestedIce": "冰块类型，必须从以下中文名称中选择：标准方冰/大方冰/球冰/碎冰/长条冰/无冰",
  "suggestedGlass": "杯型，必须从以下中文名称中选择：马天尼杯/古典杯/高球杯/柯林杯/库佩杯/飓风杯/子弹杯/尼克诺拉杯/郁金香杯/笛型杯/提基杯/铜杯/红酒杯/朱莉普杯/其他",
  "flavors": ["酸", "甜"],
  "confidence": "high"
}

注意：
- flavorDesc 必须严格三行，第二行必须用 ➔ 符号
- 所有标签字段必须使用中文，不得使用英文单词
- suggestedBaseSpirit 只能是标准基酒名称，不能是品牌名（如不能写 "Aylesbury Duck vodka"，应写 "伏特加"）
- suggestedGlass 必须使用中文杯型名称（如不能写 "coupe"，应写 "库佩杯"）
- confidence 根据你对该配方的了解程度填写：high（著名配方）/ medium（有一定了解）/ low（不确定）`;

        try {
          const result = await invokeLLM({
            model: "claude-sonnet",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            maxTokens: 1200,
            response_format: { type: "json_object" },
          });

          const text = typeof result === "string" ? result : (result as { content?: string }).content ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) return { confidence: "low" as const };

          const p = JSON.parse(jsonMatch[0]) as {
            story?: string;
            flavorDesc?: string;
            source?: string;
            creator?: string;
            createdYear?: string;
            suggestedCategories?: string[];
            suggestedBaseSpirit?: string;
            suggestedCodexFamily?: string;
            suggestedVariantOf?: string;
            variantOfDetail?: string;
            variantOfConfidence?: string;
            suggestedMethod?: string;
            suggestedStrength?: string;
            suggestedIce?: string;
            suggestedGlass?: string;
            flavors?: string[];
            confidence?: string;
          };

          const validConf = (v?: string) =>
            v === "high" || v === "medium" || v === "low" ? (v as "high" | "medium" | "low") : ("medium" as const);

          return {
            story: typeof p.story === "string" ? p.story.trim() : "",
            flavorDesc: typeof p.flavorDesc === "string" ? p.flavorDesc.trim() : "",
            source: typeof p.source === "string" ? p.source.trim() : "",
            creator: typeof p.creator === "string" ? p.creator.trim() : "",
            createdYear: typeof p.createdYear === "string" ? p.createdYear.trim() : "",
            suggestedCategories: Array.isArray(p.suggestedCategories) ? p.suggestedCategories.filter((s): s is string => typeof s === "string") : [],
            suggestedBaseSpirit: resolveToZhWhitelistServer(
              typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",
              SERVER_VALID_SPIRITS,
            ),
          suggestedCodexFamily: typeof p.suggestedCodexFamily === "string" ? p.suggestedCodexFamily.trim() : "",
            suggestedVariantOf: typeof p.suggestedVariantOf === "string" && p.suggestedVariantOf.trim() ? p.suggestedVariantOf.trim() : "MODERN_ORIGINAL",
            variantOfDetail: typeof p.variantOfDetail === "string" ? p.variantOfDetail.trim() : "",
            variantOfConfidence: validConf(p.variantOfConfidence),
            suggestedMethod: typeof p.suggestedMethod === "string" ? p.suggestedMethod.trim() : "",
            suggestedStrength: typeof p.suggestedStrength === "string" ? p.suggestedStrength.trim() : "",
            suggestedIce: typeof p.suggestedIce === "string" ? p.suggestedIce.trim() : "",
            suggestedGlass: resolveToZhWhitelistServer(
              typeof p.suggestedGlass === "string" ? p.suggestedGlass.trim() : "",
              SERVER_VALID_GLASSES,
            ),
            flavors: Array.isArray(p.flavors) ? p.flavors.filter((s): s is string => typeof s === "string") : [],
            confidence: validConf(p.confidence),
          };
        } catch {
          return { confidence: "low" as const };
        }
      }),

    /** 酒款风味/故事/风格联网补全:根据产品名称与已有信息补全风味标签、故事、风格描述 */
    enrichBottle: publicProcedure
      .input(
        z.object({
          nameZh: z.string().max(200).optional(),
          nameEn: z.string().max(200).optional(),
          category: z.string().max(100).optional(),
          style: z.string().max(100).optional(),
          brand: z.string().max(200).optional(),
          origin: z.string().max(200).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const name = [input.nameEn, input.nameZh].filter(Boolean).join(" / ");
        const prompt = `你是专业的烈酒/饮料/原材料知识专家，深度研习《The Oxford Companion to Spirits & Cocktails》(Wondrich & Rothbaum, 2021)、WSET 烈酒教材 Level 1-4、Jim Murray《Whisky Bible》(年度版)、Dave Broom《The World Atlas of Whisky》、Jancis Robinson《The Oxford Companion to Wine》(多版)、Brad Thomas Parsons《Bitters》(2011)、Brad Thomas Parsons《Amaro》(2016)、《威士忌學》邱德夫著、《葡萄酒全書》林裕森著、《調酒師手冊》(台灣版)、IBA 官方配方庫、Difford's Guide、Whisky Advocate、Wine Spectator、The Spirits Business、IWSR 報告等權威資料。根据以下产品信息补全风味与介绍。

产品名称: ${name}
${input.category ? `分类: ${input.category}` : ""}
${input.style ? `风格: ${input.style}` : ""}
${input.brand ? `品牌: ${input.brand}` : ""}
${input.origin ? `产地: ${input.origin}` : ""}

请输出 JSON:
{
  "flavorTags": 从 ["草本","果味","柑橘","花香","甜润","酸爽","苦韵","辛香","烟熏","咸鲜","清爽","浓郁","坚果","奶油","干爽","热带","焦糖","咖啡","巧克力","泥煤","蜂蜜","香草","坚硬","辛辣"] 中最合适的2-4个,
  "story": "产品故事/介绍(中文,80字内,不确定则返回空字符串)",
  "styleDesc": "风格特点描述(中文,50字内,不确定则返回空字符串)",
  "confidence": "high"|"medium"|"low"
}`;
        const signal = AbortSignal.timeout(25_000);
        let response;
        try {
          response = await invokeLLM({
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            signal,
          });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new Error(isTimeout ? "AI 分析超时，请稍后重试" : `AI 分析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const raw = response.choices[0]?.message?.content;
        const parsed = parseJsonObjectLoose(typeof raw === "string" ? raw : "");
        const p = parsed as Record<string, unknown>;
        return {
          flavorTags: Array.isArray(p.flavorTags) ? (p.flavorTags as string[]).slice(0, 6) : [],
          story: typeof p.story === "string" ? p.story.trim() : "",
          styleDesc: typeof p.styleDesc === "string" ? p.styleDesc.trim() : "",
          confidence: (["high", "medium", "low"] as const).includes(p.confidence as "high") ? p.confidence as "high" | "medium" | "low" : "medium",
        };
      }),

    /**
     * 全字段一步补全（claude-sonnet）：合并原 enrich + enrichBottle 两步为单次强模型调用。
     * 支持基酒库 / 酒款库 / 原材料库三库差异化 prompt，所有标签严格白名单校验。
     */
    enrichBottleFull: publicProcedure
    .input(
  z.object({
    nameZh: z.string().max(200).optional(),
    nameEn: z.string().max(200).optional(),
    category: z.string().max(100).optional(),
    style: z.string().max(100).optional(),
    brand: z.string().max(200).optional(),
    origin: z.string().max(200).optional(),
    imageBase64: z.string().max(14_000_000).optional(),
    imageMime: z.string().max(64).optional(),
    /** 用户书库中与该酒款相关的文本片段（最多3段，每段200字以内） */
    bookSnippets: z.array(z.string().max(300)).max(5).optional(),
    /** 用户酒库中同类/相关酒款名称列表（用于跨酒款关联推理） */
    cellarBottles: z.array(z.string().max(200)).max(20).optional(),
  }),
)
      .mutation(async ({ input }) => {
        // ── 白名单常量 ──────────────────────────────────────────────────
        const BOTTLE_STYLES_MAP: Record<string, string[]> = {
          金酒: ["London Dry","Plymouth","Old Tom","Genever","Contemporary","Navy Strength","Sloe Gin"],
          朗姆: ["Spanish Style (Blanco)","Spanish Style (Añejo)","English Style (Jamaican)","English Style (Demerara)","French Style (Agricole Blanc)","French Style (Agricole Ambre)","Overproof","Black Rum","Spiced Rum","Cachaça"],
          伏特加: ["Wheat","Rye","Potato","Corn","Grape","Flavored"],
          威士忌: ["Bourbon","Rye","Tennessee","Scotch Blended","Scotch Single Malt","Islay Single Malt","Irish","Japanese","Canadian"],
          龙舌兰: ["Tequila Blanco","Tequila Reposado","Tequila Añejo","Mezcal Joven","Mezcal Reposado","Sotol","Raicilla"],
          白兰地: ["Cognac VS","Cognac VSOP","Cognac XO","Armagnac","Calvados","Pisco","Apple Brandy","Grappa","Eau de Vie"],
          利口酒: ["Orange Liqueur","Cherry Liqueur","Coffee Liqueur","Herbal Liqueur","Amaro","Cream Liqueur","Nut Liqueur","Fruit Liqueur","Floral Liqueur","Anise Liqueur"],
          苦精: ["Aromatic","Orange","Celery","Chocolate","Peach","Tiki"],
          味美思: ["Dry Vermouth","Blanc/Bianco","Sweet Vermouth","Ambrato","Quinquina","Americano"],
          开胃酒: ["Aperitivo","Amaro Leggero","Amaro Medio","Amaro Denso","Fernet","Gentian"],
          起泡酒: ["Champagne","Prosecco","Cava","Crémant","Pét-Nat"],
          葡萄酒: ["Dry White","Dry Red","Sherry Fino","Sherry Oloroso","Sherry PX","Port","Madeira","Sauternes"],
          清酒烧酒: ["Junmai","Junmai Ginjo","Junmai Daiginjo","Nigori","Umeshu","Mugi Shochu","Imo Shochu","Kome Shochu","Soju"],
          中式白酒: ["Sauce Aroma 酱香","Strong Aroma 浓香","Light Aroma 清香","Rice Aroma 米香"],
          糖浆: ["Syrup","Cordial","Shrub","Cream/Foam"],
          软饮: ["Soda","Tonic","Ginger Beer","Ginger Ale","Sparkling Water","Cola"],
          糖与甜味剂: ["Refined Sugar","Raw / Dark Sugar","Sugar Cube","Honey & Nectar","Molasses & Concentrate"],
          果蔬: ["Citrus","Fresh Fruit","Fresh Vegetable","Dried Fruit","Dried Vegetable"],
          香料与草本: ["Dried Spice","Fresh Herb","Bittering Botanical"],
          花卉: ["Dried Flowers","Fresh Edible Flowers","Floral Water"],
          茶咖与可可: ["Cacao","Tea","Coffee"],
          坚果与谷物: ["Nut","Grain / Seed"],
          乳蛋: ["Milk / Cream","Egg","Butter / Cheese"],
          酸类与添加剂: ["Powdered Acid","Vinegar","Salt & Mineral","Texture / Clarifier"],
        };
        const VALID_CATEGORIES = ["金酒","朗姆","伏特加","威士忌","龙舌兰","白兰地","利口酒","苦精","味美思","开胃酒","起泡酒","葡萄酒","清酒烧酒","中式白酒","糖浆","软饮","糖与甜味剂","果蔬","香料与草本","花卉","茶咖与可可","坚果与谷物","乳蛋","酸类与添加剂","其他"];
        const VALID_FLAVOR_TAGS_BOTTLE = ["草本","果味","柑橘","花香","甜润","酸爽","苦韵","辛香","烟熏","咸鲜","清爽","浓郁","坚果","奶油","干爽","热带","焦糖","咖啡","巧克力","泥煤","蜂蜜","香草","坚硬","辛辣"];

        // ── 判断库类型 ──────────────────────────────────────────────────
        const BASE_SPIRITS = ["金酒","朗姆","伏特加","威士忌","龙舌兰","白兰地","清酒烧酒","中式白酒"];
        const WINE_SPIRITS = ["利口酒","苦精","味美思","开胃酒","起泡酒","葡萄酒","糖浆","软饮"];
        const RAW_MATERIALS = ["糖与甜味剂","果蔬","香料与草本","花卉","茶咖与可可","坚果与谷物","乳蛋","酸类与添加剂"];
        const cat = input.category ?? "";
        const libraryType = BASE_SPIRITS.includes(cat) ? "base"
          : WINE_SPIRITS.includes(cat) ? "wine"
          : RAW_MATERIALS.includes(cat) ? "material"
          : "base"; // 未知时默认基酒库逻辑

        const name = [input.nameEn, input.nameZh].filter(Boolean).join(" / ");
        const knownStyle = input.style ? `\n已知风格: ${input.style}` : "";
        const knownBrand = input.brand ? `\n品牌: ${input.brand}` : "";
        const knownOrigin = input.origin ? `\n产地: ${input.origin}` : "";
        const knownCategory = cat ? `\n分类: ${cat}` : "";
        const styleOptions = cat && BOTTLE_STYLES_MAP[cat] ? `\n可选风格子标签（必须从中选一，不确定填""）: ${JSON.stringify(BOTTLE_STYLES_MAP[cat])}` : "";
        // 书库上下文：如果客户端传来了相关段落，注入到 prompt 中
        const bookContext = (input.bookSnippets && input.bookSnippets.length > 0)
        ? `\n\n【用户书库参考资料】以下是用户个人书库中与该酒款相关的原文段落，请优先参考这些内容补全 story/notes/styleDesc/distilleryInfo 等描述性字段：\n${input.bookSnippets.map((s, i) => `[段落${i + 1}] ${s}`).join("\n")}`
        : "";
        const cellarContext = (input.cellarBottles && input.cellarBottles.length > 0)
          ? `\n\n【用户酒库参考】用户当前酒库中有以下相关酒款：${input.cellarBottles.slice(0, 15).join("、")}。请基于此推断：1) 该酒款可替代酒库中的哪款酒（substituteFor）；2) 与酒库中哪款酒搭配效果好（pairsWith）。如无法推断则填""。`
          : "";

        // ── 实时爬取补全（联网时从公开数据源获取冷门酒款数据） ──────────────────
        // 注意：fetchWebBottleContext 超时 5 秒，失败静默降级，不影响主流程
        let webContext = "";
        if (!input.imageBase64) {
          try {
            webContext = await fetchWebBottleContext(input.nameZh, input.nameEn, input.brand);
          } catch {
            // 静默降级
          }
        }

        // ── 三库差异化 prompt ───────────────────────────────────────────
        let librarySpecificInstructions = "";
        if (libraryType === "base") {
          librarySpecificInstructions = `
重点补全方向（基酒库）：
- 蒸馏工艺与产区特征（如"铜壶蒸馏，苏格兰高地产区"）
- 陈年方式（如"波本桶陈12年"）
- 代表性鸡尾酒用途（如"适合 Negroni、Martini"）
- distilleryInfo: 蒸馏厂/酒厂简介（中文，60字内，不确定填""）`;
        } else if (libraryType === "wine") {
          librarySpecificInstructions = `
重点补全方向（酒款库）：
- 风格流派与苦味/甜度来源（如"以龙胆草为主苦味来源"）
- 常见调酒用途与搭配（如"适合 Aperol Spritz、Negroni"）
- pairingNotes: 搭配建议（中文，40字内，不确定填""）`;
        } else {
          librarySpecificInstructions = `
重点补全方向（原材料库）：
- 产地与季节性（如"西西里柠檬，春季最佳"）
- 调酒用途（如"皮油常用于 Martini 装饰，果汁用于酸味鸡尾酒"）
- usageNotes: 调酒用途说明（中文，60字内，不确定填""）
- seasonality: 季节性说明（中文，20字内，不确定填""）`;
        }

        const VALID_FLAVOR_TAGS_FULL = ["草本","果味","柑橘","花香","甜润","酸爽","苦韵","辛香","烟熏","咸鲜","清爽","浓郁","坚果","奶油","干爽","热带","焦糖","咖啡","巧克力","泥煤","蜂蜜","香草","坚硬","辛辣"];
        const prompt = `你是专业的烈酒/饮料/原材料知识专家，深度研习以下权威资料，同时精通中英双语描述：
【英文】《The Oxford Companion to Spirits & Cocktails》(Wondrich & Rothbaum, 2021) · Death & Co《Cocktail Codex》(2018) · Jeffrey Morgenthaler《The Bar Book》(2014) · Dave Arnold《Liquid Intelligence》(2014) · WSET Spirits Level 1-4 官方教材 · Jim Murray《Whisky Bible》(年度版) · Michael Jackson《Malt Whisky Companion》(多版) · Dave Broom《The World Atlas of Whisky》(2014) · Fred Minnick《Bourbon》(2016) · Aaron Knoll《Gin: The Art and Craft of the Artisan Revival》(2015) · Dave Broom《Rum》(2016) · Brad Thomas Parsons《Bitters》(2011) · Brad Thomas Parsons《Amaro》(2016) · Jancis Robinson《The Oxford Companion to Wine》(多版) · Jancis Robinson《Wine Grapes》(2012) · Hugh Johnson & Jancis Robinson《The World Atlas of Wine》(多版) · Julian Jeffs《Sherry》(多版) · John Gauntner《The Sake Handbook》(多版) · Garrett Oliver《The Oxford Companion to Beer》(2011) · IBA Official Cocktail List · Difford's Guide · Whisky Advocate · Wine Spectator · The Spirits Business · IWSR Reports · SWA 法規資料 · CRT/COMERCAM 龍舌蘭/梅斯卡爾法規 · TTB 美國烈酒法規
【中文/繁體】《威士忌學》邱德夫著(台灣) · 《葡萄酒全書》林裕森著(台灣) · 《調酒師手冊》(台灣版) · 《調酒學》林一峰著(香港) · 《世界雞尾酒大全》(台灣版) · 《威士忌聖經》中文版 · 《清酒的世界》(台灣翻譯版) · 《日本酒入門》(台灣版) · 《苦精聖經》(台灣翻譯版) · 《利口酒全書》(台灣翻譯版) · 《精釀啤酒聖經》(台灣翻譯版) · 《葡萄酒品飲事典》(台灣版) · 《中國白酒香型與工藝》(中國輕工業出版社) · GB/T 國家標準(中國白酒各香型) · 《釀酒科技》期刊(中國) · 台灣調酒協會(TBSA) · 香港調酒師協會(HKBA)
【學術】Journal of Agricultural and Food Chemistry · Food Chemistry · Journal of the Institute of Brewing · American Journal of Enology and Viticulture · Chemical Senses · Food Quality and Preference · 《食品科學》(中國) · 《釀酒科技》(中國)
根据以下产品信息，一次性补全所有字段。

        产品名称: ${name || "（未知，请根据照片识别）"}${knownCategory}${knownStyle}${knownBrand}${knownOrigin}${bookContext}${cellarContext}
${webContext}
${librarySpecificInstructions}

请输出 JSON（所有字段必须存在，不确定的字符串填 ""，数字填 0）:
{
  "found": true/false（是否识别到该产品）,
  "nameZh": "中文名（中国市场通用译名，如 君度橙酒）",
  "nameEn": "英文名（品牌官方英文名，如 Cointreau）",
  "category": "必须从以下枚举精确选一: ${VALID_CATEGORIES.join("/")}",
  "style": "风格子标签，必须从 styleOptions 列表中精确选一${styleOptions}，不确定填 \"\"",
  "brand": "品牌名（如 Hendrick's），不确定填 \"\"",
  "origin": "产地精确到国家/地区（如 苏格兰高地、墨西哥哈利斯科州），不确定填 \"\"",
  "volume": "常见规格（如 700ml），不确定填 \"\"",
  "abv": 酒精度数（数字，如 40），未知填 0,
  "priceCny": 中国市场常见零售价估计（人民币，数字），完全无从估计填 0,
  "notes": "一句话简介：风味特征、常见用途（中文，50字内）",
  "flavorTags": 从 ${JSON.stringify(VALID_FLAVOR_TAGS_FULL)} 中选最合适的2-4个（数组），只能选列表中的值,
  "story": "产品故事/介绍（中文，80字内，描述历史背景与风味特点），不确定填 \"\"",
  "styleDesc": "风格特点详细描述（中文，50字内，区别于 style 子标签），不确定填 \"\"",
  "distilleryInfo": "蒸馏厂/酒厂简介（基酒库专用，中文，60字内），不确定填 \"\"",
  "pairingNotes": "搭配建议（酒款库专用，中文，40字内），不确定填 \"\"",
  "usageNotes": "调酒用途说明（原材料库专用，中文，60字内），不确定填 \"\"",
  "seasonality": "季节性说明（原材料库专用，中文，20字内），不确定填 \"\"",
  "confidence": "high"/"medium"/"low"（资料把握程度：知名大牌=high，通用品类=medium，勉强猜测=low）,
  "notesEn": "一句话英文简介（英文，50字内，供国际场合使用），不确定填 \"\"",
  "storyEn": "英文产品故事/介绍（英文，80字内，描述历史背景与风味特点），不确定填 \"\"",
  "substituteFor": "可替代用户酒库中的哪款酒（酒款中文名或英文名，如"添加利金酒"），无法推断填 \"\"",
  "pairsWith": "与用户酒库中哪款酒搭配效果好（酒款中文名或英文名），无法推断填 \"\""
}
规则：
- category 必须严格落在上述枚举中，选最贴切的一个
- style 必须从对应 category 的 styleOptions 列表中精确选一，不在列表中的填 ""
- flavorTags 只能从给定列表中选，不能自造新标签
- nameZh 使用中国市场通用译名（如「君度橙酒」而非「柯因特罗」）；nameEn 使用品牌官方英文名称
- 产地精确到国家/地区（如「苏格兰高地」「墨西哥哈利斯科州」）
- priceCny 参考中国市场主流电商（京东/天猫）零售价，给出合理估计
- 不要编造不存在的品牌；不确定品牌就留空但仍可给出通用品类资料
- 只输出 JSON，不要任何解释文字`;

        const parts: MessageContent[] = [];
        // ── 缓存检查（仅文字请求，图片请求不缓存） ─────────────────────────
        const cacheKey = !input.imageBase64
          ? getEnrichCacheKey(input.nameZh, input.nameEn, input.brand, input.category)
          : null;
        if (cacheKey) {
          pruneEnrichCache();
          const cached = enrichBottleCache.get(cacheKey);
          if (cached && cached.expireAt > Date.now()) {
            const cp = cached.result;
            const resolvedCat2 = VALID_CATEGORIES.includes(cp.category as string) ? (cp.category as string) : (cat || "");
            const styleList2 = BOTTLE_STYLES_MAP[resolvedCat2] ?? [];
            const rawStyle2 = typeof cp.style === "string" ? cp.style.trim() : "";
            const rawFlavors2 = Array.isArray(cp.flavorTags) ? (cp.flavorTags as string[]) : [];
            return {
              found: cp.found !== false,
              nameZh: typeof cp.nameZh === "string" ? cp.nameZh.trim() : "",
              nameEn: typeof cp.nameEn === "string" ? cp.nameEn.trim() : "",
              category: resolvedCat2,
              style: styleList2.includes(rawStyle2) ? rawStyle2 : "",
              brand: typeof cp.brand === "string" ? cp.brand.trim() : "",
              origin: typeof cp.origin === "string" ? cp.origin.trim() : "",
              volume: typeof cp.volume === "string" ? cp.volume.trim() : "",
              abv: typeof cp.abv === "number" && cp.abv >= 0 ? cp.abv : 0,
              priceCny: typeof cp.priceCny === "number" && cp.priceCny >= 0 ? cp.priceCny : 0,
              notes: typeof cp.notes === "string" ? cp.notes.trim() : "",
              flavorTags: rawFlavors2.filter((f) => VALID_FLAVOR_TAGS_BOTTLE.includes(f)).slice(0, 4),
              story: typeof cp.story === "string" ? cp.story.trim() : "",
              styleDesc: typeof cp.styleDesc === "string" ? cp.styleDesc.trim() : "",
              distilleryInfo: typeof cp.distilleryInfo === "string" ? cp.distilleryInfo.trim() : "",
              pairingNotes: typeof cp.pairingNotes === "string" ? cp.pairingNotes.trim() : "",
              usageNotes: typeof cp.usageNotes === "string" ? cp.usageNotes.trim() : "",
              seasonality: typeof cp.seasonality === "string" ? cp.seasonality.trim() : "",
              confidence: (["high","medium","low"] as const).includes(cp.confidence as "high") ? cp.confidence as "high"|"medium"|"low" : "medium",
              notesEn: typeof cp.notesEn === "string" ? cp.notesEn.trim() : "",
              storyEn: typeof cp.storyEn === "string" ? cp.storyEn.trim() : "",
              substituteFor: typeof cp.substituteFor === "string" ? cp.substituteFor.trim() : "",
              pairsWith: typeof cp.pairsWith === "string" ? cp.pairsWith.trim() : "",
            };
          }
        }
        if (input.imageBase64) {
          parts.push({
            type: "image_url",
            image_url: { url: `data:${input.imageMime || "image/jpeg"};base64,${input.imageBase64}` },
          });
        }
        parts.push({ type: "text", text: prompt });

        const signal = AbortSignal.timeout(35_000);
        let response;
        try {
          response = await invokeLLM({
            model: "claude-sonnet",
            messages: [{ role: "user", content: parts.length === 1 ? prompt : parts }],
            response_format: { type: "json_object" },
            signal,
          });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new Error(isTimeout ? "AI 分析超时，请稍后重试" : `AI 分析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const raw = response.choices[0]?.message?.content;
        const p = parseJsonObjectLoose(typeof raw === "string" ? raw : "") as Record<string, unknown>;

        // ── 严格白名单校验 ──────────────────────────────────────────────
        const resolvedCategory = VALID_CATEGORIES.includes(p.category as string) ? (p.category as string) : (cat || "");
        const styleList = BOTTLE_STYLES_MAP[resolvedCategory] ?? [];
        const rawStyle = typeof p.style === "string" ? p.style.trim() : "";
        const validatedStyle = styleList.includes(rawStyle) ? rawStyle : "";
        const rawFlavors = Array.isArray(p.flavorTags) ? (p.flavorTags as string[]) : [];
        const validatedFlavors = rawFlavors.filter((f) => VALID_FLAVOR_TAGS_BOTTLE.includes(f)).slice(0, 4);

        // ── 写入缓存 ────────────────────────────────────────────────────
        if (cacheKey) {
          enrichBottleCache.set(cacheKey, { result: p, expireAt: Date.now() + ENRICH_CACHE_TTL_MS });
        }

        return {
          found: p.found !== false,
          nameZh: typeof p.nameZh === "string" ? p.nameZh.trim() : "",
          nameEn: typeof p.nameEn === "string" ? p.nameEn.trim() : "",
          category: resolvedCategory,
          style: validatedStyle,
          brand: typeof p.brand === "string" ? p.brand.trim() : "",
          origin: typeof p.origin === "string" ? p.origin.trim() : "",
          volume: typeof p.volume === "string" ? p.volume.trim() : "",
          abv: typeof p.abv === "number" && p.abv >= 0 ? p.abv : 0,
          priceCny: typeof p.priceCny === "number" && p.priceCny >= 0 ? p.priceCny : 0,
          notes: typeof p.notes === "string" ? p.notes.trim() : "",
          flavorTags: validatedFlavors,
          story: typeof p.story === "string" ? p.story.trim() : "",
          styleDesc: typeof p.styleDesc === "string" ? p.styleDesc.trim() : "",
          distilleryInfo: typeof p.distilleryInfo === "string" ? p.distilleryInfo.trim() : "",
          pairingNotes: typeof p.pairingNotes === "string" ? p.pairingNotes.trim() : "",
          usageNotes: typeof p.usageNotes === "string" ? p.usageNotes.trim() : "",
          seasonality: typeof p.seasonality === "string" ? p.seasonality.trim() : "",
          confidence: (["high","medium","low"] as const).includes(p.confidence as "high") ? p.confidence as "high"|"medium"|"low" : "medium",
          notesEn: typeof p.notesEn === "string" ? p.notesEn.trim() : "",
          storyEn: typeof p.storyEn === "string" ? p.storyEn.trim() : "",
          substituteFor: typeof p.substituteFor === "string" ? p.substituteFor.trim() : "",
          pairsWith: typeof p.pairsWith === "string" ? p.pairsWith.trim() : "",
        };
      }),

    /** 联网识别:未知产品名称/照片 → LLM 知识补全为结构化资料 */
    enrich: publicProcedure
      .input(
        z.object({
          names: z.array(z.string().min(1).max(200)).max(8).default([]),
          imageBase64: z.string().max(14_000_000).optional(),
          imageMime: z.string().max(64).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const names = input.names.map((n) => n.trim()).filter(Boolean);
        if (names.length === 0 && !input.imageBase64) return { items: [] as EnrichedProduct[] };
        const parts: MessageContent[] = [];
        if (input.imageBase64) {
          const mime = input.imageMime || "image/jpeg";
          parts.push({
            type: "image_url",
            image_url: { url: `data:${mime};base64,${input.imageBase64}` },
          });
        }
        parts.push({
          type: "text",
          text:
            names.length > 0
              ? `请补全以下产品的资料:\n${names.map((n) => `- ${n}`).join("\n")}`
              : "请识别照片中的产品并补全资料。",
        });
        const enrichSignal = AbortSignal.timeout(30_000);
        let response;
        try {
          response = await invokeLLM({
            messages: [
              { role: "system", content: ENRICH_SYSTEM_PROMPT },
              { role: "user", content: parts },
            ],
            response_format: { type: "json_object" },
            signal: enrichSignal,
          });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new Error(isTimeout ? "AI 识别超时，请稍后重试" : `AI 识别失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const raw = response.choices[0]?.message?.content;
        const parsed = parseJsonObjectLoose(typeof raw === "string" ? raw : "");
        const arr = Array.isArray((parsed as { items?: unknown[] })?.items)
          ? (parsed as { items: unknown[] }).items
          : [];
        const items: EnrichedProduct[] = [];
        for (const it of arr.slice(0, 8)) {
          const r = enrichSchemaFull.safeParse(it);
          if (r.success) items.push(r.data);
        }
        return { items };
      }),
    enrichHomemade: publicProcedure
      .input(
        z.object({
          name: z.string().max(200),
          nameAlt: z.string().max(200).optional(),
          type: z.string().max(100).optional(),
          ingredients: z.array(z.string().max(200)).max(20).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const displayName = [input.name, input.nameAlt].filter(Boolean).join(" / ");
        const ingredientList = input.ingredients?.length
          ? `\n配方原料: ${input.ingredients.join(", ")}`
          : "";
        // ── 白名单常量 ──────────────────────────────────────────────────
        const VALID_PREP_TYPES = ["infusion","fat-wash","butter-wash","oil-wash","rapid-infusion","sous-vide-infusion","ultrasonic-infusion","rotovap","cold-brew-spirit","smoke-infusion","liqueur","fruit-liqueur","herbal-liqueur","nut-liqueur","cream-liqueur","amaro","falernum","bitters","aromatic-bitters","citrus-bitters","herbal-bitters","tincture","spice-tincture","citrus-tincture","redistilled","batch","bottled-cocktail","barrel-aged","fortified","fermented","homebrew-beer","homebrew-wine","syrup","rich-syrup","spiced-syrup","herbal-syrup","floral-syrup","fruit-syrup","caramel-syrup","coffee-tea-syrup","orgeat","oleo","juice","clarified-juice","super-juice","cordial","solution","acid-adjusted","shrub","lacto-ferment-drink","zero-spirit","na-bitters","na-liqueur","kombucha","water-kefir","ginger-beer","tepache","jun","foam","spherification-prep","garnish","other"];
        const VALID_TECHNIQUES = ["rotovap","centrifuge","fat_wash","milk_wash","rapid_infusion","sous_pression","sous_vide","fermentation","barrel_age","ultrasonic","enzyme_pectinase","enzyme_amylase","spherification","emulsification","liquid_nitrogen","steam_distill","bottle_age","oak_stave","carbonation","smoke","acid_adjust","oleo","heat_cook","cold_steep","room_steep"];
        const VALID_SECTIONS = ["infused-spirit","homemade-liqueur","bitters-tincture","modified-spirit","homemade-spirit","homemade-syrup","juice-cordial","shrub-vinegar","zero-proof","na-ferment","misc"];
        const VALID_FLAVOR_TAGS = ["酸","甜","苦","烈","鲜","柑橘","热带","草本","花香","烟熏","木桶","香料","坚果可可","清爽","浓郁","干爽","复杂"];

        // ── 语义映射表（别名/偏移词/品牌 → 标准 category + style） ──────────
        type SemanticEntry = { category: string; style: string; confidence: "high" | "medium" };
        const SEMANTIC_MAP: Array<{ keywords: string[]; result: SemanticEntry }> = [
          // 威士忌
          { keywords: ["黑麦威士忌","裸麦威士忌","rye whiskey","rye whisky","rye-based","rittenhouse","sazerac rye","whistlepig","bulleit rye","old overholt","pikesville","templeton rye"], result: { category: "威士忌", style: "Rye", confidence: "high" } },
          { keywords: ["波本威士忌","波旁威士忌","肯塔基威士忌","bourbon","kentucky straight","maker's mark","woodford reserve","buffalo trace","knob creek","four roses","wild turkey","jim beam","evan williams","elijah craig"], result: { category: "威士忌", style: "Bourbon", confidence: "high" } },
          { keywords: ["艾雷岛威士忌","泥煤威士忌","islay","peated scotch","laphroaig","ardbeg","lagavulin","bruichladdich","bowmore","caol ila","kilchoman","泥煤感","碘味"], result: { category: "威士忌", style: "Islay Single Malt", confidence: "high" } },
          { keywords: ["苏格兰单一麦芽","highland malt","speyside","glenfiddich","macallan","glenlivet","dalmore","glenmorangie","balvenie","aberlour","highland park"], result: { category: "威士忌", style: "Scotch Single Malt", confidence: "high" } },
          { keywords: ["苏格兰调和威士忌","blended scotch","johnnie walker","chivas regal","dewar's","famous grouse","ballantine's"], result: { category: "威士忌", style: "Scotch Blended", confidence: "high" } },
          { keywords: ["爱尔兰威士忌","irish whiskey","jameson","bushmills","redbreast","green spot","tullamore","三次蒸馏爱尔兰"], result: { category: "威士忌", style: "Irish", confidence: "high" } },
          { keywords: ["日本威士忌","japanese whisky","suntory","nikka","yamazaki","hakushu","hibiki","yoichi","miyagikyo","toki","余市","宫城峡","山崎","白州","响"], result: { category: "威士忌", style: "Japanese", confidence: "high" } },
          { keywords: ["田纳西威士忌","tennessee whiskey","jack daniel's","george dickel","uncle nearest"], result: { category: "威士忌", style: "Tennessee", confidence: "high" } },
          { keywords: ["加拿大威士忌","canadian whisky","crown royal","canadian club"], result: { category: "威士忌", style: "Canadian", confidence: "high" } },
          { keywords: ["威士忌","whiskey","whisky"], result: { category: "威士忌", style: "", confidence: "medium" } },
          // 金酒
          { keywords: ["伦敦干金酒","london dry gin","tanqueray","beefeater","gordon's","bombay sapphire","sipsmith","杜松子主导"], result: { category: "金酒", style: "London Dry", confidence: "high" } },
          { keywords: ["当代金酒","新派金酒","contemporary gin","new western gin","hendrick's","monkey 47","roku","aviation","botanist","黄瓜金酒","茶香金酒","花香主导金酒"], result: { category: "金酒", style: "Contemporary", confidence: "high" } },
          { keywords: ["老汤姆金酒","old tom gin","hayman's old tom","ransom old tom","微甜金酒"], result: { category: "金酒", style: "Old Tom", confidence: "high" } },
          { keywords: ["海军强度金酒","navy strength gin","overproof gin","perry's tot","57%金酒"], result: { category: "金酒", style: "Navy Strength", confidence: "high" } },
          { keywords: ["荷式金酒","genever","bols genever","jenever"], result: { category: "金酒", style: "Genever", confidence: "high" } },
          { keywords: ["金酒","gin"], result: { category: "金酒", style: "", confidence: "medium" } },
          // 朗姆
          { keywords: ["牙买加朗姆","jamaican rum","hampden","appleton","worthy park","wray & nephew","funky rum","高酯朗姆"], result: { category: "朗姆", style: "English Style (Jamaican)", confidence: "high" } },
          { keywords: ["法式农业朗姆","rhum agricole","martinique rum","clement","saint james","neisson","甘蔗汁朗姆"], result: { category: "朗姆", style: "French Style (Agricole Blanc)", confidence: "high" } },
          { keywords: ["demerara rum","el dorado","diamond","port mourant","德梅拉拉朗姆"], result: { category: "朗姆", style: "English Style (Demerara)", confidence: "high" } },
          { keywords: ["高度朗姆","overproof rum","151 rum","wray & nephew overproof"], result: { category: "朗姆", style: "Overproof", confidence: "high" } },
          { keywords: ["朗姆","rum","rhum"], result: { category: "朗姆", style: "", confidence: "medium" } },
          // 龙舌兰
          { keywords: ["梅斯卡尔","mezcal","del maguey","wahaka","banhez","烟熏龙舌兰"], result: { category: "龙舌兰", style: "Mezcal Joven", confidence: "high" } },
          { keywords: ["白色龙舌兰","银龙舌兰","blanco tequila","silver tequila","patron silver","espolon blanco","未陈年龙舌兰"], result: { category: "龙舌兰", style: "Tequila Blanco", confidence: "high" } },
          { keywords: ["reposado tequila","reposado龙舌兰","陈年龙舌兰 reposado"], result: { category: "龙舌兰", style: "Tequila Reposado", confidence: "high" } },
          { keywords: ["añejo tequila","anejo tequila","超陈龙舌兰"], result: { category: "龙舌兰", style: "Tequila Añejo", confidence: "high" } },
          { keywords: ["龙舌兰","tequila","agave spirit"], result: { category: "龙舌兰", style: "", confidence: "medium" } },
          // 伏特加
          { keywords: ["黑麦伏特加","rye vodka","belvedere","chopin rye","stolichnaya","裸麦伏特加"], result: { category: "伏特加", style: "Rye", confidence: "high" } },
          { keywords: ["土豆伏特加","potato vodka","chopin potato","luksusowa"], result: { category: "伏特加", style: "Potato", confidence: "high" } },
          { keywords: ["伏特加","vodka"], result: { category: "伏特加", style: "", confidence: "medium" } },
          // 白兰地
          { keywords: ["干邑","cognac","hennessy","remy martin","martell","courvoisier","hine","delamain"], result: { category: "白兰地", style: "Cognac VSOP", confidence: "high" } },
          { keywords: ["雅文邑","armagnac","bas-armagnac","domaine d'ognoas"], result: { category: "白兰地", style: "Armagnac", confidence: "high" } },
          { keywords: ["卡尔瓦多斯","calvados","apple brandy","苹果白兰地","lemorton","christian drouin"], result: { category: "白兰地", style: "Calvados", confidence: "high" } },
          { keywords: ["皮斯科","pisco","peruvian pisco","chilean pisco"], result: { category: "白兰地", style: "Pisco", confidence: "high" } },
          { keywords: ["白兰地","brandy"], result: { category: "白兰地", style: "", confidence: "medium" } },
          // 利口酒
          { keywords: ["橙味利口酒","orange liqueur","cointreau","triple sec","grand marnier","combier","柑橘利口酒"], result: { category: "利口酒", style: "Orange Liqueur", confidence: "high" } },
          { keywords: ["咖啡利口酒","coffee liqueur","kahlúa","kahlua","tia maria","mr black"], result: { category: "利口酒", style: "Coffee Liqueur", confidence: "high" } },
          { keywords: ["草本利口酒","herbal liqueur","chartreuse","benedictine","strega","galliano"], result: { category: "利口酒", style: "Herbal Liqueur", confidence: "high" } },
          { keywords: ["阿玛罗","amaro","campari","aperol","cynar","averna","ramazzotti","fernet"], result: { category: "利口酒", style: "Amaro", confidence: "high" } },
          { keywords: ["奶油利口酒","cream liqueur","baileys","advocaat"], result: { category: "利口酒", style: "Cream Liqueur", confidence: "high" } },
          { keywords: ["利口酒","liqueur","cordial"], result: { category: "利口酒", style: "", confidence: "medium" } },
          // 苦精
          { keywords: ["苦精","bitters","angostura","peychaud's","fee brothers","regans'","aromatic bitters","orange bitters"], result: { category: "苦精", style: "Aromatic", confidence: "high" } },
          // 清酒烧酒
          { keywords: ["纯米大吟酿","junmai daiginjo","大吟酿","daiginjo"], result: { category: "清酒烧酒", style: "Junmai Daiginjo", confidence: "high" } },
          { keywords: ["纯米吟酿","junmai ginjo","吟酿","ginjo"], result: { category: "清酒烧酒", style: "Junmai Ginjo", confidence: "high" } },
          { keywords: ["梅酒","umeshu","plum wine","梅子酒"], result: { category: "清酒烧酒", style: "Umeshu", confidence: "high" } },
          { keywords: ["烧酒","shochu","焼酎"], result: { category: "清酒烧酒", style: "Mugi Shochu", confidence: "medium" } },
          { keywords: ["清酒","sake","日本酒","nihonshu"], result: { category: "清酒烧酒", style: "Junmai", confidence: "medium" } },
          // 中式白酒
          { keywords: ["酱香白酒","酱香型","茅台","sauce aroma","moutai","maotai"], result: { category: "中式白酒", style: "Sauce Aroma 酱香", confidence: "high" } },
          { keywords: ["浓香白酒","浓香型","五粮液","泸州老窖","strong aroma"], result: { category: "中式白酒", style: "Strong Aroma 浓香", confidence: "high" } },
          { keywords: ["清香白酒","清香型","汾酒","light aroma"], result: { category: "中式白酒", style: "Light Aroma 清香", confidence: "high" } },
          { keywords: ["白酒","baijiu","中国白酒"], result: { category: "中式白酒", style: "", confidence: "medium" } },
        ];
        const BASE_SPIRIT_CATS = new Set(["金酒","朗姆","伏特加","威士忌","龙舌兰","白兰地","清酒烧酒","中式白酒"]);
        const WINE_SPIRIT_CATS = new Set(["利口酒","苦精","味美思","开胃酒","起泡酒","葡萄酒","糖浆","软饮"]);
        function resolveLibraryFromText(text: string): { suggestedLibrary: string; suggestedCategory: string; suggestedStyle: string; mapConfidence: "high" | "medium" | "none" } {
          const lower = text.toLowerCase();
          for (const entry of SEMANTIC_MAP) {
            for (const kw of entry.keywords) {
              if (lower.includes(kw.toLowerCase())) {
                const lib = BASE_SPIRIT_CATS.has(entry.result.category) ? "spirits"
                  : WINE_SPIRIT_CATS.has(entry.result.category) ? "bottles"
                  : "materials";
                return { suggestedLibrary: lib, suggestedCategory: entry.result.category, suggestedStyle: entry.result.style, mapConfidence: entry.result.confidence };
              }
            }
          }
          return { suggestedLibrary: "auto", suggestedCategory: "", suggestedStyle: "", mapConfidence: "none" };
        }

        const knownType = input.type ? `\n已知类型: ${input.type}` : "";
        const prompt = `你是专业的调酒师和自制饮品专家，深度研习 Dave Arnold《Liquid Intelligence》(2014)、Jeffrey Morgenthaler《The Bar Book》(2014)、Death & Co《Cocktail Codex》(2018)、Ryan Chetiyawardana《Good Things to Drink》(2015)、《調酒的科學》(台灣版)、《分子料理與調酒》(台灣翻譯版)、Journal of Agricultural and Food Chemistry、Food Chemistry 等权威资料。
根据以下自制品信息，一次性补全所有字段。

自制品名称: ${displayName}${knownType}${ingredientList}

请输出 JSON（所有字段必须存在，不确定的字符串填 ""，数组填 []）:
{
  "section": "分区key，必须从以下精确选一: ${VALID_SECTIONS.join("/")}。含酒精(浸渍/利口酒/苦精/改制/发酵)→前5个；无酒精(糖浆/果汁/醋饮/零度/无酒精发酵/装饰)→后6个",
  "prepType": "类型key，必须从以下精确选一: ${VALID_PREP_TYPES.join("/")}，不确定填 \"other\"",
  "techniques": 识别到的工艺key数组，从 ${JSON.stringify(VALID_TECHNIQUES)} 中选0-4个，只能选列表中的值,
  "flavorTags": 风味标签数组，从 ${JSON.stringify(VALID_FLAVOR_TAGS)} 中选1-3个，只能选列表中的值,
  "naturalLanguageDesc": "用英文自然语言描述该自制品的基底烈酒类型（如 'rye whiskey based infusion' 或 'jamaican rum fat wash'），如果不含烈酒基底则填 \"\"",
  "story": "自制品介绍/故事（中文，80字内，描述风味特点和调酒用途），不确定填 \"\"",
  "styleDesc": "风格/口感描述（中文，40字内），不确定填 \"\"",
  "shelfLife": "建议保质期（如'冷藏2周'或'密封常温1个月'），不确定填 \"\"",
  "storage": "储存建议（如'冷藏密封保存，使用前摇匀'），不确定填 \"\"",
  "usageNotes": "调酒用途说明（中文，50字内，如'可替代 Cointreau，适合 Margarita'），不确定填 \"\"",
  "confidence": "high"/"medium"/"low"
}
规则：
- section 和 prepType 必须严格落在上述枚举中
- techniques 只能从给定列表中选，不能自造新key
- flavorTags 只能从给定列表中选
- 只输出 JSON，不要任何解释文字`;
        const signal = AbortSignal.timeout(30_000);
        let response;
        try {
          response = await invokeLLM({
            model: "claude-sonnet",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            signal,
          });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new Error(isTimeout ? "AI 分析超时，请稍后重试" : `AI 分析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const raw = response.choices[0]?.message?.content;
        const parsed = parseJsonObjectLoose(typeof raw === "string" ? raw : "");
        const p = parsed as Record<string, unknown>;

        // ── 严格白名单校验 ──────────────────────────────────────────────
        const rawSection = typeof p.section === "string" ? p.section.trim() : "";
        const validatedSection = VALID_SECTIONS.includes(rawSection) ? rawSection : "";
        const rawPrepType = typeof p.prepType === "string" ? p.prepType.trim() : "";
        const validatedPrepType = VALID_PREP_TYPES.includes(rawPrepType) ? rawPrepType : "other";
        const rawTechniques = Array.isArray(p.techniques) ? (p.techniques as string[]) : [];
        const validatedTechniques = rawTechniques.filter((t) => VALID_TECHNIQUES.includes(t)).slice(0, 4);
        const rawFlavors = Array.isArray(p.flavorTags) ? (p.flavorTags as string[]) : [];
        const validatedFlavors = rawFlavors.filter((f) => VALID_FLAVOR_TAGS.includes(f)).slice(0, 3);

        // ── 语义映射：用名称+AI自然语言描述做确定性匹配 ──────────────────
        const naturalDesc = typeof p.naturalLanguageDesc === "string" ? p.naturalLanguageDesc.trim() : "";
        const searchText = `${input.name} ${input.nameAlt ?? ""} ${naturalDesc} ${(input.ingredients ?? []).join(" ")}`;
        const mapped = resolveLibraryFromText(searchText);

        return {
          section: validatedSection,
          prepType: validatedPrepType,
          techniques: validatedTechniques,
          flavorTags: validatedFlavors,
          story: typeof p.story === "string" ? p.story.trim() : "",
          styleDesc: typeof p.styleDesc === "string" ? p.styleDesc.trim() : "",
          shelfLife: typeof p.shelfLife === "string" ? p.shelfLife.trim() : "",
          storage: typeof p.storage === "string" ? p.storage.trim() : "",
          usageNotes: typeof p.usageNotes === "string" ? p.usageNotes.trim() : "",
          confidence: (["high", "medium", "low"] as const).includes(p.confidence as "high") ? p.confidence as "high" | "medium" | "low" : "medium",
          suggestedLibrary: mapped.suggestedLibrary,
          suggestedCategory: mapped.suggestedCategory,
          suggestedStyle: mapped.suggestedStyle,
          mapConfidence: mapped.mapConfidence,
        };
      }),
    extractRecipesFromText: publicProcedure
      .input(
        z.object({
          text: z.string().max(8000),
          lang: z.enum(["zh", "en", "auto"]).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const prompt = `你是专业调酒师和配方识别专家，精通中英文繁体中文调酒文献（包括 Jerry Thomas《Bartender's Guide》1862、Harry Craddock《The Savoy Cocktail Book》1930、Death & Co《Cocktail Codex》2018、IBA 官方配方、《調酒師手冊》台灣版、《世界雞尾酒大全》台灣版等）。请从以下文字中识别并提取所有鸡尾酒配方。

文字内容：
"""
${input.text}
"""

识别规则：
1. 每个独立的鸡尾酒（有名称+配料）算一个配方
2. 配料行通常包含数量（oz/ml/dash/tsp等）+ 材料名
3. 步骤通常是动词开头的句子（Stir/Shake/Combine等）
4. 如果文字中没有配方，返回空数组

请输出 JSON（严格格式），包含 recipes 数组：
{
  "recipes": [
    {
      "name": "配方名称（原文）",
      "nameZh": "中文名（如能推断，否则空字符串）",
      "author": "作者/来源（如有，否则空字符串）",
      "year": "年份（如有，否则空字符串）",
      "ingredients": [
        { "text": "2 oz Rye Whiskey", "amount": "2", "unit": "oz", "name": "Rye Whiskey", "confidence": "high" }
      ],
      "steps": "完整步骤说明（原文，如无则空字符串）",
      "garnish": "装饰物（如有，否则空字符串）",
      "glass": "杯型（如能推断，否则空字符串）",
      "method": "调制法（如 摇和/搅拌/直调，如能推断，否则空字符串）",
      "notes": "备注/说明（如有，否则空字符串）",
      "confidence": "high|medium|low",
      "missingFields": []
    }
  ]
}

只输出 JSON，不要任何解释文字。`;
        const signal = AbortSignal.timeout(30_000);
        let response;
        try {
          response = await invokeLLM({
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            signal,
          });
        } catch (err: unknown) {
          const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
          throw new Error(isTimeout ? "AI 分析超时，请稍后重试" : `AI 分析失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        const raw = response.choices[0]?.message?.content ?? "";
        let parsed: unknown;
        try {
          const rawStr = typeof raw === "string" ? raw : "";
          parsed = JSON.parse(rawStr);
        } catch {
          const rawStr = typeof raw === "string" ? raw : "";
          const match = rawStr.match(/\[[\s\S]*\]/);
          try { parsed = match ? JSON.parse(match[0]) : { recipes: [] }; } catch { parsed = { recipes: [] }; }
        }
        const arr: unknown[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as Record<string, unknown>)?.recipes)
            ? (parsed as Record<string, unknown>).recipes as unknown[]
            : [];
        return arr.slice(0, 10).map((item) => {
          const r = item as Record<string, unknown>;
          return {
            name: typeof r.name === "string" ? r.name.trim() : "",
            nameZh: typeof r.nameZh === "string" ? r.nameZh.trim() : "",
            author: typeof r.author === "string" ? r.author.trim() : "",
            year: typeof r.year === "string" ? r.year.trim() : "",
            ingredients: Array.isArray(r.ingredients)
              ? (r.ingredients as Record<string, unknown>[]).map((ing) => ({
                  text: typeof ing.text === "string" ? ing.text.trim() : "",
                  amount: typeof ing.amount === "string" ? ing.amount.trim() : "",
                  unit: typeof ing.unit === "string" ? ing.unit.trim() : "",
                  name: typeof ing.name === "string" ? ing.name.trim() : "",
                  confidence: (["high", "medium", "low"] as const).includes(ing.confidence as "high")
                    ? (ing.confidence as "high" | "medium" | "low")
                    : "medium",
                }))
              : [],
            steps: typeof r.steps === "string" ? r.steps.trim() : "",
            garnish: typeof r.garnish === "string" ? r.garnish.trim() : "",
            glass: typeof r.glass === "string" ? r.glass.trim() : "",
            method: typeof r.method === "string" ? r.method.trim() : "",
            notes: typeof r.notes === "string" ? r.notes.trim() : "",
            confidence: (["high", "medium", "low"] as const).includes(r.confidence as "high")
              ? (r.confidence as "high" | "medium" | "low")
              : "medium",
            missingFields: Array.isArray(r.missingFields)
              ? r.missingFields.filter((f): f is string => typeof f === "string")
              : [],
          };
        });
      }),
  }),

  sync: router({
    /** 检查当前登录用户是否有访问权(是否 owner) */
    access: protectedProcedure.query(async ({ ctx }) => {
      const allowed = await ensureOwner(ctx.user);
      return { allowed } as const;
    }),
    /** 拉取云端全部同步数据 */
    pull: protectedProcedure.query(async ({ ctx }) => {
      const allowed = await ensureOwner(ctx.user);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Private app" });
      const entries = await getSyncData(ctx.user.id);
      return { entries } as const;
    }),
    /** 推送本地改动(last-write-wins per key) */
    push: protectedProcedure
      .input(
        z.object({
          entries: z
            .array(
              z.object({
                storageKey: z.string().max(128),
                value: z.string().max(15_000_000),
                clientUpdatedAt: z.number(),
              }),
            )
            .max(40),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const allowed = await ensureOwner(ctx.user);
        if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "Private app" });
        await upsertSyncData(ctx.user.id, input.entries);
        return { success: true, count: input.entries.length } as const;
      }),
  }),
});

export type AppRouter = typeof appRouter;
// ── enrichBottleFull 服务端内存缓存（1小时 TTL，按名称+分类 key 缓存） ──────────
interface EnrichCacheEntry {
  result: Record<string, unknown>;
  expireAt: number;
}
const enrichBottleCache = new Map<string, EnrichCacheEntry>();
const ENRICH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
function getEnrichCacheKey(nameZh?: string, nameEn?: string, brand?: string, category?: string): string {
  return [nameZh ?? "", nameEn ?? "", brand ?? "", category ?? ""].join("|").toLowerCase().trim();
}
function pruneEnrichCache() {
  const now = Date.now();
  for (const [k, v] of enrichBottleCache.entries()) {
    if (v.expireAt < now) enrichBottleCache.delete(k);
  }
}

// ── 实时爬取补全：从公开免费 API 获取冷门酒款数据 ──────────────────────────────
/**
 * 从公开免费数据源获取酒款信息，作为 LLM prompt 的额外上下文。
 * 数据源：
 * 1. TheCocktailDB API（免费、无需 API key、无版权问题）
 * 2. Wikipedia REST API（免费、开放授权）
 * 超时 5 秒，失败静默降级（不影响主流程）
 */
async function fetchWebBottleContext(nameZh?: string, nameEn?: string, brand?: string): Promise<string> {
  const searchName = nameEn || nameZh || brand || "";
  if (!searchName || searchName.length < 2) return "";

  const results: string[] = [];
  const timeout = 5_000;

  // 1. TheCocktailDB — 搜索酒款/配料
  try {
    const cocktailUrl = `https://www.thecocktaildb.com/api/json/v1/1/search.php?i=${encodeURIComponent(searchName)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(cocktailUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json() as { ingredients?: Array<Record<string, string | null>> };
      const items = data.ingredients || [];
      if (items.length > 0) {
        const item = items[0];
        const parts: string[] = [];
        if (item.strIngredient) parts.push(`Name: ${item.strIngredient}`);
        if (item.strType) parts.push(`Type: ${item.strType}`);
        if (item.strAlcohol) parts.push(`Alcohol: ${item.strAlcohol}`);
        if (item.strABV) parts.push(`ABV: ${item.strABV}%`);
        if (item.strDescription) parts.push(`Description: ${item.strDescription.slice(0, 300)}`);
        if (parts.length > 0) {
          results.push(`[TheCocktailDB] ${parts.join(" | ")}`);
        }
      }
    }
  } catch {
    // 静默降级
  }

  // 2. Wikipedia REST API — 获取词条摘要（英文）
  try {
    const wikiName = (nameEn || nameZh || "").replace(/\s+/g, "_");
    if (wikiName.length >= 2) {
      const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiName)}`;
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), timeout);
      const res2 = await fetch(wikiUrl, { signal: ctrl2.signal });
      clearTimeout(timer2);
      if (res2.ok) {
        const data2 = await res2.json() as { title?: string; extract?: string; type?: string };
        if (data2.extract && data2.type !== "disambiguation") {
          results.push(`[Wikipedia] ${data2.title}: ${data2.extract.slice(0, 400)}`);
        }
      }
    }
  } catch {
    // 静默降级
  }

  // 3. 如果有品牌名，尝试 Wikipedia 品牌词条
  if (brand && brand.length >= 2 && brand.toLowerCase() !== (nameEn || "").toLowerCase()) {
    try {
      const brandWikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(brand.replace(/\s+/g, "_"))}`;
      const ctrl3 = new AbortController();
      const timer3 = setTimeout(() => ctrl3.abort(), timeout);
      const res3 = await fetch(brandWikiUrl, { signal: ctrl3.signal });
      clearTimeout(timer3);
      if (res3.ok) {
        const data3 = await res3.json() as { title?: string; extract?: string; type?: string };
        if (data3.extract && data3.type !== "disambiguation") {
          results.push(`[Wikipedia Brand] ${data3.title}: ${data3.extract.slice(0, 300)}`);
        }
      }
    } catch {
      // 静默降级
    }
  }

  if (results.length === 0) return "";
  return `\n\n【联网参考数据（实时爬取）】以下是从公开数据库实时获取的参考信息，请优先参考这些内容补全各字段：\n${results.join("\n")}`;
}
