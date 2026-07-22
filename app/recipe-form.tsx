import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActionSheetIOS,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { NestableScrollContainer, NestableDraggableFlatList, RenderItemParams } from "react-native-draggable-flatlist";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenContainer } from "@/components/screen-container";
import { SmartImportBar } from "@/components/smart-import-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNetwork } from "@/hooks/use-network";
import { useI18n } from "@/lib/i18n";
import { suggestPrep } from "@/lib/homemade/match";
import { smartLinkIngredient, smartLinkDisplayName } from "@/lib/recipes/smart-link";
import { analyzeUnknownIngredient } from "@/lib/classify";
import { LinkPickerSheet } from "@/components/link-picker-sheet";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useBottleStore } from "@/lib/bottles/store";
import { displayNames } from "@/lib/utils";
import { suggestIngredients } from "@/lib/suggest";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { RecipeDraft, useRecipeStore } from "@/lib/recipes/store";
import { enrichRecipe as enrichRecipeAI, deepAnalyzeRecipe as deepAnalyzeRecipeAI } from "@/lib/api/smart-router";
import { parseRecipeText, toTitleCase } from "@/lib/recipes/parser";
import { splitAmount, mergeAmount, unitDisplayLabel } from "@/lib/units";
import { UnitPickerSheet } from "@/components/unit-picker-sheet";
import { useRecentUnits } from "@/hooks/use-recent-units";
import { estimateRecipeAbv } from "@/lib/recipes/abv";
import {
  CODEX_FAMILIES,
  CATEGORY_COLORS,
  Ingredient,
  METHODS,
  ICE_TYPES,
  STRENGTH_LABELS,
  STRENGTH_BAND_LABELS,
  codexFamilyLabel,
  genId,
  localizedTagName,
  splitBilingualName,
  FLAVOR_TAGS,
  FLAVOR_TASTE_TAGS,
  FLAVOR_AROMA_TAGS,
  FLAVOR_TEXTURE_TAGS,
  FLAVOR_LAYER_LABELS,
  FLAVOR_TAG_EN,
  emptySourceRef,
  type SourceRef,
  normalizeTagToZh,
  normalizeTagArrayToZh,
  DRINK_DURATIONS,
  OCCASIONS,
  type GarnishItem,
  parseGarnishToItems,
  serializeGarnishItems,
} from "@/lib/recipes/types";
import { FLAVOR_TAG_DEFAULT_COLORS } from "@/lib/settings/card-tags";

