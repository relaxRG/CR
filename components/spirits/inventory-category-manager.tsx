import React, { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type InventoryCategory = { id: string; name: string; color: string; builtin: boolean; order: number };

type Props = {
  visible: boolean;
  colors: { background: string; surface: string; foreground: string; muted: string; border: string; primary: string; destructive?: string };
  categories: InventoryCategory[];
  itemCounts: Record<string, number>;
  onUpsert: (category: { id?: string; name: string; color: string; builtin: boolean; order?: number; originalName?: string }) => void;
  onMove: (id: string, direction: "up" | "down") => void;
  onSafeRemove: (id: string, targetCategory: string) => boolean;
  onClose: () => void;
};

const COLORS = ["#2563EB", "#16A34A", "#D97706", "#DC2626", "#7C3AED", "#0891B2", "#6B7280"];

export function InventoryCategoryManager({ visible, colors, categories, itemCounts, onUpsert, onMove, onSafeRemove, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<InventoryCategory | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState(COLORS[0]);
  const [pendingDelete, setPendingDelete] = useState<InventoryCategory | null>(null);
  const [targetCategory, setTargetCategory] = useState<string>("");
  const categoryNames = useMemo(() => new Set(categories.map((category) => category.name.trim().toLocaleLowerCase())), [categories]);

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (categoryNames.has(name.toLocaleLowerCase())) { Alert.alert("分类已存在", "请输入不重复的分类名称。"); return; }
    onUpsert({ name, color: COLORS[categories.length % COLORS.length], builtin: false, order: categories.length });
    setNewName("");
  };
  const saveEdit = () => {
    if (!editing) return;
    const name = editingName.trim();
    if (!name) return;
    if (name.toLocaleLowerCase() !== editing.name.toLocaleLowerCase() && categoryNames.has(name.toLocaleLowerCase())) { Alert.alert("分类已存在", "请输入不重复的分类名称。"); return; }
    onUpsert({ id: editing.id, originalName: editing.builtin ? editing.id : undefined, name, color: editingColor, builtin: editing.builtin, order: editing.order });
    setEditing(null);
  };
  const requestDelete = (category: InventoryCategory) => {
    const count = itemCounts[category.name] ?? 0;
    if (!count) {
      Alert.alert("删除分类", `确认删除「${category.name}」？`, [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => onSafeRemove(category.id, "") }]);
      return;
    }
    setPendingDelete(category);
    setTargetCategory("");
  };
  const completeDelete = () => {
    if (!pendingDelete) return;
    onSafeRemove(pendingDelete.id, targetCategory);
    setPendingDelete(null);
  };

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={S.backdrop} onPress={onClose} />
    <View style={[S.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={[S.handle, { backgroundColor: colors.border }]} />
      <View style={S.header}>
        <TouchableOpacity onPress={onClose} hitSlop={10} testID="inventory-category-manager-close"><Text style={{ color: colors.muted, fontWeight: "600" }}>关闭</Text></TouchableOpacity>
        <Text style={[S.title, { color: colors.foreground }]}>进销存分类</Text>
        <View style={S.headerSpacer} />
      </View>
      <View style={S.addRow}><TextInput value={newName} onChangeText={setNewName} placeholder="新增分类名称" placeholderTextColor={colors.muted} style={[S.input, { borderColor: colors.border, color: colors.foreground }]} /><TouchableOpacity onPress={add} style={[S.addButton, { backgroundColor: colors.primary }]}><Text style={{ color: "#fff", fontWeight: "800" }}>+ 新增</Text></TouchableOpacity></View>
      <ScrollView contentContainerStyle={S.list}>
        {categories.map((category, index) => {
          const count = itemCounts[category.name] ?? 0;
          return <View key={category.id} style={[S.item, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[S.dot, { backgroundColor: category.color }]} />
            <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "700" }}>{category.name}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>{count} 款 · {category.builtin ? "内置分类" : "自定义分类"}</Text></View>
            <TouchableOpacity disabled={index === 0} onPress={() => onMove(category.id, "up")} style={[S.icon, { opacity: index === 0 ? 0.3 : 1 }]}><Text style={{ color: colors.primary }}>↑</Text></TouchableOpacity>
            <TouchableOpacity disabled={index === categories.length - 1} onPress={() => onMove(category.id, "down")} style={[S.icon, { opacity: index === categories.length - 1 ? 0.3 : 1 }]}><Text style={{ color: colors.primary }}>↓</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { setEditing(category); setEditingName(category.name); setEditingColor(category.color); }} style={S.textAction} testID={`inventory-category-edit-${category.id}`}><Text style={{ color: colors.primary }}>修改</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => requestDelete(category)} style={S.textAction} testID={`inventory-category-delete-${category.id}`}><Text style={{ color: colors.destructive ?? "#DC2626" }}>删除</Text></TouchableOpacity>
          </View>;
        })}
      </ScrollView>
      <Text style={{ color: colors.muted, fontSize: 11, lineHeight: 17 }}>所有分类都可删除；有内容时，先迁移到其他分类或设为未分类。删除内置分类后不会在下次启动时重新出现，分类顺序仍会同步影响库存分组、筛选和新增酒款表单。</Text>
    </View>
    <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
      <View style={S.center}>
        <View style={[S.dialog, { backgroundColor: colors.background }]}>
          <View style={S.dialogBody}>
            <Text style={[S.title, { color: colors.foreground }]}>修改分类</Text>
            <TextInput value={editingName} onChangeText={setEditingName} style={[S.input, { borderColor: colors.border, color: colors.foreground, marginTop: 14 }]} />
            <Text style={[S.label, { color: colors.muted }]}>分类颜色</Text>
            <View style={S.colorRow}>{COLORS.map((color) => <TouchableOpacity key={color} testID={`inventory-category-color-${color}`} onPress={() => setEditingColor(color)} style={[S.colorChoice, { backgroundColor: color, borderColor: editingColor === color ? colors.foreground : "transparent", borderWidth: editingColor === color ? 2 : 0 }]} />)}</View>
          </View>
          <View style={[S.editCardFooter, { borderTopColor: colors.border }]}>
            <TouchableOpacity onPress={() => setEditing(null)} style={S.editCardAction} testID="inventory-category-edit-cancel"><Text style={{ color: colors.muted, fontWeight: "600" }}>取消</Text></TouchableOpacity>
            <TouchableOpacity onPress={saveEdit} style={S.editCardAction} testID="inventory-category-edit-save"><Text style={{ color: colors.primary, fontWeight: "700" }}>保存</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={Boolean(pendingDelete)} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)}>
      <View style={S.center}>
        <View style={[S.dialog, { backgroundColor: colors.background }]}>
          <View style={S.dialogBody}>
            <Text style={[S.title, { color: colors.foreground }]}>处理分类内容</Text>
            <Text style={{ color: colors.muted, lineHeight: 20, marginTop: 8 }}>「{pendingDelete?.name}」包含 {pendingDelete ? itemCounts[pendingDelete.name] ?? 0 : 0} 款商品。删除前必须先迁移分类归属或设为未分类。</Text>
            <Text style={[S.label, { color: colors.muted }]}>移动至</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={S.targets}>
              <TouchableOpacity onPress={() => setTargetCategory("")} style={[S.target, { borderColor: targetCategory === "" ? colors.primary : colors.border }]}><Text style={{ color: targetCategory === "" ? colors.primary : colors.foreground }}>未分类</Text></TouchableOpacity>
              {categories.filter((category) => category.id !== pendingDelete?.id).map((category) => <TouchableOpacity key={category.id} onPress={() => setTargetCategory(category.name)} style={[S.target, { borderColor: targetCategory === category.name ? colors.primary : colors.border }]}><Text style={{ color: targetCategory === category.name ? colors.primary : colors.foreground }}>{category.name}</Text></TouchableOpacity>)}
            </ScrollView>
            <View style={S.dialogActions}>
              <TouchableOpacity onPress={() => setPendingDelete(null)}><Text style={{ color: colors.muted }}>取消</Text></TouchableOpacity>
              <TouchableOpacity onPress={completeDelete}><Text style={{ color: colors.destructive ?? "#DC2626", fontWeight: "600" }}>迁移并删除</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  </Modal>;
}

