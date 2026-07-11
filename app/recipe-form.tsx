import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
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
import { useHomemadeStore } from "@/lib/homemade/store";
import { useBottleStore } from "@/lib/bottles/store";
import { displayNames } from "@/lib/utils";
import { suggestIngredients } from "@/lib/suggest";
import { RecipeDraft, useRecipeStore } from "@/lib/recipes/store";
import { trpc } from "@/lib/trpc";
import { parseRecipeText } from "@/lib/recipes/parser";
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

export default function RecipeFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
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
  const { getRecipe, addRecipe, updateRecipe, categories, tagsOf, addTag } = useRecipeStore();
  const enrichRecipeMutation = trpc.lookup.enrichRecipe.useMutation();
  const { isOnline } = useNetwork();
  const { preps } = useHomemadeStore();
  const { bottles } = useBottleStore();
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
  const [source, setSource] = useState(editing?.source ?? "");
  const [story, setStory] = useState(editing?.story ?? "");
  const [flavorDesc, setFlavorDesc] = useState(editing?.flavorDesc ?? "");
  const [ingredients, setIngredients] = useState<Ingredient[]>(
    editing?.ingredients?.length
      ? editing.ingredients
      : [{ id: genId(), name: "", amount: "" }],
  );
  const [steps, setSteps] = useState(editing?.steps ?? "");
  const [garnish, setGarnish] = useState(editing?.garnish ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [importHint, setImportHint] = useState("");
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
  } | null>(null);
  /** Which ingredient row is focused (shows live suggestions) */
  /** 风味标签专属置信度（来自自动 AI 分析） */
  const [flavorConfidence, setFlavorConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [newSpiritTags, setNewSpiritTags] = useState<string[]>([]);
  const [newGlassTags, setNewGlassTags] = useState<string[]>([]);
  /** 防止重复触发自动 AI 风味分析 */
  const autoFlavorDoneRef = useRef(false);
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
    if (prefillSteps) setSteps(prefillSteps);
    if (prefillGarnish) setGarnish(prefillGarnish);
    if (prefillNotes) setNotes(prefillNotes);
    if (prefillIngredientsArr.length > 0) setIngredients(prefillIngredientsArr);
    if (prefillName || prefillNameEn || prefillIngredientsArr.length > 0) {
      setImportHint(lang === "zh" ? "已从书库提取配方，请核对后保存" : "Recipe extracted from book. Review before saving.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Which ingredient row is focused (shows live suggestions) */
  const [focusedIng, setFocusedIng] = useState<string | null>(null);
  /** Rows where user picked/dismissed suggestions — suppress until text changes */
  const [pickedIng, setPickedIng] = useState<Record<string, string>>({});

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
  const ensureGlassName = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    const hit = glassNames.find((g) => cleaned.includes(g) || g.includes(cleaned));
    if (hit) return hit;
    const created = addTag("glass", cleaned, CATEGORY_COLORS[3]);
    const nextName = created?.name ?? cleaned;
    setNewGlassTags((prev) => (prev.includes(nextName) ? prev : [...prev, nextName]));
    return nextName;
  };
  const normalizeIceName = (raw: string) => {
    const cleaned = raw.trim();
    if (!cleaned) return "";
    return ICE_TYPES.find((it) => cleaned.includes(it) || it.includes(cleaned)) ?? cleaned;
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
    enrichRecipeMutation.mutate(
      {
        name: recipeName,
        nameEn: nameEn.trim() || undefined,
        baseSpirit: baseSpirit || undefined,
        ingredients: ingNames.length > 0 ? ingNames : undefined,
        source: source.trim() || undefined,
        story: story.trim() || undefined,
        flavorDesc: flavorDesc.trim() || undefined,
        method: method || undefined,
        existingSpirits: spiritNames,
        existingGlasses: glassNames,
      },
      {
        onSuccess: (result) => {
          if (!isMountedRef.current) return;
          if (!baseSpirit && result.suggestedBaseSpirit && result.suggestedBaseSpiritConfidence === "high") {
            const nextName = ensureSpiritName(result.suggestedBaseSpirit);
            if (nextName) setBaseSpirit(nextName);
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
        },
        onError: (err: unknown) => {
          if (!isMountedRef.current) return;
          setAiEnriching(false);
          const msg = err instanceof Error ? err.message : "AI 分析失败，请重试";
          Alert.alert("AI 补全失败", msg);
        },
      },
    );
  };
  /**
   * 打开表单时自动触发 AI 风味分析（仅一次）。
   * 结果直接点亮风味标签；低置信度时显示警告横幅。
   */
  useEffect(() => {
    if (autoFlavorDoneRef.current) return;
    const recipeName = name.trim() || nameEn.trim();
    if (!recipeName) return;
    if (!isOnline) return; // Skip auto AI analysis when offline
    autoFlavorDoneRef.current = true;
    const ingNames = ingredients.map((i) => i.name).filter(Boolean);
    enrichRecipeMutation.mutate(
      {
        name: recipeName,
        nameEn: nameEn.trim() || undefined,
        baseSpirit: baseSpirit || undefined,
        ingredients: ingNames.length > 0 ? ingNames : undefined,
        method: method || undefined,
        existingSpirits: spiritNames,
        existingGlasses: glassNames,
      },
      {
        onSuccess: (result) => {
          if (!isMountedRef.current) return;
          if (result.flavors && result.flavors.length > 0) {
            setFlavors(result.flavors);
            const conf = result.flavorConfidence ?? result.confidence ?? "medium";
            setFlavorConfidence(conf);
          }
          if (!baseSpirit && result.suggestedBaseSpirit && result.suggestedBaseSpiritConfidence === "high") {
            const nextName = ensureSpiritName(result.suggestedBaseSpirit);
            if (nextName) setBaseSpirit(nextName);
          }
          if (!glass && result.suggestedGlass && result.suggestedGlassConfidence === "high") {
            const nextName = ensureGlassName(result.suggestedGlass);
            if (nextName) setGlass(nextName);
          }
          if (!ice && result.suggestedIce && result.suggestedIceConfidence === "high") {
            const nextName = normalizeIceName(result.suggestedIce);
            if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
          }
          // 同时存入 aiResult，供用户按需应用故事/来源等字段
          if (
            result.story ||
            result.flavorDesc ||
            result.source ||
            result.suggestedBaseSpirit ||
            result.suggestedGlass ||
            result.suggestedIce
          ) {
            setAiResult(result);
          }
        },
        onError: (err: unknown) => {
          if (!isMountedRef.current) return;
          const msg = err instanceof Error ? err.message : "AI 分析失败";
          // Silently ignore auto-trigger errors (non-blocking)
          console.warn("[AutoFlavor] AI enrich failed:", msg);
        },
      },
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅挂载时触发一次

  const applyAiResult = () => {
    if (!aiResult) return;
    if (aiResult.story && !story.trim()) setStory(aiResult.story);
    if (aiResult.flavorDesc && !flavorDesc.trim()) setFlavorDesc(aiResult.flavorDesc);
    if (aiResult.source && !source.trim()) setSource(aiResult.source);
    if (aiResult.flavors && aiResult.flavors.length > 0 && flavors.length === 0) {
      setFlavors(aiResult.flavors);
    }
    if (!baseSpirit && aiResult.suggestedBaseSpirit) {
      const nextName = ensureSpiritName(aiResult.suggestedBaseSpirit);
      if (nextName) setBaseSpirit(nextName);
    }
    if (!glass && aiResult.suggestedGlass) {
      const nextName = ensureGlassName(aiResult.suggestedGlass);
      if (nextName) setGlass(nextName);
    }
    if (!ice && aiResult.suggestedIce) {
      const nextName = normalizeIceName(aiResult.suggestedIce);
      if ((ICE_TYPES as readonly string[]).includes(nextName)) setIce(nextName);
    }
    setAiResult(null);
  };

  const canSave = name.trim().length > 0 || nameEn.trim().length > 0;

  /** 根据配料与方法自动计算成品 ABV,并推导烈度大类与档位 */
  const abvEstimate = useMemo(
    () => estimateRecipeAbv(ingredients, method, bottles, preps),
    [ingredients, method, bottles, preps],
  );

  const updateIngredient = (iid: string, field: "name" | "amount", value: string) => {
    setIngredients((prev) => prev.map((i) => (i.id === iid ? { ...i, [field]: value } : i)));
  };

  const pickSuggestion = (iid: string, value: string) => {
    updateIngredient(iid, "name", value);
    setPickedIng((prev) => ({ ...prev, [iid]: value }));
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const addIngredientRow = () => {
    setIngredients((prev) => [...prev, { id: genId(), name: "", amount: "" }]);
  };

  const removeIngredientRow = (iid: string) => {
    setIngredients((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== iid) : prev));
  };

  const toggleFlavor = (tag: string) => {
    setFlavors((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };
  // 手动修改标签后，清除 AI 状态指示（但保留低置信度警告，直到用户手动关闭）

  /** 将解析结果填充到表单;仅覆盖解析到内容的字段 */
  const applyParsed = (text: string) => {
    const p = parseRecipeText(text);
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
    if (p.steps) setSteps(p.steps);
    if (p.garnish) setGarnish(p.garnish);
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
      flavorDesc: flavorDesc.trim(),
      ingredients: ingredients.filter((i) => i.name.trim().length > 0),
      steps: steps.trim(),
      garnish: garnish.trim(),
    notes: notes.trim(),
      cardTagOrder: null,
  };
    if (editing) {
      updateRecipe(editing.id, draft);
    } else {
      const newRecipe = addRecipe(draft);
      // Auto-tag flavors in background when user didn't manually select any
      if (flavors.length === 0) {
        const ingNames = draft.ingredients.map((i) => i.name).filter(Boolean);
        enrichRecipeMutation.mutate(
          {
            name: draft.name,
            nameEn: draft.nameEn || undefined,
            baseSpirit: draft.baseSpirit || undefined,
            ingredients: ingNames.length > 0 ? ingNames : undefined,
            existingSpirits: spiritNames,
            existingGlasses: glassNames,
          },
          {
            onSuccess: (result) => {
              if (result.flavors.length > 0) {
                updateRecipe(newRecipe.id, { ...draft, flavors: result.flavors });
              }
            },
          },
        );
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
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Smart import: paste / camera / photos */}
          <SmartImportBar
            targetType="recipe"
            onExtracted={(item) => {
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
              if (item.steps) setSteps(item.steps);
              if (item.garnish) setGarnish(item.garnish);
              if (item.source) setSource(item.source);
              if (item.notes) setNotes(item.notes);
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
              <Text className="text-sm font-medium text-muted mt-3 mb-1.5">{t("form.nameEn.required")}</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
                placeholder={t("form.nameEn.placeholder")}
                placeholderTextColor={colors.muted}
                value={nameEn}
                onChangeText={setNameEn}
                returnKeyType="done"
                style={{ lineHeight: 20 }}
              />
              <Text className="text-sm font-medium text-muted mt-3 mb-1.5">{t("form.nameZh.label")}</Text>
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
              <Text className="text-sm font-medium text-muted mt-3 mb-1.5">{t("form.nameZh.required")}</Text>
              <TextInput
                className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
                placeholder={t("form.nameZh.placeholder")}
                placeholderTextColor={colors.muted}
                value={name}
                onChangeText={setName}
                returnKeyType="done"
                style={{ lineHeight: 20 }}
              />
              <Text className="text-sm font-medium text-muted mt-3 mb-1.5">{t("form.nameEn.label")}</Text>
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
          <Pressable
            onPress={handleAiEnrich}
            disabled={aiEnriching || (!name.trim() && !nameEn.trim())}
            style={({ pressed }) => [
              {
                flexDirection: "row" as const,
                alignItems: "center" as const,
                justifyContent: "center" as const,
                gap: 6,
                marginTop: 12,
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: (!name.trim() && !nameEn.trim()) ? colors.border : colors.primary + "55",
                backgroundColor: (!name.trim() && !nameEn.trim()) ? colors.surface : colors.primary + "0E",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {aiEnriching ? (
              <>
                <IconSymbol name="sparkles" size={15} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>
                  {lang === "zh" ? "AI 补全中…" : "AI filling…"}
                </Text>
              </>
            ) : (
              <>
                <IconSymbol name="sparkles" size={15} color={(!name.trim() && !nameEn.trim()) ? colors.muted : colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: (!name.trim() && !nameEn.trim()) ? colors.muted : colors.primary }}>
                  {lang === "zh" ? "AI 补全故事与风味" : "AI Fill Story & Flavors"}
                </Text>
              </>
            )}
          </Pressable>
          {aiResult && (
            <View
              className="rounded-xl border px-3 py-3 mt-2"
              style={{ borderColor: colors.primary + "44", backgroundColor: colors.primary + "0A", gap: 8 }}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center" style={{ gap: 6 }}>
                  <IconSymbol name="sparkles" size={13} color={colors.primary} />
                  <Text className="text-xs font-medium" style={{ color: colors.primary }}>
                    {lang === "zh" ? "AI 建议" : "AI Suggestion"}
                  </Text>
                  <View
                    className="px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor:
                        aiResult.confidence === "high"
                          ? colors.success + "22"
                          : aiResult.confidence === "medium"
                            ? "#FF950022"
                            : colors.border,
                    }}
                  >
                    <Text
                      className="text-[10px] font-medium"
                      style={{
                        color:
                          aiResult.confidence === "high"
                            ? colors.success
                            : aiResult.confidence === "medium"
                              ? "#FF9500"
                              : colors.muted,
                      }}
                    >
                      {aiResult.confidence === "high"
                        ? (lang === "zh" ? "高可信" : "High")
                        : aiResult.confidence === "medium"
                          ? (lang === "zh" ? "中可信" : "Medium")
                          : (lang === "zh" ? "低可信" : "Low")}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={() => setAiResult(null)} hitSlop={8}>
                  <IconSymbol name="xmark" size={14} color={colors.muted} />
              </Pressable>
            </View>
              {aiResult.story ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  {lang === "zh" ? "故事: " : "Story: "}{aiResult.story}
                </Text>
              ) : null}
              {aiResult.flavorDesc ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  {lang === "zh" ? "风味: " : "Flavor desc: "}{aiResult.flavorDesc}
                </Text>
              ) : null}
              {aiResult.source ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  {lang === "zh" ? "来源: " : "Source: "}{aiResult.source}
                </Text>
              ) : null}
              {!baseSpirit && aiResult.suggestedBaseSpirit ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  {lang === "zh" ? "基酒建议: " : "Base spirit: "}
                  {aiResult.suggestedBaseSpirit}
                  {aiResult.suggestedBaseSpiritConfidence ? ` · ${aiResult.suggestedBaseSpiritConfidence}` : ""}
                </Text>
              ) : null}
              {!glass && aiResult.suggestedGlass ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  {lang === "zh" ? "杯型建议: " : "Glass: "}
                  {aiResult.suggestedGlass}
                  {aiResult.suggestedGlassConfidence ? ` · ${aiResult.suggestedGlassConfidence}` : ""}
                </Text>
              ) : null}
              {!ice && aiResult.suggestedIce ? (
                <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                  {lang === "zh" ? "冰块建议: " : "Ice: "}
                  {aiResult.suggestedIce}
                  {aiResult.suggestedIceConfidence ? ` · ${aiResult.suggestedIceConfidence}` : ""}
                </Text>
              ) : null}
              <Pressable
                onPress={applyAiResult}
                style={({ pressed }) => [
                  {
                    marginTop: 2,
                    paddingVertical: 7,
                    paddingHorizontal: 14,
                    borderRadius: 8,
                    alignItems: "center" as const,
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text className="text-xs font-semibold" style={{ color: "#FFFFFF" }}>
                  {lang === "zh" ? "应用到空白字段" : "Apply to empty fields"}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Category */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.category")}</Text>
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
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.spirit")}</Text>
          {spiritNames.length > 0 ? (
            <ChipGroup
              options={spiritNames}
              value={baseSpirit}
              onChange={setBaseSpirit}
              colorsMap={spiritColors}
              newTags={newSpiritTags}
              labelOf={(v) => {
                const tag = spiritTags.find((tg) => tg.name === v);
                return localizedTagName(v, tag?.nameEn, lang);
              }}
            />
          ) : (
            <Text className="text-xs text-muted">{t("form.noSpirit")}</Text>
          )}

          {/* Codex family */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">
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
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.variantOf")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.variantOf.placeholder")}
            placeholderTextColor={colors.muted}
            value={variantOf}
            onChangeText={setVariantOf}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />

          {/* Drink duration (single-select) */}
          {/* Flavor tags */}
          <View className="flex-row items-center justify-between mt-5 mb-1.5">
            <Text className="text-sm font-medium text-muted">{t("form.flavors.multi")}</Text>
            {enrichRecipeMutation.isPending && (
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <IconSymbol name="sparkles" size={12} color={colors.primary} />
                <Text className="text-xs" style={{ color: colors.primary }}>
                  {lang === "zh" ? "AI 分析中…" : "Analyzing…"}
                </Text>
              </View>
            )}
            {!enrichRecipeMutation.isPending && flavorConfidence !== null && (
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
          ).map(({ key, tags }) => (
            <View key={key} style={{ marginBottom: 6 }}>
              <Text className="text-xs text-muted mb-1.5" style={{ lineHeight: 16 }}>
                {lang === "zh" ? FLAVOR_LAYER_LABELS[key].zh : FLAVOR_LAYER_LABELS[key].en}
              </Text>
              <View style={styles.chipWrap}>
                {tags.map((tag) => {
                  const active = flavors.includes(tag);
                  const tint = FLAVOR_TAG_DEFAULT_COLORS[tag] ?? "#007AFF";
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
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.method")}</Text>
          <ChipGroup
            options={METHODS}
            value={method}
            onChange={setMethod}
            labelOf={(v) => localizedTagName(v, "", lang)}
          />

          {/* Strength: auto-computed from ingredients + method */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.strength")}</Text>
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
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.glass")}</Text>
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
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.ice")}</Text>
          <ChipGroup
            options={ICE_TYPES}
            value={ice}
            onChange={(v) => setIce(v === ice ? "" : v)}
            labelOf={(v) => localizedTagName(v, "", lang)}
          />

          {/* Ingredients */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.ingredients")}</Text>
          {ingredients.map((ing) => {
            const trimmed = ing.name.trim();
            const link = trimmed.length >= 2 ? smartLinkIngredient(trimmed, bottles, preps) : null;
            const prep = link?.kind === "prep" ? link.prep : null;
            const linkedBottle = link?.kind === "bottle" ? link.bottle : null;
            const suggestion = !link && trimmed.length >= 2 ? suggestPrep(trimmed) : null;
            const classification =
              !link && !suggestion && trimmed.length >= 3
                ? analyzeUnknownIngredient(trimmed, bottles, preps)
                : null;
            const showSuggest =
              focusedIng === ing.id && trimmed.length > 0 && pickedIng[ing.id] !== ing.name;
            const liveSuggestions = showSuggest
              ? suggestIngredients(trimmed, bottles, preps, lang).filter((s) => s.value !== trimmed)
              : [];
            return (
              <View key={ing.id} className="mb-2">
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <TextInput
                    className="flex-[3] bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
                    placeholder={t("form.ingredient.name")}
                    placeholderTextColor={colors.muted}
                    value={ing.name}
                    onChangeText={(v) => updateIngredient(ing.id, "name", v)}
                    onFocus={() => setFocusedIng(ing.id)}
                    onBlur={() => {
                      // Delay so suggestion taps register before the list hides
                      setTimeout(() => {
                        setFocusedIng((cur) => (cur === ing.id ? null : cur));
                      }, 150);
                    }}
                    returnKeyType="done"
                    style={{ lineHeight: 20 }}
                  />
                  <TextInput
                    className="flex-[2] bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
                    placeholder={t("form.ingredient.amount")}
                    placeholderTextColor={colors.muted}
                    value={ing.amount}
                    onChangeText={(v) => updateIngredient(ing.id, "amount", v)}
                    returnKeyType="done"
                    style={{ lineHeight: 20 }}
                  />
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
                  <View
                    className="rounded-xl border overflow-hidden mt-1"
                    style={{ backgroundColor: colors.surface, borderColor: colors.border }}
                  >
                    {liveSuggestions.map((s, sIdx) => (
                      <Pressable
                        key={s.key}
                        onPress={() => pickSuggestion(ing.id, s.value)}
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
                          name={s.source === "homemade" ? "sparkles" : "wineglass.fill"}
                          size={13}
                          color={s.source === "homemade" ? colors.primary : colors.muted}
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
                        <Text className="text-[11px] text-muted" style={{ lineHeight: 14 }}>
                          {s.source === "homemade" ? t("form.suggest.homemade") : t("form.suggest.bottle")}
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
                        <Pressable
                          onPress={() =>
                            router.push({ pathname: "/homemade/[id]", params: { id: prep.id } })
                          }
                          style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}
                        >
                          <IconSymbol name="sparkles" size={12} color={colors.primary} />
                          <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>
                            {t("form.homemade.matched", { name: displayNames(prep.name, prep.nameAlt, lang).primary })}
                          </Text>
                          <IconSymbol name="chevron.right" size={11} color={colors.primary} />
                        </Pressable>
                        {differs ? (
                          <Pressable
                            onPress={() => pickSuggestion(ing.id, canon!.primary)}
                            style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}
                          >
                            <IconSymbol name="arrow.triangle.2.circlepath" size={12} color={colors.success} />
                            <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>
                              {t("form.replaceCanonical", { name: canon!.primary })}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })()
                ) : linkedBottle ? (
                  (() => {
                    const canon = smartLinkDisplayName(link, lang as "zh" | "en");
                    const differs = canon && canon.primary !== trimmed;
                    return (
                      <View className="flex-row items-center flex-wrap" style={{ gap: 10 }}>
                        <Pressable
                          onPress={() =>
                            router.push({ pathname: "/bottle/[id]", params: { id: linkedBottle.id } })
                          }
                          style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}
                        >
                          <IconSymbol name="link" size={12} color={colors.primary} />
                          <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>
                            {t("form.bottle.matched", {
                              name: displayNames(linkedBottle.nameEn, linkedBottle.nameZh, lang).primary,
                            })}
                          </Text>
                          <IconSymbol name="chevron.right" size={11} color={colors.primary} />
                        </Pressable>
                        {differs ? (
                          <Pressable
                            onPress={() => pickSuggestion(ing.id, canon!.primary)}
                            style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}
                          >
                            <IconSymbol name="arrow.triangle.2.circlepath" size={12} color={colors.success} />
                            <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>
                              {t("form.replaceCanonical", { name: canon!.primary })}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })()
                ) : suggestion ? (
                  <Pressable
                    onPress={() =>
                      router.push({
                        pathname: "/homemade-form",
                        params: {
                          prefillName: suggestion.name,
                          prefillNameAlt: suggestion.nameAlt,
                          prefillType: suggestion.type,
                        },
                      })
                    }
                    style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol name="plus.circle.fill" size={12} color={colors.success} />
                    <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>
                      {t("form.homemade.add")} · {displayNames(suggestion.name, suggestion.nameAlt, lang).primary}
                    </Text>
                  </Pressable>
                ) : classification ? (
                  <Pressable
                    onPress={() => {
                      if (classification.library === "homemade") {
                        router.push({
                          pathname: "/homemade-form",
                          params: {
                            prefillName: classification.name,
                            prefillNameAlt: classification.nameAlt,
                            prefillType: classification.category,
                          },
                        });
                      } else {
                        router.push({
                          pathname: "/bottle-form",
                          params: {
                            category: classification.category,
                            prefillName: classification.name,
                            prefillNameAlt: classification.nameAlt,
                            ...(classification.style ? { prefillStyle: classification.style } : {}),
                          },
                        });
                      }
                    }}
                    style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol name="plus.circle.fill" size={12} color={colors.success} />
                    <Text className="text-xs" style={{ color: colors.success, lineHeight: 16 }}>
                      {classification.library === "homemade"
                        ? t("form.homemade.add")
                        : classification.library === "material"
                          ? t("form.smartAdd.material")
                          : t("form.smartAdd.bottle")}
                      {" · "}
                      {displayNames(classification.name, classification.nameAlt, lang).primary}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
          <Pressable
            onPress={addIngredientRow}
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
            <Text className="text-sm font-medium" style={{ color: colors.primary, lineHeight: 20 }}>
              {t("form.addIngredient")}
            </Text>
          </Pressable>

          {/* Steps */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.steps")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.steps.placeholder")}
            placeholderTextColor={colors.muted}
            value={steps}
            onChangeText={setSteps}
            multiline
            style={{ minHeight: 100, textAlignVertical: "top", lineHeight: 22 }}
          />

          {/* Garnish */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.garnish")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.garnish.placeholder")}
            placeholderTextColor={colors.muted}
            value={garnish}
            onChangeText={setGarnish}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />

          {/* Flavor description */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.flavorDesc")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.flavorDesc.placeholder")}
            placeholderTextColor={colors.muted}
            value={flavorDesc}
            onChangeText={setFlavorDesc}
            multiline
            style={{ minHeight: 70, textAlignVertical: "top", lineHeight: 22 }}
          />

          {/* Notes */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.notes")}</Text>
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
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.story")}</Text>
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
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.source")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-4 py-3 text-base text-foreground"
            placeholder={t("form.source.placeholder")}
            placeholderTextColor={colors.muted}
            value={source}
            onChangeText={setSource}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />

        </ScrollView>

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
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
});
