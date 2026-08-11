/**
 * 绩效补贴展示页（只读）
 * - 直接从 PaySlip 读取当月绩效补贴数据，响应式展示
 * - 导航栏左侧「返回」，右侧「✏ 编辑」（跳转编辑页）+ 「⚙」（跳转员工档案）
 * - 所有内容不可点击/不可输入，仅用于查看
 */
import React, { useMemo } from "react";
import { formatMoney } from "@/lib/utils";
import { numericColor, NUMERIC_TONE } from "@/lib/theme/numeric-color-tokens";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, usePaySlipStore, useAttendanceStore } from "@/lib/labor/store";
import {
  ALLOWANCE_UNIT_LABELS, REVENUE_KPI_SOURCE_LABELS,
  REVENUE_KPI_PAY_MODE_LABELS, calcRevenueKPIBonus, calcAllowance,
  shouldPayAllowanceThisMonth,
} from "@/lib/labor/types";

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export default function LaborKPIAllowancePage() {
  const { employeeId, month } = useLocalSearchParams<{ employeeId: string; month: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { employees } = useEmployeeStore();
  // 关键修复：从 paySlips state 读取（而非 getPaySlip + ref.current）
  // 原因：getPaySlip 依赖 ref（稳定引用），Stack Navigator 返回时 useMemo 不重新计算
  // paySlips state 在 persist 时通过 setData 更新，会触发重新渲染
  const { paySlips } = usePaySlipStore();
  // 防御性修复：订阅 records state，确保考勤数据变化时 attendanceDays useMemo 能重新计算
  const { getAttendance, records: attendanceRecords } = useAttendanceStore();

  const employee = useMemo(() => employees.find((e) => e.id === employeeId), [employees, employeeId]);
  const slip = useMemo(
    () => (employeeId && month ? paySlips.find((s) => s.employeeId === employeeId && s.month === month) ?? null : null),
    [paySlips, employeeId, month]
  );

  if (!employee) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: colors.muted }}>员工不存在</Text>
        </View>
      </ScreenContainer>
    );
  }

  const allowanceRules = employee.allowanceRules ?? [];
  const workKPIRules = employee.workKPIRules ?? [];
  const revenueKPIRules = employee.revenueKPIRules ?? [];

  // 从 PaySlip 读取已保存的数据
  const allowanceOverrides = slip?.allowanceOverrides ?? {};
  const workKPISelections = slip?.workKPISelections ?? {};
  const revenueActuals = slip?.revenueActuals ?? {};

  // 出勤天数（用于日补贴展示）
  // 防御性修复：加入 attendanceRecords 依赖，确保考勤数据更新时重新计算
  const attendanceDays = useMemo(() => {
    if (!employeeId || !month) return 0;
    return getAttendance(employeeId, month)?.attendanceDays ?? 0;
  }, [employeeId, month, getAttendance, attendanceRecords]);

  // 从 PaySlip 读取已保存的合计数据
  const mealAllowance = slip?.mealAllowance ?? 0;
  const transportAllowance = slip?.transportAllowance ?? 0;
  const otherAllowance = slip?.otherAllowance ?? 0;
  const performanceBonus = slip?.performanceBonus ?? 0;
  // 分项绩效字段：优先使用新字段，旧数据回落到 performanceBonus（向后兼容）
  const workKPIBonus = slip?.workKPIBonus ?? performanceBonus;
  const revenueKPIBonus = slip?.revenueKPIBonus ?? 0;
  const salesCommission = slip?.salesCommission ?? 0;
  const allowanceTotal = mealAllowance + transportAllowance + otherAllowance;
  // grandTotal = 补贴 + 工作绩效 + 业绩绩效（不含 salesCommission 业绩提点，业绩提点是营业额提成，不属于绩效补贴页范畴）
  const grandTotal = allowanceTotal + performanceBonus;

  return (
    <ScreenContainer>
      {/* 导航栏：左侧「返回」，右侧「✏ 编辑」+「⚙」 */}
      <View style={[S.navbar, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{employee.realName} · 绩效补贴</Text>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TouchableOpacity
            onPress={() => { tap(); router.push({ pathname: "/labor-kpi-allowance-edit", params: { employeeId: employee.id, month } } as any); }}
            style={{ padding: 8 }}>
            <IconSymbol name="pencil" size={18} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { tap(); router.push({ pathname: "/labor-employee-form", params: { id: employee.id } } as any); }}
            style={{ padding: 8 }}>
            <IconSymbol name="gearshape" size={18} color={colors.muted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 顶部总结卡：4格（绩效补贴 / 补贴 / 工作绩效 / 业绩绩效） */}
        <View style={[S.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={S.summaryRow}>
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>绩效补贴</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: numericColor(colors, NUMERIC_TONE.primary) }]}>¥{formatMoney(grandTotal)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>补贴</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: numericColor(colors) }]}>¥{formatMoney(allowanceTotal)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>工作绩效</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: numericColor(colors) }]}>¥{formatMoney(workKPIBonus)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>业绩绩效</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[S.summaryValue, { color: numericColor(colors) }]}>¥{formatMoney(revenueKPIBonus)}</Text>
            </View>
          </View>
        </View>

        {/* ── 补贴展示区（只读） ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>补贴项</Text>
          {allowanceRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无补贴项，请点击右上角⚙在员工档案中配置规则</Text>
          )}
          {allowanceRules.map((rule) => {
            // 修复：季度/年度补贴必须先判断当月是否应发放，与 buildPaySlipDraft 逻辑保持一致
            const shouldPay = shouldPayAllowanceThisMonth(rule, month ?? "");
            const isActive = shouldPay && (
              allowanceOverrides[rule.id] !== undefined
                ? allowanceOverrides[rule.id]
                : rule.enabled !== false
            );
            const displayAmount = shouldPay ? calcAllowance(rule, attendanceDays).amount : 0;
            return (
              <View key={rule.id} style={[S.itemRow, { borderBottomColor: colors.border }]}>
                <View style={[S.checkbox, {
                  borderColor: isActive ? colors.primary : colors.border,
                  backgroundColor: isActive ? colors.primary : "transparent",
                }]}>
                  {isActive && <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: isActive ? colors.foreground : colors.muted }}>{rule.label}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {ALLOWANCE_UNIT_LABELS[rule.unit ?? "per_month"]}
                    {!shouldPay && <Text style={{ color: colors.warning }}> · 本月不发放</Text>}
                  </Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: "600", color: isActive ? colors.primary : colors.muted }}>
                  ¥{formatMoney(displayAmount)}
                  {(rule.unit === "per_day" || rule.type === "meal_per_day") && shouldPay
                    ? <Text style={{ fontSize: 10, color: colors.muted }}> (¥{rule.amount}/天×{attendanceDays}天)</Text>
                    : null}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── 工作绩效展示区（只读） ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>工作绩效</Text>
          {workKPIRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无工作绩效项，请点击右上角⚙在员工档案中配置规则</Text>
          )}
          {workKPIRules.filter((r) => r.enabled).map((rule) => {
            const selectedTierId = workKPISelections[rule.id];
            const selectedTier = rule.tiers.find((t) => t.id === selectedTierId);
            return (
              <View key={rule.id} style={[S.itemRow, { borderBottomColor: colors.border, flexDirection: "column", alignItems: "stretch" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{rule.name}</Text>
                  {selectedTier ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={[S.readonlyChip, { borderColor: colors.success + "66", backgroundColor: colors.success + "15" }]}>
                        <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>{selectedTier.label}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: numericColor(colors, selectedTier.amount < 0 ? NUMERIC_TONE.negative : NUMERIC_TONE.value) }}>
                        {selectedTier.amount >= 0 ? `+¥${selectedTier.amount}` : `-¥${Math.abs(selectedTier.amount)}`}
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 12, color: colors.muted }}>未填写</Text>
                  )}
                </View>
                {rule.notes ? <Text style={{ fontSize: 11, color: colors.muted }}>{rule.notes}</Text> : null}
              </View>
            );
          })}
        </View>

        {/* ── 业绩绩效展示区（只读） ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>业绩绩效</Text>
          {revenueKPIRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无业绩绩效项，请点击右上角⚙在员工档案中配置规则</Text>
          )}
          {revenueKPIRules.filter((r) => r.enabled).map((rule) => {
            const actual = revenueActuals[rule.id] ?? 0;
            const bonus = calcRevenueKPIBonus(rule, actual);
            return (
              <View key={rule.id} style={[S.itemRow, { borderBottomColor: colors.border, flexDirection: "column", alignItems: "stretch" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{rule.name}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: bonus > 0 ? numericColor(colors) : numericColor(colors, NUMERIC_TONE.muted) }}>+¥{formatMoney(bonus)}</Text>
                </View>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  数据源：{REVENUE_KPI_SOURCE_LABELS[rule.source]}{rule.source === "category" ? ` · ${rule.categoryName}` : ""} · {REVENUE_KPI_PAY_MODE_LABELS[rule.payMode].split("（")[0]}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>实际达到：</Text>
                  {actual > 0 ? (
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>¥{Number(actual).toLocaleString()}</Text>
                  ) : (
                    <Text style={{ fontSize: 12, color: colors.muted }}>未填写</Text>
                  )}
                </View>
                <View style={{ marginTop: 6, gap: 2 }}>
                  {rule.tiers.sort((a, b) => a.sortOrder - b.sortOrder).map((tier) => {
                    const reached = Number(actual) >= tier.threshold;
                    return (
                      <View key={tier.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: reached ? colors.success : colors.border }} />
                        <Text style={{ fontSize: 11, color: reached ? numericColor(colors) : numericColor(colors, NUMERIC_TONE.muted) }}>
                          ≥¥{tier.threshold.toLocaleString()} → {rule.calcType === "fixed" ? `+¥${tier.amount}` : `${(tier.amount * 100).toFixed(1)}%`}
                        </Text>
                      </View>
                    );
                  })}
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
  // fontSize: 16 在 4格布局（每格 ~77pt）下，¥100,000+ 会触碰边界，加 adjustsFontSizeToFit 防止溢出
  summaryValue: { fontSize: 16, fontWeight: "700" },
  summaryDivider: { width: 1, height: 30 },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: "600", marginBottom: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  readonlyChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
});
