/**
 * 排班表页面
 * - 部门切换：前厅（蓝色）/ 后厨（绿色）
 * - 视图切换：午/晚版本 / 时长版本
 * - 班次切换：白班 / 晚班
 * - 按周展示，每行显示员工姓名
 * - 点击格子编辑排班
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, useShiftStore } from "@/lib/labor/store";
import {
  Employee, EmployeeDept, ShiftEntry, ShiftHoursValue, ShiftSessionValue,
  DEPT_LABELS, DEPT_COLORS, WEEKDAY_LABELS, WEEKDAY_EN,
  getMonthDates, getDayOfWeek, monthLabel
} from "@/lib/labor/types";

type ViewMode = "session" | "hours";
type ShiftType = "day" | "evening";

const DEPT_OPTIONS: EmployeeDept[] = ["front", "kitchen"];
const SHIFT_LABELS: Record<ShiftType, string> = { day: "白班", evening: "晚班" };

// ─── 特殊值选项 ───────────────────────────────────────────────────────────────
const SESSION_OPTIONS: { value: ShiftSessionValue; label: string; color?: string }[] = [
  { value: "午", label: "午" },
  { value: "晚", label: "晚" },
  { value: "午晚", label: "午晚" },
  { value: "休", label: "（休）", color: "#FF3B30" },
  { value: "无早", label: "（无早）", color: "#FF3B30" },
  { value: null, label: "清空" },
];

// ─── 格子显示 ─────────────────────────────────────────────────────────────────
function CellDisplay({
  entry, viewMode, deptColor, colors
}: {
  entry: ShiftEntry | null;
  viewMode: ViewMode;
  deptColor: string;
  colors: any;
}) {
  if (!entry) return <Text style={{ fontSize: 11, color: colors.border }}>—</Text>;

  if (viewMode === "hours") {
    const h = entry.hoursValue;
    if (h === "休") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>（休）</Text>;
    if (h === "无早") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>无早</Text>;
    if (typeof h === "number" && h > 0) return <Text style={[CS.cellHours, { color: deptColor }]}>{h.toFixed(1)}</Text>;
    return <Text style={{ fontSize: 11, color: colors.border }}>—</Text>;
  } else {
    const s = entry.sessionValue;
    if (s === "休") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>（休）</Text>;
    if (s === "无早") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>无早</Text>;
    if (s === "午") return <Text style={[CS.cellSession, { color: "#FF9500" }]}>午</Text>;
    if (s === "晚") return <Text style={[CS.cellSession, { color: deptColor }]}>晚</Text>;
    if (s === "午晚") return <Text style={[CS.cellSession, { color: deptColor }]}>午晚</Text>;
    return <Text style={{ fontSize: 11, color: colors.border }}>—</Text>;
  }
}

// ─── 编辑 Modal ───────────────────────────────────────────────────────────────
function EditShiftModal({
  visible, date, employee, shift, existing, viewMode, deptColor, colors,
  onSave, onClose
}: {
  visible: boolean;
  date: string;
  employee: Employee | null;
  shift: ShiftType;
  existing: ShiftEntry | null;
  viewMode: ViewMode;
  deptColor: string;
  colors: any;
  onSave: (entry: ShiftEntry) => void;
  onClose: () => void;
}) {
  const [hoursInput, setHoursInput] = useState(
    existing?.hoursValue != null && typeof existing.hoursValue === "number"
      ? String(existing.hoursValue) : ""
  );
  const [sessionVal, setSessionVal] = useState<ShiftSessionValue>(existing?.sessionValue ?? null);
  const [hoursSpecial, setHoursSpecial] = useState<"休" | "无早" | null>(
    existing?.hoursValue === "休" ? "休" : existing?.hoursValue === "无早" ? "无早" : null
  );

  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const handleSave = () => {
    if (!employee) return;
    let hoursValue: ShiftHoursValue = null;
    if (hoursSpecial) {
      hoursValue = hoursSpecial;
    } else if (hoursInput) {
      hoursValue = Number(hoursInput) || null;
    }
    const entry: ShiftEntry = {
      employeeId: employee.id,
      date,
      shift,
      hoursValue,
      sessionValue: sessionVal,
    };
    onSave(entry);
    onClose();
  };

  if (!employee) return null;
  const dayStr = date.slice(5);
  const dow = getDayOfWeek(date);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[EM.sheet, { backgroundColor: colors.background }]}>
        <View style={[EM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[EM.title, { color: colors.foreground }]}>{employee.code} · {SHIFT_LABELS[shift]}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{dayStr} {WEEKDAY_LABELS[dow]}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: deptColor }}>保存</Text></Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 20 }}>
          {/* 时长版本 */}
          <Text style={[EM.sectionLabel, { color: colors.muted }]}>工时（小时）</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[6, 7, 8, 9, 10, 11, 12, 13].map((h) => (
              <TouchableOpacity key={h} onPress={() => { tap(); setHoursInput(String(h)); setHoursSpecial(null); }}
                style={[EM.chip, {
                  backgroundColor: hoursInput === String(h) && !hoursSpecial ? deptColor : colors.surface,
                  borderColor: hoursInput === String(h) && !hoursSpecial ? deptColor : colors.border,
                }]}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: hoursInput === String(h) && !hoursSpecial ? "#fff" : colors.muted }}>
                  {h}h
                </Text>
              </TouchableOpacity>
            ))}
            <TextInput value={hoursInput} onChangeText={(v) => { setHoursInput(v); setHoursSpecial(null); }}
              placeholder="自定义" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
              style={[EM.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
          </View>

          {/* 特殊标注（时长版本） */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
            {(["休", "无早"] as const).map((s) => (
              <TouchableOpacity key={s} onPress={() => { tap(); setHoursSpecial(s); setHoursInput(""); }}
                style={[EM.chip, {
                  backgroundColor: hoursSpecial === s ? "#FF3B30" : colors.surface,
                  borderColor: hoursSpecial === s ? "#FF3B30" : colors.border,
                }]}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: hoursSpecial === s ? "#fff" : "#FF3B30" }}>
                  （{s}）
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => { tap(); setHoursInput(""); setHoursSpecial(null); }}
              style={[EM.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 13, color: colors.muted }}>清空</Text>
            </TouchableOpacity>
          </View>

          {/* 午/晚版本 */}
          <Text style={[EM.sectionLabel, { color: colors.muted }]}>班次标注（午/晚版）</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {SESSION_OPTIONS.map((opt) => (
              <TouchableOpacity key={String(opt.value)} onPress={() => { tap(); setSessionVal(opt.value); }}
                style={[EM.chip, {
                  backgroundColor: sessionVal === opt.value
                    ? (opt.color ?? deptColor)
                    : colors.surface,
                  borderColor: sessionVal === opt.value
                    ? (opt.color ?? deptColor)
                    : colors.border,
                }]}>
                <Text style={{
                  fontSize: 14, fontWeight: "600",
                  color: sessionVal === opt.value ? "#fff" : (opt.color ?? colors.muted)
                }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function LaborScheduleScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { employees } = useEmployeeStore();
  const { shifts, upsertShift, getShifts } = useShiftStore();

  // 当前月份
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [dept, setDept] = useState<EmployeeDept>("front");
  const [viewMode, setViewMode] = useState<ViewMode>("session");
  const [shiftType, setShiftType] = useState<ShiftType>("evening");

  // 编辑状态
  const [editModal, setEditModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);

  const deptColor = DEPT_COLORS[dept];

  // 当月日期列表
  const dates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);

  // 按周分组日期（每行7天，从周一开始）
  const weeks = useMemo(() => {
    const result: (string | null)[][] = [];
    // 找到第一天是周几
    const firstDow = getDayOfWeek(dates[0]); // 0=周日
    // 调整为周一开始（0=周一...6=周日）
    const offset = firstDow === 0 ? 6 : firstDow - 1;

    let week: (string | null)[] = Array(offset).fill(null);
    dates.forEach((d) => {
      week.push(d);
      if (week.length === 7) { result.push(week); week = []; }
    });
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      result.push(week);
    }
    return result;
  }, [dates]);

  // 当前部门员工（按类型：全职在前，兼职在后）
  const deptEmployees = useMemo(() => {
    return employees
      .filter((e) => e.active && (e.dept === dept || (dept === "front" && e.dept === "parttime")))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "fulltime" ? -1 : 1;
        return a.code.localeCompare(b.code);
      });
  }, [employees, dept]);

  // 当月排班数据
  const monthShifts = useMemo(() => getShifts(currentMonth), [shifts, currentMonth]);

  const getEntry = useCallback((employeeId: string, date: string): ShiftEntry | null => {
    return monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === shiftType) ?? null;
  }, [monthShifts, shiftType]);

  const handleCellPress = (employee: Employee, date: string) => {
    tap();
    setEditEmployee(employee);
    setEditDate(date);
    setEditModal(true);
  };

  const handleSaveShift = (entry: ShiftEntry) => {
    upsertShift(entry);
  };

  const prevMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nextMonth = () => {
    const [y, m] = currentMonth.split("-").map(Number);
    const d = new Date(y, m, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const CELL_W = 42;
  const NAME_W = 52;
  const tableWidth = NAME_W + CELL_W * 7;

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>排班表</Text>
        </View>
        <Pressable onPress={() => router.push("/labor-attendance" as any)}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="chart.bar.fill" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {/* 月份选择器 */}
      <View style={[S.monthBar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => { tap(); prevMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}>
          <IconSymbol name="chevron.left" size={18} color={colors.primary} />
        </Pressable>
        <Text style={[S.monthLabel, { color: colors.foreground }]}>{monthLabel(currentMonth)}</Text>
        <Pressable onPress={() => { tap(); nextMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}>
          <IconSymbol name="chevron.right" size={18} color={colors.primary} />
        </Pressable>
      </View>

      {/* 控制栏 */}
      <View style={[S.controlBar, { borderBottomColor: colors.border }]}>
        {/* 部门切换 */}
        <View style={[S.segGroup, { backgroundColor: colors.border + "33" }]}>
          {DEPT_OPTIONS.map((d) => (
            <TouchableOpacity key={d} onPress={() => { tap(); setDept(d); }}
              style={[S.segBtn, dept === d && { backgroundColor: DEPT_COLORS[d] }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: dept === d ? "#fff" : colors.muted }}>
                {DEPT_LABELS[d]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 视图切换 */}
        <View style={[S.segGroup, { backgroundColor: colors.border + "33" }]}>
          {([["session", "午/晚"], ["hours", "时长"]] as [ViewMode, string][]).map(([v, label]) => (
            <TouchableOpacity key={v} onPress={() => { tap(); setViewMode(v); }}
              style={[S.segBtn, viewMode === v && { backgroundColor: colors.primary }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: viewMode === v ? "#fff" : colors.muted }}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 班次切换 */}
        <View style={[S.segGroup, { backgroundColor: colors.border + "33" }]}>
          {(["day", "evening"] as ShiftType[]).map((s) => (
            <TouchableOpacity key={s} onPress={() => { tap(); setShiftType(s); }}
              style={[S.segBtn, shiftType === s && { backgroundColor: deptColor }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: shiftType === s ? "#fff" : colors.muted }}>
                {SHIFT_LABELS[s]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 排班表 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
          <View style={{ width: tableWidth }}>
            {/* 表头：星期 */}
            <View style={[S.tableHeaderRow, { backgroundColor: deptColor + "22", borderBottomColor: deptColor + "44" }]}>
              <View style={{ width: NAME_W }}>
                <Text style={[S.headerCell, { color: deptColor }]}>姓名</Text>
              </View>
              {["一", "二", "三", "四", "五", "六", "日"].map((d, i) => (
                <View key={i} style={{ width: CELL_W, alignItems: "center" }}>
                  <Text style={[S.headerCell, { color: i >= 5 ? colors.error : deptColor }]}>
                    周{d}
                  </Text>
                </View>
              ))}
            </View>

            {/* 按周展示 */}
            {weeks.map((week, wi) => {
              const weekDates = week;
              // 找到本周有日期的第一个
              const firstDate = weekDates.find((d) => d !== null);
              if (!firstDate) return null;

              return (
                <View key={wi}>
                  {/* 日期行 */}
                  <View style={[S.dateRow, { backgroundColor: "#FF9500" + "22", borderBottomColor: "#FF9500" + "44" }]}>
                    <View style={{ width: NAME_W }}>
                      <Text style={[S.dateCell, { color: "#FF9500" }]}>日期</Text>
                    </View>
                    {weekDates.map((d, di) => (
                      <View key={di} style={{ width: CELL_W, alignItems: "center" }}>
                        {d ? (
                          <Text style={[S.dateCell, {
                            color: getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6 ? colors.error : "#FF9500"
                          }]}>
                            {Number(d.slice(8))}
                          </Text>
                        ) : null}
                      </View>
                    ))}
                  </View>

                  {/* 员工行 */}
                  {deptEmployees.map((emp) => (
                    <View key={emp.id} style={[S.empRow, { borderBottomColor: colors.border }]}>
                      {/* 员工名 */}
                      <View style={[S.nameCell, { width: NAME_W, backgroundColor: deptColor + "0a" }]}>
                        <Text style={[S.empName, { color: deptColor }]} numberOfLines={1}>{emp.code}</Text>
                        {emp.type === "parttime" && (
                          <Text style={{ fontSize: 8, color: colors.muted }}>兼</Text>
                        )}
                      </View>
                      {/* 每天格子 */}
                      {weekDates.map((d, di) => {
                        const entry = d ? getEntry(emp.id, d) : null;
                        const isWeekend = d ? (getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6) : false;
                        return (
                          <TouchableOpacity key={di}
                            onPress={() => d && handleCellPress(emp, d)}
                            disabled={!d}
                            style={[S.cell, {
                              width: CELL_W,
                              backgroundColor: d
                                ? (isWeekend ? deptColor + "08" : colors.background)
                                : colors.surface + "44",
                              borderRightColor: colors.border,
                            }]}>
                            <CellDisplay entry={entry} viewMode={viewMode} deptColor={deptColor} colors={colors} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}

                  {/* 空行分隔 */}
                  <View style={{ height: 8, backgroundColor: colors.surface }} />
                </View>
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>

      {/* 编辑 Modal */}
      <EditShiftModal
        visible={editModal}
        date={editDate}
        employee={editEmployee}
        shift={shiftType}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate) : null}
        viewMode={viewMode}
        deptColor={deptColor}
        colors={colors}
        onSave={handleSaveShift}
        onClose={() => setEditModal(false)}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 16 },
  monthLabel: { fontSize: 16, fontWeight: "700", minWidth: 90, textAlign: "center" },
  controlBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  segGroup: { flexDirection: "row", borderRadius: 8, padding: 2, gap: 2 },
  segBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 6 },
  headerCell: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  dateRow: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 4 },
  dateCell: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  empRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 36 },
  nameCell: { justifyContent: "center", alignItems: "center", paddingHorizontal: 4 },
  empName: { fontSize: 12, fontWeight: "700", textAlign: "center" },
  cell: { alignItems: "center", justifyContent: "center", minHeight: 36, borderRightWidth: StyleSheet.hairlineWidth },
});

const CS = StyleSheet.create({
  cellHours: { fontSize: 13, fontWeight: "700" },
  cellSession: { fontSize: 14, fontWeight: "700" },
  cellSpecial: { fontSize: 10, fontWeight: "600" },
});

const EM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: "700" },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inputSmall: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, width: 64, textAlign: "center" },
});
