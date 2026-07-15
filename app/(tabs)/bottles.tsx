import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import DraggableFlatList, {
  ScaleDecorator,
  RenderItemParams,
} from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenContainer } from "@/components/screen-container";
import { FilterSortSheet, FilterDimension } from "@/components/filter-sort-sheet";
import { BulkActionBar, BulkEditSheet } from "@/components/bulk-action-bar";
import {
  QuickFilterChips,
  QuickParentOption,
  QuickSelection,
} from "@/components/quick-filter-chips";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useI18n } from "@/lib/i18n";
import { filterBottles, useBottleStore } from "@/lib/bottles/store";
import { applyEnrichedToBottle } from "@/lib/bottles/enrich";
import type { BottleDraft } from "@/lib/bottles/store";
import { enrichBottle } from "@/lib/api/smart-router";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { groupFormFamilies, type FormFamily } from "@/lib/bottles/form-family";
import { sortBottles, BOTTLE_SORTS, BottleSort } from "@/lib/recipes/sort";
import {
  BOTTLE_GROUPS,
  Bottle,
} from "@/lib/bottles/types";
import { useCardTagSettings } from "@/lib/settings/card-tags";
import { useNetwork } from "@/hooks/use-network";
import { useBookStore } from "@/lib/books/store";
import { lookupInOfflineKb, extractBookSnippets, offlineEntryToEnrichResult } from "@/lib/bottles/offline-lookup";
import { useRecipeStore } from "@/lib/recipes/store";
import { smartLinkIngredient } from "@/lib/recipes/smart-link";
import type { Recipe } from "@/lib/recipes/types";

