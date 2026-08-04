/**
 * 绩效补贴页面
 * - 顶部总结卡：绩效总额合计 | 绩效总额 | 补贴总额
 * - 补贴展示区：勾选本月是否生效
 * - 工作绩效区：勾选完成档位
 * - 业绩绩效区：显示数据源金额 + 自动计算 + 手动修改实际金额
 * - 所有修改即时同步薪资单
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, usePaySlipStore } from "@/lib/labor/store";
import {
  Employee, AllowanceRule, WorkKPIRule, RevenueKPIRule,
  ALLOWANCE_UNIT_LABELS, REVENUE_KPI_SOURCE_LABELS,
  REVENUE_KPI_PAY_MODE_LABELS, calcRevenueKPIBonus,
  shouldPayAllowanceThisMonth,
} from "@/lib/labor/types";

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export default function LaborKPIAllowancePage() {
  const { employeeId, month } = useLocalSearchParams<{ employeeId: string; month: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { employees } = useEmployeeStore();
  const { getPaySlip, upsertPaySlip } = usePaySlipStore();

  const employee = useMemo(() => employees.find((e) => e.id === employeeId), [employees, employeeId]);

  // 补贴本月生效状态（key: ruleId, value: 是否生效）
  const [allowanceEnabled, setAllowanceEnabled] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    (employee?.allowanceRules ?? []).forEach((r) => {
      map[r.id] = r.enabled !== false && shouldPayAllowanceThisMonth(r, month || "");
    });
    return map;
  });

  // 工作绩效勾选的档位（key: ruleId, value: tierId）
  const [workKPISelections, setWorkKPISelections] = useState<Record<string, string>>({});

  // 业绩绩效手动填写的实际金额（key: ruleId, value: 实际达到金额）
  const [revenueActuals, setRevenueActuals] = useState<Record<string, string>>({});

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

  // 计算补贴总额
  const allowanceTotal = useMemo(() => {
    return allowanceRules.reduce((sum, r) => {
      if (!allowanceEnabled[r.id]) return sum;
      return sum + (r.amount || 0);
    }, 0);
  }, [allowanceRules, allowanceEnabled]);

  // 计算工作绩效总额
  const workKPITotal = useMemo(() => {
    return workKPIRules.reduce((sum, rule) => {
      const selectedTierId = workKPISelections[rule.id];
      if (!selectedTierId) return sum;
      const tier = rule.tiers.find((t) => t.id === selectedTierId);
      return sum + (tier?.amount ?? 0);
    }, 0);
  }, [workKPIRules, workKPISelections]);

  // 计算业绩绩效总额
  const revenueKPITotal = useMemo(() => {
    return revenueKPIRules.reduce((sum, rule) => {
      if (!rule.enabled) return sum;
      const actualStr = revenueActuals[rule.id];
      const actual = actualStr ? Number(actualStr) : 0;
      return sum + calcRevenueKPIBonus(rule, actual);
    }, 0);
  }, [revenueKPIRules, revenueActuals]);

  const performanceTotal = workKPITotal + revenueKPITotal;
  const grandTotal = performanceTotal + allowanceTotal;

  // 切换补贴本月生效
  const toggleAllowance = (id: string) => {
    tap();
    setAllowanceEnabled((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // 勾选工作绩效档位
  const selectWorkKPITier = (ruleId: string, tierId: string) => {
    tap();
    setWorkKPISelections((prev) => ({
      ...prev,
      [ruleId]: prev[ruleId] === tierId ? "" : tierId,
    }));
  };

  // 即时同步薪资单
  const syncToPaySlip = useCallback(() => {
    if (!month || !employeeId) return;
    const existing = getPaySlip(employeeId, month);
    if (!existing) return;
    const updatedSlip = {
      ...existing,
      performanceBonus: workKPITotal + revenueKPITotal,
      mealAllowance: allowanceTotal,
      grossSalary: existing.attendanceSalary + (workKPITotal + revenueKPITotal) + allowanceTotal + existing.salesCommission + existing.rewardPenalty - existing.advanceAmount,
    };
    upsertPaySlip(updatedSlip);
  }, [month, employeeId, getPaySlip, upsertPaySlip, workKPITotal, revenueKPITotal, allowanceTotal]);

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={() => { syncToPaySlip(); router.back(); }} style={{ padding: 8 }}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{employee.realName} · 绩效补贴</Text>
        <TouchableOpacity onPress={() => { tap(); router.push({ pathname: "/labor-employee-form", params: { employeeId: employee.id } } as any); }} style={{ padding: 8 }}>
          <IconSymbol name="gearshape" size={20} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 顶部总结卡 */}
        <View style={[S.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={S.summaryRow}>
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>绩效+补贴合计</Text>
              <Text style={[S.summaryValue, { color: colors.foreground }]}>¥{grandTotal.toFixed(0)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>绩效总额</Text>
              <Text style={[S.summaryValue, { color: colors.success }]}>¥{performanceTotal.toFixed(0)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>补贴总额</Text>
              <Text style={[S.summaryValue, { color: colors.primary }]}>¥{allowanceTotal.toFixed(0)}</Text>
            </View>
          </View>
        </View>

        {/* ── 补贴展示区 ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>补贴项</Text>
          {allowanceRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无补贴项，请在员工档案中添加</Text>
          )}
          {allowanceRules.map((rule) => (
            <TouchableOpacity key={rule.id} onPress={() => toggleAllowance(rule.id)}
              style={[S.itemRow, { borderBottomColor: colors.border }]}>
              <View style={[S.checkbox, { borderColor: allowanceEnabled[rule.id] ? colors.primary : colors.border, backgroundColor: allowanceEnabled[rule.id] ? colors.primary : "transparent" }]}>
                {allowanceEnabled[rule.id] && <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, color: colors.foreground }}>{rule.label}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{ALLOWANCE_UNIT_LABELS[rule.unit ?? "per_month"]}</Text>
              </View>
              <Text style={{ fontSize: 15, fontWeight: "600", color: allowanceEnabled[rule.id] ? colors.primary : colors.muted }}>
                ¥{rule.amount}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 工作绩效区 ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>工作绩效</Text>
          {workKPIRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无工作绩效项，请在员工档案中添加</Text>
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
                    <TouchableOpacity key={tier.id} onPress={() => selectWorkKPITier(rule.id, tier.id)}
                      style={[S.tierChip, { borderColor: isSelected ? tierColor : colors.border, backgroundColor: isSelected ? tierColor + "15" : colors.surface }]}>
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

        {/* ── 业绩绩效区 ── */}
        <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>业绩绩效</Text>
          {revenueKPIRules.length === 0 && (
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 16 }}>暂无业绩绩效项，请在员工档案中添加</Text>
          )}
          {revenueKPIRules.filter((r) => r.enabled).map((rule) => {
            const actualStr = revenueActuals[rule.id] ?? "";
            const actual = actualStr ? Number(actualStr) : 0;
            const bonus = calcRevenueKPIBonus(rule, actual);
            return (
              <View key={rule.id} style={[S.itemRow, { borderBottomColor: colors.border, flexDirection: "column", alignItems: "stretch" }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{rule.name}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: bonus > 0 ? colors.success : colors.muted }}>+¥{bonus.toFixed(0)}</Text>
                </View>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                  数据源：{REVENUE_KPI_SOURCE_LABELS[rule.source]}{rule.source === "category" ? ` · ${rule.categoryName}` : ""} · {REVENUE_KPI_PAY_MODE_LABELS[rule.payMode].split("（")[0]}
                </Text>
                {/* 档位展示 */}
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
                {/* 实际达到金额输入 */}
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
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, height: 48 },
  navTitle: { fontSize: 16, fontWeight: "600" },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryLabel: { fontSize: 11, marginBottom: 4 },
  summaryValue: { fontSize: 18, fontWeight: "700" },
  summaryDivider: { width: 1, height: 30 },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: "600", marginBottom: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tierChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: "center", gap: 2 },
  amountInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, fontSize: 14, width: 120, textAlign: "center" },
});
