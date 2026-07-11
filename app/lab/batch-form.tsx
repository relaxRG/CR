import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
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

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LabChangeChips } from "@/components/lab-change-chips";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { suggestPrep } from "@/lib/homemade/match";
import { smartLinkIngredient, smartLinkDisplayName } from "@/lib/recipes/smart-link";
import { analyzeUnknownIngredient } from "@/lib/classify";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useBottleStore } from "@/lib/bottles/store";
import { displayNames } from "@/lib/utils";
import { suggestIngredients } from "@/lib/suggest";
import { estimateRecipeAbv } from "@/lib/recipes/abv";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import { structuralFormula } from "@/lib/recipes/structure";
import { formatAmountAsMl } from "@/lib/bottles/cost";
import {
  ICE_TYPES,
  METHODS,
  genId,
  localizedTagName,
} from "@/lib/recipes/types";
import { useLabStore } from "@/lib/lab/store";
import { diffSpecs } from "@/lib/lab/diff";
import { LabSpec, LabVerdict } from "@/lib/lab/types";
import { useRecipeStore } from "@/lib/recipes/store";

/** 简单 chip 组(与配方表单一致的视觉) */
function ChipGroup({
  options,
  value,
  onChange,
  labelOf,
}: {
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
  labelOf?: (v: string) => string;
}) {
  const colors = useColors();
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(opt)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: active ? colors.primary : colors.surface,
                borderColor: active ? colors.primary : colors.border,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              className="text-sm"
              style={{ color: active ? "#FFFFFF" : colors.foreground, lineHeight: 18 }}
            >
              {labelOf ? labelOf(opt) : opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function LabBatchFormScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const params = useLocalSearchParams<{ projectId: string; batchId?: string }>();
  const { getProject, batchesOf, addBatch, updateBatch } = useLabStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const { tagsOf } = useRecipeStore();

  const project = getProject(params.projectId);
  const batches = batchesOf(params.projectId);
  const editing = params.batchId ? batches.find((b) => b.id === params.batchId) : undefined;
  /** 新批次:以最新批次为底稿复制;编辑:以该批次为准 */
  const prevBatch = editing
    ? batches[batches.findIndex((b) => b.id === editing.id) - 1]
    : batches[batches.length - 1];
  const baseSpec: LabSpec | null = editing
    ? editing.spec
    : prevBatch
      ? prevBatch.spec
      : null;

  const seq = editing ? editing.seq : batches.length + 1;

  const [ingredients, setIngredients] = useState(
    baseSpec && baseSpec.ingredients.length > 0
      ? baseSpec.ingredients.map((i) => (editing ? i : { ...i, id: genId() }))
      : [{ id: genId(), name: "", amount: "" }],
  );
  const [method, setMethod] = useState(baseSpec?.method ?? "");
  const [glass, setGlass] = useState(baseSpec?.glass ?? "");
  const [ice, setIce] = useState(baseSpec?.ice ?? "");
  const [garnish, setGarnish] = useState(baseSpec?.garnish ?? "");
  const [tastingNote, setTastingNote] = useState(editing?.tastingNote ?? "");
  const [score, setScore] = useState<number | null>(editing?.score ?? null);
  const [verdict, setVerdict] = useState<LabVerdict>(editing?.verdict ?? "");
  const [focusedIng, setFocusedIng] = useState<string | null>(null);
  const [pickedIng, setPickedIng] = useState<Record<string, string>>({});

  const glassTags = tagsOf("glass");

  const spec: LabSpec = useMemo(
    () => ({ ingredients, method, glass, ice, garnish }),
    [ingredients, method, glass, ice, garnish],
  );

  /** 相对上一版的实时差异预览 */
  const liveChanges = useMemo(() => {
    const against = editing ? prevBatch?.spec : prevBatch?.spec;
    if (!against) return [];
    return diffSpecs(against, spec);
  }, [editing, prevBatch, spec]);

  const abvEstimate = useMemo(
    () => estimateRecipeAbv(ingredients, method, bottles, preps),
    [ingredients, method, bottles, preps],
  );
  const costEstimate = useMemo(
    () => estimateRecipeCostSmart(ingredients, bottles, preps),
    [ingredients, bottles, preps],
  );
  const formula = useMemo(
    () => structuralFormula(ingredients, lang as "zh" | "en", formatAmountAsMl),
    [ingredients, lang],
  );

  const updateIngredient = (iid: string, field: "name" | "amount", value: string) => {
    setIngredients((prev) => prev.map((i) => (i.id === iid ? { ...i, [field]: value } : i)));
  };
  const pickSuggestion = (iid: string, value: string) => {
    updateIngredient(iid, "name", value);
    setPickedIng((prev) => ({ ...prev, [iid]: value }));
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };
  const addIngredientRow = () => {
    setIngredients((prev) => [...prev, { id: genId(), name: "", amount: "" }]);
  };
  const removeIngredientRow = (iid: string) => {
    setIngredients((prev) => (prev.length > 1 ? prev.filter((i) => i.id !== iid) : prev));
  };

  const handleSave = () => {
    const filled = ingredients.filter((i) => i.name.trim());
    if (filled.length === 0) {
      Alert.alert(t("lab.batch.needIngredient"));
      return;
    }
    const cleanSpec: LabSpec = { ...spec, ingredients: filled };
    if (editing) {
      updateBatch(editing.id, { spec: cleanSpec, tastingNote: tastingNote.trim(), score, verdict });
    } else if (project) {
      addBatch(project.id, {
        spec: cleanSpec,
        tastingNote: tastingNote.trim(),
        score,
        verdict,
      });
    }
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    router.back();
  };

  if (!project) {
    return (
      <ScreenContainer className="items-center justify-center">
        <Text className="text-base text-muted">{t("detail.notFound")}</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View className="px-5 pt-2 pb-2 flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <Text className="text-base" style={{ color: colors.primary, lineHeight: 22 }}>
              {t("common.cancel")}
            </Text>
          </Pressable>
          <Text className="text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
            {editing
              ? t("lab.batch.title.edit", { n: seq })
              : t("lab.batch.title.new", { n: seq })}
          </Text>
          <Pressable onPress={handleSave} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <Text className="text-base font-semibold" style={{ color: colors.primary, lineHeight: 22 }}>
              {t("common.save")}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* 复制底稿提示 + 实时差异预览 */}
          {!editing && prevBatch ? (
            <View
              className="rounded-xl px-3.5 py-3 mt-1 mb-1"
              style={{ backgroundColor: colors.primary + "10" }}
            >
              <Text className="text-xs" style={{ color: colors.primary, lineHeight: 17 }}>
                {t("lab.batch.copiedFrom", { n: prevBatch.seq })}
              </Text>
            </View>
          ) : null}
          {prevBatch && (editing ? prevBatch : true) ? (
            <View className="mt-2">
              <LabChangeChips changes={liveChanges} isBaseline={!prevBatch} />
              {liveChanges.length >= 2 ? (
                <View className="flex-row items-center mt-1.5" style={{ gap: 4 }}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={12} color="#F59E0B" />
                  <Text className="text-xs" style={{ color: "#F59E0B", lineHeight: 16, flex: 1 }}>
                    {t("lab.multiVarHint", { n: liveChanges.length })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* 配料(带智能链接/建议/自制自动创建) */}
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
                  <Pressable
                    onPress={() => router.push({ pathname: "/homemade/[id]", params: { id: prep.id } })}
                    style={({ pressed }) => [styles.prepHint, pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol name="sparkles" size={12} color={colors.primary} />
                    <Text className="text-xs" style={{ color: colors.primary, lineHeight: 16 }}>
                      {t("form.homemade.matched", { name: displayNames(prep.name, prep.nameAlt, lang).primary })}
                    </Text>
                    <IconSymbol name="chevron.right" size={11} color={colors.primary} />
                  </Pressable>
                ) : linkedBottle ? (
                  <Pressable
                    onPress={() => router.push({ pathname: "/bottle/[id]", params: { id: linkedBottle.id } })}
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
            <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
            <Text className="text-sm" style={{ color: colors.primary, lineHeight: 20 }}>
              {t("form.addIngredient")}
            </Text>
          </Pressable>

          {/* 方法 / 冰 / 杯型 / 装饰 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.method")}</Text>
          <ChipGroup
            options={METHODS}
            value={method}
            onChange={(v) => setMethod(v === method ? "" : v)}
            labelOf={(v) => localizedTagName(v, "", lang)}
          />
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.ice")}</Text>
          <ChipGroup
            options={ICE_TYPES}
            value={ice}
            onChange={(v) => setIce(v === ice ? "" : v)}
            labelOf={(v) => localizedTagName(v, "", lang)}
          />
          {glassTags.length > 0 ? (
            <>
              <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.glass")}</Text>
              <ChipGroup
                options={glassTags.map((tg) => tg.name)}
                value={glass}
                onChange={(v) => setGlass(v === glass ? "" : v)}
                labelOf={(v) => {
                  const tag = glassTags.find((tg) => tg.name === v);
                  return localizedTagName(v, tag?.nameEn, lang);
                }}
              />
            </>
          ) : null}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("form.garnish")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
            placeholder={t("form.garnish.placeholder")}
            placeholderTextColor={colors.muted}
            value={garnish}
            onChangeText={setGarnish}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />

          {/* 自动指标 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("lab.metrics")}</Text>
          <View className="bg-surface border border-border rounded-xl px-3.5 py-3" style={{ gap: 6 }}>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="text-xs text-muted" style={{ width: 76, lineHeight: 17 }}>
                {t("lab.metric.abv")}
              </Text>
              <Text className="text-sm text-foreground" style={{ lineHeight: 19 }}>
                {abvEstimate.abv !== null ? `≈${abvEstimate.abv}% ABV` : "—"}
              </Text>
            </View>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="text-xs text-muted" style={{ width: 76, lineHeight: 17 }}>
                {t("lab.metric.cost")}
              </Text>
              <Text className="text-sm text-foreground" style={{ lineHeight: 19 }}>
                {costEstimate.estimatedCount > 0 ? `≈¥${costEstimate.total.toFixed(1)}` : "—"}
              </Text>
            </View>
            <View className="flex-row" style={{ gap: 8 }}>
              <Text className="text-xs text-muted" style={{ width: 76, lineHeight: 17 }}>
                {t("lab.metric.structure")}
              </Text>
              <Text className="text-sm text-foreground" style={{ lineHeight: 19, flex: 1 }}>
                {formula || "—"}
              </Text>
            </View>
          </View>

          {/* 品鉴笔记 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("lab.batch.tasting")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
            placeholder={t("lab.batch.tasting.ph")}
            placeholderTextColor={colors.muted}
            value={tastingNote}
            onChangeText={setTastingNote}
            multiline
            style={{ lineHeight: 20, minHeight: 88, textAlignVertical: "top" }}
          />

          {/* 评分 1-10 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("lab.batch.score")}</Text>
          <View className="flex-row flex-wrap" style={{ gap: 6 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
              const active = score !== null && n <= score;
              return (
                <Pressable
                  key={n}
                  onPress={() => {
                    setScore(score === n ? null : n);
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  hitSlop={4}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol
                    name={active ? "star.fill" : "star"}
                    size={26}
                    color={active ? "#F59E0B" : colors.border}
                  />
                </Pressable>
              );
            })}
            {score !== null ? (
              <Text className="text-base font-semibold text-foreground ml-1" style={{ lineHeight: 28 }}>
                {score}
              </Text>
            ) : null}
          </View>

          {/* 结论 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("lab.batch.verdict")}</Text>
          <View className="flex-row" style={{ gap: 8 }}>
            {(["keeper", "iterate", "reject"] as const).map((v) => {
              const meta = {
                keeper: { color: "#22C55E", icon: "checkmark.circle.fill" as const },
                iterate: { color: "#3B82F6", icon: "arrow.triangle.2.circlepath" as const },
                reject: { color: "#EF4444", icon: "xmark.circle.fill" as const },
              }[v];
              const active = verdict === v;
              return (
                <Pressable
                  key={v}
                  onPress={() => setVerdict(active ? "" : v)}
                  style={({ pressed }) => [
                    styles.verdictBtn,
                    {
                      backgroundColor: active ? meta.color + "1A" : colors.surface,
                      borderColor: active ? meta.color : colors.border,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <IconSymbol name={meta.icon} size={15} color={active ? meta.color : colors.muted} />
                  <Text
                    className="text-sm font-medium"
                    style={{ color: active ? meta.color : colors.muted, lineHeight: 18 }}
                  >
                    {t(`lab.verdict.${v}` as "lab.verdict.keeper")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  prepHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 5,
    marginLeft: 2,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  verdictBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
  },
});
