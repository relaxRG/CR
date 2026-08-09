/**
 * 在售清单（鸡尾酒 / 葡萄酒 / 餐食 / 套餐）
 * 每个产品点开可查看详情并跳转相关页面
 */
import React, { useMemo, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useScrollPreservation } from "@/hooks/use-scroll-preservation";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useMenuStore } from "@/lib/menu/store";
import { useWineStore } from "@/lib/wine/store";
import { useFoodMenuStore } from "@/lib/food/menu-store";
import { useRecipeStore } from "@/lib/recipes/store";
import { useMenuPackageStore, MenuPackage } from "@/lib/menu/package-store";
import { WINE_STYLE_LABELS, WineStyle } from "@/lib/wine/types";
import { FOOD_CATEGORY_LABELS, FoodCategory } from "@/lib/food/types";
import { IconSymbol } from "@/components/ui/icon-symbol";

type SaleCat = "cocktail" | "wine" | "food" | "package";
const CATS: { key: SaleCat; label: string; emoji: string }[] = [
  { key: "cocktail", label: "鸡尾酒", emoji: "🍹" },
  { key: "wine", label: "葡萄酒", emoji: "🍷" },
  { key: "food", label: "餐食", emoji: "🍽️" },
  { key: "package", label: "套餐", emoji: "🎁" },
];

