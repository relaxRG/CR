import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
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
} from "react-native";
import { ActivityIndicator } from "react-native";
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
import { SwipeableRow } from "@/components/swipeable-row";
import { RatingSheet } from "@/components/rating-sheet";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useI18n } from "@/lib/i18n";
import { displayNames } from "@/lib/utils";
import { filterPreps, useHomemadeStore } from "@/lib/homemade/store";
import { useBottleStore } from "@/lib/bottles/store";
import { estimatePrepCost } from "@/lib/homemade/cost";
import { primaryTechnique, techniqueLabel, TECHNIQUES, detectPrepTechniques } from "@/lib/homemade/technique";
import { BASE_SPIRITS, detectPrepBaseSpirits } from "@/lib/homemade/base-spirit";
import { groupPrepsByName } from "@/lib/recipes/grouping";
import { sortPreps, PREP_SORTS, PrepSort } from "@/lib/recipes/sort";
import { Bottle } from "@/lib/bottles/types";
import { useCardTagSettings } from "@/lib/settings/card-tags";
import { trpc } from "@/lib/trpc";
import {
  HomemadePrep,
  PREP_GROUPS,
  PrepGroup,
  prepGroupOf,
  prepGroupOfSection,
  prepSectionLabelIn,
  prepSectionOfIn,
  prepTypeLabelIn,
} from "@/lib/homemade/types";

type ListRow =
  | { kind: "header"; key: string; sectionKey: string; count: number }
  | { kind: "item"; key: string; prep: HomemadePrep; isFirst: boolean; isLast: boolean }
  | { kind: "group"; key: string; preps: HomemadePrep[]; isFirst: boolean; isLast: boolean };

