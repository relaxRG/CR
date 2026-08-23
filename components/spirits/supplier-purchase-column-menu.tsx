import React, { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SupplierPurchaseNameOption, SupplierPurchaseSortKey, SupplierPurchaseTableView } from "@/lib/spirits/purchase-table-view";

type NameLanguage = "zh" | "en";

type Props = {
  visible: boolean;
  column: SupplierPurchaseSortKey | null;
  colors: { background: string; surface: string; foreground: string; muted: string; border: string; primary: string };
  groups: string[];
  /** 已按分类管理入口权威顺序排列，供分类列多选筛选使用。 */
  categories: string[];
  nameOptions: SupplierPurchaseNameOption[];
  nameLanguage: NameLanguage;
  onNameLanguageChange: (language: NameLanguage) => void;
  view: SupplierPurchaseTableView;
  onViewChange: (view: SupplierPurchaseTableView) => void;
  onClose: () => void;
};

const TITLES: Record<SupplierPurchaseSortKey, string> = {
  name: "商品名称",
  quantity: "数量",
  unitPrice: "单价",
  amount: "总价",
  category: "分类",
  group: "集团",
};

function updateFilters(view: SupplierPurchaseTableView, key: keyof SupplierPurchaseTableView["filters"], value: string | string[] | boolean): SupplierPurchaseTableView {
  return { ...view, filters: { ...view.filters, [key]: value } };
}

