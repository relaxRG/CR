/**
 * E1 智能三端点路由（Smart Router）
 * CF Worker 主端点 + 自动重试 + 离线降级
 *
 * 多语言策略（方案 D）：
 * 1. 所有 AI 函数接受 lang?: 'zh'|'en'，默认 'zh'，并将其传给 CF Worker
 * 2. CF Worker 返回结果后，枚举字段（method/glass/ice/baseSpirit/category）
 *    通过 normalizeEnumForLang() 规范化为 App 内部标准中文值，
 *    以保证与本地标签库（GLASSES/METHODS/ICE_TYPES/BASE_SPIRITS/BOTTLE_CATEGORIES）精确匹配
 * 3. 自由文本字段（story/notes/styleDesc 等）直接使用 CF Worker 按 lang 生成的内容
 */

import Constants from 'expo-constants';
import { normalizeTagToZh } from '@/lib/recipes/types';
import { getApiBaseUrl } from '@/constants/oauth';
import { splitOrAlternativesClient } from '@/lib/homemade/types';

const CF_WORKER_URL = (Constants.expoConfig?.extra?.cfWorkerUrl as string)
  || 'https://cocktail-ai.kikikong2017.workers.dev';

interface CircuitState { failures: number; lastFailure: number; isOpen: boolean; }
const circuitBreakers: Record<string, CircuitState> = {
  cf: { failures: 0, lastFailure: 0, isOpen: false },
};
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 60_000;

function isCircuitOpen(name: string): boolean {
  const s = circuitBreakers[name];
  if (!s) return false;
  if (s.isOpen && Date.now() - s.lastFailure > CIRCUIT_RESET_MS) { s.isOpen = false; s.failures = 0; }
  return s.isOpen;
}
function recordSuccess(name: string) { const s = circuitBreakers[name]; if (s) { s.failures = 0; s.isOpen = false; } }
function recordFailure(name: string) {
  const s = circuitBreakers[name]; if (!s) return;
  s.failures++; s.lastFailure = Date.now();
  if (s.failures >= CIRCUIT_THRESHOLD) s.isOpen = true;
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const res = await fetch(url, { ...options, signal: controller.signal }); clearTimeout(timer); return res; }
  catch (e) { clearTimeout(timer); throw e; }
}

export type AiRoute = 'enrich-recipe' | 'enrich-recipe/stream' | 'enrich-bottle' | 'enrich-homemade' | 'extract-recipes' | 'ocr' | 'translate' | 'bulk-import';
export interface SmartRouterOptions { timeoutMs?: number; }

// ─────────────────────────────────────────────
// 枚举规范化层
// CF Worker 按 lang 返回不同语言的枚举值，
// 客户端统一通过 normalizeTagToZh 转换为 App 内部标准中文值，
// 以保证与本地标签库精确匹配。
// nameZh/nameEn 等双语名称字段不经过此规范化，保持原样。
// ─────────────────────────────────────────────

/** 将 AI 返回的枚举字段值规范化为 App 内部标准中文值 */
function normalizeEnumForLang(value: string | undefined | null): string {
  if (!value) return '';
  return normalizeTagToZh(value);
}

/** 规范化枚举数组（如 flavorTags/flavors） */
function normalizeEnumArrayForLang(arr: string[] | undefined | null): string[] {
  if (!arr) return [];
  return arr.map(normalizeEnumForLang).filter(Boolean);
}

export class OfflineError extends Error {
  readonly isOffline = true;
  constructor(message: string) { super(message); this.name = 'OfflineError'; }
}

export async function callAI<T = unknown>(route: AiRoute, body: Record<string, unknown>, options: SmartRouterOptions = {}): Promise<T> {
  const { timeoutMs = 45_000 } = options;
  const reqOptions: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };

  if (!isCircuitOpen('cf')) {
    try {
      const res = await fetchWithTimeout(`${CF_WORKER_URL}/api/ai/${route}`, reqOptions, timeoutMs);
      if (res.ok) { recordSuccess('cf'); return await res.json() as T; }
      if (res.status >= 500) recordFailure('cf');
      const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error((errData as { error?: string }).error || `HTTP ${res.status}`);
    } catch (e: unknown) {
      const isNet = e instanceof TypeError || (e instanceof Error && e.name === 'AbortError');
      if (isNet) recordFailure('cf');
      console.warn(`[SmartRouter] CF Worker failed (${route}):`, (e as Error).message);
    }
  }

  // Retry after 1s
  await new Promise(r => setTimeout(r, 1000));
  try {
    const res = await fetchWithTimeout(`${CF_WORKER_URL}/api/ai/${route}`, reqOptions, timeoutMs);
    if (res.ok) { recordSuccess('cf'); return await res.json() as T; }
  } catch { /* fall through */ }

  throw new OfflineError('AI 服务暂时不可用，请检查网络连接后重试');
}

