/**
 * 绩效补贴页面
 * - 顶部总结卡：绩效补贴合计 | 补贴 | 工作绩效 | 业绩绩效（4格）
 * - 补贴展示区：勾选本月是否生效（即时写入 PaySlip.allowanceOverrides）
 * - 工作绩效区：勾选完成档位（即时写入 PaySlip.workKPISelections）
 * - 业绩绩效区：输入实际金额（即时写入 PaySlip.revenueActuals）
 * - 所有修改即时持久化，进入页面时从 PaySlip 恢复状态，退出无需同步
 * - ⚙ 跳转当前员工编辑页（传入 id 参数）
 *
 * 设计原则（规范 7：单步操作即时写入，不依赖返回时同步）：
 * - 每次点击/输入立即调用 upsertPaySlip，不存在「忘记保存」
 * - 初始化时从 PaySlip 读取所有已持久化的选择状态
 * - 删除 syncToPaySlip()，返回按钮直接 router.back()
 */
import React, { useMemo, useState } from "react";
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
  AllowanceRule, WorkKPIRule, RevenueKPIRule,
  ALLOWANCE_UNIT_LABELS, REVENUE_KPI_SOURCE_LABELS,
  REVENUE_KPI_PAY_MODE_LABELS, calcRevenueKPIBonus,
  shouldPayAllowanceThisMonth,
} from "@/lib/labor/types";

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// ─── 计算薪资单更新值（统一入口，避免重复计算） ──────────────────────────────
function calcPaySlipUpdate(
  existing: any,
  allowanceTotal: number,
  workKPITotal: number,
  revenueKPITotal: number,
) {
  const newGross = Math.round((
    existing.attendanceSalary + workKPITotal + revenueKPITotal + allowanceTotal +
    existing.salesCommission + existing.rewardPenalty
  ) * 100) / 100;
  const newFinal = Math.round((
    newGross - (existing.socialInsuranceDeduction ?? 0) - (existing.housingFundDeduction ?? 0) -
    (existing.incomeTax ?? 0) - existing.advanceAmount - (existing.pettyLaborPaid ?? 0)
  ) * 100) / 100;
  return {
    performanceBonus: workKPITotal + revenueKPITotal,
    mealAllowance: allowanceTotal,
    grossSalary: newGross,
    finalSalary: newFinal,
    totalEmployerCost: Math.round((newGross + (existing.employerSocialInsurance ?? 0) + (existing.employerHousingFund ?? 0)) * 100) / 100,
  };
}

