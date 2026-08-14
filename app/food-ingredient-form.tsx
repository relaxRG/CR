/**
 * 食材/原料添加/编辑表单
 */
import React, { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useFoodIngredientStore } from "@/lib/food/ingredient-store";
import { IngredientCategory, INGREDIENT_CATEGORY_LABELS } from "@/lib/food/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";

const CATEGORIES: IngredientCategory[] = ["meat", "seafood", "vegetable", "fruit", "grain", "dairy", "spice", "sauce", "frozen", "other"];

export default function FoodIngredientFormScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { ingredients, addIngredient, updateIngredient, deleteIngredient } = useFoodIngredientStore();
  const existing = id ? ingredients.find((i) => i.id === id) : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState<IngredientCategory>(existing?.category ?? "meat");
  const [spec, setSpec] = useState(existing?.spec ?? "");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [costPrice, setCostPrice] = useState(existing?.costPrice != null ? String(existing.costPrice) : "");
  const [stock, setStock] = useState(String(existing?.stock ?? "0"));
  const [supplier, setSupplier] = useState(existing?.supplier ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert("请输入食材名称");
      return;
    }
    const data = {
      name: name.trim(),
      category,
      spec: spec.trim(),
      unit: unit.trim(),
      costPrice: costPrice ? parseFloat(costPrice) : null,
      stock: parseInt(stock) || 0,
      supplier: supplier.trim(),
      notes: notes.trim(),
    };
    if (existing) {
      updateIngredient(existing.id, data);
    } else {
      addIngredient(data);
    }
    tap();
    router.back();
  };

  const handleDelete = () => {
    if (!existing) return;
    Alert.alert("删除食材", `确定删除「${existing.name}」？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => { deleteIngredient(existing.id); router.back(); } },
    ]);
  };

  return (
    <ScreenContainer>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>{existing ? "编辑食材" : "添加食材"}</Text>
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
        {/* 分类 */}
        <View style={{ marginBottom: 20 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>分类</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {CATEGORIES.map((c) => (
              <Pressable key={c} onPress={() => setCategory(c)}
                style={[styles.chip, { borderColor: category === c ? colors.primary : colors.border, backgroundColor: category === c ? colors.primary + "22" : colors.surface }]}>
                <Text style={{ color: category === c ? colors.primary : colors.muted, fontWeight: "600", fontSize: 13 }}>
                  {INGREDIENT_CATEGORY_LABELS[c]}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {[
          { label: "食材名称 *", value: name, onChange: setName, placeholder: "如：猪五花" },
          { label: "规格", value: spec, onChange: setSpec, placeholder: "如：500g/袋" },
          { label: "单位", value: unit, onChange: setUnit, placeholder: "如：袋、kg、个" },
          { label: "采购价（元）", value: costPrice, onChange: setCostPrice, placeholder: "可选", keyboardType: "decimal-pad" as const },
          { label: "当前库存", value: stock, onChange: setStock, placeholder: "0", keyboardType: "number-pad" as const },
          { label: "供应商", value: supplier, onChange: setSupplier, placeholder: "可选" },
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

        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>备注</Text>
          <TextInput
            value={notes} onChangeText={setNotes} placeholder="可选"
            placeholderTextColor={colors.muted} multiline numberOfLines={3}
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
  textarea: { minHeight: 80, textAlignVertical: "top" },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});
