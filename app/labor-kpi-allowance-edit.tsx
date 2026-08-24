/**
 * 绩效补贴编辑页（整页编辑保存模式）
 * - 进入页面时从 PaySlip 加载当前状态到本地 State
 * - 用户自由修改（补贴勾选、绩效档位、业绩数值），所有改动只在本地 State 暂存
 * - 顶部总结卡实时预览（基于本地 State 计算，不影响 Store）
 * - 导航栏左侧「取消」：有改动时弹出确认弹窗，放弃改动后返回
 * - 导航栏右侧「保存」：一次性将所有数据写入 Store，触发全量重算，然后返回
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, usePaySlipStore, useAttendanceStore, useGlobalPayrollSettingsStore, useMonthCloseStore } from "@/lib/labor/store";
import {
  ALLOWANCE_UNIT_LABELS, REVENUE_KPI_SOURCE_LABELS,
  REVENUE_KPI_PAY_MODE_LABELS, shouldPayAllowanceThisMonth,
} from "@/lib/labor/types";
import { settlePayrollExtras, type PayrollExtrasSettlement } from "@/lib/labor/payroll-extras";
import { buildPayrollExtrasEditorState } from "@/lib/labor/payroll-extras-editor-state";
import { isDailyAllowanceRule } from "@/lib/labor/allowance-rule-semantics";

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

const EMPTY_PAYROLL_EXTRAS: PayrollExtrasSettlement = {
  mealAllowance: 0,
  transportAllowance: 0,
  otherAllowance: 0,
  allowanceTotal: 0,
  allowanceDetails: {},
  workKPIBonus: 0,
  workKPIDetails: {},
  revenueKPIBonus: 0,
  revenueKPIDetails: {},
  performanceTotal: 0,
};

export default function LaborKPIAllowanceEditPage() {
  const { employeeId, month } = useLocalSearchParams<{ employeeId: string; month: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { employees } = useEmployeeStore();
  const { getPaySlip, upsertPaySlip, buildPaySlipDraft } = usePaySlipStore();
  // 防御性修复：订阅 records state，确保考勤数据变化时 attendanceDays useMemo 能重新计算
  const { getAttendance } = useAttendanceStore();
  const { settings: globalSettings } = useGlobalPayrollSettingsStore();
  const { isMonthWritable } = useMonthCloseStore();

  const employee = useMemo(() => employees.find((e) => e.id === employeeId), [employees, employeeId]);

  // ── 从 PaySlip 初始化本地 State（仅初始化一次） ──

  const initialEditorState = employee && employeeId && month
    ? buildPayrollExtrasEditorState(employee, month, getPaySlip(employeeId, month))
    : { allowanceEnabled: {}, workKPISelections: {}, revenueActuals: {} };

  // 补贴、工作绩效和业绩绩效均只在编辑页本地暂存；保存后统一重算。
  const [allowanceEnabled, setAllowanceEnabled] = useState<Record<string, boolean>>(() => initialEditorState.allowanceEnabled);
  const [workKPISelections, setWorkKPISelections] = useState<Record<string, string>>(() => initialEditorState.workKPISelections);
  const [revenueActuals, setRevenueActuals] = useState<Record<string, string>>(() => initialEditorState.revenueActuals);

  // 仅在员工和月份首次就绪时初始化，避免异步加载员工档案后遗留空状态。
  const initializedKeyRef = useRef<string | null>(null);

  // 记录初始状态，用于判断是否有未保存的改动
  const initialStateRef = useRef({
    allowanceEnabled: { ...allowanceEnabled },
    workKPISelections: { ...workKPISelections },
    revenueActuals: { ...revenueActuals },
  });

  const allowanceRules = employee?.allowanceRules ?? [];
  const workKPIRules = employee?.workKPIRules ?? [];
  const revenueKPIRules = employee?.revenueKPIRules ?? [];

  // 员工档案由持久化Store异步加载时，useState 初始化器不会再次执行。
  // 因此必须在当前 employeeId + month 第一次就绪时，从薪资单重建本地编辑状态；
  // 后续用户未保存修改绝不能被此 effect 覆盖。
  useEffect(() => {
    if (!employee || !employeeId || !month) return;
    const key = `${employeeId}:${month}`;
    if (initializedKeyRef.current === key) return;

    const next = buildPayrollExtrasEditorState(employee, month, getPaySlip(employeeId, month));

    setAllowanceEnabled(next.allowanceEnabled);
    setWorkKPISelections(next.workKPISelections);
    setRevenueActuals(next.revenueActuals);
    initialStateRef.current = {
      allowanceEnabled: { ...next.allowanceEnabled },
      workKPISelections: { ...next.workKPISelections },
      revenueActuals: { ...next.revenueActuals },
    };
    initializedKeyRef.current = key;
  }, [employee, employeeId, month, getPaySlip]);

  // ── 获取当月出勤天数（用于日补贴计算） ──
  // 防御性修复：加入 attendanceRecords 依赖，确保考勤数据更新时重新计算
  const attendanceDays = useMemo(() => {
    if (!employeeId || !month) return 0;
    return getAttendance(employeeId, month)?.attendanceDays ?? 0;
  }, [employeeId, month, getAttendance]);

  // ── 实时预览合计（与薪资草稿、只读页完全使用同一结算引擎） ──
  const extras = useMemo(() => {
    if (!employee) return EMPTY_PAYROLL_EXTRAS;
    return settlePayrollExtras(employee, month ?? "", attendanceDays, {
      allowanceOverrides: allowanceEnabled,
      workKPISelections,
      revenueActuals: Object.fromEntries(Object.entries(revenueActuals).map(([id, value]) => [id, Number(value) || 0])),
    });
  }, [employee, month, attendanceDays, allowanceEnabled, workKPISelections, revenueActuals]);
  const allowanceTotal = extras.allowanceTotal;
  const workKPITotal = extras.workKPIBonus;
  const revenueKPITotal = extras.revenueKPIBonus;
  const grandTotal = extras.allowanceTotal + extras.performanceTotal;

  // ── 判断是否有未保存的改动 ──
  const hasChanges = useCallback(() => {
    const init = initialStateRef.current;
    for (const id of Object.keys(allowanceEnabled)) {
      if (allowanceEnabled[id] !== init.allowanceEnabled[id]) return true;
    }
    const allKPIIds = new Set([...Object.keys(workKPISelections), ...Object.keys(init.workKPISelections)]);
    for (const id of allKPIIds) {
      if ((workKPISelections[id] ?? "") !== (init.workKPISelections[id] ?? "")) return true;
    }
    const allRevIds = new Set([...Object.keys(revenueActuals), ...Object.keys(init.revenueActuals)]);
    for (const id of allRevIds) {
      if ((revenueActuals[id] ?? "") !== (init.revenueActuals[id] ?? "")) return true;
    }
    return false;
  }, [allowanceEnabled, workKPISelections, revenueActuals]);

  // ── 整页保存：一次性写入所有数据，触发全量重算 ──
  const handleSave = useCallback(() => {
    if (!month || !employeeId || !employee) return;
    // 锁定拦截：已确认发薪的月份不允许修改
    if (!isMonthWritable(month)) {
      Alert.alert("已锁定", "本月已确认发薪，如需修改请先进入差额调整模式。");
      return;
    }
    const existing = getPaySlip(employeeId, month);
    if (!existing) {
      router.back();
      return;
    }
    tap();

    const numericActuals: Record<string, number> = {};
    Object.entries(revenueActuals).forEach(([k, v]) => { numericActuals[k] = Number(v) || 0; });

    // Step 1：先将所有控制字段写入 Store
    const patched = {
      ...existing,
      allowanceOverrides: allowanceEnabled,
      workKPISelections,
      revenueActuals: numericActuals,
    };
    upsertPaySlip(patched);

    // Step 2：此时 ref.current 已更新，buildPaySlipDraft 能读到最新控制字段
    const att = getAttendance(employeeId, month) ?? null;
    const advanceAmount = patched.advanceAmount ?? 0;
    const draft = buildPaySlipDraft(employee, month, att, advanceAmount, globalSettings);

    // Step 3：原子性最终写入
    // 注意：draft 已包含 allowanceOverrides/workKPISelections/revenueActuals（从 Step 1 写入的 existing 读取）
    // 无需再次显式传入，避免出现两个来源的控制字段
    upsertPaySlip({ ...draft, id: existing.id });

    router.back();
  }, [month, employeeId, employee, getPaySlip, allowanceEnabled, workKPISelections, revenueActuals, upsertPaySlip, buildPaySlipDraft, getAttendance, globalSettings, isMonthWritable, router]);

  // ── 取消：有改动时弹出确认弹窗 ──
  const handleCancel = useCallback(() => {
    if (hasChanges()) {
      Alert.alert(
        "放弃更改",
        "你有未保存的改动，确认放弃？",
        [
          { text: "继续编辑", style: "cancel" },
          { text: "放弃", style: "destructive", onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  }, [hasChanges, router]);

  if (!employee) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: colors.muted }}>员工不存在</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* 导航栏：左侧「取消」，右侧「保存」 */}
      <View style={[S.navbar, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={handleCancel} style={{ padding: 8 }}>
          <Text style={{ fontSize: 16, color: colors.error }}>取消</Text>
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{employee.realName} · 编辑绩效补贴</Text>
        <TouchableOpacity onPress={handleSave} style={{ padding: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.primary }}>保存</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 顶部总结卡：4格实时预览 */}
        <View style={[S.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={S.summaryRow}>
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>绩效补贴</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: colors.foreground }]}>¥{formatMoney(grandTotal)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>补贴</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: colors.primary }]}>¥{formatMoney(allowanceTotal)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>工作绩效</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: colors.success }]}>¥{formatMoney(workKPITotal)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>业绩绩效</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: colors.success }]}>¥{formatMoney(revenueKPITotal)}</Text>
            </View>
          </View>
          {/* 未保存提示 */}
          {hasChanges() && (
            <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warning ?? "#FF9500" }} />
              <Text style={{ fontSize: 11, color: colors.warning ?? "#FF9500" }}>有未保存的改动，点击右上角「保存」生效</Text>
            </View>
          )}
        </View>

        {/* ── 补贴区（可勾选） ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>补贴项</Text>
          {allowanceRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无补贴项，请在员工档案中配置规则</Text>
          )}
          {allowanceRules.map((rule) => {
            // 修复：季度/年度补贴必须先判断当月是否应发放，与 buildPaySlipDraft 保持一致
            const shouldPay = shouldPayAllowanceThisMonth(rule, month ?? "");
            const displayAmount = extras.allowanceDetails[rule.id]?.amount ?? 0;
            // 非发放月的补贴不允许用户勾选（禁用点击）
            return (
              <TouchableOpacity key={rule.id}
                onPress={() => { if (!shouldPay) return; tap(); setAllowanceEnabled((prev) => ({ ...prev, [rule.id]: !prev[rule.id] })); }}
                style={[S.itemRow, { borderBottomColor: colors.border, opacity: shouldPay ? 1 : 0.5 }]}>
                <View style={[S.checkbox, {
                  borderColor: (shouldPay && allowanceEnabled[rule.id]) ? colors.primary : colors.border,
                  backgroundColor: (shouldPay && allowanceEnabled[rule.id]) ? colors.primary : "transparent",
                }]}>
                  {(shouldPay && allowanceEnabled[rule.id]) && <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground }}>{rule.label}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {ALLOWANCE_UNIT_LABELS[rule.unit ?? "per_month"]}
                    {!shouldPay && <Text style={{ color: colors.warning }}> · 本月不发放</Text>}
                  </Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: "600", color: (shouldPay && allowanceEnabled[rule.id]) ? colors.primary : colors.muted }}>
                  ¥{formatMoney(displayAmount)}
                  {isDailyAllowanceRule(rule) && shouldPay
                    ? <Text style={{ fontSize: 10, color: colors.muted }}> (¥{rule.amount}/天×{attendanceDays}天)</Text>
                    : null}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── 工作绩效区（可选档位） ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>工作绩效</Text>
          {workKPIRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无工作绩效项，请在员工档案中配置规则</Text>
          )}
          {workKPIRules.filter((r) => r.enabled).map((rule) => (
            <View key={rule.id} style={[S.itemRow, { borderBottomColor: colors.border, flexDirection: "column", alignItems: "stretch" }]}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 6 }}>{rule.name}</Text>
              {rule.notes ? <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>{rule.notes}</Text> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {rule.tiers.sort((a, b) => a.sortOrder - b.sortOrder).map((tier) => {
                  const isSelected = workKPISelections[rule.id] === tier.id;
                  const tierColor = tier.amount > 0 ? colors.success : tier.amount < 0 ? colors.error : colors.muted;
                  return (
                    <TouchableOpacity key={tier.id}
                      onPress={() => { tap(); setWorkKPISelections((prev) => ({ ...prev, [rule.id]: prev[rule.id] === tier.id ? "" : tier.id })); }}
                      style={[S.tierChip, {
                        borderColor: isSelected ? tierColor : colors.border,
                        backgroundColor: isSelected ? tierColor + "15" : colors.surface,
                      }]}>
                      <Text style={{ fontSize: 12, color: isSelected ? tierColor : colors.foreground, fontWeight: isSelected ? "600" : "400" }}>
                        {tier.label}
                      </Text>
                      <Text style={{ fontSize: 10, color: isSelected ? tierColor : colors.muted }}>
                        {tier.amount > 0 ? `+¥${tier.amount}` : tier.amount < 0 ? `-¥${Math.abs(tier.amount)}` : "¥0"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {/* ── 业绩绩效区（可输入实际金额） ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>业绩绩效</Text>
          {revenueKPIRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无业绩绩效项，请在员工档案中配置规则</Text>
          )}
          {revenueKPIRules.filter((r) => r.enabled).map((rule) => {
            const actualStr = revenueActuals[rule.id] ?? "";
            const actual = actualStr ? Number(actualStr) : 0;
            const bonus = extras.revenueKPIDetails[rule.id]?.amount ?? 0;
            return (
              <View key={rule.id} style={[S.itemRow, { borderBottomColor: colors.border, flexDirection: "column", alignItems: "stretch" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{rule.name}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: bonus > 0 ? colors.success : colors.muted }}>+¥{formatMoney(bonus)}</Text>
                </View>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  数据源：{REVENUE_KPI_SOURCE_LABELS[rule.source]}{rule.source === "category" ? ` · ${rule.categoryName}` : ""} · {REVENUE_KPI_PAY_MODE_LABELS[rule.payMode].split("（")[0]}
                </Text>
                <View style={{ marginTop: 6, gap: 2 }}>
                  {rule.tiers.sort((a, b) => a.sortOrder - b.sortOrder).map((tier) => {
                    const reached = actual >= tier.threshold;
                    return (
                      <View key={tier.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: reached ? colors.success : colors.border }} />
                        <Text style={{ fontSize: 11, color: reached ? colors.success : colors.muted }}>
                          ≥¥{tier.threshold.toLocaleString()} → {rule.calcType === "fixed" ? `+¥${tier.amount}` : `${(tier.amount * 100).toFixed(1)}%`}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>实际达到：</Text>
                  <TextInput
                    value={actualStr}
                    onChangeText={(v) => setRevenueActuals((prev) => ({ ...prev, [rule.id]: v }))}
                    placeholder="输入实际金额"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={[S.amountInput, { color: colors.foreground, borderColor: colors.border }]}
                  />
                  <Text style={{ fontSize: 12, color: colors.muted }}>元</Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, height: 48 },
  navTitle: { fontSize: 16, fontWeight: "600" },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { fontSize: 11, marginBottom: 4 },
  summaryValue: { fontSize: 16, fontWeight: "700" },
  summaryDivider: { width: 1, height: 30 },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: "600", marginBottom: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tierChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: "center", gap: 2 },
  amountInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, fontSize: 14, width: 120, textAlign: "center" },
});
