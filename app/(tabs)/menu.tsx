/**
 * 门店酒单页面
 * - RecipeCard 卡片化展示
 * - 在售/停售状态（新加入默认停售）
 * - 售价 + 利润率显示
 * - 批量操作：多选 → 上架/下架/定价/移除
 * - 分组可选（无分组直接加入）
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fabBottom, bulkBarBottom } from "@/components/floating-tab-bar";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { RecipeCard } from "@/components/recipe-card";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useMenuStore, MenuGroup, MenuEntry } from "@/lib/menu/store";
import { useRecipeStore } from "@/lib/recipes/store";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import { displayNames } from "@/lib/utils";
import { useSpiritsInventoryStore } from "@/lib/spirits/crud-store";
import { calcDirectPourCost, calcRecipePourCost, pourCostColor, confidenceLabel } from "@/lib/spirits/pour-cost";
import { MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";

// ─── 售价行（内联编辑） ───────────────────────────────────────────────────────

interface PriceRowProps {
  entry: MenuEntry;
  cost: number | null;
  onSetPrice: (price: number | null) => void;
  onSetServingSize?: (size: number | undefined) => void;
  matchedCount?: number;
  totalCount?: number;
}

function PriceRow({ entry, cost, onSetPrice, onSetServingSize, matchedCount, totalCount }: PriceRowProps) {
  const colors = useColors();
  const spiritsStore = useSpiritsInventoryStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.price != null ? String(entry.price) : "");
  const [editingServing, setEditingServing] = useState(false);
  const [servingText, setServingText] = useState(entry.servingSize != null ? String(entry.servingSize) : "");

  const commit = () => {
    const val = parseFloat(text);
    onSetPrice(isNaN(val) || val <= 0 ? null : val);
    setEditing(false);
  };

  const commitServing = () => {
    const val = parseFloat(servingText);
    onSetServingSize?.(isNaN(val) || val <= 0 ? undefined : val);
    setEditingServing(false);
  };

  const profit = entry.price != null && cost != null ? entry.price - cost : null;
  const profitPct = profit != null && cost != null && cost > 0
    ? Math.round((profit / entry.price!) * 100)
    : null;

  // Pour Cost 计算
  const pourCostResult = useMemo(() => {
    // 纯饮/直饮：有关联酒款 + servingSize
    if (entry.linkedSpiritItemId && entry.servingSize) {
      const item = spiritsStore.items.find((i) => i.id === entry.linkedSpiritItemId);
      if (item) return calcDirectPourCost(item, entry);
    }
    // 配方：有 cost（来自 smart-cost）
    if (cost != null && entry.price != null) {
      return calcRecipePourCost(cost, matchedCount ?? 0, totalCount ?? 1, entry.price);
    }
    return null;
  }, [entry, cost, spiritsStore.items, matchedCount, totalCount]);

  return (
    <View style={styles.priceRow}>
      {editing ? (
        <TextInput
          style={[styles.priceInput, { color: colors.foreground, borderColor: colors.primary }]}
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          autoFocus
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
          placeholder="售价"
          placeholderTextColor={colors.muted}
        />
      ) : (
        <Pressable onPress={() => setEditing(true)} style={styles.priceBadge}>
          <IconSymbol name="tag" size={12} color={entry.price != null ? colors.primary : colors.muted} />
          <Text style={[styles.priceText, { color: entry.price != null ? colors.primary : colors.muted }]}>
            {entry.price != null ? `¥${entry.price}` : "设置售价"}
          </Text>
        </Pressable>
      )}
      {cost != null && (
        <Text style={[styles.costText, { color: colors.muted }]}>
          成本≈¥{cost.toFixed(1)}
        </Text>
      )}
      {profit != null && profitPct != null && (
        <View style={[styles.profitBadge, { backgroundColor: profit >= 0 ? colors.success + "22" : colors.error + "22" }]}>
          <Text style={[styles.profitText, { color: profit >= 0 ? colors.success : colors.error }]}>
            {profit >= 0 ? "+" : ""}¥{profit.toFixed(1)} ({profitPct}%)
          </Text>
        </View>
      )}
      {/* Pour Cost 显示 */}
      {pourCostResult?.pourCostPct != null && (
        <View style={[styles.profitBadge, { backgroundColor: pourCostColor(pourCostResult.pourCostPct) + "22" }]}>
          <Text style={[styles.profitText, { color: pourCostColor(pourCostResult.pourCostPct) }]}>
            PC {pourCostResult.pourCostPct.toFixed(1)}%
            {pourCostResult.confidence !== "exact" && ` (${confidenceLabel(pourCostResult.confidence)})`}
          </Text>
        </View>
      )}
      {/* 纯饮分量设置 */}
      {onSetServingSize && (
        editingServing ? (
          <TextInput
            style={[styles.priceInput, { color: colors.foreground, borderColor: colors.primary, width: 90 }]}
            value={servingText}
            onChangeText={setServingText}
            keyboardType="decimal-pad"
            autoFocus
            onBlur={commitServing}
            onSubmitEditing={commitServing}
            returnKeyType="done"
            placeholder="分量 ml"
            placeholderTextColor={colors.muted}
          />
        ) : (
          <Pressable onPress={() => setEditingServing(true)} style={[styles.priceBadge, { borderColor: colors.border }]}>
            <IconSymbol name="drop" size={11} color={entry.servingSize != null ? "#5856D6" : colors.muted} />
            <Text style={[styles.priceText, { color: entry.servingSize != null ? "#5856D6" : colors.muted }]}>
              {entry.servingSize != null ? `${entry.servingSize}ml` : "设置分量"}
            </Text>
          </Pressable>
        )
      )}
    </View>
  );
}

