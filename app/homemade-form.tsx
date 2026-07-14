import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { SmartImportBar } from "@/components/smart-import-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { enrichHomemade } from "@/lib/api/smart-router";
import { useNetwork } from "@/hooks/use-network";
import { useHomemadeStore } from "@/lib/homemade/store";
import {
  PREP_GROUPS,
  guessPrepType,
  joinPrepIngredient,
  prepGroupOfSection,
  splitPrepIngredientLine,
} from "@/lib/homemade/types";
import { useBottleStore } from "@/lib/bottles/store";
import { suggestIngredients } from "@/lib/suggest";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { smartLinkIngredient, smartLinkDisplayName } from "@/lib/recipes/smart-link";
import { genId } from "@/lib/recipes/types";

interface IngRow {
  id: string;
  name: string;
  amount: string;
  linkedBottleId?: string;
  linkedPrepId?: string;
}

function toRows(lines: string[]): IngRow[] {
  const rows = lines.map((line) => {
    const { amount, name } = splitPrepIngredientLine(line);
    return { id: genId(), name, amount };
  });
  return rows.length > 0 ? rows : [{ id: genId(), name: "", amount: "" }];
}

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
  const { getPrep, addPrep, updatePrep, sections, types: typeList, preps: allPreps } = useHomemadeStore();
  const { bottles } = useBottleStore();
  const { groupOf } = useBottleTaxonomy();
  const editing = getPrep(id);

  const [name, setName] = useState(editing?.name ?? prefillName ?? "");
  const [nameAlt, setNameAlt] = useState(editing?.nameAlt ?? prefillNameAlt ?? "");
  const [type, setType] = useState(
    editing?.type ?? (prefillType && typeList.some((p) => p.key === prefillType) ? prefillType : "syrup"),
  );
  const [ingRows, setIngRows] = useState<IngRow[]>(() => toRows(editing?.ingredients ?? []));
  /** Which ingredient row is focused (shows live suggestions) */
  const [focusedIng, setFocusedIng] = useState<string | null>(null);
  /** Rows where user picked a suggestion — suppress dropdown until text changes */
  const [pickedIng, setPickedIng] = useState<Record<string, string>>({});
  // Pre-fill dismissed for existing ingredients when editing
  const [dismissedLinks, setDismissedLinks] = useState<Record<string, boolean>>(() => {
    if (!editing?.ingredients?.length) return {};
    const rows = toRows(editing.ingredients);
    return Object.fromEntries(rows.map((r) => [r.id, true]));
  });
  const [acceptedLinks, setAcceptedLinks] = useState<Record<string, boolean>>({});
  const [recipe, setRecipe] = useState(editing?.recipe ?? "");
  const [yieldStr, setYieldStr] = useState(editing?.yield ?? "");
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

  const canSave = useMemo(() => name.trim().length > 0, [name]);

  // ── AI 补全 ──────────────────────────────────────────────────────────
  const { isOnline } = useNetwork();
  
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const handleAiEnrich = async () => {
    const displayName = [name.trim(), nameAlt.trim()].filter(Boolean).join(" / ");
    if (!displayName) {
      setAiStatus({ kind: "err", msg: lang === "en" ? "Please enter a name first" : "请先输入名称" });
      return;
    }
    if (!isOnline) {
      setAiStatus({ kind: "err", msg: lang === "en" ? "Offline: AI requires internet connection" : "当前离线，AI 补全需要网络连接" });
      return;
    }
    setAiBusy(true);
    setAiStatus(null);
    try {
      const res = await enrichHomemade({
        name: name.trim(),
        nameAlt: nameAlt.trim() || undefined,
        type: type || undefined,
        ingredients: ingRows.map((r) => r.name).filter(Boolean),
        lang: lang as 'zh' | 'en',
      });
      if (res.prepType && res.prepType !== "other" && !typeTouched) {
        const matched = typeList.find((t) => t.key === res.prepType);
        if (matched) { setType(res.prepType); setTypeTouched(true); }
      }
      if (res.techniques.length > 0 && techniques.length === 0) setTechniques(res.techniques);
      if (res.flavorTags.length > 0 && flavorTags.length === 0) setFlavorTags(res.flavorTags);
      if (!story.trim() && res.story) setStory(res.story);
      if (!styleDesc.trim() && res.styleDesc) setStyleDesc(res.styleDesc);
      if (!shelfLife.trim() && res.shelfLife) setShelfLife(res.shelfLife);
      if (!storage.trim() && res.storage) setStorage(res.storage);
      if (!usageNotes.trim() && res.usageNotes) setUsageNotes(res.usageNotes);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAiStatus({ kind: "ok", msg: lang === "en" ? "AI filled in fields" : "AI 已补全字段" });
    } catch {
      setAiStatus({ kind: "err", msg: lang === "en" ? "AI analysis failed" : "AI 分析失败，请重试" });
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
    }
  };
  const pickSuggestion = (rid: string, value: string) => {
    updateIngRow(rid, "name", value);
    setPickedIng((prev) => ({ ...prev, [rid]: value }));
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
  };

  const handleSave = () => {
    if (!canSave) return;
    const ingredients = ingRows
      .map((r) => joinPrepIngredient(r.amount, r.name))
      .filter(Boolean);
    const payload = {
      name: name.trim(),
      nameAlt: nameAlt.trim(),
      type,
      ingredients,
      recipe: recipe.trim(),
      yield: yieldStr.trim(),
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
    <Text className="text-[13px] font-medium text-muted mt-4 mb-1.5">{label}</Text>
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

        <ScrollView
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
                if (item.prepRecipe) setRecipe(item.prepRecipe);
                if (item.prepYield) setYieldStr(item.prepYield);
                if (item.shelfLife) setShelfLife(item.shelfLife);
                if (item.storage) setStorage(item.storage);
                if (item.source) setSource(item.source);
                if (item.notes) setNotes(item.notes);
              }}
            />
          )}
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
                : (lang === "en" ? "AI Auto-fill" : "AI 自动补全")}
            </Text>
          </Pressable>
          {aiStatus && (
            <Text style={{ fontSize: 12, textAlign: "center", marginBottom: 4, color: aiStatus.kind === "ok" ? colors.success : colors.error }}>
              {aiStatus.msg}
            </Text>
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

          {fieldLabel(t("hmform.type"))}
          {PREP_GROUPS.map((grp) => {
            const groupSections = sections.filter(
              (sec) => prepGroupOfSection(sections, sec.key) === grp.key,
            );
            const hasAny = groupSections.some((sec) =>
              typeList.some((pt) => pt.section === sec.key),
            );
            if (!hasAny) return null;
            return (
              <View key={grp.key} style={{ marginBottom: 10 }}>
                <View className="flex-row items-center mb-1.5" style={{ gap: 6 }}>
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: grp.key === "alcoholic" ? colors.warning : colors.success,
                    }}
                  />
                  <Text className="text-[13px] font-semibold text-foreground" style={{ lineHeight: 18 }}>
                    {lang === "en" ? grp.en : grp.zh}
                  </Text>
                </View>
                {groupSections.map((sec) => {
                  const types = typeList.filter((pt) => pt.section === sec.key);
                  if (types.length === 0) return null;
                  return (
                    <View key={sec.key} style={{ marginBottom: 6 }}>
                      <Text
                        className="text-xs text-muted mb-1.5"
                        style={{ lineHeight: 16 }}
                      >
                        {lang === "en" ? sec.en : sec.zh}
                      </Text>
                      <View style={styles.chipWrap}>
                        {types.map((pt) => {
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
                              <Text
                                style={[
                                  styles.chipText,
                                  { color: active ? "#FFFFFF" : colors.foreground },
                                ]}
                              >
                                {lang === "en" ? pt.en : pt.zh}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            );
          })}

          {fieldLabel(t("hmform.ingredients"))}
          {ingRows.map((row) => {
            const trimmed = row.name.trim();
            const showSuggest =
              focusedIng === row.id && trimmed.length > 0 && pickedIng[row.id] !== row.name;
            const liveSuggestions = showSuggest
              ? suggestIngredients(trimmed, bottles, allPreps.filter((p) => p.id !== (editing?.id ?? "")), lang, 6, groupOf).filter((s) => s.value !== trimmed)
              : [];
            const rawLink = trimmed.length >= 2
              ? smartLinkIngredient(trimmed, bottles, allPreps.filter((p) => p.id !== (editing?.id ?? "")))
              : null;
            const isFuzzy = rawLink?.matchConfidence === "fuzzy";
            const link = isFuzzy
              ? dismissedLinks[row.id]
                ? null
                : acceptedLinks[row.id]
                  ? rawLink
                  : null
              : rawLink;
            const pendingFuzzyLink = isFuzzy && !dismissedLinks[row.id] && !acceptedLinks[row.id] ? rawLink : null;
            return (
              <View key={row.id} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                 <TextInput
                   style={[...inputStyle, { flex: 3 }]}
                   placeholder={t("hmform.ingredient.name")}
                   placeholderTextColor={colors.muted}
                   value={row.name}
                   onChangeText={(v) => updateIngRow(row.id, "name", v)}
                   onFocus={() => setFocusedIng(row.id)}
                   onBlur={() => {
                     // Delay so suggestion taps register before the list hides
                     setTimeout(() => {
                       setFocusedIng((cur) => (cur === row.id ? null : cur));
                     }, 150);
                   }}
                   returnKeyType="done"
                   autoCapitalize="words"
                 />
                  <TextInput
                    style={[...inputStyle, { flex: 2 }]}
                    placeholder={t("hmform.ingredient.amount")}
                    placeholderTextColor={colors.muted}
                    value={row.amount}
                    onChangeText={(v) => updateIngRow(row.id, "amount", v)}
                    returnKeyType="done"
                  />
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
                        onPress={() => pickSuggestion(row.id, s.value)}
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
                ) : null}
              </View>
            );
          })}
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

          {fieldLabel(t("hmform.recipe"))}
          <TextInput
            style={[...inputStyle, styles.multiline]}
            value={recipe}
            onChangeText={setRecipe}
            placeholder={
              lang === "en"
                ? "Method steps…"
                : "做法步骤…"
            }
            placeholderTextColor={colors.muted}
            multiline
          />

          {fieldLabel(t("hmform.yield"))}
          <TextInput
            style={inputStyle}
            value={yieldStr}
            onChangeText={setYieldStr}
            placeholder={lang === "en" ? "e.g. ~300ml" : "如:约300ml"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />

          {fieldLabel(t("hmform.shelfLife"))}
          <TextInput
            style={inputStyle}
            value={shelfLife}
            onChangeText={setShelfLife}
            placeholder={lang === "en" ? "e.g. 2 weeks refrigerated" : "如:冷藏2周"}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
          />

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
          <TextInput
            style={[...inputStyle, styles.multiline, { minHeight: 60 }]}
            value={notes}
            onChangeText={setNotes}
            placeholder={lang === "en" ? "Usage notes, related cocktails…" : "用途、相关鸡尾酒…"}
            placeholderTextColor={colors.muted}
            multiline
          />
          {(story || styleDesc || usageNotes) ? (
            <>
              {story ? (
                <>
                  {fieldLabel(lang === "en" ? "Story / Introduction" : "介绍/故事")}
                  <TextInput
                    style={[...inputStyle, styles.multiline, { minHeight: 60 }]}
                    value={story}
                    onChangeText={setStory}
                    multiline
                    placeholderTextColor={colors.muted}
                  />
                </>
              ) : null}
              {styleDesc ? (
                <>
                  {fieldLabel(lang === "en" ? "Style / Taste" : "风格/口感")}
                  <TextInput
                    style={inputStyle}
                    value={styleDesc}
                    onChangeText={setStyleDesc}
                    placeholderTextColor={colors.muted}
                    returnKeyType="done"
                  />
                </>
              ) : null}
              {usageNotes ? (
                <>
                  {fieldLabel(lang === "en" ? "Usage Notes" : "调酒用途")}
                  <TextInput
                    style={inputStyle}
                    value={usageNotes}
                    onChangeText={setUsageNotes}
                    placeholderTextColor={colors.muted}
                    returnKeyType="done"
                  />
                </>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
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
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
});
