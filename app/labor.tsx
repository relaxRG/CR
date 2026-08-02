/**
 * 人工成本管理主入口页
 * 功能导航：员工档案 / 排班表 / 考勤工资 / 薪资汇总
 */
import React, { useMemo } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, useAttendanceStore, usePaySlipStore } from "@/lib/labor/store";
import { DEPT_LABELS, DEPT_COLORS, monthLabel } from "@/lib/labor/types";

export default function LaborScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { employees } = useEmployeeStore();
  const { records: attendances } = useAttendanceStore();
  const { paySlips } = usePaySlipStore();

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);

  // 本月薪资汇总
  const monthPaySlips = useMemo(() => paySlips.filter((s) => s.month === currentMonth), [paySlips, currentMonth]);
  const totalFinalSalary = useMemo(() => monthPaySlips.reduce((s, p) => s + p.finalSalary, 0), [monthPaySlips]);

  // 部门人数
  const deptCounts = useMemo(() => {
    const map: Record<string, number> = {};
    activeEmployees.forEach((e) => { map[e.dept] = (map[e.dept] ?? 0) + 1; });
    return map;
  }, [activeEmployees]);

  const navCards = [
    {
      icon: "person.2.fill" as const,
      title: "员工档案",
      desc: `${activeEmployees.length} 名在职员工`,
      color: colors.primary,
      onPress: () => router.push("/labor-employees" as any),
    },
    {
      icon: "calendar" as const,
      title: "排班表",
      desc: "前厅 / 后厨 · 午/晚 · 时长",
      color: "#5856D6",
      onPress: () => router.push("/labor-schedule" as any),
    },
    {
      icon: "clock.fill" as const,
      title: "考勤工资",
      desc: `${monthLabel(currentMonth)} · ${attendances.filter((a) => a.month === currentMonth).length} 人已填写`,
      color: DEPT_COLORS.front,
      onPress: () => router.push("/labor-attendance" as any),
    },
    {
      icon: "banknote.fill" as const,
      title: "最终薪资",
      desc: totalFinalSalary > 0 ? `本月合计 ¥${totalFinalSalary.toFixed(0)}` : "点击填写薪资单",
      color: colors.success,
      onPress: () => { router.push("/labor-attendance" as any); },
    },
    {
      icon: "creditcard.fill" as const,
      title: "薪资预支",
      desc: "长期兼职预支记录 · 自动扣除",
      color: "#5856D6",
      onPress: () => router.push("/labor-advances" as any),
    },
  ];

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>人工成本</Text>
        <Pressable onPress={() => router.push("/labor-employee-form" as any)}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 本月概览 */}
        <View style={[S.overviewCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
          <Text style={[S.overviewTitle, { color: colors.primary }]}>{monthLabel(currentMonth)} 人工成本概览</Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>在职员工</Text>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>{activeEmployees.length}人</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>本月薪资合计</Text>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.primary }}>
                {totalFinalSalary > 0 ? `¥${totalFinalSalary.toFixed(0)}` : "—"}
              </Text>
            </View>
          </View>
          {/* 部门分布 */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {Object.entries(deptCounts).map(([dept, count]) => (
              <View key={dept} style={[S.deptTag, { backgroundColor: DEPT_COLORS[dept as keyof typeof DEPT_COLORS] + "22" }]}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: DEPT_COLORS[dept as keyof typeof DEPT_COLORS] }} />
                <Text style={{ fontSize: 11, color: DEPT_COLORS[dept as keyof typeof DEPT_COLORS], fontWeight: "600" }}>
                  {DEPT_LABELS[dept as keyof typeof DEPT_LABELS]} {count}人
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* 功能导航卡片 */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {navCards.map((card, i) => (
            <TouchableOpacity key={i} onPress={() => { tap(); card.onPress(); }}
              style={[S.navCard, { backgroundColor: colors.surface, borderColor: colors.border, width: "47%" }]}>
              <View style={[S.navIconWrap, { backgroundColor: card.color + "15" }]}>
                <IconSymbol name={card.icon} size={24} color={card.color} />
              </View>
              <Text style={[S.navCardTitle, { color: colors.foreground }]}>{card.title}</Text>
              <Text style={[S.navCardDesc, { color: colors.muted }]} numberOfLines={2}>{card.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 员工快速列表 */}
        {activeEmployees.length > 0 && (
          <View style={[S.empListCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={[S.sectionTitle, { color: colors.foreground }]}>员工档案</Text>
              <Pressable onPress={() => { tap(); router.push("/labor-employees" as any); }}>
                <Text style={{ fontSize: 13, color: colors.primary }}>管理 →</Text>
              </Pressable>
            </View>
            {activeEmployees.slice(0, 8).map((emp) => {
              const slip = getPaySlipForEmp(paySlips, emp.id, currentMonth);
              const att = attendances.find((a) => a.employeeId === emp.id && a.month === currentMonth);
              const deptColor = DEPT_COLORS[emp.dept];
              return (
                <TouchableOpacity key={emp.id}
                  onPress={() => { tap(); router.push({ pathname: "/labor-employee-form", params: { id: emp.id } } as any); }}
                  style={[S.empRow, { borderBottomColor: colors.border }]}>
                  <View style={[S.empAvatar, { backgroundColor: deptColor + "22" }]}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: deptColor }}>{emp.code.slice(0, 2)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{emp.code} · {emp.realName}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {DEPT_LABELS[emp.dept]} · {emp.type === "fulltime" ? `底薪¥${emp.baseSalary}` : `时薪¥${emp.hourlyRate}/h`}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    {slip ? (
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>¥{slip.finalSalary.toFixed(0)}</Text>
                    ) : att ? (
                      <Text style={{ fontSize: 12, color: deptColor }}>¥{att.attendanceSalary.toFixed(0)}</Text>
                    ) : (
                      <Text style={{ fontSize: 11, color: colors.border }}>未填写</Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* 空状态 */}
        {activeEmployees.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <IconSymbol name="person.2.fill" size={56} color={colors.border} />
            <Text style={{ fontSize: 18, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>开始添加员工档案</Text>
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 8 }}>
              设置底薪、时薪、加班倍率等参数，系统自动计算考勤工资
            </Text>
            <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
              style={[S.addBtn, { backgroundColor: colors.primary }]}>
              <IconSymbol name="plus" size={16} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>添加第一位员工</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function getPaySlipForEmp(paySlips: any[], empId: string, month: string) {
  return paySlips.find((s: any) => s.employeeId === empId && s.month === month) ?? null;
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  overviewCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 16 },
  overviewTitle: { fontSize: 14, fontWeight: "700" },
  deptTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  navCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  navIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  navCardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
  navCardDesc: { fontSize: 12 },
  empListCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 12 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  empRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  empAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 16 },
});
