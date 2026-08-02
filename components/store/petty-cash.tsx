/**
 * 备用金记录（A1-N5 分类）
 */
import React, { useMemo, useState, useCallback } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { usePettyCashStore, PETTY_CODE_LABELS, PETTY_GROUPS, PettyCode } from "@/lib/store/petty-store";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { importIcostExcel } from "@/lib/store/icost-import";

export default function StorePettyCashScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { records, addRecord, deleteRecord } = usePettyCashStore();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addCode, setAddCode] = useState<PettyCode>("A1");
  const [addAmount, setAddAmount] = useState("");
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10));
  const [addDesc, setAddDesc] = useState("");
  const [addPayment, setAddPayment] = useState("微信");
  const [importing, setImporting] = useState(false);

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const handleImportExcel = useCallback(async () => {
    tap();
    setImporting(true);
    try {
      const result = await importIcostExcel();
      if (!result) { setImporting(false); return; }
      if (result.records.length === 0) {
        Alert.alert("导入结果", `未找到可导入的记录。\n跳过 ${result.skipped} 行（无法识别分类）。`);
        setImporting(false);
        return;
      }
      for (const rec of result.records) { addRecord(rec); }
      const msg = `成功导入 ${result.imported} 条记录${result.skipped > 0 ? `\n跳过 ${result.skipped} 行（分类未匹配）` : ""}`;
      Alert.alert("导入成功 ✓", msg);
    } catch (e: unknown) {
      Alert.alert("导入失败", e instanceof Error ? e.message : "请重试");
    } finally {
      setImporting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRecord]);

  const filtered = useMemo(() => {
    if (!selectedGroup) return records;
    const group = PETTY_GROUPS.find((g) => g.label === selectedGroup);
    if (!group) return records;
    return records.filter((r) => group.codes.includes(r.code));
  }, [records, selectedGroup]);

  const totalAmount = useMemo(() => filtered.reduce((s, r) => s + r.amount, 0), [filtered]);

  const handleAdd = () => {
    if (!addAmount || isNaN(parseFloat(addAmount))) { Alert.alert("请输入金额"); return; }
    addRecord({ date: addDate, code: addCode, amount: parseFloat(addAmount), description: addDesc, paymentMethod: addPayment, receiptUri: "" });
    setAddAmount(""); setAddDesc(""); setShowAdd(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* 分组筛选 */}
      <View style={{ backgroundColor: colors.background }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
          <Pressable onPress={() => { tap(); setSelectedGroup(null); }}
            style={[styles.groupChip, { backgroundColor: !selectedGroup ? colors.primary : colors.surface, borderColor: !selectedGroup ? colors.primary : colors.border }]}>
            <Text style={{ color: !selectedGroup ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>全部</Text>
          </Pressable>
          {PETTY_GROUPS.map((g) => (
            <Pressable key={g.label} onPress={() => { tap(); setSelectedGroup(g.label === selectedGroup ? null : g.label); }}
              style={[styles.groupChip, { backgroundColor: selectedGroup === g.label ? colors.primary : colors.surface, borderColor: selectedGroup === g.label ? colors.primary : colors.border }]}>
              <Text style={{ color: selectedGroup === g.label ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>{g.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {/* 合计 + 操作按钮 */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={[styles.totalText, { color: colors.muted }]}>合计：</Text>
          <Text style={[styles.totalAmount, { color: colors.error }]}>¥{totalAmount.toFixed(2)}</Text>
          <View style={{ flex: 1 }} />
          {/* 导入 Excel 按钮 */}
          <Pressable
            onPress={handleImportExcel}
            disabled={importing}
            style={[styles.importBtn, { backgroundColor: colors.surface, borderColor: colors.border, marginRight: 8 }]}
          >
            {importing
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <IconSymbol name="arrow.down.doc.fill" size={15} color={colors.primary} />
            }
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600", marginLeft: 4 }}>
              {importing ? "导入中…" : "导入 Excel"}
            </Text>
          </Pressable>
          <Pressable onPress={() => { tap(); setShowAdd(true); }} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
            <IconSymbol name="plus" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() => Alert.alert("删除", `确认删除此记录？`, [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => deleteRecord(item.id) }])}
            style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={[styles.codeBadge, { backgroundColor: colors.primary + "22" }]}>
                  <Text style={[styles.codeText, { color: colors.primary }]}>{item.code}</Text>
                </View>
                <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>
                  {PETTY_CODE_LABELS[item.code].replace(/^[A-Z0-9]+ /, "")}
                </Text>
              </View>
              <Text style={[styles.cardSub, { color: colors.muted }]} numberOfLines={1}>
                {[item.date, item.paymentMethod, item.description].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Text style={[styles.cardAmount, { color: colors.error }]}>¥{item.amount.toFixed(2)}</Text>
          </Pressable>
        )}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>暂无记录</Text>
            <Text style={[styles.emptyDesc, { color: colors.muted }]}>点击「导入 Excel」导入 iCost 账单，或点击 + 手动添加</Text>
          </View>
        }
      />

      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowAdd(false)}><Text style={[styles.sheetCancel, { color: colors.primary }]}>取消</Text></Pressable>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>添加备用金记录</Text>
            <Pressable onPress={handleAdd}><Text style={[styles.sheetDone, { color: colors.primary }]}>添加</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>分类代码</Text>
              <ScrollView style={{ maxHeight: 200 }}>
                {PETTY_GROUPS.map((group) => (
                  <View key={group.label}>
                    <Text style={[styles.groupTitle, { color: colors.muted }]}>{group.label}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                      {group.codes.map((code) => (
                        <Pressable key={code} onPress={() => setAddCode(code)}
                          style={[styles.codeChip, { borderColor: addCode === code ? colors.primary : colors.border, backgroundColor: addCode === code ? colors.primary + "22" : colors.surface }]}>
                          <Text style={{ color: addCode === code ? colors.primary : colors.muted, fontSize: 12, fontWeight: "600" }}>{code}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Text style={[styles.selectedCode, { color: colors.foreground }]}>已选：{PETTY_CODE_LABELS[addCode]}</Text>
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
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>支付方式</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {["现金", "微信", "支付宝", "银行卡"].map((m) => (
                  <Pressable key={m} onPress={() => setAddPayment(m)}
                    style={[styles.payBtn, { borderColor: addPayment === m ? colors.primary : colors.border, backgroundColor: addPayment === m ? colors.primary + "22" : colors.surface }]}>
                    <Text style={{ color: addPayment === m ? colors.primary : colors.muted, fontSize: 13, fontWeight: "600" }}>{m}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <View>
              <Text style={[styles.fieldLabel, { color: colors.muted }]}>描述</Text>
              <TextInput value={addDesc} onChangeText={setAddDesc} placeholder="可选" placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]} returnKeyType="done" />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  groupChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  totalText: { fontSize: 14 },
  totalAmount: { fontSize: 16, fontWeight: "700" },
  importBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  addBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  codeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  codeText: { fontSize: 12, fontWeight: "700" },
  cardName: { fontSize: 15, fontWeight: "600", lineHeight: 21, flex: 1 },
  cardSub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  cardAmount: { fontSize: 16, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingTop: 80 },
  emptyTitle: { fontSize: 17, fontWeight: "600" },
  emptyDesc: { fontSize: 14, textAlign: "center" },
  sheet: { flex: 1 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { fontSize: 17, fontWeight: "600" },
  sheetCancel: { fontSize: 17 },
  sheetDone: { fontSize: 17, fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  groupTitle: { fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 4 },
  codeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  selectedCode: { fontSize: 14, fontWeight: "500", marginTop: 8 },
  payBtn: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
