import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { z } from "zod";
import { invokeLLM, type MessageContent } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  getAppConfigValue,
  getSyncData,
  setAppConfigValue,
  upsertSyncData,
} from "./db";

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
你是专业的烈酒/饮料/原材料知识专家，深度研习 Cocktail Codex（David Wondrich）、The Bar Book（Jeffrey Morgenthaler）、Difford's Guide（Simon Difford）、Liquid Intelligence（Dave Arnold）、WSET 烈酒教材（Level 3/4）、IBA 官方配方库、Whisky Advocate、Wine Spectator、Spirits Business、The Oxford Companion to Spirits & Cocktails 等权威资料与档案库。用户会给出一个或多个酒、原料或产品的名称(可能含品牌、也可能附照片),请根据权威资料补全为结构化条目。

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

        const systemPrompt = `你是专业调酒知识专家兼鸡尾酒历史学家。根据配方信息进行全面深度分析，返回 JSON。

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
  "suggestedVariantOf": "经典变体来源（如：尼格罗尼），不确定返回\"\"",
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
          suggestedGlass: typeof p.suggestedGlass === "string" ? p.suggestedGlass.trim() : "",
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
          suggestedVariantOf: typeof p.suggestedVariantOf === "string" ? p.suggestedVariantOf.trim() : "",
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

        const systemPrompt = `你是一位专业调酒师和鸡尾酒历史学家，拥有丰富的调酒知识。请根据提供的配方信息，进行全面深度分析，返回 JSON 格式结果。

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
  "suggestedVariantOf": "经典变体来源（如：尼格罗尼，不确定留空）",
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
            suggestedBaseSpirit: typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",
            suggestedCodexFamily: typeof p.suggestedCodexFamily === "string" ? p.suggestedCodexFamily.trim() : "",
            suggestedVariantOf: typeof p.suggestedVariantOf === "string" ? p.suggestedVariantOf.trim() : "",
            suggestedMethod: typeof p.suggestedMethod === "string" ? p.suggestedMethod.trim() : "",
            suggestedStrength: typeof p.suggestedStrength === "string" ? p.suggestedStrength.trim() : "",
            suggestedIce: typeof p.suggestedIce === "string" ? p.suggestedIce.trim() : "",
            suggestedGlass: typeof p.suggestedGlass === "string" ? p.suggestedGlass.trim() : "",
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
        const prompt = `你是专业的烈酒/饮料知识专家。根据以下产品信息补全风味与介绍。

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
        const prompt = `你是专业的烈酒/饮料/原材料知识专家，深度研习 Cocktail Codex（David Wondrich）、The Bar Book（Jeffrey Morgenthaler）、Difford's Guide（Simon Difford）、Liquid Intelligence（Dave Arnold）、WSET 烈酒教材（Level 3/4）、IBA 官方配方库、Whisky Advocate、Wine Spectator、Spirits Business、The Oxford Companion to Spirits & Cocktails 等权威资料与档案库。
根据以下产品信息，一次性补全所有字段。

产品名称: ${name || "（未知，请根据照片识别）"}${knownCategory}${knownStyle}${knownBrand}${knownOrigin}
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
  "confidence": "high"/"medium"/"low"（资料把握程度：知名大牌=high，通用品类=medium，勉强猜测=low）
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

        const knownType = input.type ? `\n已知类型: ${input.type}` : "";
        const prompt = `你是专业的调酒师和自制饮品专家（基于 Liquid Intelligence、The Bar Book、Cocktail Codex 等权威资料）。
根据以下自制品信息，一次性补全所有字段。

自制品名称: ${displayName}${knownType}${ingredientList}

请输出 JSON（所有字段必须存在，不确定的字符串填 ""，数组填 []）:
{
  "section": "分区key，必须从以下精确选一: ${VALID_SECTIONS.join("/")}。含酒精(浸渍/利口酒/苦精/改制/发酵)→前5个；无酒精(糖浆/果汁/醋饮/零度/无酒精发酵/装饰)→后6个",
  "prepType": "类型key，必须从以下精确选一: ${VALID_PREP_TYPES.join("/")}，不确定填 \"other\"",
  "techniques": 识别到的工艺key数组，从 ${JSON.stringify(VALID_TECHNIQUES)} 中选0-4个，只能选列表中的值,
  "flavorTags": 风味标签数组，从 ${JSON.stringify(VALID_FLAVOR_TAGS)} 中选1-3个，只能选列表中的值,
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
        const prompt = `你是专业调酒师和配方识别专家。请从以下文字中识别并提取所有鸡尾酒配方。

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
