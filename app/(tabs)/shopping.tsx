/**
 * 采购清单页面
 * - 自动聚合所有「在售」配方的原材料
 * - 与酒库（Bottles）和自制库（HomemadePrep）智能匹配
 * - 同一原材料跨配方合并，显示关联配方列表
 * - 两大渠道：网络采购（URL+平台名）和酒商采购（备注）
 * - Linking.openURL 跳转网络购买链接
 * - 已采购标记（持久化）
 * - 手动添加额外采购项
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useMenuStore } from "@/lib/menu/store";
import { useRecipeStore } from "@/lib/recipes/store";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import {
  useShoppingStore,
  ShoppingItem,
  OnlineLink,
  OfflineNote,
  createEmptyShoppingItem,
} from "@/lib/shopping/store";
import { displayNames } from "@/lib/utils";
import { Bottle } from "@/lib/bottles/types";
import { HomemadePrep } from "@/lib/homemade/types";
import { MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";

// ─── 智能匹配工具 ─────────────────────────────────────────────────────────────

/** 将原材料名称与酒库做模糊匹配，返回最佳匹配的 Bottle */
function matchBottle(name: string, bottles: Bottle[]): Bottle | undefined {
  const n = name.toLowerCase().trim();
  if (!n) return undefined;
  // 精确匹配
  const exact = bottles.find(
    (b) => b.nameZh.toLowerCase() === n || b.nameEn.toLowerCase() === n
  );
  if (exact) return exact;
  // 包含匹配
  return bottles.find(
    (b) =>
      b.nameZh.toLowerCase().includes(n) ||
      b.nameEn.toLowerCase().includes(n) ||
      n.includes(b.nameZh.toLowerCase()) ||
      n.includes(b.nameEn.toLowerCase())
  );
}

/** 将原材料名称与自制库做模糊匹配，返回最佳匹配的 HomemadePrep */
function matchPrep(name: string, preps: HomemadePrep[]): HomemadePrep | undefined {
  const n = name.toLowerCase().trim();
  if (!n) return undefined;
  const exact = preps.find(
    (p) => p.name.toLowerCase() === n || p.nameAlt.toLowerCase() === n
  );
  if (exact) return exact;
  return preps.find(
    (p) =>
      p.name.toLowerCase().includes(n) ||
      p.nameAlt.toLowerCase().includes(n) ||
      n.includes(p.name.toLowerCase()) ||
      n.includes(p.nameAlt.toLowerCase())
  );
}

/** 根据 Bottle 的 category 判断 ShoppingItem 的 category */
function bottleToCategory(b: Bottle): ShoppingItem["category"] {
  const spiritCategories = ["金酒", "朗姆", "伏特加", "威士忌", "龙舌兰", "白兰地", "利口酒", "苦精", "味美思", "开胃酒", "起泡酒", "葡萄酒", "清酒烧酒", "中式白酒"];
  return spiritCategories.includes(b.category) ? "spirit" : "material";
}

// ─── 自动聚合逻辑 ─────────────────────────────────────────────────────────────

interface AggregatedItem {
  /** 原材料名称（中文，用于 key） */
  name: string;
  nameEn: string;
  /** 关联的在售配方 id 列表 */
  recipeIds: string[];
  /** 匹配到的酒库 Bottle */
  matchedBottle?: Bottle;
  /** 匹配到的自制品 */
  matchedPrep?: HomemadePrep;
  category: ShoppingItem["category"];
}

