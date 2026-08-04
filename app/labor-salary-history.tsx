/**
 * 历史薪资查询页
 * 按员工查看近12月薪资记录，包含公司承担成本分析
 */
import React, { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useEmployeeStore, usePaySlipStore, useAttendanceStore } from "@/lib/labor/store";
import { DEPT_COLORS, monthLabel } from "@/lib/labor/types";

export default function LaborSalaryHistoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const { employeeId } = useLocalSearchParams<{ employeeId?: string }>();
  const { employees } = useEmployeeStore();
  const { paySlips } = usePaySlipStore();
  const { records: attendances } = useAttendanceStore();

  const employee = employees.find((e) => e.id === employeeId);
  const deptColor = employee ? DEPT_COLORS[employee.dept] : colors.primary;

  // 近12个月
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
  }, []);

  const empSlips = useMemo(() =>
    paySlips.filter((s) => s.employeeId === employeeId),
    [paySlips, employeeId]
  );
  const empAtts = useMemo(() =>
    attendances.filter((a) => a.employeeId === employeeId),
    [attendances, employeeId]
  );

  // 年度汇总
  const yearSummary = useMemo(() => {
    const year = new Date().getFullYear().toString();
    const yearSlips = empSlips.filter((s) => s.month.startsWith(year));
    return {
      totalGross: yearSlips.reduce((s, p) => s + (p.grossSalary ?? 0), 0),
      totalFinal: yearSlips.reduce((s, p) => s + p.finalSalary, 0),
      totalTax: yearSlips.reduce((s, p) => s + (p.incomeTax ?? 0), 0),
      totalSI: yearSlips.reduce((s, p) => s + (p.socialInsuranceDeduction ?? 0) + (p.housingFundDeduction ?? 0), 0),
      totalEmployerCost: yearSlips.reduce((s, p) => s + (p.totalEmployerCost ?? 0), 0),
      totalAdvance: yearSlips.reduce((s, p) => s + (p.advanceAmount ?? 0), 0),
      count: yearSlips.length,
    };
  }, [empSlips]);

  const [viewMode, setViewMode] = useState<"employee" | "employer">("employee");
  const insets = useSafeAreaInsets();

  if (!employee) {
    return (
      <ScreenContainer>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.muted }}>未找到员工</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>{employee.code} 薪资历史</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>{employee.realName}</Text>
        </View>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 + insets.bottom }}>
        {/* 年度汇总卡片 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: deptColor + "44", borderLeftWidth: 3, borderLeftColor: deptColor }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>{new Date().getFullYear()}年度汇总</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            {/* 视角切换 */}
            <TouchableOpacity onPress={() => setViewMode("employee")}
              style={{ flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: viewMode === "employee" ? colors.primary : colors.background, alignItems: "center" }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: viewMode === "employee" ? "#fff" : colors.muted }}>员工视角</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setViewMode("employer")}
              style={{ flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: viewMode === "employer" ? colors.warning : colors.background, alignItems: "center" }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: viewMode === "employer" ? "#fff" : colors.muted }}>公司视角</Text>
            </TouchableOpacity>
          </View>

          {viewMode === "employee" ? (
            <View style={{ gap: 6, marginTop: 10 }}>
              {[
                { label: "年度应发合计", value: `¥${yearSummary.totalGross.toFixed(0)}`, color: colors.foreground },
                { label: "社保/公积金代扣", value: yearSummary.totalSI > 0 ? `-¥${yearSummary.totalSI.toFixed(0)}` : "—", color: colors.error },
                { label: "个人所得税", value: yearSummary.totalTax > 0 ? `-¥${yearSummary.totalTax.toFixed(0)}` : "—", color: colors.error },
                { label: "预支扣除", value: yearSummary.totalAdvance > 0 ? `-¥${yearSummary.totalAdvance.toFixed(0)}` : "—", color: colors.warning },
                { label: "年度实发合计", value: `¥${yearSummary.totalFinal.toFixed(0)}`, color: deptColor, bold: true },
              ].map(({ label, value, color, bold }) => (
                <View key={label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
                  <Text style={{ fontSize: 12, fontWeight: bold ? "700" : "600", color }}>{value}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ gap: 6, marginTop: 10 }}>
              {[
                { label: "年度应发合计", value: `¥${yearSummary.totalGross.toFixed(0)}`, color: colors.foreground },
                { label: "公司社保/公积金", value: yearSummary.totalEmployerCost > 0 ? `+¥${(yearSummary.totalEmployerCost - yearSummary.totalGross).toFixed(0)}` : "—", color: colors.warning },
                { label: "公司总人力成本", value: yearSummary.totalEmployerCost > 0 ? `¥${yearSummary.totalEmployerCost.toFixed(0)}` : `¥${yearSummary.totalGross.toFixed(0)}`, color: colors.warning, bold: true },
                { label: "月均人力成本", value: yearSummary.count > 0 ? `¥${(yearSummary.totalEmployerCost / yearSummary.count || yearSummary.totalGross / yearSummary.count).toFixed(0)}/月` : "—", color: colors.muted },
              ].map(({ label, value, color, bold }) => (
                <View key={label} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
                  <Text style={{ fontSize: 12, fontWeight: bold ? "700" : "600", color }}>{value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 近12月柱状图 */}
        <View style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>近12月薪资走势</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 80, marginTop: 10 }}>
            {months.slice().reverse().map((mo) => {
              const slip = empSlips.find((s) => s.month === mo);
              const val = viewMode === "employer" ? (slip?.totalEmployerCost ?? slip?.grossSalary ?? 0) : (slip?.finalSalary ?? 0);
              const maxVal = Math.max(...months.map((m) => {
                const s = empSlips.find((sl) => sl.month === m);
                return viewMode === "employer" ? (s?.totalEmployerCost ?? s?.grossSalary ?? 0) : (s?.finalSalary ?? 0);
              }), 1);
              const barH = Math.max(4, (val / maxVal) * 72);
              const isCurrent = mo === months[0];
              const barColor = viewMode === "employer" ? colors.warning : deptColor;
              return (
                <View key={mo} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                  <View style={{ width: "100%", height: barH, borderRadius: 3, backgroundColor: isCurrent ? barColor : barColor + "55" }} />
                  <Text style={{ fontSize: 7, color: isCurrent ? barColor : colors.muted, fontWeight: isCurrent ? "700" : "400" }}>
                    {mo.slice(5)}月
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* 月度明细列表 */}
        <Text style={[S.sectionTitle, { color: colors.muted }]}>月度明细</Text>
        {months.map((mo) => {
          const slip = empSlips.find((s) => s.month === mo);
          const att = empAtts.find((a) => a.month === mo);
          if (!slip && !att) return (
            <View key={mo} style={[S.monthRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }}>{monthLabel(mo)}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>未录入</Text>
            </View>
          );
          return (
            <TouchableOpacity key={mo}
              onPress={() => router.push({ pathname: "/labor-attendance", params: { employeeId, month: mo } } as any)}
              style={[S.monthRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{monthLabel(mo)}</Text>
                {att && (
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    出勤{att.attendanceDays}天 · 加班{att.overtimeHours.toFixed(1)}h
                  </Text>
                )}
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                {slip ? (
                  <>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>¥{slip.finalSalary.toFixed(0)}</Text>
                    {(slip.totalEmployerCost ?? 0) > 0 && (
                      <Text style={{ fontSize: 10, color: colors.warning }}>公司¥{(slip.totalEmployerCost ?? 0).toFixed(0)}</Text>
                    )}
                    {(slip.incomeTax ?? 0) > 0 && (
                      <Text style={{ fontSize: 10, color: colors.muted }}>税¥{(slip.incomeTax ?? 0).toFixed(0)}</Text>
                    )}
                  </>
                ) : (
                  <Text style={{ fontSize: 12, color: colors.muted }}>未生成薪资单</Text>
                )}
              </View>
              <IconSymbol name="chevron.right" size={14} color={colors.muted} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "700" },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sectionTitle: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  monthRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1 },
});