export default function HomemadeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, lang } = useI18n();
  const {
    ready,
    preps,
    importSamples,
    sections,
    types,
    reorderPreps,
    deletePreps,
    bulkUpdatePreps,
    updatePrep,
  } = useHomemadeStore();
  // 多选模式:批量删除/批量改类型
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSheet, setBulkSheet] = useState<"type" | null>(null);
  const { bottles } = useBottleStore();
  const [query, setQuery] = useState("");
  // 顶层分组:含酒精 / 无酒精(类似酒库的基酒库/酒款库/原材料库)
  const [group, setGroup] = usePersistedState<PrepGroup>("homemade.group.v1", "alcoholic");
  // 快捷筛选(独立于 Filter 面板,持久化保留):分区 → 类型子分类
  // 按分组各自独立存储,切组互不影响
  const [quickSelAlc, setQuickSelAlc] = usePersistedState<QuickSelection>(
    "quick.homemade.alc.v1",
    {},
  );
  const [quickSelNa, setQuickSelNa] = usePersistedState<QuickSelection>(
    "quick.homemade.na.v1",
    {},
  );
  const quickSel = group === "alcoholic" ? quickSelAlc : quickSelNa;
  const setQuickSel = group === "alcoholic" ? setQuickSelAlc : setQuickSelNa;
  // Filter 面板多选筛选状态(与快捷筛选相互独立)
  const [selTypes, setSelTypes] = useState<string[]>([]);
  const [selTechniques, setSelTechniques] = useState<string[]>([]);
  const [selBaseSpirits, setSelBaseSpirits] = useState<string[]>([]);
  const [sort, setSort] = useState<PrepSort>("default");
  const [sheetOpen, setSheetOpen] = useState(false);
  /** 已展开的同名组 key 集合 */
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // 快捷筛选解析:选中分区与其下细化的类型集合
  const quickSections = Object.keys(quickSel);
  // 虚拟父分类 key(非分区):基酒/工艺,单独解析
  const VIRTUAL_PARENTS = ["__base", "__tech"];
  const quickBaseSel = quickSel["__base"] ?? [];
  const quickTechSel = quickSel["__tech"] ?? [];
  const realQuickSections = quickSections.filter((k) => !VIRTUAL_PARENTS.includes(k));
  const quickTypes = useMemo(
    () =>
      [
        ...new Set(
          Object.entries(quickSel)
            .filter(([k]) => !VIRTUAL_PARENTS.includes(k))
            .flatMap(([, v]) => v),
        ),
      ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quickSel],
  );

  // 当前分组内的条目(智能归组:显式 abvGroup 优先,否则按类型→分区推断)
  const groupPreps = useMemo(
    () => preps.filter((p) => prepGroupOf(p, sections, types) === group),
    [preps, sections, types, group],
  );
  // Batch AI enrich for homemade preps
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);
  const enrichHomemadeMutation = trpc.lookup.enrichHomemade.useMutation();
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichErrors, setEnrichErrors] = useState<string[]>([]);
  // 多选 AI 批量补全(补全 notes/shelfLife/storage)
  const enrichSelectedMutation = trpc.lookup.enrichHomemade.useMutation();
  const [enrichingSelected, setEnrichingSelected] = useState(false);
  const [enrichSelectedMsg, setEnrichSelectedMsg] = useState<string | null>(null);
  const [enrichSelectedProgress, setEnrichSelectedProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichSelectedErrors, setEnrichSelectedErrors] = useState<string[]>([]);
  const missingCount = useMemo(
    () => groupPreps.filter((p) => !p.notes?.trim()).length,
    [groupPreps],
  );
  const handleBatchEnrich = useCallback(async () => {
    if (enriching) return;
    const targets = groupPreps.filter((p) => !p.notes?.trim()).slice(0, 20);
    if (targets.length === 0) return;
    setEnriching(true);
    setEnrichMsg(null);
    setEnrichProgress({ done: 0, total: targets.length });
    setEnrichErrors([]);
    let updated = 0;
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      try {
        const res = await enrichHomemadeMutation.mutateAsync({
          name: p.name,
          nameAlt: p.nameAlt || undefined,
          type: p.type || undefined,
          ingredients: p.ingredients?.length ? p.ingredients : undefined,
        });
        const patch: Partial<typeof p> = {};
        if (res.story && !p.notes?.trim()) patch.notes = res.story;
        if (res.shelfLife && !p.shelfLife?.trim()) patch.shelfLife = res.shelfLife;
        if (res.storage && !p.storage?.trim()) patch.storage = res.storage;
        if (Object.keys(patch).length > 0) {
          updatePrep(p.id, patch);
          updated++;
        }
      } catch {
        errors.push(p.name || p.nameAlt || `#${i + 1}`);
      }
      if (isMountedRef.current) setEnrichProgress({ done: i + 1, total: targets.length });
    }
    if (!isMountedRef.current) return;
    if (updated > 0 && Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setEnrichErrors(errors);
    setEnrichMsg(updated > 0 ? `已补全 ${updated} 条自制品` : "暂无需要补全的自制品");
    setEnriching(false);
    setEnrichProgress(null);
  }, [enriching, groupPreps, enrichHomemadeMutation, updatePrep]);

  const handleBatchEnrichSelected = useCallback(async () => {
    if (enrichingSelected || selectedIds.length === 0) return;
    const targets = preps.filter((p) => selectedIds.includes(p.id)).slice(0, 20);
    if (targets.length === 0) return;
    setEnrichingSelected(true);
    setEnrichSelectedMsg(null);
    setEnrichSelectedProgress({ done: 0, total: targets.length });
    setEnrichSelectedErrors([]);
    let updated = 0;
    const errors: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      try {
        const res = await enrichSelectedMutation.mutateAsync({
          name: p.name,
          nameAlt: p.nameAlt || undefined,
          type: p.type || undefined,
          ingredients: p.ingredients?.length ? p.ingredients : undefined,
        });
        const patch: Partial<typeof p> = {};
        if (res.story && !p.notes?.trim()) patch.notes = res.story;
        if (res.shelfLife && !p.shelfLife?.trim()) patch.shelfLife = res.shelfLife;
        if (res.storage && !p.storage?.trim()) patch.storage = res.storage;
        if (Object.keys(patch).length > 0) {
          updatePrep(p.id, patch);
          updated++;
        }
      } catch {
        errors.push(p.name || p.nameAlt || `#${i + 1}`);
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
  }, [enrichingSelected, selectedIds, preps, enrichSelectedMutation, updatePrep, t]);

  const filtered = useMemo(
    () => {
      let base = filterPreps(groupPreps, query, undefined, undefined, types);
      // 快捷筛选:分区(任一命中)+ 类型细化(与面板筛选取交集)
      if (realQuickSections.length > 0) {
        base = base.filter((p) => realQuickSections.includes(prepSectionOfIn(types, p.type)));
      }
      if (quickTypes.length > 0) base = base.filter((p) => quickTypes.includes(p.type));
      // 快捷筛选:基酒/工艺虚拟分类(选中父类无子项=有该维度识别结果即可)
      if (quickBaseSel.length > 0) {
        base = base.filter((p) => {
          const ks = detectPrepBaseSpirits(p);
          return quickBaseSel.some((k) => ks.includes(k));
        });
      } else if (quickSections.includes("__base")) {
        base = base.filter((p) => detectPrepBaseSpirits(p).length > 0);
      }
      if (quickTechSel.length > 0) {
        base = base.filter((p) => {
          const ks = detectPrepTechniques(p);
          return quickTechSel.some((k) => ks.includes(k));
        });
      } else if (quickSections.includes("__tech")) {
        base = base.filter((p) => detectPrepTechniques(p).length > 0);
      }
      if (selTypes.length > 0) base = base.filter((p) => selTypes.includes(p.type));
      if (selTechniques.length > 0) {
        base = base.filter((p) => {
          const tks = detectPrepTechniques(p);
          return selTechniques.some((k) => tks.includes(k));
        });
      }
      if (selBaseSpirits.length > 0) {
        base = base.filter((p) => {
          const ks = detectPrepBaseSpirits(p);
          return selBaseSpirits.some((k) => ks.includes(k));
        });
      }
      return base;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groupPreps, query, selTypes, quickSel, quickTypes, types, selTechniques, selBaseSpirits],
  );

  /** 成本函数(排序用):每 30ml 成本,退化为批次成本 */
  const costOf = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (p: HomemadePrep): number | null => {
      if (cache.has(p.id)) return cache.get(p.id)!;
      const est = estimatePrepCost(p, bottles);
      const v =
        est && est.estimatedCount > 0 ? (est.costPer30Ml ?? est.batchCost ?? null) : null;
      cache.set(p.id, v);
      return v;
    };
  }, [bottles]);

  /** 排序后的列表(排序作用于分区内分组前的条目) */
  const sorted = useMemo(
    () =>
      sortPreps(filtered, sort, {
        costOf,
        nameOf: (p) => displayNames(p.name, p.nameAlt, lang).primary,
      }),
    [filtered, sort, costOf, lang],
  );

  // 分区筛选:仅显示当前分组内实际存在的分区
  const usedSections = useMemo(() => {
    const present = new Set(groupPreps.map((p) => prepSectionOfIn(types, p.type)));
    return sections.filter(
      (s) => present.has(s.key) && prepGroupOfSection(sections, s.key) === group,
    );
  }, [groupPreps, sections, types, group]);

  // 类型选项(Filter 面板用):当前分组内存在的全部类型
  const usedTypes = useMemo(() => {
    const present = new Set(groupPreps.map((p) => p.type));
    return types.filter((pt) => present.has(pt.key));
  }, [groupPreps, types]);

  // 工艺筛选:仅显示当前分组内实际识别出的工艺(按 TECHNIQUES 声明顺序)
  const usedTechniques = useMemo(() => {
    const present = new Set<string>();
    for (const p of groupPreps) {
      for (const k of detectPrepTechniques(p)) present.add(k);
    }
    return TECHNIQUES.filter((tk) => present.has(tk.key));
  }, [groupPreps]);

  // 基酒筛选:仅含酒精分组显示,且仅列出库内实际识别出的基酒
  const usedBaseSpirits = useMemo(() => {
    if (group !== "alcoholic") return [];
    const present = new Set<string>();
    for (const p of groupPreps) {
      for (const k of detectPrepBaseSpirits(p)) present.add(k);
    }
    return BASE_SPIRITS.filter((s) => present.has(s.key));
  }, [groupPreps, group]);

  /** 快捷筛选大分类:分区;子分类 = 该分区下库内存在的类型 */
  const quickParents: QuickParentOption[] = useMemo(
    () => {
      const sectionParents = usedSections.map((s) => {
        const present = new Set(groupPreps.map((p) => p.type));
        const children = types
          .filter((pt) => pt.section === s.key && present.has(pt.key))
          .map((pt) => ({ value: pt.key, label: lang === "en" ? pt.en : pt.zh }));
        return {
          value: s.key,
          label: lang === "en" ? s.en : s.zh,
          children,
        };
      });
      if (group !== "alcoholic") return sectionParents;
      // 含酒精分组:前置「基酒」「工艺」两个虚拟父分类
      const virtualParents: QuickParentOption[] = [];
      if (usedBaseSpirits.length > 0) {
        virtualParents.push({
          value: "__base",
          label: t("fs.dim.baseSpirit"),
          children: usedBaseSpirits.map((s) => ({
            value: s.key,
            label: lang === "en" ? s.en : s.zh,
          })),
        });
      }
      if (usedTechniques.length > 0) {
        virtualParents.push({
          value: "__tech",
          label: t("fs.dim.technique"),
          children: usedTechniques.map((tk) => ({
            value: tk.key,
            label: lang === "en" ? tk.en : tk.zh,
          })),
        });
      }
      return [...virtualParents, ...sectionParents];
    },
    [usedSections, groupPreps, types, lang, group, usedBaseSpirits, usedTechniques, t],
  );

  /** 筛选面板维度定义:类型 + 工艺(分区保留在快捷 chip 行) */
  const dimensions: FilterDimension[] = [
    {
      key: "type",
      title: t("fs.dim.type"),
      options: usedTypes.map((pt) => ({
        value: pt.key,
        label: lang === "en" ? pt.en : pt.zh,
      })),
      selected: selTypes,
      onToggle: (v) =>
        setSelTypes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
    ...(group === "alcoholic" && usedBaseSpirits.length > 0
      ? [
          {
            key: "baseSpirit",
            title: t("fs.dim.baseSpirit"),
            options: usedBaseSpirits.map((s) => ({
              value: s.key,
              label: lang === "en" ? s.en : s.zh,
            })),
            selected: selBaseSpirits,
            onToggle: (v: string) =>
              setSelBaseSpirits((prev) =>
                prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
              ),
          } as FilterDimension,
        ]
      : []),
    {
      key: "technique",
      title: t("fs.dim.technique"),
      options: usedTechniques.map((tk) => ({
        value: tk.key,
        label: lang === "en" ? tk.en : tk.zh,
      })),
      selected: selTechniques,
      onToggle: (v) =>
        setSelTechniques((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])),
    },
  ];

  const activeFilterCount = selTypes.length + selTechniques.length + selBaseSpirits.length;

  const clearAll = () => {
    setSelTypes([]);
    setSelTechniques([]);
    setSelBaseSpirits([]);
    setSort("default");
  };

  /** 手动排序模式:平铺全部条目(不分区、不折叠),长按拖拽 */
  const manualMode = sort === "manual";

  const handleDragEnd = useCallback(
    ({ data }: { data: HomemadePrep[] }) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
      reorderPreps(data.map((p) => p.id));
    },
    [reorderPreps],
  );

  const renderDragItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<HomemadePrep>) => {
      const index = getIndex() ?? 0;
      return (
        <ScaleDecorator activeScale={1.02}>
          <View style={styles.dragRow}>
            <View style={{ flex: 1 }}>
              <PrepRowInner
                prep={item}
                isFirst={index === 0}
                isLast={index === sorted.length - 1}
                bottles={bottles}
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
    [colors, sorted.length, bottles],
  );

  // 按分区分组的行数据(分区标题 + 各分区内的 inset group)
  const rows = useMemo<ListRow[]>(() => {
    const out: ListRow[] = [];
    const groupSections = sections.filter(
      (s) => prepGroupOfSection(sections, s.key) === group,
    );
    for (const s of groupSections) {
      const items = sorted.filter((p) => prepSectionOfIn(types, p.type) === s.key);
      if (items.length === 0) continue;
      // 同名折叠:分区内同名自制品折叠为一组
      const groups = groupPrepsByName(items);
      out.push({ kind: "header", key: `h-${s.key}`, sectionKey: s.key, count: items.length });
      groups.forEach((g, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === groups.length - 1;
        if (g.items.length > 1) {
          out.push({
            kind: "group",
            key: `g-${s.key}-${g.key}`,
            preps: g.items,
            isFirst,
            isLast,
          });
        } else {
          out.push({ kind: "item", key: g.items[0].id, prep: g.items[0], isFirst, isLast });
        }
      });
    }
    // 分区归属与推断分组不一致的条目(如手动覆盖 abvGroup)兜底展示
    const shown = new Set(
      out.flatMap((r) =>
        r.kind === "item" ? [r.prep.id] : r.kind === "group" ? r.preps.map((p) => p.id) : [],
      ),
    );
    const rest = sorted.filter((p) => !shown.has(p.id));
    if (rest.length > 0) {
      out.push({ kind: "header", key: "h-__rest", sectionKey: "misc", count: rest.length });
      rest.forEach((p, idx) =>
        out.push({
          kind: "item",
          key: p.id,
          prep: p,
          isFirst: idx === 0,
          isLast: idx === rest.length - 1,
        }),
      );
    }
    return out;
  }, [sorted, sections, types, group]);

  const handleAdd = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push("/homemade-form");
  };

  const handleImport = () => {
    const n = importSamples();
    if (Platform.OS !== "web" && n > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  /** 多选:可见条目 id 与操作回调 */
  const visibleIds = useMemo(() => sorted.map((p) => p.id), [sorted]);

  const toggleSelect = useCallback((id: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
    setBulkSheet(null);
  }, []);

  const handleBulkDelete = useCallback(() => {
    const n = selectedIds.length;
    if (n === 0) return;
    const doDelete = () => {
      deletePreps(selectedIds);
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
  }, [selectedIds, deletePreps, exitSelectMode, t]);

  /** 批量改类型(分区/分组随类型隐含带出) */
  const handleBulkApply = useCallback(
    (keys: string[]) => {
      if (bulkSheet === "type" && keys[0]) {
        bulkUpdatePreps(selectedIds, { type: keys[0] });
      }
      setBulkSheet(null);
      exitSelectMode();
    },
    [bulkSheet, selectedIds, bulkUpdatePreps, exitSelectMode],
  );

  /** 类型选项:全部类型,标签 = 类型名(分区名) */
  const bulkTypeOptions = useMemo(
    () =>
      types.map((tp) => ({
        key: tp.key,
        label: `${lang === "en" ? tp.en : tp.zh} · ${prepSectionLabelIn(sections, tp.section, lang)}`,
      })),
    [types, sections, lang],
  );

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
      {/* 批量 AI 补全横幅：进度 / 结果 / 入口 */}
      {enriching && enrichProgress ? (
        <View className="mx-5 mt-2 px-4 py-2 rounded-xl flex-row items-center" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 8 }}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text className="text-sm text-foreground flex-1">AI 补全中… {enrichProgress.done}/{enrichProgress.total}</Text>
        </View>
      ) : enrichMsg ? (
        <View className="mx-5 mt-2 px-4 py-2 rounded-xl flex-row items-center justify-between" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Text className="text-sm text-foreground flex-1">{enrichMsg}</Text>
          {enrichErrors.length > 0 && (
            <Text className="text-xs text-warning ml-2">失败: {enrichErrors.slice(0, 3).join(", ")}{enrichErrors.length > 3 ? `…+${enrichErrors.length - 3}` : ""}</Text>
          )}
          <Pressable onPress={() => setEnrichMsg(null)} style={({ pressed }) => [{ marginLeft: 8, opacity: pressed ? 0.5 : 1 }]}>
            <Text className="text-sm text-primary">关闭</Text>
          </Pressable>
        </View>
      ) : !selectMode && missingCount > 0 ? (
        <View className="mx-5 mt-2 flex-row items-center justify-between px-4 py-2 rounded-xl" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <Text className="text-sm text-muted flex-1">{missingCount} 条自制品待 AI 补全介绍</Text>
          <Pressable
            onPress={handleBatchEnrich}
            style={({ pressed }) => [{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>AI 补全</Text>
          </Pressable>
        </View>
      ) : null}
      {/* 二级分组切换器：含酒精 / 无酒精 + 多选按钮 */}
      <View className="px-5 mt-2">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.border + "55", borderRadius: 10, padding: 2, gap: 2 }}>
            {PREP_GROUPS.map((g) => {
              const active = group === g.key;
              const count = preps.filter(
                (p) => prepGroupOf(p, sections, types) === g.key,
              ).length;
              return (
                <Pressable
                  key={g.key}
                  onPress={() => {
                    setGroup(g.key);
                    if (Platform.OS !== "web") {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                  }}
                  style={[
                    styles.groupSeg,
                    active && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.groupSegText,
                      { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" },
                    ]}
                  >
                    {(lang === "en" ? g.en : g.zh) + (count > 0 ? ` ${count}` : "")}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {groupPreps.length > 0 ? (
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
          className="flex-row items-center bg-surface border border-border rounded-xl px-3"
          style={{ height: 44 }}
        >
          <IconSymbol name="magnifyingglass" size={18} color={colors.muted} />
          <TextInput
            className="flex-1 ml-2 text-base text-foreground"
            placeholder={t("hm.search.placeholder")}
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

      {/* Section filter */}
      {/* 快捷筛选:与 Filter 面板互不联动;分区大 chip 展开类型子分类,状态持久保留 */}
      <View style={{ marginTop: 10 }}>
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

      {/* 统一筛选与排序面板:类型 + 工艺多选、排序 */}
      <FilterSortSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        dimensions={dimensions}
        sortOptions={PREP_SORTS.map((s) => ({ value: s, label: t(`sort.${s}` as "sort.default") }))}
        sortValue={sort}
        onSortChange={(v) => setSort(v as PrepSort)}
        onClearAll={clearAll}
        resultCount={filtered.length}
      />

      {ready && filtered.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8" style={{ marginTop: -40 }}>
          <Text style={{ fontSize: 48, lineHeight: 64 }}>🧪</Text>
          <Text className="text-xl font-semibold text-foreground mt-3">
            {preps.length === 0 ? t("hm.empty.title") : t("hm.noMatch")}
          </Text>
          {preps.length === 0 ? (
            <>
              <Text className="text-sm text-muted text-center mt-2 leading-relaxed">
                {t("hm.empty.desc")}
              </Text>
              <Pressable
                onPress={handleImport}
                style={({ pressed }) => [
                  styles.importBtn,
                  { backgroundColor: colors.primary },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <IconSymbol name="sparkles" size={16} color="#FFFFFF" />
                <Text style={styles.importBtnText}>{t("hm.empty.import")}</Text>
              </Pressable>
            </>
          ) : null}
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
            keyExtractor={(p) => p.id}
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
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: 90 + insets.bottom,
          }}
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <View style={styles.sectionHeader}>
                <Text
                  className="text-[13px] font-medium text-muted"
                  style={{ textTransform: "uppercase", letterSpacing: 0.4, lineHeight: 18 }}
                >
                  {prepSectionLabelIn(sections, item.sectionKey, lang)} · {item.count}
                </Text>
              </View>
            ) : item.kind === "group" ? (
              <PrepGroupRow
                preps={item.preps}
                isFirst={item.isFirst}
                isLast={item.isLast}
                expanded={expandedGroups.has(item.key)}
                onToggle={() =>
                  setExpandedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(item.key)) next.delete(item.key);
                    else next.add(item.key);
                    return next;
                  })
                }
                bottles={bottles}
              />
            ) : (
              <PrepRow prep={item.prep} isFirst={item.isFirst} isLast={item.isLast} bottles={bottles} />
            )
          }
        />
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
                  <PrepRowInner
                    prep={item}
                    isFirst={index === 0}
                    isLast={index === sorted.length - 1}
                    bottles={bottles}
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
          { backgroundColor: colors.primary, bottom: 20 },
          pressed && { transform: [{ scale: 0.95 }], opacity: 0.9 },
        ]}
      >
        <IconSymbol name="plus" size={26} color="#FFFFFF" />
      </Pressable>
      ) : (
        <>
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
                    params: { type: "prep", ids: selectedIds.join(",") },
                  });
                  exitSelectMode();
                },
              },
              {
                key: "type",
                label: t("sel.setType"),
                icon: "tag.fill",
                onPress: () => setBulkSheet("type"),
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
          <BulkEditSheet
            visible={bulkSheet !== null}
            title={`${t("sel.sheet.title")} · ${t("fs.dim.type")}`}
            options={bulkTypeOptions}
            multi={false}
            allowClear={false}
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

function PrepRow({
  prep,
  isFirst,
  isLast,
  bottles,
}: {
  prep: HomemadePrep;
  isFirst: boolean;
  isLast: boolean;
  bottles: Bottle[];
}) {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { deletePrep, setPrepRating } = useHomemadeStore();
  const [ratingVisible, setRatingVisible] = useState(false);

  const confirmDelete = () => {
    const name = displayNames(prep.name, prep.nameAlt, lang).primary;
    const doDelete = () => deletePrep(prep.id);
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(t("tags.delete.confirm", { name }))) {
        doDelete();
      }
      return;
    }
    Alert.alert(t("hm.delete.title"), t("tags.delete.confirm", { name }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: doDelete },
    ]);
  };

  return (
    <>
    <SwipeableRow
      leftActions={[
        {
          key: "rate",
          label: t("rating.title"),
          icon: prep.rating ? "star.fill" : "star",
          color: colors.warning,
          onPress: () => setRatingVisible(true),
        },
      ]}
      rightActions={[
        {
          key: "edit",
          label: t("common.edit"),
          icon: "pencil",
          color: colors.primary,
          onPress: () =>
            router.push({ pathname: "/homemade-form", params: { id: prep.id } }),
        },
        {
          key: "delete",
          label: t("common.delete"),
          icon: "trash.fill",
          color: colors.error,
          onPress: confirmDelete,
        },
      ]}
    >
      <PrepRowInner prep={prep} isFirst={isFirst} isLast={isLast} bottles={bottles} />
    </SwipeableRow>
    <RatingSheet
      visible={ratingVisible}
      title={displayNames(prep.name, prep.nameAlt, lang).primary}
      value={prep.rating}
      onChange={(v) => setPrepRating(prep.id, v)}
      onClose={() => setRatingVisible(false)}
    />
    </>
  );
}

