/**
 * 员工排序页面
 * - Section 1：分组排序（前厅/后厨/公司/临时兼职的显示顺序）
 * - Section 2：员工排序（每个分组内员工的显示顺序）
 * - 使用 ↑ ↓ 按钮上下移动，不使用拖拽
 * - 点击「保存」一次性写入 Store，联动所有员工卡片的显示顺序
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  useEmployeeStore,
  useDeptOrderStore,
  DEFAULT_DEPT_ORDER,
} from "@/lib/labor/store";
import {
  EmployeeDept,
  DEPT_LABELS,
  DEPT_COLORS,
  Employee,
} from "@/lib/labor/types";

const tap = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

export default function LaborEmployeeSortPage() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { employees, reorderEmployees } = useEmployeeStore();
  const { deptOrder, saveDeptOrder } = useDeptOrderStore();

  const activeEmployees = useMemo(
    () => employees.filter((e) => e.active && !e.archived),
    [employees]
  );

  // ── 本地 State（暂存，点击保存后才写入 Store）──
  const [localDeptOrder, setLocalDeptOrder] = useState<EmployeeDept[]>(() => {
    // 确保所有部门都在列表中（防止旧数据缺失）
    const existing = new Set(deptOrder);
    const missing = DEFAULT_DEPT_ORDER.filter((d) => !existing.has(d));
    return [...deptOrder, ...missing];
  });

  // 员工排序：按分组分别维护本地顺序
  const [localEmpOrder, setLocalEmpOrder] = useState<Partial<Record<EmployeeDept, Employee[]>>>(() => {
    const result: Partial<Record<EmployeeDept, Employee[]>> = {};
    for (const dept of DEFAULT_DEPT_ORDER) {
      result[dept] = [...activeEmployees]
        .filter((e) => e.dept === dept)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.code.localeCompare(b.code));
    }
    return result;
  });

  const isDirty = useMemo(() => {
    // 检查分组顺序是否有变化
    if (localDeptOrder.join(",") !== deptOrder.join(",")) return true;
    // 检查员工顺序是否有变化
    for (const dept of DEFAULT_DEPT_ORDER) {
      const original = [...activeEmployees]
        .filter((e: Employee) => e.dept === dept)
        .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.code.localeCompare(b.code));
      const local = localEmpOrder[dept] ?? [];
      if (original.map((e) => e.id).join(",") !== local.map((e) => e.id).join(",")) return true;
    }
    return false;
  }, [localDeptOrder, deptOrder, localEmpOrder, activeEmployees]);

  // ── 分组排序操作 ──
  const moveDept = useCallback((index: number, direction: "up" | "down") => {
    tap();
    setLocalDeptOrder((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }, []);

  // ── 员工排序操作 ──
  const moveEmployee = useCallback((dept: EmployeeDept, index: number, direction: "up" | "down") => {
    tap();
    setLocalEmpOrder((prev: Partial<Record<EmployeeDept, Employee[]>>) => {
      const list = [...(prev[dept] ?? [])];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= list.length) return prev;
      [list[index], list[targetIndex]] = [list[targetIndex], list[index]];
      return { ...prev, [dept]: list };
    });
  }, []);

  // ── 保存 ──
  const handleSave = useCallback(() => {
    tap();
    // 1. 保存分组顺序
    saveDeptOrder(localDeptOrder);
    // 2. 保存每个分组内的员工顺序
    for (const dept of DEFAULT_DEPT_ORDER) {
      const orderedIds = (localEmpOrder[dept] ?? [] as Employee[]).map((e) => e.id);
      if (orderedIds.length > 0) {
        reorderEmployees(orderedIds);
      }
    }
    router.back();
  }, [saveDeptOrder, localDeptOrder, localEmpOrder, reorderEmployees, router]);

  // ── 取消 ──
  const handleCancel = useCallback(() => {
    tap();
    if (isDirty) {
      Alert.alert("放弃更改", "确定要放弃所有排序更改吗？", [
        { text: "继续编辑", style: "cancel" },
        { text: "放弃", style: "destructive", onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }, [isDirty, router]);

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleCancel} style={S.headerBtn}>
          <Text style={{ fontSize: 16, color: colors.primary }}>取消</Text>
        </TouchableOpacity>
        <Text style={[S.headerTitle, { color: colors.foreground }]}>员工排序</Text>
        <TouchableOpacity
          onPress={handleSave}
          style={[S.headerBtn, { alignItems: "flex-end" }]}
        >
          <Text style={{ fontSize: 16, fontWeight: "700", color: isDirty ? colors.primary : colors.muted }}>
            保存
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 16, paddingTop: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Section 1：分组排序 */}
        <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={S.sectionHeader}>
            <Text style={[S.sectionTitle, { color: colors.foreground }]}>分组顺序</Text>
            <Text style={[S.sectionHint, { color: colors.muted }]}>调整各部门分组的显示顺序</Text>
          </View>
          {localDeptOrder.map((dept, index) => {
            const deptColor = DEPT_COLORS[dept];
            return (
              <View key={dept} style={[S.row, { borderTopColor: colors.border }]}>
                <View style={[S.deptDot, { backgroundColor: deptColor }]} />
                <Text style={[S.rowLabel, { color: colors.foreground }]}>{DEPT_LABELS[dept]}</Text>
                <View style={S.arrowGroup}>
                  <TouchableOpacity
                    onPress={() => moveDept(index, "up")}
                    disabled={index === 0}
                    style={[S.arrowBtn, { opacity: index === 0 ? 0.25 : 1 }]}
                  >
                    <IconSymbol name="chevron.up" size={16} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveDept(index, "down")}
                    disabled={index === localDeptOrder.length - 1}
                    style={[S.arrowBtn, { opacity: index === localDeptOrder.length - 1 ? 0.25 : 1 }]}
                  >
                    <IconSymbol name="chevron.down" size={16} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* Section 2：员工排序（按分组展示） */}
        {localDeptOrder.map((dept) => {
          const empList = localEmpOrder[dept] ?? [];
          if (empList.length === 0) return null;
          const deptColor = DEPT_COLORS[dept];
          return (
            <View key={dept} style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={S.sectionHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[S.deptDot, { backgroundColor: deptColor }]} />
                  <Text style={[S.sectionTitle, { color: deptColor }]}>{DEPT_LABELS[dept]}</Text>
                  <View style={[S.tag, { backgroundColor: deptColor + "22" }]}>
                    <Text style={{ fontSize: 10, fontWeight: "600", color: deptColor }}>{empList.length} 人</Text>
                  </View>
                </View>
                <Text style={[S.sectionHint, { color: colors.muted }]}>调整该分组内员工的显示顺序</Text>
              </View>
              {empList.map((emp, index) => (
                <View key={emp.id} style={[S.row, { borderTopColor: colors.border }]}>
                  <View style={[S.empAvatar, { backgroundColor: deptColor + "22" }]}>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: deptColor }}>
                      {emp.code}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.rowLabel, { color: colors.foreground }]}>{emp.realName || emp.code}</Text>
                  </View>
                  <View style={S.arrowGroup}>
                    <TouchableOpacity
                      onPress={() => moveEmployee(dept, index, "up")}
                      disabled={index === 0}
                      style={[S.arrowBtn, { opacity: index === 0 ? 0.25 : 1 }]}
                    >
                      <IconSymbol name="chevron.up" size={16} color={colors.primary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveEmployee(dept, index, "down")}
                      disabled={index === empList.length - 1}
                      style={[S.arrowBtn, { opacity: index === empList.length - 1 ? 0.25 : 1 }]}
                    >
                      <IconSymbol name="chevron.down" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          );
        })}

        {/* 说明文字 */}
        <Text style={[S.hint, { color: colors.muted }]}>
          排序设置将同步到排班表、薪资统计、考勤概况等所有员工列表。
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    minWidth: 60,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  section: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    overflow: "hidden",
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  sectionHint: {
    fontSize: 11,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deptDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  arrowGroup: {
    flexDirection: "row",
    gap: 4,
  },
  arrowBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  empAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  hint: {
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 16,
  },
});