export async function enrichRecipe(params: {
  name: string; nameEn?: string; baseSpirit?: string; method?: string;
  ingredients?: string[]; story?: string;
  flavorDesc?: string; source?: string; rawText?: string; bookTitle?: string;
  lang?: 'zh' | 'en';
}) {
  const result = await callAI<{
    flavors: string[]; flavorConfidence: "high"|"medium"|"low"; story: string; flavorDesc: string; source: string;
    confidence: "high"|"medium"|"low"; suggestedBaseSpirit: string; suggestedBaseSpiritConfidence: "high"|"medium"|"low";
    suggestedGlass: string; suggestedGlassConfidence: "high"|"medium"|"low"; suggestedIce: string; suggestedIceConfidence: "high"|"medium"|"low";
    suggestedMethod: string; suggestedStrength: string; suggestedDrinkDuration: string; suggestedDurationConfidence: "high"|"medium"|"low";
    suggestedOccasion: string; suggestedOccasionConfidence: "high"|"medium"|"low"; suggestedCodexFamily: string;
    suggestedVariantOf: string; variantOfDetail: string; variantOfConfidence: "high"|"medium"|"low";
    creator: string; creatorConfidence: "high"|"medium"|"low"; createdYear: string; createdYearConfidence: "high"|"medium"|"low"; _cached?: boolean;
    suggestedNameZh?: string; suggestedNameEn?: string;
  }>('enrich-recipe', params as Record<string, unknown>);
  return {
    ...result,
    flavors: normalizeEnumArrayForLang(result.flavors),
    suggestedBaseSpirit: normalizeEnumForLang(result.suggestedBaseSpirit),
    suggestedGlass: normalizeEnumForLang(result.suggestedGlass),
    suggestedIce: normalizeEnumForLang(result.suggestedIce),
    suggestedMethod: normalizeEnumForLang(result.suggestedMethod),
    suggestedOccasion: normalizeEnumForLang(result.suggestedOccasion),
    suggestedCodexFamily: normalizeEnumForLang(result.suggestedCodexFamily),
  };
}

export async function enrichBottle(params: {
  nameZh?: string; nameEn?: string; category?: string; style?: string; brand?: string; origin?: string;
  imageBase64?: string; imageMime?: string; bookSnippets?: string[]; cellarBottles?: string[];
  lang?: 'zh' | 'en';
}) {
  const result = await callAI<{
    found: boolean; nameZh: string; nameEn: string; category: string; style: string; brand: string;
    origin: string; volume: string; abv: number; priceCny: number; notes: string; flavorTags: string[];
    story: string; styleDesc: string; distilleryInfo: string; pairingNotes: string; usageNotes: string; seasonality: string;
    confidence: "high"|"medium"|"low";
    notesEn: string; storyEn: string;
    substituteFor: string; pairsWith: string;
    _cached?: boolean;
  }>('enrich-bottle', params as Record<string, unknown>);
  return {
    ...result,
    category: normalizeEnumForLang(result.category) || result.category,
    flavorTags: normalizeEnumArrayForLang(result.flavorTags),
  };
}

