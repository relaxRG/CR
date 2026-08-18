/**
 * 餐食 Tab（菜单 + 原料库，独立数据，与鸡尾酒完全隔离）
 */
import React, { useMemo, useState } from "react";
import { Alert, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets, SafeAreaInsetsContext } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useScrollPreservation } from "@/hooks/use-scroll-preservation";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useFoodMenuStore } from "@/lib/food/menu-store";
import { useFoodIngredientStore } from "@/lib/food/ingredient-store";
import { FoodItem, FOOD_CATEGORY_LABELS, FoodIngredient, INGREDIENT_CATEGORY_LABELS } from "@/lib/food/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { MOBILE_NESTABLE_DRAGGABLE_LIST_PROPS, MOBILE_VIRTUAL_LIST_PROPS } from "@/components/performance/mobile-virtual-list";

type FoodTab = "menu" | "ingredients";

const TABS: { key: FoodTab; label: string }[] = [
  { key: "menu", label: "菜单" },
  { key: "ingredients", label: "原料库" },
];

function MenuItemCard({ item, onPress }: { item: FoodItem; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
          <View style={[styles.catBadge, { backgroundColor: colors.border }]}>
            <Text style={[styles.catText, { color: colors.muted }]}>{FOOD_CATEGORY_LABELS[item.category]}</Text>
          </View>
        </View>
        {item.description ? <Text style={[styles.cardDesc, { color: colors.muted }]} numberOfLines={1}>{item.description}</Text> : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        {item.price != null && <Text style={[styles.cardPrice, { color: colors.primary }]}>¥{item.price}</Text>}
        <View style={[styles.badge, { backgroundColor: item.available ? colors.success + "22" : colors.border }]}>
          <Text style={[styles.badgeText, { color: item.available ? colors.success : colors.muted }]}>
            {item.available ? "在售" : "下架"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function IngredientCard({ item, onPress }: { item: FoodIngredient; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.cardDesc, { color: colors.muted }]} numberOfLines={1}>
          {[INGREDIENT_CATEGORY_LABELS[item.category], item.spec, item.supplier].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text style={[styles.cardPrice, { color: colors.foreground }]}>
          {item.stock} {item.unit}
        </Text>
      </View>
    </Pressable>
  );
}

export default function FoodScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { items } = useFoodMenuStore();
  const { ingredients } = useFoodIngredientStore();
  const [tab, setTab] = usePersistedState<FoodTab>("food.tab.v1", "menu");
  const [query, setQuery] = useState("");

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const filteredMenu = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q));
  }, [items, query]);

  const filteredIngredients = useMemo(() => {
    if (!query.trim()) return ingredients;
    const q = query.toLowerCase();
    return ingredients.filter((i) => i.name.toLowerCase().includes(q) || i.supplier.toLowerCase().includes(q));
  }, [ingredients, query]);

  const subtitle = tab === "menu"
    ? items.length > 0 ? `共 ${items.length} 道菜品` : "建立你的菜单"
    : ingredients.length > 0 ? `共 ${ingredients.length} 种原料` : "管理食材与原料";

  const addRoute = tab === "menu" ? "/food-form" : "/food-ingredient-form";

  // 滚动位置保持：tab 切换时重置偏移量
  const { listRef: foodListRef, onScroll: onFoodScroll } = useScrollPreservation<FlatList>(tab);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>{tab === "menu" ? "菜单" : "原料库"}</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text>
          </View>
          <Pressable
            onPress={() => { tap(); router.push(addRoute as any); }}
            style={({ pressed }) => [styles.addBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
          >
            <IconSymbol name="plus" size={20} color="#fff" />
          </Pressable>
        </View>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={16} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tab === "menu" ? "搜索菜品…" : "搜索原料…"}
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.foreground }]}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <IconSymbol name="xmark.circle.fill" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
        <View style={[styles.segContainer, { backgroundColor: colors.border + "55" }]}>
          {TABS.map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => { tap(); setTab(item.key); }}
                style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}
              >
                <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tab === "menu" ? (
        filteredMenu.length === 0 ? (
          <View style={styles.empty}>
            <IconSymbol name="fork.knife" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{items.length === 0 ? "还没有菜品" : "无搜索结果"}</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>{items.length === 0 ? "点击右上角 + 添加第一道菜" : "试试其他关键词"}</Text>
          </View>
        ) : (
          <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
            ref={foodListRef}
            data={filteredMenu}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => <MenuItemCard item={item} onPress={() => { tap(); router.push(`/food/${item.id}` as any); }} />}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
            onScroll={onFoodScroll}
            scrollEventThrottle={100}
          />
        )
      ) : (
        filteredIngredients.length === 0 ? (
          <View style={styles.empty}>
            <IconSymbol name="leaf.fill" size={48} color={colors.border} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{ingredients.length === 0 ? "还没有原料" : "无搜索结果"}</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>{ingredients.length === 0 ? "点击右上角 + 添加原料" : "试试其他关键词"}</Text>
          </View>
        ) : (
          <FlatList {...MOBILE_VIRTUAL_LIST_PROPS}
            ref={foodListRef}
            data={filteredIngredients}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => <IngredientCard item={item} onPress={() => { tap(); router.push(`/food-ingredient/${item.id}` as any); }} />}
            contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}
            onScroll={onFoodScroll}
            scrollEventThrottle={100}
          />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41, letterSpacing: 0.3 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 2, marginBottom: 10 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 15, lineHeight: 20 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  cardName: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  cardDesc: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardPrice: { fontSize: 16, fontWeight: "700" },
  catBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  catText: { fontSize: 11, fontWeight: "500" },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 12, fontWeight: "500" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptyDesc: { fontSize: 14 },
});
