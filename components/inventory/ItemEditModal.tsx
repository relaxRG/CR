/**
 * 通用商品档案新增/编辑 Modal
 * 适用于：啤酒/冰块/水果/杯具/餐具/日用品
 * 各品类通过 extraFields 扩展专有字段
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import { useColors } from "@/hooks/use-colors";
import { GenericInventoryItem } from "@/lib/inventory-core/store";

export interface FieldConfig {
  key: string;
  label: string;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  multiline?: boolean;
}

export interface CategoryOption {
  value: string;
  label: string;
  color?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  item: GenericInventoryItem | null;
  accentColor: string;
  categoryLabel: string;
  /** 品类选项（如包装类型/杯型/食材类别等） */
  categoryOptions?: CategoryOption[];
  /** 默认单位 */
  defaultUnit?: string;
  /** 额外字段（如售价/用途/毛利率等） */
  extraFields?: FieldConfig[];
  onSave: (data: Omit<GenericInventoryItem, "id" | "createdAt" | "updatedAt">) => void;
}

export function ItemEditModal({
  visible, onClose, item, accentColor, categoryLabel,
  categoryOptions, defaultUnit = "个", extraFields = [], onSave
}: Props) {
  const colors = useColors();

  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [category, setCategory] = useState(categoryOptions?.[0]?.value ?? "other");
  const [spec, setSpec] = useState("");
  const [unit, setUnit] = useState(defaultUnit);
  const [currentStock, setCurrentStock] = useState("0");
  const [latestCostPrice, setLatestCostPrice] = useState("");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  // 表单配置的变化不应在用户填写时重置字段；仅在打开弹窗或切换商品时读取最新配置。
  const initialConfigRef = useRef({ categoryOptions, defaultUnit, extraFields });
  initialConfigRef.current = { categoryOptions, defaultUnit, extraFields };

  useEffect(() => {
    if (!visible) return;
    const initialConfig = initialConfigRef.current;
    if (item) {
      setName(item.name);
      setNameEn(item.nameEn ?? "");
      setCategory(item.category);
      setSpec(item.spec);
      setUnit(item.unit);
      setCurrentStock(String(item.currentStock));
      setLatestCostPrice(String(item.latestCostPrice || ""));
      setSupplier(item.supplier);
      setNotes(item.notes);
      // 恢复 extra 字段
      const extraInit: Record<string, string> = {};
      initialConfig.extraFields.forEach((f) => {
        extraInit[f.key] = String((item.extra as any)?.[f.key] ?? "");
      });
      setExtra(extraInit);
    } else {
      setName(""); setNameEn(""); setCategory(initialConfig.categoryOptions?.[0]?.value ?? "other");
      setSpec(""); setUnit(initialConfig.defaultUnit); setCurrentStock("0");
      setLatestCostPrice(""); setSupplier(""); setNotes("");
      const extraInit: Record<string, string> = {};
      initialConfig.extraFields.forEach((f) => { extraInit[f.key] = ""; });
      setExtra(extraInit);
    }
  }, [visible, item]);

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("请填写名称"); return; }
    const extraData: Record<string, unknown> = {};
    extraFields.forEach((f) => { extraData[f.key] = extra[f.key] ?? ""; });
    onSave({
      name: name.trim(),
      nameEn: nameEn.trim() || undefined,
      category,
      spec: spec.trim(),
      unit: unit.trim() || defaultUnit,
      // 既有商品的数量只能由采购、出库、盘点或月结动作变更；编辑档案不得绕过月度流水。
      currentStock: item ? item.currentStock : (Number(currentStock) || 0),
      latestCostPrice: Number(latestCostPrice) || 0,
      supplier: supplier.trim(),
      notes: notes.trim(),
      active: true,
      extra: Object.keys(extraData).length > 0 ? extraData : undefined,
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.sheet, { backgroundColor: colors.background }]}>
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[S.title, { color: colors.foreground }]}>{item ? `编辑${categoryLabel}` : `新增${categoryLabel}`}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: accentColor }}>保存</Text></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {/* 基础字段 */}
            {[
              { label: "名称 *", value: name, onChange: setName, placeholder: "商品名称" },
              { label: "英文名", value: nameEn, onChange: setNameEn, placeholder: "可选" },
              { label: "规格", value: spec, onChange: setSpec, placeholder: "如 330ml、500g/袋" },
              { label: "单位", value: unit, onChange: setUnit, placeholder: defaultUnit },
              ...(item ? [] : [{ label: "期初库存", value: currentStock, onChange: setCurrentStock, placeholder: "0", kb: "decimal-pad" as const }]),
              { label: "进货价（元/单位）", value: latestCostPrice, onChange: setLatestCostPrice, placeholder: "0.00", kb: "decimal-pad" as const },
              { label: "供应商", value: supplier, onChange: setSupplier, placeholder: "可选" },
            ].map((f, i) => (
              <View key={i}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.onChange} placeholder={f.placeholder}
                  placeholderTextColor={colors.muted} keyboardType={(f as any).kb ?? "default"}
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ))}

            {/* 品类选择 */}
            {categoryOptions && categoryOptions.length > 0 && (
              <View>
                <Text style={[S.label, { color: colors.muted }]}>分类</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                  {categoryOptions.map((opt) => {
                    const isSelected = category === opt.value;
                    const optColor = opt.color ?? accentColor;
                    return (
                      <TouchableOpacity key={opt.value} onPress={() => setCategory(opt.value)}
                        style={[S.chip, {
                          backgroundColor: isSelected ? optColor : colors.surface,
                          borderColor: isSelected ? optColor : colors.border,
                        }]}>
                        <Text style={{ fontSize: 13, color: isSelected ? "#fff" : colors.muted }}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* 额外字段 */}
            {extraFields.map((f) => (
              <View key={f.key}>
                <Text style={[S.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput
                  value={extra[f.key] ?? ""}
                  onChangeText={(v) => setExtra((prev) => ({ ...prev, [f.key]: v }))}
                  placeholder={f.placeholder ?? ""}
                  placeholderTextColor={colors.muted}
                  keyboardType={f.keyboardType ?? "default"}
                  multiline={f.multiline}
                  style={[f.multiline ? S.textarea : S.input, { color: colors.foreground, borderColor: colors.border }]}
                />
              </View>
            ))}

            {/* 备注 */}
            <View>
              <Text style={[S.label, { color: colors.muted }]}>备注</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="可选"
                placeholderTextColor={colors.muted} multiline numberOfLines={2}
                style={[S.textarea, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const S = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 60 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
});
