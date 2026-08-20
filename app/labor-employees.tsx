/**
 * 员工档案列表页 v3
 * - 左滑归档（离职归档）
 * - 右滑删除（永久删除档案，历史数据保留）
 * - 右上角归档入口
 * - 按部门分组 + 长按拖拽排序
 */
import React, { useRef, useState, useMemo } from "react";
import {
  Alert, Animated, Platform, Pressable, PanResponder,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useScrollPreservation } from "@/hooks/use-scroll-preservation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { sortEmployeesByProfileOrder } from "@/lib/labor/employee-profile-order";
import { useEmployeeStore, useDeptOrderStore } from "@/lib/labor/store";
import { DEPT_LABELS, DEPT_COLORS, EmployeeDept, Employee } from "@/lib/labor/types";
import { CHIP_BADGE_LAYOUT, formatCompactCount } from "@/lib/theme/chip-badge-tokens";

const DEPT_FILTERS: { key: EmployeeDept | "all"; label: string }[] = [
  { key: "all",      label: "全部" },
  { key: "front",    label: "前厅" },
  { key: "kitchen",  label: "后厨" },
  { key: "parttime", label: "兼职" },
  { key: "other",    label: "其他" },
];
const SWIPE_THRESHOLD = 60; // 触发操作的滑动距离

