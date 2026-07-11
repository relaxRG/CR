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
  Switch,
} from "react-native";
import * as Haptics from "expo-haptics";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useMenuStore, MenuGroup, MenuEntry } from "@/lib/menu/store";
import { useRecipeStore } from "@/lib/recipes/store";
import { displayNames } from "@/lib/utils";

// ─── Add Recipe to Group Picker ───────────────────────────────────────────────

interface AddRecipeSheetProps {
  groupId: string;
  onClose: () => void;
}

function AddRecipeSheet({ groupId, onClose }: AddRecipeSheetProps) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { recipes } = useRecipeStore();
  const { addEntry, groups } = useMenuStore();
  const [query, setQuery] = useState("");

  const group = groups.find((g) => g.id === groupId);
  const existingIds = useMemo(
    () => new Set(group?.entries.map((e) => e.recipeId) ?? []),
    [group]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (!q) return true;
      const { primary: zh, secondary: en } = displayNames(r.nameEn, r.name, lang);
      return zh.toLowerCase().includes(q) || en.toLowerCase().includes(q);
    });
  }, [recipes, query, lang]);

  return (
    <View style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
          {t("menu.addRecipe.selectGroup")}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <IconSymbol name="xmark" size={20} color={colors.muted} />
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
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        renderItem={({ item: r }) => {
          const already = existingIds.has(r.id);
          const { primary: zh, secondary: en } = displayNames(r.nameEn, r.name, lang);
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
                addEntry(groupId, r.id);
                if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onClose();
              }}
              disabled={already}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.recipeName, { color: colors.foreground }]} numberOfLines={1}>
                  {zh}
                </Text>
                {en ? (
                  <Text style={[styles.recipeEn, { color: colors.muted }]} numberOfLines={1}>
                    {en}
                  </Text>
                ) : null}
              </View>
              {already ? (
                <Text style={[styles.alreadyBadge, { color: colors.muted }]}>
                  {t("menu.addRecipe.added")}
                </Text>
              ) : (
                <IconSymbol name="plus.circle.fill" size={22} color={colors.primary} />
              )}
            </Pressable>
          );
        }}
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}

// ─── Price Edit Inline ─────────────────────────────────────────────────────────

interface PriceInputProps {
  groupId: string;
  entry: MenuEntry;
}

function PriceInput({ groupId, entry }: PriceInputProps) {
  const colors = useColors();
  const { setPrice } = useMenuStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.price != null ? String(entry.price) : "");

  const commit = () => {
    const val = parseFloat(text);
    setPrice(groupId, entry.id, isNaN(val) ? null : val);
    setEditing(false);
  };

  if (editing) {
    return (
      <TextInput
        style={[styles.priceInput, { color: colors.foreground, borderColor: colors.primary }]}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
        autoFocus
        onBlur={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
        placeholder="0"
        placeholderTextColor={colors.muted}
      />
    );
  }

  return (
    <Pressable onPress={() => setEditing(true)} style={styles.priceBadge}>
      <Text style={[styles.priceText, { color: entry.price != null ? colors.primary : colors.muted }]}>
        {entry.price != null ? `¥${entry.price}` : "¥—"}
      </Text>
    </Pressable>
  );
}

// ─── Entry Row ─────────────────────────────────────────────────────────────────

interface EntryRowProps {
  groupId: string;
  entry: MenuEntry;
}

function EntryRow({ groupId, entry }: EntryRowProps) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { toggleAvailable, removeEntry } = useMenuStore();
  const { recipes } = useRecipeStore();

  const recipe = recipes.find((r) => r.id === entry.recipeId);
  if (!recipe) return null;

  const { primary: zh, secondary: en } = displayNames(recipe.nameEn, recipe.name, lang);

  return (
    <View style={[styles.entryRow, { borderBottomColor: colors.border }]}>
      {/* 可用状态指示条 */}
      <View
        style={[
          styles.availBar,
          { backgroundColor: entry.available ? colors.success : colors.border },
        ]}
      />
      <View style={{ flex: 1, paddingLeft: 10 }}>
        <Text
          style={[
            styles.entryName,
            { color: entry.available ? colors.foreground : colors.muted },
          ]}
          numberOfLines={1}
        >
          {zh}
        </Text>
        {en ? (
          <Text style={[styles.entryEn, { color: colors.muted }]} numberOfLines={1}>
            {en}
          </Text>
        ) : null}
      </View>
      {/* 售价 */}
      <PriceInput groupId={groupId} entry={entry} />
      {/* 供应开关 */}
      <Switch
        value={entry.available}
        onValueChange={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          toggleAvailable(groupId, entry.id);
        }}
        trackColor={{ false: colors.border, true: colors.success + "80" }}
        thumbColor={entry.available ? colors.success : colors.muted}
        style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
      />
      {/* 删除 */}
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          removeEntry(groupId, entry.id);
        }}
        hitSlop={8}
        style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1, paddingLeft: 4 }]}
      >
        <IconSymbol name="minus.circle.fill" size={20} color={colors.error} />
      </Pressable>
    </View>
  );
}

// ─── Group Card ────────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: MenuGroup;
  onAddRecipe: (groupId: string) => void;
}

