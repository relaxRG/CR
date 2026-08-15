import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { FoodIngredient } from "@/lib/food/types";

type FoodLedgerMovementModalProps = {
  visible: boolean;
  mode: "consume" | "stocktake";
  ingredients: FoodIngredient[];
  colors: Record<string, string>;
  onSave: (input: { ingredientId: string; quantity: number; date: string; unitCost?: number; notes: string }) => void;
  onClose: () => void;
};

/** 食材消耗与月末实盘共用的账务录入面板。 */
export function FoodLedgerMovementModal({ visible, mode, ingredients, colors, onSave, onClose }: FoodLedgerMovementModalProps) {
  const [ingredientId, setIngredientId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const ingredient = ingredients.find((item) => item.id === ingredientId);
  const isStocktake = mode === "stocktake";

  useEffect(() => {
    if (ingredient) setUnitCost(String(ingredient.costPrice ?? ""));
  }, [ingredientId, ingredient]);

  const save = () => {
    const parsedQuantity = Number(quantity);
    if (!ingredientId) return;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0 || (!isStocktake && parsedQuantity <= 0)) return;
    onSave({ ingredientId, quantity: parsedQuantity, date, unitCost: unitCost ? Number(unitCost) : undefined, notes });
    setIngredientId(""); setQuantity(""); setUnitCost(""); setNotes("");
    onClose();
  };

  const title = isStocktake ? "食材月末盘点" : "食材消耗录入";
  const quantityLabel = isStocktake ? `实盘期末数量（${ingredient?.unit ?? "单位"}）` : `消耗数量（${ingredient?.unit ?? "单位"}）`;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[S.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ color: colors.error, fontSize: 17 }}>取消</Text></Pressable>
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>{title}</Text>
          <Pressable onPress={save}><Text style={{ color: "#10B981", fontSize: 17, fontWeight: "700" }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={S.body}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>选择食材</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={S.chipRow}>
              {ingredients.map((item) => (
                <TouchableOpacity key={item.id} onPress={() => setIngredientId(item.id)} style={[S.chip, { borderColor: ingredientId === item.id ? "#10B981" : colors.border, backgroundColor: ingredientId === item.id ? "#10B981" : colors.surface }]}>
                  <Text style={{ color: ingredientId === item.id ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>{item.name}</Text>
                  <Text style={{ color: ingredientId === item.id ? "#ffffffbb" : colors.muted, fontSize: 10 }}>现存 {item.stock}{item.unit}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          {ingredient && <View style={[S.info, { backgroundColor: "#10B98112", borderColor: "#10B98133" }]}><Text style={{ color: "#10B981", fontWeight: "700" }}>{ingredient.name}</Text><Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>当前库存 {ingredient.stock}{ingredient.unit} · 当前单价 ¥{ingredient.costPrice ?? 0}</Text></View>}
          <Field label={quantityLabel} value={quantity} setValue={setQuantity} colors={colors} keyboardType="decimal-pad" />
          <Field label="单位成本（可选）" value={unitCost} setValue={setUnitCost} colors={colors} keyboardType="decimal-pad" />
          <Field label="日期" value={date} setValue={setDate} colors={colors} />
          <Text style={{ color: colors.muted, fontSize: 13 }}>备注（可选）</Text>
          <TextInput value={notes} onChangeText={setNotes} multiline placeholder="例如：备餐领用、盘点差异原因" placeholderTextColor={colors.muted} style={[S.notes, { color: colors.foreground, borderColor: colors.border }]} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, setValue, colors, keyboardType = "default" }: { label: string; value: string; setValue: (value: string) => void; colors: Record<string, string>; keyboardType?: "default" | "decimal-pad" }) {
  return <View><Text style={{ color: colors.muted, fontSize: 13, marginBottom: 4 }}>{label}</Text><TextInput value={value} onChangeText={setValue} placeholder={label.includes("日期") ? "YYYY-MM-DD" : "0"} placeholderTextColor={colors.muted} keyboardType={keyboardType} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} /></View>;
}

const S = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { padding: 16, gap: 12 },
  chipRow: { flexDirection: "row", gap: 8, paddingVertical: 3 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minWidth: 86 },
  info: { borderWidth: 1, borderRadius: 10, padding: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  notes: { borderWidth: 1, borderRadius: 10, minHeight: 72, paddingHorizontal: 12, paddingVertical: 10, textAlignVertical: "top" },
});