export async function enrichHomemade(params: {
  name: string; nameAlt?: string; type?: string;
  ingredients?: Array<{ name: string; amount: string }>;
  lang?: 'zh' | 'en';
}) {
  type HomemadeRaw = {
    section: string; prepType: string; techniques: string[]; flavorTags: string[];
    nameZh: string; nameEn: string;
    story: string; styleDesc: string; shelfLife: string; storage: string; usageNotes: string;
    steps: string; yieldQty: number | null; yieldUnit: string;
    sourceFamilyKey: string; variantLabel: string;
    prepIngredients: Array<{ name: string; amount: string; alternatives?: string[] }>;
    confidence: string;
    suggestedLibrary: string; suggestedCategory: string; suggestedStyle: string; mapConfidence: string;
  };

  // 尝试 CF Worker，若返回结果缺少 nameZh/nameEn（旧版 Worker），则回落到本地 tRPC server
  let cfResult: HomemadeRaw | null = null;
  try {
    cfResult = await callAI<HomemadeRaw>('enrich-homemade', params as Record<string, unknown>);
  } catch {
    // CF Worker 不可用，直接走本地 server
  }

  // 如果 CF Worker 返回了完整字段（有 nameZh 或 nameEn），直接使用
  if (cfResult && (cfResult.nameZh || cfResult.nameEn)) {
    return {
      ...cfResult,
      flavorTags: normalizeEnumArrayForLang(cfResult.flavorTags),
      nameZh: cfResult.nameZh ?? '',
      nameEn: cfResult.nameEn ?? '',
      steps: cfResult.steps ?? '',
      yieldQty: cfResult.yieldQty ?? null,
      yieldUnit: cfResult.yieldUnit ?? '',
      sourceFamilyKey: cfResult.sourceFamilyKey ?? '',
      variantLabel: cfResult.variantLabel ?? '',
      prepIngredients: (cfResult.prepIngredients ?? []).map(ing => {
        const split = splitOrAlternativesClient(ing.name);
        return { name: split.name, amount: ing.amount, ...(split.alternatives?.length ? { alternatives: split.alternatives } : {}) };
      }),
    };
  }

  // 回落到本地 tRPC server（lookup.enrichHomemade）
  const apiBase = getApiBaseUrl();
  const trpcUrl = `${apiBase}/api/trpc/lookup.enrichHomemade`;
  const trpcRes = await fetchWithTimeout(trpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: params }),
  }, 35_000);
  if (!trpcRes.ok) {
    throw new Error(`本地 AI 服务返回错误: HTTP ${trpcRes.status}`);
  }
  const trpcData = await trpcRes.json() as { result?: { data?: { json?: HomemadeRaw } } };
  const localResult: HomemadeRaw = trpcData?.result?.data?.json ?? {} as HomemadeRaw;

  // 如果 CF Worker 有部分字段，合并（CF Worker 的字段优先，本地补充缺失的）
  const merged: HomemadeRaw = cfResult ? {
    ...localResult,
    // CF Worker 已有的字段保留
    section: cfResult.section || localResult.section || '',
    prepType: cfResult.prepType || localResult.prepType || 'other',
    techniques: cfResult.techniques?.length ? cfResult.techniques : (localResult.techniques ?? []),
    flavorTags: cfResult.flavorTags?.length ? cfResult.flavorTags : (localResult.flavorTags ?? []),
    story: cfResult.story || localResult.story || '',
    styleDesc: cfResult.styleDesc || localResult.styleDesc || '',
    shelfLife: cfResult.shelfLife || localResult.shelfLife || '',
    storage: cfResult.storage || localResult.storage || '',
    usageNotes: cfResult.usageNotes || localResult.usageNotes || '',
    confidence: cfResult.confidence || localResult.confidence || 'medium',
    // 本地补充的字段
    nameZh: localResult.nameZh ?? '',
    nameEn: localResult.nameEn ?? '',
    steps: localResult.steps ?? '',
    yieldQty: localResult.yieldQty ?? null,
    yieldUnit: localResult.yieldUnit ?? '',
    sourceFamilyKey: localResult.sourceFamilyKey ?? '',
    variantLabel: localResult.variantLabel ?? '',
    prepIngredients: localResult.prepIngredients ?? [],
    suggestedLibrary: localResult.suggestedLibrary || cfResult.suggestedLibrary || '',
    suggestedCategory: localResult.suggestedCategory || cfResult.suggestedCategory || '',
    suggestedStyle: localResult.suggestedStyle || cfResult.suggestedStyle || '',
    mapConfidence: localResult.mapConfidence || cfResult.mapConfidence || 'none',
  } : localResult;

  return {
    ...merged,
    flavorTags: normalizeEnumArrayForLang(merged.flavorTags),
    nameZh: merged.nameZh ?? '',
    nameEn: merged.nameEn ?? '',
    steps: merged.steps ?? '',
    yieldQty: merged.yieldQty ?? null,
    yieldUnit: merged.yieldUnit ?? '',
    sourceFamilyKey: merged.sourceFamilyKey ?? '',
    variantLabel: merged.variantLabel ?? '',
    prepIngredients: merged.prepIngredients ?? [],
  };
}
export type EnrichHomemadeResult = Awaited<ReturnType<typeof enrichHomemade>>;

export async function extractRecipesFromText(params: { text: string; lang?: 'zh' | 'en' | 'auto' }) {
  const results = await callAI<Array<{
    name: string; nameZh: string; author: string; year: string;
    ingredients: Array<{ text: string; amount: string; unit: string; name: string; confidence: string }>;
    steps: string; garnish: string; glass: string; method: string; notes: string; confidence: string; missingFields: string[];
  }>>('extract-recipes', params as Record<string, unknown>);
  return results.map(r => ({
    ...r,
    glass: normalizeEnumForLang(r.glass) || r.glass,
    method: normalizeEnumForLang(r.method) || r.method,
  }));
}

export async function ocrImages(params: { images?: Array<{ base64: string; mime: string }>; pdfBase64?: string }) {
  // OCR 走 Worker v3（Qwen-VL-Max 中文主力 + Gemini 2.0 Flash 英文/备用）
  // 完全脱离 Manus server
  return callAI<{ text: string }>('ocr', params as Record<string, unknown>, { timeoutMs: 90_000 });
}

