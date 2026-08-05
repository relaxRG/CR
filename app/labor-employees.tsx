/**
 * 员工档案列表页
 * v2：删除重复信息、按部门分组展示、支持长按拖拽排序
 */
import React, { useMemo, useRef, useState } from "react";
import {
  Alert, Animated, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore } from "@/lib/labor/store";
import { DEPT_LABELS, DEPT_COLORS, EmployeeDept, Employee } from "@/lib/labor/types";

const DEPT_FILTERS: { key: EmployeeDept | "all"; label: string }[] = [
  { key: "all",      label: "全部" },
  { key: "front",    label: "前厅" },
  { key: "kitchen",  label: "后厨" },
  { key: "parttime", label: "兼职" },
  { key: "other",    label: "其他" },
];

const DEPT_ORDER: EmployeeDept[] = ["front", "kitchen", "parttime", "other"];

// ── 单张员工卡片 ──────────────────────────────────────────────────────────────
function EmpCard({
  emp, colors, onPress, onDelete, onDragStart, isDragging,
}: {
  emp: Employee;
  colors: any;
  onPress: () => void;
  onDelete: () => void;
  onDragStart?: () => void;
  isDragging?: boolean;
}) {
  const deptColor = DEPT_COLORS[emp.dept];
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        S.empCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
        isDragging && { opacity: 0.5, transform: [{ scale: 0.97 }] },
      ]}>
      {/* 左侧头像 */}
      <View style={[S.empAvatar, { backgroundColor: deptColor + "22" }]}>
        <Text style={{ fontSize: 16, fontWeight: "800", color: deptColor }}>
          {emp.code.slice(0, 2)}
        </Text>
      </View>

      {/* 主体信息 */}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{emp.code}</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>{emp.realName}</Text>
          {!emp.active && (
            <View style={[S.tag, { backgroundColor: colors.error + "22" }]}>
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

      {/* 右侧操作区（只保留删除按钮 + 拖拽把手） */}
      <View style={{ alignItems: "center", gap: 8 }}>
        {onDragStart && (
          <TouchableOpacity onLongPress={onDragStart} style={{ padding: 4 }}>
            <Text style={{ fontSize: 16, color: colors.muted }}>⠿</Text>
          </TouchableOpacity>
        )}
        <Pressable onPress={onDelete} style={{ padding: 4 }}>
          <IconSymbol name="trash" size={14} color={colors.error} />
        </Pressable>
      </View>
    </TouchableOpacity>
  );
}

