/**
 * 统一薪资总览页
 * - 收放式员工薪资卡（2行4列网格摘要）
 * - 考勤区：排班表自动推算（点击跳转考勤概况）
 * - 绩效补贴区：点击跳转绩效补贴页面
 * - 奖惩区：支持负数，可增删改
 * - 其他区：调休余额（加班换休/节假日调休分开显示）+ 本月兑换
 * - 备注、薪资汇总
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, useAttendanceStore, usePaySlipStore,
  useCompOffBalanceEntryStore, useHolidayCompOffStore,
} from "@/lib/labor/store";
import { useSalaryAdvanceStore } from "@/lib/labor/advance-store";
import {
  Employee, MonthlyAttendance, PaySlip, RewardPenaltyItem,
  monthLabel,
} from "@/lib/labor/types";

const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

function calcTenure(joinDate?: string): string {
  if (!joinDate) return "";
  const start = new Date(joinDate);
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (months < 1) return "入职不满1月";
  if (months < 12) return `入职${months}月`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m > 0 ? `入职${y}年${m}月` : `入职${y}年`;
}

export default function LaborAttendancePage() {
  const { employeeId, month } = useLocalSearchParams<{ employeeId: string; month: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { employees } = useEmployeeStore();
  const { getAttendance } = useAttendanceStore();
  const { getPaySlip, upsertPaySlip } = usePaySlipStore();
  const { getEntries: getCompOffEntries } = useCompOffBalanceEntryStore();
  const { getEntries: getHolidayCompOffEntries } = useHolidayCompOffStore();
  const { advances } = useSalaryAdvanceStore();

  const currentMonth = month || new Date().toISOString().slice(0, 7);
  const [expandedId, setExpandedId] = useState<string>(employeeId || "");
  const [editingRewardFor, setEditingRewardFor] = useState<string>("");

  const activeEmployees = useMemo(() => employees.filter((e) => e.active !== false), [employees]);

  return (
    <ScreenContainer>
      <View style={[S.navbar, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{monthLabel(currentMonth)} · 薪资总览</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}>
        {activeEmployees.map((emp) => (
          <EmployeeCard
            key={emp.id}
            employee={emp}
            month={currentMonth}
            expanded={expandedId === emp.id}
            onToggle={() => { tap(); setExpandedId(expandedId === emp.id ? "" : emp.id); }}
            colors={colors}
            getAttendance={getAttendance}
            getPaySlip={getPaySlip}
            upsertPaySlip={upsertPaySlip}
            getCompOffEntries={getCompOffEntries}
            getHolidayCompOffEntries={getHolidayCompOffEntries}
            advances={advances}
            editingReward={editingRewardFor === emp.id}
            onToggleRewardEdit={() => setEditingRewardFor(editingRewardFor === emp.id ? "" : emp.id)}
            router={router}
          />
        ))}
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── 员工卡片 ─────────────────────────────────────────────────────────────────
function EmployeeCard({
  employee, month, expanded, onToggle, colors,
  getAttendance, getPaySlip, upsertPaySlip,
  getCompOffEntries, getHolidayCompOffEntries,
  advances, editingReward, onToggleRewardEdit, router,
}: {
  employee: Employee; month: string; expanded: boolean; onToggle: () => void; colors: any;
  getAttendance: (eid: string, m: string) => MonthlyAttendance | null;
  getPaySlip: (eid: string, m: string) => PaySlip | null;
  upsertPaySlip: (slip: PaySlip) => void;
  getCompOffEntries: (eid: string) => any[];
  getHolidayCompOffEntries: (eid: string) => any[];
  advances: any[]; editingReward: boolean; onToggleRewardEdit: () => void; router: any;
}) {
  const att = getAttendance(employee.id, month);
  const slip = getPaySlip(employee.id, month);
  const tenure = calcTenure(employee.joinDate);

  // ── 调休余额（加班换休 vs 节假日调休分开） ──
  const compOffEntries = getCompOffEntries(employee.id);
  const overtimeCompOff = compOffEntries
    .filter((e: any) => e.status === "available" && e.source === "overtime")
    .reduce((s: number, e: any) => s + (e.days ?? 0), 0);
  const holidayCompOffEntries = getHolidayCompOffEntries(employee.id);
  const holidayCompOff = holidayCompOffEntries
    .filter((e: any) => e.status === "available")
    .reduce((s: number, e: any) => s + (e.days ?? 0), 0);
  const totalCompOff = overtimeCompOff + holidayCompOff;

  // ── 本月调休兑换 ──
  const compOffCashOut = slip?.compOffCashOut ?? 0;

  // ── 预支合计 ──
  const advanceTotal = advances
    .filter((a: any) => a.employeeId === employee.id && (a.status === "pending" || a.status === "deducted"))
    .reduce((sum: number, a: any) => sum + (a.amount || 0), 0);

  const [rewardItems, setRewardItems] = useState<RewardPenaltyItem[]>(slip?.rewardPenaltyItems ?? []);
  const [notes, setNotes] = useState(slip?.notes ?? "");

  const addRewardItem = () => {
    setRewardItems([...rewardItems, { id: Date.now().toString(), name: "", amount: 0, note: "" }]);
  };
  const updateRewardItem = (id: string, field: keyof RewardPenaltyItem, value: any) => {
    setRewardItems(rewardItems.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };
  const removeRewardItem = (id: string) => {
    Alert.alert("删除奖惩", "确定删除此条目？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => setRewardItems(rewardItems.filter((i) => i.id !== id)) },
    ]);
  };
  const saveRewards = useCallback(() => {
    if (!slip) return;
    const totalReward = rewardItems.reduce((sum, item) => sum + item.amount, 0);
    const rewardDiff = totalReward - (slip.rewardPenalty ?? 0);
    const newGross = Math.round((slip.grossSalary + rewardDiff) * 100) / 100;
    const newFinal = Math.round((slip.finalSalary + rewardDiff) * 100) / 100;
    upsertPaySlip({ ...slip, rewardPenalty: totalReward, rewardPenaltyItems: rewardItems, notes,
      grossSalary: newGross, finalSalary: newFinal, updatedAt: new Date().toISOString() });
    onToggleRewardEdit();
  }, [slip, rewardItems, notes, upsertPaySlip, onToggleRewardEdit]);

  // ── 收起状态：2行4列网格摘要 ──
  if (!expanded) {
    const attendanceSalary = att?.attendanceSalary ?? slip?.attendanceSalary ?? 0;
    const performance = (slip?.performanceBonus ?? 0);
    const allowance = (slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0);
    const reward = slip?.rewardPenalty ?? 0;
    const cashOut = slip?.compOffCashOut ?? 0;
    const advance = advanceTotal;
    const gross = slip?.grossSalary ?? 0;
    const final = slip?.finalSalary ?? 0;

    const grid1 = [
      { label: "考勤工资", value: attendanceSalary, color: colors.foreground },
      { label: "绩效",     value: performance,      color: performance > 0 ? colors.success : colors.foreground },
      { label: "补贴",     value: allowance,         color: allowance > 0 ? "#1677FF" : colors.foreground },
      { label: "奖惩",     value: reward,            color: reward > 0 ? colors.success : reward < 0 ? colors.error : colors.foreground },
    ];
    const grid2 = [
      { label: "调休兑换", value: cashOut,  color: cashOut > 0 ? colors.success : colors.foreground },
      { label: "预支",     value: -advance, color: advance > 0 ? colors.warning : colors.foreground },
      { label: "总薪资",   value: gross,    color: colors.foreground },
      { label: "待发实发", value: final,    color: colors.primary },
    ];

    return (
      <TouchableOpacity onPress={onToggle} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* 顶部：姓名 + 入职时间 */}
        <View style={S.cardHeader}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{employee.realName}</Text>
            {tenure ? <Text style={{ fontSize: 11, color: colors.muted }}>{tenure}</Text> : null}
          </View>
          <IconSymbol name="chevron.down" size={14} color={colors.muted} />
        </View>
        {/* 第一行：考勤工资 / 绩效 / 补贴 / 奖惩 */}
        <View style={[S.gridRow, { borderTopColor: colors.border }]}>
          {grid1.map((item) => (
            <View key={item.label} style={S.gridCell}>
              <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>{item.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: item.color }}>
                {item.value !== 0 ? `¥${Math.abs(item.value).toFixed(0)}` : "—"}
              </Text>
            </View>
          ))}
        </View>
        {/* 第二行：调休兑换 / 预支 / 总薪资 / 待发实发 */}
        <View style={[S.gridRow, { borderTopColor: colors.border }]}>
          {grid2.map((item) => (
            <View key={item.label} style={S.gridCell}>
              <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>{item.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: item.color }}>
                {item.value !== 0 ? `${item.value < 0 ? "-" : ""}¥${Math.abs(item.value).toFixed(0)}` : "—"}
              </Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
    );
  }

  // ── 展开状态 ──
  return (
    <View style={[S.card, S.cardExpanded, { backgroundColor: colors.surface, borderColor: colors.primary + "44" }]}>
      <TouchableOpacity onPress={onToggle} style={S.cardHeader}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{employee.realName}</Text>
          {tenure ? <Text style={{ fontSize: 11, color: colors.muted }}>{tenure}</Text> : null}
        </View>
        <IconSymbol name="chevron.up" size={14} color={colors.primary} />
      </TouchableOpacity>

      {/* 考勤区（只读，点击跳转考勤概况） */}
      <TouchableOpacity
        onPress={() => router.push({ pathname: "/labor", params: { initialPage: "schedule" } } as any)}
        style={[S.section, { borderColor: colors.border }]}>
        <View style={S.sectionHeader}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>考勤（自动推算）</Text>
          <Text style={{ fontSize: 11, color: colors.primary }}>考勤概况 ›</Text>
        </View>
        {att ? (
          <View style={S.detailGrid}>
            <DetailRow label="底薪" value={`¥${employee.baseSalary}`} colors={colors} />
            <DetailRow label="出勤/应出勤" value={`${att.attendanceDays} / ${att.expectedAttendanceDays} 天`} colors={colors} />
            <DetailRow label="日薪" value={`¥${att.dailyRate.toFixed(0)}`} colors={colors} />
            <DetailRow label="加班时长" value={`${(att.paidOvertimeHours ?? 0).toFixed(1)} 小时`} colors={colors} />
            <DetailRow label="加班总金额" value={`+¥${(att.overtimePay ?? 0).toFixed(0)}`} colors={colors} positive />
            <DetailRow label="少休天数" value={att.underRestDays < 0 ? `${Math.abs(att.underRestDays)} 天` : "0 天"} colors={colors} />
            <DetailRow label="少休补贴" value={att.underRestDays < 0 ? `+¥${(Math.abs(att.underRestDays) * att.dailyRate).toFixed(0)}` : "¥0"} colors={colors} positive={att.underRestDays < 0} />
            <DetailRow label="特殊状态扣薪" value={att.totalSpecialDeduction > 0 ? `-¥${att.totalSpecialDeduction.toFixed(0)}` : "¥0"} colors={colors} negative={att.totalSpecialDeduction > 0} />
            <DetailRow label="节假日天数×倍率" value={att.holidayBonus > 0 ? `+¥${att.holidayBonus.toFixed(0)}` : "—"} colors={colors} positive={att.holidayBonus > 0} />
            <DetailRow label="考勤工资小计" value={`¥${att.attendanceSalary.toFixed(0)}`} colors={colors} bold />
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.muted, paddingVertical: 8 }}>暂无考勤数据（请先在排班表填写）</Text>
        )}
        {att?.dailyRateOverride && (
          <View style={[S.warningBanner, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "44" }]}>
            <Text style={{ fontSize: 11, color: colors.warning }}>⚠ 日薪已手动覆盖，与自动计算值不同</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* 绩效补贴区 */}
      <TouchableOpacity onPress={() => router.push({ pathname: "/labor-kpi-allowance", params: { employeeId: employee.id, month } } as any)}
        style={[S.section, { borderColor: colors.border }]}>
        <View style={S.sectionHeader}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>绩效补贴</Text>
          <Text style={{ fontSize: 11, color: colors.primary }}>详情 ›</Text>
        </View>
        <View style={S.detailGrid}>
          <DetailRow label="补贴" value={`¥${(slip?.mealAllowance ?? 0).toFixed(0)}`} colors={colors} />
          <DetailRow label="工作绩效" value={`¥${(slip?.performanceBonus ?? 0).toFixed(0)}`} colors={colors} />
          <DetailRow label="绩效补贴小计" value={`¥${((slip?.performanceBonus ?? 0) + (slip?.mealAllowance ?? 0)).toFixed(0)}`} colors={colors} bold />
        </View>
      </TouchableOpacity>

      {/* 奖惩区（支持负数） */}
      <View style={[S.section, { borderColor: colors.border }]}>
        <View style={S.sectionHeader}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>奖惩</Text>
          <TouchableOpacity onPress={editingReward ? saveRewards : onToggleRewardEdit}>
            <Text style={{ fontSize: 11, color: editingReward ? colors.success : colors.primary, fontWeight: "600" }}>
              {editingReward ? "✓ 保存" : "编辑"}
            </Text>
          </TouchableOpacity>
        </View>
        {rewardItems.length === 0 && !editingReward && (
          <Text style={{ fontSize: 12, color: colors.muted, paddingVertical: 8 }}>暂无奖惩条目</Text>
        )}
        {rewardItems.map((item) => (
          <View key={item.id} style={[S.rewardRow, { borderBottomColor: colors.border }]}>
            {editingReward ? (
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TextInput value={item.name} onChangeText={(v) => updateRewardItem(item.id, "name", v)}
                    placeholder="名称" placeholderTextColor={colors.muted}
                    style={[S.rewardInput, { flex: 1, color: colors.foreground, borderColor: colors.border }]} />
                  {/* +/- 切换按钮 */}
                  <TouchableOpacity onPress={() => updateRewardItem(item.id, "amount", -item.amount)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
                      backgroundColor: item.amount < 0 ? colors.error + "22" : colors.success + "22" }}>
                    <Text style={{ fontSize: 13, fontWeight: "700",
                      color: item.amount < 0 ? colors.error : colors.success }}>
                      {item.amount < 0 ? "−" : "+"}
                    </Text>
                  </TouchableOpacity>
                  <TextInput
                    value={item.amount !== 0 ? String(Math.abs(item.amount)) : ""}
                    onChangeText={(v) => {
                      const num = parseFloat(v.replace(/[^0-9.]/g, "")) || 0;
                      updateRewardItem(item.id, "amount", item.amount < 0 ? -num : num);
                    }}
                    placeholder="金额" placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={[S.rewardInput, { width: 80, color: colors.foreground, borderColor: colors.border, textAlign: "center" }]} />
                  <TouchableOpacity onPress={() => removeRewardItem(item.id)} style={{ padding: 4 }}>
                    <IconSymbol name="trash" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>
                <TextInput value={item.note} onChangeText={(v) => updateRewardItem(item.id, "note", v)}
                  placeholder="说明（选填）" placeholderTextColor={colors.muted}
                  style={[S.rewardInput, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ) : (
              <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.foreground }}>{item.name || "未命名"}</Text>
                  {item.note ? <Text style={{ fontSize: 11, color: colors.muted }}>{item.note}</Text> : null}
                </View>
                <Text style={{ fontSize: 14, fontWeight: "600", color: item.amount >= 0 ? colors.success : colors.error }}>
                  {item.amount >= 0 ? `+¥${item.amount}` : `-¥${Math.abs(item.amount)}`}
                </Text>
              </View>
            )}
          </View>
        ))}
        {editingReward && (
          <TouchableOpacity onPress={addRewardItem} style={[S.addBtn, { borderColor: colors.primary + "44" }]}>
            <Text style={{ fontSize: 12, color: colors.primary }}>+ 添加奖惩条目</Text>
          </TouchableOpacity>
        )}
        {rewardItems.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <DetailRow
              label="奖惩小计"
              value={`${rewardItems.reduce((s, i) => s + i.amount, 0) >= 0 ? "+" : ""}¥${rewardItems.reduce((s, i) => s + i.amount, 0)}`}
              colors={colors} bold
            />
          </View>
        )}
      </View>

      {/* 其他区：调休余额拆分 + 本月兑换 */}
      <View style={[S.section, { borderColor: colors.border }]}>
        <Text style={[S.sectionTitle, { color: colors.muted, marginBottom: 8 }]}>其他</Text>
        {overtimeCompOff > 0 && (
          <DetailRow label="调休余额（加班换休）" value={`${overtimeCompOff.toFixed(1)} 天`} colors={colors} />
        )}
        {holidayCompOff > 0 && (
          <DetailRow label="调休余额（节假日调休）" value={`${holidayCompOff.toFixed(1)} 天`} colors={colors} />
        )}
        {totalCompOff === 0 && (
          <DetailRow label="调休余额" value="0 天" colors={colors} />
        )}
        {compOffCashOut > 0 && (
          <DetailRow label="本月调休兑换" value={`+¥${compOffCashOut.toFixed(0)}`} colors={colors} positive />
        )}
        <DetailRow label="预支小计" value={advanceTotal > 0 ? `-¥${advanceTotal}` : "¥0"} colors={colors} negative={advanceTotal > 0} />
        {(slip?.pettyLaborPaid ?? 0) > 0 && (
          <DetailRow label="备用金已付" value={`-¥${(slip!.pettyLaborPaid!).toFixed(0)}`} colors={colors} negative />
        )}
      </View>

      {/* 备注 */}
      <View style={[S.section, { borderColor: colors.border }]}>
        <Text style={[S.sectionTitle, { color: colors.muted, marginBottom: 8 }]}>备注</Text>
        <TextInput value={notes} onChangeText={setNotes}
          onBlur={() => { if (slip && notes !== slip.notes) upsertPaySlip({ ...slip, notes, updatedAt: new Date().toISOString() }); }}
          placeholder="薪资备注..." placeholderTextColor={colors.muted} multiline
          style={[S.notesInput, { color: colors.foreground, borderColor: colors.border }]} />
      </View>

      {/* 薪资汇总 */}
      {slip && (
        <View style={[S.section, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
          <Text style={[S.sectionTitle, { color: colors.primary, marginBottom: 8 }]}>薪资汇总</Text>
          <DetailRow label="税前工资" value={`¥${slip.grossSalary.toFixed(0)}`} colors={colors} />
          <DetailRow label="社保代缴（个人）" value={slip.socialInsuranceDeduction > 0 ? `-¥${slip.socialInsuranceDeduction.toFixed(0)}` : "—"} colors={colors} negative={slip.socialInsuranceDeduction > 0} />
          <DetailRow label="公积金代缴（个人）" value={slip.housingFundDeduction > 0 ? `-¥${slip.housingFundDeduction.toFixed(0)}` : "—"} colors={colors} negative={slip.housingFundDeduction > 0} />
          <DetailRow label="个税代缴" value={slip.incomeTax > 0 ? `-¥${slip.incomeTax.toFixed(0)}` : "—"} colors={colors} negative={slip.incomeTax > 0} />
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          <DetailRow label="实发薪资" value={`¥${slip.finalSalary.toFixed(0)}`} colors={colors} bold primary />
          <View style={{ height: 8 }} />
          <DetailRow label="公司社保部分" value={slip.employerSocialInsurance > 0 ? `¥${slip.employerSocialInsurance.toFixed(0)}` : "—"} colors={colors} muted />
          <DetailRow label="公司公积金部分" value={slip.employerHousingFund > 0 ? `¥${slip.employerHousingFund.toFixed(0)}` : "—"} colors={colors} muted />
          <DetailRow label="公司总人力成本" value={`¥${slip.totalEmployerCost.toFixed(0)}`} colors={colors} bold />
        </View>
      )}
    </View>
  );
}

