/**
 * 葡萄酒添加/编辑表单
 */
import React, { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useWineStore } from "@/lib/wine/store";
import { WineStyle, WINE_STYLE_LABELS } from "@/lib/wine/types";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";

const STYLES: WineStyle[] = ["red", "white", "rose", "sparkling", "sweet", "fortified", "other"];

export default function WineFormScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { bottles, addBottle, updateBottle } = useWineStore();
  const existing = id ? bottles.find((b) => b.id === id) : undefined;

  const [name, setName] = useState(existing?.name ?? "");
  const [nameEn, setNameEn] = useState(existing?.nameEn ?? "");
  const [vintage, setVintage] = useState(existing?.vintage ?? "");
  const [region, setRegion] = useState(existing?.region ?? "");
  const [grape, setGrape] = useState(existing?.grape ?? "");
  const [winery, setWinery] = useState(existing?.winery ?? "");
  const [style, setStyle] = useState<WineStyle>(existing?.style ?? "red");
  const [abv, setAbv] = useState(existing?.abv?.toString() ?? "");
  const [costPrice, setCostPrice] = useState(existing?.costPrice?.toString() ?? "");
  const [salePrice, setSalePrice] = useState(existing?.salePrice?.toString() ?? "");
  const [stock, setStock] = useState(existing?.stock?.toString() ?? "0");
  const [rating, setRating] = useState(existing?.rating?.toString() ?? "");
  const [supplier, setSupplier] = useState(existing?.supplier ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请输入酒名"); return; }
    const data = {
      name: name.trim(), nameEn: nameEn.trim(), vintage: vintage.trim(),
      region: region.trim(), grape: grape.trim(), winery: winery.trim(), style,
      abv: abv ? parseFloat(abv) : null,
      costPrice: costPrice ? parseFloat(costPrice) : null,
      salePrice: salePrice ? parseFloat(salePrice) : null,
      stock: parseInt(stock) || 0,
      rating: rating ? parseFloat(rating) : null,
      supplier: supplier.trim(), notes: notes.trim(), photoUri: existing?.photoUri ?? "",
    };
    if (existing) { updateBottle(existing.id, data); }
    else { addBottle(data); }
    tap();
    router.back();
  };

  return (
    <ScreenContainer>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>{existing ? "编辑葡萄酒" : "添加葡萄酒"}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={handleSave} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={[styles.saveBtn, { color: colors.primary }]}>保存</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 风格选择 */}
        <View>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>风格</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {STYLES.map((s) => (
              <Pressable key={s} onPress={() => setStyle(s)}
                style={[styles.styleChip, { borderColor: style === s ? colors.primary : colors.border, backgroundColor: style === s ? colors.primary + "22" : colors.surface }]}>
                <Text style={{ color: style === s ? colors.primary : colors.muted, fontWeight: "600", fontSize: 13 }}>{WINE_STYLE_LABELS[s]}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        {[
          { label: "中文名称 *", value: name, onChange: setName, placeholder: "如：木桐酒庄" },
          { label: "英文/原文名称", value: nameEn, onChange: setNameEn, placeholder: "如：Château Mouton Rothschild" },
          { label: "年份", value: vintage, onChange: setVintage, placeholder: "如：2018" },
          { label: "产区", value: region, onChange: setRegion, placeholder: "如：波尔多 Pauillac" },
          { label: "品种", value: grape, onChange: setGrape, placeholder: "如：赤霞珠" },
          { label: "酒庄/品牌", value: winery, onChange: setWinery, placeholder: "如：木桐酒庄" },
          { label: "酒精度（%）", value: abv, onChange: setAbv, placeholder: "如：13.5", keyboardType: "decimal-pad" as const },
          { label: "进价（元）", value: costPrice, onChange: setCostPrice, placeholder: "可选", keyboardType: "decimal-pad" as const },
          { label: "售价（元）", value: salePrice, onChange: setSalePrice, placeholder: "可选", keyboardType: "decimal-pad" as const },
          { label: "库存（瓶）", value: stock, onChange: setStock, placeholder: "0", keyboardType: "number-pad" as const },
          { label: "评分（0-100）", value: rating, onChange: setRating, placeholder: "可选", keyboardType: "decimal-pad" as const },
          { label: "供应商", value: supplier, onChange: setSupplier, placeholder: "可选" },
        ].map((f) => (
          <View key={f.label}>
            <Text style={[styles.fieldLabel, { color: colors.muted }]}>{f.label}</Text>
            <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder} placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              keyboardType={(f as any).keyboardType} returnKeyType="next" />
          </View>
        ))}
        <View>
          <Text style={[styles.fieldLabel, { color: colors.muted }]}>品鉴笔记</Text>
          <TextInput value={notes} onChangeText={setNotes} placeholder="香气、口感、配餐建议…" placeholderTextColor={colors.muted}
            multiline numberOfLines={4}
            style={[styles.input, styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} />
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
  styleChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});

