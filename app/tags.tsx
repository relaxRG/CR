import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { ScreenContainer } from "@/components/screen-container";
import { BottleTaxonomyManager } from "@/components/bottle-taxonomy-manager";
import { PrepTaxonomyManager } from "@/components/prep-taxonomy-manager";
import { ColorPickerPanel } from "@/components/color-picker";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { cn, displayNames } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useRecipeStore } from "@/lib/recipes/store";
import { CATEGORY_COLORS, TagGroup, TagKind } from "@/lib/recipes/types";

type SectionKey = "category" | TagKind | "bottleCat" | "prepSec";

const SECTION_KEYS: SectionKey[] = ["category", "spirit", "glass", "flavor", "duration", "occasion", "bottleCat", "prepSec"];
/** 独立管理板块(渲染专用管理组件,不走 rows/tag 逻辑) */
const MANAGER_SECTIONS: SectionKey[] = ["bottleCat", "prepSec"];
const isTagKind = (s: SectionKey): s is TagKind =>
  s === "spirit" || s === "glass" || s === "flavor" || s === "duration" || s === "occasion";
const SECTION_LABEL_KEY = {
  category: "tags.section.category",
  spirit: "tags.section.spirit",
  glass: "tags.section.glass",
  flavor: "tags.section.flavor",
  duration: "tags.section.duration",
  occasion: "tags.section.occasion",
  bottleCat: "tags.section.bottleCat",
  prepSec: "tags.section.prepSection",
} as const;

interface RowData {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  count: number;
  groupId?: string | null;
}

/** 行高(含 mb-2.5 间距),用于拖拽位移换算 */
const ROW_HEIGHT = 61;

function DraggableRow({
  index,
  total,
  onMove,
  onDragStateChange,
  children,
}: {
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onDragStateChange: (dragging: boolean) => void;
  children: React.ReactNode;
}) {
  const translateY = useSharedValue(0);
  const active = useSharedValue(false);

  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      active.value = true;
      runOnJS(onDragStateChange)(true);
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const delta = Math.round(e.translationY / ROW_HEIGHT);
      const to = Math.max(0, Math.min(total - 1, index + delta));
      translateY.value = 0;
      active.value = false;
      runOnJS(onDragStateChange)(false);
      if (to !== index) {
        runOnJS(onMove)(index, to);
      }
    })
    .onFinalize(() => {
      translateY.value = 0;
      active.value = false;
      runOnJS(onDragStateChange)(false);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: withTiming(active.value ? 1.03 : 1, { duration: 120 }) },
    ],
    zIndex: active.value ? 10 : 0,
    opacity: withTiming(active.value ? 0.92 : 1, { duration: 120 }),
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={animatedStyle}>{children}</Animated.View>
    </GestureDetector>
  );
}

