import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FlatList } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { SmartImportBar } from "@/components/smart-import-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { enrichHomemade } from "@/lib/api/smart-router";
import type { EnrichHomemadeResult } from "@/lib/api/smart-router";
import { useNetwork } from "@/hooks/use-network";
import { splitAmount, mergeAmount, unitDisplayLabel } from "@/lib/units";
import { UnitPickerSheet } from "@/components/unit-picker-sheet";
import { useRecentUnits } from "@/hooks/use-recent-units";
import { NestableScrollContainer, NestableDraggableFlatList, RenderItemParams } from "react-native-draggable-flatlist";
import { useHomemadeStore } from "@/lib/homemade/store";
import {
  PREP_GROUPS,
  guessPrepType,
  joinPrepIngredient,
  prepGroupOfSection,
  splitPrepIngredientLine,
} from "@/lib/homemade/types";
import {
  SHELF_LIFE_OPTIONS,
  calcGarnishCostPerUnit,
  PrepGroup,
} from "@/lib/homemade/types";
import { prepSectionOfIn } from "@/lib/homemade/types";
import { useBottleStore } from "@/lib/bottles/store";
import { estimatePrepCost, type PrepCostEstimate } from "@/lib/homemade/cost";
import { suggestIngredients } from "@/lib/suggest";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { BOTTLE_GROUPS, BottleGroupKey, categoriesOfGroup } from "@/lib/bottles/types";
import { smartLinkIngredient, smartLinkDisplayName } from "@/lib/recipes/smart-link";
import { genId, FLAVOR_TAGS } from "@/lib/recipes/types";
import { useRecipeStore } from "@/lib/recipes/store";
import { Switch } from "react-native";

interface IngRow {
  id: string;
  name: string;
  amount: string;
  linkedBottleId?: string;
  linkedPrepId?: string;
  alternatives?: string[];
}

type PrepIngItem = { name: string; amount: string } | string;
function toRows(items: PrepIngItem[]): IngRow[] {
  const rows = items.map((item) => {
    if (typeof item === "string") {
      const { amount, name, alternatives } = splitPrepIngredientLine(item);
      return { id: genId(), name, amount, ...(alternatives ? { alternatives } : {}) };
    }
    return { id: genId(), name: item.name, amount: item.amount, ...(('alternatives' in item && item.alternatives) ? { alternatives: (item as { alternatives?: string[] }).alternatives } : {}) };
  });
  return rows.length > 0 ? rows : [{ id: genId(), name: "", amount: "" }];
}

/** AiField：单个字段的 AI 建议 diff 描述 */
type AiField = {
  key: string;
  labelZh: string;
  labelEn: string;
  aiValue: string;
  currentValue: string;
  conflict: "new" | "override" | "confirm" | "low";
};

