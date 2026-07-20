import { Lang, TranslationKey } from "@/lib/i18n/translations";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActionSheetIOS,
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
import { IOSColorPickerSheet } from "@/components/ios-color-picker";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { displayNames } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useRecipeStore } from "@/lib/recipes/store";
import { CATEGORY_COLORS, CategoryGroup, TagGroup, TagKind } from "@/lib/recipes/types";

type SectionKey = "category" | TagKind;

const SECTION_KEYS: SectionKey[] = ["category", "spirit", "glass", "flavor"];
const isTagKind = (s: SectionKey): s is TagKind =>
  s === "spirit" || s === "glass" || s === "flavor";
/** 系统标签分组（固定，不可增删改名） */
const SYSTEM_SECTIONS = ["duration", "occasion"] as const;
type SystemSection = (typeof SYSTEM_SECTIONS)[number];
const SECTION_LABEL_KEY = {
  category: "tags.section.category",
  spirit: "tags.section.spirit",
  glass: "tags.section.glass",
  flavor: "tags.section.flavor",
  duration: "tags.section.duration",
  occasion: "tags.section.occasion",
} as const;

interface RowData {
  id: string;
  name: string;
  nameEn: string;
  color: string;
  count: number;
  groupId?: string | null;
}

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
      if (to !== index) runOnJS(onMove)(index, to);
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


// ─── 标签 Chip（彩色淡底 + 同色文字）─────────────────────────────────────────
function TagChip({
  name,
  color,
  onPress,
  onColorPress,
  locked,
}: {
  name: string;
  color: string;
  onPress: () => void;
  onColorPress?: () => void;
  locked?: boolean;
}) {
  const bg = color + "22";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: pressed ? color + "33" : bg },
      ]}
    >
      <Pressable
        onPress={() => { onColorPress?.(); }}
        hitSlop={6}
        style={[styles.chipDot, { backgroundColor: color }]}
      />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {name}
      </Text>
      {locked ? (
        <IconSymbol name="lock.fill" size={10} color={color} />
      ) : null}
    </Pressable>
  );
}

