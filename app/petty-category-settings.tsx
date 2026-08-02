/**
 * 备用金分类管理页
 * - 查看所有分类（按分组）
 * - 修改每个分类的进销存映射
 * - 新增自定义分类
 * - 禁用/启用分类
 * - 重置为默认
 */
import React, { useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  usePettyCategoryStore,
  PettyCategory, ExtendedInventoryCategory,
  EXTENDED_INVENTORY_LABELS, EXTENDED_INVENTORY_COLORS,
  DEFAULT_PETTY_CATEGORIES,
} from "@/lib/store/petty-category-store";

const INV_OPTIONS: ExtendedInventoryCategory[] = [
  "food", "spirit", "wine", "beer", "ice", "equipment", "tableware", "daily", "none"
];

// ─── 分类编辑 Modal ───────────────────────────────────────────────────────────
function CategoryEditModal({
  visible, category, isNew, colors, onSave, onClose
}: {
  visible: boolean;
  category: PettyCategory | null;
  isNew: boolean;
  colors: any;
  onSave: (cat: PettyCategory) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [code, setCode] = useState(category?.code ?? "");
  const [label, setLabel] = useState(category?.label ?? "");
  const [group, setGroup] = useState(category?.group ?? "A");
  const [groupLabel, setGroupLabel] = useState(category?.groupLabel ?? "");
  const [invCat, setInvCat] = useState<ExtendedInventoryCategory>(category?.inventoryCategory ?? "none");
  const [isIncome, setIsIncome] = useState(category?.isIncome ?? false);

  React.useEffect(() => {
    if (category) {
      setCode(category.code); setLabel(category.label);
      setGroup(category.group); setGroupLabel(category.groupLabel);
      setInvCat(category.inventoryCategory); setIsIncome(category.isIncome);
    }
  }, [category]);

  const handleSave = () => {
    if (!code.trim() || !label.trim()) { Alert.alert("请填写分类代码和标签"); return; }
    const cat: PettyCategory = {
      code: code.trim().toUpperCase(),
      label: label.trim(),
      group: group.trim().toUpperCase() || code[0].toUpperCase(),
      groupLabel: groupLabel.trim() || `${group.trim().toUpperCase()} 自定义`,
      isIncome,
      isTransfer: isIncome && ["N0","N1","N2"].includes(code.trim().toUpperCase()),
      inventoryCategory: invCat,
      isDefault: category?.isDefault ?? false,
      sortOrder: category?.sortOrder ?? 999,
      enabled: true,
    };
    onSave(cat);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[EM.sheet, { backgroundColor: colors.background }]}>
          <View style={[EM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[EM.title, { color: colors.foreground }]}>{isNew ? "新增分类" : "编辑分类"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* 基本信息 */}
            <View style={[EM.section, { borderColor: colors.border }]}>
              <Text style={[EM.sectionTitle, { color: colors.muted }]}>分类信息</Text>
              <View style={EM.row}>
                <Text style={[EM.label, { color: colors.foreground }]}>分类代码 <Text style={{ color: colors.error }}>*</Text></Text>
                <TextInput value={code} onChangeText={setCode}
                  placeholder="如 B4、Z1" placeholderTextColor={colors.muted}
                  editable={isNew || !(category?.isDefault)}
                  style={[EM.input, { color: colors.foreground, borderColor: colors.border, opacity: (!isNew && category?.isDefault) ? 0.5 : 1 }]} />
              </View>
              <View style={EM.row}>
                <Text style={[EM.label, { color: colors.foreground }]}>显示标签 <Text style={{ color: colors.error }}>*</Text></Text>
                <TextInput value={label} onChangeText={setLabel}
                  placeholder="如 B4 精酿啤酒" placeholderTextColor={colors.muted}
                  style={[EM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
              <View style={EM.row}>
                <Text style={[EM.label, { color: colors.foreground }]}>所属分组</Text>
                <TextInput value={group} onChangeText={setGroup}
                  placeholder="如 B" placeholderTextColor={colors.muted}
                  style={[EM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
              <View style={EM.row}>
                <Text style={[EM.label, { color: colors.foreground }]}>分组标签</Text>
                <TextInput value={groupLabel} onChangeText={setGroupLabel}
                  placeholder="如 B 酒水耗材" placeholderTextColor={colors.muted}
                  style={[EM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            </View>

            {/* 进销存映射 */}
            <View style={[EM.section, { borderColor: colors.border }]}>
              <Text style={[EM.sectionTitle, { color: colors.muted }]}>关联进销存品类</Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 10 }}>
                录入此分类的备用金时，系统会提示关联对应进销存入库
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {INV_OPTIONS.map((opt) => {
                  const color = EXTENDED_INVENTORY_COLORS[opt];
                  const selected = invCat === opt;
                  return (
                    <TouchableOpacity key={opt} onPress={() => { tap(); setInvCat(opt); }}
                      style={[EM.invChip, {
                        backgroundColor: selected ? color : colors.surface,
                        borderColor: selected ? color : colors.border,
                      }]}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: selected ? "#fff" : color }}>
                        {EXTENDED_INVENTORY_LABELS[opt]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* 收入类型 */}
            <View style={[EM.section, { borderColor: colors.border }]}>
              <Text style={[EM.sectionTitle, { color: colors.muted }]}>账务类型</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[{ v: false, label: "支出" }, { v: true, label: "收入" }].map((opt) => (
                  <TouchableOpacity key={String(opt.v)} onPress={() => { tap(); setIsIncome(opt.v); }}
                    style={[EM.invChip, {
                      backgroundColor: isIncome === opt.v ? (opt.v ? colors.success : colors.error) : colors.surface,
                      borderColor: isIncome === opt.v ? (opt.v ? colors.success : colors.error) : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: isIncome === opt.v ? "#fff" : colors.muted }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function PettyCategorySettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { categories, groups, upsertCategory, deleteCategory, toggleEnabled, updateMapping, resetToDefault } = usePettyCategoryStore();

  const [editModal, setEditModal] = useState(false);
  const [editCat, setEditCat] = useState<PettyCategory | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["A", "B", "C", "F", "K"]));

  const handleEdit = (cat: PettyCategory) => {
    tap();
    setEditCat(cat);
    setIsNew(false);
    setEditModal(true);
  };

  const handleNew = () => {
    tap();
    setEditCat(null);
    setIsNew(true);
    setEditModal(true);
  };

  const handleDelete = (cat: PettyCategory) => {
    if (cat.isDefault) {
      Alert.alert("禁用分类", `系统默认分类「${cat.label}」不可删除，是否禁用？`, [
        { text: "取消", style: "cancel" },
        { text: "禁用", style: "destructive", onPress: () => toggleEnabled(cat.code) },
      ]);
    } else {
      Alert.alert("删除分类", `确认删除「${cat.label}」？`, [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => deleteCategory(cat.code) },
      ]);
    }
  };

  const handleReset = () => {
    Alert.alert("重置为默认", "将清除所有自定义修改，恢复系统默认分类配置。", [
      { text: "取消", style: "cancel" },
      { text: "重置", style: "destructive", onPress: resetToDefault },
    ]);
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  // 包含已禁用的分类（用于管理页）
  const allCategories = React.useMemo(() => {
    const customMap = new Map(
      // 从 DEFAULT_PETTY_CATEGORIES 合并自定义
      DEFAULT_PETTY_CATEGORIES.map((d) => [d.code, d])
    );
    return customMap;
  }, []);

  return (
    <ScreenContainer>
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>备用金分类管理</Text>
        <Pressable onPress={handleNew} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* 说明 */}
        <View style={[S.infoCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "700" }}>关联进销存说明</Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 18 }}>
            为每个备用金分类设置对应的进销存品类。录入备用金时，系统会自动提示添加商品明细并同步入库。
            B1（酒水现结）→ 烈酒/啤酒，B2（酒水配料）→ 葡萄酒，B3（酒水耗材）→ 冰块，A类 → 食材，C类 → 设备，F类 → 杯具餐具，K2/K3 → 日用品。
          </Text>
        </View>

        {/* 重置按钮 */}
        <TouchableOpacity onPress={handleReset}
          style={[S.resetBtn, { borderColor: colors.error + "44" }]}>
          <IconSymbol name="arrow.counterclockwise" size={14} color={colors.error} />
          <Text style={{ fontSize: 13, color: colors.error }}>重置为系统默认</Text>
        </TouchableOpacity>

        {/* 分组列表 */}
        {groups.map((g) => (
          <View key={g.group} style={{ marginBottom: 8 }}>
            {/* 分组标题 */}
            <TouchableOpacity onPress={() => toggleGroup(g.group)}
              style={[S.groupHeader, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "22" }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary, flex: 1 }}>{g.groupLabel}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{g.categories.length}个</Text>
              <IconSymbol name={expandedGroups.has(g.group) ? "chevron.up" : "chevron.down"} size={14} color={colors.muted} />
            </TouchableOpacity>

            {expandedGroups.has(g.group) && g.categories.map((cat) => {
              const invColor = EXTENDED_INVENTORY_COLORS[cat.inventoryCategory];
              return (
                <View key={cat.code} style={[S.catRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={[S.codeBadge, { backgroundColor: colors.primary + "15" }]}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.primary }}>{cat.code}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{cat.label}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <View style={[S.invTag, { backgroundColor: invColor + "22", borderColor: invColor + "44" }]}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: invColor }}>
                          {EXTENDED_INVENTORY_LABELS[cat.inventoryCategory]}
                        </Text>
                      </View>
                      {cat.isIncome && (
                        <View style={[S.invTag, { backgroundColor: colors.success + "22", borderColor: colors.success + "44" }]}>
                          <Text style={{ fontSize: 10, color: colors.success }}>收入</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable onPress={() => handleEdit(cat)} style={{ padding: 6 }}>
                      <IconSymbol name="pencil" size={15} color={colors.primary} />
                    </Pressable>
                    <Pressable onPress={() => handleDelete(cat)} style={{ padding: 6 }}>
                      <IconSymbol name="trash" size={15} color={colors.error} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <CategoryEditModal
        visible={editModal}
        category={editCat}
        isNew={isNew}
        colors={colors}
        onSave={upsertCategory}
        onClose={() => setEditModal(false)}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignSelf: "flex-start", marginBottom: 12 },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 4 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 3, marginLeft: 8 },
  codeBadge: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  invTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
});

const EM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  row: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  invChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
});
