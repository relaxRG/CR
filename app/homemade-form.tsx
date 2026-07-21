import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { suggestIngredients } from "@/lib/suggest";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { BOTTLE_GROUPS, BottleGroupKey, categoriesOfGroup } from "@/lib/bottles/types";
import { smartLinkIngredient, smartLinkDisplayName } from "@/lib/recipes/smart-link";
import { genId, FLAVOR_TAGS } from "@/lib/recipes/types";
import { useRecipeStore } from "@/lib/recipes/store";

interface IngRow {
  id: string;
  name: string;
  amount: string;
  linkedBottleId?: string;
  linkedPrepId?: string;
}

type PrepIngItem = { name: string; amount: string } | string;
function toRows(items: PrepIngItem[]): IngRow[] {
  const rows = items.map((item) => {
    if (typeof item === "string") {
      const { amount, name } = splitPrepIngredientLine(item);
      return { id: genId(), name, amount };
    }
    return { id: genId(), name: item.name, amount: item.amount };
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
  const { getPrep, addPrep, updatePrep, deletePrep, sections, types: typeList, preps: allPreps } = useHomemadeStore();
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
  const [ingRows, setIngRows] = useState<IngRow[]>(() => toRows(editing?.ingredients ?? []));
  /** Which ingredient row is focused (shows live suggestions) */
  const [focusedIng, setFocusedIng] = useState<string | null>(null);
  const pressingIngSuggestRef = useRef(false);
  /** Rows where user picked a suggestion — suppress dropdown until text changes */
  const [pickedIng, setPickedIng] = useState<Record<string, string>>({});
  // Pre-fill dismissed for existing ingredients when editing
  const [dismissedLinks, setDismissedLinks] = useState<Record<string, boolean>>(() => {
    if (!editing?.ingredients?.length) return {};
    const rows = toRows(editing.ingredients as PrepIngItem[]);
    return Object.fromEntries(rows.map((r) => [r.id, true]));
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

  // ── AI 补全 ──────────────────────────────────────────────────────────
  const { isOnline } = useNetwork();
  
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [aiLibrarySuggestion, setAiLibrarySuggestion] = useState<{ library: "spirits" | "bottles" | "materials"; category: string; style: string } | null>(null);

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
        ingredients: ingRows.filter((r) => r.name.trim()),
        lang: lang as 'zh' | 'en',
      });
      if (res.prepType && res.prepType !== "other" && !typeTouched) {
        const matched = typeList.find((t) => t.key === res.prepType);
        if (matched) { setType(res.prepType); setTypeTouched(true); }
      }
      // ── 语义映射：自动预填所属库 ──────────────────────────────────────
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
      if (res.techniques.length > 0 && techniques.length === 0) setTechniques(res.techniques);
      if (res.flavorTags.length > 0 && flavorTags.length === 0) setFlavorTags(res.flavorTags);
      if (!story.trim() && res.story) setStory(res.story);
      if (!styleDesc.trim() && res.styleDesc) setStyleDesc(res.styleDesc);
      if (!shelfLife.trim() && res.shelfLife) setShelfLife(res.shelfLife);
      if (!storage.trim() && res.storage) setStorage(res.storage);
      if (!usageNotes.trim() && res.usageNotes) setUsageNotes(res.usageNotes);
      // ── 新增全字段回填 ────────────────────────────────────────────────────
      // 中英文名称：仅在对应字段为空时回填
      if (!name.trim() && res.nameZh) setName(res.nameZh);
      if (!nameAlt.trim() && res.nameEn) setNameAlt(res.nameEn);
      // 制作步骤：仅在步骤为空时回填（将换行分割为步骤行）
      if (stepRows.every((r) => !r.text.trim()) && res.steps) {
        const lines = res.steps.split("\n").map((l) => l.replace(/^\d+\.?\s*/, "").trim()).filter(Boolean);
        if (lines.length > 0) {
          setStepRows(lines.map((text) => ({ id: genId(), text })));
        }
      }
      // 产量：仅在产量为空时回填
      if (!yieldQty.trim() && res.yieldQty && res.yieldQty > 0) setYieldQty(String(res.yieldQty));
      if (!yieldUnit.trim() && res.yieldUnit) setYieldUnit(res.yieldUnit);
      // 装饰家族 key 和变体标签（仅装饰类）
      if (!sourceFamilyKey.trim() && res.sourceFamilyKey) setSourceFamilyKey(res.sourceFamilyKey);
      if (!variantLabel.trim() && res.variantLabel) setVariantLabel(res.variantLabel);
      // 原料：仅在原料列表为空时回填 AI 推断的结构化原料
      if (ingRows.every((r) => !r.name.trim()) && res.prepIngredients && res.prepIngredients.length > 0) {
        setIngRows(res.prepIngredients.map((ing) => ({ id: genId(), name: ing.name, amount: ing.amount })));
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // 统计回填字段数量，给用户明确反馈
      const filledFields = [res.story, res.styleDesc, res.shelfLife, res.storage, res.usageNotes, res.steps, res.yieldQty, res.sourceFamilyKey].filter(Boolean).length;
      setAiStatus({ kind: "ok", msg: lang === "en" ? `AI filled ${filledFields} fields` : `AI 已补全 ${filledFields} 个字段` });
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
      .map((r) => ({ name: r.name.trim(), amount: r.amount.trim() }));
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
                opt.key === "auto" ? libraryDest === "auto" && false :
                opt.key === "auto_alcoholic" ? libraryDest === "auto" && selectedGroup === "alcoholic" :
                opt.key === "auto_non_alcoholic" ? libraryDest === "auto" && selectedGroup === "non_alcoholic" :
                libraryDest === "auto" && selectedGroup === "garnish";
              const isAutoBtn = opt.key === "auto";
              const active = isAutoBtn ? false : isActive;
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
          {/* 实时成本预览 */}
          {(() => {
            const qty = parseFloat(yieldQty);
            const cost = parseFloat(normalBatchCost);
            if (qty > 0 && cost > 0 && yieldUnit) {
              const perUnit = cost / qty;
              const unitLabel = yieldUnit;
              const isLiquid = ["ml","L","oz","cl"].includes(yieldUnit);
              const isWeight = ["g","kg","斤"].includes(yieldUnit);
              let preview = `¥${perUnit.toFixed(4)}/${unitLabel}`;
              if (isLiquid && yieldUnit === "ml") preview += `  ·  ¥${(perUnit * 30).toFixed(3)}/30ml`;
              if (isWeight && yieldUnit === "g") preview += `  ·  ¥${(perUnit * 100).toFixed(3)}/100g`;
              return (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, paddingHorizontal: 4 }}>
                  <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
                  <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>{preview}</Text>
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
          {/* 批次总成本（所有分区均显示，装饰类也需要成本核算） */}
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

          {fieldLabel(t("hmform.shelfLife"))}
          {isGarnishType ? (
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
          {isGarnishType && (
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
import { YIELD_UNIT_PRESET_GROUPS } from "@/lib/units";