// ─── 配方卡片行（含在售状态 + 售价行 + 选中框） ──────────────────────────────

interface MenuEntryCardProps {
  entry: MenuEntry;
  groupId: string | null; // null = 无分组
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onSetPrice: (price: number | null) => void;
  onToggleAvailable: () => void;
  onRemove: () => void;
}

function MenuEntryCard({
  entry,
  groupId,
  selectionMode,
  selected,
  onToggleSelect,
  onSetPrice,
  onToggleAvailable,
  onRemove,
}: MenuEntryCardProps) {
  const colors = useColors();
  const { recipes } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const { setServingSize } = useMenuStore();
  const recipe = recipes.find((r) => r.id === entry.recipeId);
  const costResult = useMemo(() => {
    if (!recipe || recipe.ingredients.length === 0) return null;
    const est = estimateRecipeCostSmart(recipe.ingredients, bottles, preps);
    return est;
  }, [recipe, bottles, preps]);
  const cost = costResult && costResult.estimatedCount > 0 ? costResult.total : null;
  const matchedCount = costResult?.items.filter((i) => i.link !== null).length ?? 0;
  const totalCount = costResult?.totalCount ?? 0;

  if (!recipe) return null;

  const isAvailable = entry.available;

  return (
    <View style={[styles.entryCardWrap, { backgroundColor: colors.surface }, selected && { backgroundColor: colors.primary + "11" }]}>
      {/* 主行：选中框 + 配方信息 + 操作区（水平排列，无绝对定位） */}
      <View style={styles.entryMainRow}>
        {/* 选中框（批量模式） */}
        {selectionMode && (
          <Pressable onPress={onToggleSelect} hitSlop={8} style={styles.checkboxWrap}>
            <IconSymbol
              name={selected ? "checkmark.square.fill" : "square"}
              size={22}
              color={selected ? colors.primary : colors.muted}
            />
          </Pressable>
        )}

        {/* 配方信息区（占满剩余宽度） */}
        <View style={{ flex: 1 }} pointerEvents={selectionMode ? "none" : "auto" as any}>
          <RecipeCard recipe={recipe} isFirst isLast />
        </View>

        {/* 右侧操作区：在售状态 + 删除（垂直排列，不覆盖卡片内容） */}
        <View style={styles.entryActions}>
          {/* 在售/停售 pill */}
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onToggleAvailable();
            }}
            hitSlop={8}
            style={[styles.availPill, { backgroundColor: isAvailable ? colors.success + "20" : colors.border + "60" }]}
          >
            <View style={[styles.availDot, { backgroundColor: isAvailable ? colors.success : colors.muted }]} />
            <Text style={[styles.availLabel, { color: isAvailable ? colors.success : colors.muted }]}>
              {isAvailable ? "在售" : "停售"}
            </Text>
          </Pressable>
          {/* 删除 */}
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onRemove();
            }}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
          >
            <IconSymbol name="minus.circle.fill" size={18} color={colors.error} />
          </Pressable>
        </View>
      </View>

      {/* 售价 + 利润率行 */}
      <View style={[styles.priceRowWrap, { borderTopColor: colors.border }]}>
        <PriceRow
          entry={entry}
          cost={cost}
          onSetPrice={onSetPrice}
          onSetServingSize={(size) => setServingSize(entry.id, groupId, size)}
          matchedCount={matchedCount}
          totalCount={totalCount}
        />
      </View>
    </View>
  );
}