export default function CategoriesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, lang } = useI18n();
  const {
    categories,
    recipes,
    tags,
    tagGroups,
    addCategory,
    renameCategory,
    setCategoryNameEn,
    setCategoryColor,
    deleteCategory,
    reorderCategories,
    addTag,
    renameTag,
    setTagNameEn,
    setTagColor,
    deleteTag,
    reorderTags,
    addTagGroup,
    renameTagGroup,
    setTagGroupNameEn,
    deleteTagGroup,
    reorderTagGroups,
    setTagGroup,
    tagGroupsOf,
  } = useRecipeStore();

  const [section, setSection] = useState<SectionKey>("category");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(CATEGORY_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingNameEn, setEditingNameEn] = useState("");
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingGroupNameEn, setEditingGroupNameEn] = useState("");
  /** tag id showing the "assign to group" picker */
  const [groupPickerId, setGroupPickerId] = useState<string | null>(null);

  const rows: RowData[] = useMemo(() => {
    if (section === "category") {
      return categories.map((c) => ({
        id: c.id,
        name: c.name,
        nameEn: c.nameEn ?? "",
        color: c.color,
        count: recipes.filter((r) => r.categoryId === c.id).length,
      }));
    }
    if (!isTagKind(section)) return [];
    return tags
      .filter((t) => t.kind === section)
      .map((t) => ({
        id: t.id,
        name: t.name,
        nameEn: t.nameEn ?? "",
        color: t.color,
        groupId: t.groupId ?? null,
        count:
          section === "spirit"
            ? recipes.filter((r) => r.baseSpirit === t.name).length
            : section === "glass"
              ? recipes.filter((r) => r.glass === t.name).length
              : section === "duration"
                ? recipes.filter((r) => r.drinkDuration === t.name).length
                : section === "occasion"
                  ? recipes.filter((r) => r.occasion === t.name).length
                  : recipes.filter((r) => r.flavors.includes(t.name)).length,
      }));
  }, [section, categories, tags, recipes]);

  const groups: TagGroup[] = useMemo(
    () => (isTagKind(section) ? tagGroupsOf(section) : []),
    [section, tagGroupsOf],
  );

  /** For tag sections: rows arranged as grouped blocks (each group + ungrouped tail) */
  const groupedBlocks = useMemo(() => {
    if (!isTagKind(section)) return null;
    const blocks: { group: TagGroup | null; items: RowData[] }[] = [];
    for (const g of groups) {
      blocks.push({ group: g, items: rows.filter((r) => r.groupId === g.id) });
    }
    const grouped = new Set(groups.map((g) => g.id));
    blocks.push({
      group: null,
      items: rows.filter((r) => !r.groupId || !grouped.has(r.groupId)),
    });
    return blocks;
  }, [section, groups, rows]);

  const sectionLabel = t(SECTION_LABEL_KEY[section]);

  const applyOrder = useCallback(
    (orderedIds: string[]) => {
      if (section === "category") reorderCategories(orderedIds);
      else if (isTagKind(section)) reorderTags(section, orderedIds);
    },
    [section, reorderCategories, reorderTags],
  );

  const moveRow = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= rows.length || fromIndex === toIndex) return;
      const ids = rows.map((r) => r.id);
      const [moved] = ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, moved);
      applyOrder(ids);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [rows, applyOrder],
  );

  /** Reorder within one grouped block: rebuild full kind order preserving block boundaries */
  const moveRowInBlock = useCallback(
    (blockItems: RowData[], fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= blockItems.length || fromIndex === toIndex) return;
      const blockIds = blockItems.map((r) => r.id);
      const [moved] = blockIds.splice(fromIndex, 1);
      blockIds.splice(toIndex, 0, moved);
      // Rebuild the whole kind order: iterate current rows and replace the block ids in new order
      const blockSet = new Set(blockIds);
      let bi = 0;
      const orderedIds = rows.map((r) => (blockSet.has(r.id) ? blockIds[bi++] : r.id));
      applyOrder(orderedIds);
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [rows, applyOrder],
  );

  const handleAdd = () => {
    if (!isTagKind(section) && section !== "category") return;
    const created =
      section === "category"
        ? addCategory(newName, newColor)
        : addTag(section as TagKind, newName, newColor);
    if (created) {
      setNewName("");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  };

  const confirmDelete = (row: RowData) => {
    let message = t("tags.delete.confirm", { name: row.name });
    if (section === "category" && row.count > 0) {
      message =
        lang === "zh"
          ? `「${row.name}」下有 ${row.count} 份配方,删除后它们将变为未分类。`
          : `"${row.name}" has ${row.count} recipes. They will become uncategorized.`;
    } else if (section === "flavor" && row.count > 0) {
      message =
        lang === "zh"
          ? `「${row.name}」被 ${row.count} 份配方使用,删除后将从这些配方中移除。`
          : `"${row.name}" is used by ${row.count} recipes and will be removed from them.`;
    } else if ((section === "spirit" || section === "glass") && row.count > 0) {
      message =
        lang === "zh"
          ? `「${row.name}」被 ${row.count} 份配方使用,删除标签不会修改这些配方的文字记录。`
          : `"${row.name}" is used by ${row.count} recipes. Deleting the tag won't change their text.`;
    }
    const doDelete = () =>
      section === "category" ? deleteCategory(row.id) : deleteTag(row.id);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) doDelete();
      return;
    }
    Alert.alert(t("tags.delete.title", { s: sectionLabel }), message, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: doDelete },
    ]);
  };

  const commitEdit = () => {
    if (editingId && editingName.trim()) {
      if (section === "category") renameCategory(editingId, editingName);
      else renameTag(editingId, editingName);
    }
    if (editingId) {
      if (section === "category") setCategoryNameEn(editingId, editingNameEn);
      else setTagNameEn(editingId, editingNameEn);
    }
    setEditingId(null);
    setEditingName("");
    setEditingNameEn("");
  };

  const pickColor = (rowId: string, color: string) => {
    if (section === "category") setCategoryColor(rowId, color);
    else setTagColor(rowId, color);
    setColorPickerId(null);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleAddGroup = () => {
    if (!isTagKind(section)) return;
    const created = addTagGroup(section, newGroupName);
    if (created) {
      setNewGroupName("");
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  };

  const commitGroupEdit = () => {
    if (editingGroupId && editingGroupName.trim()) {
      renameTagGroup(editingGroupId, editingGroupName);
    }
    if (editingGroupId) setTagGroupNameEn(editingGroupId, editingGroupNameEn);
    setEditingGroupId(null);
    setEditingGroupName("");
    setEditingGroupNameEn("");
  };

  const moveGroup = (index: number, dir: -1 | 1) => {
    if (!isTagKind(section)) return;
    const to = index + dir;
    if (to < 0 || to >= groups.length) return;
    const ids = groups.map((g) => g.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved);
    reorderTagGroups(section, ids);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const confirmDeleteGroup = (g: TagGroup) => {
    const message = t("tg.deleteGroup.confirm", { name: g.name });
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) deleteTagGroup(g.id);
      return;
    }
    Alert.alert(t("tg.deleteGroup"), message, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: () => deleteTagGroup(g.id) },
    ]);
  };

  return (
    <ScreenContainer>
      <View className="px-5 pt-2 pb-3 flex-row items-center" style={{ gap: 8 }}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [{ padding: 4, marginLeft: -8 }, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={26} color={colors.primary} />
        </Pressable>
        <View className="flex-1">
          <Text className="text-3xl font-bold text-foreground">{t("tags.title")}</Text>
          <Text className="text-sm text-muted mt-1">
            {t("tags.subtitle")}
          </Text>
        </View>
      </View>

      {/* Section switcher */}
      <View className="px-5 pb-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="bg-surface border border-border rounded-xl"
          contentContainerStyle={{ padding: 4 }}
        >
          {SECTION_KEYS.map((key) => {
            const active = section === key;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  setSection(key);
                  setEditingId(null);
                  setColorPickerId(null);
                }}
                style={[
                  styles.segment,
                  styles.segmentScroll,
                  active && { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? "#FFFFFF" : colors.muted },
                  ]}
                >
                  {t(SECTION_LABEL_KEY[key])}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={draggingId === null}
      >
        {section === "bottleCat" ? (
          <BottleTaxonomyManager />
        ) : section === "prepSec" ? (
          <PrepTaxonomyManager />
        ) : (
        <>
        {/* Add new */}
        <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <TextInput
              className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
              placeholder={t("tags.new.placeholder", { s: sectionLabel })}
              placeholderTextColor={colors.muted}
              value={newName}
              onChangeText={setNewName}
              returnKeyType="done"
              onSubmitEditing={handleAdd}
              style={{ lineHeight: 20 }}
            />
            <Pressable
              onPress={handleAdd}
              disabled={!newName.trim()}
              style={({ pressed }) => [
                styles.addBtn,
                { backgroundColor: newName.trim() ? colors.primary : colors.border },
                pressed && newName.trim() && { transform: [{ scale: 0.95 }], opacity: 0.9 },
              ]}
            >
              <IconSymbol name="plus" size={22} color={newName.trim() ? "#FFFFFF" : colors.muted} />
            </Pressable>
          </View>
          <View className="flex-row mt-3" style={{ gap: 10 }}>
            <View style={{ flex: 1 }}>
              <ColorPickerPanel value={newColor} onChange={setNewColor} />
            </View>
          </View>
          <Text className="text-xs text-muted mt-2.5" style={{ lineHeight: 16 }}>
            {t("tags.autofill.hint")}
          </Text>
        </View>

        {/* Tag group manager (tag sections only) */}
        {section !== "category" ? (
          <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
            <Text className="text-xs text-muted uppercase mb-2" style={{ letterSpacing: 0.4, lineHeight: 16 }}>
              {t("tg.groups")}
            </Text>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <TextInput
                className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-[15px] text-foreground"
                placeholder={t("tg.newGroup")}
                placeholderTextColor={colors.muted}
                value={newGroupName}
                onChangeText={setNewGroupName}
                returnKeyType="done"
                onSubmitEditing={handleAddGroup}
                style={{ lineHeight: 20 }}
              />
              <Pressable
                onPress={handleAddGroup}
                disabled={!newGroupName.trim()}
                style={({ pressed }) => [
                  styles.addBtnSm,
                  { backgroundColor: newGroupName.trim() ? colors.primary : colors.border },
                  pressed && newGroupName.trim() && { opacity: 0.85 },
                ]}
              >
                <IconSymbol name="plus" size={18} color={newGroupName.trim() ? "#FFFFFF" : colors.muted} />
              </Pressable>
            </View>
            {groups.map((g, gi) => {
              const isEditingG = editingGroupId === g.id;
              const tagCount = rows.filter((r) => r.groupId === g.id).length;
              return (
                <View
                  key={g.id}
                  className="flex-row items-center mt-2.5"
                  style={{ gap: 8 }}
                >
                  <IconSymbol name="folder.fill" size={16} color={colors.primary} />
                  {isEditingG ? (
                    <View className="flex-1" style={{ gap: 4 }}>
                      <TextInput
                        className="bg-background border border-border rounded-lg px-2 py-1 text-[15px] text-foreground"
                        value={editingGroupName}
                        onChangeText={setEditingGroupName}
                        autoFocus
                        returnKeyType="done"
                        placeholder={t("tags.edit.zh")}
                        placeholderTextColor={colors.muted}
                        onSubmitEditing={commitGroupEdit}
                        style={{ lineHeight: 20 }}
                      />
                      <TextInput
                        className="bg-background border border-border rounded-lg px-2 py-1 text-[15px] text-foreground"
                        value={editingGroupNameEn}
                        onChangeText={setEditingGroupNameEn}
                        returnKeyType="done"
                        placeholder={t("tags.edit.en")}
                        placeholderTextColor={colors.muted}
                        onSubmitEditing={commitGroupEdit}
                        style={{ lineHeight: 20 }}
                      />
                    </View>
                  ) : (
                    <View className="flex-1">
                      <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
                        {displayNames(g.nameEn ?? "", g.name, lang).primary}
                        {displayNames(g.nameEn ?? "", g.name, lang).secondary ? (
                          <Text className="text-xs text-muted">
                            {"  "}
                            {displayNames(g.nameEn ?? "", g.name, lang).secondary}
                          </Text>
                        ) : null}
                        <Text className="text-xs text-muted">  {t("tg.tagCount", { n: tagCount })}</Text>
                      </Text>
                    </View>
                  )}
                  <Pressable onPress={() => moveGroup(gi, -1)} hitSlop={6} disabled={gi === 0} style={({ pressed }) => [pressed && { opacity: 0.6 }, gi === 0 && { opacity: 0.25 }]}>
                    <IconSymbol name="chevron.up" size={18} color={colors.muted} />
                  </Pressable>
                  <Pressable onPress={() => moveGroup(gi, 1)} hitSlop={6} disabled={gi === groups.length - 1} style={({ pressed }) => [pressed && { opacity: 0.6 }, gi === groups.length - 1 && { opacity: 0.25 }]}>
                    <IconSymbol name="chevron.down" size={18} color={colors.muted} />
                  </Pressable>
                  {isEditingG ? (
                    <Pressable onPress={commitGroupEdit} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                      <IconSymbol name="checkmark" size={18} color={colors.primary} />
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => {
                        setEditingGroupId(g.id);
                        setEditingGroupName(g.name);
                        setEditingGroupNameEn(g.nameEn ?? "");
                      }}
                      hitSlop={6}
                      style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                    >
                      <IconSymbol name="pencil" size={17} color={colors.muted} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => confirmDeleteGroup(g)} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                    <IconSymbol name="trash.fill" size={17} color={colors.error} />
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}

        {rows.length === 0 ? (
          <View className="items-center pt-12 px-8">
            <Text className="text-base text-muted text-center">
              {t("tags.empty", { s: sectionLabel })}
            </Text>
          </View>
        ) : section === "category" || !groupedBlocks ? (
          <View className="bg-surface rounded-xl overflow-hidden">
          {rows.map((item, index) => {
            const isEditing = editingId === item.id;
            const showPicker = colorPickerId === item.id;
            return (
              <DraggableRow
                key={item.id}
                index={index}
                total={rows.length}
                onMove={moveRow}
                onDragStateChange={(dragging) => setDraggingId(dragging ? item.id : null)}
              >
              <View
                className="bg-surface px-4 py-2.5"
                style={draggingId === item.id ? { backgroundColor: colors.primary + "14" } : undefined}
              >
                <View className="flex-row items-center">
                  <View style={{ marginRight: 10 }}>
                    <IconSymbol name="line.3.horizontal" size={18} color={colors.muted} />
                  </View>
                  <Pressable
                    onPress={() => setColorPickerId(showPicker ? null : item.id)}
                    hitSlop={6}
                  >
                    <View
                      style={[
                        styles.colorDot,
                        { backgroundColor: item.color, marginRight: 12 },
                      ]}
                    />
                  </Pressable>
                  {isEditing ? (
                    <View className="flex-1" style={{ gap: 6 }}>
                      <TextInput
                        className="bg-background border border-border rounded-lg px-2 py-1.5 text-base text-foreground"
                        value={editingName}
                        onChangeText={setEditingName}
                        autoFocus
                        returnKeyType="done"
                        placeholder={t("tags.edit.zh")}
                        placeholderTextColor={colors.muted}
                        onSubmitEditing={commitEdit}
                        style={{ lineHeight: 20 }}
                      />
                      <TextInput
                        className="bg-background border border-border rounded-lg px-2 py-1.5 text-base text-foreground"
                        value={editingNameEn}
                        onChangeText={setEditingNameEn}
                        returnKeyType="done"
                        placeholder={t("tags.edit.en")}
                        placeholderTextColor={colors.muted}
                        onSubmitEditing={commitEdit}
                        style={{ lineHeight: 20 }}
                      />
                    </View>
                  ) : (
                    <View className="flex-1">
                      <Text className="text-base font-medium text-foreground">
                        {displayNames(item.nameEn, item.name, lang).primary}
                      </Text>
                      <Text className="text-xs text-muted mt-0.5">
                        {displayNames(item.nameEn, item.name, lang).secondary
                          ? `${displayNames(item.nameEn, item.name, lang).secondary} · `
                          : ""}
                        {t("tags.count", { n: item.count })}
                      </Text>
                    </View>
                  )}
                  <View className="flex-row items-center" style={{ gap: 16, marginLeft: 8 }}>
                    {isEditing ? (
                      <Pressable onPress={commitEdit} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                        <IconSymbol name="checkmark" size={22} color={colors.primary} />
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => {
                          setEditingId(item.id);
                          setEditingName(item.name);
                          setEditingNameEn(item.nameEn);
                        }}
                        hitSlop={8}
                        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                      >
                        <IconSymbol name="pencil" size={20} color={colors.muted} />
                      </Pressable>
                    )}
                    <Pressable onPress={() => confirmDelete(item)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                      <IconSymbol name="trash.fill" size={20} color={colors.error} />
                    </Pressable>
                  </View>
                </View>
                {showPicker ? (
                  <View className="flex-row mt-3 pt-3 border-t border-border" style={{ gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <ColorPickerPanel value={item.color} onChange={(c) => pickColor(item.id, c)} />
                    </View>
                  </View>
                ) : null}
              </View>
              {index < rows.length - 1 ? (
                <View
                  className="bg-border"
                  style={{ height: StyleSheet.hairlineWidth, marginLeft: 58 }}
                />
              ) : null}
              </DraggableRow>
            );
          })}
          </View>
        ) : (
          <View>
            {groupedBlocks.map((block) => {
              if (block.items.length === 0) return null;
              return (
                <View key={block.group?.id ?? "ungrouped"} className="mb-4">
                  <View className="flex-row items-center mb-1.5 px-1" style={{ gap: 5 }}>
                    <IconSymbol
                      name="folder.fill"
                      size={13}
                      color={block.group ? colors.primary : colors.muted}
                    />
                    <Text
                      className="text-[13px] text-muted uppercase"
                      style={{ letterSpacing: 0.4, lineHeight: 17 }}
                    >
                      {block.group
                        ? displayNames(block.group.nameEn ?? "", block.group.name, lang).primary
                        : t("tg.ungrouped")}{" "}
                      · {block.items.length}
                    </Text>
                  </View>
                  <View className="bg-surface rounded-xl overflow-hidden">
                    {block.items.map((item, index) => {
                      const isEditing = editingId === item.id;
                      const showPicker = colorPickerId === item.id;
                      const showGroupPicker = groupPickerId === item.id;
                      return (
                        <DraggableRow
                          key={item.id}
                          index={index}
                          total={block.items.length}
                          onMove={(from, to) => moveRowInBlock(block.items, from, to)}
                          onDragStateChange={(dragging) => setDraggingId(dragging ? item.id : null)}
                        >
                          <View
                            className="bg-surface px-4 py-2.5"
                            style={draggingId === item.id ? { backgroundColor: colors.primary + "14" } : undefined}
                          >
                            <View className="flex-row items-center">
                              <View style={{ marginRight: 10 }}>
                                <IconSymbol name="line.3.horizontal" size={18} color={colors.muted} />
                              </View>
                              <Pressable
                                onPress={() => setColorPickerId(showPicker ? null : item.id)}
                                hitSlop={6}
                              >
                                <View
                                  style={[
                                    styles.colorDot,
                                    { backgroundColor: item.color, marginRight: 12 },
                                  ]}
                                />
                              </Pressable>
                              {isEditing ? (
                                <View className="flex-1" style={{ gap: 6 }}>
                                  <TextInput
                                    className="bg-background border border-border rounded-lg px-2 py-1.5 text-base text-foreground"
                                    value={editingName}
                                    onChangeText={setEditingName}
                                    autoFocus
                                    returnKeyType="done"
                                    placeholder={t("tags.edit.zh")}
                                    placeholderTextColor={colors.muted}
                                    onSubmitEditing={commitEdit}
                                    style={{ lineHeight: 20 }}
                                  />
                                  <TextInput
                                    className="bg-background border border-border rounded-lg px-2 py-1.5 text-base text-foreground"
                                    value={editingNameEn}
                                    onChangeText={setEditingNameEn}
                                    returnKeyType="done"
                                    placeholder={t("tags.edit.en")}
                                    placeholderTextColor={colors.muted}
                                    onSubmitEditing={commitEdit}
                                    style={{ lineHeight: 20 }}
                                  />
                                </View>
                              ) : (
                                <View className="flex-1">
                                  <Text className="text-base font-medium text-foreground">
                                    {displayNames(item.nameEn, item.name, lang).primary}
                                  </Text>
                                  <Text className="text-xs text-muted mt-0.5">
                                    {displayNames(item.nameEn, item.name, lang).secondary
                                      ? `${displayNames(item.nameEn, item.name, lang).secondary} · `
                                      : ""}
                                    {t("tags.count", { n: item.count })}
                                  </Text>
                                </View>
                              )}
                              <View className="flex-row items-center" style={{ gap: 14, marginLeft: 8 }}>
                                <Pressable
                                  onPress={() => setGroupPickerId(showGroupPicker ? null : item.id)}
                                  hitSlop={8}
                                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                                >
                                  <IconSymbol
                                    name="folder.fill"
                                    size={19}
                                    color={showGroupPicker ? colors.primary : colors.muted}
                                  />
                                </Pressable>
                                {isEditing ? (
                                  <Pressable onPress={commitEdit} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                                    <IconSymbol name="checkmark" size={22} color={colors.primary} />
                                  </Pressable>
                                ) : (
                                  <Pressable
                                    onPress={() => {
                                      setEditingId(item.id);
                                      setEditingName(item.name);
                                      setEditingNameEn(item.nameEn);
                                    }}
                                    hitSlop={8}
                                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                                  >
                                    <IconSymbol name="pencil" size={20} color={colors.muted} />
                                  </Pressable>
                                )}
                                <Pressable onPress={() => confirmDelete(item)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                                  <IconSymbol name="trash.fill" size={20} color={colors.error} />
                                </Pressable>
                              </View>
                            </View>
                            {showPicker ? (
                              <View className="flex-row mt-3 pt-3 border-t border-border" style={{ gap: 10 }}>
                                <View style={{ flex: 1 }}>
                                  <ColorPickerPanel value={item.color} onChange={(c) => pickColor(item.id, c)} />
                                </View>
                              </View>
                            ) : null}
                            {showGroupPicker ? (
                              <View className="mt-3 pt-3 border-t border-border">
                                <Text className="text-xs text-muted mb-2" style={{ lineHeight: 16 }}>
                                  {t("tg.assignHint")}
                                </Text>
                                <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                                  <Pressable
                                    onPress={() => {
                                      setTagGroup(item.id, null);
                                      setGroupPickerId(null);
                                    }}
                                    style={[
                                      styles.groupChip,
                                      {
                                        backgroundColor: !item.groupId ? colors.primary : colors.background,
                                        borderColor: !item.groupId ? colors.primary : colors.border,
                                      },
                                    ]}
                                  >
                                    <Text style={[styles.groupChipText, { color: !item.groupId ? "#FFFFFF" : colors.foreground }]}>
                                      {t("tg.ungrouped")}
                                    </Text>
                                  </Pressable>
                                  {groups.map((g) => {
                                    const active = item.groupId === g.id;
                                    return (
                                      <Pressable
                                        key={g.id}
                                        onPress={() => {
                                          setTagGroup(item.id, g.id);
                                          setGroupPickerId(null);
                                        }}
                                        style={[
                                          styles.groupChip,
                                          {
                                            backgroundColor: active ? colors.primary : colors.background,
                                            borderColor: active ? colors.primary : colors.border,
                                          },
                                        ]}
                                      >
                                        <Text style={[styles.groupChipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                                          {displayNames(g.nameEn ?? "", g.name, lang).primary}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              </View>
                            ) : null}
                          </View>
                          {index < block.items.length - 1 ? (
                            <View
                              className="bg-border"
                              style={{ height: StyleSheet.hairlineWidth, marginLeft: 58 }}
                            />
                          ) : null}
                        </DraggableRow>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Text className="text-xs text-muted mt-2 px-1" style={{ lineHeight: 18 }}>
          {t("tags.hint")}
        </Text>
        </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnSm: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  groupChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  groupChipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 17,
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: "center",
  },
  segmentScroll: {
    flex: 0,
    paddingHorizontal: 14,
    minWidth: 76,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    ...(Platform.OS === "web" ? ({ whiteSpace: "nowrap" } as object) : null),
  },
  langSeg: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  langSegText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
});