/** 同名自制品折叠组:组头显示名称与版本数,可展开;提供对比入口 */
function PrepGroupRow({
  preps,
  isFirst,
  isLast,
  expanded,
  onToggle,
  bottles,
}: {
  preps: HomemadePrep[];
  isFirst: boolean;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
  bottles: Bottle[];
}) {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const head = preps[0];
  const names = displayNames(head.name, head.nameAlt, lang);

  const handleToggle = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onToggle();
  };

  const goCompare = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push({
      pathname: "/compare",
      params: { type: "prep", ids: preps.map((p) => p.id).join(",") },
    });
  };

  return (
    <View>
      <Pressable onPress={handleToggle} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
        <View
          className="bg-surface px-4 py-3"
          style={[
            isFirst && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
            isLast && !expanded && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
          ]}
        >
          <View className="flex-row items-center">
            <View className="flex-1 pr-2">
              <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                {names.primary}
                {names.secondary ? (
                  <Text className="text-xs font-normal text-muted">  {names.secondary}</Text>
                ) : null}
              </Text>
              <View className="flex-row items-center mt-1.5" style={{ gap: 6 }}>
                <View style={[styles.badge, { backgroundColor: colors.primary + "18" }]}>
                  <Text style={[styles.badgeText, { color: colors.primary }]}>
                    {t("group.versions", { n: preps.length })}
                  </Text>
                </View>
                <Pressable
                  onPress={goCompare}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.groupCompareBtn,
                    { borderColor: colors.primary + "66", backgroundColor: colors.primary + "10" },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <IconSymbol name="rectangle.split.2x1" size={11} color={colors.primary} />
                  <Text style={[styles.badgeText, { color: colors.primary }]}>
                    {t("group.compare")}
                  </Text>
                </Pressable>
              </View>
            </View>
            <IconSymbol
              name={expanded ? "chevron.up" : "chevron.down"}
              size={16}
              color={colors.muted}
            />
          </View>
        </View>
      </Pressable>
      {expanded ? (
        <View
          style={[
            { borderLeftWidth: 3, borderLeftColor: colors.primary + "55" },
            isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: "hidden" },
          ]}
        >
          {preps.map((p, i) => (
            <PrepRow
              key={p.id}
              prep={p}
              isFirst={false}
              isLast={i === preps.length - 1 && isLast}
              bottles={bottles}
            />
          ))}
        </View>
      ) : null}
      {!isLast ? (
        <View className="bg-surface">
          <View className="bg-border" style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }} />
        </View>
      ) : null}
    </View>
  );
}