// ─── 分组标题 ─────────────────────────────────────────────────────────────────

interface GroupHeaderProps {
  group: MenuGroup;
  onAddRecipe: () => void;
}

function GroupHeader({ group, onAddRecipe }: GroupHeaderProps) {
  const colors = useColors();
  const { toggleCollapse, renameGroup, deleteGroup } = useMenuStore();
  const { lang } = useI18n();

  const handleOptions = () => {
    Alert.alert(group.name, undefined, [
      {
        text: lang === "en" ? "Rename" : "重命名",
        onPress: () => {
          Alert.prompt(lang === "en" ? "Rename Group" : "重命名分组", undefined, (newName) => {
            if (newName?.trim()) renameGroup(group.id, newName.trim());
          }, "plain-text", group.name);
        },
      },
      {
        text: lang === "en" ? "Delete Group" : "删除分组",
        style: "destructive",
        onPress: () => {
          Alert.alert(
            lang === "en" ? "Delete Group" : "删除分组",
            lang === "en" ? "Recipes in this group will be unlinked (recipes themselves will not be deleted)." : "删除后分组内配方引用将一并移除（配方本身不受影响）",
            [
              { text: lang === "en" ? "Cancel" : "取消", style: "cancel" },
              { text: lang === "en" ? "Delete" : "删除", style: "destructive", onPress: () => deleteGroup(group.id) },
            ]
          );
        },
      },
      { text: lang === "en" ? "Cancel" : "取消", style: "cancel" },
    ]);
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.groupHeader,
        { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
      onPress={() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        toggleCollapse(group.id);
      }}
    >
      <IconSymbol
        name={group.collapsed ? "chevron.right" : "chevron.down"}
        size={13}
        color={colors.muted}
      />
      <Text style={[styles.groupName, { color: colors.foreground }]} numberOfLines={1}>{group.name}</Text>
      <Text style={[styles.groupCount, { color: colors.muted, backgroundColor: colors.border + "60", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 }]}>
        {group.entries.filter((e) => e.available).length}/{group.entries.length}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Pressable onPress={onAddRecipe} hitSlop={10} style={({ pressed }) => [styles.groupActionBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
        </Pressable>
        <Pressable onPress={handleOptions} hitSlop={10} style={({ pressed }) => [styles.groupActionBtn, { opacity: pressed ? 0.6 : 1 }]}>
          <IconSymbol name="ellipsis" size={18} color={colors.muted} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── 添加配方选择器 ───────────────────────────────────────────────────────────

interface AddRecipeSheetProps {
  targetGroupId: string | null; // null = 无分组
  onClose: () => void;
}

function AddRecipeSheet({ targetGroupId, onClose }: AddRecipeSheetProps) {
  const colors = useColors();
  const { lang } = useI18n();
  const { recipes } = useRecipeStore();
  const { addEntry, addUngroupedEntry, groups, ungroupedEntries } = useMenuStore();
  const [query, setQuery] = useState("");

  // 已在目标位置的 recipeId 集合
  const existingIds = useMemo(() => {
    if (targetGroupId === null) {
      return new Set(ungroupedEntries.map((e) => e.recipeId));
    }
    const g = groups.find((g) => g.id === targetGroupId);
    return new Set(g?.entries.map((e) => e.recipeId) ?? []);
  }, [targetGroupId, groups, ungroupedEntries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (!q) return true;
      const { primary, secondary } = displayNames(r.nameEn, r.name, lang);
      return primary.toLowerCase().includes(q) || secondary.toLowerCase().includes(q);
    });
  }, [recipes, query, lang]);

  return (
    <View style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
          {targetGroupId === null ? "添加到无分组" : "添加到分组"}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <IconSymbol name="xmark.circle.fill" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <View style={[styles.searchWrap, { backgroundColor: colors.surface }]}>
        <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="搜索配方…"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="done"
        />
      </View>
      <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
        data={filtered}
        keyExtractor={(r) => r.id}
        renderItem={({ item: r }) => {
          const already = existingIds.has(r.id);
          const { primary, secondary } = displayNames(r.nameEn, r.name, lang);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.recipeRow,
                { borderBottomColor: colors.border },
                pressed && { opacity: 0.7 },
                already && { opacity: 0.4 },
              ]}
              onPress={() => {
                if (already) return;
                if (targetGroupId === null) {
                  addUngroupedEntry(r.id);
                } else {
                  addEntry(targetGroupId, r.id);
                }
                if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onClose();
              }}
              disabled={already}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.recipeName, { color: colors.foreground }]} numberOfLines={1}>{primary}</Text>
                {secondary ? <Text style={[styles.recipeEn, { color: colors.muted }]} numberOfLines={1}>{secondary}</Text> : null}
              </View>
              {already
                ? <Text style={[styles.alreadyBadge, { color: colors.muted }]}>已添加</Text>
                : <IconSymbol name="plus.circle.fill" size={22} color={colors.primary} />
              }
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

// ─── 批量定价弹窗 ─────────────────────────────────────────────────────────────

interface BatchPriceSheetProps {
  count: number;
  onConfirm: (price: number | null) => void;
  onClose: () => void;
}

function BatchPriceSheet({ count, onConfirm, onClose }: BatchPriceSheetProps) {
  const colors = useColors();
  const [text, setText] = useState("");

  const commit = () => {
    const val = parseFloat(text);
    onConfirm(isNaN(val) || val <= 0 ? null : val);
    onClose();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
          批量设置售价（{count} 款）
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <IconSymbol name="xmark.circle.fill" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <View style={{ padding: 20, gap: 16 }}>
        <Text style={[styles.batchPriceLabel, { color: colors.muted }]}>
          输入统一售价（元），留空则清除售价
        </Text>
        <View style={[styles.batchPriceInputWrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.batchPriceCurrency, { color: colors.muted }]}>¥</Text>
          <TextInput
            style={[styles.batchPriceInput, { color: colors.foreground }]}
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            autoFocus
            placeholder="0.00"
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            onSubmitEditing={commit}
          />
        </View>
        <Pressable
          style={({ pressed }) => [styles.batchPriceBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          onPress={commit}
        >
          <Text style={styles.batchPriceBtnText}>确认</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── 主屏幕 ───────────────────────────────────────────────────────────────────

export default function MenuScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    groups,
    ungroupedEntries,
    addGroup,
    removeEntry,
    setPrice,
    toggleAvailable,
    removeUngroupedEntry,
    setUngroupedPrice,
    toggleUngroupedAvailable,
    batchSetPrice,
  } = useMenuStore();

  // 批量选择
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 添加配方 sheet
  const [addRecipeTarget, setAddRecipeTarget] = useState<{ groupId: string | null } | null>(null);
  // 批量定价 sheet
  const [showBatchPrice, setShowBatchPrice] = useState(false);
  // 新建分组
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [addingGroupName, setAddingGroupName] = useState("");

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // 收集所有 entry（含分组和无分组）用于批量操作
  const allEntries = useMemo(() => {
    const grouped = groups.flatMap((g) => g.entries.map((e) => ({ entry: e, groupId: g.id })));
    const ungrouped = ungroupedEntries.map((e) => ({ entry: e, groupId: null as null }));
    return [...grouped, ...ungrouped];
  }, [groups, ungroupedEntries]);

  const selectedEntries = useMemo(
    () => allEntries.filter(({ entry }) => selectedIds.has(entry.id)),
    [allEntries, selectedIds]
  );

  const handleBatchAvailable = (available: boolean) => {
    selectedEntries.forEach(({ entry, groupId }) => {
      if (entry.available !== available) {
        if (groupId !== null) {
          toggleAvailable(groupId, entry.id);
        } else {
          // 无分组：通过 setUngroupedPrice 无法切换 available，需要直接 dispatch
          // 这里复用 toggleAvailable 的逻辑：若当前状态与目标不同则 toggle
          toggleAvailable("__ungrouped__", entry.id);
        }
      }
    });
    exitSelectionMode();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleBatchRemove = () => {
    Alert.alert(`移除 ${selectedIds.size} 款配方`, "确认从门店酒单中移除？", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => {
          selectedEntries.forEach(({ entry, groupId }) => {
            if (groupId !== null) removeEntry(groupId, entry.id);
            else removeUngroupedEntry(entry.id);
          });
          exitSelectionMode();
        },
      },
    ]);
  };

  const handleBatchPriceConfirm = (price: number | null) => {
    batchSetPrice(Array.from(selectedIds), price);
    exitSelectionMode();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleCreateGroup = () => {
    const name = addingGroupName.trim();
    if (!name) return;
    addGroup(name);
    setAddingGroupName("");
    setShowAddGroup(false);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // 总计在售数量
  const totalAvailable = useMemo(
    () => allEntries.filter(({ entry }) => entry.available).length,
    [allEntries]
  );
  const totalEntries = allEntries.length;

  // 列表数据：无分组区 + 各分组区
  type ListItem =
    | { kind: "ungrouped-header" }
    | { kind: "ungrouped-entry"; entry: MenuEntry }
    | { kind: "group-header"; group: MenuGroup }
    | { kind: "group-entry"; entry: MenuEntry; groupId: string }
    | { kind: "add-group-input" }
    | { kind: "empty" };

  const listData = useMemo((): ListItem[] => {
    const items: ListItem[] = [];
    // 无分组区
    if (ungroupedEntries.length > 0) {
      items.push({ kind: "ungrouped-header" });
      ungroupedEntries.forEach((entry) => items.push({ kind: "ungrouped-entry", entry }));
    }
    // 各分组
    groups.forEach((group) => {
      items.push({ kind: "group-header", group });
      if (!group.collapsed) {
        group.entries.forEach((entry) => items.push({ kind: "group-entry", entry, groupId: group.id }));
      }
    });
    // 新建分组输入框
    if (showAddGroup) items.push({ kind: "add-group-input" });
    // 空状态
    if (ungroupedEntries.length === 0 && groups.length === 0 && !showAddGroup) {
      items.push({ kind: "empty" });
    }
    return items;
  }, [ungroupedEntries, groups, showAddGroup]);

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.kind === "empty") {
      return (
        <View style={styles.emptyWrap}>
          <IconSymbol name="storefront" size={48} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>门店酒单为空</Text>
          <Text style={[styles.emptyDesc, { color: colors.muted }]}>
            添加配方到门店酒单，设置售价和在售状态
          </Text>
          <Pressable
            style={({ pressed }) => [styles.emptyBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
            onPress={() => setAddRecipeTarget({ groupId: null })}
          >
            <IconSymbol name="plus" size={16} color="#fff" />
            <Text style={styles.emptyBtnText}>添加配方</Text>
          </Pressable>
        </View>
      );
    }

    if (item.kind === "ungrouped-header") {
      return (
        <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
          <Text style={[styles.sectionTitle, { color: colors.muted }]}>未分组</Text>
          <Pressable
            onPress={() => setAddRecipeTarget({ groupId: null })}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
          >
            <IconSymbol name="plus.circle.fill" size={20} color={colors.primary} />
          </Pressable>
        </View>
      );
    }

    if (item.kind === "ungrouped-entry") {
      const { entry } = item;
      return (
        <View style={{ paddingHorizontal: 16, marginBottom: 2 }}>
          <MenuEntryCard
            entry={entry}
            groupId={null}
            selectionMode={selectionMode}
            selected={selectedIds.has(entry.id)}
            onToggleSelect={() => toggleSelect(entry.id)}
            onSetPrice={(price) => setUngroupedPrice(entry.id, price)}
            onToggleAvailable={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              // 无分组 available 切换：通过 TOGGLE_AVAILABLE 走 ungrouped 路径
              // store 中 TOGGLE_AVAILABLE 只处理分组，需要单独处理
              // 这里通过 setUngroupedPrice 无法切换 available，
              // 所以我们在 store 中新增了 TOGGLE_UNGROUPED_AVAILABLE
              // 暂时用 removeUngroupedEntry + addUngroupedEntry 来模拟（会丢失 price）
              // 正确做法：在 store 中添加 TOGGLE_UNGROUPED_AVAILABLE action
              // 此处直接通过 dispatch 实现（通过 useMenuStore 的 toggleUngroupedAvailable）
              toggleUngroupedAvailable(entry.id);
            }}
            onRemove={() => removeUngroupedEntry(entry.id)}
          />
        </View>
      );
    }

    if (item.kind === "group-header") {
      return (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <GroupHeader
            group={item.group}
            onAddRecipe={() => setAddRecipeTarget({ groupId: item.group.id })}
          />
        </View>
      );
    }

    if (item.kind === "group-entry") {
      const { entry, groupId } = item;
      return (
        <View style={{ paddingHorizontal: 16, marginBottom: 2 }}>
          <MenuEntryCard
            entry={entry}
            groupId={groupId}
            selectionMode={selectionMode}
            selected={selectedIds.has(entry.id)}
            onToggleSelect={() => toggleSelect(entry.id)}
            onSetPrice={(price) => setPrice(groupId, entry.id, price)}
            onToggleAvailable={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleAvailable(groupId, entry.id);
            }}
            onRemove={() => removeEntry(groupId, entry.id)}
          />
        </View>
      );
    }

    if (item.kind === "add-group-input") {
      return (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <View style={[styles.addGroupRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              style={[styles.addGroupInput, { color: colors.foreground }]}
              placeholder="分组名称（如：经典鸡尾酒）"
              placeholderTextColor={colors.muted}
              value={addingGroupName}
              onChangeText={setAddingGroupName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateGroup}
            />
            <Pressable
              style={({ pressed }) => [styles.addGroupBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleCreateGroup}
            >
              <Text style={styles.addGroupBtnText}>创建</Text>
            </Pressable>
            <Pressable onPress={() => setShowAddGroup(false)} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={18} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      );
    }

    return null;
  };


  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 普通模式顶部状态栏（多选模式下操作栏改为底部浮岛，见文件末尾） */}
      {!selectionMode && (
        /* 普通模式顶部状态栏 */
        totalEntries > 0 && (
          <View style={[styles.statusBar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Text style={[styles.statusText, { color: colors.muted }]}>
              共 {totalEntries} 款 · {totalAvailable} 在售
            </Text>
            <View style={styles.statusActions}>
              <Pressable
                onPress={() => setAddRecipeTarget({ groupId: null })}
                hitSlop={8}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <IconSymbol name="plus.circle.fill" size={22} color={colors.primary} />
              </Pressable>
              <Pressable
                onPress={() => setSelectionMode(true)}
                hitSlop={8}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <IconSymbol name="checkmark.square.fill" size={22} color={colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => setShowAddGroup(true)}
                hitSlop={8}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <IconSymbol name="folder.badge.plus" size={22} color={colors.muted} />
              </Pressable>
            </View>
          </View>
        )
      )}

      <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
        data={listData}
        keyExtractor={(item, index) => {
          if (item.kind === "ungrouped-header") return "ungrouped-header";
          if (item.kind === "ungrouped-entry") return `ue-${item.entry.id}`;
          if (item.kind === "group-header") return `gh-${item.group.id}`;
          if (item.kind === "group-entry") return `ge-${item.entry.id}`;
          if (item.kind === "add-group-input") return "add-group-input";
          return `empty-${index}`;
        }}
        renderItem={renderItem}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 100 + insets.bottom }}
      />

      {/* FAB：无内容时显示添加按钮 */}
      {totalEntries === 0 && !showAddGroup && (
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: colors.primary, bottom: fabBottom(insets.bottom), opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={() => setAddRecipeTarget({ groupId: null })}
        >
          <IconSymbol name="plus" size={24} color="#fff" />
        </Pressable>
      )}

      {/* 多选模式底部浮岛操作栏 */}
      {selectionMode && (
        <View
          style={[
            styles.batchBar,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              bottom: bulkBarBottom(insets.bottom),
              shadowColor: "#000",
            },
          ]}
        >
          <Pressable onPress={exitSelectionMode} hitSlop={8}>
            <Text style={[styles.batchBarCancel, { color: colors.primary }]}>取消</Text>
          </Pressable>
          <Text style={[styles.batchBarCount, { color: colors.foreground }]}>
            已选 {selectedIds.size} 款
          </Text>
          <View style={styles.batchBarActions}>
            <Pressable
              onPress={() => handleBatchAvailable(true)}
              disabled={selectedIds.size === 0}
              style={({ pressed }) => [styles.batchBarBtn, { backgroundColor: colors.success + "22", opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.batchBarBtnText, { color: colors.success }]}>上架</Text>
            </Pressable>
            <Pressable
              onPress={() => handleBatchAvailable(false)}
              disabled={selectedIds.size === 0}
              style={({ pressed }) => [styles.batchBarBtn, { backgroundColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.batchBarBtnText, { color: colors.muted }]}>下架</Text>
            </Pressable>
            <Pressable
              onPress={() => setShowBatchPrice(true)}
              disabled={selectedIds.size === 0}
              style={({ pressed }) => [styles.batchBarBtn, { backgroundColor: colors.primary + "22", opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.batchBarBtnText, { color: colors.primary }]}>定价</Text>
            </Pressable>
            <Pressable
              onPress={handleBatchRemove}
              disabled={selectedIds.size === 0}
              style={({ pressed }) => [styles.batchBarBtn, { backgroundColor: colors.error + "22", opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.batchBarBtnText, { color: colors.error }]}>移除</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* 添加配方 Sheet */}
      {addRecipeTarget !== null && (
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable
            style={[styles.sheetOverlay, { backgroundColor: "rgba(0,0,0,0.4)" }]}
            onPress={() => setAddRecipeTarget(null)}
          />
          <View style={[styles.sheetContainer, { backgroundColor: colors.background }]}>
            <AddRecipeSheet
              targetGroupId={addRecipeTarget.groupId}
              onClose={() => setAddRecipeTarget(null)}
            />
          </View>
        </View>
      )}

      {/* 批量定价 Sheet */}
      {showBatchPrice && (
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable
            style={[styles.sheetOverlay, { backgroundColor: "rgba(0,0,0,0.4)" }]}
            onPress={() => setShowBatchPrice(false)}
          />
          <View style={[styles.sheetContainerSmall, { backgroundColor: colors.background }]}>
            <BatchPriceSheet
              count={selectedIds.size}
              onConfirm={handleBatchPriceConfirm}
              onClose={() => setShowBatchPrice(false)}
            />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // 状态栏
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 18,
  },
  statusActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  // 批量操作栏
  batchBar: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    gap: 10,
  },
  batchBarCancel: {
    fontSize: 15,
    fontWeight: "500",
  },
  batchBarCount: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  batchBarActions: {
    flexDirection: "row",
    gap: 6,
  },
  batchBarBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  batchBarBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  // 分区标题
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    gap: 8,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  // 分组标题
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 8,
  },
  groupName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  groupCount: {
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  groupActionBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  // 配方卡片行
  entryCardWrap: {
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 8,
    marginHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  entryMainRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  checkboxWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 10,
    paddingRight: 4,
  },
  entryActions: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  availPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  availBtn: {
    alignItems: "center",
    gap: 2,
  },
  availDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  availLabel: {
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 13,
  },
  // 售价行
  priceRowWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  priceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  priceText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  priceInput: {
    width: 72,
    fontSize: 13,
    fontWeight: "600",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: "right",
  },
  costText: {
    fontSize: 11,
    lineHeight: 16,
  },
  profitBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  profitText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
  },
  // 新建分组
  addGroupRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  addGroupInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 2,
  },
  addGroupBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addGroupBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  // 空状态
  emptyWrap: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 8,
  },
  emptyBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  // FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
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
  // Sheet
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "70%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  sheetContainerSmall: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  sheet: {
    flex: 1,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  recipeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  recipeName: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 19,
  },
  recipeEn: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  alreadyBadge: {
    fontSize: 11,
    fontWeight: "500",
  },
  // 批量定价
  batchPriceLabel: {
    fontSize: 14,
    lineHeight: 20,
  },
  batchPriceInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  batchPriceCurrency: {
    fontSize: 18,
    fontWeight: "600",
  },
  batchPriceInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 30,
  },
  batchPriceBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  batchPriceBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