export default function BottlesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { ready, bottles, reorderBottles, deleteBottles, bulkUpdateBottles, updateBottle } =
    useBottleStore();
  const { duplicateBottle } = useBottleStore();
  const { recipes } = useRecipeStore();
  const {
    categoryLabel,
    stylesOf,
    categoriesOfGroup: taxCategoriesOfGroup,
    groupOf,
  } = useBottleTaxonomy();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"spirits" | "bottles" | "materials">("spirits");
  // 多选模式:批量删除/批量改分类/风格
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSheet, setBulkSheet] = useState<"category" | "style" | null>(null);
  // 快捷筛选(独立于 Filter 面板,持久化保留):类别 → 风格子分类;按分组分别存储
  const [quickSelSpirits, setQuickSelSpirits] = usePersistedState<QuickSelection>(
    "quick.bottles.spirits.v1",
    {},
  );
  const [quickSelBottles, setQuickSelBottles] = usePersistedState<QuickSelection>(
    "quick.bottles.bottles.v1",
    {},
  );
  const [quickSelMaterials, setQuickSelMaterials] = usePersistedState<QuickSelection>(
    "quick.bottles.materials.v1",
    {},
  );
  const quickSel =
    group === "materials"
      ? quickSelMaterials
      : group === "spirits"
        ? quickSelSpirits
        : quickSelBottles;
  const setQuickSel =
    group === "materials"
      ? setQuickSelMaterials
      : group === "spirits"
        ? setQuickSelSpirits
        : setQuickSelBottles;
  // Filter 面板多选筛选状态(与快捷筛选相互独立)
  const [selCategories, setSelCategories] = useState<string[]>([]);
  const [selStyles, setSelStyles] = useState<string[]>([]);
  const [sort, setSort] = useState<BottleSort>("default");
  const [sheetOpen, setSheetOpen] = useState(false);

  const { isOnline } = useNetwork();
  const { books } = useBookStore();

 const groupBottles = useMemo(
    () => bottles.filter((b) => {
      // 归入自制库的条目不在酒款库显示
      if (b.libraryOverride === 'homemade') return false;
      // 手动强制路由：libraryOverride 与当前分组匹配则显示
      if (b.libraryOverride === 'spirits') return group === 'spirits';
      if (b.libraryOverride === 'bottles') return group === 'bottles';
      if (b.libraryOverride === 'materials') return group === 'materials';
      // 未设置 override 时按 category 自动判断
      return groupOf(b.category) === group;
    }),
   [bottles, group, groupOf],
 );

  // ── AI 建议队列状态机 ──────────────────────────────────────────────────────
  // 三种模式共用同一队列：
  //   "review"      Banner 逐条确认
  //   "autofill"    Banner 批量自动填空白
  //   "sel-review"  多选逐条确认
  //   "sel-autofill"多选批量自动填空白
  type QueueMode = "review" | "autofill" | "sel-review" | "sel-autofill";
  type FullResult = Awaited<ReturnType<typeof enrichBottle>>;
  type AiField = { key: string; labelZh: string; aiValue: string; currentValue: string; conflict: "new" | "override" | "confirm" | "low" };

  // Prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);


  const [aiQueue, setAiQueue] = useState<Bottle[]>([]);
  const [aiQueueIdx, setAiQueueIdx] = useState(0);
  const [aiQueueMode, setAiQueueMode] = useState<QueueMode>("review");
  const [aiQueueResult, setAiQueueResult] = useState<FullResult | null>(null);
  const [aiQueueToggles, setAiQueueToggles] = useState<Record<string, boolean>>({});
  const [aiQueueFetching, setAiQueueFetching] = useState(false);
  const [aiQueueDone, setAiQueueDone] = useState<{ applied: number; skipped: number } | null>(null);
  const [aiQueueError, setAiQueueError] = useState<string | null>(null);
  const aiQueueDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 配方联动提示：当前 AI 结果影响的配方列表
  const [linkedRecipes, setLinkedRecipes] = useState<Recipe[]>([]);

  const clearAiQueue = useCallback(() => {
    setAiQueue([]);
    setAiQueueIdx(0);
    setAiQueueResult(null);
    setAiQueueToggles({});
    setAiQueueFetching(false);
    setAiQueueDone(null);
    setAiQueueError(null);
    setLinkedRecipes([]);
  }, []);

  // 切换分组时清空队列，防止孤立引用
  useEffect(() => { clearAiQueue(); }, [group]); // eslint-disable-line react-hooks/exhaustive-deps

  // 卸载时清除 done timer
  useEffect(() => {
    return () => { if (aiQueueDoneTimerRef.current) clearTimeout(aiQueueDoneTimerRef.current); };
  }, []);

  /** 构建当前条目的 AI 字段对比列表 */
  const buildQueueFields = useCallback((b: Bottle, res: FullResult): AiField[] => {
    const conf = (cur: string, ai: string, c: "high" | "medium" | "low"): AiField["conflict"] => {
      if (!cur.trim()) return "new";
      if (cur.trim().toLowerCase() === ai.trim().toLowerCase()) return "confirm";
      if (c === "low") return "low";
      return "override";
    };
    const fields: AiField[] = [];
    if (res.nameZh) fields.push({ key: "nameZh", labelZh: "中文名", aiValue: res.nameZh, currentValue: b.nameZh, conflict: conf(b.nameZh, res.nameZh, res.confidence) });
    if (res.nameEn) fields.push({ key: "nameEn", labelZh: "英文名", aiValue: res.nameEn, currentValue: b.nameEn, conflict: conf(b.nameEn, res.nameEn, res.confidence) });
    if (res.category) fields.push({ key: "category", labelZh: "分类", aiValue: res.category, currentValue: b.category, conflict: conf(b.category, res.category, res.confidence) });
    if (res.style) fields.push({ key: "style", labelZh: "风格", aiValue: res.style, currentValue: b.style, conflict: conf(b.style, res.style, res.confidence) });
    if (res.brand) fields.push({ key: "brand", labelZh: "品牌", aiValue: res.brand, currentValue: b.brand, conflict: conf(b.brand, res.brand, res.confidence) });
    if (res.origin) fields.push({ key: "origin", labelZh: "产地", aiValue: res.origin, currentValue: b.origin, conflict: conf(b.origin, res.origin, res.confidence) });
    if (res.volume) fields.push({ key: "volume", labelZh: "容量", aiValue: res.volume, currentValue: b.volume, conflict: conf(b.volume, res.volume, res.confidence) });
    if (res.abv > 0) fields.push({ key: "abv", labelZh: "酒精度", aiValue: `${res.abv}%`, currentValue: b.abv > 0 ? `${b.abv}%` : "", conflict: conf(b.abv > 0 ? String(b.abv) : "", String(res.abv), res.confidence) });
    if (res.priceCny > 0) fields.push({ key: "price", labelZh: "参考价", aiValue: `¥${res.priceCny}`, currentValue: b.priceCny > 0 ? `¥${b.priceCny}` : "", conflict: conf(b.priceCny > 0 ? String(b.priceCny) : "", String(res.priceCny), res.confidence) });
    if (res.flavorTags?.length > 0) {
      const curStr = b.flavorTags?.length > 0 ? b.flavorTags.slice(0, 3).join(" · ") : "";
      const aiStr = res.flavorTags.slice(0, 4).join(" · ") + (res.flavorTags.length > 4 ? ` +${res.flavorTags.length - 4}` : "");
      fields.push({ key: "flavorTags", labelZh: "风味标签", aiValue: aiStr, currentValue: curStr, conflict: conf(curStr, aiStr, res.confidence) });
    }
    if (res.story) fields.push({ key: "story", labelZh: "故事/介绍", aiValue: res.story.slice(0, 50) + (res.story.length > 50 ? "…" : ""), currentValue: b.story ? b.story.slice(0, 30) + "…" : "", conflict: conf(b.story ?? "", res.story, res.confidence) });
    if (res.styleDesc) fields.push({ key: "styleDesc", labelZh: "风格描述", aiValue: res.styleDesc.slice(0, 50) + (res.styleDesc.length > 50 ? "…" : ""), currentValue: b.styleDesc ? b.styleDesc.slice(0, 30) + "…" : "", conflict: conf(b.styleDesc ?? "", res.styleDesc, res.confidence) });
    if (res.distilleryInfo) fields.push({ key: "distilleryInfo", labelZh: "蒸馏厂", aiValue: res.distilleryInfo.slice(0, 50) + (res.distilleryInfo.length > 50 ? "…" : ""), currentValue: b.distilleryInfo ? b.distilleryInfo.slice(0, 30) + "…" : "", conflict: conf(b.distilleryInfo ?? "", res.distilleryInfo, res.confidence) });
    if (res.pairingNotes) fields.push({ key: "pairingNotes", labelZh: "搭配建议", aiValue: res.pairingNotes.slice(0, 50) + (res.pairingNotes.length > 50 ? "…" : ""), currentValue: b.pairingNotes ? b.pairingNotes.slice(0, 30) + "…" : "", conflict: conf(b.pairingNotes ?? "", res.pairingNotes, res.confidence) });
    if (res.usageNotes) fields.push({ key: "usageNotes", labelZh: "调酒用途", aiValue: res.usageNotes.slice(0, 50) + (res.usageNotes.length > 50 ? "…" : ""), currentValue: b.usageNotes ? b.usageNotes.slice(0, 30) + "…" : "", conflict: conf(b.usageNotes ?? "", res.usageNotes, res.confidence) });
    if (res.seasonality) fields.push({ key: "seasonality", labelZh: "季节性", aiValue: res.seasonality, currentValue: b.seasonality ?? "", conflict: conf(b.seasonality ?? "", res.seasonality, res.confidence) });
    // 双语字段
    if ((res as { notesEn?: string }).notesEn) fields.push({ key: "notesEn", labelZh: "英文简介", aiValue: ((res as { notesEn?: string }).notesEn ?? "").slice(0, 50) + (((res as { notesEn?: string }).notesEn ?? "").length > 50 ? "…" : ""), currentValue: (b as { notesEn?: string }).notesEn ? ((b as { notesEn?: string }).notesEn ?? "").slice(0, 30) + "…" : "", conflict: conf((b as { notesEn?: string }).notesEn ?? "", (res as { notesEn?: string }).notesEn ?? "", res.confidence) });
    if ((res as { storyEn?: string }).storyEn) fields.push({ key: "storyEn", labelZh: "英文故事", aiValue: ((res as { storyEn?: string }).storyEn ?? "").slice(0, 50) + (((res as { storyEn?: string }).storyEn ?? "").length > 50 ? "…" : ""), currentValue: (b as { storyEn?: string }).storyEn ? ((b as { storyEn?: string }).storyEn ?? "").slice(0, 30) + "…" : "", conflict: conf((b as { storyEn?: string }).storyEn ?? "", (res as { storyEn?: string }).storyEn ?? "", res.confidence) });
    // 关联推理字段
    if ((res as { substituteFor?: string }).substituteFor) fields.push({ key: "substituteFor", labelZh: "可替代", aiValue: (res as { substituteFor?: string }).substituteFor ?? "", currentValue: (b as { substituteFor?: string }).substituteFor ?? "", conflict: "new" });
    if ((res as { pairsWith?: string }).pairsWith) fields.push({ key: "pairsWith", labelZh: "搭配酒款", aiValue: (res as { pairsWith?: string }).pairsWith ?? "", currentValue: (b as { pairsWith?: string }).pairsWith ?? "", conflict: "new" });
    return fields;
  }, []);

  /** 将 AI 结果中 toggle=true 的字段写入酒款 */
  const applyQueueFields = useCallback((b: Bottle, res: FullResult, toggles: Record<string, boolean>): BottleDraft => {
    const get = (key: string) => toggles[key] !== false;
    return {
      nameZh: get("nameZh") && res.nameZh ? res.nameZh : b.nameZh,
      nameEn: get("nameEn") && res.nameEn ? res.nameEn : b.nameEn,
      category: get("category") && res.category ? res.category : b.category,
      style: get("style") && res.style ? res.style : b.style,
      brand: get("brand") && res.brand ? res.brand : b.brand,
      origin: get("origin") && res.origin ? res.origin : b.origin,
      volume: get("volume") && res.volume ? res.volume : b.volume,
      abv: get("abv") && res.abv > 0 ? res.abv : b.abv,
      priceCny: get("price") && res.priceCny > 0 ? res.priceCny : b.priceCny,
      notes: b.notes,
      flavorTags: get("flavorTags") && res.flavorTags?.length > 0 ? res.flavorTags : (b.flavorTags ?? []),
      story: get("story") && res.story ? res.story : (b.story ?? ""),
      styleDesc: get("styleDesc") && res.styleDesc ? res.styleDesc : (b.styleDesc ?? ""),
      distilleryInfo: get("distilleryInfo") && res.distilleryInfo ? res.distilleryInfo : (b.distilleryInfo ?? ""),
      pairingNotes: get("pairingNotes") && res.pairingNotes ? res.pairingNotes : (b.pairingNotes ?? ""),
      usageNotes: get("usageNotes") && res.usageNotes ? res.usageNotes : (b.usageNotes ?? ""),
      seasonality: get("seasonality") && res.seasonality ? res.seasonality : (b.seasonality ?? ""),
      rating: b.rating,
      notesEn: get("notesEn") && (res as { notesEn?: string }).notesEn ? (res as { notesEn?: string }).notesEn : ((b as { notesEn?: string }).notesEn ?? ""),
      storyEn: get("storyEn") && (res as { storyEn?: string }).storyEn ? (res as { storyEn?: string }).storyEn : ((b as { storyEn?: string }).storyEn ?? ""),
      substituteFor: get("substituteFor") && (res as { substituteFor?: string }).substituteFor ? (res as { substituteFor?: string }).substituteFor : ((b as { substituteFor?: string }).substituteFor ?? ""),
      pairsWith: get("pairsWith") && (res as { pairsWith?: string }).pairsWith ? (res as { pairsWith?: string }).pairsWith : ((b as { pairsWith?: string }).pairsWith ?? ""),
    };
  }, []);

  /** 自动填空白：只填 conflict==="new" 的字段 */
  const autoFillBlanks = useCallback((b: Bottle, res: FullResult): BottleDraft => {
    const fields = buildQueueFields(b, res);
    const blanksOnly: Record<string, boolean> = {};
    for (const f of fields) blanksOnly[f.key] = f.conflict === "new";
    return applyQueueFields(b, res, blanksOnly);
  }, [buildQueueFields, applyQueueFields]);

  /** 拉取队列中第 idx 条的 AI 结果（appliedSoFar 用于完成统计） */
  const fetchQueueItem = useCallback(async (queue: Bottle[], idx: number, mode: QueueMode, appliedSoFar: number) => {
    if (idx >= queue.length) {
      if (isMountedRef.current) {
        setAiQueueFetching(false);
        setAiQueueResult(null);
        setAiQueue([]);
        setAiQueueDone({ applied: appliedSoFar, skipped: queue.length - appliedSoFar });
        if (aiQueueDoneTimerRef.current) clearTimeout(aiQueueDoneTimerRef.current);
        aiQueueDoneTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setAiQueueDone(null);
        }, 6000);
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      return;
    }
    const b = queue[idx];
    if (!isMountedRef.current) return;
    setAiQueueFetching(true);
    setAiQueueError(null);
    try {
      const res = await enrichBottle({
        nameZh: b.nameZh || undefined,
        nameEn: b.nameEn || undefined,
        category: b.category || undefined,
        style: b.style || undefined,
        brand: b.brand || undefined,
        origin: b.origin || undefined,
        // 跨酒款关联推理：传入同类酒款名称列表（最多15条）
        cellarBottles: bottles
          .filter((bt) => bt.id !== b.id && (bt.category === b.category || bt.style === b.style))
          .slice(0, 15)
          .map((bt) => bt.nameZh || bt.nameEn)
          .filter(Boolean) as string[],
        lang: lang as 'zh' | 'en',
      });
      if (!isMountedRef.current) return;
      setAiQueueFetching(false);
      if (!res.found && !res.nameZh && !res.nameEn) {
        // 未找到，自动跳过
        setAiQueueIdx(idx + 1);
        fetchQueueItem(queue, idx + 1, mode, appliedSoFar);
        return;
      }
      if (mode === "autofill" || mode === "sel-autofill") {
        const draft = autoFillBlanks(b, res);
        updateBottle(b.id, draft);
        setAiQueueIdx(idx + 1);
        fetchQueueItem(queue, idx + 1, mode, appliedSoFar + 1);
      } else {
        const fields = buildQueueFields(b, res);
        const defaults: Record<string, boolean> = {};
        for (const f of fields) defaults[f.key] = f.conflict === "new" || f.conflict === "confirm";
        setAiQueueToggles(defaults);
        setAiQueueResult(res);
        // 配方联动：扫描配方库中用到该酒款的配方
        const impacted = recipes.filter((r) =>
          r.ingredients.some((ing) => {
            const link = smartLinkIngredient(ing.name, bottles, []);
            return link?.kind === "bottle" && link.bottle.id === b.id;
          })
        ).slice(0, 5);
        setLinkedRecipes(impacted);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      setAiQueueFetching(false);
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("timeout") || msg.includes("ETIMEDOUT");
      // 联网失败时降级到离线知识库
      const kbResult = lookupInOfflineKb({
        nameZh: b.nameZh || undefined,
        nameEn: b.nameEn || undefined,
        brand: b.brand || undefined,
        category: b.category || undefined,
      });
      const allSections = books.flatMap((bk) => bk.sections ?? []);
      const bookSnippets = extractBookSnippets({
        nameZh: b.nameZh || undefined,
        nameEn: b.nameEn || undefined,
        brand: b.brand || undefined,
        bookSections: allSections,
      });
      if (kbResult.found && kbResult.entry) {
        const offlineRes = offlineEntryToEnrichResult(kbResult.entry, bookSnippets);
        if (mode === "autofill" || mode === "sel-autofill") {
          const draft = autoFillBlanks(b, offlineRes);
          updateBottle(b.id, draft);
          setAiQueueIdx(idx + 1);
          fetchQueueItem(queue, idx + 1, mode, appliedSoFar + 1);
        } else {
          const fields = buildQueueFields(b, offlineRes);
          const defaults: Record<string, boolean> = {};
          for (const f of fields) defaults[f.key] = f.conflict === "new" || f.conflict === "confirm";
          setAiQueueToggles(defaults);
          setAiQueueResult(offlineRes);
          setAiQueueError(lang === "zh" ? "AI 服务不可用，已从本地知识库补全（离线模式）" : "AI unavailable, filled from local KB (offline)");
        }
      } else {
        setAiQueueError(isTimeout
          ? (lang === "zh" ? "AI 响应超时，可跳过或重试" : "AI timeout, skip or retry")
          : (lang === "zh" ? "网络错误，请检查连接" : "Network error, check connection"));
      }
    }
  }, [updateBottle, buildQueueFields, autoFillBlanks, lang, books]);

  /** Banner：启动缺资料条目补全队列 */
  const handleBatchEnrich = useCallback((mode: QueueMode) => {
    if (aiQueueFetching || aiQueue.length > 0) return;
    const isMissing = (b: Bottle) =>
      b.priceCny <= 0 || !b.origin || !b.brand || !(b.flavorTags?.length > 0) || !b.story;
    // 计算每个酒款的缺失字段分数（权重：核心字段权重更高）
    const missingScore = (b: Bottle): number => {
      let score = 0;
      if (!b.story) score += 3;
      if (!(b.flavorTags?.length > 0)) score += 3;
      if (!b.origin) score += 2;
      if (!b.brand) score += 2;
      if (b.priceCny <= 0) score += 2;
      if (!b.style) score += 1;
      if (!b.notes) score += 1;
      if (!b.nameEn) score += 1;
      if (!b.abv) score += 1;
      if (!b.notesEn) score += 1;
      return score;
    };
    const targets = groupBottles
      .filter(isMissing)
      .sort((a, b) => missingScore(b) - missingScore(a))
      .slice(0, 30);
    if (targets.length === 0) return;
    clearAiQueue();
    setAiQueueMode(mode);
    setAiQueue(targets);
    setAiQueueIdx(0);
    fetchQueueItem(targets, 0, mode, 0);
  }, [aiQueueFetching, aiQueue.length, groupBottles, clearAiQueue, fetchQueueItem]);

  /** 多选：启动已选条目补全队列 */
  const handleBatchEnrichSelected = useCallback((mode: QueueMode) => {
    if (aiQueueFetching || aiQueue.length > 0 || selectedIds.length === 0) return;
    const missingScore = (b: Bottle): number => {
      let score = 0;
      if (!b.story) score += 3;
      if (!(b.flavorTags?.length > 0)) score += 3;
      if (!b.origin) score += 2;
      if (!b.brand) score += 2;
      if (b.priceCny <= 0) score += 2;
      if (!b.style) score += 1;
      if (!b.notes) score += 1;
      if (!b.nameEn) score += 1;
      if (!b.abv) score += 1;
      if (!b.notesEn) score += 1;
      return score;
    };
    const targets = bottles
      .filter((b) => selectedIds.includes(b.id))
      .sort((a, b) => missingScore(b) - missingScore(a))
      .slice(0, 20);
    if (targets.length === 0) return;
    clearAiQueue();
    setAiQueueMode(mode);
    setAiQueue(targets);
    setAiQueueIdx(0);
    fetchQueueItem(targets, 0, mode, 0);
  }, [aiQueueFetching, aiQueue.length, selectedIds, bottles, clearAiQueue, fetchQueueItem]);

  /** 队列面板：应用当前条目并推进到下一条 */
  const handleQueueApply = useCallback(() => {
    const b = aiQueue[aiQueueIdx];
    const res = aiQueueResult;
    if (!b || !res) return;
    const draft = applyQueueFields(b, res, aiQueueToggles);
    updateBottle(b.id, draft);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextIdx = aiQueueIdx + 1;
    setAiQueueIdx(nextIdx);
    setAiQueueResult(null);
    fetchQueueItem(aiQueue, nextIdx, aiQueueMode, nextIdx);
  }, [aiQueue, aiQueueIdx, aiQueueResult, aiQueueToggles, aiQueueMode, applyQueueFields, updateBottle, fetchQueueItem]);

  /** 队列面板：跳过当前条目 */
  const handleQueueSkip = useCallback(() => {
    const nextIdx = aiQueueIdx + 1;
    setAiQueueIdx(nextIdx);
    setAiQueueResult(null);
    setAiQueueError(null);
    fetchQueueItem(aiQueue, nextIdx, aiQueueMode, aiQueueIdx);
  }, [aiQueue, aiQueueIdx, aiQueueMode, fetchQueueItem]);

  const missingCount = useMemo(
    () => groupBottles.filter((b) =>
      b.priceCny <= 0 || !b.origin || !b.brand || !(b.flavorTags?.length > 0) || !b.story
    ).length,
    [groupBottles],
  );

  // 快捷筛选解析:大分类(类别)与其下细化的风格集合
  const quickCats = Object.keys(quickSel);
  const quickStyles = useMemo(() => [...new Set(Object.values(quickSel).flat())], [quickSel]);

  const filtered = useMemo(
    () => {
      let base = filterBottles(groupBottles, query, undefined, undefined);
      // 快捷筛选:类别 + 风格(与面板筛选取交集)
      if (quickCats.length > 0) base = base.filter((b) => quickCats.includes(b.category));
      if (quickStyles.length > 0) base = base.filter((b) => quickStyles.includes(b.style));
      if (selCategories.length > 0) base = base.filter((b) => selCategories.includes(b.category));
      if (selStyles.length > 0) base = base.filter((b) => selStyles.includes(b.style));
      return base;
    },
    [groupBottles, query, quickCats, quickStyles, selCategories, selStyles],
  );

  /** 排序后的列表 */
  const sorted = useMemo(
    () =>
      sortBottles(filtered, sort, {
        nameOf: (b) => (lang === "en" && b.nameEn ? b.nameEn : b.nameZh || b.nameEn),
      }),
    [filtered, sort, lang],
  );

  /** 形态族折叠(仅原材料库分组,默认排序时启用;搜索时平铺以免遮挡结果) */
  const [expandedFamilies, setExpandedFamilies] = useState<string[]>([]);
  const familyView = useMemo(() => {
    if (group !== "materials" || sort === "manual" || query.trim()) return null;
    const { families, memberOf } = groupFormFamilies(sorted);
    if (families.length === 0) return null;
    type Row =
      | { kind: "bottle"; bottle: Bottle }
      | { kind: "family"; family: FormFamily };
    const rows: Row[] = [];
    const seenFam = new Set<string>();
    for (const b of sorted) {
      const famKey = memberOf.get(b.id);
      if (!famKey) {
        rows.push({ kind: "bottle", bottle: b });
        continue;
      }
      if (seenFam.has(famKey)) continue;
      seenFam.add(famKey);
      const family = families.find((f: FormFamily) => f.key === famKey)!;
      rows.push({ kind: "family", family });
    }
    return rows;
  }, [group, sort, query, sorted]);
  const groupCategories = useMemo(
    () => taxCategoriesOfGroup(group),
    [group, taxCategoriesOfGroup],
  );

  /** 风格显示名:英文界面显示 name,中文界面优先 zh */
  const styleLabel = useCallback(
    (cat: string, name: string) => {
      if (lang === "en") return name;
      const def = stylesOf(cat).find((s) => s.name === name);
      return def?.zh ? def.zh : name;
    },
    [lang, stylesOf],
  );

  /** 快捷筛选大分类:分组内类别;子分类 = 分类体系内全部风格(体系顺序)+ 库内出现过的自定义风格 */
  const quickParents: QuickParentOption[] = useMemo(
    () =>
      groupCategories.map((cat) => {
        const scope = groupBottles.filter((b) => b.category === cat);
        const present = new Set(scope.filter((b) => b.style).map((b) => b.style));
        const preset = stylesOf(cat).map((s) => s.name).filter((s) => present.has(s));
        const extras = [...present].filter((s) => !preset.includes(s)).sort();
        return {
          value: cat,
          label: categoryLabel(cat, lang),
          children: [...new Set([...preset, ...extras])].map((s) => ({
            value: s,
            label: styleLabel(cat, s),
          })),
        };
      }),
    [groupCategories, groupBottles, lang, categoryLabel, stylesOf, styleLabel],
  );

  // 当前主分类下实际出现过的 style(预设顺序在前,库内自定义 style 追加在后)
  const styleOptions = useMemo(() => {
    // 面板中风格选项范围:已选类别下的风格;未选类别时为当前分组全部风格
    const scope =
      selCategories.length > 0
        ? groupBottles.filter((b) => selCategories.includes(b.category))
        : groupBottles;
    const present = new Set(scope.filter((b) => b.style).map((b) => b.style));
    const cats = selCategories.length > 0 ? selCategories : groupCategories;
    const preset = cats
      .flatMap((c) => stylesOf(c).map((s) => s.name))
      .filter((s) => present.has(s));
    const extras = [...present].filter((s) => !preset.includes(s)).sort();
    return [...new Set([...preset, ...extras])];
  }, [groupBottles, selCategories, groupCategories, stylesOf]);

  /** 筛选面板维度定义 */
  const dimensions: FilterDimension[] = [
    {
      key: "category",
      title: t("fs.dim.category"),
      options: groupCategories.map((c) => ({
        value: c,
        label: categoryLabel(c, lang),
      })),
      selected: selCategories,
      onToggle: (v) =>
        setSelCategories((prev) => {
          const next = prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
          // 类别变化时,清掉不再属于可选范围的风格
          setSelStyles((sPrev) => sPrev.filter((s) => {
            const cats = next.length > 0 ? next : groupCategories;
            return cats.some((c) => stylesOf(c).some((d) => d.name === s)) ||
              groupBottles.some((b) => b.style === s && cats.includes(b.category));
          }));
          return next;
        }),
    },
    {
      key: "style",
      title: t("fs.dim.style"),
      options: styleOptions.map((s) => ({ value: s, label: s })),
      selected: selStyles,
      onToggle: (v) =>
        setSelStyles((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
  ];

  const activeFilterCount = selCategories.length + selStyles.length;

  const clearAll = () => {
    setSelCategories([]);
    setSelStyles([]);
    setSort("default");
  };

  /** 手动排序模式:长按拖拽调整顺序并持久化 */
  const manualMode = sort === "manual";

  const handleDragEnd = useCallback(
    ({ data }: { data: Bottle[] }) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      reorderBottles(data.map((b) => b.id));
    },
    [reorderBottles],
  );

  const renderDragItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<Bottle>) => {
      const index = getIndex() ?? 0;
      return (
        <ScaleDecorator activeScale={1.02}>
          <View style={styles.dragRow}>
            <View style={{ flex: 1 }}>
              <BottleCard
                bottle={item}
                isFirst={index === 0}
                isLast={index === sorted.length - 1}
                onLongPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  Alert.alert(
                    item.nameZh,
                    undefined,
                    [
                      {
                        text: "复制条目",
                        onPress: () => {
                          duplicateBottle(item.id);
                          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        },
                      },
                      { text: "取消", style: "cancel" },
                    ],
                  );
                }}
              />
            </View>
            <Pressable
              onLongPress={drag}
              delayLongPress={120}
              hitSlop={8}
              style={({ pressed }) => [
                styles.dragHandle,
                { backgroundColor: colors.surface },
                index === 0 && { borderTopRightRadius: 12 },
                index === sorted.length - 1 && { borderBottomRightRadius: 12 },
                (pressed || isActive) && { opacity: 0.6 },
              ]}
            >
              <IconSymbol name="line.3.horizontal" size={20} color={colors.muted} />
            </Pressable>
          </View>
        </ScaleDecorator>
      );
    },
    [colors, sorted.length],
  );

  const handleAdd = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // 按当前分组预填首个分类,便于新增落在正确分组
    const first = groupCategories[0];
    router.push(
      first ? { pathname: "/bottle-form", params: { category: first } } : "/bottle-form",
    );
  };

  /** 多选:可见条目 id */
  const visibleIds = useMemo(() => sorted.map((b) => b.id), [sorted]);

  const toggleSelect = useCallback((id: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    setBulkSheet(null);
  }, []);

  /** 批量删除(带确认) */
  const handleBulkDelete = useCallback(() => {
    const n = selectedIds.length;
    if (n === 0) return;
    const doDelete = () => {
      deleteBottles(selectedIds);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      exitSelectMode();
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (window.confirm(t("sel.delete.confirmMsg").replace("{n}", String(n)))) doDelete();
      return;
    }
    Alert.alert(
      t("sel.delete.confirmTitle"),
      t("sel.delete.confirmMsg").replace("{n}", String(n)),
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: doDelete },
      ],
    );
  }, [selectedIds, deleteBottles, exitSelectMode, t]);

  /** 批量修改分类(单选,改分类时清空风格)/风格(单选) */
  const handleBulkApply = useCallback(
    (keys: string[]) => {
      if (bulkSheet === "category") {
        const cat = keys[0];
        if (cat) bulkUpdateBottles(selectedIds, { category: cat, style: "" });
      } else if (bulkSheet === "style") {
        bulkUpdateBottles(selectedIds, { style: keys[0] ?? "" });
      }
      setBulkSheet(null);
      exitSelectMode();
    },
    [bulkSheet, selectedIds, bulkUpdateBottles, exitSelectMode],
  );

  /** 批量改风格的选项:所选条目分类的并集下全部预设风格 */
  const bulkStyleOptions = useMemo(() => {
    const cats = [...new Set(
      bottles.filter((b) => selectedIds.includes(b.id)).map((b) => b.category),
    )];
    const opts: { key: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const cat of cats) {
      for (const s of stylesOf(cat)) {
        if (!seen.has(s.name)) {
          seen.add(s.name);
          opts.push({ key: s.name, label: styleLabel(cat, s.name) });
        }
      }
    }
    return opts;
  }, [bottles, selectedIds, stylesOf, styleLabel]);

  const chipStyle = (active: boolean) => [
    styles.chip,
    {
      backgroundColor: active ? colors.primary : colors.surface,
      borderColor: active ? colors.primary : colors.border,
    },
  ];
  const chipTextStyle = (active: boolean) => [
    styles.chipText,
    { color: active ? "#FFFFFF" : colors.foreground },
  ];

  return (
    <ScreenContainer edges={[]}>
      {/* 二级分组切换器：基酒库 / 酒款库 / 原材料库 + 多选按钮 */}
      <View className="px-5 pt-2">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.border + "55", borderRadius: 10, padding: 2, gap: 2 }}>
            {BOTTLE_GROUPS.map((g) => {
              const active = group === g.key;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => {
                    if (group !== g.key) {
                      setGroup(g.key);
                      setSelCategories([]);
                      setSelStyles([]);
                      clearAiQueue();
                      if (Platform.OS !== "web") {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }
                    }
                  }}
                  style={[
                    styles.segment,
                    active && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" },
                    ]}
                  >
                    {lang === "en" ? g.en : g.zh}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {groupBottles.length > 0 ? (
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (selectMode) exitSelectMode();
                else setSelectMode(true);
              }}
              style={({ pressed }) => [
                styles.selectBtn,
                {
                  backgroundColor: selectMode ? colors.primary : colors.surface,
                  borderColor: selectMode ? colors.primary : colors.border,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.selectBtnText, { color: selectMode ? "#FFFFFF" : colors.muted }]}>
                {selectMode ? t("sel.exit") : t("sel.enter")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Search */}
      <View className="px-5 mt-2">
        <View
          style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.border + "44", borderRadius: 12, paddingHorizontal: 12, height: 42 }}
        >
          <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
          <TextInput
            className="flex-1 ml-2 text-base text-foreground"
            placeholder={t("bottles.search.placeholder")}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            style={{ lineHeight: 20 }}
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Category filter */}
      {/* 快捷筛选:与 Filter 面板互不联动;大分类(类别)展开风格子分类,状态持久保留 */}
      <View style={{ marginTop: 8 }}>
        <QuickFilterChips
          parents={quickParents}
          selection={quickSel}
          onChange={setQuickSel}
          allLabel={t("home.filter.all")}
          leading={
            <Pressable
              style={[
                styles.chip,
                styles.filterBtn,
                {
                  backgroundColor:
                    activeFilterCount > 0 || sort !== "default" ? colors.primary : colors.surface,
                  borderColor:
                    activeFilterCount > 0 || sort !== "default" ? colors.primary : colors.border,
                },
              ]}
              onPress={() => setSheetOpen(true)}
            >
              <IconSymbol
                name="slider.horizontal.3"
                size={14}
                color={activeFilterCount > 0 || sort !== "default" ? "#FFFFFF" : colors.muted}
              />
              <Text style={chipTextStyle(activeFilterCount > 0 || sort !== "default")}>
                {t("fs.filterBtn")}
                {activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}
              </Text>
            </Pressable>
          }
        />
      </View>

      {/* 联网补全 Banner：三模式（逐条确认 / 批量自动填空白） */}
      {!selectMode && ready && missingCount > 0 && aiQueue.length === 0 && !aiQueueDone ? (
        <View className="px-5" style={{ marginTop: 8, gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => handleBatchEnrich("review")}
              disabled={aiQueueFetching}
              style={({ pressed }) => [
                styles.enrichBanner,
                { flex: 1, backgroundColor: colors.primary + "10", borderWidth: 1, borderColor: colors.primary + "25" },
                (pressed || aiQueueFetching) && { opacity: 0.6 },
              ]}
            >
              <IconSymbol name="globe" size={14} color={colors.primary} />
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
                {lang === "zh" ? `逐条审核 (${missingCount})` : `Review (${missingCount})`}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => handleBatchEnrich("autofill")}
              disabled={aiQueueFetching}
              style={({ pressed }) => [
                styles.enrichBanner,
                { flex: 1, backgroundColor: colors.success + "12", borderWidth: 1, borderColor: colors.success + "30" },
                (pressed || aiQueueFetching) && { opacity: 0.6 },
              ]}
            >
              <IconSymbol name="sparkles" size={14} color={colors.success} />
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.success }}>
                {lang === "zh" ? "自动填空白" : "Auto-fill Blanks"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* AI 建议队列面板 — Modal 底部抽屉（逐条确认模式） */}
      <Modal
        visible={!selectMode && aiQueue.length > 0}
        transparent
        animationType="slide"
        onRequestClose={clearAiQueue}
      >
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }} onPress={clearAiQueue} />
        <View style={{
          backgroundColor: colors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingBottom: Math.max(insets.bottom, 16),
          maxHeight: "85%",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}>
          {/* 把手 */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          {/* 面板标题 */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 8 }}>
            <IconSymbol name="sparkles" size={16} color={colors.primary} />
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, flex: 1 }}>
              {lang === "zh" ? "AI 建议" : "AI Suggestions"}
            </Text>
            {aiQueue[aiQueueIdx] ? (
              <Text style={{ fontSize: 12, color: colors.muted }}>
                {aiQueueIdx + 1}/{aiQueue.length} · {(aiQueue[aiQueueIdx].nameZh || aiQueue[aiQueueIdx].nameEn || "").slice(0, 12)}
              </Text>
            ) : null}
            <Pressable onPress={clearAiQueue} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
              <IconSymbol name="xmark.circle.fill" size={22} color={colors.muted} />
            </Pressable>
          </View>

          {/* 可滚动内容区 */}
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* 加载中 */}
            {aiQueueFetching && !aiQueueResult ? (
              <View style={{ padding: 28, alignItems: "center", gap: 10 }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ fontSize: 14, color: colors.muted }}>
                  {lang === "zh" ? "AI 分析中…" : "Analyzing…"}
                </Text>
              </View>
            ) : aiQueueError ? (
              <View style={{ padding: 16, gap: 10 }}>
                <Text style={{ fontSize: 13, color: colors.error, textAlign: "center" }}>{aiQueueError}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable
                    onPress={() => fetchQueueItem(aiQueue, aiQueueIdx, aiQueueMode, aiQueueIdx)}
                    style={({ pressed }) => [{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.primary, alignItems: "center" }, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>{lang === "zh" ? "重试" : "Retry"}</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleQueueSkip}
                    style={({ pressed }) => [{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.border, alignItems: "center" }, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{lang === "zh" ? "跳过" : "Skip"}</Text>
                  </Pressable>
                </View>
              </View>
            ) : aiQueueResult ? (
              <>
                {/* 快捷操作 */}
                <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 10, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  {[
                    { label: lang === "zh" ? "全选" : "All", action: () => { const f = buildQueueFields(aiQueue[aiQueueIdx], aiQueueResult!); const t: Record<string,boolean>={}; f.forEach(x=>t[x.key]=true); setAiQueueToggles(t); } },
                    { label: lang === "zh" ? "只填空白" : "Blanks Only", action: () => { const f = buildQueueFields(aiQueue[aiQueueIdx], aiQueueResult!); const t: Record<string,boolean>={}; f.forEach(x=>t[x.key]=x.conflict==="new"); setAiQueueToggles(t); } },
                    { label: lang === "zh" ? "全不选" : "None", action: () => { const f = buildQueueFields(aiQueue[aiQueueIdx], aiQueueResult!); const t: Record<string,boolean>={}; f.forEach(x=>t[x.key]=false); setAiQueueToggles(t); } },
                  ].map((btn) => (
                    <Pressable key={btn.label} onPress={btn.action} style={({ pressed }) => [{ flex: 1, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.border + "80", alignItems: "center" }, pressed && { opacity: 0.6 }]}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{btn.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {/* 高置信度一键应用 */}
                {aiQueueResult.confidence === "high" ? (
                  <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
                    <Pressable
                      onPress={() => {
                        const f = buildQueueFields(aiQueue[aiQueueIdx], aiQueueResult!);
                        const t: Record<string, boolean> = {};
                        f.forEach((x) => { t[x.key] = x.conflict === "new" || x.conflict === "confirm"; });
                        setAiQueueToggles(t);
                      }}
                      style={({ pressed }) => [
                        { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                          paddingVertical: 9, borderRadius: 10,
                          backgroundColor: colors.success + "18", borderWidth: 1, borderColor: colors.success + "40" },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <IconSymbol name="checkmark.seal.fill" size={14} color={colors.success} />
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.success }}>
                        {lang === "zh" ? "高置信度：一键选中所有安全字段" : "High Confidence: Select All Safe Fields"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                {/* 字段列表 */}
                {buildQueueFields(aiQueue[aiQueueIdx], aiQueueResult).map((field) => {
                  const conflictColor = field.conflict === "new" ? colors.success : field.conflict === "override" ? colors.warning : field.conflict === "confirm" ? colors.primary : colors.muted;
                  const conflictLabel = field.conflict === "new" ? (lang === "zh" ? "新增" : "New") : field.conflict === "override" ? (lang === "zh" ? "覆盖" : "Override") : field.conflict === "confirm" ? (lang === "zh" ? "确认" : "Confirm") : (lang === "zh" ? "低可信" : "Low");
                  const isOn = aiQueueToggles[field.key] !== false;
                  return (
                    <View key={field.key} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border + "60", gap: 10 }}>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: conflictColor + "20" }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: conflictColor }}>{conflictLabel}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{field.labelZh}</Text>
                        {field.currentValue ? (
                          <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={2}>
                            {field.currentValue} → <Text style={{ color: isOn ? colors.primary : colors.muted }}>{field.aiValue}</Text>
                          </Text>
                        ) : (
                          <Text style={{ fontSize: 11, color: isOn ? colors.primary : colors.muted }} numberOfLines={2}>{field.aiValue}</Text>
                        )}
                      </View>
                      <Switch
                        value={isOn}
                        onValueChange={(v) => setAiQueueToggles((prev) => ({ ...prev, [field.key]: v }))}
                        trackColor={{ false: colors.border, true: colors.primary + "80" }}
                        thumbColor={isOn ? colors.primary : colors.muted}
                      />
                    </View>
                  );
                })}
                {/* 配方联动提示 */}
                {linkedRecipes.length > 0 ? (
                  <View style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 4 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted }}>
                      {lang === "zh" ? `📋 该酒款用于以下 ${linkedRecipes.length} 个配方：` : `📋 Used in ${linkedRecipes.length} recipe(s):`}
                    </Text>
                    {linkedRecipes.map((r) => (
                      <Text key={r.id} style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>
                        · {r.name}{r.nameEn ? ` / ${r.nameEn}` : ""}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>

          {/* 底部固定操作栏（仅在有结果时显示） */}
          {aiQueueResult ? (
            <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingTop: 10, gap: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Pressable
                onPress={handleQueueApply}
                style={({ pressed }) => [{ flex: 3, padding: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center" }, pressed && { opacity: 0.8 }]}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>
                  {lang === "zh"
                    ? `应用 ${Object.values(aiQueueToggles).filter(Boolean).length} 项`
                    : `Apply ${Object.values(aiQueueToggles).filter(Boolean).length}`}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleQueueSkip}
                style={({ pressed }) => [{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.border, alignItems: "center" }, pressed && { opacity: 0.7 }]}
              >
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{lang === "zh" ? "跳过" : "Skip"}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>



      {/* 自动填空白进度条（autofill 模式） */}
      {!selectMode && aiQueueFetching && (aiQueueMode === "autofill" || aiQueueMode === "sel-autofill") ? (
        <View className="px-5" style={{ marginTop: 8 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>
                {lang === "zh" ? `自动填空白中… ${aiQueueIdx}/${aiQueue.length}` : `Auto-filling… ${aiQueueIdx}/${aiQueue.length}`}
              </Text>
              <Pressable onPress={clearAiQueue} hitSlop={8}>
                <Text style={{ fontSize: 12, color: colors.muted }}>{lang === "zh" ? "取消" : "Cancel"}</Text>
              </Pressable>
            </View>
            <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden" }}>
              <View style={{ height: 4, backgroundColor: colors.primary, borderRadius: 4, width: `${Math.round((aiQueueIdx / Math.max(aiQueue.length, 1)) * 100)}%` }} />
            </View>
          </View>
        </View>
      ) : null}

      {/* 完成 toast */}
      {aiQueueDone ? (
        <View className="px-5" style={{ marginTop: 8 }}>
          <View style={{ backgroundColor: colors.success + "15", borderRadius: 12, borderWidth: 1, borderColor: colors.success + "30", padding: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <IconSymbol name="checkmark.circle.fill" size={16} color={colors.success} />
            <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>
              {lang === "zh"
                ? `已补全 ${aiQueueDone.applied} 条${aiQueueDone.skipped > 0 ? `，跳过 ${aiQueueDone.skipped} 条` : ""}`
                : `Applied ${aiQueueDone.applied}${aiQueueDone.skipped > 0 ? `, skipped ${aiQueueDone.skipped}` : ""}`}
            </Text>
            <Pressable onPress={() => setAiQueueDone(null)} hitSlop={8}>
              <IconSymbol name="xmark" size={14} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* 统一筛选与排序面板 */}
      <FilterSortSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        dimensions={dimensions}
        sortOptions={BOTTLE_SORTS.map((s) => ({ value: s, label: t(`sort.${s}` as "sort.default") }))}
        sortValue={sort}
        onSortChange={(v) => setSort(v as BottleSort)}
        onClearAll={clearAll}
        resultCount={filtered.length}
      />

      {ready && filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8" style={{ marginTop: -40 }}>
          <Text style={{ fontSize: 48, lineHeight: 64 }}>🍾</Text>
          <Text className="text-xl font-semibold text-foreground mt-3">
            {bottles.length === 0 ? t("bottles.empty.title") : t("bottles.noMatch.title")}
          </Text>
          <Text className="text-sm text-muted text-center mt-2 leading-relaxed">
            {bottles.length === 0 ? t("bottles.empty.desc") : t("bottles.noMatch.desc")}
          </Text>
        </View>
      ) : manualMode ? (
        selectMode ? null : (
        <View style={{ flex: 1 }}>
          <View style={[styles.reorderHint, { backgroundColor: colors.primary + "14" }]}>
            <IconSymbol name="line.3.horizontal" size={14} color={colors.primary} />
            <Text style={[styles.reorderHintText, { color: colors.primary }]}>
              {t("reorder.enter")}
            </Text>
          </View>
          <DraggableFlatList
            data={sorted}
            keyExtractor={(b) => b.id}
            onDragEnd={handleDragEnd}
            renderItem={renderDragItem}
            activationDistance={Platform.OS === "web" ? 3 : 10}
            containerStyle={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 4,
              paddingBottom: 90 + insets.bottom,
            }}
          />
        </View>
        )
      ) : selectMode ? null : (
      familyView ? (
        <FlatList
          data={familyView}
          keyExtractor={(row) => (row.kind === "bottle" ? row.bottle.id : `fam-${row.family.key}`)}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 90 + insets.bottom,
          }}
          renderItem={({ item, index }) =>
            item.kind === "bottle" ? (
              <BottleCard
                bottle={item.bottle}
                isFirst={index === 0}
                isLast={index === familyView.length - 1}
              />
            ) : (
              <FamilyCard
                family={item.family}
                expanded={expandedFamilies.includes(item.family.key)}
                onToggle={() =>
                  setExpandedFamilies((prev) =>
                    prev.includes(item.family.key)
                      ? prev.filter((k) => k !== item.family.key)
                      : [...prev, item.family.key],
                  )
                }
                isFirst={index === 0}
                isLast={index === familyView.length - 1}
              />
            )
          }
        />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 90 + insets.bottom,
          }}
          renderItem={({ item, index }) => (
            <BottleCard
              bottle={item}
              isFirst={index === 0}
              isLast={index === sorted.length - 1}
            />
          )}
        />
      )
      )}

      {/* 多选模式:平铺列表 + 勾选行 */}
      {ready && sorted.length > 0 && selectMode ? (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: 160 + insets.bottom,
          }}
          renderItem={({ item, index }) => {
            const checked = selectedIds.includes(item.id);
            return (
              <Pressable onPress={() => toggleSelect(item.id)} style={styles.selRow}>
                <View style={styles.selCheckWrap}>
                  <IconSymbol
                    name={checked ? "checkmark.circle.fill" : "circle"}
                    size={24}
                    color={checked ? colors.primary : colors.muted}
                  />
                </View>
                <View style={{ flex: 1, pointerEvents: "none" }}>
                  <BottleCard
                    bottle={item}
                    isFirst={index === 0}
                    isLast={index === sorted.length - 1}
                  />
                </View>
              </Pressable>
            );
          }}
        />
      ) : null}

      {/* FAB */}
      {!selectMode ? (
      <Pressable
        onPress={handleAdd}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: colors.primary,
            bottom: 20 + (Platform.OS === "web" ? 0 : 0),
          },
          pressed && { transform: [{ scale: 0.95 }], opacity: 0.9 },
        ]}
      >
        <IconSymbol name="plus" size={26} color="#FFFFFF" />
      </Pressable>
      ) : (
        <>
          {/* 底部批量操作栏 */}
          <BulkActionBar
            count={selectedIds.length}
            total={visibleIds.length}
            onSelectAll={() => setSelectedIds(visibleIds)}
            onClearAll={() => setSelectedIds([])}
            actions={[
              {
                key: "category",
                label: t("sel.setCategory"),
                icon: "tag.fill",
                onPress: () => setBulkSheet("category"),
              },
              {
                key: "style",
                label: t("sel.setStyle"),
                icon: "sparkles",
                onPress: () => setBulkSheet("style"),
              },
              {
                key: "aiEnrich",
                label: lang === "zh" ? "逐条审核" : "Review",
                icon: "sparkles",
                disabled: aiQueueFetching || aiQueue.length > 0 || selectedIds.length === 0,
                onPress: () => handleBatchEnrichSelected("review"),
              },
              {
                key: "aiAutoFill",
                label: lang === "zh" ? "自动填空白" : "Auto-fill",
                icon: "globe",
                disabled: aiQueueFetching || aiQueue.length > 0 || selectedIds.length === 0,
                onPress: () => handleBatchEnrichSelected("sel-autofill"),
              },
              {
                key: "delete",
                label: t("sel.delete"),
                icon: "trash.fill",
                destructive: true,
                onPress: handleBulkDelete,
              },
            ]}
          />
          {/* 批量修改弹层:分类单选(全部分组的分类)/风格单选 */}
          <BulkEditSheet
            visible={bulkSheet !== null}
            title={
              bulkSheet === "category"
                ? `${t("sel.sheet.title")} · ${t("fs.dim.category")}`
                : `${t("sel.sheet.title")} · ${t("fs.dim.style")}`
            }
            options={
              bulkSheet === "category"
                ? [
                    ...taxCategoriesOfGroup("spirits"),
                    ...taxCategoriesOfGroup("bottles"),
                    ...taxCategoriesOfGroup("materials"),
                  ].map((cat) => ({ key: cat, label: categoryLabel(cat, lang) }))
                : bulkStyleOptions
            }
            multi={false}
            allowClear={bulkSheet === "style"}
            count={selectedIds.length}
            onApply={handleBulkApply}
          onClose={() => setBulkSheet(null)}
          />
        </>
      )}
    </ScreenContainer>
  );
}

function BottleCard({
  bottle,
  isFirst,
  isLast,
  onLongPress,
}: {
  bottle: Bottle;
  isFirst: boolean;
  isLast: boolean;
  onLongPress?: () => void;
}) {
  return <BottleCardInner bottle={bottle} isFirst={isFirst} isLast={isLast} onLongPress={onLongPress} />;
}

/** 形态族卡片:母条目 + 可展开的形态子条目(柠檬 → 柠檬汁/柠檬皮/柠檬片) */
function FamilyCard({
  family,
  expanded,
  onToggle,
  isFirst,
  isLast,
}: {
  family: FormFamily;
  expanded: boolean;
  onToggle: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const head = family.base ?? family.variants[0];
  const children = family.base ? family.variants : family.variants.slice(1);
  const count = children.length;
  return (
    <View>
      <View style={{ position: "relative" }}>
        <BottleCardInner
          bottle={head}
          isFirst={isFirst}
          isLast={isLast && !expanded}
          badge={
            count > 0 ? (
              <Pressable
                onPress={onToggle}
                hitSlop={10}
                style={({ pressed }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 2,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 10,
                    backgroundColor: colors.primary + "18",
                  },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <IconSymbol
                  name={expanded ? "chevron.up" : "chevron.down"}
                  size={11}
                  color={colors.primary}
                />
                <Text style={{ fontSize: 11, fontWeight: "600", lineHeight: 15, color: colors.primary }}>
                  {count}
                </Text>
              </Pressable>
            ) : null
          }
        />
      </View>
      {expanded
        ? children.map((v, i) => (
            <Pressable
              key={v.id}
              onPress={() => router.push({ pathname: "/bottle/[id]", params: { id: v.id } })}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <View
                className="bg-surface"
                style={[
                  { paddingLeft: 32, paddingRight: 16, paddingVertical: 10 },
                  isLast && i === children.length - 1 && {
                    borderBottomLeftRadius: 12,
                    borderBottomRightRadius: 12,
                  },
                ]}
              >
                <View className="flex-row items-center">
                  <View
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: colors.muted + "88",
                      marginRight: 10,
                    }}
                  />
                  <View className="flex-1 pr-2" style={{ height: 36, justifyContent: "center" }}>
                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                      {lang === "en" && v.nameEn ? v.nameEn : v.nameZh || v.nameEn}
                    </Text>
                    <Text className="text-[11px] text-muted mt-0.5" numberOfLines={1}>
                      {v.volume || " "}
                    </Text>
                  </View>
                  {v.priceCny > 0 ? (
                    <Text className="text-sm font-semibold text-foreground">¥{v.priceCny}</Text>
                  ) : null}
                  <View style={{ marginLeft: 8 }}>
                    <IconSymbol name="chevron.right" size={14} color={colors.border} />
                  </View>
                </View>
              </View>
            </Pressable>
          ))
        : null}
      {!isLast ? (
        <View className="bg-surface" style={{ height: StyleSheet.hairlineWidth }}>
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.border,
              marginLeft: 16,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function BottleCardInner({
  bottle,
  isFirst,
  isLast,
  badge,
  onLongPress,
}: {
  bottle: Bottle;
  isFirst: boolean;
  isLast: boolean;
  badge?: React.ReactNode;
  onLongPress?: () => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { categoryLabel } = useBottleTaxonomy();
  const [cardSettings] = useCardTagSettings();
  const flavorTags = bottle.flavorTags ?? [];
  const visibleTags = cardSettings.maxTagsPerCard > 0 ? flavorTags.slice(0, cardSettings.maxTagsPerCard) : flavorTags;
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/bottle/[id]", params: { id: bottle.id } })}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      <View
        className="bg-surface px-4"
        style={[
          { paddingVertical: 14 },
          isFirst && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
          isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
        ]}
      >
        <View className="flex-row items-center">
          <View className="flex-1 pr-2">
            <View style={{ minHeight: 40, justifyContent: "center" }}>
              <Text style={{ fontSize: 17, fontWeight: "600", lineHeight: 24 }} className="text-foreground" numberOfLines={1}>
                {lang === "en" && bottle.nameEn ? bottle.nameEn : bottle.nameZh}
              </Text>
              <Text className="text-sm text-muted mt-0.5" style={{ lineHeight: 18 }} numberOfLines={1}>
                {(lang === "en" ? bottle.nameZh : bottle.nameEn) || " "}
              </Text>
            </View>
            <View className="flex-row items-center mt-2 flex-wrap" style={{ gap: 5, minHeight: 22 }}>
              <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: colors.primary + "15", borderWidth: 0.5, borderColor: colors.primary + "50" }}>
                <Text style={{ fontSize: 11, fontWeight: "600", lineHeight: 15, color: colors.primary }}>
                  {categoryLabel(bottle.category, lang)}
                </Text>
              </View>
              {badge}
              {cardSettings.showBottleVolume && bottle.volume ? (
                <Text style={{ fontSize: 12, color: "#8E8E93", lineHeight: 16 }}>{bottle.volume}</Text>
              ) : null}
              {cardSettings.showBottleStyle && bottle.style ? (
                <Text style={{ fontSize: 11, fontWeight: "500", lineHeight: 15, color: colors.muted, paddingHorizontal: 1 }}>{bottle.style}</Text>
              ) : null}
              {cardSettings.showBottleOrigin && bottle.origin ? (
                <Text style={{ fontSize: 12, color: "#8E8E93", lineHeight: 16 }} numberOfLines={1}>{bottle.origin}</Text>
              ) : null}
              {cardSettings.showBottleAbv && bottle.abv > 0 ? (
                <Text style={{ fontSize: 12, color: "#8E8E93", lineHeight: 16 }}>{bottle.abv}% vol</Text>
              ) : null}
              {cardSettings.showBottleRating && bottle.rating ? (
                <View style={[styles.badge, { backgroundColor: "#F5A62322", flexDirection: "row", alignItems: "center", gap: 2 }]}>
                  <IconSymbol name="star.fill" size={10} color="#F5A623" />
                  <Text style={[styles.badgeText, { color: "#C77F00" }]}>{bottle.rating}/10</Text>
                </View>
              ) : null}
            </View>
            {/* Flavor tags row */}
            {cardSettings.showBottleFlavorTags && visibleTags.length > 0 && (
              <View className="flex-row flex-wrap" style={{ gap: 4, marginTop: 4 }}>
                {visibleTags.map((tag) => (
                  <View key={tag} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.primary + "10" }}>
                    <Text style={{ fontSize: 10, fontWeight: "500", lineHeight: 14, color: colors.primary + "CC" }}>{tag}</Text>
                  </View>
                ))}
                {cardSettings.maxTagsPerCard > 0 && flavorTags.length > cardSettings.maxTagsPerCard && (
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.border + "60" }}>
                    <Text style={{ fontSize: 10, fontWeight: "500", lineHeight: 14, color: colors.muted }}>+{flavorTags.length - cardSettings.maxTagsPerCard}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          <View className="items-end">
            {bottle.priceCny > 0 ? (
              <>
                <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, lineHeight: 24 }}>¥{bottle.priceCny}</Text>
                <Text style={{ fontSize: 10, color: colors.muted, lineHeight: 14, marginTop: 1 }}>{t("bottles.price.ref")}</Text>
              </>
            ) : (
              <Text style={{ fontSize: 11, color: colors.muted + "99", lineHeight: 16 }}>{t("bottles.price.unknown")}</Text>
            )}
          </View>
          <View style={{ marginLeft: 8 }}>
            <IconSymbol name="chevron.right" size={14} color={colors.muted + "60"} />
          </View>
        </View>
      </View>
      {!isLast ? (
        <View
          className="bg-surface"
          style={{ height: StyleSheet.hairlineWidth }}
        >
          <View
            style={{
              height: StyleSheet.hairlineWidth,
              backgroundColor: colors.border,
              marginLeft: 20,
            }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dragRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  dragHandle: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 6,
    paddingVertical: 6,
    borderRadius: 8,
  },
  reorderHintText: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  chipRowWrap: {
    marginTop: 10,
    marginBottom: 6,
  },
  segment: {
    flex: 1,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  subChipRowWrap: {
    marginBottom: 6,
  },
  chipRow: {
    paddingHorizontal: 20,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  enrichBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  flavorTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  flavorTagText: {
    fontSize: 10,
    fontWeight: "500",
    lineHeight: 14,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  selectBtn: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 2,
  },
  selectBtnText: { fontSize: 13, fontWeight: "600", lineHeight: 17 },
  selRow: { flexDirection: "row", alignItems: "center" },
  selCheckWrap: { width: 34, alignItems: "flex-start", justifyContent: "center" },
});
