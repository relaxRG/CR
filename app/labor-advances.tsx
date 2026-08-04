/**
 * 薪资预支管理页
 * - 查看所有预支记录（按员工/月份）
 * - 新增预支记录
 * - 标记已还款/取消
 * - 在薪资单中自动扣除
 */
import React, { useMemo, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore } from "@/lib/labor/store";
import { useSalaryAdvanceStore, SalaryAdvance, AdvanceStatus } from "@/lib/labor/advance-store";
import { EMPLOYEE_TYPE_LABELS, EMPLOYEE_TYPE_COLORS, DEPT_COLORS, monthLabel } from "@/lib/labor/types";

const STATUS_LABELS: Record<AdvanceStatus, string> = {
  pending: "待扣除",
  deducted: "已扣除",
  cancelled: "已取消",
};

const STATUS_COLORS: Record<AdvanceStatus, string> = {
  pending: "#FF9500",
  deducted: "#34C759",
  cancelled: "#8E8E93",
};

// ─── 新增预支 Modal ───────────────────────────────────────────────────────────
function AddAdvanceModal({
  visible, colors, onSave, onClose
}: {
  visible: boolean;
  colors: any;
  onSave: (data: Omit<SalaryAdvance, "id" | "createdAt" | "updatedAt">) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { employees } = useEmployeeStore();
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextMonth = now.getMonth() === 11
    ? `${now.getFullYear() + 1}-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, "0")}`;

  const [selectedEmpId, setSelectedEmpId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(now.toISOString().slice(0, 10));
  const [deductMonth, setDeductMonth] = useState(nextMonth);
  const [notes, setNotes] = useState("");
  const [paidViaPetty, setPaidViaPetty] = useState(false);

  // 只显示长期兼职员工
  const eligibleEmployees = useMemo(() =>
    employees.filter((e) => e.active && (e.type === "longterm_parttime" || e.type === "fulltime")),
    [employees]
  );

  const handleSave = () => {
    if (!selectedEmpId) { Alert.alert("请选择员工"); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { Alert.alert("请填写正确的预支金额"); return; }
    onSave({
      employeeId: selectedEmpId,
      date,
      amount: Number(amount),
      deductMonth,
      status: "pending",
      notes,
      paidViaPetty,
    });
    setSelectedEmpId(""); setAmount(""); setNotes(""); setPaidViaPetty(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[AM.sheet, { backgroundColor: colors.background }]}>
          <View style={[AM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={[AM.title, { color: colors.foreground }]}>新增薪资预支</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: "#5856D6" }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* 员工选择 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>选择员工</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {eligibleEmployees.map((emp) => {
                  const typeColor = EMPLOYEE_TYPE_COLORS[emp.type];
                  const selected = selectedEmpId === emp.id;
                  return (
                    <TouchableOpacity key={emp.id} onPress={() => { tap(); setSelectedEmpId(emp.id); }}
                      style={[AM.empChip, {
                        backgroundColor: selected ? typeColor : colors.surface,
                        borderColor: selected ? typeColor : colors.border,
                      }]}>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: selected ? "#fff" : typeColor }}>
                        {emp.code}
                      </Text>
                      <Text style={{ fontSize: 11, color: selected ? "#fff99" : colors.muted }}>
                        {emp.realName} · {EMPLOYEE_TYPE_LABELS[emp.type]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {eligibleEmployees.length === 0 && (
                  <Text style={{ fontSize: 13, color: colors.muted }}>暂无长期兼职或全职员工</Text>
                )}
              </View>
            </View>

            {/* 预支信息 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>预支信息</Text>
              <View style={AM.formRow}>
                <Text style={[AM.label, { color: colors.foreground }]}>预支金额 *</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 16, color: colors.muted }}>¥</Text>
                  <TextInput value={amount} onChangeText={setAmount}
                    placeholder="0.00" placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={[AM.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                </View>
              </View>
              <View style={AM.formRow}>
                <Text style={[AM.label, { color: colors.foreground }]}>预支日期</Text>
                <TextInput value={date} onChangeText={setDate}
                  placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted}
                  style={[AM.input, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
              <View style={AM.formRow}>
                <Text style={[AM.label, { color: colors.foreground }]}>计划扣除月份</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[currentMonth, nextMonth].map((m) => (
                    <TouchableOpacity key={m} onPress={() => { tap(); setDeductMonth(m); }}
                      style={[AM.monthChip, {
                        backgroundColor: deductMonth === m ? "#5856D6" : colors.surface,
                        borderColor: deductMonth === m ? "#5856D6" : colors.border,
                      }]}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: deductMonth === m ? "#fff" : colors.muted }}>
                        {monthLabel(m)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TextInput value={deductMonth} onChangeText={setDeductMonth}
                    placeholder="YYYY-MM" placeholderTextColor={colors.muted}
                    style={[AM.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                </View>
              </View>
            </View>

            {/* 支付方式 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>支付方式</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[
                  { v: false, label: "直接支付" },
                  { v: true, label: "备用金支付（K1）" },
                ].map((opt) => (
                  <TouchableOpacity key={String(opt.v)} onPress={() => { tap(); setPaidViaPetty(opt.v); }}
                    style={[AM.empChip, {
                      backgroundColor: paidViaPetty === opt.v ? "#5856D6" : colors.surface,
                      borderColor: paidViaPetty === opt.v ? "#5856D6" : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, color: paidViaPetty === opt.v ? "#fff" : colors.muted }}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {paidViaPetty && (
                <View style={[AM.infoBox, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "33" }]}>
                  <Text style={{ fontSize: 12, color: colors.warning }}>
                    请在备用金中同时录入 K1（固定兼职）支出，金额与预支金额一致。
                  </Text>
                </View>
              )}
            </View>

            {/* 备注 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>备注</Text>
              <TextInput value={notes} onChangeText={setNotes}
                placeholder="预支原因、说明等（可选）"
                placeholderTextColor={colors.muted} multiline numberOfLines={3}
                style={[AM.textarea, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function LaborAdvancesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { employees } = useEmployeeStore();
  const { advances, addAdvance, updateAdvance, deleteAdvance } = useSalaryAdvanceStore();

  const [showAdd, setShowAdd] = useState(false);
  const [filterEmpId, setFilterEmpId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<AdvanceStatus | "all">("all");

  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const filtered = useMemo(() => {
    return advances.filter((a) => {
      if (filterEmpId !== "all" && a.employeeId !== filterEmpId) return false;
      if (filterStatus !== "all" && a.status !== filterStatus) return false;
      return true;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [advances, filterEmpId, filterStatus]);

  const totalPending = useMemo(() =>
    advances.filter((a) => a.status === "pending").reduce((s, a) => s + a.amount, 0),
    [advances]
  );

  const handleStatusChange = (advance: SalaryAdvance, newStatus: AdvanceStatus) => {
    Alert.alert(
      `标记为「${STATUS_LABELS[newStatus]}」`,
      `确认将 ${empMap.get(advance.employeeId)?.code ?? "员工"} ¥${advance.amount} 的预支标记为${STATUS_LABELS[newStatus]}？`,
      [
        { text: "取消", style: "cancel" },
        { text: "确认", onPress: () => updateAdvance(advance.id, { status: newStatus }) },
      ]
    );
  };

  const handleDelete = (advance: SalaryAdvance) => {
    Alert.alert("删除预支记录", "确认删除此预支记录？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => deleteAdvance(advance.id) },
    ]);
  };

  // 有长期兼职或全职员工
  const eligibleEmployees = useMemo(() =>
    employees.filter((e) => e.active && (e.type === "longterm_parttime" || e.type === "fulltime")),
    [employees]
  );

  return (
    <ScreenContainer>
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>薪资预支管理</Text>
        <Pressable onPress={() => { tap(); setShowAdd(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color="#5856D6" />
        </Pressable>
      </View>

      {/* 汇总卡片 */}
      <View style={[S.summaryCard, { backgroundColor: "#5856D6" + "0a", borderColor: "#5856D6" + "22" }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>待扣除预支总额</Text>
          <Text style={{ fontSize: 22, fontWeight: "800", color: "#5856D6" }}>
            ¥{totalPending.toFixed(0)}
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>预支记录总数</Text>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>{advances.length}条</Text>
        </View>
      </View>

      {/* 说明 */}
      <View style={[S.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
          <Text style={{ fontWeight: "700", color: "#5856D6" }}>长期兼职</Text>：有固定排班和月度薪资，支持薪资预支。预支金额在指定月份薪资结算时自动扣除。{"\n"}
          <Text style={{ fontWeight: "700", color: colors.warning }}>临时兼职</Text>：按次/按小时结算，无预支功能，直接在薪资单中录入实际工时。
        </Text>
      </View>

      {/* 筛选 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        <TouchableOpacity onPress={() => { tap(); setFilterEmpId("all"); }}
          style={[S.filterChip, { backgroundColor: filterEmpId === "all" ? "#5856D6" : colors.surface, borderColor: filterEmpId === "all" ? "#5856D6" : colors.border }]}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: filterEmpId === "all" ? "#fff" : colors.muted }}>全部员工</Text>
        </TouchableOpacity>
        {eligibleEmployees.map((emp) => (
          <TouchableOpacity key={emp.id} onPress={() => { tap(); setFilterEmpId(emp.id); }}
            style={[S.filterChip, {
              backgroundColor: filterEmpId === emp.id ? EMPLOYEE_TYPE_COLORS[emp.type] : colors.surface,
              borderColor: filterEmpId === emp.id ? EMPLOYEE_TYPE_COLORS[emp.type] : colors.border,
            }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: filterEmpId === emp.id ? "#fff" : colors.muted }}>
              {emp.code}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 4 }} />
        {(["all", "pending", "deducted", "cancelled"] as const).map((s) => (
          <TouchableOpacity key={s} onPress={() => { tap(); setFilterStatus(s); }}
            style={[S.filterChip, {
              backgroundColor: filterStatus === s ? (s === "all" ? colors.primary : STATUS_COLORS[s]) : colors.surface,
              borderColor: filterStatus === s ? (s === "all" ? colors.primary : STATUS_COLORS[s]) : colors.border,
            }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: filterStatus === s ? "#fff" : colors.muted }}>
              {s === "all" ? "全部状态" : STATUS_LABELS[s]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {filtered.map((advance) => {
          const emp = empMap.get(advance.employeeId);
          const typeColor = emp ? EMPLOYEE_TYPE_COLORS[emp.type] : "#8E8E93";
          const statusColor = STATUS_COLORS[advance.status];
          return (
            <View key={advance.id} style={[S.advanceCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                {/* 员工头像 */}
                <View style={[S.empAvatar, { backgroundColor: typeColor + "22" }]}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: typeColor }}>
                    {emp?.code.slice(0, 2) ?? "?"}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                      {emp?.code ?? "未知"} · {emp?.realName ?? ""}
                    </Text>
                    <View style={[S.statusTag, { backgroundColor: statusColor + "22" }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: statusColor }}>
                        {STATUS_LABELS[advance.status]}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    预支日期：{advance.date} · 扣除月份：{advance.deductMonth ? monthLabel(advance.deductMonth) : "待定"}
                  </Text>
                  {advance.notes ? (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={2}>
                      {advance.notes}
                    </Text>
                  ) : null}
                  {advance.paidViaPetty && (
                    <Text style={{ fontSize: 11, color: colors.warning, marginTop: 2 }}>
                      通过备用金 K1 支付
                    </Text>
                  )}
                </View>
                <Text style={{ fontSize: 18, fontWeight: "800", color: advance.status === "pending" ? "#5856D6" : colors.muted }}>
                  ¥{advance.amount.toFixed(0)}
                </Text>
              </View>

              {/* 操作按钮 */}
              {advance.status === "pending" && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity onPress={() => handleStatusChange(advance, "deducted")}
                    style={[S.actionBtn, { backgroundColor: colors.success + "15", borderColor: colors.success + "33" }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.success }}>标记已扣除</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleStatusChange(advance, "cancelled")}
                    style={[S.actionBtn, { backgroundColor: colors.muted + "15", borderColor: colors.border }]}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>取消（已还款）</Text>
                  </TouchableOpacity>
                  <Pressable onPress={() => handleDelete(advance)} style={{ padding: 6 }}>
                    <IconSymbol name="trash" size={14} color={colors.error} />
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}

        {filtered.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <IconSymbol name="banknote.fill" size={48} color={colors.border} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>暂无预支记录</Text>
            <Pressable onPress={() => { tap(); setShowAdd(true); }}
              style={[S.addBtn, { backgroundColor: "#5856D6" }]}>
              <IconSymbol name="plus" size={16} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>新增预支</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <AddAdvanceModal
        visible={showAdd}
        colors={colors}
        onSave={addAdvance}
        onClose={() => setShowAdd(false)}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  summaryCard: { flexDirection: "row", alignItems: "center", margin: 16, marginBottom: 8, borderRadius: 12, borderWidth: 1, padding: 14 },
  infoCard: { marginHorizontal: 16, marginBottom: 8, borderRadius: 10, borderWidth: 1, padding: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  advanceCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10 },
  empAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  statusTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  actionBtn: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 16 },
});

const AM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  formRow: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: "500", marginBottom: 4 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  inputSmall: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, width: 90, textAlign: "center" },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 70 },
  empChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  monthChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  infoBox: { borderRadius: 8, borderWidth: 1, padding: 10, marginTop: 8 },
});