function PrepRowInner({
  prep,
  isFirst,
  isLast,
  bottles,
}: {
  prep: HomemadePrep;
  isFirst: boolean;
  isLast: boolean;
  bottles: Bottle[];
}) {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { types, togglePrepMade } = useHomemadeStore();
  const [cardSettings] = useCardTagSettings();
  const names = displayNames(prep.name, prep.nameAlt, lang);
  const cost = useMemo(() => estimatePrepCost(prep, bottles), [prep, bottles]);
  const tech = useMemo(() => primaryTechnique(prep), [prep]);
  const handleMade = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(
        prep.made ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
      );
    }
    togglePrepMade(prep.id);
  };
  return (
    <Pressable
      onPress={() => router.push({ pathname: "/homemade/[id]", params: { id: prep.id } })}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      <View
        className="bg-surface px-4 py-3"
        style={[
          isFirst && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
          isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
        ]}
      >
        <View className="flex-row items-center">
          <View className="flex-1 pr-2">
            <View style={{ height: 40, justifyContent: "center" }}>
              <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                {names.primary}
              </Text>
              <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                {names.secondary || " "}
              </Text>
            </View>
            <View className="flex-row items-center mt-1.5" style={{ gap: 6, height: 24, overflow: "hidden" }}>
              {cardSettings.showHomemadeTags && (
                <>
              <View style={[styles.badge, { backgroundColor: colors.primary + "22" }]}>
                <Text style={[styles.badgeText, { color: colors.primary }]}>
                  {prepTypeLabelIn(types, prep.type, lang)}
                </Text>
              </View>
              {tech ? (
                <View style={[styles.badge, { backgroundColor: colors.warning + "22" }]}>
                  <Text style={[styles.badgeText, { color: colors.warning }]}>
                    {techniqueLabel(tech, lang)}
                  </Text>
                </View>
              ) : null}
                </>
              )}
              {prep.shelfLife ? (
                <Text className="text-xs text-muted" numberOfLines={1}>
                  {prep.shelfLife}
                </Text>
              ) : null}
              {cost.costPer30Ml !== null && cost.estimatedCount > 0 ? (
                <View style={[styles.badge, { backgroundColor: colors.success + "22" }]}>
                  <Text style={[styles.badgeText, { color: colors.success }]}>
                    {t("hm.cost.perUnit", { n: cost.costPer30Ml.toFixed(1) })}
                  </Text>
                </View>
              ) : null}
              {prep.rating ? (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: "#F5A62322", flexDirection: "row", alignItems: "center", gap: 2 },
                  ]}
                >
                  <IconSymbol name="star.fill" size={10} color="#F5A623" />
                  <Text style={[styles.badgeText, { color: "#C77F00" }]}>{prep.rating}/10</Text>
                </View>
              ) : null}
            </View>
          </View>
          <Pressable
            onPress={handleMade}
            hitSlop={10}
            style={({ pressed }) => [{ marginRight: 10 }, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol
              name={prep.made ? "checkmark.circle.fill" : "checkmark.circle"}
              size={22}
              color={prep.made ? colors.success : colors.muted}
            />
          </Pressable>
          <IconSymbol name="chevron.right" size={16} color={colors.border} />
        </View>
      </View>
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
    </Pressable>
  );
}

const subChipStyle = (
  active: boolean,
  colors: { primary: string; border: string },
) => [
  styles.subChip,
  {
    backgroundColor: active ? colors.primary + "1A" : "transparent",
    borderColor: active ? colors.primary : colors.border,
  },
];

const subChipTextStyle = (
  active: boolean,
  colors: { primary: string; muted: string },
) => [
  styles.subChipText,
  { color: active ? colors.primary : colors.muted },
];

const styles = StyleSheet.create({
  chipRowWrap: {
    marginTop: 10,
    marginBottom: 6,
  },
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
  groupSeg: {
    flex: 1,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  groupSegText: {
    fontSize: 14,
    lineHeight: 18,
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
  subChip: {
    paddingHorizontal: 12,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  subChipText: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 7,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  groupCompareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    height: 42,
    borderRadius: 21,
    marginTop: 16,
  },
  importBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
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
