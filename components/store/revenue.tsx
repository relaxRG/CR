/**
 * 营业状况（营收 + 各项成本 + 人工）
 */
import React, { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useRevenueStore, RevenueCategory, REVENUE_CATEGORY_LABELS } from "@/lib/store/revenue-store";
import { IconSymbol } from "@/components/ui/icon-symbol";

type Period = "day" | "week" | "month" | "year";
const PERIODS: { key: Period; label: string }[] = [
  { key: "day", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "year", label: "今年" },
];

function getDateRange(period: Period): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  if (period === "day") { start.setHours(0, 0, 0, 0); }
  else if (period === "week") { start.setDate(now.getDate() - now.getDay()); start.setHours(0, 0, 0, 0); }
  else if (period === "month") { start.setDate(1); start.setHours(0, 0, 0, 0); }
  else { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); }
  return { start, end: now };
}

const CATEGORY_COLORS: Record<RevenueCategory, string> = {
  revenue: "#34C759", food_cost: "#FF9500", spirit_cost: "#AF52DE",
  wine_cost: "#FF2D55", labor_cost: "#007AFF", rent: "#FF6B35",
  utilities: "#5AC8FA", petty_cash: "#FF9F0A", operations: "#8E8E93",
};

export default function StoreRevenueScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { records, staff, addRecord, deleteRecord, addStaff, deleteStaff } = useRevenueStore();
  const [period, setPeriod] = React.useState<Period>("month");
  const [showAdd, setShowAdd] = useState(false);
  const [showStaff, setShowStaff] = useState(false);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { start, end } = useMemo(() => getDateRange(period), [period]);

  const filtered = useMemo(() =>
    records.filter((r) => { const d = new Date(r.date); return d >= start && d <= end; }),
    [records, start, end]
  );

  const summary = useMemo(() => {
    const map: Partial<Record<RevenueCategory, number>> = {};
    filtered.forEach((r) => { map[r.category] = (map[r.category] ?? 0) + r.amount; });
    return map;
  }, [filtered]);

  const totalRevenue = summary.revenue ?? 0;
  const totalCost = Object.entries(summary)
    .filter(([k]) => k !== "revenue")
    .reduce((s, [, v]) => s + (v ?? 0), 0);
  const profit = totalRevenue - totalCost;

  // Add record form state
  const [addCat, setAddCat] = useState<RevenueCategory>("revenue");
  const [addAmount, setAddAmount] = useState("");
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [addNotes, setAddNotes] = useState("");

  const handleAddRecord = () => {
    if (!addAmount || isNaN(parseFloat(addAmount))) { Alert.alert("请输入金额"); return; }
    addRecord({ date: addDate, category: addCat, amount: parseFloat(addAmount), notes: addNotes });
    setAddAmount(""); setAddNotes(""); setShowAdd(false);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
      {/* 时间段选择 */}
      <View style={[styles.subHeader, { backgroundColor: colors.background }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={[styles.segContainer, { backgroundColor: colors.border + "55", flex: 1 }]}>
            {PERIODS.map((p) => {
              const active = period === p.key;
              return (
                <Pressable key={p.key} onPress={() => { tap(); setPeriod(p.key); }}
                  style={[styles.segItem, active && { backgroundColor: colors.background, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 }]}>
                  <Text style={[styles.segText, { color: active ? colors.foreground : colors.muted, fontWeight: active ? "600" : "400" }]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => { tap(); setShowAdd(true); }} style={[styles.addBtn, { backgroundColor: colors.primary, marginLeft: 10 }]}>
            <IconSymbol name="plus" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* 汇总卡片 */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.muted }]}>营收</Text>
              <Text style={[styles.summaryValue, { color: colors.success }]}>¥{totalRevenue.toFixed(0)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.muted }]}>支出</Text>
              <Text style={[styles.summaryValue, { color: colors.error }]}>¥{totalCost.toFixed(0)}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: colors.muted }]}>利润</Text>
              <Text style={[styles.summaryValue, { color: profit >= 0 ? colors.success : colors.error }]}>¥{profit.toFixed(0)}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* 分类汇总 */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <Text style={[styles.sectionTitle, { color: colors.muted }]}>分类汇总</Text>
        <View style={[styles.catCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {(Object.entries(REVENUE_CATEGORY_LABELS) as [RevenueCategory, string][]).map(([key, label], i, arr) => {
            const val = summary[key] ?? 0;
            if (val === 0) return null;
            return (
              <React.Fragment key={key}>
                <View style={styles.catRow}>
                  <View style={[styles.catDot, { backgroundColor: CATEGORY_COLORS[key] }]} />
                  <Text style={[styles.catLabel, { color: colors.foreground }]}>{label}</Text>
                  <Text style={[styles.catValue, { color: key === "revenue" ? colors.success : colors.error }]}>
                    {key === "revenue" ? "+" : "-"}¥{Math.abs(val).toFixed(0)}
                  </Text>
                </View>
                {i < arr.length - 1 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 28 }} />}
              </React.Fragment>
            );
          })}
          {Object.values(summary).every((v) => !v) && (
            <Text style={[styles.emptyText, { color: colors.muted }]}>暂无数据，点击右上角 + 添加记录</Text>
          )}
        </View>
      </View>

      {/* 人工成本入口 */}
      <View style={{ paddingHorizontal: 16 }}>
        <Pressable onPress={() => { tap(); setShowStaff(true); }}
          style={[styles.staffBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="person.2.fill" size={20} color={colors.primary} />
          <Text style={[styles.staffBtnText, { color: colors.foreground }]}>人工成本明细</Text>
          <IconSymbol name="chevron.right" size={16} color={colors.muted} />
        </Pressable>
      </View>

      {/* 添加记录 Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={() => setShowAdd(false)}><Text style={[styles.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>添加记录</Text>
            <Pressable onPress={handleAddRecord}><Text style={[styles.sheetDone, { color: colors.primary }]}>添加</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>分类</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {(Object.entries(REVENUE_CATEGORY_LABELS) as [RevenueCategory, string][]).map(([key, label]) => (
                  <Pressable key={key} onPress={() => setAddCat(key)}
                    style={[styles.catChip, { borderColor: addCat === key ? colors.primary : colors.border, backgroundColor: addCat === key ? colors.primary + "22" : colors.surface }]}>
                    <Text style={{ color: addCat === key ? colors.primary : colors.muted, fontWeight: "600", fontSize: 13 }}>{label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>金额（元）*</Text>
              <TextInput value={addAmount} onChangeText={setAddAmount} placeholder="0.00" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                keyboardType="decimal-pad" returnKeyType="next" />
            </View>
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>日期</Text>
              <TextInput value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="next" />
            </View>
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>备注</Text>
              <TextInput value={addNotes} onChangeText={setAddNotes} placeholder="可选" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="done" />
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* 人工成本 Modal */}
      <Modal visible={showStaff} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowStaff(false)}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={() => setShowStaff(false)}><Text style={[styles.sheetCancel, { color: colors.primary }]}>关闭</Text></Pressable>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>人工成本</Text>
            <Pressable onPress={() => {
              Alert.prompt("添加员工", "请输入员工姓名", (name) => {
                if (name?.trim()) {
                  addStaff({ name: name.trim(), month: new Date().toISOString().slice(0, 7), workDays: 0, workHours: 0, salary: 0, notes: "" });
                }
              });
            }}><Text style={[styles.sheetDone, { color: colors.primary }]}>添加</Text></Pressable>
          </View>
          <FlatList
            data={staff}
            keyExtractor={(s) => s.id}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            renderItem={({ item }) => (
              <View style={[styles.staffCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={[styles.cardSub, { color: colors.muted }]}>
                    {item.month} · {item.workDays}天 · {item.workHours}小时 · ¥{item.salary}
                  </Text>
                </View>
                <Pressable onPress={() => Alert.alert("删除", `确认删除「${item.name}」？`, [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => deleteStaff(item.id) }])}>
                  <IconSymbol name="trash" size={16} color={colors.error} />
                </Pressable>
              </View>
            )}
            ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.muted, textAlign: "center", paddingTop: 40 }]}>暂无员工记录</Text>}
          />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  subHeader: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  segContainer: { flexDirection: "row", borderRadius: 10, padding: 2, gap: 2 },
  segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  segText: { fontSize: 14, lineHeight: 19 },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  summaryCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  summaryRow: { flexDirection: "row", justifyContent: "space-around" },
  summaryItem: { alignItems: "center", gap: 4 },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 22, fontWeight: "700" },
  sectionTitle: { fontSize: 13, fontWeight: "500", marginBottom: 8, marginLeft: 4 },
  catCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  catRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  catDot: { width: 10, height: 10, borderRadius: 5 },
  catLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  catValue: { fontSize: 15, fontWeight: "600" },
  emptyText: { padding: 16, fontSize: 14 },
  staffBtn: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  staffBtnText: { flex: 1, fontSize: 16, fontWeight: "500" },
  staffCard: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  cardName: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  cardSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  catChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});