export async function translateRecipes(params: {
  target: 'zh' | 'en';
  items: Array<{ id: string; name: string; ingredients: Array<{ name: string; amount: string }>; steps: string; garnish: string; glass: string; method: string }>;
}) {
  return callAI<{
    items: Array<{ id: string; name: string; ingredients: Array<{ name: string; amount: string }>; steps: string; garnish: string; glass: string; method: string }>;
  }>('translate', params as Record<string, unknown>, { timeoutMs: 60_000 });
}

export async function bulkImportExtract(params: {
  text?: string; imageBase64?: string; imageMime?: string; fileBase64?: string; fileName?: string;
  lang?: 'zh' | 'en';
}) {
  const result = await callAI<{
    items: Array<{
      type: 'bottle' | 'prep' | 'recipe' | 'material'; nameZh: string; nameEn: string; category: string;
      style: string; brand: string; origin: string; volume: string; abv: number; priceCny: number;
      prepIngredients: Array<{ name: string; amount: string }>; prepRecipe: string; prepYield: string; shelfLife: string; storage: string;
      baseSpirit: string; glass: string; method: string; ingredients: Array<{ name: string; amount: string }>;
      steps: string; garnish: string; source: string; variantOf: string; codexFamily: string; notes: string;
    }>;
  }>('bulk-import', params as Record<string, unknown>, { timeoutMs: 90_000 });
  return {
    items: result.items.map(item => ({
      ...item,
      category: normalizeEnumForLang(item.category) || item.category,
      baseSpirit: normalizeEnumForLang(item.baseSpirit) || item.baseSpirit,
      glass: normalizeEnumForLang(item.glass) || item.glass,
      method: normalizeEnumForLang(item.method) || item.method,
    })),
  };
}

export async function getDeepSeekBalance(): Promise<{ balance: number | null; currency: string; timestamp: number }> {
  const res = await fetchWithTimeout(`${CF_WORKER_URL}/api/balance`, { method: 'GET' }, 10_000);
  if (!res.ok) throw new Error(`Balance check failed: HTTP ${res.status}`);
  return res.json();
}

/** 配方深度分析（使用更强大的分析能力） */
export async function deepAnalyzeRecipe(params: {
  name?: string;
  nameEn?: string;
  ingredients?: string;
  baseSpirit?: string;
  source?: string;
  lang?: 'zh' | 'en';
}) {
  const result = await callAI<{
    story: string;
    flavorDesc: string;
    source: string;
    creator: string;
    createdYear: string;
    suggestedBaseSpirit: string;
    suggestedCodexFamily: string;
    suggestedVariantOf: string;
    variantOfDetail: string;
    variantOfConfidence: "high"|"medium"|"low";
    suggestedMethod: string;
    suggestedStrength: string;
    suggestedIce: string;
    suggestedGlass: string;
    flavors: string[];
    confidence: "high"|"medium"|"low";
    isDeepAnalysis: boolean;
    suggestedNameZh?: string;
    suggestedNameEn?: string;
  }>('deep-analyze-recipe' as AiRoute, params as Record<string, unknown>, { timeoutMs: 60_000 });
  return {
    ...result,
    flavors: normalizeEnumArrayForLang(result.flavors),
    suggestedBaseSpirit: normalizeEnumForLang(result.suggestedBaseSpirit),
    suggestedGlass: normalizeEnumForLang(result.suggestedGlass),
    suggestedIce: normalizeEnumForLang(result.suggestedIce),
    suggestedMethod: normalizeEnumForLang(result.suggestedMethod),
    suggestedCodexFamily: normalizeEnumForLang(result.suggestedCodexFamily),
  };
}

/** 批量补全瓶子资料（用于 recipe/[id].tsx 的缺失原材料补全） */
export async function enrichBottles(params: { names: string[]; lang?: 'zh' | 'en' }) {
  const result = await callAI<{
    items: Array<{
      query: string; found: boolean; nameZh: string; nameEn: string; category: string; style: string; brand: string;
      origin: string; volume: string; abv: number; priceCny: number; notes: string;
      flavorTags: string[]; story: string; usageNotes: string; confidence: "high"|"medium"|"low";
    }>;
  }>('enrich-bottles' as AiRoute, params as Record<string, unknown>, { timeoutMs: 45_000 });
  return {
    items: result.items.map(item => ({
      ...item,
      category: normalizeEnumForLang(item.category) || item.category,
      flavorTags: normalizeEnumArrayForLang(item.flavorTags),
    })),
  };
}