// ─── 分组卡片（可折叠）────────────────────────────────────────────────────────
function GroupCard({
  group,
  items,
  rows,
  section,
  lang,
  colors,
  t,
  editingId,
  editingName,
  editingNameEn,
  draggingId,
  groupPickerId,
  groups,
  setEditingId,
  setEditingName,
  setEditingNameEn,
  setDraggingId,
  setGroupPickerId,
  commitEdit,
  confirmDelete,
  pickColor,
  moveRowInBlock,
  setTagGroup,
  onAddTag,
  onEditGroup,
  onDeleteGroup,
  onToggleLockGroup,
  onToggleLockTag,
}: {
  group: TagGroup | null;
  items: RowData[];
  rows: RowData[];
  section: SectionKey;
  lang: Lang;
  colors: ReturnType<typeof useColors>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  editingId: string | null;
  editingName: string;
  editingNameEn: string;
  draggingId: string | null;
  groupPickerId: string | null;
  groups: TagGroup[];
  setEditingId: (id: string | null) => void;
  setEditingName: (n: string) => void;
  setEditingNameEn: (n: string) => void;
  setDraggingId: (id: string | null) => void;
  setGroupPickerId: (id: string | null) => void;
  commitEdit: () => void;
  confirmDelete: (row: RowData) => void;
  pickColor: (id: string, color: string) => void;
  moveRowInBlock: (blockItems: RowData[], from: number, to: number) => void;
  setTagGroup: (tagId: string, groupId: string | null) => void;
  onAddTag: (groupId: string | null) => void;
  onEditGroup: (g: TagGroup) => void;
  onDeleteGroup: (g: TagGroup) => void;
  onToggleLockGroup?: (g: TagGroup) => void;
  onToggleLockTag?: (item: RowData) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const groupName = group
    ? displayNames(group.nameEn ?? "", group.name, lang).primary
    : t("tg.ungrouped");
  const isFlavorFixed = group?.flavorLayer != null;
  const isGroupLocked = group?.locked ?? false;

  return (
    <View
      style={[styles.groupCard, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}
    >
      {/* 卡头 */}
      {isRenaming && group ? (
        <View style={[styles.groupCardHead, { gap: 8 }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <TextInput
              style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={editingName}
              onChangeText={setEditingName}
              autoFocus
              returnKeyType="done"
              placeholder={t("tags.edit.zh")}
              placeholderTextColor={colors.muted}
              onSubmitEditing={() => { commitEdit(); setIsRenaming(false); }}
            />
            <TextInput
              style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={editingNameEn}
              onChangeText={setEditingNameEn}
              returnKeyType="done"
              placeholder={t("tags.edit.en")}
              placeholderTextColor={colors.muted}
              onSubmitEditing={() => { commitEdit(); setIsRenaming(false); }}
            />
          </View>
          <Pressable onPress={() => { commitEdit(); setIsRenaming(false); }} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <IconSymbol name="checkmark" size={22} color={colors.primary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setCollapsed((v) => !v)}
          style={({ pressed }) => [styles.groupCardHead, pressed && { opacity: 0.7 }]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 6 }}>
            {isGroupLocked ? (
              <IconSymbol name="lock.fill" size={14} color={colors.muted} />
            ) : null}
            <Text style={[styles.groupCardTitle, { color: colors.foreground }]} numberOfLines={1}>
              {groupName}
              <Text style={[styles.groupCardCount, { color: colors.muted }]}>
                {"  "}{items.length}
              </Text>
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {group && !isFlavorFixed ? (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const lockOpt = isGroupLocked ? t("tg.unlock") : t("tg.lock");
                  if (Platform.OS === "ios") {
                    const opts = isGroupLocked
                      ? [t("common.cancel"), lockOpt, t("tags.edit.zh")]
                      : [t("common.cancel"), lockOpt, t("tags.edit.zh"), t("common.delete")];
                    ActionSheetIOS.showActionSheetWithOptions(
                      {
                        options: opts,
                        cancelButtonIndex: 0,
                        destructiveButtonIndex: isGroupLocked ? undefined : opts.length - 1,
                      },
                      (idx) => {
                        if (idx === 1) onToggleLockGroup?.(group);
                        if (idx === 2) { onEditGroup(group); setIsRenaming(true); }
                        if (!isGroupLocked && idx === 3) onDeleteGroup(group);
                      },
                    );
                  } else {
                    const btns: any[] = [
                      { text: t("common.cancel"), style: "cancel" },
                      { text: lockOpt, onPress: () => onToggleLockGroup?.(group) },
                      { text: t("tags.edit.zh"), onPress: () => { onEditGroup(group); setIsRenaming(true); } },
                    ];
                    if (!isGroupLocked) btns.push({ text: t("common.delete"), style: "destructive", onPress: () => onDeleteGroup(group) });
                    Alert.alert(groupName, undefined, btns);
                  }
                }}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <IconSymbol name="ellipsis.circle" size={20} color={colors.muted} />
              </Pressable>
            ) : group && isFlavorFixed ? (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  if (Platform.OS === "ios") {
                    ActionSheetIOS.showActionSheetWithOptions(
                      { options: [t("common.cancel"), t("tags.edit.zh")], cancelButtonIndex: 0 },
                      (idx) => { if (idx === 1) { onEditGroup(group); setIsRenaming(true); } },
                    );
                  } else {
                    Alert.alert(groupName, t("tg.flavorFixed"), [
                      { text: t("common.cancel"), style: "cancel" },
                      { text: t("tags.edit.zh"), onPress: () => { onEditGroup(group); setIsRenaming(true); } },
                    ]);
                  }
                }}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <IconSymbol name="ellipsis.circle" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
            <IconSymbol
              name={collapsed ? "chevron.right" : "chevron.down"}
              size={16}
              color={colors.muted}
            />
          </View>
        </Pressable>
      )}

      {/* Chip 墙 */}
      {!collapsed ? (
        <View style={styles.chipWall}>
          {items.map((item) => {
            const isItemLocked = (item as any).locked ?? false;
            return (
              <TagChip
                key={item.id}
                name={displayNames(item.nameEn, item.name, lang).primary}
                color={item.color}
                locked={isItemLocked}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setEditingId(editingId === item.id ? null : item.id);
                  setEditingName(item.name);
                  setEditingNameEn(item.nameEn);
                  setColorPickerId(editingId === item.id ? null : item.id);
                }}
                onColorPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setColorPickerId(colorPickerId === item.id ? null : item.id);
                }}
              />
            );
          })}
          {/* 添加虚线 chip */}
          <Pressable
            onPress={() => onAddTag(group?.id ?? null)}
            style={({ pressed }) => [styles.chipAdd, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
          >
            <IconSymbol name="plus" size={14} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {/* 直接颜色选择器（点色点触发，不需要编辑抽屉） */}
      {colorPickerId && items.some((i) => i.id === colorPickerId) && !editingId ? (
        <IOSColorPickerSheet
          visible={true}
          value={items.find((i) => i.id === colorPickerId)?.color ?? "#888888"}
          onChange={(c) => pickColor(colorPickerId, c)}
          onClose={() => setColorPickerId(null)}
          title={t("tags.color.title")}
        />
      ) : null}
      {/* 编辑抽屉（点击 chip 后展开） */}
      {editingId && items.some((i) => i.id === editingId) && colorPickerId ? (
        <View style={[styles.editDrawer, { borderTopColor: colors.border }]}>
          {(() => {
            const item = items.find((i) => i.id === editingId)!;
            const isItemLocked = (item as any).locked ?? false;
            return (
              <>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  <TextInput
                    style={[styles.editInput, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={editingName}
                    onChangeText={setEditingName}
                    autoFocus
                    returnKeyType="done"
                    placeholder={t("tags.edit.zh")}
                    placeholderTextColor={colors.muted}
                    onSubmitEditing={commitEdit}
                  />
                  <TextInput
                    style={[styles.editInput, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    value={editingNameEn}
                    onChangeText={setEditingNameEn}
                    returnKeyType="done"
                    placeholder={t("tags.edit.en")}
                    placeholderTextColor={colors.muted}
                    onSubmitEditing={commitEdit}
                  />
                </View>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  {/* 颜色预览 + 打开选色器 */}
                  <Pressable
                    onPress={() => setColorPickerId(colorPickerId ? null : item.id)}
                    style={({ pressed }) => [
                      styles.colorPreviewBtn,
                      { backgroundColor: item.color, opacity: pressed ? 0.7 : 1 },
                    ]}
                  />
                  <IOSColorPickerSheet
                    visible={colorPickerId === item.id}
                    value={item.color}
                    onChange={(c) => pickColor(item.id, c)}
                    onClose={() => setColorPickerId(null)}
                    title={t("tags.color.title")}
                  />
                  <View style={{ flex: 1 }} />
                  {/* 分组 */}
                  <Pressable
                    onPress={() => setGroupPickerId(groupPickerId === item.id ? null : item.id)}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol name="folder.fill" size={20} color={groupPickerId === item.id ? colors.primary : colors.muted} />
                  </Pressable>
                  <Pressable onPress={commitEdit} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                    <IconSymbol name="checkmark" size={22} color={colors.primary} />
                  </Pressable>
                  {/* 锁定/解锁按钮 */}
                  <Pressable
                    onPress={() => { onToggleLockTag?.(item); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                    hitSlop={8}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol name={isItemLocked ? "lock.fill" : "lock.open.fill"} size={18} color={isItemLocked ? colors.primary : colors.muted} />
                  </Pressable>
                  {!isItemLocked ? (
                    <Pressable onPress={() => confirmDelete(item)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                      <IconSymbol name="trash.fill" size={20} color={colors.error} />
                    </Pressable>
                  ) : null}
                </View>
                {/* 分组选择 */}
                {groupPickerId === item.id ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>{t("tg.assignHint")}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      <Pressable
                        onPress={() => { setTagGroup(item.id, null); setGroupPickerId(null); }}
                        style={[styles.groupChip, { backgroundColor: !item.groupId ? colors.primary : colors.background, borderColor: !item.groupId ? colors.primary : colors.border }]}
                      >
                        <Text style={[styles.groupChipText, { color: !item.groupId ? "#FFFFFF" : colors.foreground }]}>{t("tg.ungrouped")}</Text>
                      </Pressable>
                      {groups.map((g) => (
                        <Pressable
                          key={g.id}
                          onPress={() => { setTagGroup(item.id, g.id); setGroupPickerId(null); }}
                          style={[styles.groupChip, { backgroundColor: item.groupId === g.id ? colors.primary : colors.background, borderColor: item.groupId === g.id ? colors.primary : colors.border }]}
                        >
                          <Text style={[styles.groupChipText, { color: item.groupId === g.id ? "#FFFFFF" : colors.foreground }]}>
                            {displayNames(g.nameEn ?? "", g.name, lang).primary}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
              </>
            );
          })()}
        </View>
      ) : null}
    </View>
  );
}

// ─── 分类分组卡片（独立组件，避免 renderXxx 中调用 hooks 违规）────────────────
function CategoryGroupCard({
  group,
  items,
  catGroups,
  lang,
  colors,
  t,
  editingId,
  editingName,
  editingNameEn,
  draggingId,
  setEditingId,
  setEditingName,
  setEditingNameEn,
  setDraggingId,
  colorPickerId,
  setColorPickerId,
  editingGroupName,
  editingGroupNameEn,
  setEditingGroupName,
  setEditingGroupNameEn,
  commitEdit,
  commitGroupEdit,
  confirmDelete,
  confirmDeleteGroup,
  handleToggleLockGroup,
  setCategoryGroup,
  toggleCategoryLocked,
  pickColor,
  moveRowInBlock,
  setAddTagGroupId,
}: {
  group: CategoryGroup | null;
  items: RowData[];
  catGroups: CategoryGroup[];
  lang: Lang;
  colors: ReturnType<typeof useColors>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  editingId: string | null;
  editingName: string;
  editingNameEn: string;
  draggingId: string | null;
  setEditingId: (id: string | null) => void;
  setEditingName: (n: string) => void;
  setEditingNameEn: (n: string) => void;
  setDraggingId: (id: string | null) => void;
  colorPickerId: string | null;
  setColorPickerId: (id: string | null) => void;
  editingGroupName: string;
  editingGroupNameEn: string;
  setEditingGroupName: (n: string) => void;
  setEditingGroupNameEn: (n: string) => void;
  commitEdit: () => void;
  commitGroupEdit: () => void;
  confirmDelete: (row: RowData) => void;
  confirmDeleteGroup: (g: CategoryGroup) => void;
  handleToggleLockGroup: (g: CategoryGroup) => void;
  setCategoryGroup: (id: string, groupId: string | null) => void;
  toggleCategoryLocked: (id: string) => void;
  pickColor: (id: string, color: string) => void;
  moveRowInBlock: (blockItems: RowData[], from: number, to: number) => void;
  setAddTagGroupId: (id: string | null | undefined) => void;
}) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const [localRenaming, setLocalRenaming] = useState(false);
  const groupName = group
    ? displayNames(group.nameEn ?? "", group.name, lang).primary
    : t("tg.ungrouped");
  const isGroupLocked = group?.locked ?? false;

  return (
    <View style={[styles.groupCard, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth }]}>
      {/* 卡头 */}
      {localRenaming && group ? (
        <View style={[styles.groupCardHead, { gap: 8 }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <TextInput
              style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={editingGroupName}
              onChangeText={setEditingGroupName}
              autoFocus
              returnKeyType="done"
              placeholder={t("tags.edit.zh")}
              placeholderTextColor={colors.muted}
              onSubmitEditing={() => { commitGroupEdit(); setLocalRenaming(false); }}
            />
            <TextInput
              style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              value={editingGroupNameEn}
              onChangeText={setEditingGroupNameEn}
              returnKeyType="done"
              placeholder={t("tags.edit.en")}
              placeholderTextColor={colors.muted}
              onSubmitEditing={() => { commitGroupEdit(); setLocalRenaming(false); }}
            />
          </View>
          <Pressable onPress={() => { commitGroupEdit(); setLocalRenaming(false); }} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <IconSymbol name="checkmark" size={22} color={colors.primary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={() => setLocalCollapsed((v) => !v)}
          style={({ pressed }) => [styles.groupCardHead, pressed && { opacity: 0.7 }]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 6 }}>
            {isGroupLocked ? <IconSymbol name="lock.fill" size={14} color={colors.muted} /> : null}
            <Text style={[styles.groupCardTitle, { color: colors.foreground }]} numberOfLines={1}>
              {groupName}
              <Text style={[styles.groupCardCount, { color: colors.muted }]}>{"  "}{items.length}</Text>
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {group ? (
              <Pressable
                hitSlop={8}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const lockOpt = isGroupLocked ? t("tg.unlock") : t("tg.lock");
                  if (Platform.OS === "ios") {
                    const opts = isGroupLocked
                      ? [t("common.cancel"), lockOpt, t("tags.edit.zh")]
                      : [t("common.cancel"), lockOpt, t("tags.edit.zh"), t("common.delete")];
                    ActionSheetIOS.showActionSheetWithOptions(
                      { options: opts, cancelButtonIndex: 0, destructiveButtonIndex: isGroupLocked ? undefined : opts.length - 1 },
                      (idx) => {
                        if (idx === 1) { handleToggleLockGroup(group); }
                        if (idx === 2) { setEditingGroupName(group.name); setEditingGroupNameEn(group.nameEn ?? ""); setLocalRenaming(true); }
                        if (!isGroupLocked && idx === 3) confirmDeleteGroup(group);
                      },
                    );
                  } else {
                    const btns: any[] = [
                      { text: t("common.cancel"), style: "cancel" },
                      { text: lockOpt, onPress: () => handleToggleLockGroup(group) },
                      { text: t("tags.edit.zh"), onPress: () => { setEditingGroupName(group.name); setEditingGroupNameEn(group.nameEn ?? ""); setLocalRenaming(true); } },
                    ];
                    if (!isGroupLocked) btns.push({ text: t("common.delete"), style: "destructive", onPress: () => confirmDeleteGroup(group) });
                    Alert.alert(groupName, undefined, btns);
                  }
                }}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <IconSymbol name="ellipsis.circle" size={20} color={colors.muted} />
              </Pressable>
            ) : null}
            <IconSymbol name={localCollapsed ? "chevron.right" : "chevron.down"} size={16} color={colors.muted} />
          </View>
        </Pressable>
      )}
      {/* 分类行列表 */}
      {!localCollapsed ? (
        <View>
          {items.map((item, index) => {
            const isEditing = editingId === item.id;
            const showPicker = colorPickerId === item.id;
            const isItemLocked = (item as any).locked ?? false;
            return (
              <DraggableRow
                key={item.id}
                index={index}
                total={items.length}
                onMove={(from, to) => moveRowInBlock(items, from, to)}
                onDragStateChange={(dragging) => setDraggingId(dragging ? item.id : null)}
              >
                <View style={[
                  styles.catRow,
                  { borderBottomColor: colors.border },
                  draggingId === item.id ? { backgroundColor: colors.primary + "14" } : { backgroundColor: colors.surface },
                  index === items.length - 1 ? { borderBottomWidth: 0 } : null,
                ]}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={{ marginRight: 10 }}>
                      <IconSymbol name="line.3.horizontal" size={18} color={colors.muted} />
                    </View>
                    <Pressable onPress={() => setColorPickerId(showPicker ? null : item.id)} hitSlop={6}>
                      <View style={[styles.colorDot, { backgroundColor: item.color, marginRight: 12 }]} />
                    </Pressable>
                    {isEditing ? (
                      <View style={{ flex: 1, gap: 6 }}>
                        <TextInput
                          style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                          value={editingName}
                          onChangeText={setEditingName}
                          autoFocus
                          returnKeyType="done"
                          placeholder={t("tags.edit.zh")}
                          placeholderTextColor={colors.muted}
                          onSubmitEditing={commitEdit}
                        />
                        <TextInput
                          style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                          value={editingNameEn}
                          onChangeText={setEditingNameEn}
                          returnKeyType="done"
                          placeholder={t("tags.edit.en")}
                          placeholderTextColor={colors.muted}
                          onSubmitEditing={commitEdit}
                        />
                        {/* 分组选择 */}
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                          <Text style={{ fontSize: 12, color: colors.muted, width: "100%", marginBottom: 2 }}>{t("tg.assignHint")}</Text>
                          <Pressable
                            onPress={() => setCategoryGroup(item.id, null)}
                            style={[styles.groupChip, { backgroundColor: !item.groupId ? colors.primary : colors.background, borderColor: !item.groupId ? colors.primary : colors.border }]}
                          >
                            <Text style={[styles.groupChipText, { color: !item.groupId ? "#FFFFFF" : colors.foreground }]}>{t("tg.ungrouped")}</Text>
                          </Pressable>
                          {catGroups.map((g) => (
                            <Pressable
                              key={g.id}
                              onPress={() => setCategoryGroup(item.id, g.id)}
                              style={[styles.groupChip, { backgroundColor: item.groupId === g.id ? colors.primary : colors.background, borderColor: item.groupId === g.id ? colors.primary : colors.border }]}
                            >
                              <Text style={[styles.groupChipText, { color: item.groupId === g.id ? "#FFFFFF" : colors.foreground }]}>
                                {displayNames(g.nameEn ?? "", g.name, lang).primary}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : (
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          {isItemLocked ? <IconSymbol name="lock.fill" size={12} color={colors.muted} /> : null}
                          <Text style={{ fontSize: 16, fontWeight: "500", color: colors.foreground }}>
                            {displayNames(item.nameEn, item.name, lang).primary}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                          {displayNames(item.nameEn, item.name, lang).secondary
                            ? `${displayNames(item.nameEn, item.name, lang).secondary} · `
                            : ""}
                          {t("tags.count", { n: item.count })}
                        </Text>
                      </View>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginLeft: 8 }}>
                      {isEditing ? (
                        <Pressable onPress={commitEdit} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                          <IconSymbol name="checkmark" size={22} color={colors.primary} />
                        </Pressable>
                      ) : (
                        <>
                          <Pressable
                            onPress={() => { setEditingId(item.id); setEditingName(item.name); setEditingNameEn(item.nameEn); }}
                            hitSlop={8}
                            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                          >
                            <IconSymbol name="pencil" size={20} color={colors.muted} />
                          </Pressable>
                          <Pressable
                            onPress={() => toggleCategoryLocked(item.id)}
                            hitSlop={8}
                            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                          >
                            <IconSymbol name={isItemLocked ? "lock.fill" : "lock.open.fill"} size={18} color={isItemLocked ? colors.primary : colors.muted} />
                          </Pressable>
                          {!isItemLocked ? (
                            <Pressable onPress={() => confirmDelete(item)} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                              <IconSymbol name="trash.fill" size={20} color={colors.error} />
                            </Pressable>
                          ) : null}
                        </>
                      )}
                    </View>
                  </View>
                  {showPicker ? (
                    <IOSColorPickerSheet
                      visible={showPicker}
                      value={item.color}
                      onChange={(c) => pickColor(item.id, c)}
                      onClose={() => setColorPickerId(null)}
                      title={t("tags.color.title")}
                    />
                  ) : null}
                </View>
              </DraggableRow>
            );
          })}
          {/* 添加分类按钮（在分组内） */}
          <Pressable
            onPress={() => setAddTagGroupId(group?.id ?? null)}
            style={({ pressed }) => [styles.catRow, { borderBottomWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, opacity: pressed ? 0.6 : 1 }]}
          >
            <IconSymbol name="plus" size={16} color={colors.primary} />
            <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "500" }}>{t("tags.add.category")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ─── 主屏 ────────────────────────────────────────────────────────────────────
export default function CategoriesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, lang } = useI18n();
  const {
    categories,
    categoryGroups,
    recipes,
    tags,
    tagGroups,
    addCategory,
    renameCategory,
    setCategoryNameEn,
    setCategoryColor,
    deleteCategory,
    reorderCategories,
    addCategoryGroup,
    renameCategoryGroup,
    setCategoryGroupNameEn,
    deleteCategoryGroup,
    reorderCategoryGroups,
    setCategoryGroup,
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
    toggleTagLocked,
    toggleTagGroupLocked,
    toggleCategoryLocked,
    toggleCategoryGroupLocked,
  } = useRecipeStore();

  const [section, setSection] = useState<SectionKey>("category");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(CATEGORY_COLORS[0] as string);
  const [newColorPickerOpen, setNewColorPickerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingNameEn, setEditingNameEn] = useState("");
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [editingGroupNameEn, setEditingGroupNameEn] = useState("");
  const [groupPickerId, setGroupPickerId] = useState<string | null>(null);
  // 添加标签 sheet（带 groupId）
  const [addTagGroupId, setAddTagGroupId] = useState<string | null | undefined>(undefined);
  const [addTagName, setAddTagName] = useState("");
  const [addTagColor, setAddTagColor] = useState<string>(CATEGORY_COLORS[0]);
  const [addTagColorPickerOpen, setAddTagColorPickerOpen] = useState(false);
  // 添加分组 sheet（category 专用）
  const [showAddCategoryGroup, setShowAddCategoryGroup] = useState(false);
  // 添加分组 sheet（spirit/glass 专用）
  const [showAddTagGroup, setShowAddTagGroup] = useState(false);
  // ── 行数据 ──────────────────────────────────────────────────────────────────
  const rows: RowData[] = useMemo(() => {
    if (section === "category") {
      return categories.map((c) => ({
        id: c.id,
        name: c.name,
        nameEn: c.nameEn ?? "",
        color: c.color,
        count: recipes.filter((r) => r.categoryId === c.id).length,
        groupId: c.groupId ?? null,
        locked: c.locked,
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
        locked: t.locked,
        count:
          section === "spirit"
            ? recipes.filter((r) => r.baseSpirit === t.name).length
            : section === "glass"
              ? recipes.filter((r) => r.glass === t.name).length
              : recipes.filter((r) => r.flavors.includes(t.name)).length,
      }));
  }, [section, categories, tags, recipes]);

  // ── 分组数据 ────────────────────────────────────────────────────────────────
  const groups: TagGroup[] = useMemo(
    () => (isTagKind(section) ? tagGroupsOf(section) : []),
    [section, tagGroupsOf],
  );

  const catGroups: CategoryGroup[] = useMemo(
    () => (section === "category" ? categoryGroups : []),
    [section, categoryGroups],
  );

  const groupedBlocks = useMemo(() => {
    if (section === "category") {
      const blocks: { group: CategoryGroup | null; items: RowData[] }[] = [];
      for (const g of catGroups) {
        blocks.push({ group: g, items: rows.filter((r) => r.groupId === g.id) });
      }
      const grouped = new Set(catGroups.map((g) => g.id));
      blocks.push({ group: null, items: rows.filter((r) => !r.groupId || !grouped.has(r.groupId)) });
      return blocks;
    }
    if (!isTagKind(section)) return null;
    const blocks: { group: TagGroup | null; items: RowData[] }[] = [];
    for (const g of groups) {
      blocks.push({ group: g, items: rows.filter((r) => r.groupId === g.id) });
    }
    const grouped = new Set(groups.map((g) => g.id));
    blocks.push({ group: null, items: rows.filter((r) => !r.groupId || !grouped.has(r.groupId)) });
    return blocks;
  }, [section, catGroups, groups, rows]);

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
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [rows, applyOrder],
  );

  const moveRowInBlock = useCallback(
    (blockItems: RowData[], fromIndex: number, toIndex: number) => {
      if (toIndex < 0 || toIndex >= blockItems.length || fromIndex === toIndex) return;
      const blockIds = blockItems.map((r) => r.id);
      const [moved] = blockIds.splice(fromIndex, 1);
      blockIds.splice(toIndex, 0, moved);
      const blockSet = new Set(blockIds);
      let bi = 0;
      const orderedIds = rows.map((r) => (blockSet.has(r.id) ? blockIds[bi++] : r.id));
      applyOrder(orderedIds);
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const confirmDelete = (row: RowData) => {
    // locked 检查
    if ((row as any).locked) {
      Alert.alert(t("tg.locked.hint"), undefined, [{ text: t("common.cancel"), style: "cancel" }]);
      return;
    }
    let message = t("tags.delete.confirm", { name: row.name });
    if (section === "category" && row.count > 0) {
      message = lang === "zh"
        ? `「${row.name}」下有 ${row.count} 份配方，删除后它们将变为未分类。`
        : `"${row.name}" has ${row.count} recipes. They will become uncategorized.`;
    } else if (section === "flavor" && row.count > 0) {
      message = lang === "zh"
        ? `「${row.name}」被 ${row.count} 份配方使用，删除后将从这些配方中移除。`
        : `"${row.name}" is used by ${row.count} recipes and will be removed from them.`;
    } else if ((section === "spirit" || section === "glass") && row.count > 0) {
      message = lang === "zh"
        ? `「${row.name}」被 ${row.count} 份配方使用，删除标签不会修改这些配方的文字记录。`
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
    setColorPickerId(null);
  };

  const pickColor = (rowId: string, color: string) => {
    if (section === "category") setCategoryColor(rowId, color);
    else setTagColor(rowId, color);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };


  const commitGroupEdit = () => {
    if (editingGroupId && editingGroupName.trim()) {
      if (section === "category") renameCategoryGroup(editingGroupId, editingGroupName);
      else renameTagGroup(editingGroupId, editingGroupName);
    }
    if (editingGroupId) {
      if (section === "category") setCategoryGroupNameEn(editingGroupId, editingGroupNameEn);
      else setTagGroupNameEn(editingGroupId, editingGroupNameEn);
    }
    setEditingGroupId(null);
    setEditingGroupName("");
    setEditingGroupNameEn("");
  };

  const confirmDeleteGroup = (g: TagGroup | CategoryGroup) => {
    if (g.locked) {
      Alert.alert(t("tg.locked.hint"), undefined, [{ text: t("common.cancel"), style: "cancel" }]);
      return;
    }
    const message = t("tg.deleteGroup.confirm", { name: g.name });
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) {
        if (section === "category") deleteCategoryGroup(g.id);
        else deleteTagGroup(g.id);
      }
      return;
    }
    Alert.alert(t("tg.deleteGroup"), message, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive",
        onPress: () => section === "category" ? deleteCategoryGroup(g.id) : deleteTagGroup(g.id),
      },
    ]);
  };

  const handleToggleLockGroup = (g: TagGroup | CategoryGroup) => {
    if (section === "category") toggleCategoryGroupLocked(g.id);
    else toggleTagGroupLocked(g.id);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // 顶部右侧「＋」ActionSheet
  const handleTopAdd = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isFlavor = section === "flavor";
    if (Platform.OS === "ios") {
      if (section === "category") {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [t("common.cancel"), t("tags.add.category"), t("tg.addGroup")],
            cancelButtonIndex: 0,
          },
          (idx) => {
            if (idx === 1) setAddTagGroupId(null);
            if (idx === 2) setShowAddCategoryGroup(true);
          },
        );
      } else if (isTagKind(section) && !isFlavor) {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            options: [t("common.cancel"), t("tags.add.tag", { s: sectionLabel }), t("tg.addGroup")],
            cancelButtonIndex: 0,
          },
          (idx) => {
            if (idx === 1) setAddTagGroupId(null);
            if (idx === 2) setShowAddTagGroup(true);
          },
        );
      } else {
        // flavor: 只能添加标签，分组固定
        setAddTagGroupId(null);
      }
    } else {
      setAddTagGroupId(null);
    }
  };


  return (
    <ScreenContainer>
      {/* 顶部标题栏 */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [{ padding: 4, marginLeft: -8 }, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={26} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>{t("tags.title")}</Text>
        </View>
        {/* 右上「＋添加」胶囊 */}
        <Pressable
            onPress={handleTopAdd}
            style={({ pressed }) => [styles.addCapsule, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <IconSymbol name="plus" size={14} color="#FFFFFF" />
            <Text style={styles.addCapsuleText}>{t("common.add")}</Text>
          </Pressable>
      </View>

      {/* Section switcher */}
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}
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
                  setAddTagGroupId(undefined);
                  setShowAddCategoryGroup(false);
                  setShowAddTagGroup(false);
                  setNewGroupName("");
                }}
                style={[
                  styles.segment,
                  active && { backgroundColor: colors.primary },
                ]}
              >
                <Text style={[styles.segmentText, { color: active ? "#FFFFFF" : colors.muted }]}>
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
        <>
            {/* flavor 固定分组提示 */}
            {section === "flavor" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10, paddingHorizontal: 4 }}>
                <IconSymbol name="info.circle" size={14} color={colors.muted} />
                <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 16 }}>{t("tg.flavorFixed")}</Text>
              </View>
            ) : null}

            {/* 新增标签 / 分类 的内联表单 */}
            {addTagGroupId !== undefined ? (
              <View style={[styles.addCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.addCardTitle, { color: colors.muted }]}>
                  {section === "category" ? t("tags.add.category") : t("tags.add.tag", { s: sectionLabel })}
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput
                    style={[styles.editInput, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    placeholder={t("tags.new.placeholder", { s: sectionLabel })}
                    placeholderTextColor={colors.muted}
                    value={section === "category" ? newName : addTagName}
                    onChangeText={section === "category" ? setNewName : setAddTagName}
                    returnKeyType="done"
                    onSubmitEditing={section === "category" ? handleAdd : () => {
                      if (!isTagKind(section)) return;
                      const n = addTagName.trim();
                      if (!n) return;
                      const created = addTag(section, n, addTagColor);
                      if (created) {
                        setAddTagName("");
                        setAddTagGroupId(undefined);
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }
                    }}
                  />
                  <Pressable
                    onPress={() => section === "category" ? setNewColorPickerOpen(true) : setAddTagColorPickerOpen(true)}
                    style={({ pressed }) => [styles.colorPreviewBtn, { backgroundColor: section === "category" ? newColor : addTagColor, opacity: pressed ? 0.7 : 1 }]}
                  />
                  <Pressable
                    onPress={section === "category" ? handleAdd : () => {
                      if (!isTagKind(section)) return;
                      const n = addTagName.trim();
                      if (!n) return;
                      const created = addTag(section, n, addTagColor);
                      if (created) {
                        setAddTagName("");
                        setAddTagGroupId(undefined);
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }
                    }}
                    disabled={!(section === "category" ? newName.trim() : addTagName.trim())}
                    style={({ pressed }) => [
                      styles.addBtn,
                      { backgroundColor: (section === "category" ? newName.trim() : addTagName.trim()) ? colors.primary : colors.border },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <IconSymbol name="plus" size={22} color={(section === "category" ? newName.trim() : addTagName.trim()) ? "#FFFFFF" : colors.muted} />
                  </Pressable>
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8, lineHeight: 16 }}>
                  {t("tags.autofill.hint")}
                </Text>
              </View>
            ) : null}

            {/* 新增分组表单（category 专用） */}
            {showAddCategoryGroup ? (
              <View style={[styles.addCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.addCardTitle, { color: colors.muted }]}>{t("tg.addGroup")}</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput
                    style={[styles.editInput, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    placeholder={t("tg.newGroup")}
                    placeholderTextColor={colors.muted}
                    value={newGroupName}
                    onChangeText={setNewGroupName}
                    returnKeyType="done"
                    autoFocus
                    onSubmitEditing={() => {
                      const n = newGroupName.trim();
                      if (!n) return;
                      addCategoryGroup(n);
                      setNewGroupName("");
                      setShowAddCategoryGroup(false);
                      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                  />
                  <Pressable
                    onPress={() => {
                      const n = newGroupName.trim();
                      if (!n) return;
                      addCategoryGroup(n);
                      setNewGroupName("");
                      setShowAddCategoryGroup(false);
                      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                    disabled={!newGroupName.trim()}
                    style={({ pressed }) => [
                      styles.addBtn,
                      { backgroundColor: newGroupName.trim() ? colors.primary : colors.border },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <IconSymbol name="plus" size={22} color={newGroupName.trim() ? "#FFFFFF" : colors.muted} />
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* 新增 TagGroup 表单（spirit/glass 专用） */}
            {showAddTagGroup && isTagKind(section) && section !== "flavor" ? (
              <View style={[styles.addCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.addCardTitle, { color: colors.muted }]}>{t("tg.addGroup")}</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <TextInput
                    style={[styles.editInput, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                    placeholder={t("tg.newGroup")}
                    placeholderTextColor={colors.muted}
                    value={newGroupName}
                    onChangeText={setNewGroupName}
                    returnKeyType="done"
                    autoFocus
                    onSubmitEditing={() => {
                      const n = newGroupName.trim();
                      if (!n) return;
                      if (isTagKind(section)) addTagGroup(section, n);
                      setNewGroupName("");
                      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                  />
                  <Pressable
                    onPress={() => {
                      const n = newGroupName.trim();
                      if (!n) return;
                      if (isTagKind(section)) addTagGroup(section, n);
                      setNewGroupName("");
                      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                    disabled={!newGroupName.trim()}
                    style={({ pressed }) => [
                      styles.addBtn,
                      { backgroundColor: newGroupName.trim() ? colors.primary : colors.border },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <IconSymbol name="plus" size={22} color={newGroupName.trim() ? "#FFFFFF" : colors.muted} />
                  </Pressable>
                </View>
              </View>
            ) : null}

            {/* 颜色选择器 Sheet（新增时） */}
            <IOSColorPickerSheet
              visible={newColorPickerOpen}
              value={newColor}
              onChange={setNewColor}
              onClose={() => setNewColorPickerOpen(false)}
              title={t("tags.color.title")}
            />
            <IOSColorPickerSheet
              visible={addTagColorPickerOpen}
              value={addTagColor}
              onChange={setAddTagColor}
              onClose={() => setAddTagColorPickerOpen(false)}
              title={t("tags.color.title")}
            />

            {/* 标签列表 */}
            {rows.length === 0 && section !== "category" ? (
              <View style={{ alignItems: "center", paddingTop: 48, paddingHorizontal: 32 }}>
                <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center" }}>
                  {t("tags.empty", { s: sectionLabel })}
                </Text>
              </View>
            ) : section === "category" ? (
              // category 分组卡片
              <View>
                {(groupedBlocks as { group: CategoryGroup | null; items: RowData[] }[]).map((block) =>
                  <CategoryGroupCard
                    key={block.group?.id ?? "ungrouped"}
                    group={block.group}
                    items={block.items}
                    catGroups={catGroups}
                    lang={lang}
                    colors={colors}
                    t={t}
                    editingId={editingId}
                    editingName={editingName}
                    editingNameEn={editingNameEn}
                    draggingId={draggingId}
                    setEditingId={setEditingId}
                    setEditingName={setEditingName}
                    setEditingNameEn={setEditingNameEn}
                    setDraggingId={setDraggingId}
                    colorPickerId={colorPickerId}
                    setColorPickerId={setColorPickerId}
                    editingGroupName={editingGroupName}
                    editingGroupNameEn={editingGroupNameEn}
                    setEditingGroupName={setEditingGroupName}
                    setEditingGroupNameEn={setEditingGroupNameEn}
                    commitEdit={commitEdit}
                    commitGroupEdit={commitGroupEdit}
                    confirmDelete={confirmDelete}
                    confirmDeleteGroup={confirmDeleteGroup}
                    handleToggleLockGroup={handleToggleLockGroup}
                    setCategoryGroup={setCategoryGroup}
                    toggleCategoryLocked={toggleCategoryLocked}
                    pickColor={pickColor}
                    moveRowInBlock={moveRowInBlock}
                    setAddTagGroupId={setAddTagGroupId}
                  />
                )}
              </View>
            ) : isTagKind(section) && groupedBlocks ? (
              // spirit/glass/flavor 分组卡片
              <View>
              {(groupedBlocks as { group: TagGroup | null; items: RowData[] }[]).map((block) => {
                  const gKey = block.group?.id ?? "ungrouped";
                  return (
                    <GroupCard
                      key={gKey}
                      group={block.group}
                      items={block.items}
                      rows={rows}
                      section={section}
                      lang={lang}
                      colors={colors}
                      t={t}
                      editingId={editingId}
                      editingName={editingName}
                      editingNameEn={editingNameEn}
                      draggingId={draggingId}
                      groupPickerId={groupPickerId}
                      groups={groups}
                      setEditingId={setEditingId}
                      setEditingName={setEditingName}
                      setEditingNameEn={setEditingNameEn}
                      setDraggingId={setDraggingId}
                      setGroupPickerId={setGroupPickerId}
                      commitEdit={commitEdit}
                      confirmDelete={confirmDelete}
                      pickColor={pickColor}
                      moveRowInBlock={moveRowInBlock}
                      setTagGroup={setTagGroup}
                      onAddTag={(gid) => setAddTagGroupId(gid)}
                      onEditGroup={(g) => { setEditingGroupId(g.id); setEditingGroupName(g.name); setEditingGroupNameEn(g.nameEn ?? ""); }}
                      onDeleteGroup={(g) => confirmDeleteGroup(g)}
                      onToggleLockGroup={(g) => handleToggleLockGroup(g)}
                      onToggleLockTag={(item) => { toggleTagLocked(item.id); if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}
                    />
                  );
                })}
              </View>
            ) : null}

            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 8, paddingHorizontal: 4, lineHeight: 18 }}>
              {t("tags.hint")}
            </Text>
        </>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    lineHeight: 41,
  },
  addCapsule: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  addCapsuleText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  addCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  addCardTitle: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    lineHeight: 15,
  },
  groupCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: "hidden",
  },
  groupCardHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  groupCardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  groupCardCount: {
    fontSize: 14,
    fontWeight: "400",
  },
  chipWall: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 17,
    maxWidth: 120,
  },
  chipAdd: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  editDrawer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  catRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  colorPreviewBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  editInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    lineHeight: 20,
  },
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
  segment: {
    flex: 0,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
    minWidth: 76,
    alignItems: "center",
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
    ...(Platform.OS === "web" ? ({ whiteSpace: "nowrap" } as object) : null),
  },
});
