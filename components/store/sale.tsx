/**
 * 在售清单（鸡尾酒 / 葡萄酒 / 餐食）
 * 引用各自的数据源，不复制数据
 */
import React, { useMemo } from "react";
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useMenuStore } from "@/lib/menu/store";
import { useWineStore } from "@/lib/wine/store";
import { useFoodMenuStore } from "@/lib/food/menu-store";
import { useRecipeStore } from "@/lib/recipes/store";
import { WINE_STYLE_LABELS } from "@/lib/wine/types";
import { FOOD_CATEGORY_LABELS } from "@/lib/food/types";

type SaleCat = "cocktail" | "wine" | "food";

const CATS: { key: SaleCat; label: string }[] = [
  { key: "cocktail", label: "鸡尾酒" },
  { key: "wine", label: "葡萄酒" },
  { key: "food", label: "餐食" },
];

export default function StoreSaleScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [cat, setCat] = usePersistedState<SaleCat>("store.sale.cat.v1", "cocktail");
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  // 鸡尾酒在售：来自门店酒单
  const { groups, ungroupedEntries } = useMenuStore();
  const { recipes } = useRecipeStore();
  const recipeMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const cocktailEntries = useMemo(() => [
    ...groups.flatMap((g) => g.entries),
    ...ungroupedEntries,
  ], [groups, ungroupedEntries]);
  const cocktailItems = useMemo(() => cocktailEntries.map((e) => ({
    id: e.id,
    name: recipeMap.get(e.recipeId)?.name ?? e.recipeId,
    price: e.price,
  })), [cocktailEntries, recipeMap]);

  // 葡萄酒在售
  const { bottles: wineBottles } = useWineStore();
  const wineItems = useMemo(() => wineBottles.filter((b) => b.stock > 0), [wineBottles]);

  // 餐食在售
  const { items: foodItems } = useFoodMenuStore();
  const foodOnSale = useMemo(() => foodItems.filter((i) => i.available), [foodItems]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 分类切换 */}
      <View style={[styles.subHeader, { backgroundColor: colors.background }]}>
        <View style={[styles.segContainer, { backgroundColor: colors.border + "55" }]}>
          {CATS.map((item) => {
            const active = cat === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => { tap(); setCat(item.key); }}
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

      {cat === "cocktail" && (
        cocktailItems.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>暂无在售鸡尾酒</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>在鸡尾酒 → 门店酒单中设置在售状态</Text>
          </View>
        ) : (
          <FlatList
            data={cocktailItems}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                </View>
                {item.price != null && <Text style={[styles.cardPrice, { color: colors.primary }]}>¥{item.price}</Text>}
              </View>
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          />
        )
      )}

      {cat === "wine" && (
        wineItems.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>暂无在售葡萄酒</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>在葡萄酒库中添加库存</Text>
          </View>
        ) : (
          <FlatList
            data={wineItems}
            keyExtractor={(b) => b.id}
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>
                    {item.name}{item.vintage ? ` ${item.vintage}` : ""}
                  </Text>
                  <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>
                    {[WINE_STYLE_LABELS[item.style], item.region].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  {item.salePrice != null && <Text style={[styles.cardPrice, { color: colors.primary }]}>¥{item.salePrice}</Text>}
                  <Text style={[styles.stockText, { color: colors.muted }]}>库存 {item.stock}</Text>
                </View>
              </View>
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          />
        )
      )}

      {cat === "food" && (
        foodOnSale.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>暂无在售餐食</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>在餐食 → 菜单中设置在售状态</Text>
          </View>
        ) : (
          <FlatList
            data={foodOnSale}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>{FOOD_CATEGORY_LABELS[item.category]}</Text>
                </View>
                {item.price != null && <Text style={[styles.cardPrice, { color: colors.primary }]}>¥{item.price}</Text>}
              </View>
            )}
            contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
          />
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  cardName: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  cardSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardPrice: { fontSize: 16, fontWeight: "700" },
  stockText: { fontSize: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyDesc: { fontSize: 14, textAlign: "center", paddingHorizontal: 32 },
});
