import React, { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LedgerNameOption, LedgerSortKey, LedgerTableView } from "@/lib/spirits/ledger-table-view";

type NameLanguage = "zh" | "en";
type NumericLedgerSortKey = Exclude<LedgerSortKey, "name" | "group">;

type Props = {
  visible: boolean;
  column: LedgerSortKey | null;
  colors: { background: string; surface: string; foreground: string; muted: string; border: string; primary: string };
  groups: string[];
  nameOptions: LedgerNameOption[];
  nameLanguage: NameLanguage;
  onNameLanguageChange: (language: NameLanguage) => void;
  view: LedgerTableView;
  onViewChange: (view: LedgerTableView) => void;
  onClose: () => void;
};

const TITLES: Record<LedgerSortKey, string> = {
  name: "商品名称", referencePrice: "参考价", openingQty: "期初库存量", openingUnitCost: "期初单价", openingCost: "期初成本",
  purchaseQty: "进货数量", purchaseCost: "进货成本", closingQty: "期末库存量", closingUnitCost: "期末单位成本",
  closingCost: "期末成本", consumeQty: "消耗瓶数", consumeCost: "消耗成本", group: "集团",
};

const NUMERIC_COLUMNS = new Set<LedgerSortKey>([
  "referencePrice", "openingQty", "openingUnitCost", "openingCost", "purchaseQty", "purchaseCost", "closingQty", "closingUnitCost", "closingCost", "consumeQty", "consumeCost",
]);