// ── 可左右滑动的员工卡片 ──────────────────────────────────────────────────────
function SwipeableEmpCard({
  emp, colors, onPress, onArchive, onDelete, onDragStart, isDragging,
}: {
  emp: Employee;
  colors: any;
  onPress: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDragStart?: () => void;
  isDragging?: boolean;
}) {
  const deptColor = DEPT_COLORS[emp.dept];
  const translateX = useRef(new Animated.Value(0)).current;
  const [, setSwiping] = useState<"left" | "right" | null>(null);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dy) < 20,
      onPanResponderGrant: () => { translateX.setValue(0); },
      onPanResponderMove: (_, g) => {
        translateX.setValue(g.dx);
        setSwiping(g.dx < 0 ? "left" : "right");
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -SWIPE_THRESHOLD) {
          // 左滑：归档
          Animated.spring(translateX, { toValue: -80, useNativeDriver: true }).start();
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setTimeout(() => {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwiping(null);
            onArchive();
          }, 300);
        } else if (g.dx > SWIPE_THRESHOLD) {
          // 右滑：删除确认
          Animated.spring(translateX, { toValue: 80, useNativeDriver: true }).start();
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          setTimeout(() => {
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
            setSwiping(null);
            onDelete();
          }, 300);
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
          setSwiping(null);
        }
      },
    })
  ).current;

  return (
    <View style={{ position: "relative", marginBottom: 8, borderRadius: 14, overflow: "hidden" }}>
      {/* 背景操作层 */}
      <View style={[StyleSheet.absoluteFillObject, { flexDirection: "row" }]}>
        {/* 右侧：归档（左滑显示） */}
        <View style={{ flex: 1, backgroundColor: "#FF9500", alignItems: "flex-end", justifyContent: "center", paddingRight: 20 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 20 }}>📦</Text>
            <Text style={{ fontSize: 11, color: "#fff", fontWeight: "700", marginTop: 2 }}>归档</Text>
          </View>
        </View>
        {/* 左侧：删除（右滑显示） */}
        <View style={{ flex: 1, backgroundColor: colors.error, alignItems: "flex-start", justifyContent: "center", paddingLeft: 20 }}>
          <View style={{ alignItems: "center" }}>
            <Text style={{ fontSize: 20 }}>🗑</Text>
            <Text style={{ fontSize: 11, color: "#fff", fontWeight: "700", marginTop: 2 }}>删除</Text>
          </View>
        </View>
      </View>

      {/* 卡片主体（可滑动） */}
      <Animated.View
        style={{ transform: [{ translateX }], opacity: isDragging ? 0.5 : 1 }}
        {...panResponder.panHandlers}>
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.9}
          style={[S.empCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
                ? `底薪¥${emp.baseSalary} · ${emp.weeklyHoursRules?.length ? `${emp.weeklyHoursRules.length}条工时规则` : "未配置工时"} · 休${emp.restDaysPerMonth}天/月 · 加班时薪¥${emp.overtimeHourlyRate}`
                : `兼职 · 时薪¥${emp.overtimeHourlyRate}/h`}
            </Text>
            {emp.phone ? (
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{emp.phone}</Text>
            ) : null}
            {emp.notes ? (
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>{emp.notes}</Text>
            ) : null}
          </View>

          {/* 右侧：拖拽把手 */}
          {onDragStart && (
            <TouchableOpacity onLongPress={onDragStart} style={{ padding: 8 }}>
              <Text style={{ fontSize: 18, color: colors.muted }}>⠿</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ── 部门分组区块 ──────────────────────────────────────────────────────────────
function DeptSection({
  dept, employees, colors, onPress, onArchive, onDelete,
}: {
  dept: EmployeeDept;
  employees: Employee[];
  colors: any;
  onPress: (emp: Employee) => void;
  onArchive: (emp: Employee) => void;
  onDelete: (emp: Employee) => void;
}) {
  const deptColor = DEPT_COLORS[dept];

  if (employees.length === 0) return null;

  return (
    <View style={{ marginBottom: 4 }}>
      <View style={[S.deptHeader, { borderLeftColor: deptColor }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: deptColor }}>{DEPT_LABELS[dept]}</Text>
          <View style={[S.tag, { backgroundColor: deptColor + "22" }]}>
            <Text style={{ fontSize: 10, fontWeight: "600", color: deptColor }}>{employees.length} 人</Text>
          </View>
        </View>
        <Text style={{ fontSize: 10, color: colors.muted }}>← 左滑归档  右滑删除 →</Text>
      </View>
      {employees.map((emp) => (
        <SwipeableEmpCard
          key={emp.id}
          emp={emp}
          colors={colors}
          onPress={() => onPress(emp)}
          onArchive={() => onArchive(emp)}
          onDelete={() => onDelete(emp)}
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
  const { employees, deleteEmployee, archiveEmployee } = useEmployeeStore();
  const { deptOrder } = useDeptOrderStore();
  const [deptFilter, setDeptFilter] = useState<EmployeeDept | "all">("all");

  // 员工档案排序是所有员工列表的唯一顺序来源。
  const activeEmployees = useMemo(
    () => sortEmployeesByProfileOrder(employees.filter((e) => !e.archived), deptOrder),
    [employees, deptOrder],
  );
  const archivedCount = useMemo(() => employees.filter((e) => e.archived).length, [employees]);

  // 分组仅负责分区；组内顺序继承 activeEmployees 的员工档案排序。
  const grouped = useMemo(() =>
    deptOrder.reduce<Record<EmployeeDept, Employee[]>>((acc, dept) => {
      acc[dept] = activeEmployees.filter((e) => e.dept === dept);
      return acc;
    }, { front: [], kitchen: [], parttime: [], other: [] }),
  [activeEmployees, deptOrder]);

  const filtered = useMemo(() => {
    if (deptFilter === "all") return null;
    return activeEmployees.filter((e) => e.dept === deptFilter);
  }, [activeEmployees, deptFilter]);

  const handleArchive = (emp: Employee) => {
    Alert.alert(
      "归档员工",
      `将「${emp.code}」移入离职归档？\n归档后将从排班表消失，历史数据完整保留。`,
      [
        { text: "取消", style: "cancel" },
        { text: "归档", style: "destructive", onPress: () => archiveEmployee(emp.id) },
      ]
    );
  };

  const handleDelete = (emp: Employee) => {
    Alert.alert(
      "永久删除员工",
      `确认删除「${emp.code}」的档案？\n\n员工档案将被删除，但历史排班记录、薪资单、月报数据完整保留。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "删除档案",
          style: "destructive",
          onPress: () => deleteEmployee(emp.id),
        },
      ]
    );
  };

  const handlePress = (emp: Employee) => {
    tap();
    router.push({ pathname: "/labor-employee-profile", params: { id: emp.id } } as any);
  };

  // 滚动位置保持：从员工详情页返回时恢复滚动位置；deptFilter 切换时重置
  const { listRef: empScrollRef, onScroll: onEmpScroll } = useScrollPreservation<ScrollView>(deptFilter);

  const totalCount = activeEmployees.length;

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>员工档案</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>{totalCount} 人在职</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {/* 排序入口 */}
          <TouchableOpacity
            onPress={() => { tap(); router.push("/labor-employee-sort" as any); }}
            style={{ padding: 4 }}>
            <IconSymbol name="arrow.up.arrow.down" size={20} color={colors.muted} />
          </TouchableOpacity>
          {/* 归档入口 */}
          <TouchableOpacity
            onPress={() => { tap(); router.push("/labor-archived" as any); }}
            style={{ padding: 4, position: "relative" }}>
            <IconSymbol name="archivebox" size={22} color={colors.muted} />
            {archivedCount > 0 && (
              <View style={{
                position: "absolute", top: 0, right: 0,
                backgroundColor: "#FF9500", borderRadius: 8,
                minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3,
              }}>
                <Text style={{ fontSize: 9, color: "#fff", fontWeight: "700" }}>{archivedCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          {/* 新增员工 */}
          <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="plus" size={22} color={colors.primary} />
          </Pressable>
        </View>
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
              style={[CHIP_BADGE_LAYOUT.scrollChip, {
                backgroundColor: isActive ? chipColor : colors.surface,
                borderColor: isActive ? chipColor : colors.border,
              }]}>
              <Text numberOfLines={1} style={[CHIP_BADGE_LAYOUT.scrollLabel, { color: isActive ? "#fff" : colors.muted }]}>
                {f.label}
              </Text>
              {count > 0 && (
                <View style={[CHIP_BADGE_LAYOUT.countBadge, {
                  backgroundColor: isActive ? "rgba(255,255,255,0.3)" : colors.border + "66",
                }]}>
                  <Text numberOfLines={1} style={{ fontSize: 10, lineHeight: 12, fontWeight: "700", color: isActive ? "#fff" : colors.muted }}>{formatCompactCount(count)}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 列表主体 */}
      <ScrollView
        ref={empScrollRef}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom }}
        onScroll={onEmpScroll}
        scrollEventThrottle={100}
      >

        {/* 全部 Tab：按部门分组 */}
        {deptFilter === "all" && deptOrder.map((dept) =>
          grouped[dept].length > 0 ? (
            <DeptSection
              key={dept}
              dept={dept}
              employees={grouped[dept]}
              colors={colors}
              onPress={handlePress}
              onArchive={handleArchive}
              onDelete={handleDelete}
          />
        ) : null
        )}

        {/* 单部门 Tab */}
        {deptFilter !== "all" && filtered && (
          <DeptSection
            dept={deptFilter as EmployeeDept}
            employees={filtered}
            colors={colors}
            onPress={handlePress}
            onArchive={handleArchive}
            onDelete={handleDelete}
          />
        )}

        {/* 空状态 */}
        {activeEmployees.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <IconSymbol name="person.2.fill" size={48} color={colors.border} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>暂无在职员工</Text>
            {archivedCount > 0 && (
              <TouchableOpacity onPress={() => { tap(); router.push("/labor-archived" as any); }}
                style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 13, color: "#FF9500" }}>查看离职归档（{archivedCount} 人）</Text>
              </TouchableOpacity>
            )}
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
  deptHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 4,
    borderLeftWidth: 3,
  },
  empCard: {
    flexDirection: "row", alignItems: "flex-start",
    borderRadius: 14, borderWidth: 1, padding: 12, gap: 10,
  },
  empAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 16,
  },
});
