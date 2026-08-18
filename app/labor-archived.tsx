/**
 * 离职归档页面
 * - 显示所有已归档（archived=true）的员工
 * - 支持恢复在职 / 永久删除档案（历史数据保留）
 */
import React, { useMemo } from "react";
import {
  Alert, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, useDeptOrderStore } from "@/lib/labor/store";
import { sortEmployeesByProfileOrder } from "@/lib/labor/employee-profile-order";
import { DEPT_LABELS, DEPT_COLORS, Employee } from "@/lib/labor/types";

export default function LaborArchivedScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { employees, restoreEmployee, deleteEmployee } = useEmployeeStore();
  const { deptOrder } = useDeptOrderStore();

  const archived = useMemo(
    () => sortEmployeesByProfileOrder(employees.filter((e) => e.archived), deptOrder),
    [employees, deptOrder],
  );

  const handleRestore = (emp: Employee) => {
    Alert.alert(
      "恢复在职",
      `将「${emp.code}」恢复为在职员工？\n恢复后将重新出现在员工档案和排班表中。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "恢复在职",
          onPress: () => { tap(); restoreEmployee(emp.id); },
        },
      ]
    );
  };

  const handleDelete = (emp: Employee) => {
    Alert.alert(
      "永久删除员工档案",
      `确认删除「${emp.code}」的档案？\n\n员工档案将被永久删除，但历史排班记录、薪资单、月报数据完整保留，不受影响。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "永久删除",
          style: "destructive",
          onPress: () => deleteEmployee(emp.id),
        },
      ]
    );
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>离职归档</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>{archived.length} 人</Text>
        </View>
        <View style={{ width: 30 }} />
      </View>

      {/* 说明栏 */}
      <View style={{ backgroundColor: "#FF9500" + "15", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#FF9500" + "33" }}>
        <Text style={{ fontSize: 12, color: "#FF9500", fontWeight: "600" }}>
          📦 归档员工不参与排班，历史薪资/排班数据完整保留
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}>
        {archived.length === 0 ? (
          <View style={{ alignItems: "center", padding: 60 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground }}>暂无归档员工</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>
              在员工档案列表左滑卡片可将员工移入归档
            </Text>
          </View>
        ) : (
          archived.map((emp) => {
            const deptColor = DEPT_COLORS[emp.dept];
            const archivedDate = emp.archivedAt
              ? emp.archivedAt.slice(0, 10)
              : "未知";
            return (
              <View
                key={emp.id}
                style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {/* 左侧头像 */}
                <View style={[S.avatar, { backgroundColor: deptColor + "22" }]}>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: deptColor + "88" }}>
                    {emp.code.slice(0, 2)}
                  </Text>
                </View>

                {/* 主体信息 */}
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.muted }}>{emp.code}</Text>
                    <Text style={{ fontSize: 13, color: colors.muted }}>{emp.realName}</Text>
                    <View style={[S.tag, { backgroundColor: deptColor + "22" }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: deptColor + "88" }}>{DEPT_LABELS[emp.dept]}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.muted + "88", marginTop: 3 }}>
                    {emp.type === "fulltime"
                      ? `底薪¥${emp.baseSalary} · 加班时薪¥${emp.overtimeHourlyRate}`
                      : `兼职 · 时薪¥${emp.overtimeHourlyRate}/h`}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#FF9500" + "99", marginTop: 2 }}>
                    归档于 {archivedDate}
                  </Text>
                </View>

                {/* 右侧操作 */}
                <View style={{ gap: 8, alignItems: "flex-end" }}>
                  <TouchableOpacity
                    onPress={() => handleRestore(emp)}
                    style={[S.actionBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "33" }]}>
                    <Text style={{ fontSize: 11, color: colors.primary, fontWeight: "600" }}>恢复在职</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDelete(emp)}
                    style={[S.actionBtn, { backgroundColor: colors.error + "15", borderColor: colors.error + "33" }]}>
                    <Text style={{ fontSize: 11, color: colors.error, fontWeight: "600" }}>删除档案</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 17, fontWeight: "600" },
  card: {
    flexDirection: "row", alignItems: "flex-start",
    borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 10, gap: 10,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  actionBtn: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1,
  },
});
