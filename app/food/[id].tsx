/**
 * 菜品详情页
 */
import React from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useFoodMenuStore } from "@/lib/food/menu-store";
import { FOOD_CATEGORY_LABELS } from "@/lib/food/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";

export default function FoodDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, toggleAvailable, deleteItem } = useFoodMenuStore();
  const item = items.find((i) => i.id === id);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  if (!item) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>菜品不存在</Text>
        </View>
      </ScreenContainer>
    );
  }

  const handleDelete = () => {
    Alert.alert("删除菜品", `确定删除「${item.name}」？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { deleteItem(item.id); router.back(); } },
    ]);
  };

  return (
    <ScreenContainer>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => { tap(); router.push(`/food-form?id=${item.id}` as any); }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={[styles.editBtn, { color: colors.primary }]}>编辑</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom, gap: 12 }}>
        {/* 名称与分类 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.bigName, { color: colors.foreground }]}>{item.name}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <View style={[styles.tag, { backgroundColor: colors.primary + "22" }]}>
              <Text style={[styles.tagText, { color: colors.primary }]}>{FOOD_CATEGORY_LABELS[item.category]}</Text>
            </View>
            <View style={[styles.tag, { backgroundColor: item.available ? colors.success + "22" : colors.border }]}>
              <Text style={[styles.tagText, { color: item.available ? colors.success : colors.muted }]}>
                {item.available ? "在售" : "已下架"}
              </Text>
            </View>
          </View>
        </View>

        {/* 价格与成本 */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
            {item.price != null && (
              <View style={{ alignItems: "center" }}>
                <Text style={[styles.priceLabel, { color: colors.muted }]}>售价</Text>
                <Text style={[styles.priceValue, { color: colors.primary }]}>¥{item.price}</Text>
              </View>
            )}
            {item.cost != null && (
              <View style={{ alignItems: "center" }}>
                <Text style={[styles.priceLabel, { color: colors.muted }]}>成本</Text>
                <Text style={[styles.priceValue, { color: colors.foreground }]}>¥{item.cost}</Text>
              </View>
            )}
            {item.price != null && item.cost != null && (
              <View style={{ alignItems: "center" }}>
                <Text style={[styles.priceLabel, { color: colors.muted }]}>毛利率</Text>
                <Text style={[styles.priceValue, { color: colors.success }]}>
                  {Math.round((1 - item.cost / item.price) * 100)}%
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* 上下架切换 */}
        <Pressable onPress={() => { tap(); toggleAvailable(item.id); }}
          style={[styles.card, { backgroundColor: item.available ? colors.success + "22" : colors.surface, borderColor: item.available ? colors.success : colors.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]}>
          <IconSymbol name={item.available ? "checkmark.circle.fill" : "xmark.circle.fill"} size={20} color={item.available ? colors.success : colors.muted} />
          <Text style={{ color: item.available ? colors.success : colors.muted, fontWeight: "600", fontSize: 15 }}>
            {item.available ? "已在售 · 点击下架" : "已下架 · 点击上架"}
          </Text>
        </Pressable>

        {/* 过敏原 */}
        {item.allergens ? (
          <View style={[styles.card, { backgroundColor: colors.warning + "11", borderColor: colors.warning + "44" }]}>
            <Text style={[styles.sectionTitle, { color: colors.warning }]}>过敏原提示</Text>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>{item.allergens}</Text>
          </View>
        ) : null}

        {/* 描述 */}
        {item.description ? (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.muted }]}>描述/做法</Text>
            <Text style={[styles.bodyText, { color: colors.foreground }]}>{item.description}</Text>
          </View>
        ) : null}

        {/* 删除 */}
        <Pressable onPress={handleDelete}
          style={[styles.card, { backgroundColor: colors.error + "11", borderColor: colors.error + "33", alignItems: "center" }]}>
          <Text style={{ color: colors.error, fontWeight: "600", fontSize: 15 }}>删除菜品</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  navTitle: { fontSize: 17, fontWeight: "600", marginLeft: 8, flex: 1 },
  editBtn: { fontSize: 17, fontWeight: "500" },
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  bigName: { fontSize: 24, fontWeight: "700", lineHeight: 30 },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 13, fontWeight: "500" },
  priceLabel: { fontSize: 13, marginBottom: 4 },
  priceValue: { fontSize: 20, fontWeight: "700" },
  sectionTitle: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  bodyText: { fontSize: 15, lineHeight: 22 },
});