export function SupplierPurchaseColumnMenu({
  visible, column, colors, groups, categories, nameOptions, nameLanguage, onNameLanguageChange, view, onViewChange, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const range = useMemo(() => {
    if (column === "quantity") return ["quantityMin", "quantityMax"] as const;
    if (column === "unitPrice") return ["unitPriceMin", "unitPriceMax"] as const;
    if (column === "amount") return ["amountMin", "amountMax"] as const;
    return null;
  }, [column]);

  if (!column) return null;
  const isSorted = view.sort?.key === column;
  const selectSort = (direction: "asc" | "desc") => onViewChange({ ...view, sort: { key: column, direction } });
  const clearColumn = () => {
    const next = { ...view, filters: { ...view.filters } };
    if (column === "name") { next.filters.nameQuery = ""; next.filters.nameKeys = []; next.filters.onlyUnmatchedNames = false; }
    if (column === "quantity") { next.filters.quantityMin = ""; next.filters.quantityMax = ""; }
    if (column === "unitPrice") { next.filters.unitPriceMin = ""; next.filters.unitPriceMax = ""; }
    if (column === "amount") { next.filters.amountMin = ""; next.filters.amountMax = ""; }
    if (column === "category") { next.filters.categories = []; next.filters.onlyUnassignedCategory = false; }
    if (column === "group") { next.filters.groups = []; next.filters.onlyUnassignedGroup = false; }
    if (next.sort?.key === column) next.sort = null;
    onViewChange(next);
  };

  const normalizedNameQuery = view.filters.nameQuery.trim().toLocaleLowerCase();
  const visibleNameOptions = column === "name"
    ? nameOptions.filter((option) => !normalizedNameQuery || option.searchableName.toLocaleLowerCase().includes(normalizedNameQuery))
    : [];
  const visibleNameKeys = visibleNameOptions.map((option) => option.key);
  const allVisibleNamesSelected = visibleNameKeys.length > 0 && visibleNameKeys.every((key) => view.filters.nameKeys.includes(key));
  const toggleNameKey = (key: string) => onViewChange(updateFilters(view, "nameKeys", view.filters.nameKeys.includes(key)
    ? view.filters.nameKeys.filter((value) => value !== key)
    : [...view.filters.nameKeys, key]));
  const toggleAllVisibleNames = () => onViewChange(updateFilters(view, "nameKeys", allVisibleNamesSelected
    ? view.filters.nameKeys.filter((key) => !visibleNameKeys.includes(key))
    : [...new Set([...view.filters.nameKeys, ...visibleNameKeys])],
  ));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={S.backdrop} onPress={onClose} />
      <View style={[S.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}> 
        <View style={[S.handle, { backgroundColor: colors.border }]} />
        <View style={S.header}>
          <Text style={[S.title, { color: colors.foreground }]}>{TITLES[column]}调整</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={{ color: colors.primary, fontWeight: "700" }}>完成</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={S.body}>
          {column === "name" && (
            <>
              <Text style={[S.label, { color: colors.muted }]}>显示语言</Text>
              <View style={S.row}>
                {(["zh", "en"] as const).map((language) => (
                  <TouchableOpacity key={language} onPress={() => onNameLanguageChange(language)}
                    style={[S.choice, { borderColor: nameLanguage === language ? colors.primary : colors.border, backgroundColor: nameLanguage === language ? colors.primary + "18" : colors.surface }]}>
                    <Text style={{ color: nameLanguage === language ? colors.primary : colors.foreground, fontWeight: "700" }}>{language === "zh" ? "显示中文" : "显示英文"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[S.label, { color: colors.muted }]}>名称筛选</Text>
              <TextInput value={view.filters.nameQuery} onChangeText={(value) => onViewChange(updateFilters(view, "nameQuery", value))}
                placeholder="搜索商品名称" placeholderTextColor={colors.muted}
                style={[S.input, { borderColor: colors.border, color: colors.foreground }]} />
              <View style={S.nameFilterHeader}>
                <TouchableOpacity testID="supplier-name-select-all-visible" onPress={toggleAllVisibleNames} style={{ minHeight: 36, justifyContent: "center" }}>
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>{allVisibleNamesSelected ? "取消全选当前结果" : "全选当前结果"}</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.muted, fontSize: 12 }}>已选 {view.filters.nameKeys.length} / {nameOptions.length}</Text>
              </View>
              <TouchableOpacity testID="supplier-name-only-unmatched" onPress={() => onViewChange(updateFilters(view, "onlyUnmatchedNames", !view.filters.onlyUnmatchedNames))}
                style={[S.unmatched, { borderColor: view.filters.onlyUnmatchedNames ? colors.primary : colors.border, backgroundColor: view.filters.onlyUnmatchedNames ? colors.primary + "18" : colors.surface }]}>
                <Text style={{ color: view.filters.onlyUnmatchedNames ? colors.primary : colors.foreground, fontWeight: "700" }}>{view.filters.onlyUnmatchedNames ? "✓ 仅显示未匹配商品" : "□ 仅显示未匹配商品"}</Text>
              </TouchableOpacity>
              <View style={[S.nameOptions, { borderColor: colors.border }]}>
                {visibleNameOptions.map((option) => {
                  const selected = view.filters.nameKeys.includes(option.key);
                  return <TouchableOpacity key={option.key} testID={`supplier-name-option-${option.key}`} onPress={() => toggleNameKey(option.key)} style={S.nameOption}>
                    <Text style={{ color: selected ? colors.primary : colors.muted, fontSize: 16 }}>{selected ? "☑" : "□"}</Text>
                    <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }} numberOfLines={1}>{option.label}</Text>
                    <Text style={{ color: option.isMatched ? colors.muted : "#D97706", fontSize: 11 }}>{option.isMatched ? `${option.count}笔` : `未匹配 · ${option.count}笔`}</Text>
                  </TouchableOpacity>;
                })}
                {visibleNameOptions.length === 0 && <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 12 }}>没有符合当前搜索的商品名称</Text>}
              </View>
            </>
          )}
          {range && (
            <>
              <Text style={[S.label, { color: colors.muted }]}>范围筛选</Text>
              <View style={S.row}>
                <TextInput value={view.filters[range[0]]} onChangeText={(value) => onViewChange(updateFilters(view, range[0], value))}
                  keyboardType="decimal-pad" placeholder="最小值" placeholderTextColor={colors.muted}
                  style={[S.input, S.halfInput, { borderColor: colors.border, color: colors.foreground }]} />
                <Text style={{ color: colors.muted }}>至</Text>
                <TextInput value={view.filters[range[1]]} onChangeText={(value) => onViewChange(updateFilters(view, range[1], value))}
                  keyboardType="decimal-pad" placeholder="最大值" placeholderTextColor={colors.muted}
                  style={[S.input, S.halfInput, { borderColor: colors.border, color: colors.foreground }]} />
              </View>
            </>
          )}
          {column === "category" && (
            <>
              <Text style={[S.label, { color: colors.muted }]}>分类筛选</Text>
              <View style={S.chips}>
                <TouchableOpacity testID="supplier-category-only-unassigned" onPress={() => onViewChange(updateFilters(view, "onlyUnassignedCategory", !view.filters.onlyUnassignedCategory))}
                  style={[S.chip, { borderColor: view.filters.onlyUnassignedCategory ? colors.primary : colors.border, backgroundColor: view.filters.onlyUnassignedCategory ? colors.primary + "18" : colors.surface }]}>
                  <Text style={{ color: view.filters.onlyUnassignedCategory ? colors.primary : colors.foreground }}>{view.filters.onlyUnassignedCategory ? "✓ 仅未分类" : "仅未分类"}</Text>
                </TouchableOpacity>
                {categories.map((category) => {
                  const selected = view.filters.categories.includes(category);
                  return <TouchableOpacity key={category} testID={`supplier-category-option-${category}`} onPress={() => onViewChange(updateFilters(view, "categories", selected ? view.filters.categories.filter((value) => value !== category) : [...view.filters.categories, category]))}
                    style={[S.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "18" : colors.surface }]}>
                    <Text style={{ color: selected ? colors.primary : colors.foreground }}>{category}</Text>
                  </TouchableOpacity>;
                })}
              </View>
            </>
          )}
          {column === "group" && (
            <>
              <Text style={[S.label, { color: colors.muted }]}>集团筛选</Text>
              <View style={S.chips}>
                <TouchableOpacity onPress={() => onViewChange(updateFilters(view, "onlyUnassignedGroup", !view.filters.onlyUnassignedGroup))}
                  style={[S.chip, { borderColor: view.filters.onlyUnassignedGroup ? colors.primary : colors.border, backgroundColor: view.filters.onlyUnassignedGroup ? colors.primary + "18" : colors.surface }]}>
                  <Text style={{ color: view.filters.onlyUnassignedGroup ? colors.primary : colors.foreground }}>仅待填</Text>
                </TouchableOpacity>
                {groups.map((group) => {
                  const selected = view.filters.groups.includes(group);
                  return <TouchableOpacity key={group} onPress={() => onViewChange(updateFilters(view, "groups", selected ? view.filters.groups.filter((value) => value !== group) : [...view.filters.groups, group]))}
                    style={[S.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "18" : colors.surface }]}>
                    <Text style={{ color: selected ? colors.primary : colors.foreground }}>{group.replace(/ \(.*\)/, "")}</Text>
                  </TouchableOpacity>;
                })}
              </View>
            </>
          )}
          <Text style={[S.label, { color: colors.muted }]}>排序</Text>
          <View style={S.row}>
            <TouchableOpacity onPress={() => selectSort("asc")}
              style={[S.choice, { borderColor: isSorted && view.sort?.direction === "asc" ? colors.primary : colors.border, backgroundColor: isSorted && view.sort?.direction === "asc" ? colors.primary + "18" : colors.surface }]}>
              <Text style={{ color: colors.foreground }}>升序 ↑</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => selectSort("desc")}
              style={[S.choice, { borderColor: isSorted && view.sort?.direction === "desc" ? colors.primary : colors.border, backgroundColor: isSorted && view.sort?.direction === "desc" ? colors.primary + "18" : colors.surface }]}>
              <Text style={{ color: colors.foreground }}>降序 ↓</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={clearColumn} style={[S.clear, { borderColor: colors.border }]}>
            <Text style={{ color: colors.muted }}>清除此列调整</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: { marginTop: "auto", maxHeight: "78%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14 },
  title: { fontSize: 17, fontWeight: "800" },
  body: { gap: 10, paddingBottom: 8 },
  label: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  choice: { minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, paddingHorizontal: 10 },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 14 },
  halfInput: { flex: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 38, justifyContent: "center", borderRadius: 19, borderWidth: 1, paddingHorizontal: 12 },
  nameFilterHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  unmatched: { minHeight: 40, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, justifyContent: "center" },
  nameOptions: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: "hidden" },
  nameOption: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  clear: { minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1, marginTop: 4 },
});