// ── 部门分组区块 ──────────────────────────────────────────────────────────────
function DeptSection({
  dept, employees, colors, onPress, onDelete, onReorder,
}: {
  dept: EmployeeDept;
  employees: Employee[];
  colors: any;
  onPress: (emp: Employee) => void;
  onDelete: (emp: Employee) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const deptColor = DEPT_COLORS[dept];
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<Employee[]>(employees);

  // 同步外部 employees 变化
  React.useEffect(() => {
    setLocalOrder(employees);
  }, [employees]);

  const handleDragStart = (id: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDraggingId(id);
  };

  const handleDragEnd = (fromId: string, toId: string) => {
    if (fromId === toId) { setDraggingId(null); return; }
    const from = localOrder.findIndex((e) => e.id === fromId);
    const to   = localOrder.findIndex((e) => e.id === toId);
    if (from < 0 || to < 0) { setDraggingId(null); return; }
    const next = [...localOrder];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setLocalOrder(next);
    setDraggingId(null);
    onReorder(next.map((e) => e.id));
  };

  if (employees.length === 0) return null;

  return (
    <View style={{ marginBottom: 4 }}>
      {/* 部门标题行 */}
      <View style={[S.deptHeader, { borderLeftColor: deptColor }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: deptColor }}>{DEPT_LABELS[dept]}</Text>
          <View style={[S.tag, { backgroundColor: deptColor + "22" }]}>
            <Text style={{ fontSize: 10, fontWeight: "600", color: deptColor }}>{employees.length} 人</Text>
          </View>
        </View>
        <Text style={{ fontSize: 10, color: colors.muted }}>长按 ⠿ 拖拽排序</Text>
      </View>
      {/* 员工卡片列表 */}
      {localOrder.map((emp) => (
        <EmpCard
          key={emp.id}
          emp={emp}
          colors={colors}
          onPress={() => onPress(emp)}
          onDelete={() => onDelete(emp)}
          onDragStart={() => handleDragStart(emp.id)}
          isDragging={draggingId === emp.id}
        />
      ))}
    </View>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────────
export default function LaborEmployeesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { employees, deleteEmployee, reorderEmployees } = useEmployeeStore();
  const [deptFilter, setDeptFilter] = useState<EmployeeDept | "all">("all");

  // 按部门分组 + sortOrder 排序
  const grouped = useMemo(() => {
    const sorted = [...employees].sort((a, b) => {
      const orderA = a.sortOrder ?? 999;
      const orderB = b.sortOrder ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.code.localeCompare(b.code);
    });
    return DEPT_ORDER.reduce<Record<EmployeeDept, Employee[]>>((acc, dept) => {
      acc[dept] = sorted.filter((e) => e.dept === dept);
      return acc;
    }, { front: [], kitchen: [], parttime: [], other: [] });
  }, [employees]);

  // 当前筛选下的员工（单部门 Tab 时扁平显示）
  const filtered = useMemo(() => {
    if (deptFilter === "all") return null; // 全部时用 grouped
    return [...employees]
      .filter((e) => e.dept === deptFilter)
      .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || a.code.localeCompare(b.code));
  }, [employees, deptFilter]);

  const handleDelete = (emp: Employee) => {
    Alert.alert("删除员工", `确认删除「${emp.code}」的档案？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => deleteEmployee(emp.id) },
    ]);
  };

  const handlePress = (emp: Employee) => {
    tap();
    router.push({ pathname: "/labor-employee-form", params: { id: emp.id } } as any);
  };

  const totalCount = employees.length;

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>员工档案</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>{totalCount} 人</Text>
        </View>
        <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* 部门筛选 Tab */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: "center" }}>
        {DEPT_FILTERS.map((f) => {
          const count = f.key === "all" ? totalCount : grouped[f.key as EmployeeDept]?.length ?? 0;
          const isActive = deptFilter === f.key;
          const chipColor = f.key === "all" ? colors.primary : DEPT_COLORS[f.key as EmployeeDept];
          return (
            <TouchableOpacity key={f.key} onPress={() => { tap(); setDeptFilter(f.key); }}
              style={[S.filterChip, {
                backgroundColor: isActive ? chipColor : colors.surface,
                borderColor: isActive ? chipColor : colors.border,
              }]}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: isActive ? "#fff" : colors.muted }}>
                {f.label}
              </Text>
              {count > 0 && (
                <View style={{ backgroundColor: isActive ? "rgba(255,255,255,0.3)" : colors.border + "66", borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: isActive ? "#fff" : colors.muted }}>{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 列表主体 */}
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}>

        {/* 全部 Tab：按部门分组显示 */}
        {deptFilter === "all" && (
          <>
            {DEPT_ORDER.map((dept) =>
              grouped[dept].length > 0 ? (
                <DeptSection
                  key={dept}
                  dept={dept}
                  employees={grouped[dept]}
                  colors={colors}
                  onPress={handlePress}
                  onDelete={handleDelete}
                  onReorder={reorderEmployees}
                />
              ) : null
            )}
          </>
        )}

        {/* 单部门 Tab：扁平列表 + 拖拽排序 */}
        {deptFilter !== "all" && filtered && (
          <DeptSection
            dept={deptFilter as EmployeeDept}
            employees={filtered}
            colors={colors}
            onPress={handlePress}
            onDelete={handleDelete}
            onReorder={reorderEmployees}
          />
        )}

        {/* 空状态 */}
        {employees.length === 0 && (
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
  navbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navTitle: { fontSize: 17, fontWeight: "600" },
  filterChip: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1,
  },
  deptHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4,
    borderLeftWidth: 3, borderLeftColor: "#ccc",
  },
  empCard: {
    flexDirection: "row", alignItems: "flex-start",
    borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8, gap: 10,
  },
  empAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 16,
  },
});