function useAggregatedItems(): AggregatedItem[] {
  const { groups, ungroupedEntries } = useMenuStore();
  const { recipes } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();

  return useMemo(() => {
    // 收集所有在售配方
    const availableRecipeIds = new Set<string>();
    groups.forEach((g) => g.entries.forEach((e) => { if (e.available) availableRecipeIds.add(e.recipeId); }));
    ungroupedEntries.forEach((e) => { if (e.available) availableRecipeIds.add(e.recipeId); });

    const availableRecipes = recipes.filter((r) => availableRecipeIds.has(r.id));

    // 聚合原材料：key = 原材料名称（小写）
    const map = new Map<string, AggregatedItem>();

    availableRecipes.forEach((recipe) => {
      recipe.ingredients.forEach((ing) => {
        const rawName = (ing.name || "").trim();
        if (!rawName) return;
        const key = rawName.toLowerCase();

        if (map.has(key)) {
          const item = map.get(key)!;
          if (!item.recipeIds.includes(recipe.id)) {
            item.recipeIds.push(recipe.id);
          }
        } else {
          // 智能匹配
          const matchedPrep = matchPrep(rawName, preps);
          const matchedBottle = matchedPrep ? undefined : matchBottle(rawName, bottles);
          const category: ShoppingItem["category"] = matchedPrep
            ? "homemade"
            : matchedBottle
            ? bottleToCategory(matchedBottle)
            : "other";

          map.set(key, {
            name: rawName,
            nameEn: matchedBottle?.nameEn ?? matchedPrep?.name ?? "",
            recipeIds: [recipe.id],
            matchedBottle,
            matchedPrep,
            category,
          });
        }
      });
    });

    return Array.from(map.values()).sort((a, b) => {
      // 排序：spirit > material > homemade > other
      const order = { spirit: 0, material: 1, homemade: 2, other: 3 };
      return order[a.category] - order[b.category];
    });
  }, [groups, ungroupedEntries, recipes, bottles, preps]);
}

// ─── 在线链接编辑弹窗 ─────────────────────────────────────────────────────────

interface OnlineLinkEditorProps {
  link: OnlineLink | null; // null = 新建
  onSave: (link: OnlineLink) => void;
  onClose: () => void;
}