const S = StyleSheet.create({ backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.38)" }, sheet: { width: "100%", maxWidth: 720, alignSelf: "center", marginTop: "auto", maxHeight: "86%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16 }, handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10 }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 }, headerSpacer: { width: 30 }, title: { fontSize: 17, fontWeight: "600" }, addRow: { flexDirection: "row", gap: 8, marginBottom: 10 }, input: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, flex: 1 }, addButton: { minWidth: 72, minHeight: 44, borderRadius: 10, justifyContent: "center", alignItems: "center" }, list: { gap: 8, paddingBottom: 12 }, item: { minHeight: 62, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 }, dot: { width: 9, height: 32, borderRadius: 4 }, icon: { width: 28, minHeight: 38, justifyContent: "center", alignItems: "center" }, textAction: { minHeight: 38, justifyContent: "center", paddingHorizontal: 4 }, center: { flex: 1, backgroundColor: "rgba(0,0,0,0.38)", alignItems: "center", justifyContent: "center", padding: 24 }, dialog: { width: "100%", maxWidth: 540, alignSelf: "center", borderRadius: 16, overflow: "hidden" }, dialogBody: { padding: 18 }, dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 24, marginTop: 20 }, editCardFooter: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, minHeight: 52 }, editCardAction: { flex: 1, justifyContent: "center", alignItems: "center" }, label: { fontSize: 12, fontWeight: "600", marginTop: 14, marginBottom: 8 }, targets: { gap: 8 }, target: { minHeight: 40, borderWidth: 1, borderRadius: 20, justifyContent: "center", paddingHorizontal: 12 }, colorRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, colorChoice: { width: 28, height: 28, borderRadius: 14 },
});