function GroupCard({ group, onAddRecipe }: GroupCardProps) {
  const colors = useColors();
  const { t } = useI18n();
  const { toggleCollapse, renameGroup, deleteGroup } = useMenuStore();

  const handleOptions = () => {
    Alert.alert(group.name, undefined, [
      {
        text: t("menu.group.rename"),
        onPress: () => {
          Alert.prompt(
            t("menu.group.rename"),
            undefined,
            (newName) => {
              if (newName?.trim()) renameGroup(group.id, newName.trim());
            },
            "plain-text",
            group.name
          );
        },
      },
      {
        text: t("menu.group.delete"),
        style: "destructive",
        onPress: () => {
          Alert.alert(
            t("menu.group.delete"),
            t("menu.group.delete.confirm"),
            [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("common.delete"), style: "destructive", onPress: () => deleteGroup(group.id) },
            ]
          );
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };

  const availableCount = group.entries.filter((e) => e.available).length;
  const totalCount = group.entries.length;

  return (
    <View style={[styles.groupCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Group Header */}
      <Pressable
        style={({ pressed }) => [
          styles.groupHeader,
          { borderBottomColor: colors.border },
          !group.collapsed && styles.groupHeaderBorder,
          pressed && { opacity: 0.8 },
        ]}
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          toggleCollapse(group.id);
        }}
      >
        <IconSymbol
          name={group.collapsed ? "chevron.right" : "chevron.down"}
          size={16}
          color={colors.muted}
        />
        <Text style={[styles.groupName, { color: colors.foreground }]}>{group.name}</Text>
        <Text style={[styles.groupCount, { color: colors.muted }]}>
          {availableCount}/{totalCount}
        </Text>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onAddRecipe(group.id);
          }}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol name="plus.circle.fill" size={22} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={handleOptions}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, paddingLeft: 2 }]}
        >
          <IconSymbol name="ellipsis" size={20} color={colors.muted} />
        </Pressable>
      </Pressable>

      {/* Entries */}
      {!group.collapsed && (
        <>
          {group.entries.length === 0 ? (
            <View style={styles.groupEmptyWrap}>
              <Text style={[styles.groupEmptyText, { color: colors.muted }]}>
                {t("menu.group.empty")}
              </Text>
            </View>
          ) : (
            group.entries.map((entry) => (
              <EntryRow key={entry.id} groupId={group.id} entry={entry} />
            ))
          )}
        </>
      )}
    </View>
  );
}

// ─── Main Menu Screen ──────────────────────────────────────────────────────────

export default function MenuScreen() {
  const colors = useColors();
  const { t } = useI18n();
  const { groups, addGroup } = useMenuStore();
  const [addingGroupName, setAddingGroupName] = useState("");
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [addRecipeGroupId, setAddRecipeGroupId] = useState<string | null>(null);

  const totalEntries = useMemo(
    () => groups.reduce((sum, g) => sum + g.entries.length, 0),
    [groups]
  );

  const handleCreateGroup = () => {
    const name = addingGroupName.trim();
    if (!name) return;
    addGroup(name);
    setAddingGroupName("");
    setShowAddGroup(false);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListHeaderComponent={
          <>
            {/* 新建分组输入框 */}
            {showAddGroup && (
              <View style={[styles.addGroupRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.addGroupInput, { color: colors.foreground }]}
                  placeholder={t("menu.addGroup.placeholder")}
                  placeholderTextColor={colors.muted}
                  value={addingGroupName}
                  onChangeText={setAddingGroupName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={handleCreateGroup}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.addGroupBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={handleCreateGroup}
                >
                  <Text style={styles.addGroupBtnText}>{t("menu.addGroup.confirm")}</Text>
                </Pressable>
                <Pressable onPress={() => setShowAddGroup(false)} hitSlop={8}>
                  <IconSymbol name="xmark" size={18} color={colors.muted} />
                </Pressable>
              </View>
            )}
            {/* 空状态 */}
            {groups.length === 0 && !showAddGroup && (
              <View style={styles.emptyWrap}>
                <IconSymbol name="storefront" size={48} color={colors.border} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  {t("menu.empty.title")}
                </Text>
                <Text style={[styles.emptyDesc, { color: colors.muted }]}>
                  {t("menu.empty.desc")}
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.emptyBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                  ]}
                  onPress={() => setShowAddGroup(true)}
                >
                  <IconSymbol name="plus" size={16} color="#fff" />
                  <Text style={styles.emptyBtnText}>{t("menu.addGroup")}</Text>
                </Pressable>
              </View>
            )}
          </>
        }
        renderItem={({ item: group }) => (
          <GroupCard
            group={group}
            onAddRecipe={(gid) => setAddRecipeGroupId(gid)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />

      {/* FAB - 新建分组 */}
      {groups.length > 0 && (
        <Pressable
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setShowAddGroup(true);
          }}
        >
          <IconSymbol name="folder.badge.plus" size={24} color="#fff" />
        </Pressable>
      )}

      {/* Add Recipe Sheet (overlay) */}
      {addRecipeGroupId != null && (
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable
            style={[styles.sheetOverlay, { backgroundColor: "rgba(0,0,0,0.4)" }]}
            onPress={() => setAddRecipeGroupId(null)}
          />
          <View style={[styles.sheetContainer, { backgroundColor: colors.background }]}>
            <AddRecipeSheet
              groupId={addRecipeGroupId}
              onClose={() => setAddRecipeGroupId(null)}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Group card
  groupCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 4,
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  groupHeaderBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  groupCount: {
    fontSize: 12,
    fontWeight: "500",
  },
  groupEmptyWrap: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  groupEmptyText: {
    fontSize: 13,
    lineHeight: 18,
  },
  // Entry row
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  availBar: {
    width: 3,
    alignSelf: "stretch",
    borderRadius: 2,
    marginLeft: 4,
  },
  entryName: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 19,
  },
  entryEn: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  // Price
  priceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 4,
  },
  priceText: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  priceInput: {
    width: 64,
    fontSize: 13,
    fontWeight: "600",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
    textAlign: "right",
  },
  // Add group
  addGroupRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
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
  // Empty state
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
  // Add recipe sheet
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
});