function ChipGroup({
  options,
  value,
  onChange,
  colorsMap,
  newTags,
  labelOf,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  colorsMap?: Record<string, string>;
  newTags?: readonly string[];
  /** 可选:将选项值映射为本地化显示文本(值本身仍作为存储主键) */
  labelOf?: (v: string) => string;
}) {
  const colors = useColors();
  return (
    <View style={styles.chipWrap}>
      {options.map((opt) => {
        const active = value === opt;
        const tint = colorsMap?.[opt];
        const isNew = newTags?.includes(opt) ?? false;
        return (
          <View key={opt} style={{ position: "relative" }}>
            <Pressable
              onPress={() => onChange(opt)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? (tint ?? colors.primary) : colors.surface,
                  borderColor: active
                    ? (tint ?? colors.primary)
                    : isNew
                      ? "#FF9500"
                      : (tint ? tint + "66" : colors.border),
                  borderWidth: isNew && !active ? 1.5 : 1,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                {labelOf ? labelOf(opt) : opt}
              </Text>
            </Pressable>
            {isNew ? (
              <View
                style={{
                  position: "absolute",
                  top: -5,
                  right: -3,
                  backgroundColor: "#FF9500",
                  borderRadius: 6,
                  paddingHorizontal: 4,
                  paddingVertical: 1,
                }}
              >
                <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: "700", color: "#FFFFFF" }}>新</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** 多选基酒 Chip 组，支持逗号分隔的多值字符串，带置信度边框 */
function MultiSpiritChipGroup({
  options,
  value,
  onChange,
  colorsMap,
  newTags,
  labelOf,
  aiConfidence,
  aiSuggestedSpirits,
}: {
  options: readonly string[];
  value: string; // comma-separated, e.g. "威士忌,白兰地"
  onChange: (v: string) => void;
  colorsMap?: Record<string, string>;
  newTags?: readonly string[];
  labelOf?: (v: string) => string;
  aiConfidence?: "high" | "medium" | "low" | null;
  aiSuggestedSpirits?: string[];
}) {
  const colors = useColors();
  const selected = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const toggle = (opt: string) => {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    onChange(next.join(","));
  };

  const getAiBorderColor = (opt: string): string | null => {
    if (!aiSuggestedSpirits?.includes(opt)) return null;
    if (aiConfidence === "high") return "#34C759";
    if (aiConfidence === "medium") return "#FF9500";
    return "#FF6B35";
  };

  return (
    <View style={styles.chipWrap}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        const tint = colorsMap?.[opt];
        const isNew = newTags?.includes(opt) ?? false;
        const aiBorderColor = getAiBorderColor(opt);
        return (
          <View key={opt} style={{ position: "relative" }}>
            <Pressable
              onPress={() => toggle(opt)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? (tint ?? colors.primary) : colors.surface,
                  borderColor: active
                    ? (tint ?? colors.primary)
                    : isNew
                      ? "#FF9500"
                      : aiBorderColor
                        ? aiBorderColor
                        : (tint ? tint + "66" : colors.border),
                  borderWidth: (isNew && !active) || (!!aiBorderColor && !active) ? 1.5 : 1,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                {labelOf ? labelOf(opt) : opt}
              </Text>
            </Pressable>
            {isNew && !active ? (
              <View style={{ position: "absolute", top: -5, right: -3, backgroundColor: "#FF9500", borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 }}>
                <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: "700", color: "#FFFFFF" }}>新</Text>
              </View>
            ) : aiBorderColor && !active && !isNew ? (
              <View style={{ position: "absolute", top: -5, right: -3, backgroundColor: aiBorderColor, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 }}>
                <Text style={{ fontSize: 9, lineHeight: 11, fontWeight: "700", color: "#FFFFFF" }}>AI</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export default function RecipeFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { recentUnits, addRecentUnit } = useRecentUnits();
  const {
    prefillName,
    prefillNameEn,
    prefillBaseSpirit,
    prefillGlass,
    prefillSteps,
    prefillGarnish,
    prefillNotes,
    prefillIngredients,
  } = useLocalSearchParams<{
    prefillName?: string;
    prefillNameEn?: string;
    prefillBaseSpirit?: string;
    prefillGlass?: string;
    prefillSteps?: string;
    prefillGarnish?: string;
    prefillNotes?: string;
    prefillIngredients?: string;
  }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n();
  const { getRecipe, addRecipe, updateRecipe, categories, tagsOf, addTag, tags } = useRecipeStore();
  // AI 调用通过 smart-router 直接调用，无需 tRPC mutation
  const { isOnline } = useNetwork();
  const { preps } = useHomemadeStore();
  const { bottles } = useBottleStore();
  const { groupOf } = useBottleTaxonomy();
  const editing = getRecipe(id);
  // Parse prefill ingredients from JSON string (from book reader extract)
  const prefillIngredientsArr = useMemo<Ingredient[]>(() => {
    if (!prefillIngredients) return [];
    try { return JSON.parse(prefillIngredients) as Ingredient[]; } catch { return []; }
  }, [prefillIngredients]);

  const spiritTags = tagsOf("spirit");
  const glassTags = tagsOf("glass");
  const spiritNames = spiritTags.map((t) => t.name);
  const glassNames = glassTags.map((t) => t.name);
  const spiritColors = Object.fromEntries(spiritTags.map((t) => [t.name, t.color]));
  const glassColors = Object.fromEntries(glassTags.map((t) => [t.name, t.color]));

  const [name, setName] = useState(editing?.name ?? "");
  const [nameEn, setNameEn] = useState(editing?.nameEn ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null);
  const [baseSpirit, setBaseSpirit] = useState(editing?.baseSpirit ?? "");
  const [glass, setGlass] = useState(editing?.glass ?? "");
  const [method, setMethod] = useState(editing?.method ?? "摇和");
  const [ice, setIce] = useState(editing?.ice ?? "");
  const [variantOf, setVariantOf] = useState(editing?.variantOf ?? "");
  const [codexFamily, setCodexFamily] = useState(editing?.codexFamily ?? "");
  const [flavors, setFlavors] = useState<string[]>(editing?.flavors ?? []);
  const [drinkDuration, setDrinkDuration] = useState(editing?.drinkDuration ?? "");
  const [occasion, setOccasion] = useState(editing?.occasion ?? "");
  /** 用户手动选择保护标记：true 时 AI 不覆盖 */
  const [durationUserOverride, setDurationUserOverride] = useState(!!(editing?.drinkDuration));
  const [occasionUserOverride, setOccasionUserOverride] = useState(!!(editing?.occasion));
  const [source, setSource] = useState(editing?.source ?? "");
  const [sourceRef, setSourceRef] = useState<SourceRef>(editing?.sourceRef ?? emptySourceRef());
  const [showSourceRef, setShowSourceRef] = useState(
    !!(editing?.sourceRef && (editing.sourceRef.bookTitle || editing.sourceRef.creator || editing.sourceRef.createdYear))
  );
  const [story, setStory] = useState(editing?.story ?? "");
  const [flavorDesc, setFlavorDesc] = useState(editing?.flavorDesc ?? "");
  // 三段式风味描述解析
  const parseFlavorDesc = (raw: string) => {
    const zhLabels = ['核心基调', '风味演变', '整体质感'];
    const enLabels = ['Core profile', 'Flavor evolution', 'Overall texture'];
    const result = { tone: '', evolution: '', texture: '' };
    if (!raw) return result;
    const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean);
    for (const line of lines) {
      // 同时支持全角冒号「：」和半角冒号「:」
      const colonIdx = line.search(/[：:]/);
      if (colonIdx > 0) {
        const label = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        const zhIdx = zhLabels.indexOf(label);
        const enIdx = enLabels.indexOf(label);
        const idx = zhIdx >= 0 ? zhIdx : enIdx >= 0 ? enIdx : -1;
        if (idx === 0) result.tone = value;
        else if (idx === 1) result.evolution = value;
        else if (idx === 2) result.texture = value;
      }
    }
    return result;
  };
  const parsedFlavor = parseFlavorDesc(editing?.flavorDesc ?? "");
  const [flavorTone, setFlavorTone] = useState(parsedFlavor.tone);
  const [flavorEvolution, setFlavorEvolution] = useState(parsedFlavor.evolution);
  const [flavorTexture, setFlavorTexture] = useState(parsedFlavor.texture);
  // 合并三段为 flavorDesc 字符串
  const buildFlavorDesc = (tone: string, evolution: string, texture: string) => {
    const parts: string[] = [];
    if (tone.trim()) parts.push(`核心基调: \${tone.trim()}`);
    if (evolution.trim()) parts.push(`风味演变: \${evolution.trim()}`);
    if (texture.trim()) parts.push(`整体质感: \${texture.trim()}`);
    return parts.join('\n');
  };
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    editing?.ingredients?.length
      ? editing.ingredients
      : [{ id: genId(), name: "", amount: "" }],
  );
  /** 每个成分行的手动库选择：key=ingredientId, value=preferredSource */
  const [ingSourceMap, setIngSourceMap] = useState<Record<string, "auto" | "spirits" | "bottles" | "materials" | "homemade">>(() => {
    if (!editing?.ingredients?.length) return {};
    return Object.fromEntries(
      editing.ingredients
        .filter((i) => i.preferredSource && i.preferredSource !== "auto")
        .map((i) => [i.id, i.preferredSource as "auto" | "spirits" | "bottles" | "materials" | "homemade"])
    );
  });
  // ── Steps: stored as numbered string, edited as dynamic rows ──────────────
  /** Parse "1. xxx\n2. yyy" or plain text into step rows */
  const parseStepRows = (raw: string): { id: string; text: string }[] => {
    if (!raw.trim()) return [{ id: genId(), text: "" }];
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => ({
      id: genId(),
      text: l.replace(/^\d+[.、)]\s*/, "").trim(),
    }));
  };
  const serializeStepRows = (rows: { id: string; text: string }[]): string =>
    rows
      .filter((r) => r.text.trim())
      .map((r, i) => `${i + 1}. ${r.text.trim()}`)
      .join("\n");

  const [stepRows, setStepRows] = useState<{ id: string; text: string }[]>(() =>
    parseStepRows(editing?.steps ?? ""),
  );
  const steps = serializeStepRows(stepRows);

  // ── Garnish: stored as string, edited as linkable rows ────────────────────
  /** Parse garnish string (comma/semicolon separated or newline) into structured rows */
  const parseGarnishRows = (raw: string): GarnishItem[] => {
    const items = parseGarnishToItems(raw);
    return items.length > 0 ? items.map((g) => ({ ...g, id: genId() })) : [{ id: genId(), name: "" }];
  };
  const [garnishRows, setGarnishRows] = useState<GarnishItem[]>(() => {
    // 优先结构化字段（保留链接与忽略状态），旧数据从字符串解析
    if (editing?.garnishItems?.length) return editing.garnishItems.map((g) => ({ ...g }));
    return parseGarnishRows(editing?.garnish ?? "");
  });
  const garnish = serializeGarnishItems(garnishRows);
  const [focusedGarnish, setFocusedGarnish] = useState<string | null>(null);
  const [pickedGarnish, setPickedGarnish] = useState<Record<string, string>>({});
  /** 会话内 fuzzy 建议的忽略记录（持久化的忽略在 row.linkDismissed） */
  const [dismissedGarnishLinks, setDismissedGarnishLinks] = useState<Record<string, boolean>>({});
  const [acceptedGarnishLinks, setAcceptedGarnishLinks] = useState<Record<string, boolean>>({});
  /** 多候选选择器：当前正在为哪一行（装饰 g:/配料 i: 前缀）选择链接 */
  const [linkPickerTarget, setLinkPickerTarget] = useState<{ scope: "garnish" | "ingredient"; id: string; query: string } | null>(null);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [importHint, setImportHint] = useState("");
  /** Unit picker: which ingredient row is currently open */
  const [unitPickerIngId, setUnitPickerIngId] = useState<string | null>(null);
  /** AI story/source/flavorDesc completion state */
  const [aiEnriching, setAiEnriching] = useState(false);
  const [aiResult, setAiResult] = useState<{
    story?: string;
    flavorDesc?: string;
    source?: string;
    flavors?: string[];
    confidence?: "high" | "medium" | "low";
    suggestedBaseSpirit?: string;
    suggestedBaseSpiritConfidence?: "high" | "medium" | "low";
    suggestedGlass?: string;
    suggestedGlassConfidence?: "high" | "medium" | "low";
    suggestedIce?: string;
    suggestedIceConfidence?: "high" | "medium" | "low";
    isDeepAnalysis?: boolean;
    suggestedCategories?: string[];
    suggestedCodexFamily?: string;
    suggestedVariantOf?: string;
    variantOfDetail?: string;
    variantOfConfidence?: "high" | "medium" | "low";
    suggestedMethod?: string;
    creator?: string;
    createdYear?: string;
    suggestedDrinkDuration?: string;
    suggestedDurationConfidence?: "high" | "medium" | "low";
    suggestedOccasion?: string;
    suggestedOccasionConfidence?: "high" | "medium" | "low";
    suggestedNameZh?: string;
    suggestedNameEn?: string;
  } | null>(null);
  /** 逐字段 toggle：key = field key, value = true(接受) / false(拒绝) */
  const [aiToggles, setAiToggles] = useState<Record<string, boolean>>({});
  /** Undo snapshot：应用 AI 建议前的字段快照 */
  const [undoSnapshot, setUndoSnapshot] = useState<null | {
    story: string; flavorDesc: string; source: string; flavors: string[];
    baseSpirit: string; glass: string; ice: string; codexFamily: string;
    variantOf: string; method: string; drinkDuration: string; occasion: string;
    creator: string; createdYear: string;
    nameZh?: string; nameEn?: string;
  }>(null);
  /** Undo toast 倒计时 timer ref */
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 方案四：防止建议列表 onPressIn 被 onBlur 抢先关闭 */
  const pressingIngSuggestRef = useRef(false);
  const pressingGarnishSuggestRef = useRef(false);
  /** Which ingredient row is focused (shows live suggestions) */
  /** 风味标签专属置信度（来自自动 AI 分析） */
  const [flavorConfidence, setFlavorConfidence] = useState<"high" | "medium" | "low" | null>(null);
  /** AI 推断基酒的置信度 */
  const [spiritConfidence, setSpiritConfidence] = useState<"high" | "medium" | "low" | null>(null);
  /** AI 推断的基酒列表（用于置信度边框高亮） */
  const [aiSuggestedSpirits, setAiSuggestedSpirits] = useState<string[]>([]);
  const [newSpiritTags, setNewSpiritTags] = useState<string[]>([]);
  const [newGlassTags, setNewGlassTags] = useState<string[]>([]);
  // Track mount state to prevent setState after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Apply prefill data from book reader extract (only when no existing recipe is being edited)
  useEffect(() => {
    if (editing) return; // Don't overwrite existing recipe data
    if (prefillName) setName(prefillName);
    if (prefillNameEn) setNameEn(prefillNameEn);
    if (prefillBaseSpirit) {
      const hit = spiritNames.find((s) => prefillBaseSpirit.includes(s) || s.includes(prefillBaseSpirit));
      if (hit) {
        setBaseSpirit(hit);
      } else {
        const created = addTag("spirit", prefillBaseSpirit, CATEGORY_COLORS[0]);
        const nextName = created?.name ?? prefillBaseSpirit.trim();
        if (nextName) {
          setBaseSpirit(nextName);
          setNewSpiritTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
        }
      }
    }
    if (prefillGlass) {
      const hit = glassNames.find((g) => prefillGlass.includes(g) || g.includes(prefillGlass));
      if (hit) {
        setGlass(hit);
      } else {
        const created = addTag("glass", prefillGlass, CATEGORY_COLORS[3]);
        const nextName = created?.name ?? prefillGlass.trim();
        if (nextName) {
          setGlass(nextName);
          setNewGlassTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
        }
      }
    }
    if (prefillSteps) setStepRows(parseStepRows(prefillSteps));
    if (prefillGarnish) setGarnishRows(parseGarnishRows(prefillGarnish));
    if (prefillNotes) setNotes(prefillNotes);
    if (prefillIngredientsArr.length > 0) setIngredients(prefillIngredientsArr);
    if (prefillName || prefillNameEn || prefillIngredientsArr.length > 0) {
      setImportHint(lang === "zh" ? "已从书库提取配方，请核对后保存" : "Recipe extracted from book. Review before saving.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Which ingredient row is focused (shows live suggestions) */
  const [focusedIng, setFocusedIng] = useState<string | null>(null);
  /** 正在添加备选项的成分行 id → 临时输入值 */
  const [addAltIngId, setAddAltIngId] = useState<string | null>(null);
  const [addAltIngValue, setAddAltIngValue] = useState("");
  /** Rows where user picked/dismissed suggestions — suppress until text changes */
  const [pickedIng, setPickedIng] = useState<Record<string, string>>({});
  /** ingId → true: user dismissed the fuzzy link suggestion */
  // Pre-fill dismissed for existing ingredients when editing (avoid noisy fuzzy suggestions on open)
  const [dismissedLinks, setDismissedLinks] = useState<Record<string, boolean>>(() => {
    if (!editing?.ingredients?.length) return {};
    return Object.fromEntries(editing.ingredients.map((i) => [i.id, true]));
  });
  /** ingId → true: user explicitly accepted a fuzzy link */
  const [acceptedLinks, setAcceptedLinks] = useState<Record<string, boolean>>({});

  const ensureSpiritName = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    const hit = spiritNames.find((s) => cleaned.includes(s) || s.includes(cleaned));
    if (hit) return hit;
    const created = addTag("spirit", cleaned, CATEGORY_COLORS[0]);
    const nextName = created?.name ?? cleaned;
    setNewSpiritTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
    return nextName;
  };

  /** 处理 AI 返回的基酒（支持逗号分隔多基酒），返回逗号分隔的规范化名称 */
  const resolveAiSpirits = (raw: string): string => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const resolved = parts.map((p) => {
      // 先用词典规范化（英→中），再匹配已有标签
      const normalized = normalizeTagToZh(p);
      const hit = spiritNames.find((s) => normalized.includes(s) || s.includes(normalized) || p.includes(s) || s.includes(p));
      if (hit) return hit;
      // 词典命中了中文标准名，尝试匹配已有标签
      if (normalized !== p) {
        const normHit = spiritNames.find((s) => s === normalized || s.includes(normalized) || normalized.includes(s));
        if (normHit) return normHit;
        // 词典中文名存在但标签库里没有，直接用词典中文名（不创建新标签）
        return normalized;
      }
      // 未命中词典：短名称（≤8字符）才允许创建新标签，防止品牌描述被当成标签
      if (p.length <= 8) {
        const created = addTag("spirit", p, CATEGORY_COLORS[0]);
        const nextName = created?.name ?? p;
        setNewSpiritTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
        return nextName;
      }
      return "";
    });
    return [...new Set(resolved.filter(Boolean))].join(",");
  };
  const ensureGlassName = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    // 先用词典规范化（英→中），再匹配已有标签
    const normalized = normalizeTagToZh(cleaned);
    const searchName = normalized !== cleaned ? normalized : cleaned;
    const hit = glassNames.find((g) =>
      searchName.includes(g) || g.includes(searchName) ||
      cleaned.includes(g) || g.includes(cleaned)
    );
    if (hit) return hit;
    // 词典命中了中文名，直接使用，不创建重复标签
    if (normalized !== cleaned) return normalized;
    // 未命中词典，创建新标签
    const created = addTag("glass", cleaned, CATEGORY_COLORS[3]);
    const nextName = created?.name ?? cleaned;
    setNewGlassTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
    return nextName;
  };
  const normalizeIceName = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    // 先用词典规范化（英→中），再匹配标准冰块类型
    const normalized = normalizeTagToZh(cleaned);
    const searchName = normalized !== cleaned ? normalized : cleaned;
    return (
      ICE_TYPES.find((it) => searchName.includes(it) || it.includes(searchName)) ??
      ICE_TYPES.find((it) => cleaned.includes(it) || it.includes(cleaned)) ??
      normalized
    );
  };
  const handleAiEnrich = () => {
    const recipeName = name.trim() || nameEn.trim();
    if (!recipeName || aiEnriching) return;
    if (!isOnline) {
      Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
      return;
    }
    setAiEnriching(true);
    setAiResult(null);
    const ingNames = ingredients.map((i) => i.name).filter(Boolean);
    const ingWithAmounts = ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name, amount: i.amount }));
    enrichRecipeAI({
        name: recipeName,
        nameEn: nameEn.trim() || undefined,
        baseSpirit: baseSpirit || undefined,
        method: method || undefined,
        lang: lang as 'zh' | 'en',
      }).then((result) => {
          if (!isMountedRef.current) return;
          if (!baseSpirit && result.suggestedBaseSpirit) {
            const conf = result.suggestedBaseSpiritConfidence ?? "medium";
            const resolved = resolveAiSpirits(result.suggestedBaseSpirit);
            const spirits = resolved.split(",").map(s => s.trim()).filter(Boolean);
            setSpiritConfidence(conf);
            setAiSuggestedSpirits(spirits);
            if (conf === "high") {
              setBaseSpirit(resolved);
            }
          }
          if (!glass && result.suggestedGlass && result.suggestedGlassConfidence === "high") {
            const nextName = ensureGlassName(result.suggestedGlass);
            if (nextName) setGlass(nextName);
          }
          if (!ice && result.suggestedIce && result.suggestedIceConfidence === "high") {
            const nextName = normalizeIceName(result.suggestedIce);
            if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
          }
          setAiResult(result);
          setAiEnriching(false);
        }).catch((err: unknown) => {
          if (!isMountedRef.current) return;
          setAiEnriching(false);
          const msg = err instanceof Error ? err.message : "AI 分析失败，请重试";
          Alert.alert("AI 补全失败", msg);
        });
  };
  /**
   * 打开表单时自动触发 AI 风味分析（仅一次）。
   * 结果直接点亮风味标签；低置信度时显示警告横幅。
   */
  /** 深度解析：联网 + 强模型，补全所有字段 */
  const handleDeepAnalyze = () => {
    const recipeName = name.trim() || nameEn.trim();
    if (!recipeName || aiEnriching) return;
    if (!isOnline) {
      Alert.alert(t("offline.title"), t("offline.aiUnavailable"));
      return;
    }
    setAiEnriching(true);
    setAiResult(null);
    const ingNames = ingredients.map((i) => i.name).filter(Boolean);
    deepAnalyzeRecipeAI({
        name: name.trim() || nameEn.trim(),
        nameEn: nameEn.trim() || undefined,
        ingredients: ingNames.length > 0 ? ingNames.join(", ") : undefined,
        baseSpirit: baseSpirit || undefined,
        source: source.trim() || undefined,
        lang: lang as 'zh' | 'en',
      }).then((result) => {
          if (!isMountedRef.current) return;
          if (!baseSpirit && result.suggestedBaseSpirit) {
            const resolved = resolveAiSpirits(result.suggestedBaseSpirit);
            const spirits = resolved.split(",").map((s) => s.trim()).filter(Boolean);
            setSpiritConfidence("high");
            setAiSuggestedSpirits(spirits);
            setBaseSpirit(resolved);
          }
          if (!glass && result.suggestedGlass) {
            const nextName = ensureGlassName(result.suggestedGlass);
            if (nextName) setGlass(nextName);
          }
          if (!ice && result.suggestedIce) {
            const nextName = normalizeIceName(result.suggestedIce);
            if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
          }
          setAiResult({ ...result, isDeepAnalysis: true });
          setAiEnriching(false);
        }).catch((err: unknown) => {
          if (!isMountedRef.current) return;
          setAiEnriching(false);
          const msg = err instanceof Error ? err.message : "AI 补全失败，请重试";
          Alert.alert("AI 补全失败", msg);
        });
  };

  /** ─── AI Fill 字段定义 ─────────────────────────────────────────────── */
  type AiConflict = "new" | "override" | "confirm" | "low";
  type AiFieldDef = {
    key: string;
    labelZh: string;
    labelEn: string;
    aiValue: string;
    currentValue: string;
    conflict: AiConflict;
    confidence: "high" | "medium" | "low";
    /** 可选：多行预览内容，用于风味描述等多段字段 */
    aiValueLines?: { label: string; value: string }[];
  };

  /** 根据当前 aiResult 构建字段 diff 列表 */
  const buildAiFields = useCallback((): AiFieldDef[] => {
    if (!aiResult) return [];
    const fields: AiFieldDef[] = [];
    const conf = (c?: "high" | "medium" | "low") => c ?? "medium";
    const conflict = (cur: string, ai: string, c: "high" | "medium" | "low"): AiConflict => {
      if (c === "low") return "low";
      if (!cur) return "new";
      if (cur === ai) return "confirm";
      return "override";
    };

    // Base Spirit
    if (aiResult.suggestedBaseSpirit) {
      const resolved = resolveAiSpirits(aiResult.suggestedBaseSpirit) || aiResult.suggestedBaseSpirit;
      const c = conf(aiResult.suggestedBaseSpiritConfidence);
      fields.push({ key: "baseSpirit", labelZh: "基酒", labelEn: "Base Spirit", aiValue: resolved, currentValue: baseSpirit, conflict: conflict(baseSpirit, resolved, c), confidence: c });
    }
    // Glass
    if (aiResult.suggestedGlass) {
      const resolved = ensureGlassName(aiResult.suggestedGlass) || aiResult.suggestedGlass;
      const c = conf(aiResult.suggestedGlassConfidence);
      fields.push({ key: "glass", labelZh: "杯型", labelEn: "Glass", aiValue: resolved, currentValue: glass, conflict: conflict(glass, resolved, c), confidence: c });
    }
    // Ice
    if (aiResult.suggestedIce) {
      const resolved = normalizeIceName(aiResult.suggestedIce);
      const c = conf(aiResult.suggestedIceConfidence);
      if ((ICE_TYPES as readonly string[]).includes(resolved)) {
        fields.push({ key: "ice", labelZh: "冰块", labelEn: "Ice", aiValue: resolved, currentValue: ice, conflict: conflict(ice, resolved, c), confidence: c });
      }
    }
    // Method
    if (aiResult.suggestedMethod) {
      const nm = normalizeTagToZh(aiResult.suggestedMethod);
      const valid = METHODS.find((m) => m === nm || nm.includes(m) || m.includes(nm));
      if (valid) fields.push({ key: "method", labelZh: "制作方法", labelEn: "Method", aiValue: valid, currentValue: method, conflict: conflict(method, valid, "medium"), confidence: "medium" });
    }
    // Codex Family
    if (aiResult.suggestedCodexFamily) {
      const nf = CODEX_FAMILIES.find((f) => f === aiResult.suggestedCodexFamily || f.startsWith(aiResult.suggestedCodexFamily ?? "") || (aiResult.suggestedCodexFamily ?? "").includes(f.split(" ")[0])) ?? aiResult.suggestedCodexFamily;
      fields.push({ key: "codexFamily", labelZh: "Codex 家族", labelEn: "Codex Family", aiValue: nf, currentValue: codexFamily, conflict: conflict(codexFamily, nf, "medium"), confidence: "medium" });
    }
    // Variant Of
    // variantOf 永远出现（三状态必填：CLASSIC_ORIGINAL / 母配方名 / MODERN_ORIGINAL）
    {
      const sv = aiResult.suggestedVariantOf ?? "MODERN_ORIGINAL";
      const c = aiResult.variantOfConfidence ? conf(aiResult.variantOfConfidence) : "medium";
      const displayMap: Record<string, string> = {
        "CLASSIC_ORIGINAL": "经典原版 Classic Original",
        "MODERN_ORIGINAL": "现代创作 Modern Original",
      };
      const displayVal = displayMap[sv] ?? sv;
      const displayCur = variantOf ? (displayMap[variantOf] ?? variantOf) : "";
      fields.push({ key: "variantOf", labelZh: "变体来源", labelEn: "Variant Of", aiValue: displayVal, currentValue: displayCur, conflict: conflict(variantOf, sv, c), confidence: c });
    }
    // Drink Duration
    if (aiResult.suggestedDrinkDuration && (DRINK_DURATIONS as readonly string[]).includes(aiResult.suggestedDrinkDuration)) {
      const c = conf(aiResult.suggestedDurationConfidence);
      const dispAi = aiResult.suggestedDrinkDuration === "短饮" ? "Short Drink / 短饮" : "Long Drink / 长饮";
      const dispCur = drinkDuration === "短饮" ? "Short Drink / 短饮" : drinkDuration === "长饮" ? "Long Drink / 长饮" : drinkDuration;
      fields.push({ key: "drinkDuration", labelZh: "饮用时长", labelEn: "Duration", aiValue: dispAi, currentValue: dispCur, conflict: conflict(drinkDuration, aiResult.suggestedDrinkDuration, c), confidence: c });
    }
    // Occasion
    if (aiResult.suggestedOccasion && (OCCASIONS as readonly string[]).includes(aiResult.suggestedOccasion)) {
      const c = conf(aiResult.suggestedOccasionConfidence);
      const occEn: Record<string, string> = { "餐前酒": "Aperitif", "餐后酒": "Digestif", "全天酒": "All Day", "佐餐酒": "With Dinner", "睡前酒": "Nightcap", "派对酒": "Party" };
      const dispAi = `${occEn[aiResult.suggestedOccasion] ?? aiResult.suggestedOccasion} / ${aiResult.suggestedOccasion}`;
      const dispCur = occasion ? `${occEn[occasion] ?? occasion} / ${occasion}` : "";
      fields.push({ key: "occasion", labelZh: "饮用场合", labelEn: "Occasion", aiValue: dispAi, currentValue: dispCur, conflict: conflict(occasion, aiResult.suggestedOccasion, c), confidence: c });
    }
    // Story
    if (aiResult.story) {
      const c = conf(aiResult.confidence);
      fields.push({ key: "story", labelZh: "故事", labelEn: "Story", aiValue: aiResult.story.slice(0, 60) + (aiResult.story.length > 60 ? "…" : ""), currentValue: story ? story.slice(0, 30) + "…" : "", conflict: conflict(story.trim(), aiResult.story, c), confidence: c });
    }
    // Flavor Desc
    if (aiResult.flavorDesc) {
      const c = conf(aiResult.confidence);
      const pf = parseFlavorDesc(aiResult.flavorDesc);
      const aiValueLines = [
        pf.tone ? { label: lang === "zh" ? "核心基调" : "Core", value: pf.tone } : null,
        pf.evolution ? { label: lang === "zh" ? "风味演变" : "Evolution", value: pf.evolution } : null,
        pf.texture ? { label: lang === "zh" ? "整体质感" : "Texture", value: pf.texture } : null,
      ].filter(Boolean) as { label: string; value: string }[];
      const aiValueFallback = aiResult.flavorDesc.slice(0, 60) + (aiResult.flavorDesc.length > 60 ? "…" : "");
      fields.push({ key: "flavorDesc", labelZh: "风味描述", labelEn: "Flavor Desc", aiValue: aiValueFallback, currentValue: flavorDesc ? flavorDesc.slice(0, 30) + "…" : "", conflict: conflict(flavorDesc.trim(), aiResult.flavorDesc, c), confidence: c, aiValueLines: aiValueLines.length > 0 ? aiValueLines : undefined });
    }
    // Source
    if (aiResult.source) {
      fields.push({ key: "source", labelZh: "来源", labelEn: "Source", aiValue: aiResult.source, currentValue: source, conflict: conflict(source.trim(), aiResult.source, "medium"), confidence: "medium" });
    }
    // Creator / Year
    if (aiResult.creator || aiResult.createdYear) {
      const aiVal = [aiResult.creator, aiResult.createdYear].filter(Boolean).join(" · ");
      const curVal = [sourceRef.creator, sourceRef.createdYear].filter(Boolean).join(" · ");
      fields.push({ key: "creator", labelZh: "创作者", labelEn: "Creator", aiValue: aiVal, currentValue: curVal, conflict: conflict(curVal, aiVal, "medium"), confidence: "medium" });
    }
    // Flavors
    if (aiResult.flavors && aiResult.flavors.length > 0) {
      const normalized = normalizeTagArrayToZh(aiResult.flavors, FLAVOR_TAGS);
      if (normalized.length > 0) {
        const c = conf(aiResult.confidence);
        fields.push({ key: "flavors", labelZh: "风味标签", labelEn: "Flavors", aiValue: normalized.slice(0, 4).join(" · ") + (normalized.length > 4 ? ` +${normalized.length - 4}` : ""), currentValue: flavors.length > 0 ? flavors.slice(0, 3).join(" · ") + (flavors.length > 3 ? `…` : "") : "", conflict: conflict(flavors.length > 0 ? "has" : "", "has", c), confidence: c });
      }
    }
    // Name (Chinese)
    if (aiResult.suggestedNameZh && aiResult.suggestedNameZh.trim()) {
      const suggested = aiResult.suggestedNameZh.trim();
      fields.push({ key: "nameZh", labelZh: "中文名", labelEn: "Chinese Name", aiValue: suggested, currentValue: name, conflict: conflict(name.trim(), suggested, "medium"), confidence: "medium" });
    }
    // Name (English)
    if (aiResult.suggestedNameEn && aiResult.suggestedNameEn.trim()) {
      const suggested = aiResult.suggestedNameEn.trim();
      fields.push({ key: "nameEn", labelZh: "英文名", labelEn: "English Name", aiValue: suggested, currentValue: nameEn, conflict: conflict(nameEn.trim(), suggested, "medium"), confidence: "medium" });
    }
    return fields;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResult, baseSpirit, glass, ice, method, codexFamily, variantOf, drinkDuration, occasion, story, flavorDesc, source, sourceRef, flavors, name, nameEn, lang]);

  /** 初始化 toggles：新增字段默认 on，覆盖字段默认 off，低置信默认 off */
  useEffect(() => {
    if (!aiResult) { setAiToggles({}); return; }
    const fields = buildAiFields();
    const defaults: Record<string, boolean> = {};
    for (const f of fields) {
      defaults[f.key] = f.conflict === "new" || f.conflict === "confirm";
    }
    setAiToggles(defaults);
  }, [aiResult, buildAiFields]);

  /** 实际写入单个字段 */
  const applyField = useCallback((key: string) => {
    if (!aiResult) return;
    if (key === "baseSpirit" && aiResult.suggestedBaseSpirit) {
      const resolved = resolveAiSpirits(aiResult.suggestedBaseSpirit);
      if (resolved) { setBaseSpirit(resolved); setSpiritConfidence(null); setAiSuggestedSpirits([]); }
    } else if (key === "glass" && aiResult.suggestedGlass) {
      const n = ensureGlassName(aiResult.suggestedGlass); if (n) setGlass(n);
    } else if (key === "ice" && aiResult.suggestedIce) {
      const n = normalizeIceName(aiResult.suggestedIce); if ((ICE_TYPES as readonly string[]).includes(n)) setIce(n);
    } else if (key === "method" && aiResult.suggestedMethod) {
      const nm = normalizeTagToZh(aiResult.suggestedMethod);
      const v = METHODS.find((m) => m === nm || nm.includes(m) || m.includes(nm));
      if (v) setMethod(v);
    } else if (key === "codexFamily" && aiResult.suggestedCodexFamily) {
      const nf = CODEX_FAMILIES.find((f) => f === aiResult.suggestedCodexFamily || f.startsWith(aiResult.suggestedCodexFamily ?? "") || (aiResult.suggestedCodexFamily ?? "").includes(f.split(" ")[0])) ?? aiResult.suggestedCodexFamily;
      if (nf) setCodexFamily(nf);
    } else if (key === "variantOf") {
      // 与 buildAiFields 保持一致：suggestedVariantOf 为空时兜底 MODERN_ORIGINAL
      const sv = aiResult.suggestedVariantOf ?? "MODERN_ORIGINAL";
      setVariantOf(sv);
    } else if (key === "drinkDuration" && aiResult.suggestedDrinkDuration) {
      setDrinkDuration(aiResult.suggestedDrinkDuration); setDurationUserOverride(true);
    } else if (key === "occasion" && aiResult.suggestedOccasion) {
      setOccasion(aiResult.suggestedOccasion); setOccasionUserOverride(true);
    } else if (key === "story" && aiResult.story) {
      setStory(aiResult.story);
    } else if (key === "flavorDesc" && aiResult.flavorDesc) {
      setFlavorDesc(aiResult.flavorDesc);
      const pf = parseFlavorDesc(aiResult.flavorDesc);
      if (pf.tone) setFlavorTone(pf.tone);
      if (pf.evolution) setFlavorEvolution(pf.evolution);
      if (pf.texture) setFlavorTexture(pf.texture);
    } else if (key === "source" && aiResult.source) {
      setSource(aiResult.source);
    } else if (key === "creator" && (aiResult.creator || aiResult.createdYear)) {
      setSourceRef((prev) => ({ ...prev, creator: aiResult!.creator && !prev.creator ? aiResult!.creator : prev.creator, createdYear: aiResult!.createdYear && !prev.createdYear ? aiResult!.createdYear : prev.createdYear, creatorConfidence: "medium" }));
      setShowSourceRef(true);
    } else if (key === "flavors" && aiResult.flavors) {
      const normalized = normalizeTagArrayToZh(aiResult.flavors, FLAVOR_TAGS);
      if (normalized.length > 0) setFlavors(normalized);
    }
    else if (key === "nameZh" && aiResult.suggestedNameZh) {
      setName(aiResult.suggestedNameZh.trim());
    } else if (key === "nameEn" && aiResult.suggestedNameEn) {
      setNameEn(aiResult.suggestedNameEn.trim());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResult]);

  /** 应用所有 toggle=true 的字段，保存 undo 快照，显示 undo toast */
  const applyAiResult = useCallback((toggleOverride?: Record<string, boolean>) => {
    if (!aiResult) return;
    const toggles = toggleOverride ?? aiToggles;
    const fields = buildAiFields();
    // 保存 undo 快照
    setUndoSnapshot({ story, flavorDesc: buildFlavorDesc(flavorTone, flavorEvolution, flavorTexture), source, flavors, baseSpirit, glass, ice, codexFamily, variantOf, method, drinkDuration, occasion, creator: sourceRef.creator ?? "", createdYear: sourceRef.createdYear ?? "", nameZh: name, nameEn });
    // 应用选中字段
    for (const f of fields) {
      if (toggles[f.key] !== false) applyField(f.key);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAiResult(null);
    // 5 秒后自动清除 undo
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoSnapshot(null), 5000);
  }, [aiResult, aiToggles, buildAiFields, applyField, story, flavorTone, flavorEvolution, flavorTexture, source, flavors, baseSpirit, glass, ice, codexFamily, variantOf, method, drinkDuration, occasion, sourceRef, name, nameEn]);

  /** 撤销 AI 应用 */
  const undoAiApply = useCallback(() => {
    if (!undoSnapshot) return;
    setStory(undoSnapshot.story);
    setFlavorDesc(undoSnapshot.flavorDesc);
    const uf = parseFlavorDesc(undoSnapshot.flavorDesc);
    setFlavorTone(uf.tone); setFlavorEvolution(uf.evolution); setFlavorTexture(uf.texture);
    setSource(undoSnapshot.source);
    setFlavors(undoSnapshot.flavors);
    setBaseSpirit(undoSnapshot.baseSpirit);
    setGlass(undoSnapshot.glass);
    setIce(undoSnapshot.ice);
    setCodexFamily(undoSnapshot.codexFamily);
    setVariantOf(undoSnapshot.variantOf);
    setMethod(undoSnapshot.method as typeof METHODS[number]);
    setDrinkDuration(undoSnapshot.drinkDuration);
    setOccasion(undoSnapshot.occasion);
    if (undoSnapshot.creator || undoSnapshot.createdYear) {
      setSourceRef((prev) => ({ ...prev, creator: undoSnapshot!.creator, createdYear: undoSnapshot!.createdYear }));
    }
    if (undoSnapshot.nameZh !== undefined) setName(undoSnapshot.nameZh);
    if (undoSnapshot.nameEn !== undefined) setNameEn(undoSnapshot.nameEn);
    setUndoSnapshot(null);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [undoSnapshot]);

  const canSave = name.trim().length > 0 || nameEn.trim().length > 0;

  /** 根据配料与方法自动计算成品 ABV,并推导烈度大类与档位 */
  const abvEstimate = useMemo(
    () => estimateRecipeAbv(ingredients, method, bottles, preps),
    [ingredients, method, bottles, preps],
  );

  const updateIngredient = (iid: string, field: "name" | "amount", value: string) => {
    setIngredients((prev) => prev.map((i) => (i.id === iid ? { ...i, [field]: value } : i)));
    if (field === "name") {
      // Reset link decisions and clear explicit link IDs when user edits the name
      setDismissedLinks((prev) => { const n = { ...prev }; delete n[iid]; return n; });
      setAcceptedLinks((prev) => { const n = { ...prev }; delete n[iid]; return n; });
      setIngredients((prev) => prev.map((i) => i.id === iid ? { ...i, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: undefined } : i));
      // Bug 5: 用户手动修改输入时清除 pickedIng，避免建议列表状态歧义
      setPickedIng((prev) => { const n = { ...prev }; delete n[iid]; return n; });
    }
  };
  /** Done 键提交时拆分 or 备选 */
  const commitIngredientName = (iid: string, rawName: string) => {
    const OR_RE = /\s+(?:or|或|\/|\|)\s+/i;
    const STATE_ADJ_RE = /^(?:fresh|frozen|dried|canned|bottled|house-made|homemade|store-bought|organic|raw|cooked|roasted|toasted|ground|whole|sliced|diced|chopped|minced|peeled|zested|squeezed)$/i;
    if (!OR_RE.test(rawName.trim())) return;
    const parts = rawName.trim().split(OR_RE).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const allAdj = parts.slice(0, -1).every((p) => {
      const words = p.split(/\s+/);
      return words.length === 1 && STATE_ADJ_RE.test(words[0]);
    });
    if (allAdj) return;
    const [primary, ...alts] = parts;
    setIngredients((prev) => prev.map((i) =>
      i.id === iid ? { ...i, name: primary, alternatives: alts, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: undefined } : i
    ));
    setDismissedLinks((prev) => { const n = { ...prev }; delete n[iid]; return n; });
    setAcceptedLinks((prev) => { const n = { ...prev }; delete n[iid]; return n; });
  };

  const pickSuggestion = (iid: string, value: string) => {
    updateIngredient(iid, "name", value);
    setPickedIng((prev) => ({ ...prev, [iid]: value }));
    setFocusedIng(null);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const addIngredientRow = () => {
    setIngredients((prev) => [...prev, { id: genId(), name: "", amount: "" }]);
  };

  const removeIngredientRow = (iid: string) => {
    setIngredients((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== iid) : prev));
    setDismissedLinks((prev) => { const n = { ...prev }; delete n[iid]; return n; });
    setAcceptedLinks((prev) => { const n = { ...prev }; delete n[iid]; return n; });
  };

  const renderIngredientItem = useCallback(({ item: ing, drag, isActive }: RenderItemParams<Ingredient>) => {
    const trimmed = ing.name.trim();
    const ingSource = ingSourceMap[ing.id] ?? "auto";
    // ── 四状态判定：已忽略 > 显式 ID 链接 > 自动匹配（exact 自动链接 / fuzzy 待确认）──
    const iDismissed = ing.linkDismissed === true || dismissedLinks[ing.id] === true;
    const explicitIngBottle = !iDismissed && ing.linkedBottleId ? bottles.find((b) => b.id === ing.linkedBottleId) : undefined;
    const explicitIngPrep = !iDismissed && !explicitIngBottle && ing.linkedPrepId ? preps.find((p) => p.id === ing.linkedPrepId) : undefined;
    const explicitLink = explicitIngBottle
      ? ({ kind: "bottle", bottle: explicitIngBottle, matchConfidence: "exact" } as const)
      : explicitIngPrep
        ? ({ kind: "prep", prep: explicitIngPrep, matchConfidence: "exact" } as const)
        : null;
    const rawLink = !iDismissed && !explicitLink && trimmed.length >= 2 ? smartLinkIngredient(trimmed, bottles, preps, ingSource) : null;
    const isFuzzy = rawLink?.matchConfidence === "fuzzy";
    const link = explicitLink ?? (rawLink && (!isFuzzy || acceptedLinks[ing.id]) ? rawLink : null);
    const pendingFuzzyLink = !explicitLink && isFuzzy && !acceptedLinks[ing.id] ? rawLink : null;
    const prep = link?.kind === "prep" ? link.prep : null;
    const linkedBottle = link?.kind === "bottle" ? link.bottle : null;
    const suggestion = !rawLink && !explicitLink && !iDismissed && trimmed.length >= 2 ? suggestPrep(trimmed) : null;
    const classification =
      !rawLink && !explicitLink && !iDismissed && !suggestion && trimmed.length >= 3
        ? analyzeUnknownIngredient(trimmed, bottles, preps)
        : null;
    const showSuggest =
      focusedIng === ing.id && trimmed.length > 0 && pickedIng[ing.id] !== ing.name;
    const liveSuggestions = showSuggest
      ? suggestIngredients(trimmed, bottles, preps, lang, 6, groupOf)
          .filter((s) => s.value !== trimmed)
          .filter((s) => {
            if (!ingSource || ingSource === "auto") return true;
            return s.source === ingSource;
          })
      : [];
    return (
      <View style={{ marginBottom: 8, opacity: isActive ? 0.85 : 1 }}>
        <View className="flex-row items-center" style={{ gap: 8 }}>
          {/* 拖拽手柄 */}
          <Pressable
            onLongPress={drag}
            delayLongPress={200}
            hitSlop={6}
            style={{ paddingHorizontal: 2, paddingVertical: 4 }}
          >
            <IconSymbol name="line.3.horizontal" size={18} color={colors.muted} />
          </Pressable>
          {/* 库选择器：小型下拉按钮 */}
          <Pressable
            onPress={() => {
              const sources: ("auto" | "spirits" | "bottles" | "materials" | "homemade")[] = ["auto", "spirits", "bottles", "materials", "homemade"];
              const cur = ingSource;
              const next = sources[(sources.indexOf(cur) + 1) % sources.length];
              setIngSourceMap((prev) => ({ ...prev, [ing.id]: next }));
              setDismissedLinks((prev) => { const n = { ...prev }; delete n[ing.id]; return n; });
              setAcceptedLinks((prev) => { const n = { ...prev }; delete n[ing.id]; return n; });
              setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, linkedBottleId: undefined, linkedPrepId: undefined } : i));
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
            className="flex-[3] bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
            placeholder={t("form.ingredient.name")}
            placeholderTextColor={colors.muted}
            value={ing.name}
            onChangeText={(v) => updateIngredient(ing.id, "name", v)}
            onFocus={() => setFocusedIng(ing.id)}
            autoCapitalize="words"
            onBlur={() => {
              if (!pressingIngSuggestRef.current) {
                setTimeout(() => {
                  setFocusedIng((cur) => (cur === ing.id ? null : cur));
                }, 150);
              }
            }}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
            onSubmitEditing={() => commitIngredientName(ing.id, ing.name)}
          />
          {/* ── or 操作按钮 ── */}
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              const OR_RE = /\s+(?:or|或|\/|\|)\s+/i;
              if (OR_RE.test(ing.name.trim())) {
                commitIngredientName(ing.id, ing.name);
              } else {
                ActionSheetIOS
                  ? ActionSheetIOS.showActionSheetWithOptions(
                      {
                        options: [
                          lang === "zh" ? "添加备选项" : "Add Alternative",
                          lang === "zh" ? "取消" : "Cancel",
                        ],
                        cancelButtonIndex: 1,
                        title: lang === "zh" ? "or 备选" : "Alternative",
                        message: lang === "zh" ? "为此成分添加一个备选项（点击可切换优先级）" : "Add an alternative ingredient (tap to swap priority)",
                      },
                      (idx) => {
                        if (idx === 0) { setAddAltIngId(ing.id); setAddAltIngValue(""); }
                      }
                    )
                  : Alert.alert(
                      lang === "zh" ? "or 备选" : "Alternative",
                      lang === "zh" ? "为此成分添加一个备选项（点击可切换优先级）" : "Add an alternative ingredient",
                      [
                        { text: lang === "zh" ? "添加备选项" : "Add Alternative", onPress: () => { setAddAltIngId(ing.id); setAddAltIngValue(""); } },
                        { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
                      ]
                    );
              }
            }}
            hitSlop={8}
            style={({ pressed }) => [{
              paddingHorizontal: 7,
              paddingVertical: 4,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: (ing.alternatives && ing.alternatives.length > 0) ? colors.primary : colors.border,
              backgroundColor: (ing.alternatives && ing.alternatives.length > 0) ? `${colors.primary}18` : colors.surface,
              opacity: pressed ? 0.6 : 1,
            }]}
          >
            <Text style={{ fontSize: 11, fontWeight: "600", color: (ing.alternatives && ing.alternatives.length > 0) ? colors.primary : colors.muted }}>or</Text>
          </Pressable>
          {/* ── Amount: qty + unit picker ── */}
          {(() => {
            const { qty, unit } = splitAmount(ing.amount);
            const isGarnish = prep?.abvGroup === "garnish";
            return (
              <View style={{ flexDirection: "row", flex: 2, gap: 4 }}>
                <TextInput
                  style={{
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 10,
                    paddingVertical: 10,
                    fontSize: 15,
                    color: colors.foreground,
                    lineHeight: 20,
                  }}
                  placeholder={isGarnish ? (prep?.garnishUnit ? `件数（${prep.garnishUnit}）` : "件数") : t("form.ingredient.qty")}
                  placeholderTextColor={colors.muted}
                  value={qty}
                  onChangeText={(v) => updateIngredient(ing.id, "amount", mergeAmount(v, unit))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
                {!isGarnish && (
                  <Pressable
                    onPress={() => setUnitPickerIngId(ing.id)}
                   style={({ pressed }) => [{
                      width: 72,
                      backgroundColor: unit ? `${colors.primary}18` : colors.surface,
                      borderWidth: 1,
                      borderColor: unit ? colors.primary : colors.border,
                      borderRadius: 12,
                      paddingHorizontal: 6,
                      paddingVertical: 10,
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 44,
                    }, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={{ fontSize: 13, color: unit ? colors.primary : colors.muted, fontWeight: unit ? "600" : "400", textAlign: "center" }} numberOfLines={1}>
                      {unit ? unitDisplayLabel(unit, lang as "zh" | "en") : t("form.ingredient.unit")}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })()}
          <Pressable
            onPress={() => removeIngredientRow(ing.id)}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol
              name="minus.circle.fill"
              size={24}
              color={ingredients.length > 1 ? colors.error : colors.border}
            />
          </Pressable>
        </View>
        {liveSuggestions.length > 0 ? (
          <View className="rounded-xl border overflow-hidden mt-1" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
            {liveSuggestions.map((s, sIdx) => (
              <Pressable
                key={s.key}
                onPressIn={() => { pressingIngSuggestRef.current = true; }}
                onPressOut={() => { pressingIngSuggestRef.current = false; }}
                onPress={() => { pickSuggestion(ing.id, s.value); pressingIngSuggestRef.current = false; }}
                style={({ pressed }) => [styles.suggestRow, sIdx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}
              >
                <IconSymbol name={s.source === "homemade" ? "sparkles" : s.source === "spirits" ? "flame.fill" : s.source === "materials" ? "leaf.fill" : "wineglass.fill"} size={13} color={s.source === "homemade" ? colors.primary : s.source === "spirits" ? "#FF9500" : s.source === "materials" ? colors.success : "#5AC8FA"} />
                <Text className="text-sm text-foreground" numberOfLines={1} style={{ lineHeight: 18, flexShrink: 1 }}>{s.value}</Text>
                {s.secondary ? <Text className="text-xs text-muted" numberOfLines={1} style={{ lineHeight: 16, flexShrink: 1 }}>{s.secondary}</Text> : null}
                <View style={{ flex: 1 }} />
                <Text className="text-[11px]" style={{ lineHeight: 14, color: s.source === "homemade" ? colors.primary : s.source === "spirits" ? "#FF9500" : s.source === "materials" ? colors.success : "#5AC8FA" }}>
                  {s.source === "homemade" ? t("form.suggest.homemade") : s.source === "spirits" ? t("form.suggest.spirits") : s.source === "materials" ? t("form.suggest.materials") : t("form.suggest.bottle")}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {prep ? (
          (() => {
            const canon = smartLinkDisplayName(link, lang as "zh" | "en");
            const differs = canon && canon.primary !== trimmed;
            return (
              <View className="flex-row items-center flex-wrap" style={{ gap: 10 }}>
                <Pressable onPress={() => router.push({ pathname: "/homemade/[id]", params: { id: prep.id } })} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}>
                  <IconSymbol name="sparkles" size={12} color={colors.primary} />
                  <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>{t("form.homemade.matched", { name: displayNames(prep.name, prep.nameAlt, lang).primary })}</Text>
                  <IconSymbol name="chevron.right" size={11} color={colors.primary} />
                </Pressable>
                {differs ? (
                  <Pressable onPress={() => pickSuggestion(ing.id, canon!.primary)} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}>
                    <IconSymbol name="arrow.triangle.2.circlepath" size={12} color={colors.success} />
                    <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>{t("form.replaceCanonical", { name: canon!.primary })}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setLinkPickerTarget({ scope: "ingredient", id: ing.id, query: trimmed })} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }, { borderColor: colors.border }]}>
                  <Text className="text-xs" style={{ color: colors.muted, lineHeight: 16 }}>{t("form.link.rebind")}</Text>
                </Pressable>
                <Pressable onPress={() => { setDismissedLinks((prev) => ({ ...prev, [ing.id]: true })); setAcceptedLinks((prev) => { const n = { ...prev }; delete n[ing.id]; return n; }); setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: true } : i)); }} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }, { borderColor: colors.border }]}>
                  <IconSymbol name="xmark" size={11} color={colors.muted} />
                  <Text className="text-xs" style={{ color: colors.muted, lineHeight: 16 }}>{t("form.link.break")}</Text>
                </Pressable>
              </View>
            );
          })()
        ) : linkedBottle ? (
          (() => {
            const canon = smartLinkDisplayName(link, lang as "zh" | "en");
            const differs = canon && canon.primary !== trimmed;
            return (
              <View className="flex-row items-center flex-wrap" style={{ gap: 10 }}>
                <Pressable onPress={() => router.push({ pathname: "/bottle/[id]", params: { id: linkedBottle.id } })} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}>
                  <IconSymbol name="link" size={12} color={colors.primary} />
                  <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>{t("form.bottle.matched", { name: displayNames(linkedBottle.nameEn, linkedBottle.nameZh, lang).primary })}</Text>
                  <IconSymbol name="chevron.right" size={11} color={colors.primary} />
                </Pressable>
                {differs ? (
                  <Pressable onPress={() => pickSuggestion(ing.id, canon!.primary)} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}>
                    <IconSymbol name="arrow.triangle.2.circlepath" size={12} color={colors.success} />
                    <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>{t("form.replaceCanonical", { name: canon!.primary })}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => setLinkPickerTarget({ scope: "ingredient", id: ing.id, query: trimmed })} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }, { borderColor: colors.border }]}>
                  <Text className="text-xs" style={{ color: colors.muted, lineHeight: 16 }}>{t("form.link.rebind")}</Text>
                </Pressable>
                <Pressable onPress={() => { setDismissedLinks((prev) => ({ ...prev, [ing.id]: true })); setAcceptedLinks((prev) => { const n = { ...prev }; delete n[ing.id]; return n; }); setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: true } : i)); }} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }, { borderColor: colors.border }]}>
                  <IconSymbol name="xmark" size={11} color={colors.muted} />
                  <Text className="text-xs" style={{ color: colors.muted, lineHeight: 16 }}>{t("form.link.break")}</Text>
                </Pressable>
              </View>
            );
          })()
        ) : pendingFuzzyLink ? (
          (() => {
            const fuzzyCanon = smartLinkDisplayName(pendingFuzzyLink, lang as "zh" | "en");
            const fuzzyName = fuzzyCanon?.primary ?? (pendingFuzzyLink.kind === "bottle" ? pendingFuzzyLink.bottle.nameZh || pendingFuzzyLink.bottle.nameEn : pendingFuzzyLink.prep.name);
            const fuzzyKey = pendingFuzzyLink.kind === "bottle" ? "form.link.fuzzy.bottle" : "form.link.fuzzy.prep";
            return (
              <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>{t(fuzzyKey, { name: fuzzyName })}</Text>
                <Pressable onPress={() => { setAcceptedLinks((prev) => ({ ...prev, [ing.id]: true })); if (pendingFuzzyLink?.kind === "bottle") { setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, linkedBottleId: pendingFuzzyLink.bottle.id, linkedPrepId: undefined, linkDismissed: undefined } : i)); } else if (pendingFuzzyLink?.kind === "prep") { setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, linkedPrepId: pendingFuzzyLink.prep.id, linkedBottleId: undefined, linkDismissed: undefined } : i)); } }} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }, { borderColor: colors.success }]}>
                  <IconSymbol name="checkmark" size={11} color={colors.success} />
                  <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>{t("form.link.accept")}</Text>
                </Pressable>
                <Pressable onPress={() => setLinkPickerTarget({ scope: "ingredient", id: ing.id, query: trimmed })} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }, { borderColor: colors.border }]}>
                  <Text className="text-xs" style={{ color: colors.muted, lineHeight: 16 }}>{t("form.link.more")}</Text>
                </Pressable>
                <Pressable onPress={() => { setDismissedLinks((prev) => ({ ...prev, [ing.id]: true })); setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, linkDismissed: true } : i)); }} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }, { borderColor: colors.border }]}>
                  <IconSymbol name="xmark" size={11} color={colors.muted} />
                  <Text className="text-xs" style={{ color: colors.muted, lineHeight: 16 }}>{t("form.link.dismiss")}</Text>
                </Pressable>
              </View>
            );
          })()
        ) : iDismissed && trimmed.length > 1 ? (
          <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
            <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>{t("form.link.dismissed")}</Text>
            <Pressable onPress={() => setLinkPickerTarget({ scope: "ingredient", id: ing.id, query: trimmed })} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}>
              <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>{t("form.link.relink")}</Text>
            </Pressable>
          </View>
        ) : suggestion ? (
          <Pressable onPress={() => router.push({ pathname: "/homemade-form", params: { prefillName: suggestion.name, prefillNameAlt: suggestion.nameAlt, prefillType: suggestion.type } })} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}>
            <IconSymbol name="plus.circle.fill" size={12} color={colors.success} />
            <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>{t("form.homemade.add")} · {displayNames(suggestion.name, suggestion.nameAlt, lang).primary}</Text>
          </Pressable>
        ) : classification ? (
          <Pressable onPress={() => { if (classification.library === "homemade") { router.push({ pathname: "/homemade-form", params: { prefillName: classification.name, prefillNameAlt: classification.nameAlt, prefillType: classification.category } }); } else { router.push({ pathname: "/bottle-form", params: { category: classification.category, prefillName: classification.name, prefillNameAlt: classification.nameAlt, ...(classification.style ? { prefillStyle: classification.style } : {}) } }); } }} style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}>
            <IconSymbol name="plus.circle.fill" size={12} color={colors.success} />
            <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>{classification.library === "homemade" ? t("form.homemade.add") : classification.library === "material" ? t("form.smartAdd.material") : t("form.smartAdd.bottle")}{" · "}{displayNames(classification.name, classification.nameAlt, lang).primary}</Text>
          </Pressable>
        ) : null}
        {/* ── or 备选标签 ── */}
        {ing.alternatives && ing.alternatives.length > 0 ? (
          <View style={{ flexDirection: "column", gap: 6, marginTop: 6, paddingLeft: 2 }}>
            {ing.alternatives.map((alt, altIdx) => (
              <View
                key={`${ing.id}-alt-${altIdx}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Text style={{ fontSize: 12, color: colors.muted, minWidth: 20 }}>{lang === "zh" ? "或" : "or"}</Text>
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const newAlts = [ing.name, ...(ing.alternatives ?? []).filter((_, i) => i !== altIdx)];
                    setIngredients((prev) => prev.map((i) =>
                      i.id === ing.id
                        ? { ...i, name: alt, alternatives: newAlts, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: undefined }
                        : i
                    ));
                    setDismissedLinks((prev) => { const n = { ...prev }; delete n[ing.id]; return n; });
                    setAcceptedLinks((prev) => { const n = { ...prev }; delete n[ing.id]; return n; });
                  }}
                  style={({ pressed }) => [{
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    opacity: pressed ? 0.6 : 1,
                  }]}
                >
                  <Text style={{ fontSize: 15, lineHeight: 20, color: colors.foreground }}>{alt}</Text>
                </Pressable>
                {/* 上移按钮 */}
                <Pressable
                  onPress={() => {
                    if (altIdx === 0) return;
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const alts = [...(ing.alternatives ?? [])];
                    [alts[altIdx - 1], alts[altIdx]] = [alts[altIdx], alts[altIdx - 1]];
                    setIngredients((prev) => prev.map((i) =>
                      i.id === ing.id ? { ...i, alternatives: alts } : i
                    ));
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [{ opacity: altIdx === 0 ? 0.2 : pressed ? 0.5 : 1 }]}
                >
                  <IconSymbol name="chevron.up" size={20} color={colors.muted} />
                </Pressable>
                {/* 下移按钮 */}
                <Pressable
                  onPress={() => {
                    if (altIdx === (ing.alternatives ?? []).length - 1) return;
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const alts = [...(ing.alternatives ?? [])];
                    [alts[altIdx], alts[altIdx + 1]] = [alts[altIdx + 1], alts[altIdx]];
                    setIngredients((prev) => prev.map((i) =>
                      i.id === ing.id ? { ...i, alternatives: alts } : i
                    ));
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [{ opacity: altIdx === (ing.alternatives ?? []).length - 1 ? 0.2 : pressed ? 0.5 : 1 }]}
                >
                  <IconSymbol name="chevron.down" size={20} color={colors.muted} />
                </Pressable>
                {/* 删除按钮 */}
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const newAlts = (ing.alternatives ?? []).filter((_, i) => i !== altIdx);
                    setIngredients((prev) => prev.map((i) =>
                      i.id === ing.id ? { ...i, alternatives: newAlts } : i
                    ));
                  }}
                  hitSlop={8}
                  style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
                >
                  <IconSymbol name="minus.circle.fill" size={24} color={colors.error} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        {/* ── 添加备选输入框（临时显示） ── */}
        {addAltIngId === ing.id ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, paddingLeft: 2 }}>
            <Text style={{ fontSize: 11, color: colors.muted, minWidth: 20 }}>{lang === "zh" ? "或" : "or"}</Text>
            <TextInput
              autoFocus
              style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, color: colors.foreground, lineHeight: 20 }}
              placeholder={lang === "zh" ? "输入备选名称" : "Enter alternative name"}
              placeholderTextColor={colors.muted}
              value={addAltIngValue}
              onChangeText={setAddAltIngValue}
              returnKeyType="done"
              autoCapitalize="words"
              onSubmitEditing={() => {
                const v = addAltIngValue.trim();
                if (v) setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, alternatives: [...(i.alternatives ?? []), v] } : i));
                setAddAltIngId(null); setAddAltIngValue("");
              }}
              onBlur={() => {
                const v = addAltIngValue.trim();
                if (v) setIngredients((prev) => prev.map((i) => i.id === ing.id ? { ...i, alternatives: [...(i.alternatives ?? []), v] } : i));
                setAddAltIngId(null); setAddAltIngValue("");
              }}
            />
            <Pressable onPress={() => { setAddAltIngId(null); setAddAltIngValue(""); }} hitSlop={8} style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}>
              <IconSymbol name="xmark.circle.fill" size={20} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingredients, ingSourceMap, dismissedLinks, acceptedLinks, focusedIng, pickedIng, bottles, preps, lang, groupOf, colors, t, addAltIngId, addAltIngValue]);

  const toggleFlavor = (tag: string) => {
    setFlavors((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };
  // 手动修改标签后，清除 AI 状态指示（但保留低置信度警告，直到用户手动关闭）

  /** 将解析结果填充到表单;仅覆盖解析到内容的字段 */
  const applyParsed = (text: string) => {
    const p = parseRecipeText(text, lang as "zh" | "en");
    const gotSomething =
      p.name || p.ingredients.length > 0 || p.steps || p.glass || p.garnish || p.source;
    if (!gotSomething) {
      setImportHint(t("form.import.fail"));
      return;
    }
    if (p.name) {
      const split = splitBilingualName(p.name);
      if (split) {
        setName(split.zh);
        setNameEn(split.en);
      } else if (/[\u4e00-\u9fa5]/.test(p.name)) {
        setName(p.name);
      } else {
        setNameEn(p.name);
        if (!name.trim()) setName(p.name);
      }
    }
    if (p.ingredients.length > 0) setIngredients(p.ingredients);
    if (p.steps) setStepRows(parseStepRows(p.steps));
    if (p.garnish) setGarnishRows(parseGarnishRows(p.garnish));
    if (p.source) setSource(p.source);
    if (p.variantOf) setVariantOf(p.variantOf);
    // 文本明确声明的 Codex 家族:确认合法(解析器已规范化)即采用;
    // 但用户已手动选择的值优先级最高,不覆盖
    if (p.codexFamily && !codexFamily) setCodexFamily(p.codexFamily);
    // 杯型/基酒:仅当解析结果能对应到已有标签时才选中,否则原样填入
    if (p.glass) {
      const nextName = ensureGlassName(p.glass);
      if (nextName) setGlass(nextName);
    }
    if (p.method && (METHODS as readonly string[]).includes(p.method)) setMethod(p.method);
    if (p.baseSpirit) {
      const nextName = ensureSpiritName(p.baseSpirit);
      if (nextName) setBaseSpirit(nextName);
    }
    const parts: string[] = [];
    if (p.name) parts.push(t("form.name.label"));
    if (p.ingredients.length > 0) parts.push(`${p.ingredients.length} ${t("form.ingredients")}`);
    if (p.steps) parts.push(t("detail.steps"));
    if (p.glass) parts.push(t("form.glass"));
    if (p.garnish) parts.push(t("form.garnish"));
    setImportHint(`${t("form.import.done")}: ${parts.join(", ")}`);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const handlePasteImport = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text || !text.trim()) {
        setImportHint(t("form.import.empty"));
        return;
      }
      const hasContent =
        name.trim() || ingredients.some((i) => i.name.trim()) || steps.trim();
      if (hasContent) {
        if (Platform.OS === "web") {
          // eslint-disable-next-line no-alert
          if (typeof window !== "undefined" && !window.confirm(t("form.import.overwrite"))) {
            return;
          }
          applyParsed(text);
          return;
        }
        Alert.alert(t("form.import.title"), t("form.import.overwrite"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("form.import.confirm"), onPress: () => applyParsed(text) },
        ]);
        return;
      }
      applyParsed(text);
    } catch {
      setImportHint(t("form.import.readFail"));
    }
  };
  void handlePasteImport; // legacy local parser kept for offline fallback reference

  const handleSave = () => {
    if (!canSave) return;
    const draft: RecipeDraft = {
      name: name.trim() || nameEn.trim(),
      nameEn: nameEn.trim(),
      categoryId,
      baseSpirit,
      glass,
      method,
      ice,
      strength: abvEstimate.strength ?? editing?.strength ?? "medium",
      strengthBand: abvEstimate.band ?? editing?.strengthBand ?? "",
      abv: abvEstimate.abv,
      variantOf: variantOf.trim(),
      codexFamily,
      flavors,
      source: source.trim(),
      story: story.trim(),
      flavorDesc: buildFlavorDesc(flavorTone, flavorEvolution, flavorTexture),
      ingredients: ingredients
        .filter((i) => i.name.trim().length > 0)
        .map((i) => ({ ...i, preferredSource: ingSourceMap[i.id] ?? undefined })),
      steps: steps.trim(),
      garnish: garnish.trim(),
      garnishItems: garnishRows
        .filter((g) => g.name.trim().length > 0)
        .map((g) => ({
          id: g.id,
          name: g.name.trim(),
          linkedBottleId: g.linkedBottleId || undefined,
          linkedPrepId: g.linkedPrepId || undefined,
          linkDismissed: g.linkDismissed === true ? true : undefined,
        })),
      notes: notes.trim(),
      cardTagOrder: null,
      drinkDuration: drinkDuration || undefined,
      occasion: occasion || undefined,
      // 只有当用户填写了至少一个 sourceRef 字段时才保存
      sourceRef: (sourceRef.bookTitle || sourceRef.creator || sourceRef.createdYear || sourceRef.bookAuthor || sourceRef.publishYear || sourceRef.chapterTitle || sourceRef.pageRef)
        ? sourceRef
        : editing?.sourceRef,
  };
    if (editing) {
      updateRecipe(editing.id, draft);
    } else {
      const newRecipe = addRecipe(draft);
      // Auto-tag flavors in background when user didn't manually select any
      if (flavors.length === 0) {
        const ingNames = draft.ingredients.map((i) => i.name).filter(Boolean);
        enrichRecipeAI({
            name: draft.name,
            nameEn: draft.nameEn || undefined,
            baseSpirit: draft.baseSpirit || undefined,
          }).then((result) => {
              if (result.flavors.length > 0) {
                updateRecipe(newRecipe.id, { ...draft, flavors: result.flavors });
              }
            }).catch(() => { /* silent */ });
      }
    }
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    router.back();
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-2">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="xmark" size={24} color={colors.foreground} />
        </Pressable>
        <Text className="text-lg font-semibold text-foreground">
          {editing ? t("form.title.edit") : t("form.title.new")}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <NestableScrollContainer
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Smart import: paste / camera / photos */}
          <SmartImportBar
            targetType="recipe"
            onExtracted={(item, _all, sourceMeta) => {
              if (item.nameZh || item.nameEn) {
                setName(item.nameZh || item.nameEn);
                setNameEn(item.nameEn);
              }
              if (item.baseSpirit) {
                const nextName = ensureSpiritName(item.baseSpirit);
                if (nextName) setBaseSpirit(nextName);
              }
              if (item.glass) {
                const nextName = ensureGlassName(item.glass);
                if (nextName) setGlass(nextName);
              }
              if (item.method) setMethod(item.method);
              if (item.ingredients?.length) {
                setIngredients(
                  item.ingredients.map((ing) => ({
                    id: genId(),
                    name: ing.name,
                    amount: ing.amount,
                  })),
                );
              }
              if (item.steps) setStepRows(parseStepRows(item.steps));
              if (item.garnish) setGarnishRows(parseGarnishRows(item.garnish));
              if (item.source) setSource(item.source);
              if (item.notes) setNotes(item.notes);
              // Apple Books 摘录尾注：本地解析的书名/作者写入结构化引用来源（Bug 9）
              if (sourceMeta?.bookTitle) {
                setSourceRef((prev) => ({
                  ...prev,
                  bookTitle: sourceMeta.bookTitle,
                  bookAuthor: sourceMeta.bookAuthor || prev.bookAuthor,
                  rawText: sourceMeta.rawText || prev.rawText,
                  sourceConfidence: "high",
                }));
                if (!item.source) {
                  setSource(
                    sourceMeta.bookAuthor
                      ? `${sourceMeta.bookTitle} — ${sourceMeta.bookAuthor}`
                      : sourceMeta.bookTitle,
                  );
                }
              }
              setImportHint(t("smartImport.filled"));
            }}
          />
          {importHint ? (
            <Text className="text-xs mt-2" style={{ color: colors.primary, lineHeight: 16 }}>
              {importHint}
            </Text>
          ) : null}

          {/* Name: bilingual fields, primary language first (aligned with bottle library) */}
          {lang === "en" ? (
            <>
              <Text className="text-[13px] text-muted uppercase mt-3 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.nameEn.required")}</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
                placeholder={t("form.nameEn.placeholder")}
                placeholderTextColor={colors.muted}
                value={nameEn}
                onChangeText={setNameEn}
                returnKeyType="done"
                style={{ lineHeight: 20 }}
              />
              <Text className="text-[13px] text-muted uppercase mt-3 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.nameZh.label")}</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
                placeholder={t("form.nameZh.placeholder")}
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={setName}
                returnKeyType="done"
                style={{ lineHeight: 20 }}
              />
            </>
          ) : (
            <>
              <Text className="text-[13px] text-muted uppercase mt-3 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.nameZh.required")}</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
                placeholder={t("form.nameZh.placeholder")}
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={setName}
                returnKeyType="done"
                style={{ lineHeight: 20 }}
              />
              <Text className="text-[13px] text-muted uppercase mt-3 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.nameEn.label")}</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
                placeholder={t("form.nameEn.placeholder")}
                placeholderTextColor={colors.muted}
                value={nameEn}
                onChangeText={setNameEn}
                returnKeyType="done"
                style={{ lineHeight: 20 }}
              />
            </>
          )}

          {/* AI Fill button — prominent, right below name fields */}
          {/* AI action buttons row */}
          {(() => {
            const hasZh = name.trim().length > 0 && /[\u4e00-\u9fa5]/.test(name.trim());
            const hasEn = nameEn.trim().length > 0;
            const hintText = hasZh && !hasEn
              ? (lang === "zh" ? "✦ 点击可获取英文名建议" : "✦ Tap to get English name suggestion")
              : !hasZh && hasEn
                ? (lang === "zh" ? "✦ 点击可获取中文名建议" : "✦ Tap to get Chinese name suggestion")
              : null;
            if (!hintText) return null;
            return (
              <Text style={{ fontSize: 11, color: colors.primary, fontWeight: "500", textAlign: "center", marginTop: 8, marginBottom: -4 }}>
                {hintText}
              </Text>
            );
          })()}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            {/* 统一 AI 补全按钮 — 调用 deepAnalyzeRecipe（全字段，claude-sonnet） */}
            <Pressable
              onPress={handleDeepAnalyze}
              disabled={aiEnriching || (!name.trim() && !nameEn.trim())}
              style={({ pressed }) => [
                {
                  flex: 1,
                  flexDirection: "row" as const,
                  alignItems: "center" as const,
                  justifyContent: "center" as const,
                  gap: 6,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: (!name.trim() && !nameEn.trim()) ? colors.surface : colors.primary,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
          {aiEnriching ? (
                <>
                  <IconSymbol name="sparkles" size={15} color="#FFFFFF" />
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#FFFFFF" }}>
                    {lang === "zh" ? "AI 分析中…" : "Analyzing…"}
                  </Text>
                </>
              ) : (
                <>
                  <IconSymbol name="sparkles" size={15} color={(!name.trim() && !nameEn.trim()) ? colors.muted : "#FFFFFF"} />
                  <Text style={{ fontSize: 13, fontWeight: "700", color: (!name.trim() && !nameEn.trim()) ? colors.muted : "#FFFFFF" }}>
                    {lang === "zh" ? "✦ AI 补全" : "✦ AI Fill"}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
          {aiResult && (
            (() => {
              const aiFields = buildAiFields();
              const conflictColor = (c: "new" | "override" | "confirm" | "low") =>
                c === "new" ? colors.primary : c === "override" ? "#FF9500" : c === "confirm" ? colors.success : colors.muted;
              const conflictLabel = (c: "new" | "override" | "confirm" | "low") =>
                lang === "zh"
                  ? c === "new" ? "新增" : c === "override" ? "覆盖" : c === "confirm" ? "确认" : "低可信"
                  : c === "new" ? "New" : c === "override" ? "Override" : c === "confirm" ? "Match" : "Low";
              const toggledCount = aiFields.filter((f) => aiToggles[f.key] !== false).length;
              return (
                <View
                  className="rounded-xl border mt-2"
                  style={{ borderColor: colors.primary + "44", backgroundColor: colors.primary + "0A" }}
                >
                  {/* ── Header ── */}
                  <View className="flex-row items-center justify-between px-3 pt-3 pb-2">
                    <View className="flex-row items-center" style={{ gap: 6 }}>
                      <IconSymbol name="sparkles" size={13} color={colors.primary} />
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
                        {lang === "zh" ? "AI 建议" : "AI Suggestion"}
                      </Text>
                      <View className="px-1.5 py-0.5 rounded-full" style={{ backgroundColor: aiResult.confidence === "high" ? colors.success + "22" : aiResult.confidence === "medium" ? "#FF950022" : colors.border }}>
                        <Text style={{ fontSize: 10, fontWeight: "600", color: aiResult.confidence === "high" ? colors.success : aiResult.confidence === "medium" ? "#FF9500" : colors.muted }}>
                          {aiResult.confidence === "high" ? (lang === "zh" ? "高可信" : "High") : aiResult.confidence === "medium" ? (lang === "zh" ? "中可信" : "Medium") : (lang === "zh" ? "低可信" : "Low")}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 10, color: colors.muted }}>{lang === "zh" ? `${aiFields.length} 个字段` : `${aiFields.length} fields`}</Text>
                    </View>
                    <Pressable onPress={() => setAiResult(null)} hitSlop={8}>
                      <IconSymbol name="xmark" size={14} color={colors.muted} />
                    </Pressable>
                  </View>
                  {/* ── Quick actions ── */}
                  <View className="flex-row px-3 pb-2" style={{ gap: 6 }}>
                    <Pressable
                      onPress={() => {
                        const all: Record<string, boolean> = {};
                        for (const f of aiFields) all[f.key] = true;
                        setAiToggles(all);
                      }}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 5, borderRadius: 7, alignItems: "center" as const, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={{ fontSize: 11, fontWeight: "500", color: colors.foreground }}>{lang === "zh" ? "全选" : "Select All"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        const blanks: Record<string, boolean> = {};
                        for (const f of aiFields) blanks[f.key] = f.conflict === "new";
                        setAiToggles(blanks);
                      }}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 5, borderRadius: 7, alignItems: "center" as const, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={{ fontSize: 11, fontWeight: "500", color: colors.primary }}>{lang === "zh" ? "只填空白" : "Blanks Only"}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        const none: Record<string, boolean> = {};
                        for (const f of aiFields) none[f.key] = false;
                        setAiToggles(none);
                      }}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 5, borderRadius: 7, alignItems: "center" as const, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={{ fontSize: 11, fontWeight: "500", color: colors.muted }}>{lang === "zh" ? "全不选" : "Deselect"}</Text>
                    </Pressable>
                  </View>
                  {/* ── Field diff list ── */}
                  <View style={{ borderTopWidth: 0.5, borderTopColor: colors.border + "88" }}>
                    {aiFields.map((f, idx) => {
                      const isOn = aiToggles[f.key] !== false;
                      const cc = conflictColor(f.conflict);
                      return (
                        <View
                          key={f.key}
                          style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: idx < aiFields.length - 1 ? 0.5 : 0, borderBottomColor: colors.border + "66", gap: 8, opacity: isOn ? 1 : 0.45 }}
                        >
                          {/* conflict badge */}
                          <View style={{ width: 36, alignItems: "center" }}>
                            <View style={{ paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, backgroundColor: cc + "22" }}>
                              <Text style={{ fontSize: 9, fontWeight: "700", color: cc }}>{conflictLabel(f.conflict)}</Text>
                            </View>
                          </View>
                          {/* label + values */}
                          <View style={{ flex: 1, gap: 1 }}>
                            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground, lineHeight: 15 }}>
                              {lang === "zh" ? f.labelZh : f.labelEn}
                            </Text>
                            {f.aiValueLines ? (
                              <View style={{ gap: 2, marginTop: 1 }}>
                                {f.aiValueLines.map((line) => (
                                  <Text key={line.label} style={{ fontSize: 10, lineHeight: 14, color: colors.muted }} numberOfLines={2}>
                                    <Text style={{ fontWeight: "600", color: colors.foreground }}>{line.label}：</Text>
                                    <Text style={{ color: cc }}>{line.value}</Text>
                                  </Text>
                                ))}
                              </View>
                            ) : f.currentValue ? (
                              <Text style={{ fontSize: 10, color: colors.muted, lineHeight: 14 }} numberOfLines={1}>
                                {f.currentValue} → <Text style={{ color: cc, fontWeight: "500" }}>{f.aiValue}</Text>
                              </Text>
                            ) : (
                              <Text style={{ fontSize: 10, color: cc, fontWeight: "500", lineHeight: 14 }} numberOfLines={1}>{f.aiValue}</Text>
                            )}
                          </View>
                          {/* toggle */}
                          <Switch
                            value={isOn}
                            onValueChange={(v) => setAiToggles((prev) => ({ ...prev, [f.key]: v }))}
                            trackColor={{ false: colors.border, true: colors.primary + "88" }}
                            thumbColor={isOn ? colors.primary : colors.muted}
                            style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }}
                          />
                        </View>
                      );
                    })}
                  </View>
                  {/* ── Apply button ── */}
                  <View className="flex-row px-3 pt-2 pb-3" style={{ gap: 8 }}>
                    <Pressable
                      onPress={() => applyAiResult()}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" as const, backgroundColor: toggledCount > 0 ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 })}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: toggledCount > 0 ? "#FFFFFF" : colors.muted }}>
                        {lang === "zh" ? `应用 ${toggledCount} 项` : `Apply ${toggledCount} fields`}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setAiResult(null)}
                      style={({ pressed }) => ({ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 9, alignItems: "center" as const, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.6 : 1 })}
                    >
                      <Text style={{ fontSize: 13, color: colors.muted }}>{lang === "zh" ? "忽略" : "Dismiss"}</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })()
          )}
          {/* ── Undo toast ── */}
          {undoSnapshot && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.success + "18", borderWidth: 1, borderColor: colors.success + "44" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
                <Text style={{ fontSize: 12, fontWeight: "500", color: colors.success }}>
                  {lang === "zh" ? "AI 建议已应用" : "AI suggestions applied"}
                </Text>
              </View>
              <Pressable onPress={undoAiApply} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{lang === "zh" ? "撤销" : "Undo"}</Text>
              </Pressable>
            </View>
          )}

          {/* Category */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.category")}</Text>
          <View style={styles.chipWrap}>
            <Pressable
              onPress={() => setCategoryId(null)}
              style={[
                styles.chip,
                {
                  backgroundColor: categoryId === null ? colors.primary : colors.surface,
                  borderColor: categoryId === null ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[styles.chipText, { color: categoryId === null ? "#FFFFFF" : colors.muted }]}
              >
                {t("form.uncategorized")}
              </Text>
            </Pressable>
            {categories.map((cat) => {
              const active = categoryId === cat.id;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => setCategoryId(cat.id)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? cat.color : colors.surface,
                      borderColor: active ? cat.color : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                    {displayNames(cat.nameEn ?? "", cat.name, lang).primary}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Base spirit */}
          <View className="flex-row items-center justify-between mt-5 mb-1.5">
            <Text className="text-[13px] text-muted">{t("form.spirit")}</Text>
            {spiritConfidence !== null && (
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <IconSymbol
                  name="sparkles"
                  size={12}
                  color={spiritConfidence === "high" ? colors.success : spiritConfidence === "medium" ? "#FF9500" : "#FF6B35"}
                />
                <Text className="text-xs" style={{ color: spiritConfidence === "high" ? colors.success : spiritConfidence === "medium" ? "#FF9500" : "#FF6B35" }}>
                  {spiritConfidence === "high"
                    ? (lang === "zh" ? "AI 已标注" : "AI tagged")
                    : spiritConfidence === "medium"
                      ? (lang === "zh" ? "AI 推断，请确认" : "AI inferred, please confirm")
                      : (lang === "zh" ? "置信度低，请手动选择" : "Low confidence, please select")}
                </Text>
              </View>
            )}
          </View>
          {/* 多基酒提示 */}
          {baseSpirit && baseSpirit.includes(",") && (
            <View
              className="flex-row items-start rounded-xl px-3 py-2 mb-2"
              style={{ backgroundColor: "#007AFF15", borderWidth: 1, borderColor: "#007AFF44", gap: 8 }}
            >
              <IconSymbol name="info.circle" size={14} color="#007AFF" style={{ marginTop: 1 }} />
              <Text className="text-xs flex-1" style={{ color: "#007AFF", lineHeight: 18 }}>
                {lang === "zh"
                  ? `多基酒配方：${baseSpirit.split(",").join(" + ")}，用量相等，已全部标注。`
                  : `Multi-spirit recipe: ${baseSpirit.split(",").join(" + ")} in equal parts.`}
              </Text>
            </View>
          )}
          {/* 低置信度警告横幅 */}
          {spiritConfidence === "low" && (
            <View
              className="flex-row items-start rounded-xl px-3 py-2 mb-2"
              style={{ backgroundColor: "#FF6B3515", borderWidth: 1, borderColor: "#FF6B3544", gap: 8 }}
            >
              <IconSymbol name="exclamationmark.triangle" size={14} color="#FF6B35" style={{ marginTop: 1 }} />
              <Text className="text-xs flex-1" style={{ color: "#FF6B35", lineHeight: 18 }}>
                {lang === "zh"
                  ? "未找到可靠信息，请手动选择基酒。"
                  : "No reliable info found. Please select base spirit manually."}
              </Text>
              <Pressable onPress={() => setSpiritConfidence(null)} hitSlop={8}>
                <IconSymbol name="xmark" size={12} color="#FF6B35" />
              </Pressable>
            </View>
          )}
          {spiritNames.length > 0 ? (
            <MultiSpiritChipGroup
              options={spiritNames}
              value={baseSpirit}
              onChange={(v) => {
                setBaseSpirit(v);
                // User manually changed → clear AI confidence indicator
                setSpiritConfidence(null);
                setAiSuggestedSpirits([]);
              }}
              colorsMap={spiritColors}
              newTags={newSpiritTags}
              labelOf={(v) => {
                const tag = spiritTags.find((tg) => tg.name === v);
                return localizedTagName(v, tag?.nameEn, lang);
              }}
              aiConfidence={spiritConfidence}
              aiSuggestedSpirits={aiSuggestedSpirits}
            />
          ) : (
            <Text className="text-xs text-muted">{t("form.noSpirit")}</Text>
          )}

          {/* Codex family */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>
            {t("form.codex")}
          </Text>
          <Text className="text-xs text-muted mb-2" style={{ lineHeight: 16 }}>
            {t("form.codex.hint")}
          </Text>
          <View style={styles.chipWrap}>
            {CODEX_FAMILIES.map((fam) => {
              const active = codexFamily === fam;
              return (
                <Pressable
                  key={fam}
                  onPress={() => setCodexFamily(active ? "" : fam)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.surface,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                    {codexFamilyLabel(fam, lang)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Variant of */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.variantOf")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.variantOf.placeholder")}
            placeholderTextColor={colors.muted}
            value={variantOf}
            onChangeText={setVariantOf}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />

          {/* Drink Duration — chip 选择（与 Strength 同风格） */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.duration")}</Text>
          <View style={[styles.chipWrap, { marginTop: 4 }]}>
            {(DRINK_DURATIONS as readonly string[]).map((dur) => {
              const active = drinkDuration === dur;
              const dTag = tags.find((tg) => tg.kind === "duration" && tg.name === dur);
              const dColor = dTag?.color ?? "#007AFF";
              return (
                <Pressable
                  key={dur}
                  onPress={() => { setDrinkDuration(active ? "" : dur); setDurationUserOverride(true); }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? dColor : colors.surface,
                      borderColor: active ? dColor : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                    {lang === "zh" ? dur : (dur === "短饮" ? "Short Drink" : "Long Drink")}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Occasion — chip 选择（与 Strength 同风格） */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.occasion")}</Text>
          <View style={[styles.chipWrap, { marginTop: 4 }]}>
            {(OCCASIONS as readonly string[]).map((occ) => {
              const active = occasion === occ;
              const occEn: Record<string, string> = { "餐前酒": "Aperitif", "餐后酒": "Digestif", "全天酒": "All Day", "佐餐酒": "With Dinner", "睡前酒": "Nightcap", "派对酒": "Party" };
              const oTag = tags.find((tg) => tg.kind === "occasion" && tg.name === occ);
              const oColor = oTag?.color ?? "#AF52DE";
              return (
                <Pressable
                  key={occ}
                  onPress={() => { setOccasion(active ? "" : occ); setOccasionUserOverride(true); }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? oColor : colors.surface,
                      borderColor: active ? oColor : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                    {lang === "zh" ? occ : (occEn[occ] ?? occ)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Flavor tags */}
          <View className="flex-row items-center justify-between mt-5 mb-1.5">
            <Text className="text-[13px] text-muted">{t("form.flavors.multi")}</Text>
            {aiEnriching && (
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <IconSymbol name="sparkles" size={12} color={colors.primary} />
                <Text className="text-xs" style={{ color: colors.primary }}>
                  {lang === "zh" ? "AI 分析中…" : "Analyzing…"}
                </Text>
              </View>
            )}
            {!aiEnriching && flavorConfidence !== null && (
              <Pressable
                onPress={() => {
                  setFlavors([]);
                  setFlavorConfidence(null);
                }}
                hitSlop={8}
              >
                <View className="flex-row items-center" style={{ gap: 4 }}>
                  <IconSymbol name="sparkles" size={12} color={flavorConfidence === "high" ? colors.success : "#FF9500"} />
                  <Text className="text-xs" style={{ color: flavorConfidence === "high" ? colors.success : "#FF9500" }}>
                    {flavorConfidence === "high"
                      ? (lang === "zh" ? "AI 已标注" : "AI tagged")
                      : (lang === "zh" ? "AI 已标注（低置信）" : "AI tagged (low conf.)")}
                  </Text>
                </View>
              </Pressable>
            )}
          </View>
          {/* 低置信度警告横幅 */}
          {flavorConfidence === "low" && (
            <View
              className="flex-row items-start rounded-xl px-3 py-2 mb-2"
              style={{ backgroundColor: "#FF950015", borderWidth: 1, borderColor: "#FF950044", gap: 8 }}
            >
              <IconSymbol name="exclamationmark.triangle" size={14} color="#FF9500" style={{ marginTop: 1 }} />
              <Text className="text-xs flex-1" style={{ color: "#FF9500", lineHeight: 18 }}>
                {lang === "zh"
                  ? "AI 置信度较低，标签主要根据配料推断，建议人工确认或调整。"
                  : "Low AI confidence — tags are inferred from ingredients. Please review and adjust."}
              </Text>
              <Pressable onPress={() => setFlavorConfidence("medium")} hitSlop={8}>
                <IconSymbol name="xmark" size={12} color="#FF9500" />
              </Pressable>
            </View>
          )}
          {(
            [
              { key: "taste",   tags: FLAVOR_TASTE_TAGS },
              { key: "aroma",   tags: FLAVOR_AROMA_TAGS },
              { key: "texture", tags: FLAVOR_TEXTURE_TAGS },
            ] as const
          ).map(({ key, tags: flavorTagList }) => (
            <View key={key} style={{ marginBottom: 6 }}>
              <Text className="text-xs text-muted mb-1.5" style={{ lineHeight: 16 }}>
                {lang === "zh" ? FLAVOR_LAYER_LABELS[key].zh : FLAVOR_LAYER_LABELS[key].en}
              </Text>
              <View style={styles.chipWrap}>
                {flavorTagList.map((tag) => {
                  const active = flavors.includes(tag);
                  const storeTag = tags.find((tg) => tg.kind === "flavor" && tg.name === tag);
                  const tint = storeTag?.color ?? FLAVOR_TAG_DEFAULT_COLORS[tag] ?? "#007AFF";
                  return (
                    <Pressable
                      key={tag}
                      onPress={() => toggleFlavor(tag)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? tint : colors.surface,
                          borderColor: active ? tint : tint + "66",
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.muted }]}>
                        {lang === "zh" ? tag : (FLAVOR_TAG_EN[tag] ?? tag)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Method */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.method")}</Text>
          <ChipGroup
            options={METHODS}
            value={method}
            onChange={setMethod}
            labelOf={(v) => localizedTagName(v, "", lang)}
          />

          {/* Strength: auto-computed from ingredients + method */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.strength")}</Text>
          <View
            className="bg-surface border border-border rounded-xl px-3 py-2.5"
            style={{ gap: 2 }}
          >
            {abvEstimate.abv !== null && abvEstimate.strength && abvEstimate.band ? (
              <>
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Text className="text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
                    {lang === "en"
                      ? t(`strength.${abvEstimate.strength}` as "strength.light")
                      : STRENGTH_LABELS[abvEstimate.strength]}
                    {" · "}
                    {STRENGTH_BAND_LABELS[abvEstimate.band][lang]}
                  </Text>
                  <Text className="text-sm text-muted" style={{ lineHeight: 20 }}>
                    ≈{abvEstimate.abv}% ABV
                  </Text>
                </View>
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  {t("form.abv.auto")}
                </Text>
              </>
            ) : (
              <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                {t("form.abv.pending")}
              </Text>
            )}
          </View>

          {/* Glass */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.glass")}</Text>
          {glassNames.length > 0 ? (
            <ChipGroup
              options={glassNames}
              value={glass}
              onChange={setGlass}
              colorsMap={glassColors}
              newTags={newGlassTags}
              labelOf={(v) => {
                const tag = glassTags.find((tg) => tg.name === v);
                return localizedTagName(v, tag?.nameEn, lang);
              }}
            />
          ) : (
            <Text className="text-xs text-muted">{t("form.noGlass")}</Text>
          )}

          {/* Ice type */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.ice")}</Text>
          <ChipGroup
            options={ICE_TYPES}
            value={ice}
            onChange={(v) => setIce(v === ice ? "" : v)}
            labelOf={(v) => localizedTagName(v, "", lang)}
          />

          {/* Ingredients */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.ingredients")}</Text>
          <NestableDraggableFlatList
            data={ingredients}
            keyExtractor={(item) => item.id}
            renderItem={renderIngredientItem}
            onDragEnd={({ data }) => setIngredients(data)}
            scrollEnabled={false}
            activationDistance={10}
          />
          <Pressable
            onPress={addIngredientRow}
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
            <Text className="text-sm font-medium" style={{ color: colors.primary, lineHeight: 20 }}>
              {t("form.addIngredient")}
            </Text>
          </Pressable>

          {/* Garnish */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.garnish")}</Text>
          {garnishRows.map((row) => {
            const trimmed = row.name.trim();
            // ── 四状态判定：已忽略 > 显式 ID 链接 > 自动匹配（exact 自动链接 / fuzzy 待确认）──
            const gDismissed = row.linkDismissed === true;
            // 显式链接：按 ID 精确解析（改名不断链）
            const explicitBottle = !gDismissed && row.linkedBottleId ? bottles.find((b) => b.id === row.linkedBottleId) : undefined;
            const explicitPrep = !gDismissed && !explicitBottle && row.linkedPrepId ? preps.find((p) => p.id === row.linkedPrepId) : undefined;
            const explicitGLink = explicitBottle
              ? ({ kind: "bottle", bottle: explicitBottle, matchConfidence: "exact" } as const)
              : explicitPrep
                ? ({ kind: "prep", prep: explicitPrep, matchConfidence: "exact" } as const)
                : null;
            const rawGLink = !gDismissed && !explicitGLink && trimmed.length > 1 ? smartLinkIngredient(trimmed, bottles, preps) : null;
            const isGFuzzy = rawGLink?.matchConfidence === "fuzzy";
            const activeGLink = explicitGLink ?? (rawGLink && (!isGFuzzy || acceptedGarnishLinks[row.id]) && !dismissedGarnishLinks[row.id] ? rawGLink : null);
            const pendingGFuzzyLink = !explicitGLink && isGFuzzy && !dismissedGarnishLinks[row.id] && !acceptedGarnishLinks[row.id] ? rawGLink : null;
            const showGSuggest = focusedGarnish === row.id && trimmed.length > 0 && pickedGarnish[row.id] !== row.name;
            const liveGSuggestions = showGSuggest ? suggestIngredients(trimmed, bottles, preps, lang, 4, groupOf).filter((s) => s.value !== trimmed) : [];
            return (
              <View key={row.id} className="mb-2">
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <TextInput
                    className="flex-1 bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
                    placeholder={lang === "zh" ? "装饰名称" : "Garnish name"}
                    placeholderTextColor={colors.muted}
                    value={row.name}
                    onChangeText={(v) => {
                      setGarnishRows((prev) => prev.map((r) => r.id === row.id ? { ...r, name: v, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: undefined } : r));
                      setDismissedGarnishLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
                      setAcceptedGarnishLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
                    }}
                    onFocus={() => setFocusedGarnish(row.id)}
                    onBlur={() => {
                      if (!pressingGarnishSuggestRef.current) {
                        setTimeout(() => setFocusedGarnish((cur) => (cur === row.id ? null : cur)), 150);
                      }
                    }}
                    autoCapitalize="words"
                    returnKeyType="done"
                    style={{ lineHeight: 20 }}
                  />
                  <Pressable
                    onPress={() => {
                      setGarnishRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== row.id) : [{ id: genId(), name: "" }]);
                      setDismissedGarnishLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
                      setAcceptedGarnishLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; });
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol name="minus.circle.fill" size={24} color={garnishRows.length > 1 ? colors.error : colors.border} />
                  </Pressable>
                </View>
                {liveGSuggestions.length > 0 ? (
                  <View className="rounded-xl border overflow-hidden mt-1" style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
                    {liveGSuggestions.map((s, sIdx) => (
                      <Pressable
                        key={s.key}
                        onPressIn={() => { pressingGarnishSuggestRef.current = true; }}
                        onPressOut={() => { pressingGarnishSuggestRef.current = false; }}
                        onPress={() => {
                          pressingGarnishSuggestRef.current = false;
                          setGarnishRows((prev) => prev.map((r) => r.id === row.id ? { ...r, name: s.value } : r));
                          setPickedGarnish((prev) => ({ ...prev, [row.id]: s.value }));
                          setFocusedGarnish(null);
                        }}
                        style={({ pressed }) => [styles.suggestRow, sIdx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, pressed && { opacity: 0.6 }]}
                      >
                        <IconSymbol name={s.source === "homemade" ? "sparkles" : s.source === "spirits" ? "flame.fill" : s.source === "materials" ? "leaf.fill" : "wineglass.fill"} size={13} color={s.source === "homemade" ? colors.primary : s.source === "spirits" ? "#FF9500" : s.source === "materials" ? colors.success : "#5AC8FA"} />
                        <Text className="text-sm text-foreground" numberOfLines={1} style={{ lineHeight: 18, flexShrink: 1 }}>{s.value}</Text>
                        <View style={{ flex: 1 }} />
                        <Text className="text-[11px]" style={{ lineHeight: 14, color: s.source === "homemade" ? colors.primary : s.source === "spirits" ? "#FF9500" : s.source === "materials" ? colors.success : "#5AC8FA" }}>
                          {s.source === "homemade" ? t("form.suggest.homemade") : s.source === "spirits" ? t("form.suggest.spirits") : s.source === "materials" ? t("form.suggest.materials") : t("form.suggest.bottle")}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {activeGLink ? (
                  <View className="flex-row items-center flex-wrap mt-1" style={{ gap: 6 }}>
                    <Pressable
                      onPress={() => { if (activeGLink.kind === "prep") router.push({ pathname: "/homemade/[id]", params: { id: activeGLink.prep.id } }); else router.push({ pathname: "/bottle/[id]", params: { id: activeGLink.bottle.id } }); }}
                      style={({ pressed }) => [styles.linkTag, pressed && { opacity: 0.7 }]}
                    >
                      <IconSymbol name={activeGLink.kind === "prep" ? "sparkles" : "link"} size={11} color={colors.primary} />
                      <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>{smartLinkDisplayName(activeGLink, lang as "zh" | "en")?.primary ?? ""}</Text>
                      <IconSymbol name="chevron.right" size={10} color={colors.primary} />
                    </Pressable>
                    <Pressable
                      onPress={() => setLinkPickerTarget({ scope: "garnish", id: row.id, query: trimmed })}
                      style={({ pressed }) => [styles.unlinkBtn, pressed && { opacity: 0.7 }]}
                    >
                      <IconSymbol name="arrow.triangle.2.circlepath" size={10} color={colors.muted} />
                      <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>{t("form.link.rebind")}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { setGarnishRows((prev) => prev.map((r) => r.id === row.id ? { ...r, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: true } : r)); setDismissedGarnishLinks((prev) => ({ ...prev, [row.id]: true })); setAcceptedGarnishLinks((prev) => { const n = { ...prev }; delete n[row.id]; return n; }); }}
                      style={({ pressed }) => [styles.unlinkBtn, pressed && { opacity: 0.7 }]}
                    >
                      <IconSymbol name="xmark" size={10} color={colors.muted} />
                      <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>{t("form.link.break")}</Text>
                    </Pressable>
                  </View>
                ) : pendingGFuzzyLink ? (
                  <View className="flex-row items-center flex-wrap mt-1" style={{ gap: 6 }}>
                    <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                      {pendingGFuzzyLink.kind === "prep" ? t("form.link.fuzzy.prep").replace("{name}", smartLinkDisplayName(pendingGFuzzyLink, lang as "zh" | "en")?.primary ?? "") : t("form.link.fuzzy.bottle").replace("{name}", smartLinkDisplayName(pendingGFuzzyLink, lang as "zh" | "en")?.primary ?? "")}
                    </Text>
                    <Pressable
                      onPress={() => {
                        // 接受 = 写入显式 ID 链接（持久化）
                        setGarnishRows((prev) => prev.map((r) => r.id === row.id
                          ? { ...r, linkedBottleId: pendingGFuzzyLink.kind === "bottle" ? pendingGFuzzyLink.bottle.id : undefined, linkedPrepId: pendingGFuzzyLink.kind === "prep" ? pendingGFuzzyLink.prep.id : undefined, linkDismissed: undefined }
                          : r));
                        setAcceptedGarnishLinks((prev) => ({ ...prev, [row.id]: true }));
                      }}
                      style={({ pressed }) => [styles.linkTag, pressed && { opacity: 0.7 }]}
                    >
                      <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>{t("form.link.accept")}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setLinkPickerTarget({ scope: "garnish", id: row.id, query: trimmed })}
                      style={({ pressed }) => [styles.unlinkBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>{t("form.link.more")}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setGarnishRows((prev) => prev.map((r) => r.id === row.id ? { ...r, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: true } : r));
                        setDismissedGarnishLinks((prev) => ({ ...prev, [row.id]: true }));
                      }}
                      style={({ pressed }) => [styles.unlinkBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>{t("form.link.dismiss")}</Text>
                    </Pressable>
                  </View>
                ) : gDismissed && trimmed.length > 1 ? (
                  <View className="flex-row items-center flex-wrap mt-1" style={{ gap: 6 }}>
                    <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>{t("form.link.dismissed")}</Text>
                    <Pressable
                      onPress={() => setLinkPickerTarget({ scope: "garnish", id: row.id, query: trimmed })}
                      style={({ pressed }) => [styles.linkTag, pressed && { opacity: 0.7 }]}
                    >
                      <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>{t("form.link.relink")}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}
          <Pressable
            onPress={() => setGarnishRows((prev) => [...prev, { id: genId(), name: "" }])}
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
            <Text className="text-sm font-medium" style={{ color: colors.primary, lineHeight: 20 }}>
              {lang === "zh" ? "添加装饰" : "Add Garnish"}
            </Text>
          </Pressable>

          {/* Steps */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.steps")}</Text>
          {stepRows.map((row, idx) => (
            <View key={row.id} className="flex-row items-start mb-2" style={{ gap: 8 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#E5E7EB", alignItems: "center", justifyContent: "center", marginTop: 10, flexShrink: 0 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: "#6B7280", lineHeight: 14 }}>{idx + 1}</Text>
              </View>
              <TextInput
                className="flex-1 bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
                placeholder={lang === "zh" ? `步骤 ${idx + 1}` : `Step ${idx + 1}`}
                placeholderTextColor={colors.muted}
                value={row.text}
                onChangeText={(v) => setStepRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, text: v } : r)))}
                multiline
                style={{ minHeight: 44, textAlignVertical: "top", lineHeight: 22 }}
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
            <Text className="text-sm font-medium" style={{ color: colors.primary, lineHeight: 20 }}>
              {lang === "zh" ? "添加步骤" : "Add Step"}
            </Text>
          </Pressable>

          {/* Flavor description — 三段式 */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.flavorDesc")}</Text>
          <View className="bg-surface border border-border rounded-xl overflow-hidden">
            {[
              { label: lang === "zh" ? "核心基调" : "Core Profile", value: flavorTone, onChange: setFlavorTone, placeholder: lang === "zh" ? "主要口感基调，如：清爽酸甜、浓郁烟熏…" : "Main taste profile, e.g. bright citrus…" },
              { label: lang === "zh" ? "风味演变" : "Flavor Evolution", value: flavorEvolution, onChange: setFlavorEvolution, placeholder: lang === "zh" ? "前中后段的风味变化…" : "How flavors develop from start to finish…" },
              { label: lang === "zh" ? "整体质感" : "Overall Texture", value: flavorTexture, onChange: setFlavorTexture, placeholder: lang === "zh" ? "口感质地、余韵、整体印象…" : "Mouthfeel, finish, overall impression…" },
            ].map((seg, i) => (
              <View key={seg.label} style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, letterSpacing: 0.4, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2, textTransform: "uppercase" }}>{seg.label}</Text>
                <TextInput
                  className="text-base text-foreground"
                  placeholder={seg.placeholder}
                  placeholderTextColor={colors.muted}
                  value={seg.value}
                  onChangeText={seg.onChange}
                  multiline
                  style={{ paddingHorizontal: 14, paddingBottom: 10, minHeight: 44, textAlignVertical: "top", lineHeight: 22 }}
                />
              </View>
            ))}
          </View>

          {/* Notes */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.notes")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.notes.placeholder")}
            placeholderTextColor={colors.muted}
            value={notes}
            onChangeText={setNotes}
            multiline
            style={{ minHeight: 80, textAlignVertical: "top", lineHeight: 22 }}
          />

          {/* Story */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.story")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.story.placeholder")}
            placeholderTextColor={colors.muted}
            value={story}
            onChangeText={setStory}
            multiline
            style={{ minHeight: 90, textAlignVertical: "top", lineHeight: 22 }}
          />

          {/* Source */}
          <Text className="text-[13px] text-muted uppercase mt-5 mb-2" style={{ letterSpacing: 0.4 }}>{t("form.source")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.source.placeholder")}
            placeholderTextColor={colors.muted}
            value={source}
            onChangeText={setSource}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />

          {/* SourceRef — 结构化引用来源（可展开编辑） */}
          <Pressable
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, marginTop: 12, flexDirection: "row" as const, alignItems: "center" as const, gap: 4 }]}
            onPress={() => setShowSourceRef((v) => !v)}
          >
            <IconSymbol name={showSourceRef ? "chevron.down" : "chevron.right"} size={14} color={colors.muted} />
            <Text className="text-sm text-muted">{lang === "zh" ? "详细引用来源（书名/创作者/年份）" : "Detailed Source (book / creator / year)"}</Text>
          </Pressable>
          {showSourceRef ? (
            <View className="bg-surface border border-border rounded-xl p-4 mt-2" style={{ gap: 10 }}>
              {([
                { key: "bookTitle", label: lang === "zh" ? "书名" : "Book Title" },
                { key: "bookAuthor", label: lang === "zh" ? "书作者" : "Book Author" },
                { key: "publishYear", label: lang === "zh" ? "出版年份" : "Publish Year" },
                { key: "chapterTitle", label: lang === "zh" ? "章节" : "Chapter" },
                { key: "pageRef", label: lang === "zh" ? "页码" : "Page" },
                { key: "creator", label: lang === "zh" ? "配方创作者" : "Creator" },
                { key: "createdYear", label: lang === "zh" ? "创作年份" : "Created Year" },
              ] as { key: keyof SourceRef; label: string }[]).map(({ key, label }) => (
                <View key={String(key)}>
                  <Text className="text-xs text-muted mb-1">{label}</Text>
                  <TextInput
                    className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                    placeholder="—"
                    placeholderTextColor={colors.muted}
                    value={typeof sourceRef[key] === "string" ? (sourceRef[key] as string) : ""}
                    onChangeText={(v) => setSourceRef((prev: SourceRef) => ({ ...prev, [key]: v }))}
                    returnKeyType="done"
                    style={{ lineHeight: 18 }}
                  />
                </View>
              ))}
            </View>
          ) : null}

        </NestableScrollContainer>

        {/* Save button */}
        <View
          className="px-5 pt-3"
          style={{
            paddingBottom: Math.max(insets.bottom, 12),
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
          }}
        >
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: canSave ? colors.primary : colors.border },
              pressed && canSave && { transform: [{ scale: 0.98 }], opacity: 0.9 },
            ]}
          >
            <Text style={[styles.saveBtnText, { color: canSave ? "#FFFFFF" : colors.muted }]}>
              {editing ? t("form.save.edit") : t("form.save")}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
      {/* Unit picker sheet */}
      <UnitPickerSheet
        visible={unitPickerIngId !== null}
        selectedUnit={unitPickerIngId ? splitAmount(ingredients.find((i) => i.id === unitPickerIngId)?.amount ?? "").unit : ""}
        recentUnits={recentUnits}
        onSelect={(unit) => {
          if (!unitPickerIngId) return;
          const ing = ingredients.find((i) => i.id === unitPickerIngId);
          if (!ing) return;
          const { qty } = splitAmount(ing.amount);
          updateIngredient(unitPickerIngId, "amount", mergeAmount(qty, unit));
          if (unit) addRecentUnit(unit);
        }}
        onClose={() => setUnitPickerIngId(null)}
      />
      {/* 多候选链接选择器（装饰/配料共用） */}
      <LinkPickerSheet
        visible={linkPickerTarget !== null}
        initialQuery={linkPickerTarget?.query ?? ""}
        bottles={bottles}
        preps={preps}
        groupOf={groupOf}
        onPick={(result) => {
          const target = linkPickerTarget;
          setLinkPickerTarget(null);
          if (!target) return;
          if (target.scope === "garnish") {
            if (result.kind === "none") {
              setGarnishRows((prev) => prev.map((r) => r.id === target.id ? { ...r, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: true } : r));
              setDismissedGarnishLinks((prev) => ({ ...prev, [target.id]: true }));
              setAcceptedGarnishLinks((prev) => { const n = { ...prev }; delete n[target.id]; return n; });
            } else {
              setGarnishRows((prev) => prev.map((r) => r.id === target.id
                ? { ...r, linkedBottleId: result.kind === "bottle" ? result.bottleId : undefined, linkedPrepId: result.kind === "prep" ? result.prepId : undefined, linkDismissed: undefined }
                : r));
              setDismissedGarnishLinks((prev) => { const n = { ...prev }; delete n[target.id]; return n; });
              setAcceptedGarnishLinks((prev) => ({ ...prev, [target.id]: true }));
            }
          } else {
            if (result.kind === "none") {
              setIngredients((prev) => prev.map((i) => i.id === target.id ? { ...i, linkedBottleId: undefined, linkedPrepId: undefined, linkDismissed: true } : i));
              setDismissedLinks((prev) => ({ ...prev, [target.id]: true }));
              setAcceptedLinks((prev) => { const n = { ...prev }; delete n[target.id]; return n; });
            } else {
              setIngredients((prev) => prev.map((i) => i.id === target.id
                ? { ...i, linkedBottleId: result.kind === "bottle" ? result.bottleId : undefined, linkedPrepId: result.kind === "prep" ? result.prepId : undefined, linkDismissed: undefined }
                : i));
              setDismissedLinks((prev) => { const n = { ...prev }; delete n[target.id]; return n; });
              setAcceptedLinks((prev) => ({ ...prev, [target.id]: true }));
            }
          }
        }}
        onClose={() => setLinkPickerTarget(null)}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  prepHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 44,
  },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  saveBtn: {
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  linkTag: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#0a7ea440",
    backgroundColor: "#0a7ea410",
  },
  unlinkBtn: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
});