// ─── 辅助组件 ─────────────────────────────────────────────────────────────────
function DetailRow({ label, value, colors, bold, positive, negative, primary, muted: isMuted }: {
  label: string; value: string; colors: any; bold?: boolean; positive?: boolean; negative?: boolean; primary?: boolean; muted?: boolean;
}) {
  const valueColor = primary ? colors.primary : positive ? colors.success : negative ? colors.error : isMuted ? colors.muted : colors.foreground;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 }}>
      <Text style={{ fontSize: 13, color: colors.foreground, fontWeight: bold ? "600" : "400" }}>{label}</Text>
      <Text style={{ fontSize: 13, color: valueColor, fontWeight: bold ? "700" : "500" }}>{value}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, height: 48 },
  navTitle: { fontSize: 16, fontWeight: "600" },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  cardExpanded: { borderWidth: 1.5 },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 12 },
  gridRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  gridCell: { flex: 1, alignItems: "center", paddingVertical: 10, paddingHorizontal: 4 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "600" },
  detailGrid: { gap: 2 },
  warningBanner: { marginTop: 8, padding: 6, borderRadius: 6, borderWidth: 1 },
  rewardRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rewardInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13 },
  addBtn: { marginTop: 8, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", alignItems: "center" },
  notesInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13, minHeight: 60, textAlignVertical: "top" },
});