export function LedgerColumnMenu({ visible, column, colors, groups, nameOptions, nameLanguage, onNameLanguageChange, view, onViewChange, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const query = view.filters.nameQuery.trim().toLocaleLowerCase();
  const visibleNames = useMemo(() => column === "name" ? nameOptions.filter((option) => !query || option.searchableName.toLocaleLowerCase().includes(query)) : [], [column, nameOptions, query]);
  if (!column) return null;

  const update = (next: LedgerTableView) => onViewChange(next);
  const selectedKeys = view.filters.nameKeys;
  const allVisibleSelected = visibleNames.length > 0 && visibleNames.every((option) => selectedKeys.includes(option.key));
  const numericColumn = NUMERIC_COLUMNS.has(column) ? column as NumericLedgerSortKey : null;
  const numericRange = numericColumn ? view.filters.ranges[numericColumn] : undefined;
  const setRange = (part: "min" | "max", value: string) => {
    if (!numericColumn) return;
    update({
      ...view,
      filters: { ...view.filters, ranges: { ...view.filters.ranges, [numericColumn]: { min: numericRange?.min ?? "", max: numericRange?.max ?? "", [part]: value } } },
    });
  };
  const clearColumn = () => {
    const filters = { ...view.filters, ranges: { ...view.filters.ranges } };
    if (column === "name") { filters.nameQuery = ""; filters.nameKeys = []; }
    else if (column === "group") { filters.groups = []; filters.onlyUnassignedGroup = false; }
    else delete filters.ranges[column];
    update({ sort: view.sort?.key === column ? null : view.sort, filters });
  };
  const selectSort = (direction: "asc" | "desc") => update({ ...view, sort: { key: column, direction } });
  const toggleName = (key: string) => update({ ...view, filters: { ...view.filters, nameKeys: selectedKeys.includes(key) ? selectedKeys.filter((value) => value !== key) : [...selectedKeys, key] } });
  const toggleAllVisibleNames = () => update({ ...view, filters: { ...view.filters, nameKeys: allVisibleSelected ? selectedKeys.filter((key) => !visibleNames.some((option) => option.key === key)) : [...new Set([...selectedKeys, ...visibleNames.map((option) => option.key)])] } });

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={S.backdrop} onPress={onClose} />
    <View style={[S.sheet, { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={[S.handle, { backgroundColor: colors.border }]} />
      <View style={S.header}><Text style={[S.title, { color: colors.foreground }]}>{TITLES[column]}调整</Text><TouchableOpacity onPress={onClose} hitSlop={10}><Text style={{ color: colors.primary, fontWeight: "800" }}>完成</Text></TouchableOpacity></View>
      <ScrollView contentContainerStyle={S.body} keyboardShouldPersistTaps="handled">
        {column === "name" && <>
          <Text style={[S.label, { color: colors.muted }]}>显示语言</Text>
          <View style={S.row}>{(["zh", "en"] as const).map((language) => <TouchableOpacity key={language} onPress={() => onNameLanguageChange(language)} style={[S.choice, { borderColor: nameLanguage === language ? colors.primary : colors.border, backgroundColor: nameLanguage === language ? colors.primary + "18" : colors.surface }]}><Text style={{ color: nameLanguage === language ? colors.primary : colors.foreground, fontWeight: "700" }}>{language === "zh" ? "显示中文" : "显示英文"}</Text></TouchableOpacity>)}</View>
          <Text style={[S.label, { color: colors.muted }]}>名称筛选</Text>
          <TextInput value={view.filters.nameQuery} onChangeText={(nameQuery) => update({ ...view, filters: { ...view.filters, nameQuery } })} placeholder="搜索商品名称" placeholderTextColor={colors.muted} style={[S.input, { borderColor: colors.border, color: colors.foreground }]} />
          <View style={S.selectHeader}><TouchableOpacity onPress={toggleAllVisibleNames}><Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>{allVisibleSelected ? "取消全选当前结果" : "全选当前结果"}</Text></TouchableOpacity><Text style={{ color: colors.muted, fontSize: 12 }}>已选 {selectedKeys.length} / {nameOptions.length}</Text></View>
          <View style={[S.optionBox, { borderColor: colors.border }]}>{visibleNames.map((option) => <TouchableOpacity key={option.key} onPress={() => toggleName(option.key)} style={S.option}><Text style={{ color: selectedKeys.includes(option.key) ? colors.primary : colors.muted, fontSize: 16 }}>{selectedKeys.includes(option.key) ? "☑" : "□"}</Text><Text style={{ flex: 1, color: colors.foreground, fontSize: 13 }} numberOfLines={1}>{option.label}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>{option.count}款</Text></TouchableOpacity>)}</View>
        </>}
        {numericColumn && <><Text style={[S.label, { color: colors.muted }]}>范围筛选</Text><View style={S.row}><TextInput value={numericRange?.min ?? ""} onChangeText={(value) => setRange("min", value)} keyboardType="decimal-pad" placeholder="最小值" placeholderTextColor={colors.muted} style={[S.input, S.half, { borderColor: colors.border, color: colors.foreground }]} /><Text style={{ color: colors.muted }}>至</Text><TextInput value={numericRange?.max ?? ""} onChangeText={(value) => setRange("max", value)} keyboardType="decimal-pad" placeholder="最大值" placeholderTextColor={colors.muted} style={[S.input, S.half, { borderColor: colors.border, color: colors.foreground }]} /></View></>}
        {column === "group" && <><Text style={[S.label, { color: colors.muted }]}>集团筛选</Text><View style={S.chips}>{groups.map((group) => { const selected = view.filters.groups.includes(group); return <TouchableOpacity key={group} onPress={() => update({ ...view, filters: { ...view.filters, groups: selected ? view.filters.groups.filter((value) => value !== group) : [...view.filters.groups, group] } })} style={[S.chip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "18" : colors.surface }]}><Text style={{ color: selected ? colors.primary : colors.foreground }}>{group}</Text></TouchableOpacity>; })}</View></>}
        <Text style={[S.label, { color: colors.muted }]}>排序</Text><View style={S.row}><TouchableOpacity onPress={() => selectSort("asc")} style={[S.choice, { borderColor: view.sort?.key === column && view.sort.direction === "asc" ? colors.primary : colors.border }]}><Text style={{ color: colors.foreground }}>升序 ↑</Text></TouchableOpacity><TouchableOpacity onPress={() => selectSort("desc")} style={[S.choice, { borderColor: view.sort?.key === column && view.sort.direction === "desc" ? colors.primary : colors.border }]}><Text style={{ color: colors.foreground }}>降序 ↓</Text></TouchableOpacity></View>
        <TouchableOpacity onPress={clearColumn} style={[S.clear, { borderColor: colors.border }]}><Text style={{ color: colors.muted }}>清除此列调整</Text></TouchableOpacity>
      </ScrollView>
    </View>
  </Modal>;
}

const S = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.38)" }, sheet: { marginTop: "auto", maxHeight: "82%", borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16 }, handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10 }, header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14 }, title: { fontSize: 17, fontWeight: "800" }, body: { gap: 10, paddingBottom: 8 }, label: { fontSize: 12, fontWeight: "700", marginTop: 4 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, choice: { minHeight: 44, flex: 1, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 }, input: { minHeight: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, fontSize: 14 }, half: { flex: 1 }, selectHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, optionBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: "hidden" }, option: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" }, chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { minHeight: 38, borderWidth: 1, borderRadius: 19, paddingHorizontal: 12, justifyContent: "center" }, clear: { minHeight: 44, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 4 },
});