export default function HomemadeFormScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { id, prefillName, prefillNameAlt, prefillType } = useLocalSearchParams<{
    id?: string;
    prefillName?: string;
    prefillNameAlt?: string;
    prefillType?: string;
  }>();
  const { ready, getPrep, addPrep, updatePrep, deletePrep, sections, types: typeList, preps: allPreps } = useHomemadeStore();
  const { bottles, addBottle, deleteBottle: _deleteBottle } = useBottleStore();
  const { recipes, updateRecipe } = useRecipeStore();
  const { groupOf, categoryLabel } = useBottleTaxonomy();
  const editing = getPrep(id);

  const [name, setName] = useState(editing?.name ?? prefillName ?? "");
  const [nameAlt, setNameAlt] = useState(editing?.nameAlt ?? prefillNameAlt ?? "");
  const [type, setType] = useState(
    editing?.type ?? (prefillType && typeList.some((p) => p.key === prefillType) ? prefillType : "syrup"),
  );
  // ── 顶层分组选择器 ─────────────────────────────────────────────────────────
  // 初始值：优先用 editing.abvGroup，否则按 type 推断
  const inferGroupFromType = (t: string): PrepGroup => {
    const sec = typeList.find((pt) => pt.key === t)?.section ?? "";
    const grp = sections.find((s) => s.key === sec)?.group ?? prepGroupOfSection(sections, sec);
    return grp;
  };
  const [selectedGroup, setSelectedGroup] = useState<PrepGroup>(() => {
    if (editing?.abvGroup === "alcoholic" || editing?.abvGroup === "non_alcoholic" || editing?.abvGroup === "garnish") {
      return editing.abvGroup;
    }
    const t0 = editing?.type ?? (prefillType && typeList.some((p) => p.key === prefillType) ? prefillType : "syrup");
    return inferGroupFromType(t0);
  });
  /** Bug1 修复：共享同一批 ingRows ID，避免 dismissedLinks key 与 ingRows ID 不匹配 */
  const initialIngRowsRef = useRef(toRows(editing?.ingredients ?? []));
  const [ingRows, setIngRows] = useState<IngRow[]>(initialIngRowsRef.current);
  /** Which ingredient row is focused (shows live suggestions) */
  const [focusedIng, setFocusedIng] = useState<string | null>(null);
  const pressingIngSuggestRef = useRef(false);
  /** Rows where user picked a suggestion — suppress dropdown until text changes */
  const [pickedIng, setPickedIng] = useState<Record<string, string>>({});
  // Pre-fill dismissed for existing ingredients when editing（使用与 ingRows 相同的 ID）
  const [dismissedLinks, setDismissedLinks] = useState<Record<string, boolean>>(() => {
    if (!editing?.ingredients?.length) return {};
    return Object.fromEntries(initialIngRowsRef.current.map((r) => [r.id, true]));
  });
  const [acceptedLinks, setAcceptedLinks] = useState<Record<string, boolean>>({});
  // 每行配料的来源筛选（全/基/酒/料/制），与配方表单一致
  const [ingSourceMap, setIngSourceMap] = useState<Record<string, "auto" | "spirits" | "bottles" | "materials" | "homemade">>({});
  // ── Recipe steps: stored as numbered string, edited as dynamic rows ──────
  const parseStepRows = (raw: string): { id: string; text: string }[] => {
    if (!raw.trim()) return [{ id: genId(), text: "" }];
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => ({ id: genId(), text: l.replace(/^\d+[.、)]\s*/, "").trim() }));
  };
  const serializeStepRows = (rows: { id: string; text: string }[]): string =>
    rows.filter((r) => r.text.trim()).map((r, i) => `${i + 1}. ${r.text.trim()}`).join("\n");
  const [stepRows, setStepRows] = useState<{ id: string; text: string }[]>(() =>
    parseStepRows(editing?.recipe ?? ""),
  );
  const recipe = serializeStepRows(stepRows);
  const [yieldStr, setYieldStr] = useState(editing?.yield ?? "");
  // 结构化产量：数量 + 单位（优先于 yieldStr 字符串）
  const [yieldQty, setYieldQty] = useState(
    editing?.yieldQty ? String(editing.yieldQty) : "",
  );
  const [yieldUnit, setYieldUnit] = useState(editing?.yieldUnit ?? "");
  // 非装饰类批次总成本（用于"总成本/产量"核算）
  const [normalBatchCost, setNormalBatchCost] = useState(
    editing?.batchCostTotal ? String(editing.batchCostTotal) : "",
  );
  const [shelfLife, setShelfLife] = useState(editing?.shelfLife ?? "");
  const [storage, setStorage] = useState(editing?.storage ?? "");
  const [source, setSource] = useState(editing?.source ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [story, setStory] = useState(editing?.story ?? "");
  const [styleDesc, setStyleDesc] = useState(editing?.styleDesc ?? "");
  const [usageNotes, setUsageNotes] = useState(editing?.usageNotes ?? "");
  const [flavorTags, setFlavorTags] = useState<string[]>(editing?.flavorTags ?? []);
  const [techniques, setTechniques] = useState<string[]>(editing?.techniques ?? []);
  /** 用户是否已手动选过类型(选过则不再自动推断覆盖) */
  const [typeTouched, setTypeTouched] = useState(Boolean(editing) || Boolean(prefillType));

  // ── 装饰专属字段 ──────────────────────────────────────────────────────────
  // ── 所属库选择器 ─────────────────────────────────────────────────────────
  // "auto" = 按 selectedGroup 自动决定（含酒精/无酒精/装饰）
  // "spirits"/"bottles"/"materials" = 迁移到酒库
  type LibraryDest = "auto" | BottleGroupKey;
  const [libraryDest, setLibraryDest] = useState<LibraryDest>("auto");
  const [bottleCategory, setBottleCategory] = useState<string>("其他");

  const [garnishUnit, setGarnishUnit] = useState(editing?.garnishUnit ?? "片");
  const [batchYield, setBatchYield] = useState(editing?.batchYield?.toString() ?? "");
  const [batchCost, setBatchCost] = useState(editing?.batchCost?.toString() ?? "");
  const [costPerUnit, setCostPerUnit] = useState(editing?.costPerUnit?.toString() ?? "");
  const [shelfLifeKey, setShelfLifeKey] = useState(editing?.shelfLifeKey ?? "");
  const [prepMethod, setPrepMethod] = useState(editing?.prepMethod ?? "");
  /** 成本录入方式：direct（直接录入）/ batch（批次折算） */
  const [costMode, setCostMode] = useState<"direct" | "batch">(
    editing?.batchYield ? "batch" : "direct",
  );
  /** 原料家族 key：同源衍生品填写相同 key，用于列表页家族折叠 */
  const [sourceFamilyKey, setSourceFamilyKey] = useState(editing?.sourceFamilyKey ?? "");
  /** 变体标签：在折叠卡片内区分同家族或同名的不同形态（如"皮卷"/"角形"/"薄片"） */
  const [variantLabel, setVariantLabel] = useState(editing?.variantLabel ?? "");
  const [showFamilySuggestions, setShowFamilySuggestions] = useState(false);

  /** 从所有自制品中提取已使用的 sourceFamilyKey，去重排序 */
  const existingFamilyKeys = useMemo(() => {
    const keys = allPreps
      .map((p) => p.sourceFamilyKey)
      .filter((k): k is string => !!k && k.trim().length > 0);
    return Array.from(new Set(keys)).sort();
  }, [allPreps]);

  /** 根据当前输入过滤建议列表 */
  const familyKeySuggestions = useMemo(() => {
    const q = sourceFamilyKey.trim().toLowerCase();
    if (!q) return existingFamilyKeys;
    return existingFamilyKeys.filter((k) => k.toLowerCase().includes(q));
  }, [sourceFamilyKey, existingFamilyKeys]);
  /** Unit picker: which ingredient row is currently open */
  const [unitPickerIngId, setUnitPickerIngId] = useState<string | null>(null);
  /** Yield unit picker open state */
  const [yieldUnitPickerOpen, setYieldUnitPickerOpen] = useState(false);
  const { recentUnits, addRecentUnit } = useRecentUnits();

  /** 当前选中类型是否属于装饰分组 */
  const isGarnishType = useMemo(() => {
    const sec = typeList.find((pt) => pt.key === type)?.section ?? "";
    const grp = sections.find((s) => s.key === sec)?.group ?? "";
    return grp === "garnish";
  }, [type, typeList, sections]);
  // selectedGroup 变化时，如果当前 type 不属于新分组，重置到新分组第一个类型
  const handleGroupChange = (grp: PrepGroup) => {
    setSelectedGroup(grp);
    const sec = typeList.find((pt) => pt.key === type)?.section ?? "";
    const currentGrp = sections.find((s) => s.key === sec)?.group ?? prepGroupOfSection(sections, sec);
    if (currentGrp !== grp) {
      // 找新分组的第一个类型
      const firstSec = sections.find((s) => s.group === grp);
      const firstType = firstSec ? typeList.find((pt) => pt.section === firstSec.key) : null;
      if (firstType) {
        setType(firstType.key);
        setTypeTouched(true);
      }
    }
  };

  const canSave = useMemo(() => name.trim().length > 0, [name]);

  // ── 编辑模式：store 异步加载完成后重新同步所有字段 ────────────────────────
  // useState 初始值只在首次渲染时生效；若 store 尚未 ready，editing 为 undefined，
  // 导致 type/selectedGroup 等字段锁定在默认值。ready 变为 true 后重新同步一次。
  const storeHydratedRef = useRef(false);
  useEffect(() => {
    if (!ready || !id || storeHydratedRef.current) return;
    storeHydratedRef.current = true;
    const e = getPrep(id);
    if (!e) return;
    // 基础字段
    setName(e.name ?? "");
    setNameAlt(e.nameAlt ?? "");
    setType(e.type ?? "syrup");
    setTypeTouched(true);
    // 分组
    const grp: PrepGroup =
      e.abvGroup === "alcoholic" || e.abvGroup === "non_alcoholic" || e.abvGroup === "garnish"
        ? e.abvGroup
        : inferGroupFromType(e.type ?? "syrup");
    setSelectedGroup(grp);
    // 原料行
    const rows = toRows(e.ingredients ?? []);
    setIngRows(rows);
    setDismissedLinks(Object.fromEntries(rows.map((r) => [r.id, true])));
    // 步骤
    setStepRows(parseStepRows(e.recipe ?? ""));
    // 产量
    setYieldStr(e.yield ?? "");
    setYieldQty(e.yieldQty ? String(e.yieldQty) : "");
    setYieldUnit(e.yieldUnit ?? "");
    // 成本
    setNormalBatchCost(e.batchCostTotal ? String(e.batchCostTotal) : "");
    setGarnishUnit(e.garnishUnit ?? "片");
    setBatchYield(e.batchYield?.toString() ?? "");
    setBatchCost(e.batchCost?.toString() ?? "");
    setCostPerUnit(e.costPerUnit?.toString() ?? "");
    setCostMode(e.batchYield ? "batch" : "direct");
    setCostOverrideOpen(!!(e.batchCostTotal));
    // 其他字段
    setShelfLife(e.shelfLife ?? "");
    setShelfLifeKey(e.shelfLifeKey ?? "");
    setStorage(e.storage ?? "");
    setSource(e.source ?? "");
    setNotes(e.notes ?? "");
    setStory(e.story ?? "");
    setStyleDesc(e.styleDesc ?? "");
    setUsageNotes(e.usageNotes ?? "");
    setFlavorTags(e.flavorTags ?? []);
    setTechniques(e.techniques ?? []);
    setSourceFamilyKey(e.sourceFamilyKey ?? "");
    setVariantLabel(e.variantLabel ?? "");
    setPrepMethod(e.prepMethod ?? "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, id]);

  // ── 实时成本估算（方案A）──────────────────────────────────────────────
  // 风险1：debounce 300ms，避免每次按键触发全量重算
  const [debouncedIngRows, setDebouncedIngRows] = useState(ingRows);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => setDebouncedIngRows(ingRows), 300);
    return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
  }, [ingRows]);

  // 风险2：过滤当前编辑项防止循环引用；风险6：补全 tempPrep 所有必填字段
  const liveEstimate = useMemo((): PrepCostEstimate | null => {
    const validRows = debouncedIngRows.filter((r) => r.name.trim());
    if (!validRows.length) return null;
    const tempPrep = {
      id: editing?.id ?? "__preview__",
      name: name || "__preview__",
      nameAlt: "",
      type: type || "syrup",
      abvGroup: selectedGroup,
      yield: yieldQty && yieldUnit ? `${yieldQty}${yieldUnit}` : "",
      yieldQty: parseFloat(yieldQty) || undefined,
      yieldUnit: yieldUnit || undefined,
      batchCostTotal: undefined,
      ingredients: validRows.map((r) => ({ name: r.name, amount: r.amount })),
      recipe: "", notes: "", shelfLife: "", storage: "", usageNotes: "",
      story: "", styleDesc: "", flavorTags: [], techniques: [],
      sourceFamilyKey: "", variantLabel: "",
    } as unknown as Parameters<typeof estimatePrepCost>[0];
    const safePreps = allPreps.filter((p) => p.id !== (editing?.id ?? "__preview__"));
    return estimatePrepCost(tempPrep, bottles, safePreps);
  }, [debouncedIngRows, bottles, allPreps, editing?.id, name, type, selectedGroup, yieldQty, yieldUnit]);

  // 风险3：用 Map<rowId, item> 建立 ingRow → 估算结果的映射，避免空行索引错位
  const liveEstimateMap = useMemo(() => {
    const map = new Map<string, NonNullable<typeof liveEstimate>["items"][0]>();
    if (!liveEstimate) return map;
    const validRows = debouncedIngRows.filter((r) => r.name.trim());
    validRows.forEach((row, i) => { if (liveEstimate.items[i]) map.set(row.id, liveEstimate.items[i]); });
    return map;
  }, [liveEstimate, debouncedIngRows]);

  // 风险7：成本明细默认折叠；风险4：有手动值时自动展开批次总成本输入框
  const [costDetailOpen, setCostDetailOpen] = useState(false);
  const [costOverrideOpen, setCostOverrideOpen] = useState(() => !!(editing?.batchCostTotal));

  // ── AI 补全 ──────────────────────────────────────────────────────────
  const { isOnline } = useNetwork();
  
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState<EnrichHomemadeResult | null>(null);
  const [aiToggles, setAiToggles] = useState<Record<string, boolean>>({});
  const [undoSnapshot, setUndoSnapshot] = useState<null | {
    name: string; nameAlt: string; type: string;
    techniques: string[]; flavorTags: string[];
    story: string; styleDesc: string; shelfLife: string; storage: string; usageNotes: string;
    stepRows: { id: string; text: string }[];
    yieldQty: string; yieldUnit: string;
    sourceFamilyKey: string; variantLabel: string;
    ingRows: IngRow[];
  }>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [aiLibrarySuggestion, setAiLibrarySuggestion] = useState<{ library: "spirits" | "bottles" | "materials"; category: string; style: string } | null>(null);

  /** 构建 AI 字段 diff 列表 */
  const buildAiFields = useCallback((): AiField[] => {
    if (!aiResult) return [];
    const conf = (cur: string, ai: string, c: "high" | "medium" | "low"): AiField["conflict"] => {
      if (!cur.trim()) return "new";
      if (cur.trim().toLowerCase() === ai.trim().toLowerCase()) return "confirm";
      if (c === "low") return "low";
      return "override";
    };
    const c = (aiResult.confidence === "high" || aiResult.confidence === "medium" || aiResult.confidence === "low") ? aiResult.confidence as "high" | "medium" | "low" : "medium";
    const fields: AiField[] = [];
    if (aiResult.nameZh) fields.push({ key: "nameZh", labelZh: "中文名", labelEn: "Chinese Name", aiValue: aiResult.nameZh, currentValue: name, conflict: conf(name, aiResult.nameZh, c) });
    if (aiResult.nameEn) fields.push({ key: "nameEn", labelZh: "英文名", labelEn: "English Name", aiValue: aiResult.nameEn, currentValue: nameAlt, conflict: conf(nameAlt, aiResult.nameEn, c) });
    if (aiResult.techniques.length > 0) {
      const aiStr = aiResult.techniques.slice(0, 3).join(" · ") + (aiResult.techniques.length > 3 ? ` +${aiResult.techniques.length - 3}` : "");
      const curStr = techniques.length > 0 ? techniques.slice(0, 3).join(" · ") : "";
      fields.push({ key: "techniques", labelZh: "技法", labelEn: "Techniques", aiValue: aiStr, currentValue: curStr, conflict: conf(curStr, aiStr, c) });
    }
    if (aiResult.flavorTags.length > 0) {
      const aiStr = aiResult.flavorTags.slice(0, 4).join(" · ") + (aiResult.flavorTags.length > 4 ? ` +${aiResult.flavorTags.length - 4}` : "");
      const curStr = flavorTags.length > 0 ? flavorTags.slice(0, 3).join(" · ") : "";
      fields.push({ key: "flavorTags", labelZh: "风味标签", labelEn: "Flavor Tags", aiValue: aiStr, currentValue: curStr, conflict: conf(curStr, aiStr, c) });
    }
    if (aiResult.story) fields.push({ key: "story", labelZh: "介绍/故事", labelEn: "Story", aiValue: aiResult.story.slice(0, 50) + (aiResult.story.length > 50 ? "…" : ""), currentValue: story ? story.slice(0, 30) + (story.length > 30 ? "…" : "") : "", conflict: conf(story, aiResult.story, c) });
    if (aiResult.styleDesc) fields.push({ key: "styleDesc", labelZh: "风格/口感", labelEn: "Style/Taste", aiValue: aiResult.styleDesc.slice(0, 50) + (aiResult.styleDesc.length > 50 ? "…" : ""), currentValue: styleDesc ? styleDesc.slice(0, 30) + (styleDesc.length > 30 ? "…" : "") : "", conflict: conf(styleDesc, aiResult.styleDesc, c) });
    if (aiResult.shelfLife) fields.push({ key: "shelfLife", labelZh: "保鲜期", labelEn: "Shelf Life", aiValue: aiResult.shelfLife, currentValue: shelfLife, conflict: conf(shelfLife, aiResult.shelfLife, c) });
    if (aiResult.storage) fields.push({ key: "storage", labelZh: "储存方式", labelEn: "Storage", aiValue: aiResult.storage, currentValue: storage, conflict: conf(storage, aiResult.storage, c) });
    if (aiResult.usageNotes) fields.push({ key: "usageNotes", labelZh: "调酒用途", labelEn: "Usage Notes", aiValue: aiResult.usageNotes.slice(0, 50) + (aiResult.usageNotes.length > 50 ? "…" : ""), currentValue: usageNotes ? usageNotes.slice(0, 30) + (usageNotes.length > 30 ? "…" : "") : "", conflict: conf(usageNotes, aiResult.usageNotes, c) });
    if (aiResult.steps) {
      const curEmpty = stepRows.every((r) => !r.text.trim());
      const preview = aiResult.steps.split("\n").filter(Boolean).slice(0, 2).join(" / ") + (aiResult.steps.split("\n").filter(Boolean).length > 2 ? " …" : "");
      fields.push({ key: "steps", labelZh: "制作步骤", labelEn: "Steps", aiValue: preview, currentValue: curEmpty ? "" : `${stepRows.filter((r) => r.text.trim()).length} 步`, conflict: curEmpty ? "new" : "override" });
    }
    if (aiResult.yieldQty && aiResult.yieldQty > 0) {
      const aiYield = `${aiResult.yieldQty}${aiResult.yieldUnit || ""}`;
      const curYield = yieldQty ? `${yieldQty}${yieldUnit || ""}` : "";
      fields.push({ key: "yield", labelZh: "产量", labelEn: "Yield", aiValue: aiYield, currentValue: curYield, conflict: conf(curYield, aiYield, c) });
    }
    if (aiResult.sourceFamilyKey && selectedGroup === "garnish") {
      fields.push({ key: "sourceFamilyKey", labelZh: "原料家族", labelEn: "Source Family", aiValue: aiResult.sourceFamilyKey, currentValue: sourceFamilyKey, conflict: conf(sourceFamilyKey, aiResult.sourceFamilyKey, "low") });
    }
    if (aiResult.variantLabel && selectedGroup === "garnish") {
      fields.push({ key: "variantLabel", labelZh: "形态标签", labelEn: "Variant Label", aiValue: aiResult.variantLabel, currentValue: variantLabel, conflict: conf(variantLabel, aiResult.variantLabel, "low") });
    }
    if (aiResult.prepIngredients.length > 0 && ingRows.every((r) => !r.name.trim())) {
      const preview = aiResult.prepIngredients.slice(0, 4).map((i) => `${i.name}${i.amount ? " " + i.amount : ""}`).join(" · ") + (aiResult.prepIngredients.length > 4 ? ` +${aiResult.prepIngredients.length - 4}` : "");
      fields.push({ key: "prepIngredients", labelZh: "原料列表", labelEn: "Ingredients", aiValue: preview, currentValue: "", conflict: "new" });
    }
    return fields;
  }, [aiResult, name, nameAlt, techniques, flavorTags, story, styleDesc, shelfLife, storage, usageNotes, stepRows, yieldQty, yieldUnit, sourceFamilyKey, variantLabel, ingRows, selectedGroup]);

  React.useEffect(() => {
    if (!aiResult) { setAiToggles({}); return; }
    const fields = buildAiFields();
    const defaults: Record<string, boolean> = {};
    for (const f of fields) {
      if (f.key === "sourceFamilyKey" || f.key === "variantLabel") {
        defaults[f.key] = false;
      } else {
        defaults[f.key] = f.conflict === "new" || f.conflict === "confirm";
      }
    }
    setAiToggles(defaults);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResult]);

  const applyField = useCallback((key: string) => {
    if (!aiResult) return;
    if (key === "nameZh" && aiResult.nameZh) setName(aiResult.nameZh);
    else if (key === "nameEn" && aiResult.nameEn) setNameAlt(aiResult.nameEn);
    else if (key === "techniques" && aiResult.techniques.length > 0) setTechniques(aiResult.techniques);
    else if (key === "flavorTags" && aiResult.flavorTags.length > 0) setFlavorTags(aiResult.flavorTags);
    else if (key === "story" && aiResult.story) setStory(aiResult.story);
    else if (key === "styleDesc" && aiResult.styleDesc) setStyleDesc(aiResult.styleDesc);
    else if (key === "shelfLife" && aiResult.shelfLife) setShelfLife(aiResult.shelfLife);
    else if (key === "storage" && aiResult.storage) setStorage(aiResult.storage);
    else if (key === "usageNotes" && aiResult.usageNotes) setUsageNotes(aiResult.usageNotes);
    else if (key === "steps" && aiResult.steps) {
      const lines = aiResult.steps.split("\n").map((l) => l.replace(/^\d+\.?\s*/, "").trim()).filter(Boolean);
      if (lines.length > 0) setStepRows(lines.map((text) => ({ id: genId(), text })));
    }
    else if (key === "yield") {
      if (aiResult.yieldQty && aiResult.yieldQty > 0) setYieldQty(String(aiResult.yieldQty));
      if (aiResult.yieldUnit) setYieldUnit(aiResult.yieldUnit);
    }
    else if (key === "sourceFamilyKey" && aiResult.sourceFamilyKey) setSourceFamilyKey(aiResult.sourceFamilyKey);
    else if (key === "variantLabel" && aiResult.variantLabel) setVariantLabel(aiResult.variantLabel);
    else if (key === "prepIngredients" && aiResult.prepIngredients.length > 0) {
      setIngRows(aiResult.prepIngredients.map((ing) => ({ id: genId(), name: ing.name, amount: ing.amount })));
    }
  }, [aiResult]);

  const applyAiResult = useCallback(() => {
    if (!aiResult) return;
    const fields = buildAiFields();
    setUndoSnapshot({ name, nameAlt, type, techniques: [...techniques], flavorTags: [...flavorTags], story, styleDesc, shelfLife, storage, usageNotes, stepRows: stepRows.map((r) => ({ ...r })), yieldQty, yieldUnit, sourceFamilyKey, variantLabel, ingRows: ingRows.map((r) => ({ ...r })) });
    for (const f of fields) {
      if (aiToggles[f.key] !== false) applyField(f.key);
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAiResult(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 5000);
  }, [aiResult, aiToggles, buildAiFields, applyField, name, nameAlt, type, techniques, flavorTags, story, styleDesc, shelfLife, storage, usageNotes, stepRows, yieldQty, yieldUnit, sourceFamilyKey, variantLabel, ingRows]);

  const undoAiApply = useCallback(() => {
    if (!undoSnapshot) return;
    setName(undoSnapshot.name); setNameAlt(undoSnapshot.nameAlt); setType(undoSnapshot.type);
    setTechniques(undoSnapshot.techniques); setFlavorTags(undoSnapshot.flavorTags);
    setStory(undoSnapshot.story); setStyleDesc(undoSnapshot.styleDesc);
    setShelfLife(undoSnapshot.shelfLife); setStorage(undoSnapshot.storage);
    setUsageNotes(undoSnapshot.usageNotes); setStepRows(undoSnapshot.stepRows);
    setYieldQty(undoSnapshot.yieldQty); setYieldUnit(undoSnapshot.yieldUnit);
    setSourceFamilyKey(undoSnapshot.sourceFamilyKey); setVariantLabel(undoSnapshot.variantLabel);
    setIngRows(undoSnapshot.ingRows);
    setUndoSnapshot(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
  }, [undoSnapshot]);

  const handleAiEnrich = async () => {
    const displayName = [name.trim(), nameAlt.trim()].filter(Boolean).join(" / ");
    if (!displayName) return;
    if (!isOnline) return;
    setAiBusy(true);
    try {
      const res = await enrichHomemade({
        name: name.trim(),
        nameAlt: nameAlt.trim() || undefined,
        type: type || undefined,
        ingredients: ingRows.filter((r) => r.name.trim()),
        lang: lang as 'zh' | 'en',
      });
      const validLibs = ["spirits", "bottles", "materials"] as const;
      const sugLib = validLibs.find((l) => l === (res as Record<string, unknown>).suggestedLibrary);
      const sugCat = typeof (res as Record<string, unknown>).suggestedCategory === "string" ? (res as Record<string, unknown>).suggestedCategory as string : "";
      const sugStyle = typeof (res as Record<string, unknown>).suggestedStyle === "string" ? (res as Record<string, unknown>).suggestedStyle as string : "";
      const mapConf = (res as Record<string, unknown>).mapConfidence as string | undefined;
      if (sugLib && mapConf) {
        if (mapConf === "high") {
          setLibraryDest(sugLib);
          if (sugCat) setBottleCategory(sugCat);
          setAiLibrarySuggestion(null);
        } else if (mapConf === "medium") {
          setAiLibrarySuggestion({ library: sugLib, category: sugCat, style: sugStyle });
        }
      }
      if (res.prepType && res.prepType !== "other" && !typeTouched) {
        const matched = typeList.find((t) => t.key === res.prepType);
        if (matched) { setType(res.prepType); setTypeTouched(true); }
      }
      setAiResult(res);
    } catch {
      // 静默失败
    } finally {
      setAiBusy(false);
    }
  };

  /** 名称/配料变化后智能推断类型(仅在用户未手动选择时) */
  const autoGuessType = () => {
    if (typeTouched) return;
    const text = `${name} ${nameAlt} ${ingRows.map((r) => r.name).join(" ")}`;
    const guessed = guessPrepType(text, typeList);
    if (guessed && guessed !== type) setType(guessed);
  };

  const updateIngRow = (rid: string, field: "name" | "amount", value: string) => {
    setIngRows((prev) => prev.map((r) => (r.id === rid ? { ...r, [field]: value } : r)));
    if (field === "name") {
      setDismissedLinks((prev) => { const n = { ...prev }; delete n[rid]; return n; });
      setAcceptedLinks((prev) => { const n = { ...prev }; delete n[rid]; return n; });
      setIngRows((prev) => prev.map((r) => r.id === rid ? { ...r, linkedBottleId: undefined, linkedPrepId: undefined } : r));
      setPickedIng((prev) => { const n = { ...prev }; delete n[rid]; return n; });
    }
  };
  const pickSuggestion = (rid: string, value: string) => {
    updateIngRow(rid, "name", value);
    setPickedIng((prev) => ({ ...prev, [rid]: value }));
    setFocusedIng(null);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };
  const addIngRow = () => {
    setIngRows((prev) => [...prev, { id: genId(), name: "", amount: "" }]);
  };
  const removeIngRow = (rid: string) => {
    setIngRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== rid) : prev));
    setDismissedLinks((prev) => { const n = { ...prev }; delete n[rid]; return n; });
    setAcceptedLinks((prev) => { const n = { ...prev }; delete n[rid]; return n; });
    // Bug2 修复：同步清理 pickedIng 和 ingSourceMap，防止状态污染
    setPickedIng((prev) => { const n = { ...prev }; delete n[rid]; return n; });
    setIngSourceMap((prev) => { const n = { ...prev }; delete n[rid]; return n; });
  };

  const renderIngRow = useCallback(({ item: row, drag, isActive }: RenderItemParams<IngRow>) => {
    const trimmed = row.name.trim();
    const ingSource = ingSourceMap[row.id] ?? "auto";
    const showSuggest =
      focusedIng === row.id && trimmed.length > 0 && pickedIng[row.id] !== row.name;
    const liveSuggestions = showSuggest
      ? suggestIngredients(trimmed, bottles, allPreps.filter((p) => p.id !== (editing?.id ?? "")), lang, 6, groupOf)
          .filter((s) => s.value !== trimmed)
          .filter((s) => {
            if (!ingSource || ingSource === "auto") return true;
            return s.source === ingSource;
          })
      : [];
    const rawLink = trimmed.length >= 2
      ? smartLinkIngredient(trimmed, bottles, allPreps.filter((p) => p.id !== (editing?.id ?? "")), ingSource)
      : null;
    const isFuzzy = rawLink?.matchConfidence === "fuzzy";
    // 断开/忽略持久化：dismissed 屏蔽所有匹配（含 exact），修复精确匹配断不开的问题
    const rDismissed = dismissedLinks[row.id] === true;
    const link = rDismissed ? null : isFuzzy ? (acceptedLinks[row.id] ? rawLink : null) : rawLink;
    const pendingFuzzyLink = !rDismissed && isFuzzy && !acceptedLinks[row.id] ? rawLink : null;
    return (
      <View key={row.id} style={{ marginBottom: 8, opacity: isActive ? 0.85 : 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {/* 拖拽手柄 */}
          <Pressable
            onLongPress={drag}
            delayLongPress={200}
            hitSlop={6}
            style={{ paddingHorizontal: 2, paddingVertical: 4 }}
          >
            <IconSymbol name="line.3.horizontal" size={18} color={colors.muted} />
          </Pressable>
          {/* 库选择器：小型下拉按钮（与配方表单一致） */}
          <Pressable
            onPress={() => {
              const sources: ("auto" | "spirits" | "bottles" | "materials" | "homemade")[] = ["auto", "spirits", "bottles", "materials", "homemade"];
              const next = sources[(sources.indexOf(ingSource) + 1) % sources.length];
              setIngSourceMap((prev) => ({ ...prev, [row.id]: next }));
              setDismissedLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
              setAcceptedLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
            }}
            hitSlop={6}
            style={({ pressed }) => [{
              paddingHorizontal: 5,
              paddingVertical: 3,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: ingSource === "auto" ? colors.border : colors.primary,
              backgroundColor: ingSource === "auto" ? colors.surface : `${colors.primary}20`,
            }, pressed && { opacity: 0.7 }]}
          >
            <Text style={{ fontSize: 10, lineHeight: 14, color: ingSource === "auto" ? colors.muted : colors.primary, fontWeight: "600" }}>
              {ingSource === "auto" ? "全" : ingSource === "spirits" ? "基" : ingSource === "bottles" ? "酒" : ingSource === "materials" ? "料" : "制"}
            </Text>
          </Pressable>
         <TextInput
           style={[...inputStyle, { flex: 3 }]}
           placeholder={t("hmform.ingredient.name")}
           placeholderTextColor={colors.muted}
           value={row.name}
           onChangeText={(v) => updateIngRow(row.id, "name", v)}
          onFocus={() => setFocusedIng(row.id)}
          onBlur={() => {
            if (!pressingIngSuggestRef.current) {
              setTimeout(() => {
                setFocusedIng((cur) => (cur === row.id ? null : cur));
              }, 150);
            }
          }}
           returnKeyType="done"
           autoCapitalize="words"
         />
          {/* ── Amount: qty + unit picker ── */}
          {(() => {
            const { qty, unit } = splitAmount(row.amount);
            return (
              <View style={{ flexDirection: "row", flex: 2, gap: 4 }}>
                <TextInput
                  style={[...inputStyle, { flex: 1 }]}
                  placeholder={t("form.ingredient.qty")}
                  placeholderTextColor={colors.muted}
                  value={qty}
                  onChangeText={(v) => updateIngRow(row.id, "amount", mergeAmount(v, unit))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
                <Pressable
                  onPress={() => setUnitPickerIngId(row.id)}
                  style={({ pressed }) => [{
                    flex: 1,
                    backgroundColor: unit ? `${colors.primary}18` : colors.surface,
                    borderWidth: 1,
                    borderColor: unit ? colors.primary : colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 8,
                    paddingVertical: 10,
                    alignItems: "center",
                    justifyContent: "center",
                  }, pressed && { opacity: 0.7 }]}
                >
                  <Text style={{ fontSize: 14, color: unit ? colors.primary : colors.muted, fontWeight: unit ? "600" : "400" }}>
                    {unit ? unitDisplayLabel(unit, lang as "zh" | "en") : t("form.ingredient.unit")}
                  </Text>
                </Pressable>
              </View>
            );
          })()}
          <Pressable
            onPress={() => removeIngRow(row.id)}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol
              name="minus.circle.fill"
              size={24}
              color={ingRows.length > 1 ? colors.error : colors.border}
            />
          </Pressable>
        </View>
        {liveSuggestions.length > 0 ? (
          <View
            style={[
              styles.suggestBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            {liveSuggestions.map((s, sIdx) => (
              <Pressable
                key={s.key}
                onPressIn={() => { pressingIngSuggestRef.current = true; }}
                onPressOut={() => { pressingIngSuggestRef.current = false; }}
                onPress={() => { pickSuggestion(row.id, s.value); pressingIngSuggestRef.current = false; }}
                style={({ pressed }) => [
                  styles.suggestRow,
                  sIdx > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <IconSymbol
                  name={
                    s.source === "homemade"
                      ? "sparkles"
                      : s.source === "spirits"
                        ? "flame.fill"
                        : s.source === "materials"
                          ? "leaf.fill"
                          : "wineglass.fill"
                  }
                  size={13}
                  color={
                    s.source === "homemade"
                      ? colors.primary
                      : s.source === "spirits"
                        ? "#FF9500"
                        : s.source === "materials"
                          ? colors.success
                          : "#5AC8FA"
                  }
                />
                <Text
                  className="text-sm text-foreground"
                  numberOfLines={1}
                  style={{ lineHeight: 18, flexShrink: 1 }}
                >
                  {s.value}
                </Text>
                {s.secondary ? (
                  <Text
                    className="text-xs text-muted"
                    numberOfLines={1}
                    style={{ lineHeight: 16, flexShrink: 1 }}
                  >
                    {s.secondary}
                  </Text>
                ) : null}
                <View style={{ flex: 1 }} />
                <Text
                  className="text-[11px]"
                  style={{
                    lineHeight: 14,
                    color:
                      s.source === "homemade"
                        ? colors.primary
                        : s.source === "spirits"
                          ? "#FF9500"
                          : s.source === "materials"
                            ? colors.success
                            : "#5AC8FA",
                  }}
                >
                  {s.source === "homemade"
                    ? t("form.suggest.homemade")
                    : s.source === "spirits"
                      ? t("form.suggest.spirits")
                      : s.source === "materials"
                        ? t("form.suggest.materials")
                        : t("form.suggest.bottle")}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {link ? (
          (() => {
            const canon = smartLinkDisplayName(link, lang as "zh" | "en");
            const linkLabel = link.kind === "prep"
              ? t("form.suggest.homemade")
              : t("form.suggest.bottle");
            return (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  marginTop: 3,
                  paddingHorizontal: 4,
                }}
              >
                <IconSymbol
                  name={link.kind === "prep" ? "sparkles" : "link"}
                  size={11}
                  color={link.kind === "prep" ? colors.primary : colors.muted}
                />
                <Text style={{ fontSize: 11, lineHeight: 14, color: link.kind === "prep" ? colors.primary : colors.muted }}>
                  {linkLabel}{canon ? ` · ${canon.primary}` : ""}
                </Text>
              </View>
            );
          })()
        ) : pendingFuzzyLink ? (
          (() => {
            const fuzzyCanon = smartLinkDisplayName(pendingFuzzyLink, lang as "zh" | "en");
            const fuzzyName = fuzzyCanon?.primary ?? (pendingFuzzyLink.kind === "bottle" ? pendingFuzzyLink.bottle.nameZh || pendingFuzzyLink.bottle.nameEn : pendingFuzzyLink.prep.name);
            const fuzzyKey = pendingFuzzyLink.kind === "bottle" ? "form.link.fuzzy.bottle" : "form.link.fuzzy.prep";
            return (
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 3, paddingHorizontal: 4 }}>
                <Text style={{ fontSize: 11, lineHeight: 14, color: colors.muted }}>
                  {t(fuzzyKey, { name: fuzzyName })}
                </Text>
                <Pressable
                  onPress={() => {
                    setAcceptedLinks((prev) => ({ ...prev, [row.id]: true }));
                    if (pendingFuzzyLink?.kind === "bottle") {
                      setIngRows((prev) => prev.map((r) => r.id === row.id ? { ...r, linkedBottleId: pendingFuzzyLink.bottle.id, linkedPrepId: undefined } : r));
                    } else if (pendingFuzzyLink?.kind === "prep") {
                      setIngRows((prev) => prev.map((r) => r.id === row.id ? { ...r, linkedPrepId: pendingFuzzyLink.prep.id, linkedBottleId: undefined } : r));
                    }
                  }}
                  style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 0.5, borderColor: colors.success }, pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol name="checkmark" size={10} color={colors.success} />
                  <Text style={{ fontSize: 11, lineHeight: 14, color: colors.success }}>{t("form.link.accept")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDismissedLinks((prev) => ({ ...prev, [row.id]: true }))}
                  style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 0.5, borderColor: colors.border }, pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol name="xmark" size={10} color={colors.muted} />
                  <Text style={{ fontSize: 11, lineHeight: 14, color: colors.muted }}>{t("form.link.dismiss")}</Text>
                </Pressable>
              </View>
            );
          })()
        ) : null}
        {link ? (
          <Pressable
            onPress={() => {
              setDismissedLinks((prev) => ({ ...prev, [row.id]: true }));
              setAcceptedLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
              setIngRows((prev) => prev.map((r) => r.id === row.id ? { ...r, linkedBottleId: undefined, linkedPrepId: undefined } : r));
            }}
            style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2, paddingHorizontal: 4 }, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="xmark" size={10} color={colors.muted} />
            <Text style={{ fontSize: 11, lineHeight: 14, color: colors.muted }}>{t("form.link.break")}</Text>
          </Pressable>
        ) : rDismissed && trimmed.length >= 2 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 11, lineHeight: 14, color: colors.muted }}>{t("form.link.dismissed")}</Text>
            <Pressable
              onPress={() => {
                setDismissedLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
              }}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <Text style={{ fontSize: 11, lineHeight: 14, color: colors.primary }}>{t("form.link.relink")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingRows, ingSourceMap, dismissedLinks, acceptedLinks, focusedIng, pickedIng, bottles, allPreps, lang, groupOf, editing, colors, t]);

  const handleSave = () => {
    if (!canSave) return;

    // ── 迁移到酒库 ──────────────────────────────────────────────────────────
    if (libraryDest !== "auto") {
      const bottleDraft = {
        nameZh: name.trim(),
        nameEn: nameAlt.trim(),
        category: bottleCategory || "其他",
        style: "",
        brand: "",
        origin: "",
        volume: "",
        abv: 0,
        priceCny: 0,
        notes: notes.trim(),
        flavorTags,
        story: story.trim(),
        styleDesc: styleDesc.trim(),
        distilleryInfo: "",
        pairingNotes: "",
        usageNotes: usageNotes.trim(),
        seasonality: "",
        notesEn: "",
        storyEn: "",
        substituteFor: "",
        pairsWith: "",
        libraryOverride: libraryDest as "spirits" | "bottles" | "materials",
      };
      if (editing) {
        // 迁移：在酒库创建新条目，从自制库删除
        addBottle(bottleDraft);
        deletePrep(editing.id);
        // ── 更新配方中引用该自制品的 linkedPrepId ──────────────────────────
        // 迁移后 prep 不再存在，清除所有配方中对该 prep 的显式链接
        const prepId = editing.id;
        for (const recipe of recipes) {
          const hasIngLink = recipe.ingredients.some((ing) => ing.linkedPrepId === prepId);
          const hasGarnishLink = recipe.garnishItems?.some((g) => g.linkedPrepId === prepId);
          if (hasIngLink || hasGarnishLink) {
            updateRecipe(recipe.id, {
              ...recipe,
              ingredients: recipe.ingredients.map((ing) =>
                ing.linkedPrepId === prepId ? { ...ing, linkedPrepId: undefined } : ing,
              ),
              garnishItems: recipe.garnishItems?.map((g) =>
                g.linkedPrepId === prepId ? { ...g, linkedPrepId: undefined } : g,
              ),
            });
          }
        }
      } else {
        addBottle(bottleDraft);
      }
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.back();
      return;
    }

    const ingredients = ingRows
      .filter((r) => r.name.trim() || r.amount.trim())
      .map((r) => ({
        name: r.name.trim(),
        amount: r.amount.trim(),
        ...(r.alternatives && r.alternatives.length > 0 ? { alternatives: r.alternatives } : {}),
      }));
    const payload = {
      name: name.trim(),
      nameAlt: nameAlt.trim(),
      type,
      ingredients,
      recipe: recipe.trim(),
      yield: yieldStr.trim(),
      yieldQty: yieldQty.trim() ? (parseFloat(yieldQty) || undefined) : undefined,
      yieldUnit: yieldUnit.trim() || undefined,
      batchCostTotal: normalBatchCost.trim() ? (parseFloat(normalBatchCost) || undefined) : undefined,
      shelfLife: shelfLife.trim(),
      storage: storage.trim(),
      source: source.trim(),
      notes: notes.trim(),
      story: story.trim(),
      styleDesc: styleDesc.trim(),
      usageNotes: usageNotes.trim(),
      flavorTags,
      techniques,
    };
    // 装饰专属字段：以 selectedGroup 为准（不再依赖 isGarnishType 推断）
    if (selectedGroup === "garnish") {
      const byNum = parseFloat(batchYield);
      const bcNum = parseFloat(batchCost);
      const cpuNum = parseFloat(costPerUnit);
      Object.assign(payload, {
        abvGroup: "garnish" as PrepGroup,
        garnishUnit: garnishUnit.trim() || "片",
        shelfLifeKey: shelfLifeKey || undefined,
        prepMethod: prepMethod.trim() || undefined,
        sourceFamilyKey: sourceFamilyKey.trim() || undefined,
        variantLabel: variantLabel.trim() || undefined,
        ...(costMode === "batch"
          ? {
              batchYield: isFinite(byNum) && byNum > 0 ? byNum : undefined,
              batchCost: isFinite(bcNum) && bcNum > 0 ? bcNum : undefined,
              costPerUnit: undefined,
            }
          : {
              costPerUnit: isFinite(cpuNum) && cpuNum > 0 ? cpuNum : undefined,
              batchYield: undefined,
              batchCost: undefined,
            }),
      });
    } else {
      // 含酒精/无酒精：直接写入 abvGroup，确保路由正确
      Object.assign(payload, { abvGroup: selectedGroup as PrepGroup });
    }
    if (editing) {
      updatePrep(editing.id, payload);
    } else {
      addPrep(payload);
    }
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    router.back();
  };

  const fieldLabel = (label: string) => (
    <Text className="text-[13px] text-muted uppercase mt-4 mb-2" style={{ letterSpacing: 0.4 }}>{label}</Text>
  );

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      color: colors.foreground,
    },
  ];

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
       {/* Header */}
        <View className="flex-row items-center justify-between px-4 pt-3 pb-2">
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <IconSymbol name="xmark" size={24} color={colors.muted} />
          </Pressable>
          <Text className="text-lg font-semibold text-foreground">
            {editing ? t("hmform.title.edit") : t("hmform.title.new")}
          </Text>
          <Pressable onPress={handleSave} hitSlop={8} disabled={!canSave}>
            <Text
              style={{
                color: canSave ? colors.primary : colors.muted,
                fontSize: 16,
                fontWeight: "600",
              }}
            >
              {t("hmform.save")}
            </Text>
          </Pressable>
        </View>

        <NestableScrollContainer
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {!editing && (
            <SmartImportBar
              targetType="prep"
              onExtracted={(item) => {
                if (item.nameZh || item.nameEn) {
                  setName(item.nameZh || item.nameEn);
                  setNameAlt(item.nameZh ? item.nameEn : "");
                }
                if (item.prepIngredients?.length) setIngRows(toRows(item.prepIngredients));
                if (item.prepRecipe) setStepRows(parseStepRows(item.prepRecipe));
                if (item.prepYield) {
                  setYieldStr(item.prepYield);
                  // Bug6 修复：解析 yieldStr 并填充结构化产量字段
                  const { qty: pqty, unit: punit } = splitAmount(item.prepYield);
                  if (pqty) setYieldQty(pqty);
                  if (punit) setYieldUnit(punit);
                }
                if (item.shelfLife) setShelfLife(item.shelfLife);
                if (item.storage) setStorage(item.storage);
                if (item.source) setSource(item.source);
                if (item.notes) setNotes(item.notes);
              }}
            />
          )}
          {fieldLabel(t("hmform.name"))}
          <TextInput
            style={inputStyle}
            value={name}
            onChangeText={setName}
            onBlur={autoGuessType}
            placeholder={lang === "en" ? "e.g. Ginger Syrup" : "如:姜糖浆 Ginger Syrup"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />

          {fieldLabel(t("hmform.nameAlt"))}
          <TextInput
            style={inputStyle}
            value={nameAlt}
            onChangeText={setNameAlt}
            onBlur={autoGuessType}
            placeholder={lang === "en" ? "e.g. 姜糖浆" : "如:Ginger Syrup"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />
          {/* AI 补全按钮 */}
          <Pressable
            onPress={handleAiEnrich}
            disabled={aiBusy || !isOnline}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              marginTop: 8,
              marginBottom: 4,
              paddingVertical: 10,
              paddingHorizontal: 16,
              borderRadius: 10,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              opacity: (aiBusy || !isOnline) ? 0.5 : pressed ? 0.7 : 1,
            })}
          >
            <IconSymbol name="sparkles" size={16} color={colors.primary} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>
            {aiBusy
              ? (lang === "en" ? "Analyzing…" : "AI 分析中…")
              : (lang === "en" ? "AI Lookup" : "AI 识别补全")}
          </Text>
          </Pressable>
          {/* ── AI 建议面板 ── */}
          {aiResult && (() => {
            const fields = buildAiFields();
            const onCount = fields.filter((f) => aiToggles[f.key] !== false).length;
            const conf = aiResult.confidence;
            const confColor = conf === "high" ? colors.success : conf === "low" ? colors.warning : colors.primary;
            const confLabel = conf === "high" ? (lang === "en" ? "High" : "高可信") : conf === "low" ? (lang === "en" ? "Low" : "低可信") : (lang === "en" ? "Medium" : "中可信");
            return (
              <View style={{ marginTop: 8, marginBottom: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }}>
                {/* 面板头部 */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <IconSymbol name="sparkles" size={14} color={colors.primary} />
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{lang === "en" ? "AI Suggestions" : "✦ AI 建议"}</Text>
                    <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: confColor + "22" }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: confColor }}>{confLabel}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{fields.length} {lang === "en" ? "fields" : "个字段"}</Text>
                  </View>
                  <Pressable onPress={() => setAiResult(null)} style={{ padding: 4 }}>
                    <Text style={{ fontSize: 16, color: colors.muted }}>×</Text>
                  </Pressable>
                </View>
                {/* 快捷操作 */}
                <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  {[
                    { label: lang === "en" ? "All" : "全选", action: () => setAiToggles(Object.fromEntries(fields.map((f) => [f.key, true]))) },
                    { label: lang === "en" ? "Empty only" : "只填空白", action: () => setAiToggles(Object.fromEntries(fields.map((f) => [f.key, f.conflict === "new"]))) },
                    { label: lang === "en" ? "None" : "全不选", action: () => setAiToggles(Object.fromEntries(fields.map((f) => [f.key, false]))) },
                  ].map((btn) => (
                    <Pressable key={btn.label} onPress={btn.action} style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: pressed ? colors.border : colors.background, borderWidth: 1, borderColor: colors.border })}>
                      <Text style={{ fontSize: 12, color: colors.foreground }}>{btn.label}</Text>
                    </Pressable>
                  ))}
                </View>
                {/* 字段列表 */}
                {fields.map((f) => {
                  const on = aiToggles[f.key] !== false;
                  const conflictColors: Record<string, string> = { new: colors.success, override: colors.warning, confirm: colors.muted, low: colors.error };
                  const conflictLabels: Record<string, string> = { new: lang === "en" ? "new" : "新增", override: lang === "en" ? "override" : "覆盖", confirm: lang === "en" ? "same" : "确认", low: lang === "en" ? "low" : "低可信" };
                  return (
                    <View key={f.key} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border + "66", opacity: on ? 1 : 0.45 }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{lang === "en" ? f.labelEn : f.labelZh}</Text>
                          <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: (conflictColors[f.conflict] ?? colors.muted) + "22" }}>
                            <Text style={{ fontSize: 10, color: conflictColors[f.conflict] ?? colors.muted }}>{conflictLabels[f.conflict]}</Text>
                          </View>
                        </View>
                        {f.currentValue ? (
                          <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>{f.currentValue} → <Text style={{ color: colors.primary }}>{f.aiValue}</Text></Text>
                        ) : (
                          <Text style={{ fontSize: 11, color: colors.primary }} numberOfLines={1}>{f.aiValue}</Text>
                        )}
                      </View>
                      <Switch
                        value={on}
                        onValueChange={(v) => setAiToggles((prev) => ({ ...prev, [f.key]: v }))}
                        trackColor={{ false: colors.border, true: colors.primary + "88" }}
                        thumbColor={on ? colors.primary : colors.muted}
                      />
                    </View>
                  );
                })}
                {/* 底部操作 */}
                <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
                  <Pressable onPress={applyAiResult} style={({ pressed }) => ({ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: onCount > 0 ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1, alignItems: "center" })}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: onCount > 0 ? colors.background : colors.muted }}>{lang === "en" ? `Apply ${onCount}` : `应用 ${onCount} 项`}</Text>
                  </Pressable>
                  <Pressable onPress={() => setAiResult(null)} style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.7 : 1, alignItems: "center" })}>
                    <Text style={{ fontSize: 14, color: colors.muted }}>{lang === "en" ? "Dismiss" : "忽略"}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })()}
          {/* ── Undo toast ── */}
          {undoSnapshot && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>✓ {lang === "en" ? "AI suggestions applied" : "AI 建议已应用"}</Text>
              <Pressable onPress={undoAiApply} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.primary + "22" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>{lang === "en" ? "Undo" : "撤销"}</Text>
              </Pressable>
            </View>
          )}

          {fieldLabel(t("hmform.type"))}
          {/* ── 顶层分组选择器（含酒精 / 无酒精 / 装饰） ── */}
          {/* ── 所属库选择器（七选项，对齐酒款编辑） ── */}
          {/* ── AI 建议横幅（中置信度时显示） ── */}
          {aiLibrarySuggestion && (
            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.primary + "18", borderRadius: 10, padding: 10, marginBottom: 8, gap: 8 }}>
              <IconSymbol name="sparkles" size={14} color={colors.primary} />
              <Text style={{ flex: 1, fontSize: 12, color: colors.foreground }}>
                {lang === "en"
                  ? `AI suggests: ${aiLibrarySuggestion.category}${aiLibrarySuggestion.style ? ` · ${aiLibrarySuggestion.style}` : ""} — please confirm`
                  : `AI 建议归入：${aiLibrarySuggestion.category}${aiLibrarySuggestion.style ? ` · ${aiLibrarySuggestion.style}` : ""}，请确认`}
              </Text>
              <Pressable
                onPress={() => {
                  setLibraryDest(aiLibrarySuggestion.library);
                  if (aiLibrarySuggestion.category) setBottleCategory(aiLibrarySuggestion.category);
                  setAiLibrarySuggestion(null);
                }}
                style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.primary, borderRadius: 6 }}
              >
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#FFFFFF" }}>{lang === "en" ? "Apply" : "应用"}</Text>
              </Pressable>
              <Pressable
                onPress={() => setAiLibrarySuggestion(null)}
                style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.surface, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}
              >
                <Text style={{ fontSize: 12, color: colors.muted }}>{lang === "en" ? "Ignore" : "忽略"}</Text>
              </Pressable>
            </View>
          )}
          <Text style={{ fontSize: 13, fontWeight: "500", color: colors.muted, marginBottom: 6 }}>
            {lang === "zh" ? "所属库" : "Library"}
          </Text>
          {/* 第一行：自制库三分组 */}
          <View style={{ flexDirection: "row", backgroundColor: colors.border + "55", borderRadius: 10, padding: 2, gap: 2, marginBottom: 4 }}>
            {[
              { key: "auto" as const, zhLabel: "自动", enLabel: "Auto" },
              { key: "auto_alcoholic" as const, zhLabel: "含酒精自制", enLabel: "Alcoholic" },
              { key: "auto_non_alcoholic" as const, zhLabel: "无酒精自制", enLabel: "Zero-Proof" },
              { key: "auto_garnish" as const, zhLabel: "装饰", enLabel: "Garnish" },
            ].map((opt) => {
              const isActive =
                opt.key === "auto" ? libraryDest === "auto" :
                opt.key === "auto_alcoholic" ? libraryDest === "auto" && selectedGroup === "alcoholic" :
                opt.key === "auto_non_alcoholic" ? libraryDest === "auto" && selectedGroup === "non_alcoholic" :
                libraryDest === "auto" && selectedGroup === "garnish";
              const active = isActive;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setLibraryDest("auto");
                    if (opt.key === "auto_alcoholic") handleGroupChange("alcoholic");
                    else if (opt.key === "auto_non_alcoholic") handleGroupChange("non_alcoholic");
                    else if (opt.key === "auto_garnish") handleGroupChange("garnish");
                  }}
                  style={[
                    { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center" as const },
                    active && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
                  ]}
                >
                  <Text style={{ fontSize: 11, fontWeight: active ? "600" : "400", color: active ? colors.foreground : colors.muted }}>
                    {lang === "en" ? opt.enLabel : opt.zhLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* 第二行：酒库三分组 */}
          <View style={{ flexDirection: "row", backgroundColor: colors.border + "55", borderRadius: 10, padding: 2, gap: 2, marginBottom: 12 }}>
            {BOTTLE_GROUPS.map((grp) => {
              const active = libraryDest === grp.key;
              return (
                <Pressable
                  key={grp.key}
                  onPress={() => { setLibraryDest(grp.key); }}
                  style={[
                    { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center" as const },
                    active && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
                  ]}
                >
                  <Text style={{ fontSize: 11, fontWeight: active ? "600" : "400", color: active ? colors.foreground : colors.muted }}>
                    {lang === "en" ? grp.en : grp.zh}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* 选了酒库时显示 Category 标签 */}
          {libraryDest !== "auto" && (
            <View style={{ marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: "500", color: colors.muted, marginBottom: 6 }}>
                {lang === "zh" ? "分类" : "Category"}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {categoriesOfGroup(libraryDest).map((cat) => {
                  const active = bottleCategory === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setBottleCategory(cat)}
                      style={[
                        styles.chip,
                        { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                        {categoryLabel(cat, lang)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          {/* ── 当前分组的类型标签 ── */}
          {(() => {
            const groupSections = sections.filter(
              (sec) => prepGroupOfSection(sections, sec.key) === selectedGroup,
            );
            return groupSections.map((sec) => {
              const sectionTypes = typeList.filter((pt) => pt.section === sec.key);
              if (sectionTypes.length === 0) return null;
              return (
                <View key={sec.key} style={{ marginBottom: 6 }}>
                  <Text className="text-xs text-muted mb-1.5" style={{ lineHeight: 16 }}>
                    {lang === "en" ? sec.en : sec.zh}
                  </Text>
                  <View style={styles.chipWrap}>
                    {sectionTypes.map((pt) => {
                      const active = type === pt.key;
                      return (
                        <Pressable
                          key={pt.key}
                          onPress={() => {
                            setType(pt.key);
                            setTypeTouched(true);
                          }}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: active ? colors.primary : colors.surface,
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                            {lang === "en" ? pt.en : pt.zh}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            });
          })()}

          {fieldLabel(t("hmform.ingredients"))}
          <NestableDraggableFlatList
            data={ingRows}
            keyExtractor={(item) => item.id}
            renderItem={renderIngRow}
            onDragEnd={({ data }) => setIngRows(data)}
            scrollEnabled={false}
            activationDistance={10}
          />
          <Pressable
            onPress={addIngRow}
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
            <Text
              className="text-sm font-medium"
              style={{ color: colors.primary, lineHeight: 20 }}
            >
              {t("form.addIngredient")}
            </Text>
          </Pressable>

          {/* ── 实时成本估算面板（方案A）──────────────────────────────────── */}
          {liveEstimate && (
            <View style={{ marginTop: 8, marginBottom: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }}>
              {/* 汇总行 */}
              <Pressable
                onPress={() => setCostDetailOpen((v) => !v)}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 }, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <IconSymbol name="sparkles" size={14} color={colors.primary} />
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
                    {lang === "zh" ? "系统估算" : "Est. Cost"}
                  </Text>
                  {parseFloat(normalBatchCost) > 0 ? (
                    <Text style={{ fontSize: 13, color: colors.muted, textDecorationLine: "line-through" }}>
                      {"¥" + liveEstimate.batchCost.toFixed(1)}
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                      {"¥" + liveEstimate.batchCost.toFixed(1)}
                    </Text>
                  )}
                  {parseFloat(normalBatchCost) > 0 && (
                    <View style={{ backgroundColor: colors.warning + "22", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.warning, fontWeight: "600" }}>
                        {lang === "zh" ? ("手动 ¥" + normalBatchCost) : ("Manual ¥" + normalBatchCost)}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {liveEstimate.estimatedCount + "/" + liveEstimate.totalCount + " " + (lang === "zh" ? "已识别" : "matched")}
                  </Text>
                  <IconSymbol name={costDetailOpen ? "chevron.up" : "chevron.down"} size={12} color={colors.muted} />
                </View>
              </Pressable>
              {/* 风险7：明细默认折叠 */}
              {costDetailOpen && (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  {liveEstimate.items.slice(0, 8).map((item, idx) => (
                    <View key={idx} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 7, borderTopWidth: idx > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.border }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: item.cost != null ? colors.success : colors.muted }} />
                        <Text style={{ fontSize: 12, color: colors.foreground, flex: 1 }} numberOfLines={1}>
                          {item.line}
                        </Text>
                        {item.bottleId ? (
                          <View style={{ backgroundColor: colors.primary + "18", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                            <Text style={{ fontSize: 10, color: colors.primary }}>{lang === "zh" ? "酒库" : "Lib"}</Text>
                          </View>
                        ) : item.cost != null ? (
                          <View style={{ backgroundColor: colors.success + "18", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                            <Text style={{ fontSize: 10, color: colors.success }}>{lang === "zh" ? "内置" : "Ref"}</Text>
                          </View>
                        ) : (
                          <View style={{ backgroundColor: colors.muted + "18", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                            <Text style={{ fontSize: 10, color: colors.muted }}>{"?"}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ fontSize: 12, color: item.cost != null ? colors.foreground : colors.muted, marginLeft: 8, minWidth: 48, textAlign: "right" }}>
                        {item.cost != null ? ("≈ ¥" + item.cost.toFixed(2)) : (lang === "zh" ? "未识别" : "—")}
                      </Text>
                    </View>
                  ))}
                  {liveEstimate.items.length > 8 && (
                    <View style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{("+" + (liveEstimate.items.length - 8) + " " + (lang === "zh" ? "条" : "more"))}</Text>
                    </View>
                  )}
                </View>
              )}
              {/* 风险4+5：手动覆盖折叠区 */}
              <Pressable
                onPress={() => setCostOverrideOpen((v) => !v)}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.7 }]}
              >
                <Text style={{ fontSize: 12, color: colors.muted }}>
                  {parseFloat(normalBatchCost) > 0
                    ? (lang === "zh" ? ("✎ 手动填写 ¥" + normalBatchCost + "（已覆盖估算）") : ("✎ Manual ¥" + normalBatchCost + " (overrides estimate)"))
                    : (lang === "zh" ? "手动精确填写批次总成本 ▾" : "Enter exact batch cost ▾")}
                </Text>
                <IconSymbol name={costOverrideOpen ? "chevron.up" : "chevron.down"} size={12} color={colors.muted} />
              </Pressable>
              {costOverrideOpen && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>
                    {lang === "zh" ? "手动填写将覆盖系统估算，适用于已知实际采购成本" : "Manual entry overrides estimate; use when you know actual cost"}
                  </Text>
                  <TextInput
                    style={inputStyle}
                    value={normalBatchCost}
                    onChangeText={setNormalBatchCost}
                    placeholder={lang === "zh" ? "批次总成本（¥），如：40" : "Batch total cost (¥), e.g. 40"}
                    placeholderTextColor={colors.muted}
                    keyboardType="numeric"
                    returnKeyType="done"
                  />
                </View>
              )}
            </View>
          )}
          {/* 无原料时仍显示批次总成本输入框（保持原有行为） */}
          {!liveEstimate && (
            <View style={{ marginBottom: 8 }}>
              {fieldLabel(lang === "zh" ? "批次总成本（¥）" : "Batch Total Cost (¥)")}
              <TextInput
                style={inputStyle}
                value={normalBatchCost}
                onChangeText={setNormalBatchCost}
                placeholder={lang === "zh" ? "填写原料总花费，系统将自动 ÷ 产量" : "Total ingredient cost; system divides by yield"}
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                returnKeyType="done"
              />
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                {lang === "zh" ? "成本核算 = 批次总成本 ÷ 产量，如：¥40 ÷ 300ml = ¥0.13/ml" : "Cost = batch total ÷ yield, e.g. ¥40 ÷ 300ml = ¥0.13/ml"}
              </Text>
            </View>
          )}

          {fieldLabel(t("hmform.recipe"))}
          {stepRows.map((row, idx) => (
            <View key={row.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#E5E7EB", alignItems: "center", justifyContent: "center", marginTop: 10, flexShrink: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#6B7280", lineHeight: 14 }}>{idx + 1}</Text>
              </View>
              <TextInput
                style={[{ flex: 1, minHeight: 44, textAlignVertical: "top", lineHeight: 22 }, ...inputStyle]}
                placeholder={lang === "en" ? `Step ${idx + 1}` : `步骤 ${idx + 1}`}
                placeholderTextColor={colors.muted}
                value={row.text}
                onChangeText={(v) => setStepRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, text: v } : r)))}
                multiline
              />
              <Pressable
                onPress={() => setStepRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== row.id) : prev)}
                hitSlop={8}
                style={({ pressed }) => [{ marginTop: 10 }, pressed && { opacity: 0.6 }]}
              >
                <IconSymbol name="minus.circle.fill" size={22} color={stepRows.length > 1 ? colors.error : colors.border} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() => setStepRows((prev) => [...prev, { id: genId(), text: "" }])}
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
            <Text style={{ fontSize: 14, fontWeight: "500", color: colors.primary, lineHeight: 20 }}>
              {lang === "zh" ? "添加步骤" : "Add Step"}
            </Text>
          </Pressable>

          {fieldLabel(t("hmform.yield"))}
          {/* 结构化产量：数量 + 单位选择器 */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 4 }}>
            <View style={{ flex: 1.2 }}>
              <TextInput
                style={inputStyle}
                value={yieldQty}
                onChangeText={setYieldQty}
                placeholder={lang === "zh" ? "数量，如：300" : "Qty, e.g. 300"}
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                returnKeyType="done"
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                inputStyle,
                { flex: 1.5, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setYieldUnitPickerOpen(true)}
            >
              <Text style={{ color: yieldUnit ? colors.foreground : colors.muted, fontSize: 15 }}>
                {yieldUnit || (lang === "zh" ? "选择单位" : "Unit")}
              </Text>
              <IconSymbol name="chevron.right" size={14} color={colors.muted} />
            </Pressable>
          </View>
          {/* 实时成本预览（升级版：标注来源，支持估算/手动） */}
          {(() => {
            const qty = parseFloat(yieldQty);
            const manualCost = parseFloat(normalBatchCost);
            const estimatedCost = liveEstimate?.batchCost ?? null;
            // 优先手动，其次估算
            const effectiveCost = manualCost > 0 ? manualCost : estimatedCost;
            const isManual = manualCost > 0;
            if (qty > 0 && effectiveCost != null && effectiveCost > 0 && yieldUnit) {
              const perUnit = effectiveCost / qty;
              const isLiquid = ["ml","L","oz","cl"].includes(yieldUnit);
              const isWeight = ["g","kg","斤"].includes(yieldUnit);
              let preview = "¥" + perUnit.toFixed(4) + "/" + yieldUnit;
              if (isLiquid && yieldUnit === "ml") preview += "  ·  ¥" + (perUnit * 30).toFixed(3) + "/30ml";
              if (isWeight && yieldUnit === "g") preview += "  ·  ¥" + (perUnit * 100).toFixed(3) + "/100g";
              return (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, paddingHorizontal: 4 }}>
                  <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
                  <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>{preview}</Text>
                  <View style={{ backgroundColor: (isManual ? colors.warning : colors.primary) + "22", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ fontSize: 10, color: isManual ? colors.warning : colors.primary, fontWeight: "600" }}>
                      {isManual ? (lang === "zh" ? "手动" : "Manual") : (lang === "zh" ? "估算" : "Est.")}
                    </Text>
                  </View>
                </View>
              );
            }
            return (
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                {lang === "zh"
                  ? "例：300 ml（糖浆）、20 个（装饰）、500 g（腌制原料）"
                  : "e.g. 300 ml (syrup), 20 pcs (garnish), 500 g (marinated)"}
              </Text>
            );
          })()}
          {/* 批次总成本：仅在无原料（无 liveEstimate）时显示独立输入框；有原料时已集成在估算面板中 */}
          {!liveEstimate && (
            <View style={{ marginBottom: 8 }}>
              {fieldLabel(lang === "zh" ? "批次总成本（¥）" : "Batch Total Cost (¥)")}
              <TextInput
                style={inputStyle}
                value={normalBatchCost}
                onChangeText={setNormalBatchCost}
                placeholder={lang === "zh"
                  ? "填写原料总花费，系统将自动 ÷ 产量"
                  : "Total ingredient cost; system divides by yield"}
                placeholderTextColor={colors.muted}
                keyboardType="numeric"
                returnKeyType="done"
              />
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                {lang === "zh"
                  ? "成本核算 = 批次总成本 ÷ 产量，如：¥40 ÷ 300ml = ¥0.13/ml"
                  : "Cost = batch total ÷ yield, e.g. ¥40 ÷ 300ml = ¥0.13/ml"}
              </Text>
            </View>
          )}

          {fieldLabel(t("hmform.shelfLife"))}
          {selectedGroup === "garnish" ? (
            /* 装饰：保鲜期快捷选项 */
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              {SHELF_LIFE_OPTIONS.map((opt) => {
                const active = shelfLifeKey === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => setShelfLifeKey(active ? "" : opt.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.warning : colors.surface,
                        borderColor: active ? colors.warning : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>
                      {lang === "en" ? opt.en : opt.zh}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              style={inputStyle}
              value={shelfLife}
              onChangeText={setShelfLife}
              placeholder={lang === "en" ? "e.g. 2 weeks refrigerated" : "如:冷藏2周"}
              placeholderTextColor={colors.muted}
              returnKeyType="done"
            />
          )}

          {/* ── 装饰专属字段区块 ── */}
          {selectedGroup === "garnish" && (
            <>
              {fieldLabel(lang === "en" ? "Prep Method" : "制作方式")}
              <TextInput
                style={inputStyle}
                value={prepMethod}
                onChangeText={setPrepMethod}
                placeholder={lang === "en" ? "e.g. Peel, dehydrate 4h at 80°C" : "如:削皮，80°C 脱水 4 小时"}
                placeholderTextColor={colors.muted}
                returnKeyType="done"
              />

              {fieldLabel(lang === "en" ? "Unit (per piece)" : "计量单位（每件）")}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {["片", "枝", "颗", "根", "个", "克", "piece", "sprig", "slice"].map((u) => {
                  const active = garnishUnit === u;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => setGarnishUnit(u)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>
                        {u}
                      </Text>
                    </Pressable>
                  );
                })}
                <TextInput
                  style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface, minWidth: 60 }]}
                  value={["片","枝","颗","根","个","克","piece","sprig","slice"].includes(garnishUnit) ? "" : garnishUnit}
                  onChangeText={setGarnishUnit}
                  placeholder={lang === "en" ? "custom" : "自定义"}
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                />
              </View>

              {fieldLabel(lang === "en" ? "Source Family (optional)" : "原料家族（可选）")}
              <View style={{ position: "relative", zIndex: 10 }}>
                <TextInput
                  style={inputStyle}
                  value={sourceFamilyKey}
                  onChangeText={(v) => { setSourceFamilyKey(v); setShowFamilySuggestions(true); }}
                  onFocus={() => setShowFamilySuggestions(true)}
                  onBlur={() => setTimeout(() => setShowFamilySuggestions(false), 150)}
                  placeholder={lang === "en" ? "e.g. yellow-lemon  (group related garnishes)" : "如: yellow-lemon（同源装饰品填相同值）"}
                  placeholderTextColor={colors.muted}
                  returnKeyType="done"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {showFamilySuggestions && familyKeySuggestions.length > 0 && (
                  <View
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                      maxHeight: 160,
                      overflow: "hidden",
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.08,
                      shadowRadius: 4,
                      elevation: 4,
                    }}
                  >
                    <FlatList
                      data={familyKeySuggestions}
                      keyExtractor={(item) => item}
                      keyboardShouldPersistTaps="always"
                      renderItem={({ item, index }) => (
                        <Pressable
                          onPress={() => { setSourceFamilyKey(item); setShowFamilySuggestions(false); }}
                          style={({ pressed }) => ({
                            paddingHorizontal: 14,
                            paddingVertical: 10,
                            backgroundColor: pressed ? colors.primary + "18" : "transparent",
                            borderTopWidth: index === 0 ? 0 : 0.5,
                            borderTopColor: colors.border,
                          })}
                        >
                          <Text style={{ fontSize: 14, color: colors.foreground }}>{item}</Text>
                        </Pressable>
                      )}
                    />
                  </View>
                )}
              </View>

              {fieldLabel(lang === "en" ? "Variant Label (optional)" : "形态标签（可选）")}
              <TextInput
                style={inputStyle}
                value={variantLabel}
                onChangeText={setVariantLabel}
                placeholder={lang === "en" ? "e.g. Peel / Wedge / Slice" : "如: 皮卷 / 角形 / 薄片"}
                placeholderTextColor={colors.muted}
                returnKeyType="done"
              />

              {fieldLabel(lang === "en" ? "Cost" : "成本")}
              {/* 成本录入方式切换 */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                {(["direct", "batch"] as const).map((mode) => {
                  const active = costMode === mode;
                  const label = mode === "direct"
                    ? (lang === "en" ? "Direct" : "直接录入")
                    : (lang === "en" ? "Batch calc" : "批次折算");
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => setCostMode(mode)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.surface,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#fff" : colors.foreground }]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {costMode === "direct" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>¥</Text>
                  <TextInput
                    style={[inputStyle, { flex: 1 }]}
                    value={costPerUnit}
                    onChangeText={setCostPerUnit}
                    placeholder={lang === "en" ? "Cost per piece" : "每件成本（元）"}
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                  <Text style={{ color: colors.muted, fontSize: 13 }}>/{garnishUnit}</Text>
                </View>
              ) : (
                <>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                        {lang === "en" ? "Batch cost (¥)" : "制作总成本（¥）"}
                      </Text>
                      <TextInput
                        style={inputStyle}
                        value={batchCost}
                        onChangeText={setBatchCost}
                        placeholder="0.00"
                        placeholderTextColor={colors.muted}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
                        {lang === "en" ? `Yield (${garnishUnit})` : `产量（${garnishUnit}）`}
                      </Text>
                      <TextInput
                        style={inputStyle}
                        value={batchYield}
                        onChangeText={setBatchYield}
                        placeholder="20"
                        placeholderTextColor={colors.muted}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                      />
                    </View>
                  </View>
                  {/* 实时折算预览 */}
                  {batchCost && batchYield && parseFloat(batchCost) > 0 && parseFloat(batchYield) > 0 && (
                    <View style={{ marginTop: 6, padding: 8, backgroundColor: colors.surface, borderRadius: 8 }}>
                      <Text style={{ color: colors.primary, fontSize: 13 }}>
                        = ¥{(parseFloat(batchCost) / parseFloat(batchYield)).toFixed(2)} / {garnishUnit}
                      </Text>
                    </View>
                  )}
                </>
              )}
            </>
          )}

          {fieldLabel(t("hmform.storage"))}
          <TextInput
            style={inputStyle}
            value={storage}
            onChangeText={setStorage}
            placeholder={lang === "en" ? "e.g. Sealed bottle in fridge" : "如:密封冷藏"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />

          {fieldLabel(t("hmform.source"))}
          <TextInput
            style={inputStyle}
            value={source}
            onChangeText={setSource}
            placeholder={
              lang === "en"
                ? "e.g. The Waldorf Astoria Bar Book · Frank Caiafa · 2016"
                : "如:The Waldorf Astoria Bar Book · Frank Caiafa · 2016"
            }
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />

          {fieldLabel(t("hmform.notes"))}
          {/* ── 风味标签 ── */}
          {fieldLabel(lang === "en" ? "Flavor Tags" : "风味标签")}
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
            {lang === "en" ? "Select flavor characteristics (optional)" : "描述风味特征，可多选（可选）"}
          </Text>
          <View style={[styles.chipWrap, { marginBottom: 12 }]}>
            {FLAVOR_TAGS.map((tag) => {
              const active = flavorTags.includes(tag);
              return (
                <Pressable
                  key={tag}
                  onPress={() =>
                    setFlavorTags((prev) =>
                      active ? prev.filter((t) => t !== tag) : [...prev, tag],
                    )
                  }
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary + "18" : colors.surface,
                      borderColor: active ? colors.primary + "66" : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? colors.primary : colors.foreground }]}>
                    {tag}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={[...inputStyle, styles.multiline, { minHeight: 60 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder={lang === "en" ? "Usage notes, related cocktails…" : "用途、相关鸡尾酒…"}
            placeholderTextColor={colors.muted}
            multiline
          />
          {/* Bug5 修复：story/styleDesc/usageNotes 始终渲染，不做条件隐藏 */}
          {fieldLabel(lang === "en" ? "Story / Introduction" : "介绍/故事")}
          <TextInput
            style={[...inputStyle, styles.multiline, { minHeight: 60 }]}
            value={story}
            onChangeText={setStory}
            multiline
            placeholder={lang === "en" ? "Background, inspiration, or history…" : "背景、灵感或历史…"}
            placeholderTextColor={colors.muted}
          />
          {fieldLabel(lang === "en" ? "Style / Taste" : "风格/口感")}
          <TextInput
            style={inputStyle}
            value={styleDesc}
            onChangeText={setStyleDesc}
            placeholder={lang === "en" ? "e.g. Sweet, spicy, aromatic" : "如：甜润、辛辣、芳香"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />
          {fieldLabel(lang === "en" ? "Usage Notes" : "调酒用途")}
          <TextInput
            style={inputStyle}
            value={usageNotes}
            onChangeText={setUsageNotes}
            placeholder={lang === "en" ? "e.g. Use in Mule, Sour, Fizz" : "如：用于 Mule、Sour、Fizz"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />
        </NestableScrollContainer>
      </KeyboardAvoidingView>
      {/* Unit picker sheet */}
      <UnitPickerSheet
        visible={unitPickerIngId !== null}
        selectedUnit={unitPickerIngId ? splitAmount(ingRows.find((r) => r.id === unitPickerIngId)?.amount ?? "").unit : ""}
        recentUnits={recentUnits}
        onSelect={(unit) => {
          if (!unitPickerIngId) return;
          const row = ingRows.find((r) => r.id === unitPickerIngId);
          if (!row) return;
          const { qty } = splitAmount(row.amount);
          updateIngRow(unitPickerIngId, "amount", mergeAmount(qty, unit));
          if (unit) addRecentUnit(unit);
        }}
        onClose={() => setUnitPickerIngId(null)}
      />
      {/* 产量单位选择器 */}
      <UnitPickerSheet
        visible={yieldUnitPickerOpen}
        selectedUnit={yieldUnit}
        recentUnits={[]}
        onSelect={(unit) => {
          setYieldUnit(unit);
          setYieldUnitPickerOpen(false);
        }}
        onClose={() => setYieldUnitPickerOpen(false)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    lineHeight: 20,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: "top",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  suggestBox: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 4,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 44,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
});
