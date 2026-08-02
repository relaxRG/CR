/**
 * 菜品添加/编辑表单
 */
import React, { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useFoodMenuStore } from "@/lib/food/menu-store";
import { FoodCategory, FOOD_CATEGORY_LABELS } from "@/lib/food/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";

const CATEGORIES: FoodCategory[] = ["cold", "hot", "soup", "dessert", "drink", "staple", "other"];

export default function FoodFormScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { items, addItem, updateItem, deleteItem } = useFoodMenuStore();
  const existing = id ? items.find((i) => i.id === id) : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<FoodCategory>(existing?.category ?? "hot");
  const [price, setPrice] = useState(existing?.price != null ? String(existing.price) : "");
  const [cost, setCost] = useState(existing?.cost != null ? String(existing.cost) : "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [allergens, setAllergens] = useState(existing?.allergens ?? "");
  const [available, setAvailable] = useState(existing?.available ?? true);

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert("请输入菜品名称");
      return;
    }
    const data = {
      name: name.trim(),
      category,
      price: price ? parseFloat(price) : null,
      cost: cost ? parseFloat(cost) : null,
      description: description.trim(),
      allergens: allergens.trim(),
      photoUri: existing?.photoUri ?? "",
      available,
    };
    if (existing) {
      updateItem(existing.id, data);
    } else {
      addItem(data);
    }
    tap();
    router.back();
  };

  const handleDelete = () => {
    if (!existing) return;
    Alert.alert("删除菜品", `确定删除「${existing.name}」？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { deleteItem(existing.id); router.back(); } },
    ]);
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>{existing ? "编辑菜品" : "添加菜品"}</Text>
        <View style={{ flex: 1 }} />
        {existing && (
          <Pressable onPress={handleDelete} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, marginRight: 16 })}>
            <IconSymbol name="trash" size={20} color={colors.error} />
          </Pressable>
        )}
        <Pressable onPress={handleSave} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={[styles.saveBtn, { color: colors.primary }]}>保存</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom }}>
        {/* 分类选择 */}
        <View style={{ marginBottom: 20 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>分类</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setCategory(c)}
                style={[styles.chip, { borderColor: category === c ? colors.primary : colors.border, backgroundColor: category === c ? colors.primary + "22" : colors.surface }]}>
                <Text style={{ color: category === c ? colors.primary : colors.muted, fontWeight: "600", fontSize: 13 }}>
                  {FOOD_CATEGORY_LABELS[c]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* 在售状态 */}
        <Pressable onPress={() => setAvailable(!available)}
          style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.toggleLabel, { color: colors.foreground }]}>在售状态</Text>
          <View style={[styles.toggle, { backgroundColor: available ? colors.success : colors.border }]}>
            <View style={[styles.toggleThumb, { left: available ? 20 : 2 }]} />
          </View>
        </Pressable>

        {/* 文字字段 */}
        {[
          { label: "菜品名称 *", value: name, onChange: setName, placeholder: "如：红烧肉" },
          { label: "售价（元）", value: price, onChange: setPrice, placeholder: "可选", keyboardType: "decimal-pad" as const },
          { label: "成本（元）", value: cost, onChange: setCost, placeholder: "可选", keyboardType: "decimal-pad" as const },
          { label: "过敏原", value: allergens, onChange: setAllergens, placeholder: "如：含花生、海鲜（可选）" },
        ].map((f) => (
          <View key={f.label} style={{ marginBottom: 16 }}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>{f.label}</Text>
            <TextInput
              value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              keyboardType={(f as any).keyboardType} returnKeyType="next"
            />
          </View>
        ))}

        {/* 描述/做法 */}
        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>描述/做法简介</Text>
          <TextInput
            value={description} onChangeText={setDescription}
            placeholder="食材、做法、口味特点…"
            placeholderTextColor={colors.muted} multiline numberOfLines={4}
            style={[styles.input, styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  navTitle: { fontSize: 17, fontWeight: "600", marginLeft: 8 },
  saveBtn: { fontSize: 17, fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  textarea: { minHeight: 100, textAlignVertical: "top" },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  toggleLabel: { fontSize: 15, fontWeight: "500" },
  toggle: { width: 44, height: 26, borderRadius: 13, position: "relative" },
  toggleThumb: { position: "absolute", top: 3, width: 20, height: 20, borderRadius: 10, backgroundColor: "#fff" },
});
