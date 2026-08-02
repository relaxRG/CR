/**
 * 员工档案列表页
 */
import React, { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore } from "@/lib/labor/store";
import { DEPT_LABELS, DEPT_COLORS, EmployeeDept } from "@/lib/labor/types";

const DEPT_FILTERS: { key: EmployeeDept | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "front", label: "前厅" },
  { key: "kitchen", label: "后厨" },
  { key: "parttime", label: "兼职" },
  { key: "other", label: "其他" },
];

export default function LaborEmployeesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { employees, deleteEmployee } = useEmployeeStore();
  const [deptFilter, setDeptFilter] = useState<EmployeeDept | "all">("all");

  const filtered = useMemo(() => {
    return employees
      .filter((e) => deptFilter === "all" || e.dept === deptFilter)
      .sort((a, b) => {
        if (a.dept !== b.dept) return a.dept.localeCompare(b.dept);
        if (a.type !== b.type) return a.type === "fulltime" ? -1 : 1;
        return a.code.localeCompare(b.code);
      });
  }, [employees, deptFilter]);

  const handleDelete = (id: string, name: string) => {
    Alert.alert("删除员工", `确认删除「${name}」的档案？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => deleteEmployee(id) },
    ]);
  };

  return (
    <ScreenContainer>
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>员工档案</Text>
        <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* 部门筛选 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {DEPT_FILTERS.map((f) => (
          <TouchableOpacity key={f.key} onPress={() => { tap(); setDeptFilter(f.key); }}
            style={[S.filterChip, {
              backgroundColor: deptFilter === f.key
                ? (f.key === "all" ? colors.primary : DEPT_COLORS[f.key as EmployeeDept])
                : colors.surface,
              borderColor: deptFilter === f.key
                ? (f.key === "all" ? colors.primary : DEPT_COLORS[f.key as EmployeeDept])
                : colors.border,
            }]}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: deptFilter === f.key ? "#fff" : colors.muted }}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {filtered.map((emp) => {
          const deptColor = DEPT_COLORS[emp.dept];
          return (
            <TouchableOpacity key={emp.id}
              onPress={() => { tap(); router.push({ pathname: "/labor-employee-form", params: { id: emp.id } } as any); }}
              style={[S.empCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[S.empAvatar, { backgroundColor: deptColor + "22" }]}>
                <Text style={{ fontSize: 16, fontWeight: "800", color: deptColor }}>{emp.code.slice(0, 2)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{emp.code}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>{emp.realName}</Text>
                  <View style={[S.deptTag, { backgroundColor: deptColor + "22" }]}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: deptColor }}>{DEPT_LABELS[emp.dept]}</Text>
                  </View>
                  {!emp.active && (
                    <View style={[S.deptTag, { backgroundColor: colors.error + "22" }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.error }}>离职</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>
                  {emp.type === "fulltime"
                    ? `底薪¥${emp.baseSalary} · ${emp.stdHoursPerDay}h/天 · 休${emp.restDaysPerMonth}天/月 · 时薪¥${emp.hourlyRate}`
                    : `兼职 · 时薪¥${emp.hourlyRate}/h`}
                </Text>
                {emp.phone ? (
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{emp.phone}</Text>
                ) : null}
                {emp.notes ? (
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>{emp.notes}</Text>
                ) : null}
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={{ fontSize: 11, color: deptColor, fontWeight: "600" }}>
                  加班×{emp.overtimeHourlyRate}/h
                </Text>
                {emp.holidayMultiplier > 1 && (
                  <Text style={{ fontSize: 11, color: colors.warning }}>节假日{emp.holidayMultiplier}x</Text>
                )}
                <Pressable onPress={() => handleDelete(emp.id, emp.code)} style={{ padding: 4 }}>
                  <IconSymbol name="trash" size={14} color={colors.error} />
                </Pressable>
              </View>
            </TouchableOpacity>
          );
        })}

        {filtered.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <IconSymbol name="person.2.fill" size={48} color={colors.border} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>暂无员工</Text>
            <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
              style={[S.addBtn, { backgroundColor: colors.primary }]}>
              <IconSymbol name="plus" size={16} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>添加员工</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  empCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10, gap: 12 },
  empAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  deptTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 16 },
});