// ─── 套餐编辑 Modal ───────────────────────────────────────────────────────────
function PackageEditModal({ visible, pkg, colors, onSave, onClose }: {
  visible: boolean; pkg: MenuPackage | null; colors: any;
  onSave: (data: Omit<MenuPackage, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [nameEn, setNameEn] = useState(pkg?.nameEn ?? "");
  const [description, setDescription] = useState(pkg?.description ?? "");
  const [price, setPrice] = useState(pkg?.price != null ? String(pkg.price) : "");
  const [originalPrice, setOriginalPrice] = useState(pkg?.originalPrice != null ? String(pkg.originalPrice) : "");
  const [tags, setTags] = useState(pkg?.tags?.join(", ") ?? "");

  React.useEffect(() => {
    if (visible) {
      setName(pkg?.name ?? ""); setNameEn(pkg?.nameEn ?? ""); setDescription(pkg?.description ?? "");
      setPrice(pkg?.price != null ? String(pkg.price) : "");
      setOriginalPrice(pkg?.originalPrice != null ? String(pkg.originalPrice) : "");
      setTags(pkg?.tags?.join(", ") ?? "");
    }
  }, [visible, pkg]);

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请填写套餐名称"); return; }
    onSave({
      name: name.trim(), nameEn: nameEn.trim() || undefined,
      description: description.trim() || undefined,
      price: price ? Number(price) : null,
      originalPrice: originalPrice ? Number(originalPrice) : undefined,
      items: pkg?.items ?? [], available: pkg?.available ?? true,
      sortIndex: pkg?.sortIndex ?? 0,
      tags: tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.sheetTitle, { color: colors.foreground }]}>{pkg ? "编辑套餐" : "新增套餐"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {[
              { label: "套餐名称 *", value: name, onChange: setName, placeholder: "如 欢迎套餐" },
              { label: "英文名", value: nameEn, onChange: setNameEn, placeholder: "可选" },
              { label: "套餐售价（元）", value: price, onChange: setPrice, placeholder: "0.00", kb: "decimal-pad" as const },
              { label: "原价（元，展示折扣用）", value: originalPrice, onChange: setOriginalPrice, placeholder: "可选", kb: "decimal-pad" as const },
              { label: "标签（逗号分隔）", value: tags, onChange: setTags, placeholder: "如 热门, 新品, 限时" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={(f as any).kb ?? "default"}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ))}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>套餐描述</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder="描述套餐内容和特色"
                placeholderTextColor={colors.muted} multiline numberOfLines={3}
                style={[S.textarea, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 套餐详情 Modal ───────────────────────────────────────────────────────────
function PackageDetailModal({ visible, pkg, colors, onEdit, onDelete, onToggle, onClose }: {
  visible: boolean; pkg: MenuPackage | null; colors: any;
  onEdit: () => void; onDelete: () => void; onToggle: () => void; onClose: () => void;
}) {
  if (!pkg) return null;
  const discount = pkg.originalPrice && pkg.price ? Math.round((pkg.price / pkg.originalPrice) * 10) / 10 : null;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[S.sheet, { backgroundColor: colors.background }]}>
        <View style={[S.sheetHeader, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.primary }}>关闭</Text></Pressable>
          <Text style={[S.sheetTitle, { color: colors.foreground }]}>套餐详情</Text>
          <Pressable onPress={onEdit}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>编辑</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          <View style={[S.detailHeader, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: colors.foreground }}>{pkg.name}</Text>
            {pkg.nameEn && <Text style={{ fontSize: 14, color: colors.muted }}>{pkg.nameEn}</Text>}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
              {pkg.price != null && <Text style={{ fontSize: 24, fontWeight: "700", color: colors.primary }}>¥{pkg.price}</Text>}
              {pkg.originalPrice && <Text style={{ fontSize: 14, color: colors.muted, textDecorationLine: "line-through" }}>¥{pkg.originalPrice}</Text>}
              {discount && (
                <View style={{ backgroundColor: colors.error + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 12, color: colors.error, fontWeight: "600" }}>{discount}折</Text>
                </View>
              )}
            </View>
            {pkg.tags && pkg.tags.length > 0 && (
              <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                {pkg.tags.map((tag) => (
                  <View key={tag} style={{ backgroundColor: colors.primary + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: colors.primary }}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
            {pkg.description && <Text style={{ fontSize: 13, color: colors.muted, marginTop: 8 }}>{pkg.description}</Text>}
          </View>
          {pkg.items.length > 0 && (
            <View>
              <Text style={[S.sectionTitle, { color: colors.muted }]}>套餐内容</Text>
              {pkg.items.map((item, i) => (
                <View key={i} style={[S.itemRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={{ fontSize: 13 }}>{item.type === "cocktail" ? "🍹" : item.type === "wine" ? "🍷" : "🍽️"}</Text>
                  <Text style={{ flex: 1, fontSize: 14, color: colors.foreground }}>{item.name}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>×{item.quantity}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={{ gap: 10 }}>
            <TouchableOpacity onPress={onToggle}
              style={{ backgroundColor: pkg.available ? colors.warning : colors.success, borderRadius: 12, padding: 14, alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>{pkg.available ? "⏸ 下架套餐" : "▶ 上架套餐"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { onDelete(); onClose(); }}
              style={{ backgroundColor: colors.error + "15", borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: colors.error + "33" }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.error }}>删除套餐</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function StoreSaleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [cat, setCat] = usePersistedState<SaleCat>("store.sale.cat.v2", "cocktail");

  const { groups, ungroupedEntries } = useMenuStore();
  const { recipes } = useRecipeStore();
  const { bottles: wineBottles, deleteBottle, batchDeleteBottles, reorderBottles } = useWineStore();
  const { items: foodItems, deleteItem: deleteFoodItem, batchDeleteItems, reorderItems, batchToggleAvailable } = useFoodMenuStore();
  const { packages, addPackage, updatePackage, deletePackage, toggleAvailable } = useMenuPackageStore();
  // 葡萄酒多选
  const [wineSelectMode, setWineSelectMode] = useState(false);
  const [wineSelectedIds, setWineSelectedIds] = useState<string[]>([]);
  // 餐食多选
  const [foodSelectMode, setFoodSelectMode] = useState(false);
  const [foodSelectedIds, setFoodSelectedIds] = useState<string[]>([]);

  const recipeMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const cocktailItems = useMemo(() => [
    ...groups.flatMap((g) => g.entries), ...ungroupedEntries,
  ].map((e) => ({
    id: e.id, recipeId: e.recipeId,
    name: recipeMap.get(e.recipeId)?.name ?? e.recipeId,
    nameEn: recipeMap.get(e.recipeId)?.nameEn,
    price: e.price,
  })), [groups, ungroupedEntries, recipeMap]);

  const wineItems = useMemo(() => wineBottles.filter((b) => b.stock > 0), [wineBottles]);
  const foodOnSale = useMemo(() => foodItems.filter((i) => i.available), [foodItems]);

  const [showPackageEdit, setShowPackageEdit] = useState(false);
  const [editingPackage, setEditingPackage] = useState<MenuPackage | null>(null);
  const [showPackageDetail, setShowPackageDetail] = useState(false);
  const [detailPackage, setDetailPackage] = useState<MenuPackage | null>(null);

  // 滚动位置保持：cat 切换时重置偏移量
  const { listRef: saleListRef, onScroll: onSaleScroll } = useScrollPreservation<FlatList>(cat);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 分类 Tab */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {CATS.map((item) => {
          const active = cat === item.key;
          return (
            <Pressable key={item.key} onPress={() => { tap(); setCat(item.key); }}
              style={[S.segItem, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}>
              <Text style={{ fontSize: 13, color: active ? "#fff" : colors.foreground, fontWeight: active ? "600" : "400" }}>
                {item.emoji} {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 鸡尾酒 */}
      {cat === "cocktail" && (
        cocktailItems.length === 0 ? (
          <View style={S.empty}>
            <Text style={{ fontSize: 48 }}>🍹</Text>
            <Text style={[S.emptyTitle, { color: colors.foreground }]}>暂无在售鸡尾酒</Text>
            <Text style={[S.emptyDesc, { color: colors.muted }]}>在鸡尾酒 → 门店酒单中设置在售状态</Text>
            <TouchableOpacity onPress={() => router.push("/menu" as any)} style={[S.emptyBtn, { backgroundColor: colors.primary }]}>
              <Text style={{ color: "#fff", fontWeight: "600" }}>前往门店酒单</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            ref={saleListRef}
            data={cocktailItems}
            keyExtractor={(i) => i.id}
            onScroll={onSaleScroll}
            scrollEventThrottle={100}
            renderItem={({ item }) => (
              <Pressable onPress={() => { tap(); if (item.recipeId) router.push(`/recipe/${item.recipeId}` as any); }}
                style={({ pressed }) => [S.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[S.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                  {item.nameEn && <Text style={{ fontSize: 12, color: colors.muted }}>{item.nameEn}</Text>}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  {item.price != null && <Text style={[S.cardPrice, { color: colors.primary }]}>¥{item.price}</Text>}
                  <IconSymbol name="chevron.right" size={14} color={colors.muted} />
                </View>
              </Pressable>
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} />
        )
      )}

      {/* 葡萄酒 */}
      {cat === "wine" && (
        <View style={{ flex: 1 }}>
          {/* 操作栏 */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>
              {wineSelectMode ? `已选 ${wineSelectedIds.length} / ${wineItems.length}` : `共 ${wineItems.length} 款`}
            </Text>
            {wineSelectMode ? (
              <>
                <TouchableOpacity onPress={() => setWineSelectedIds(wineItems.map((b) => b.id))}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.primary + "22" }}>
                  <Text style={{ fontSize: 12, color: colors.primary }}>全选</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (wineSelectedIds.length === 0) { Alert.alert("请先选择"); return; }
                  Alert.alert(`删除 ${wineSelectedIds.length} 款`, "确认删除选中的葡萄酒？", [
                    { text: "取消", style: "cancel" },
                    { text: "删除", style: "destructive", onPress: () => { batchDeleteBottles(wineSelectedIds); setWineSelectedIds([]); setWineSelectMode(false); } },
                  ]);
                }} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.error + "22" }}>
                  <Text style={{ fontSize: 12, color: colors.error }}>删除</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setWineSelectMode(false); setWineSelectedIds([]); }}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>完成</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity onPress={() => { tap(); setWineSelectMode(true); }}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>编辑</Text>
              </TouchableOpacity>
            )}
          </View>
          {wineItems.length === 0 ? (
            <View style={S.empty}>
              <Text style={{ fontSize: 48 }}>🍷</Text>
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>暂无在售葡萄酒</Text>
              <Text style={[S.emptyDesc, { color: colors.muted }]}>在葡萄酒库中添加库存</Text>
            </View>
          ) : (
            <FlatList
              ref={saleListRef}
              data={wineItems}
              keyExtractor={(b) => b.id}
              onScroll={onSaleScroll}
              scrollEventThrottle={100}
              renderItem={({ item }) => {
                const isSelected = wineSelectedIds.includes(item.id);
                return (
                  <Pressable
                    onPress={() => {
                      tap();
                      if (wineSelectMode) {
                        setWineSelectedIds((prev) => isSelected ? prev.filter((id) => id !== item.id) : [...prev, item.id]);
                      } else {
                        router.push(`/bottle/${item.id}` as any);
                      }
                    }}
                    onLongPress={() => { tap(); setWineSelectMode(true); setWineSelectedIds([item.id]); }}
                    style={({ pressed }) => [S.card, {
                      backgroundColor: isSelected ? "#9F123922" : colors.surface,
                      borderColor: isSelected ? "#9F1239" : colors.border,
                      opacity: pressed ? 0.8 : 1,
                    }]}>
                    {wineSelectMode && (
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: isSelected ? "#9F1239" : colors.muted, backgroundColor: isSelected ? "#9F1239" : "transparent", alignItems: "center", justifyContent: "center", marginRight: 4 }}>
                        {isSelected && <IconSymbol name="checkmark" size={12} color="#fff" />}
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={[S.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}{item.vintage ? ` ${item.vintage}` : ""}</Text>
                      <Text style={[S.cardSub, { color: colors.muted }]} numberOfLines={1}>{[WINE_STYLE_LABELS[item.style as WineStyle], item.region].filter(Boolean).join(" · ")}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      {item.salePrice != null && <Text style={[S.cardPrice, { color: "#9F1239" }]}>¥{item.salePrice}</Text>}
                      <Text style={{ fontSize: 12, color: colors.muted }}>库存 {item.stock}</Text>
                    </View>
                  </Pressable>
                );
              }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} />
          )}
        </View>
      )}

      {/* 餐食 */}
      {cat === "food" && (
        <View style={{ flex: 1 }}>
          {/* 操作栏 */}
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>
              {foodSelectMode ? `已选 ${foodSelectedIds.length} / ${foodItems.length}` : `共 ${foodItems.length} 项，${foodOnSale.length} 项在售`}
            </Text>
            {foodSelectMode ? (
              <>
                <TouchableOpacity onPress={() => setFoodSelectedIds(foodItems.map((i) => i.id))}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.primary + "22" }}>
                  <Text style={{ fontSize: 12, color: colors.primary }}>全选</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (foodSelectedIds.length === 0) { Alert.alert("请先选择"); return; }
                  batchToggleAvailable(foodSelectedIds, true);
                }} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#10B98122" }}>
                  <Text style={{ fontSize: 12, color: "#10B981" }}>上架</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (foodSelectedIds.length === 0) { Alert.alert("请先选择"); return; }
                  batchToggleAvailable(foodSelectedIds, false);
                }} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.warning + "22" }}>
                  <Text style={{ fontSize: 12, color: colors.warning }}>下架</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => {
                  if (foodSelectedIds.length === 0) { Alert.alert("请先选择"); return; }
                  Alert.alert(`删除 ${foodSelectedIds.length} 项`, "确认删除选中的餐食？", [
                    { text: "取消", style: "cancel" },
                    { text: "删除", style: "destructive", onPress: () => { batchDeleteItems(foodSelectedIds); setFoodSelectedIds([]); setFoodSelectMode(false); } },
                  ]);
                }} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.error + "22" }}>
                  <Text style={{ fontSize: 12, color: colors.error }}>删除</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setFoodSelectMode(false); setFoodSelectedIds([]); }}
                  style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>完成</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity onPress={() => { tap(); setFoodSelectMode(true); }}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>编辑</Text>
              </TouchableOpacity>
            )}
          </View>
          {foodItems.length === 0 ? (
            <View style={S.empty}>
              <Text style={{ fontSize: 48 }}>🍽️</Text>
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>暂无餐食</Text>
              <Text style={[S.emptyDesc, { color: colors.muted }]}>在餐食 → 菜单中添加餐食</Text>
            </View>
          ) : (
            <FlatList
              ref={saleListRef}
              data={foodItems}
              keyExtractor={(i) => i.id}
              onScroll={onSaleScroll}
              scrollEventThrottle={100}
              renderItem={({ item }) => {
                const isSelected = foodSelectedIds.includes(item.id);
                return (
                  <Pressable
                    onPress={() => {
                      tap();
                      if (foodSelectMode) {
                        setFoodSelectedIds((prev) => isSelected ? prev.filter((id) => id !== item.id) : [...prev, item.id]);
                      }
                    }}
                    onLongPress={() => { tap(); setFoodSelectMode(true); setFoodSelectedIds([item.id]); }}
                    style={({ pressed }) => [S.card, {
                      backgroundColor: isSelected ? "#10B98122" : colors.surface,
                      borderColor: isSelected ? "#10B981" : colors.border,
                      opacity: pressed ? 0.8 : item.available ? 1 : 0.5,
                    }]}>
                    {foodSelectMode && (
                      <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: isSelected ? "#10B981" : colors.muted, backgroundColor: isSelected ? "#10B981" : "transparent", alignItems: "center", justifyContent: "center", marginRight: 4 }}>
                        {isSelected && <IconSymbol name="checkmark" size={12} color="#fff" />}
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={[S.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                        {!item.available && (
                          <View style={{ backgroundColor: colors.muted + "33", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ fontSize: 10, color: colors.muted }}>已下架</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[S.cardSub, { color: colors.muted }]} numberOfLines={1}>{FOOD_CATEGORY_LABELS[item.category as FoodCategory]}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      {item.price != null && <Text style={[S.cardPrice, { color: "#10B981" }]}>¥{item.price}</Text>}
                      {!foodSelectMode && (
                        <Pressable onPress={() => { tap(); deleteFoodItem(item.id); }}
                          style={{ padding: 4 }}>
                          <IconSymbol name="trash" size={14} color={colors.muted} />
                        </Pressable>
                      )}
                    </View>
                  </Pressable>
                );
              }}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} />
          )}
        </View>
      )}

      {/* 套餐 */}
      {cat === "package" && (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
            <Text style={{ flex: 1, fontSize: 13, color: colors.muted }}>共 {packages.length} 个套餐</Text>
            <TouchableOpacity onPress={() => { tap(); setEditingPackage(null); setShowPackageEdit(true); }}
              style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#fff" }}>+ 新增套餐</Text>
            </TouchableOpacity>
          </View>
          {packages.length === 0 ? (
            <View style={S.empty}>
              <Text style={{ fontSize: 48 }}>🎁</Text>
              <Text style={[S.emptyTitle, { color: colors.foreground }]}>还没有套餐</Text>
              <Text style={[S.emptyDesc, { color: colors.muted }]}>点击「新增套餐」创建组合套餐</Text>
            </View>
          ) : (
            <FlatList
              ref={saleListRef}
              data={packages}
              keyExtractor={(p) => p.id}
              onScroll={onSaleScroll}
              scrollEventThrottle={100}
              renderItem={({ item: pkg }) => (
                <Pressable onPress={() => { tap(); setDetailPackage(pkg); setShowPackageDetail(true); }}
                  style={({ pressed }) => [S.card, { backgroundColor: colors.surface, borderColor: pkg.available ? colors.border : colors.muted + "44", opacity: pressed ? 0.8 : pkg.available ? 1 : 0.6 }]}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[S.cardName, { color: colors.foreground }]} numberOfLines={1}>{pkg.name}</Text>
                      {!pkg.available && (
                        <View style={{ backgroundColor: colors.muted + "33", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10, color: colors.muted }}>已下架</Text>
                        </View>
                      )}
                    </View>
                    {pkg.nameEn && <Text style={{ fontSize: 12, color: colors.muted }}>{pkg.nameEn}</Text>}
                    {pkg.description && <Text style={[S.cardSub, { color: colors.muted }]} numberOfLines={1}>{pkg.description}</Text>}
                    {pkg.tags && pkg.tags.length > 0 && (
                      <View style={{ flexDirection: "row", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                        {pkg.tags.map((tag: string) => (
                          <View key={tag} style={{ backgroundColor: colors.primary + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ fontSize: 10, color: colors.primary }}>{tag}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {pkg.price != null && <Text style={[S.cardPrice, { color: colors.primary }]}>¥{pkg.price}</Text>}
                    {pkg.originalPrice && <Text style={{ fontSize: 11, color: colors.muted, textDecorationLine: "line-through" }}>¥{pkg.originalPrice}</Text>}
                    <IconSymbol name="chevron.right" size={14} color={colors.muted} />
                  </View>
                </Pressable>
              )}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }} />
          )}
        </View>
      )}

      <PackageEditModal visible={showPackageEdit} pkg={editingPackage} colors={colors}
        onSave={(data) => { if (editingPackage) updatePackage(editingPackage.id, data); else addPackage(data); }}
        onClose={() => setShowPackageEdit(false)} />
      <PackageDetailModal visible={showPackageDetail} pkg={detailPackage} colors={colors}
        onEdit={() => { setShowPackageDetail(false); setEditingPackage(detailPackage); setShowPackageEdit(true); }}
        onDelete={() => { if (detailPackage) deletePackage(detailPackage.id); }}
        onToggle={() => { if (detailPackage) toggleAvailable(detailPackage.id); }}
        onClose={() => setShowPackageDetail(false)} />
    </View>
  );
}

const S = StyleSheet.create({
  segItem: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  cardName: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  cardSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardPrice: { fontSize: 16, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 60 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyDesc: { fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
  emptyBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 80 },
  detailHeader: { borderRadius: 14, borderWidth: 1, padding: 16 },
  sectionTitle: { fontSize: 13, fontWeight: "500", marginBottom: 8 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 6 },
});
