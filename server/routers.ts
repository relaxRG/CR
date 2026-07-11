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

请输出 JSON:
{"items":[{
  "query":"原样返回用户给出的名称(附照片且无名称时填识别出的名称)",
  "found": true,
  "nameZh":"中文名(通用译名,如 君度橙酒)","nameEn":"英文名(如 Cointreau)",
  "category":"必须从以下枚举精确选一:金酒/朗姆/伏特加/威士忌/龙舌兰/白兰地/利口酒/苦精/味美思/开胃酒/起泡酒/葡萄酒/清酒烧酒/中式白酒/糖浆/软饮/糖与甜味剂/果蔬/香料与草本/花卉/茶咖与可可/坚果与谷物/乳蛋/酸类与添加剂/其他",
  "style":"风格子分类(如 London Dry / Bourbon / Orange Liqueur),不确定填 \\"\\"",
  "brand":"品牌(如 Cointreau)","origin":"产地国家/地区","volume":"常见规格如 700ml","abv":40,"priceCny":170,
  "notes":"一句话简介:风味特征、常见用途、代表配方等(中文,50 字内)",
  "confidence":"high"|"medium"|"low"
}]}
规则:
- 每个名称对应一个条目,不得增删;完全无法识别的名称输出 {"query":"原名","found":false}
- 数值字段 abv/priceCny 输出数字:abv 未知填 0;priceCny 给出中国市场常见零售价的合理估计(元),完全无从估计填 0
- 未知字符串字段填 ""
- category 必须严格落在上述枚举中,选最贴切的一个;是自制/新鲜原料时也归入最接近的分类
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
          source: z.string().max(500).optional(),
          story: z.string().max(2000).optional(),
          flavorDesc: z.string().max(2000).optional(),
          existingSpirits: z.array(z.string().max(100)).max(50).optional(),
          existingGlasses: z.array(z.string().max(100)).max(50).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        // 17 个精炼风味标签（与客户端 FLAVOR_TAGS 保持一致）
        const VALID_FLAVOR_TAGS = ["酸","甜","苦","烈","鲜","柑橘","热带","草本","花香","烟熏","木桶","香料","坚果可可","清爽","浓郁","干爽","复杂"];
        const spiritList = (input.existingSpirits ?? []).join("、") || "金酒、朗姆、伏特加、威士忌、龙舌兰、白兰地、利口酒、无酒精、其他";
        const glassList = (input.existingGlasses ?? []).join("、") || "马天尼杯、古典杯、高球杯、柯林杯、库佩杯、飓风杯、子弹杯、其他";
        const prompt = `你是专业调酒知识专家。根据以下鸡尾酒信息，尽可能准确地补全资料。如果你熟悉这款鸡尾酒，请给出高置信度；如果只能从配料推断，请如实标注置信度。

配方名称: ${input.name}${input.nameEn ? ` (${input.nameEn})` : ""}
${input.baseSpirit ? `基酒: ${input.baseSpirit}` : ""}
${input.method ? `调制方式: ${input.method}` : ""}
${(input.ingredients ?? []).length > 0 ? `配料: ${(input.ingredients ?? []).join(", ")}` : ""}

可选基酒列表（优先从此列表中选择）: ${spiritList}
可选杯型列表（优先从此列表中选择）: ${glassList}

请输出 JSON（严格按照以下格式）:
{
  "flavors": 从 ["酸","甜","苦","烈","鲜","柑橘","热带","草本","花香","烟熏","木桶","香料","坚果可可","清爽","浓郁","干爽","复杂"] 中选出最贴切的2-5个标签（数组，只能从上面列表中选，不能自造），
  "flavorConfidence": "high"（你对这款鸡尾酒非常熟悉，风味标签有把握）| "medium"（有一定了解，标签较可靠）| "low"（主要靠配料推断，不太确定），
  "story": "${input.story ? "(已有内容,如有更好信息可补充,否则返回空字符串)" : "这款鸡尾酒的历史来历与创作故事(中文,100字内),不清楚则返回空字符串"}",
  "flavorDesc": "${input.flavorDesc ? "(已有内容,如有更好信息可补充,否则返回空字符串)" : "风味描述:口感特点与风味层次(中文,50字内),不清楚则返回空字符串"}",
  "source": "${input.source ? "(已有内容,不要修改,返回空字符串)" : "引用来源:如 'IBA Official Cocktail' / 'The Savoy Cocktail Book' / 调酒师名字等,不确定则返回空字符串"}",
  "confidence": "high"|"medium"|"low"（对整体补全结果的置信度）,
  "suggestedBaseSpirit": "${input.baseSpirit ? "(已有基酒,返回空字符串)" : "推荐基酒（优先从可选基酒列表中选，若列表中没有合适的可自由填写，不确定则返回空字符串）"}",
  "suggestedBaseSpiritConfidence": "high"|"medium"|"low",
  "suggestedGlass": "推荐杯型（优先从可选杯型列表中选，若列表中没有合适的可自由填写，不确定则返回空字符串）",
  "suggestedGlassConfidence": "high"|"medium"|"low",
  "suggestedIce": "推荐冰块类型（如：大方冰/碎冰/球冰/标准方冰/长条冰/无冰，不确定则返回空字符串）",
  "suggestedIceConfidence": "high"|"medium"|"low"
}`;
        // 25s timeout to prevent hang
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
        // 过滤：只保留合法的 17 个标签
        const rawFlavors = Array.isArray(p.flavors) ? (p.flavors as string[]) : [];
        const validFlavors = rawFlavors.filter((f) => VALID_FLAVOR_TAGS.includes(f)).slice(0, 6);
        const validConf = (v: unknown): "high" | "medium" | "low" =>
          (["high", "medium", "low"] as const).includes(v as "high") ? v as "high" | "medium" | "low" : "medium";
        return {
          flavors: validFlavors,
          story: typeof p.story === "string" ? p.story.trim() : "",
          flavorDesc: typeof p.flavorDesc === "string" ? p.flavorDesc.trim() : "",
          source: typeof p.source === "string" ? p.source.trim() : "",
          confidence: validConf(p.confidence),
          flavorConfidence: validConf(p.flavorConfidence),
          suggestedBaseSpirit: typeof p.suggestedBaseSpirit === "string" ? p.suggestedBaseSpirit.trim() : "",
          suggestedBaseSpiritConfidence: validConf(p.suggestedBaseSpiritConfidence),
          suggestedGlass: typeof p.suggestedGlass === "string" ? p.suggestedGlass.trim() : "",
          suggestedGlassConfidence: validConf(p.suggestedGlassConfidence),
          suggestedIce: typeof p.suggestedIce === "string" ? p.suggestedIce.trim() : "",
          suggestedIceConfidence: validConf(p.suggestedIceConfidence),
        };
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
          const r = enrichSchema.safeParse(it);
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
        const prompt = `你是专业的调酒师和自制饮品专家。根据以下自制品信息，补全风味描述、制作故事和储存说明。
自制品名称: ${displayName}
${input.type ? `类型: ${input.type}` : ""}${ingredientList}

请输出 JSON:
{
  "story": "自制品介绍/故事(中文,80字内,描述风味特点和用途,不确定则返回空字符串)",
  "styleDesc": "风格/口感描述(中文,40字内,不确定则返回空字符串)",
  "shelfLife": "建议保质期(如'冷藏2周'或'密封常温1个月',不确定则返回空字符串)",
  "storage": "储存建议(如'冷藏密封保存,使用前摇匀',不确定则返回空字符串)",
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
          story: typeof p.story === "string" ? p.story.trim() : "",
          styleDesc: typeof p.styleDesc === "string" ? p.styleDesc.trim() : "",
          shelfLife: typeof p.shelfLife === "string" ? p.shelfLife.trim() : "",
          storage: typeof p.storage === "string" ? p.storage.trim() : "",
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
