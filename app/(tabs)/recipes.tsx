import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import DraggableFlatList, {
  ScaleDecorator,
  RenderItemParams,
} from "react-native-draggable-flatlist";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecipeGroupCard } from "@/components/recipe-group-card";
import { RecipeCard } from "@/components/recipe-card";
import { SwipeableRecipeRow } from "@/components/swipeable-recipe-row";
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
import { displayNames } from "@/lib/utils";
import { filterRecipes } from "@/lib/recipes/search";
import { groupRecipesByName } from "@/lib/recipes/grouping";
import { sortRecipes, RECIPE_SORTS, RecipeSort } from "@/lib/recipes/sort";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useRecipeStore } from "@/lib/recipes/store";
import { trpc } from "@/lib/trpc";
import {
  CODEX_FAMILIES,
  BASE_SPIRITS,
  Recipe,
  STRENGTH_LABELS,
  STRENGTHS,
  codexFamilyLabel,
  localizedTagName,
} from "@/lib/recipes/types";
import { FLAVOR_TAGS, FLAVOR_TAG_EN } from "@/lib/recipes/types";
import { FLAVOR_TAG_DEFAULT_COLORS } from "@/lib/settings/card-tags";

type Filter = { type: "all" } | { type: "favorites" };

export function RecipesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n();
  const {
    ready,
    recipes,
    categories,
    importSamples,
    tagsOf,
    reorderRecipes,
    deleteRecipes,
    bulkUpdateRecipes,
    updateRecipe,
  } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const flavorTags = tagsOf("flavor");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>({ type: "all" });
  // 多选模式:批量删除/批量改分类/风味
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSheet, setBulkSheet] = useState<"category" | "flavor" | null>(null);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const enrichRecipeMutation = trpc.lookup.enrichRecipe.useMutation();
  const [enrichingRecipes, setEnrichingRecipes] = useState(false);
  const [enrichRecipeMsg, setEnrichRecipeMsg] = useState<string | null>(null);
  const [enrichRecipeProgress, setEnrichRecipeProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichRecipeErrors, setEnrichRecipeErrors] = useState<string[]>([]);
  // 快捷筛选(独立于 Filter 面板,持久化保留):分类 → 基酒子分类
  const [quickSel, setQuickSel] = usePersistedState<QuickSelection>("quick.recipes.v1", {});
  // Filter 面板多选筛选状态(与快捷筛选相互独立)
  const [selCategories, setSelCategories] = useState<string[]>([]);
  const [selCodex, setSelCodex] = useState<string[]>([]);
  const [selFlavors, setSelFlavors] = useState<string[]>([]);
  const [selStrengths, setSelStrengths] = useState<string[]>([]);
  const [selDurations, setSelDurations] = useState<string[]>([]);
  const [selOccasions, setSelOccasions] = useState<string[]>([]);
  const [selBaseSpirits, setSelBaseSpirits] = useState<string[]>([]);
  const [sort, setSort] = useState<RecipeSort>("default");
  const [sheetOpen, setSheetOpen] = useState(false);

  // 快捷筛选解析:选中的大分类(分类 id)与其下细化的基酒集合
  const quickCategoryIds = Object.keys(quickSel);
  const quickSpirits = useMemo(
    () => [...new Set(Object.values(quickSel).flat())],
    [quickSel],
  );

  const filtered = useMemo(
    () => {
      // 第一层:快捷筛选(与面板筛选独立,两者取交集生效)
      let base = filterRecipes(recipes, query, {
        favoritesOnly: filter.type === "favorites",
        categoryIds: quickCategoryIds.length > 0 ? quickCategoryIds : undefined,
        baseSpirits: quickSpirits.length > 0 ? quickSpirits : undefined,
      });
      // 第二层:Filter 面板多选
      base = filterRecipes(base, "", {
        categoryIds: selCategories.length > 0 ? selCategories : undefined,
        codexFamilies: selCodex.length > 0 ? selCodex : undefined,
        flavors: selFlavors.length > 0 ? selFlavors : undefined,
        strengths: selStrengths.length > 0 ? selStrengths : undefined,
        durations: selDurations.length > 0 ? selDurations : undefined,
        occasions: selOccasions.length > 0 ? selOccasions : undefined,
        baseSpirits: selBaseSpirits.length > 0 ? selBaseSpirits : undefined,
      });
      return base;
    },
    [recipes, query, filter, quickCategoryIds, quickSpirits, selCategories, selCodex, selFlavors, selStrengths, selDurations, selOccasions, selBaseSpirits],
  );

  /** 成本函数(排序用),与卡片口径一致 */
  const costOf = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (r: Recipe): number | null => {
      if (cache.has(r.id)) return cache.get(r.id)!;
      let v: number | null = null;
      if (r.ingredients.length > 0) {
        const est = estimateRecipeCostSmart(r.ingredients, bottles, preps);
        v = est.estimatedCount > 0 ? est.total : null;
      }
      cache.set(r.id, v);
      return v;
    };
  }, [bottles, preps]);

  /** 排序后再同名折叠 */
  const sorted = useMemo(
    () =>
      sortRecipes(filtered, sort, {
        costOf,
        nameOf: (r) => displayNames(r.nameEn, r.name, lang).primary,
      }),
    [filtered, sort, costOf, lang],
  );

  /** 同名折叠:同一鸡尾酒的多个版本折叠为一组 */
  const grouped = useMemo(() => groupRecipesByName(sorted), [sorted]);

  /** 手动排序模式:选择"手动排序"时列表切换为可长按拖拽 */
  const manualMode = sort === "manual";

  /** 拖拽结束:按新顺序持久化 sortIndex */
  const handleDragEnd = useCallback(
    ({ data }: { data: Recipe[] }) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      reorderRecipes(data.map((r) => r.id));
    },
    [reorderRecipes],
  );

  /** 拖拽行:整卡 + 右侧把手(长按把手或整行触发拖动) */
  const renderDragItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<Recipe>) => {
      const index = getIndex() ?? 0;
      return (
        <ScaleDecorator activeScale={1.02}>
          <View
            style={[
              styles.dragRow,
              isActive && { shadowOpacity: 0.15, shadowRadius: 10, elevation: 4 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <RecipeCard
                recipe={item}
                isFirst={index === 0}
                isLast={index === sorted.length - 1}
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

  /** 快捷筛选大分类:全部配方分类;子分类 = 该分类下库内出现过的基酒 */
  const quickParents: QuickParentOption[] = useMemo(
    () =>
      categories.map((cat) => {
        const present = new Set(
          recipes.filter((r) => r.categoryId === cat.id).map((r) => r.baseSpirit),
        );
        const children = BASE_SPIRITS.filter((s) => present.has(s)).map((s) => ({
          value: s,
          label: localizedTagName(s, "", lang),
        }));
        return {
          value: cat.id,
          label: displayNames(cat.nameEn ?? "", cat.name, lang).primary,
          color: cat.color,
          children,
        };
      }),
    [categories, recipes, lang],
  );

  /** 筛选面板维度定义 */
  const dimensions: FilterDimension[] = [
    {
      key: "category",
      title: t("fs.dim.category"),
      options: categories.map((c) => ({
        value: c.id,
        label: displayNames(c.nameEn ?? "", c.name, lang).primary,
        color: c.color,
      })),
      selected: selCategories,
      onToggle: (v) =>
        setSelCategories((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
    {
      key: "strength",
      title: t("fs.dim.strength"),
      options: STRENGTHS.map((s) => ({
        value: s,
        label: lang === "en" ? t(`strength.${s}` as "strength.light") : STRENGTH_LABELS[s],
      })),
      selected: selStrengths,
      onToggle: (v) =>
        setSelStrengths((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
    {
      key: "codex",
      title: t("fs.dim.codex"),
      options: CODEX_FAMILIES.map((f) => ({ value: f, label: codexFamilyLabel(f, lang) })),
      selected: selCodex,
      onToggle: (v) =>
        setSelCodex((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
    {
      key: "duration",
      title: t("fs.dim.duration"),
      options: tagsOf("duration").map((tag) => ({
        value: tag.name,
        label: displayNames(tag.nameEn ?? "", tag.name, lang).primary,
        color: tag.color,
      })),
      selected: selDurations,
      onToggle: (v) =>
        setSelDurations((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
    {
      key: "occasion",
      title: t("fs.dim.occasion"),
      options: tagsOf("occasion").map((tag) => ({
        value: tag.name,
        label: displayNames(tag.nameEn ?? "", tag.name, lang).primary,
        color: tag.color,
      })),
      selected: selOccasions,
      onToggle: (v) =>
        setSelOccasions((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
    {
      key: "flavor",
      title: t("fs.dim.flavor"),
      options: FLAVOR_TAGS.map((tag) => ({
        value: tag,
        label: lang === "en" ? (FLAVOR_TAG_EN[tag] ?? tag) : tag,
        color: FLAVOR_TAG_DEFAULT_COLORS[tag] ?? "#FF9500",
      })),
      selected: selFlavors,
      onToggle: (v) =>
        setSelFlavors((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
  ];

  const activeFilterCount =
    selCategories.length + selCodex.length + selFlavors.length + selStrengths.length +
    selDurations.length + selOccasions.length + selBaseSpirits.length;

  const clearAll = () => {
    setSelCategories([]);
    setSelCodex([]);
    setSelFlavors([]);
    setSelStrengths([]);
    setSelDurations([]);
    setSelOccasions([]);
    setSelBaseSpirits([]);
    setSort("default");
  };

  /** Called when a tag badge is tapped on a recipe card — adds to active filters */
  const handleTagPress = useCallback((type: string, value: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const toggle = <T extends string>(setter: React.Dispatch<React.SetStateAction<T[]>>, v: T) =>
      setter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
    if (type === "flavor") toggle(setSelFlavors, value);
    else if (type === "baseSpirit") toggle(setSelBaseSpirits, value);
    else if (type === "codexFamily") toggle(setSelCodex, value);
    else if (type === "strength") toggle(setSelStrengths, value);
    else if (type === "category") toggle(setSelCategories, value);
  }, []);

  const handleAdd = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push("/recipe-form");
  };

  /** 多选:当前列表可见的全部配方 id(按筛选结果) */
  const visibleIds = useMemo(() => sorted.map((r) => r.id), [sorted]);

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
      deleteRecipes(selectedIds);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      exitSelectMode();
    };
    if (Platform.OS === "web") {
      // web 端 Alert 不支持多按钮,直接用 confirm
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
  }, [selectedIds, deleteRecipes, exitSelectMode, t]);

  /** 批量修改分类/风味 */
  const handleBulkApply = useCallback(
    (keys: string[]) => {
      if (bulkSheet === "category") {
        bulkUpdateRecipes(selectedIds, { categoryId: keys[0] ?? null });
      } else if (bulkSheet === "flavor") {
        bulkUpdateRecipes(selectedIds, { flavors: keys });
      }
      setBulkSheet(null);
      exitSelectMode();
    },
    [bulkSheet, selectedIds, bulkUpdateRecipes, exitSelectMode],
  );

  const handleBatchEnrichSelected = useCallback(async () => {
    if (enrichingRecipes || selectedIds.length === 0) return;
    const targets = recipes.filter((r) => selectedIds.includes(r.id)).slice(0, 20);
    if (targets.length === 0) return;
    setEnrichingRecipes(true);
    setEnrichRecipeMsg(null);
    setEnrichRecipeProgress({ done: 0, total: targets.length });
    setEnrichRecipeErrors([]);
    let updated = 0;
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      try {
        const ingNames = (r.ingredients ?? []).map((ing) => ing.name).filter(Boolean);
        const res = await enrichRecipeMutation.mutateAsync({
          name: r.name,
          nameEn: r.nameEn || undefined,
          baseSpirit: r.baseSpirit || undefined,
          ingredients: ingNames.length > 0 ? ingNames : undefined,
          method: r.method || undefined,
          story: r.story || undefined,
          flavorDesc: r.flavorDesc || undefined,
        });
        const patch: Partial<{ story: string; flavorDesc: string; flavors: string[] }> = {};
        if (res.story && !r.story?.trim()) patch.story = res.story;
        if (res.flavorDesc && !r.flavorDesc?.trim()) patch.flavorDesc = res.flavorDesc;
        if (res.flavors && res.flavors.length > 0 && (!r.flavors || r.flavors.length === 0)) {
          patch.flavors = res.flavors;
        }
        if (Object.keys(patch).length > 0) {
          updateRecipe(r.id, { ...r, ...patch } as Parameters<typeof updateRecipe>[1]);
          updated++;
        }
      } catch {
        errors.push(r.name || r.nameEn || `#${i + 1}`);
      }
      if (isMountedRef.current) setEnrichRecipeProgress({ done: i + 1, total: targets.length });
    }
    if (!isMountedRef.current) return;
    if (updated > 0 && Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setEnrichRecipeErrors(errors);
    setEnrichRecipeMsg(updated > 0 ? t("lookup.batchDone", { n: updated }) : t("lookup.enrichNone"));
    setEnrichingRecipes(false);
    setEnrichRecipeProgress(null);
  }, [enrichingRecipes, selectedIds, recipes, enrichRecipeMutation, updateRecipe, t]);

  const chipStyle = (active: boolean) => [
    styles.chip,
    {
      backgroundColor: active ? colors.primary : colors.surface,
      borderColor: active ? colors.primary : colors.border,
    },
  ];

  const chipTextStyle = (active: boolean) => [
    styles.chipText,
    { color: active ? "#FFFFFF" : colors.muted },
  ];

  return (
    <ScreenContainer edges={[]}>
      {/* Search bar + multi-select button */}
      <View className="px-5 pt-2 pb-3" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }} className="flex-row items-center bg-surface border border-border rounded-xl px-3">
          <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
          <TextInput
            className="flex-1 py-2.5 px-2 text-base text-foreground"
            placeholder={t("home.search.placeholder")}
            placeholderTextColor={colors.muted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Filter chips */}
      {/* 快捷筛选:与 Filter 面板互不联动;大分类展开基酒子分类,状态持久保留 */}
      <QuickFilterChips
        parents={quickParents}
        selection={quickSel}
        onChange={setQuickSel}
        allLabel={t("home.filter.all")}
        leading={
          <>
            {/* 筛选与排序入口(仅反映面板自身状态) */}
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
            {/* 收藏快捷开关(独立于快捷分类选择) */}
            <Pressable
              style={chipStyle(filter.type === "favorites")}
              onPress={() =>
                setFilter((prev) =>
                  prev.type === "favorites" ? { type: "all" } : { type: "favorites" },
                )
              }
            >
              <Text style={chipTextStyle(filter.type === "favorites")}>
                {t("home.filter.favorites")}
              </Text>
            </Pressable>
          </>
        }
      />

      {/* 筛选与排序面板 */}
      <FilterSortSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        dimensions={dimensions}
        sortOptions={RECIPE_SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) }))}
        sortValue={sort}
        onSortChange={(v) => setSort(v as RecipeSort)}
        onClearAll={clearAll}
        resultCount={filtered.length}
      />

      {/* Recipe list */}
      {ready && recipes.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8" style={{ marginTop: -40 }}>
          <Text style={{ fontSize: 56, lineHeight: 72 }}>🍸</Text>
          <Text className="text-xl font-semibold text-foreground mt-3">{t("home.empty.title")}</Text>
          <Text className="text-sm text-muted text-center mt-2 leading-relaxed">
            {t("home.empty.desc")}
          </Text>
          <Pressable
            onPress={handleAdd}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: colors.primary },
              pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
            ]}
          >
            <Text style={styles.primaryBtnText}>{t("home.empty.add")}</Text>
          </Pressable>
          <Pressable
            onPress={importSamples}
            style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="sparkles" size={16} color={colors.primary} />
            <Text style={[styles.ghostBtnText, { color: colors.primary }]}>{t("home.empty.import")}</Text>
          </Pressable>
        </View>
      ) : manualMode ? (
        selectMode ? null : (
        <View style={{ flex: 1 }}>
          {/* 手动排序提示条 */}
          <View style={[styles.reorderHint, { backgroundColor: colors.primary + "14" }]}>
            <IconSymbol name="line.3.horizontal" size={14} color={colors.primary} />
            <Text style={[styles.reorderHintText, { color: colors.primary }]}>
              {t("reorder.enter")}
            </Text>
          </View>
          <DraggableFlatList
            data={sorted}
            keyExtractor={(r) => r.id}
            onDragEnd={handleDragEnd}
            renderItem={renderDragItem}
            activationDistance={Platform.OS === "web" ? 3 : 10}
            containerStyle={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingTop: 4,
              paddingBottom: 100 + insets.bottom,
            }}
            ListEmptyComponent={
              ready ? (
                <View className="items-center pt-16 px-8">
                  <Text className="text-base text-muted text-center">{t("home.noMatch")}</Text>
                </View>
              ) : null
            }
          />
        </View>
        )
      ) : selectMode ? null : (
        <FlatList
          data={grouped}
          keyExtractor={(g) => g.items[0].id}
          renderItem={({ item, index }) => (
            item.items.length > 1 ? (
              <RecipeGroupCard
                recipes={item.items}
                isFirst={index === 0}
                isLast={index === grouped.length - 1}
                onTagPress={handleTagPress}
              />
            ) : (
              <SwipeableRecipeRow
                recipe={item.items[0]}
                isFirst={index === 0}
                isLast={index === grouped.length - 1}
                onTagPress={handleTagPress}
              />
            )
          )}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: 100 + insets.bottom,
          }}
          ListEmptyComponent={
            ready ? (
              <View className="items-center pt-16 px-8">
                <Text className="text-base text-muted text-center">
                  {t("home.noMatch")}
                </Text>
              </View>
            ) : null
          }
        />
      )}

      {/* 多选模式:平铺列表 + 勾选行 */}
      {ready && recipes.length > 0 && selectMode ? (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.id}
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
                <View style={{ flex: 1 }} pointerEvents="none">
                  <RecipeCard
                    recipe={item}
                    isFirst={index === 0}
                    isLast={index === sorted.length - 1}
                  />
                </View>
              </Pressable>
            );
          }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: 160 + insets.bottom,
          }}
          ListEmptyComponent={
            <View className="items-center pt-16 px-8">
              <Text className="text-base text-muted text-center">{t("home.noMatch")}</Text>
            </View>
          }
        />
      ) : null}

      {/* Floating add button */}
      {!selectMode ? (
      <Pressable
        onPress={handleAdd}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: colors.primary, bottom: 24 },
          pressed && { transform: [{ scale: 0.95 }], opacity: 0.9 },
        ]}
      >
        <IconSymbol name="plus" size={28} color="#FFFFFF" />
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
                key: "compare",
                label: t("sel.compare"),
                icon: "rectangle.split.2x1",
                disabled: selectedIds.length < 2 || selectedIds.length > 6,
                onPress: () => {
                  if (selectedIds.length < 2 || selectedIds.length > 6) return;
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({
                    pathname: "/compare",
                    params: { type: "recipe", ids: selectedIds.join(",") },
                  });
                  exitSelectMode();
                },
              },
              {
                key: "category",
                label: t("sel.setCategory"),
                icon: "tag.fill",
                onPress: () => setBulkSheet("category"),
              },
              {
                key: "flavor",
                label: t("sel.setFlavor"),
                icon: "sparkles",
                onPress: () => setBulkSheet("flavor"),
              },
              {
                key: "aiEnrich",
                label: enrichingRecipes ? "…" : t("sel.aiEnrich"),
                icon: "globe",
                disabled: enrichingRecipes || selectedIds.length === 0,
                onPress: handleBatchEnrichSelected,
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
          {/* 批量修改弹层:分类单选/风味多选 */}
          <BulkEditSheet
            visible={bulkSheet !== null}
            title={
              bulkSheet === "category"
                ? `${t("sel.sheet.title")} · ${t("form.category")}`
                : `${t("sel.sheet.title")} · ${t("form.flavors")}`
            }
            options={
              bulkSheet === "category"
                ? categories.map((c) => ({
                    key: c.id,
                    label: displayNames(c.nameEn ?? "", c.name, lang).primary,
                    color: c.color,
                  }))
                : FLAVOR_TAGS.map((tag) => ({
                    key: tag,
                    label: lang === "en" ? (FLAVOR_TAG_EN[tag] ?? tag) : tag,
                    color: FLAVOR_TAG_DEFAULT_COLORS[tag] ?? "#FF9500",
                  }))
            }
            multi={bulkSheet === "flavor"}
            allowClear
            count={selectedIds.length}
            onApply={handleBulkApply}
            onClose={() => setBulkSheet(null)}
          />
          {enrichingRecipes && enrichRecipeProgress ? (
            <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>AI 补全中… {enrichRecipeProgress.done}/{enrichRecipeProgress.total}</Text>
            </View>
          ) : enrichRecipeMsg ? (
            <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>{enrichRecipeMsg}</Text>
              {enrichRecipeErrors.length > 0 && (
                <Text style={{ fontSize: 11, color: colors.warning }}>失败: {enrichRecipeErrors.slice(0, 3).join(", ")}{enrichRecipeErrors.length > 3 ? `…+${enrichRecipeErrors.length - 3}` : ""}</Text>
              )}
              <Pressable onPress={() => setEnrichRecipeMsg(null)} hitSlop={8}>
                <Text style={{ fontSize: 13, color: colors.primary }}>关闭</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  chipRowWrap: {
    marginBottom: 8,
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
  dragRow: {
    flexDirection: "row",
    alignItems: "stretch",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0,
    shadowRadius: 0,
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
  chipRow: {
    paddingHorizontal: 20,
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
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  divider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 4,
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
    elevation: 5,
  },
  primaryBtn: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  ghostBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
