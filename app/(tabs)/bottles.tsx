import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
import {
  applyEnrichedToBottle,
  enrichQueryName,
  matchEnrichedItem,
} from "@/lib/bottles/enrich";
import { trpc } from "@/lib/trpc";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { groupFormFamilies, type FormFamily } from "@/lib/bottles/form-family";
import { sortBottles, BOTTLE_SORTS, BottleSort } from "@/lib/recipes/sort";
import {
  BOTTLE_GROUPS,
  Bottle,
} from "@/lib/bottles/types";
import { useCardTagSettings } from "@/lib/settings/card-tags";

export default function BottlesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { ready, bottles, reorderBottles, deleteBottles, bulkUpdateBottles, updateBottle } =
    useBottleStore();
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

  const groupBottles = useMemo(
    () => bottles.filter((b) => groupOf(b.category) === group),
    [bottles, group, groupOf],
  );

  // 联网批量补全:当前分组内零价缺资料条目 → LLM 知识补全并更新入库(每次最多 24 条)
  // Prevent setState after unmount (batch AI may run async)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const enrichMutation = trpc.lookup.enrich.useMutation();
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichErrors, setEnrichErrors] = useState<string[]>([]);
  // 多选 AI 批量补全(补全 flavorTags/story/styleDesc)
  const enrichBottleMutation = trpc.lookup.enrichBottle.useMutation();
  const [enrichingSelected, setEnrichingSelected] = useState(false);
  const [enrichSelectedMsg, setEnrichSelectedMsg] = useState<string | null>(null);
  const [enrichSelectedProgress, setEnrichSelectedProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichSelectedErrors, setEnrichSelectedErrors] = useState<string[]>([]);
  const missingCount = useMemo(
    () => groupBottles.filter((b) => b.priceCny <= 0).length,
    [groupBottles],
  );
  const handleBatchEnrich = useCallback(async () => {
    if (enriching) return;
    const targets = groupBottles.filter((b) => b.priceCny <= 0).slice(0, 24);
    if (targets.length === 0) return;
    setEnriching(true);
    setEnrichMsg(null);
    setEnrichProgress({ done: 0, total: targets.length });
    setEnrichErrors([]);
    let updated = 0;
    const errors: string[] = [];
    try {
      for (let off = 0; off < targets.length; off += 8) {
        const batch = targets.slice(off, off + 8);
        const names = batch.map(enrichQueryName);
        try {
          const res = await enrichMutation.mutateAsync({ names });
          batch.forEach((b, i) => {
            const item = matchEnrichedItem(res.items, names, i);
            if (!item || !item.found) {
              errors.push(names[i] || b.nameEn || b.nameZh);
              return;
            }
            const draft = applyEnrichedToBottle(b, item);
            if (!draft) return;
            updateBottle(b.id, draft);
            updated++;
          });
        } catch (batchErr) {
          batch.forEach((b) => errors.push(b.nameEn || b.nameZh));
        }
        if (isMountedRef.current) setEnrichProgress({ done: Math.min(off + 8, targets.length), total: targets.length });
      }
      if (!isMountedRef.current) return;
      if (updated > 0 && Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setEnrichErrors(errors);
      setEnrichMsg(updated > 0 ? t("lookup.batchDone", { n: updated }) : t("lookup.enrichNone"));
    } catch {
      if (!isMountedRef.current) return;
      setEnrichMsg(
        updated > 0 ? t("lookup.batchDone", { n: updated }) : t("smartImport.fail.msg"),
      );
    } finally {
      if (isMountedRef.current) {
        setEnriching(false);
        setEnrichProgress(null);
      }
    }
  }, [enriching, groupBottles, enrichMutation, updateBottle, t]);

  const handleBatchEnrichSelected = useCallback(async () => {
    if (enrichingSelected || selectedIds.length === 0) return;
    const targets = bottles.filter((b) => selectedIds.includes(b.id)).slice(0, 20);
    if (targets.length === 0) return;
    setEnrichingSelected(true);
    setEnrichSelectedMsg(null);
    setEnrichSelectedProgress({ done: 0, total: targets.length });
    setEnrichSelectedErrors([]);
    let updated = 0;
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const b = targets[i];
      try {
        const res = await enrichBottleMutation.mutateAsync({
          nameZh: b.nameZh || undefined,
          nameEn: b.nameEn || undefined,
          category: b.category || undefined,
          style: b.style || undefined,
          brand: b.brand || undefined,
          origin: b.origin || undefined,
        });
        const patch: Partial<{ flavorTags: string[]; story: string; styleDesc: string }> = {};
        if (res.flavorTags && res.flavorTags.length > 0 && (!b.flavorTags || b.flavorTags.length === 0)) {
          patch.flavorTags = res.flavorTags;
        }
        if (res.story && !b.story?.trim()) patch.story = res.story;
        if (res.styleDesc && !b.styleDesc?.trim()) patch.styleDesc = res.styleDesc;
        if (Object.keys(patch).length > 0) {
          updateBottle(b.id, { ...b, ...patch } as Parameters<typeof updateBottle>[1]);
          updated++;
        }
      } catch {
        errors.push(b.nameZh || b.nameEn || `#${i + 1}`);
      }
      if (isMountedRef.current) setEnrichSelectedProgress({ done: i + 1, total: targets.length });
    }
    if (!isMountedRef.current) return;
    if (updated > 0 && Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setEnrichSelectedErrors(errors);
    setEnrichSelectedMsg(updated > 0 ? t("lookup.batchDone", { n: updated }) : t("lookup.enrichNone"));
    setEnrichingSelected(false);
    setEnrichSelectedProgress(null);
  }, [enrichingSelected, selectedIds, bottles, enrichBottleMutation, updateBottle, t]);

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
                      setEnrichMsg(null);
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

      {/* 联网补全:当前分组内零价缺资料条目一键补全 */}
      {!selectMode && ready && missingCount > 0 ? (
        <View className="px-5" style={{ marginTop: 8 }}>
          <Pressable
            onPress={handleBatchEnrich}
            disabled={enriching}
            style={({ pressed }) => [
              styles.enrichBanner,
              { backgroundColor: colors.primary + "10", borderWidth: 1, borderColor: colors.primary + "25" },
              (pressed || enriching) && { opacity: 0.6 },
            ]}
          >
            {enriching ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <IconSymbol name="globe" size={14} color={colors.primary} />
            )}
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
              {t("lookup.enrichMissing")} ({missingCount})
            </Text>
          </Pressable>
          {enrichProgress ? (
            <View className="mt-2 px-1" style={{ gap: 4 }}>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-muted">
                  {lang === "zh"
                    ? `正在补全 ${enrichProgress.done}/${enrichProgress.total}…`
                    : `Enriching ${enrichProgress.done}/${enrichProgress.total}…`}
                </Text>
              </View>
              <View
                className="rounded-full overflow-hidden"
                style={{ height: 4, backgroundColor: colors.border }}
              >
                <View
                  className="rounded-full"
                  style={{
                    height: 4,
                    backgroundColor: colors.primary,
                    width: `${Math.round((enrichProgress.done / enrichProgress.total) * 100)}%`,
                  }}
                />
              </View>
            </View>
          ) : enrichMsg ? (
            <View className="mt-1" style={{ gap: 3 }}>
              <Text className="text-xs text-muted text-center">{enrichMsg}</Text>
              {enrichErrors.length > 0 && (
                <Text className="text-xs text-center" style={{ color: colors.error, lineHeight: 16 }}>
                  {lang === "zh" ? "未识别: " : "Not found: "}
                  {enrichErrors.slice(0, 5).join(" · ")}
                  {enrichErrors.length > 5 ? ` +${enrichErrors.length - 5}` : ""}
                </Text>
              )}
            </View>
          ) : null}
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
                <View style={{ flex: 1 }} pointerEvents="none">
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
                label: enrichingSelected ? "…" : t("sel.aiEnrich"),
                icon: "globe",
                disabled: enrichingSelected || selectedIds.length === 0,
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
          {enrichingSelected && enrichSelectedProgress ? (
            <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>AI 补全中… {enrichSelectedProgress.done}/{enrichSelectedProgress.total}</Text>
            </View>
          ) : enrichSelectedMsg ? (
            <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 13, color: colors.foreground, flex: 1 }}>{enrichSelectedMsg}</Text>
              {enrichSelectedErrors.length > 0 && (
                <Text style={{ fontSize: 11, color: colors.warning }}>失败: {enrichSelectedErrors.slice(0, 3).join(", ")}{enrichSelectedErrors.length > 3 ? `…+${enrichSelectedErrors.length - 3}` : ""}</Text>
              )}
              <Pressable onPress={() => setEnrichSelectedMsg(null)} hitSlop={8}>
                <Text style={{ fontSize: 13, color: colors.primary }}>关闭</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </ScreenContainer>
  );
}

function BottleCard({
  bottle,
  isFirst,
  isLast,
}: {
  bottle: Bottle;
  isFirst: boolean;
  isLast: boolean;
}) {
  return <BottleCardInner bottle={bottle} isFirst={isFirst} isLast={isLast} />;
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
}: {
  bottle: Bottle;
  isFirst: boolean;
  isLast: boolean;
  badge?: React.ReactNode;
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
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      <View
        className="bg-surface px-4"
        style={[
          { paddingVertical: 13 },
          isFirst && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
          isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
        ]}
      >
        <View className="flex-row items-center">
          <View className="flex-1 pr-2">
            <View style={{ minHeight: 40, justifyContent: "center" }}>
              <Text className="text-[16px] font-semibold text-foreground" numberOfLines={1} style={{ lineHeight: 22 }}>
                {lang === "en" && bottle.nameEn ? bottle.nameEn : bottle.nameZh}
              </Text>
              <Text className="text-[12px] mt-0.5" style={{ color: "#8E8E93", lineHeight: 16 }} numberOfLines={1}>
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
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, lineHeight: 22 }}>¥{bottle.priceCny}</Text>
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
              marginLeft: 16,
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