export default function LaborKPIAllowancePage() {
  const { employeeId, month } = useLocalSearchParams<{ employeeId: string; month: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { employees } = useEmployeeStore();
  const { getPaySlip, upsertPaySlip } = usePaySlipStore();

  const employee = useMemo(() => employees.find((e) => e.id === employeeId), [employees, employeeId]);

  // ── 从 PaySlip 恢复所有持久化状态（初始化一次，之后即时写入） ──

  // 补贴本月生效状态：优先从 PaySlip.allowanceOverrides 读取，否则按规则默认值
  const [allowanceEnabled, setAllowanceEnabled] = useState<Record<string, boolean>>(() => {
    const slip = employeeId && month ? getPaySlip(employeeId, month) : null;
    const overrides = slip?.allowanceOverrides;
    const map: Record<string, boolean> = {};
    (employee?.allowanceRules ?? []).forEach((r) => {
      if (overrides && r.id in overrides) {
        map[r.id] = overrides[r.id];
      } else {
        map[r.id] = r.enabled !== false && shouldPayAllowanceThisMonth(r, month || "");
      }
    });
    return map;
  });

  // 工作绩效档位选择：从 PaySlip.workKPISelections 恢复（修复：不再初始化为空对象）
  const [workKPISelections, setWorkKPISelections] = useState<Record<string, string>>(() => {
    const slip = employeeId && month ? getPaySlip(employeeId, month) : null;
    return slip?.workKPISelections ?? {};
  });

  // 业绩绩效实际金额：从 PaySlip.revenueActuals 恢复（修复：不再初始化为空对象）
  const [revenueActuals, setRevenueActuals] = useState<Record<string, string>>(() => {
    const slip = employeeId && month ? getPaySlip(employeeId, month) : null;
    const saved = slip?.revenueActuals ?? {};
    // 转为字符串（TextInput 使用字符串）
    const map: Record<string, string> = {};
    Object.entries(saved).forEach(([k, v]) => { map[k] = String(v); });
    return map;
  });

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

  // ── 实时计算合计（用于显示和写入） ──

  const allowanceTotal = useMemo(() => {
    return allowanceRules.reduce((sum, r) => {
      if (!allowanceEnabled[r.id]) return sum;
      return sum + (r.amount || 0);
    }, 0);
  }, [allowanceRules, allowanceEnabled]);

  const workKPITotal = useMemo(() => {
    return workKPIRules.reduce((sum, rule) => {
      const selectedTierId = workKPISelections[rule.id];
      if (!selectedTierId) return sum;
      const tier = rule.tiers.find((t) => t.id === selectedTierId);
      return sum + (tier?.amount ?? 0);
    }, 0);
  }, [workKPIRules, workKPISelections]);

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

  // ── 即时写入辅助函数 ──
  const writeToPaySlip = (patch: Partial<ReturnType<typeof calcPaySlipUpdate>> & Record<string, any>) => {
    if (!month || !employeeId) return;
    const existing = getPaySlip(employeeId, month);
    if (!existing) return;
    upsertPaySlip({ ...existing, ...patch });
  };

  // ── 切换补贴本月生效（即时写入） ──
  const toggleAllowance = (id: string) => {
    tap();
    setAllowanceEnabled((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      const newAllowanceTotal = allowanceRules.reduce((sum, r) => (!next[r.id] ? sum : sum + (r.amount || 0)), 0);
      const existing = employeeId && month ? getPaySlip(employeeId, month) : null;
      if (existing) {
        writeToPaySlip({
          ...calcPaySlipUpdate(existing, newAllowanceTotal, workKPITotal, revenueKPITotal),
          allowanceOverrides: next,
        });
      }
      return next;
    });
  };

  // ── 勾选工作绩效档位（即时写入，修复：不再延迟到返回时同步） ──
  const selectWorkKPITier = (ruleId: string, tierId: string) => {
    tap();
    setWorkKPISelections((prev) => {
      const next = { ...prev, [ruleId]: prev[ruleId] === tierId ? "" : tierId };
      const newWorkKPITotal = workKPIRules.reduce((sum, rule) => {
        const selId = next[rule.id];
        if (!selId) return sum;
        const tier = rule.tiers.find((t) => t.id === selId);
        return sum + (tier?.amount ?? 0);
      }, 0);
      const existing = employeeId && month ? getPaySlip(employeeId, month) : null;
      if (existing) {
        writeToPaySlip({
          ...calcPaySlipUpdate(existing, allowanceTotal, newWorkKPITotal, revenueKPITotal),
          workKPISelections: next,
        });
      }
      return next;
    });
  };

  // ── 更新业绩绩效实际金额（即时写入，修复：不再延迟到返回时同步） ──
  const updateRevenueActual = (ruleId: string, value: string) => {
    setRevenueActuals((prev) => {
      const next = { ...prev, [ruleId]: value };
      const newRevenueKPITotal = revenueKPIRules.reduce((sum, rule) => {
        if (!rule.enabled) return sum;
        const actual = next[rule.id] ? Number(next[rule.id]) : 0;
        return sum + calcRevenueKPIBonus(rule, actual);
      }, 0);
      const existing = employeeId && month ? getPaySlip(employeeId, month) : null;
      if (existing) {
        // 将字符串 map 转为数字 map 再持久化
        const numericActuals: Record<string, number> = {};
        Object.entries(next).forEach(([k, v]) => { numericActuals[k] = Number(v) || 0; });
        writeToPaySlip({
          ...calcPaySlipUpdate(existing, allowanceTotal, workKPITotal, newRevenueKPITotal),
          revenueActuals: numericActuals,
        });
      }
      return next;
    });
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{employee.realName} · 绩效补贴</Text>
        <TouchableOpacity
          onPress={() => { tap(); router.push({ pathname: "/labor-employee-form", params: { id: employee.id } } as any); }}
          style={{ padding: 8 }}>
          <IconSymbol name="gearshape" size={20} color={colors.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 顶部总结卡：4格（绩效补贴 / 补贴 / 工作绩效 / 业绩绩效） */}
        <View style={[S.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={S.summaryRow}>
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>绩效补贴</Text>
              <Text style={[S.summaryValue, { color: colors.foreground }]}>¥{grandTotal.toFixed(0)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>补贴</Text>
              <Text style={[S.summaryValue, { color: colors.primary }]}>¥{allowanceTotal.toFixed(0)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>工作绩效</Text>
              <Text style={[S.summaryValue, { color: colors.success }]}>¥{workKPITotal.toFixed(0)}</Text>
            </View>
            <View style={[S.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={S.summaryItem}>
              <Text style={[S.summaryLabel, { color: colors.muted }]}>业绩绩效</Text>
              <Text style={[S.summaryValue, { color: colors.success }]}>¥{revenueKPITotal.toFixed(0)}</Text>
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
                    onChangeText={(v) => updateRevenueActual(rule.id, v)}
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
  summaryValue: { fontSize: 16, fontWeight: "700" },
  summaryDivider: { width: 1, height: 30 },
  sectionCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: "600", marginBottom: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1 },
  checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  tierChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, alignItems: "center", gap: 2 },
  amountInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, fontSize: 14, width: 120, textAlign: "center" },
});