function OnlineLinkEditor({ link, onSave, onClose }: OnlineLinkEditorProps) {
  const colors = useColors();
  const [platform, setPlatform] = useState(link?.platform ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [note, setNote] = useState(link?.note ?? "");

  const handleSave = () => {
    if (!url.trim()) {
      Alert.alert("请输入链接地址");
      return;
    }
    onSave({
      id: link?.id ?? Math.random().toString(36).slice(2) + Date.now().toString(36),
      platform: platform.trim() || "链接",
      url: url.trim(),
      note: note.trim(),
    });
    onClose();
  };

  const PLATFORM_PRESETS = ["天猫", "京东", "1919", "淘宝", "拼多多", "酒仙网", "其他"];

  return (
    <View style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
          {link ? "编辑链接" : "添加购买链接"}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <IconSymbol name="xmark.circle.fill" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        {/* 平台快选 */}
        <View style={{ gap: 8 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>平台</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {PLATFORM_PRESETS.map((p) => (
              <Pressable
                key={p}
                onPress={() => setPlatform(p)}
                style={({ pressed }) => [
                  styles.platformChip,
                  { borderColor: platform === p ? colors.primary : colors.border, backgroundColor: platform === p ? colors.primary + "22" : colors.surface },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.platformChipText, { color: platform === p ? colors.primary : colors.muted }]}>{p}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <TextInput
            style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder="或自定义平台名"
            placeholderTextColor={colors.muted}
            value={platform}
            onChangeText={setPlatform}
            returnKeyType="next"
          />
        </View>
        {/* URL */}
        <View style={{ gap: 6 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>链接地址 *</Text>
          <TextInput
            style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder="https://..."
            placeholderTextColor={colors.muted}
            value={url}
            onChangeText={setUrl}
            keyboardType="url"
            autoCapitalize="none"
            returnKeyType="next"
          />
        </View>
        {/* 备注 */}
        <View style={{ gap: 6 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>备注（可选）</Text>
          <TextInput
            style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder="如：旗舰店、自营、参考价¥XX"
            placeholderTextColor={colors.muted}
            value={note}
            onChangeText={setNote}
            returnKeyType="done"
          />
        </View>
        <Pressable
          style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          onPress={handleSave}
        >
          <Text style={styles.saveBtnText}>保存</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── 酒商备注编辑弹窗 ─────────────────────────────────────────────────────────

interface OfflineNoteEditorProps {
  note: OfflineNote;
  onSave: (note: OfflineNote) => void;
  onClose: () => void;
}

function OfflineNoteEditor({ note, onSave, onClose }: OfflineNoteEditorProps) {
  const colors = useColors();
  const [supplier, setSupplier] = useState(note.supplier);
  const [contact, setContact] = useState(note.contact);
  const [address, setAddress] = useState(note.address);
  const [price, setPrice] = useState(note.price);
  const [moq, setMoq] = useState(note.moq);
  const [noteText, setNoteText] = useState(note.note);

  const handleSave = () => {
    onSave({ supplier, contact, address, price, moq, note: noteText });
    onClose();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>酒商采购备注</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <IconSymbol name="xmark.circle.fill" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
        {[
          { label: "供应商名称", value: supplier, onChange: setSupplier, placeholder: "如：某某酒业" },
          { label: "联系方式", value: contact, onChange: setContact, placeholder: "电话 / 微信" },
          { label: "地址", value: address, onChange: setAddress, placeholder: "门店或仓库地址" },
          { label: "参考采购价", value: price, onChange: setPrice, placeholder: "如：¥180/瓶" },
          { label: "最小起订量", value: moq, onChange: setMoq, placeholder: "如：1箱（6瓶）" },
          { label: "其他备注", value: noteText, onChange: setNoteText, placeholder: "其他信息…" },
        ].map(({ label, value, onChange, placeholder }) => (
          <View key={label} style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>
            <TextInput
              style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
              placeholder={placeholder}
              placeholderTextColor={colors.muted}
              value={value}
              onChangeText={onChange}
              returnKeyType="next"
            />
          </View>
        ))}
        <Pressable
          style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          onPress={handleSave}
        >
          <Text style={styles.saveBtnText}>保存</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── 采购条目卡片 ─────────────────────────────────────────────────────────────

interface ShoppingItemCardProps {
  aggregated: AggregatedItem;
  savedItem: ShoppingItem | undefined;
  onTogglePurchased: () => void;
  onEditOnlineLink: (link: OnlineLink | null) => void;
  onDeleteOnlineLink: (linkId: string) => void;
  onEditOfflineNote: () => void;
}

function ShoppingItemCard({
  aggregated,
  savedItem,
  onTogglePurchased,
  onEditOnlineLink,
  onDeleteOnlineLink,
  onEditOfflineNote,
}: ShoppingItemCardProps) {
  const colors = useColors();
  const { lang } = useI18n();
  const { recipes } = useRecipeStore();

  const isPurchased = savedItem?.purchased ?? false;
  const onlineLinks = savedItem?.onlineLinks ?? [];
  const offlineNote = savedItem?.offlineNote;
  const hasOfflineNote = offlineNote && (offlineNote.supplier || offlineNote.contact || offlineNote.price);

  // 关联配方名称
  const linkedRecipeNames = useMemo(() => {
    return aggregated.recipeIds
      .map((id) => {
        const r = recipes.find((r) => r.id === id);
        if (!r) return null;
        return displayNames(r.nameEn, r.name, lang).primary;
      })
      .filter(Boolean) as string[];
  }, [aggregated.recipeIds, recipes, lang]);

  const categoryColor = {
    spirit: colors.primary,
    material: colors.success,
    homemade: colors.warning,
    other: colors.muted,
  }[aggregated.category];

  const categoryLabel = {
    spirit: "酒款",
    material: "原材料",
    homemade: "自制品",
    other: "其他",
  }[aggregated.category];

  return (
    <View style={[styles.itemCard, { backgroundColor: colors.surface, opacity: isPurchased ? 0.6 : 1 }]}>
      {/* 标题行 */}
      <View style={styles.itemHeader}>
        <View style={[styles.categoryBadge, { backgroundColor: categoryColor + "22" }]}>
          <Text style={[styles.categoryBadgeText, { color: categoryColor }]}>{categoryLabel}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, { color: colors.foreground }]} numberOfLines={1}>
            {aggregated.name}
          </Text>
          {aggregated.nameEn ? (
            <Text style={[styles.itemNameEn, { color: colors.muted }]} numberOfLines={1}>
              {aggregated.nameEn}
            </Text>
          ) : null}
        </View>
        {/* 已采购勾选 */}
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onTogglePurchased();
          }}
          hitSlop={8}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <IconSymbol
            name={isPurchased ? "checkmark.circle.fill" : "checkmark.circle"}
            size={24}
            color={isPurchased ? colors.success : colors.border}
          />
        </Pressable>
      </View>

      {/* 酒库/自制库匹配状态 */}
      {aggregated.matchedBottle && (
        <Pressable
          style={({ pressed }) => [styles.matchRow, { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.push(`/bottle/${aggregated.matchedBottle!.id}`)}
        >
          <IconSymbol name="checkmark.circle.fill" size={14} color={colors.success} />
          <Text style={[styles.matchText, { color: colors.success }]}>
            酒库已有：{aggregated.matchedBottle.nameZh}
          </Text>
          <IconSymbol name="chevron.right" size={12} color={colors.muted} />
        </Pressable>
      )}
      {aggregated.matchedPrep && (
        <Pressable
          style={({ pressed }) => [styles.matchRow, { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          onPress={() => router.push(`/homemade/${aggregated.matchedPrep!.id}`)}
        >
          <IconSymbol name="flask" size={14} color={colors.warning} />
          <Text style={[styles.matchText, { color: colors.warning }]}>
            自制品：{aggregated.matchedPrep.name} →
          </Text>
          <IconSymbol name="chevron.right" size={12} color={colors.muted} />
        </Pressable>
      )}

      {/* 关联配方 */}
      <View style={[styles.recipesRow, { borderTopColor: colors.border }]}>
        <IconSymbol name="list.bullet" size={12} color={colors.muted} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {linkedRecipeNames.map((name) => (
            <View key={name} style={[styles.recipeChip, { backgroundColor: colors.border + "66" }]}>
              <Text style={[styles.recipeChipText, { color: colors.muted }]}>{name}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      {/* 网络采购链接 */}
      {onlineLinks.length > 0 && (
        <View style={[styles.linksSection, { borderTopColor: colors.border }]}>
          <View style={styles.linksSectionHeader}>
            <IconSymbol name="globe" size={13} color={colors.primary} />
            <Text style={[styles.linksSectionTitle, { color: colors.primary }]}>网络采购</Text>
          </View>
          {onlineLinks.map((link) => (
            <View key={link.id} style={styles.linkRow}>
              <Pressable
                style={({ pressed }) => [styles.linkBtn, { backgroundColor: colors.primary + "15", opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Linking.openURL(link.url).catch(() => Alert.alert("无法打开链接", link.url));
                }}
              >
                <IconSymbol name="arrow.up.right.square" size={14} color={colors.primary} />
                <Text style={[styles.linkBtnText, { color: colors.primary }]} numberOfLines={1}>
                  {link.platform}{link.note ? `  ${link.note}` : ""}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onEditOnlineLink(link)}
                hitSlop={8}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <IconSymbol name="pencil" size={15} color={colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => onDeleteOnlineLink(link.id)}
                hitSlop={8}
                style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
              >
                <IconSymbol name="minus.circle.fill" size={15} color={colors.error} />
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* 酒商采购备注 */}
      {hasOfflineNote && (
        <Pressable
          style={({ pressed }) => [styles.offlineRow, { borderTopColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          onPress={onEditOfflineNote}
        >
          <IconSymbol name="building.2" size={13} color={colors.warning} />
          <View style={{ flex: 1 }}>
            {offlineNote.supplier ? <Text style={[styles.offlineText, { color: colors.foreground }]}>{offlineNote.supplier}</Text> : null}
            {offlineNote.contact ? <Text style={[styles.offlineSubText, { color: colors.muted }]}>{offlineNote.contact}</Text> : null}
            {offlineNote.price ? <Text style={[styles.offlineSubText, { color: colors.muted }]}>参考价：{offlineNote.price}</Text> : null}
          </View>
          <IconSymbol name="pencil" size={14} color={colors.muted} />
        </Pressable>
      )}

      {/* 操作按钮行 */}
      <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary + "15", opacity: pressed ? 0.7 : 1 }]}
          onPress={() => onEditOnlineLink(null)}
        >
          <IconSymbol name="globe" size={14} color={colors.primary} />
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>添加网络链接</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.warning + "15", opacity: pressed ? 0.7 : 1 }]}
          onPress={onEditOfflineNote}
        >
          <IconSymbol name="building.2" size={14} color={colors.warning} />
          <Text style={[styles.actionBtnText, { color: colors.warning }]}>酒商备注</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── 手动添加条目 Sheet ───────────────────────────────────────────────────────

interface ManualAddSheetProps {
  onClose: () => void;
  onAdd: (name: string, nameEn: string, category: ShoppingItem["category"]) => void;
}

function ManualAddSheet({ onClose, onAdd }: ManualAddSheetProps) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState<ShoppingItem["category"]>("other");

  const CATEGORIES: { key: ShoppingItem["category"]; label: string }[] = [
    { key: "spirit", label: "酒款" },
    { key: "material", label: "原材料" },
    { key: "homemade", label: "自制品" },
    { key: "other", label: "其他" },
  ];

  const handleAdd = () => {
    if (!name.trim()) { Alert.alert("请输入名称"); return; }
    onAdd(name.trim(), nameEn.trim(), category);
    onClose();
  };

  return (
    <View style={[styles.sheet, { backgroundColor: colors.background }]}>
      <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>手动添加采购项</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <IconSymbol name="xmark.circle.fill" size={20} color={colors.muted} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ gap: 6 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>名称 *</Text>
          <TextInput
            style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder="原材料/酒款名称"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="next"
          />
        </View>
        <View style={{ gap: 6 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>英文名（可选）</Text>
          <TextInput
            style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }]}
            placeholder="English name"
            placeholderTextColor={colors.muted}
            value={nameEn}
            onChangeText={setNameEn}
            returnKeyType="done"
          />
        </View>
        <View style={{ gap: 8 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>分类</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {CATEGORIES.map(({ key, label }) => (
              <Pressable
                key={key}
                onPress={() => setCategory(key)}
                style={({ pressed }) => [
                  styles.platformChip,
                  { borderColor: category === key ? colors.primary : colors.border, backgroundColor: category === key ? colors.primary + "22" : colors.surface, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.platformChipText, { color: category === key ? colors.primary : colors.muted }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
          onPress={handleAdd}
        >
          <Text style={styles.saveBtnText}>添加</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── 主屏幕 ───────────────────────────────────────────────────────────────────

export default function ShoppingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    items: savedItems,
    upsertItem,
    togglePurchased,
    addOnlineLink,
    updateOnlineLink,
    removeOnlineLink,
    updateOfflineNote,
  } = useShoppingStore();

  const aggregated = useAggregatedItems();

  // Sheet 状态
  const [editingLinkFor, setEditingLinkFor] = useState<{ itemKey: string; link: OnlineLink | null } | null>(null);
  const [editingOfflineFor, setEditingOfflineFor] = useState<string | null>(null); // itemKey
  const [showManualAdd, setShowManualAdd] = useState(false);
  // 筛选
  const [filterCategory, setFilterCategory] = useState<ShoppingItem["category"] | "all">("all");
  const [showPurchased, setShowPurchased] = useState(true);

  // 同步自动聚合结果到 store（只更新 linkedRecipeIds，不覆盖用户设置的链接/备注）
  useEffect(() => {
    aggregated.forEach((agg) => {
      const key = agg.name.toLowerCase();
      const existing = savedItems.find((i) => i.ingredientName.toLowerCase() === key && !i.isManual);
      const item: ShoppingItem = {
        id: existing?.id ?? (Math.random().toString(36).slice(2) + Date.now().toString(36)),
        ingredientName: agg.name,
        ingredientNameEn: agg.nameEn,
        category: agg.category,
        linkedBottleId: agg.matchedBottle?.id,
        linkedPrepId: agg.matchedPrep?.id,
        linkedRecipeIds: agg.recipeIds,
        onlineLinks: existing?.onlineLinks ?? [],
        offlineNote: existing?.offlineNote ?? { supplier: "", contact: "", address: "", price: "", moq: "", note: "" },
        purchased: existing?.purchased ?? false,
        isManual: false,
        addedAt: existing?.addedAt ?? new Date().toISOString(),
      };
      upsertItem(item);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregated]);

  // 合并显示：自动聚合 + 手动添加
  const displayItems = useMemo(() => {
    // 自动聚合的 key 集合
    // 手动添加的条目
    const manualItems = savedItems.filter((i) => i.isManual);
    // 合并：自动聚合优先，手动添加追加
    const all = [
      ...aggregated.map((agg) => {
        const saved = savedItems.find((i) => i.ingredientName.toLowerCase() === agg.name.toLowerCase() && !i.isManual);
        return { agg, saved };
      }),
      ...manualItems.map((item) => ({
        agg: {
          name: item.ingredientName,
          nameEn: item.ingredientNameEn,
          recipeIds: item.linkedRecipeIds,
          category: item.category,
          matchedBottle: undefined,
          matchedPrep: undefined,
        } as AggregatedItem,
        saved: item,
      })),
    ];
    return all.filter(({ agg, saved }) => {
      if (filterCategory !== "all" && agg.category !== filterCategory) return false;
      if (!showPurchased && saved?.purchased) return false;
      return true;
    });
  }, [aggregated, savedItems, filterCategory, showPurchased]);

  const getItemKey = (name: string) => name.toLowerCase();

  const handleTogglePurchased = useCallback((itemName: string) => {
    const item = savedItems.find((i) => i.ingredientName.toLowerCase() === itemName.toLowerCase());
    if (item) togglePurchased(item.id);
  }, [savedItems, togglePurchased]);

  const handleAddOnlineLink = useCallback((itemName: string, link: OnlineLink) => {
    const item = savedItems.find((i) => i.ingredientName.toLowerCase() === itemName.toLowerCase());
    if (item) addOnlineLink(item.id, link);
  }, [savedItems, addOnlineLink]);

  const handleUpdateOnlineLink = useCallback((itemName: string, link: OnlineLink) => {
    const item = savedItems.find((i) => i.ingredientName.toLowerCase() === itemName.toLowerCase());
    if (item) updateOnlineLink(item.id, link);
  }, [savedItems, updateOnlineLink]);

  const handleDeleteOnlineLink = useCallback((itemName: string, linkId: string) => {
    const item = savedItems.find((i) => i.ingredientName.toLowerCase() === itemName.toLowerCase());
    if (item) removeOnlineLink(item.id, linkId);
  }, [savedItems, removeOnlineLink]);

  const handleUpdateOfflineNote = useCallback((itemName: string, note: OfflineNote) => {
    const item = savedItems.find((i) => i.ingredientName.toLowerCase() === itemName.toLowerCase());
    if (item) updateOfflineNote(item.id, note);
  }, [savedItems, updateOfflineNote]);

  const handleManualAdd = useCallback((name: string, nameEn: string, category: ShoppingItem["category"]) => {
    const item = createEmptyShoppingItem(name, nameEn, category, true);
    upsertItem(item);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [upsertItem]);

  const purchasedCount = useMemo(
    () => savedItems.filter((i) => i.purchased && !i.isManual).length,
    [savedItems]
  );
  const totalCount = aggregated.length;

  const FILTER_TABS: { key: ShoppingItem["category"] | "all"; label: string }[] = [
    { key: "all", label: "全部" },
    { key: "spirit", label: "酒款" },
    { key: "material", label: "原材料" },
    { key: "homemade", label: "自制品" },
    { key: "other", label: "其他" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 顶部统计 + 筛选 */}
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        <View style={styles.statsRow}>
          <Text style={[styles.statsText, { color: colors.muted }]}>
            共 {totalCount} 项 · 已采购 {purchasedCount}
          </Text>
          <View style={styles.topBarActions}>
            <Pressable
              onPress={() => setShowPurchased((v) => !v)}
              hitSlop={8}
              style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.togglePurchasedText, { color: showPurchased ? colors.primary : colors.muted }]}>
                {showPurchased ? "隐藏已购" : "显示已购"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setShowManualAdd(true)}
              hitSlop={8}
              style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
            >
              <IconSymbol name="plus.circle.fill" size={22} color={colors.primary} />
            </Pressable>
          </View>
        </View>
        {/* 分类筛选 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
          {FILTER_TABS.map(({ key, label }) => (
            <Pressable
              key={key}
              onPress={() => setFilterCategory(key)}
              style={({ pressed }) => [
                styles.filterTab,
                { borderColor: filterCategory === key ? colors.primary : colors.border, backgroundColor: filterCategory === key ? colors.primary + "22" : colors.surface, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.filterTabText, { color: filterCategory === key ? colors.primary : colors.muted }]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* 列表 */}
      {displayItems.length === 0 ? (
        <View style={styles.emptyWrap}>
          <IconSymbol name="cart" size={48} color={colors.border} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {aggregated.length === 0 ? "暂无采购项目" : "无匹配项目"}
          </Text>
          <Text style={[styles.emptyDesc, { color: colors.muted }]}>
            {aggregated.length === 0
              ? "将配方设为「在售」后，所需原材料将自动出现在这里"
              : "调整筛选条件查看更多"}
          </Text>
        </View>
      ) : (
        <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
          data={displayItems}
          keyExtractor={({ agg }) => getItemKey(agg.name)}
          renderItem={({ item: { agg, saved } }) => (
            <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              <ShoppingItemCard
                aggregated={agg}
                savedItem={saved}
                onTogglePurchased={() => handleTogglePurchased(agg.name)}
                onEditOnlineLink={(link) => setEditingLinkFor({ itemKey: agg.name, link })}
                onDeleteOnlineLink={(linkId) => handleDeleteOnlineLink(agg.name, linkId)}
                onEditOfflineNote={() => setEditingOfflineFor(agg.name)}
              />
            </View>
          )}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 100 + insets.bottom }}
        />
      )}

      {/* 网络链接编辑 Sheet */}
      {editingLinkFor !== null && (
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable
            style={[styles.sheetOverlay, { backgroundColor: "rgba(0,0,0,0.4)" }]}
            onPress={() => setEditingLinkFor(null)}
          />
          <View style={[styles.sheetContainer, { backgroundColor: colors.background }]}>
            <OnlineLinkEditor
              link={editingLinkFor.link}
              onSave={(link) => {
                if (editingLinkFor.link) {
                  handleUpdateOnlineLink(editingLinkFor.itemKey, link);
                } else {
                  handleAddOnlineLink(editingLinkFor.itemKey, link);
                }
              }}
              onClose={() => setEditingLinkFor(null)}
            />
          </View>
        </View>
      )}

      {/* 酒商备注编辑 Sheet */}
      {editingOfflineFor !== null && (
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable
            style={[styles.sheetOverlay, { backgroundColor: "rgba(0,0,0,0.4)" }]}
            onPress={() => setEditingOfflineFor(null)}
          />
          <View style={[styles.sheetContainer, { backgroundColor: colors.background }]}>
            <OfflineNoteEditor
              note={savedItems.find((i) => i.ingredientName.toLowerCase() === editingOfflineFor.toLowerCase())?.offlineNote ?? { supplier: "", contact: "", address: "", price: "", moq: "", note: "" }}
              onSave={(note) => handleUpdateOfflineNote(editingOfflineFor, note)}
              onClose={() => setEditingOfflineFor(null)}
            />
          </View>
        </View>
      )}

      {/* 手动添加 Sheet */}
      {showManualAdd && (
        <View style={StyleSheet.absoluteFillObject}>
          <Pressable
            style={[styles.sheetOverlay, { backgroundColor: "rgba(0,0,0,0.4)" }]}
            onPress={() => setShowManualAdd(false)}
          />
          <View style={[styles.sheetContainerSmall, { backgroundColor: colors.background }]}>
            <ManualAddSheet
              onClose={() => setShowManualAdd(false)}
              onAdd={handleManualAdd}
            />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  statsText: {
    fontSize: 13,
    lineHeight: 18,
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  togglePurchasedText: {
    fontSize: 13,
    fontWeight: "500",
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: "500",
  },
  // 条目卡片
  itemCard: {
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 12,
    gap: 8,
  },
  categoryBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
  },
  itemNameEn: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  matchText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  recipesRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  recipeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recipeChipText: {
    fontSize: 11,
    lineHeight: 15,
  },
  linksSection: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  linksSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 2,
  },
  linksSectionTitle: {
    fontSize: 12,
    fontWeight: "600",
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  linkBtnText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
  },
  offlineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  offlineText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  offlineSubText: {
    fontSize: 11,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  // 空状态
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  // Sheet
  sheetOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "75%",
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
  // 表单
  fieldLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  platformChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  platformChipText: {
    fontSize: 13,
    fontWeight: "500",
  },
  saveBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
