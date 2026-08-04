/**
 * 排班表页面（升级版）
 * - 部门切换：前厅（蓝色）/ 后厨（绿色）
 * - 视图切换：午/晚版本 / 时长版本
 * - 白班/晚班同屏显示（每员工每天两行：白/晚）
 * - 人员多选筛选（全部/某人/多人）
 * - 筛选人员薪水条展示
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, useWindowDimensions
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, useShiftStore, useAttendanceStore, usePaySlipStore } from "@/lib/labor/store";
import {
  Employee, EmployeeDept, ShiftEntry, ShiftHoursValue, ShiftSessionValue,
  DEPT_LABELS, DEPT_COLORS, WEEKDAY_LABELS,
  getMonthDates, getDayOfWeek, monthLabel
} from "@/lib/labor/types";

type ViewMode = "session" | "hours";
type ShiftType = "day" | "evening";

const DEPT_OPTIONS: EmployeeDept[] = ["front", "kitchen"];
const SHIFT_LABELS: Record<ShiftType, string> = { day: "白", evening: "晚" };

const SESSION_OPTIONS: { value: ShiftSessionValue; label: string; color?: string }[] = [
  { value: "午", label: "午" },
  { value: "晚", label: "晚" },
  { value: "午晚", label: "午晚" },
  { value: "休", label: "休", color: "#FF3B30" },
  { value: "无早", label: "无早", color: "#FF3B30" },
  { value: null, label: "清空" },
];

// ─── 格子显示 ─────────────────────────────────────────────────────────────────
function CellDisplay({ entry, viewMode, deptColor, colors, shiftType, overtimeAlert }: {
  entry: ShiftEntry | null; viewMode: ViewMode; deptColor: string; colors: any; shiftType: ShiftType;
  overtimeAlert?: "poor" | "ok" | null;
}) {
  const shiftColor = shiftType === "day" ? "#FF9500" : deptColor;
  const alertColor = overtimeAlert === "poor" ? "#FF3B30" : overtimeAlert === "ok" ? "#FF9500" : null;

  const renderContent = () => {
    if (!entry) return <Text style={{ fontSize: 10, color: colors.border + "88" }}>·</Text>;
    if (viewMode === "hours") {
      const h = entry.hoursValue;
      if (h === "休") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>休</Text>;
      if (h === "无早") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>无早</Text>;
      if (typeof h === "number" && h > 0) {
        // 超过8小时橙色显示
        const isOvertime = h > 8;
        return <Text style={[CS.cellHours, { color: isOvertime ? "#FF3B30" : shiftColor }]}>{h}h</Text>;
      }
      return <Text style={{ fontSize: 10, color: colors.border + "88" }}>·</Text>;
    } else {
      const s = entry.sessionValue;
      if (s === "休") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>休</Text>;
      if (s === "无早") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>无早</Text>;
      if (s === "午") return <Text style={[CS.cellSession, { color: "#FF9500" }]}>午</Text>;
      if (s === "晚") return <Text style={[CS.cellSession, { color: deptColor }]}>晚</Text>;
      if (s === "午晚") return <Text style={[CS.cellSession, { color: deptColor }]}>午晚</Text>;
      return <Text style={{ fontSize: 10, color: colors.border + "88" }}>·</Text>;
    }
  };

  return (
    <View style={{ position: "relative", alignItems: "center", justifyContent: "center" }}>
      {renderContent()}
      {alertColor && (
        <View style={{
          position: "absolute", top: -4, right: -4,
          width: 7, height: 7, borderRadius: 3.5,
          backgroundColor: alertColor,
        }} />
      )}
    </View>
  );
}

// ─── 编辑 Modal ───────────────────────────────────────────────────────────────
function EditShiftModal({ visible, date, employee, shift, existing, viewMode, deptColor, colors, onSave, onClose }: {
  visible: boolean; date: string; employee: Employee | null; shift: ShiftType;
  existing: ShiftEntry | null; viewMode: ViewMode; deptColor: string; colors: any;
  onSave: (entry: ShiftEntry) => void; onClose: () => void;
}) {
  const [hoursInput, setHoursInput] = useState(
    existing?.hoursValue != null && typeof existing.hoursValue === "number" ? String(existing.hoursValue) : ""
  );
  const [sessionVal, setSessionVal] = useState<ShiftSessionValue>(existing?.sessionValue ?? null);
  const [hoursSpecial, setHoursSpecial] = useState<"休" | "无早" | null>(
    existing?.hoursValue === "休" ? "休" : existing?.hoursValue === "无早" ? "无早" : null
  );
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const shiftColor = shift === "day" ? "#FF9500" : deptColor;

  React.useEffect(() => {
    if (visible) {
      setHoursInput(existing?.hoursValue != null && typeof existing.hoursValue === "number" ? String(existing.hoursValue) : "");
      setSessionVal(existing?.sessionValue ?? null);
      setHoursSpecial(existing?.hoursValue === "休" ? "休" : existing?.hoursValue === "无早" ? "无早" : null);
    }
  }, [visible, existing]);

  const handleSave = () => {
    if (!employee) return;
    let hoursValue: ShiftHoursValue = null;
    if (hoursSpecial) hoursValue = hoursSpecial;
    else if (hoursInput) hoursValue = Number(hoursInput) || null;
    onSave({ employeeId: employee.id, date, shift, hoursValue, sessionValue: sessionVal });
    onClose();
  };

  if (!employee) return null;
  const dow = getDayOfWeek(date);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[EM.sheet, { backgroundColor: colors.background }]}>
        <View style={[EM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ backgroundColor: shiftColor + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: shiftColor }}>{shift === "day" ? "白班" : "晚班"}</Text>
              </View>
              <Text style={[EM.title, { color: colors.foreground }]}>{employee.code}</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted }}>{date.slice(5)} {WEEKDAY_LABELS[dow]}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: shiftColor }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          {/* 时长 */}
          <View>
            <Text style={[EM.sectionLabel, { color: colors.muted }]}>工时（小时）</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {[6, 7, 8, 9, 10, 11, 12].map((h) => (
                <TouchableOpacity key={h} onPress={() => { tap(); setHoursInput(String(h)); setHoursSpecial(null); }}
                  style={[EM.chip, { backgroundColor: hoursInput === String(h) && !hoursSpecial ? shiftColor : colors.surface, borderColor: hoursInput === String(h) && !hoursSpecial ? shiftColor : colors.border }]}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: hoursInput === String(h) && !hoursSpecial ? "#fff" : colors.muted }}>{h}h</Text>
                </TouchableOpacity>
              ))}
              <TextInput value={hoursInput} onChangeText={(v) => { setHoursInput(v); setHoursSpecial(null); }}
                placeholder="自定义" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[EM.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </View>
          {/* 特殊标注 */}
          <View>
            <Text style={[EM.sectionLabel, { color: colors.muted }]}>特殊标注</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["休", "无早"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => { tap(); setHoursSpecial(s); setHoursInput(""); }}
                  style={[EM.chip, { backgroundColor: hoursSpecial === s ? "#FF3B30" : colors.surface, borderColor: hoursSpecial === s ? "#FF3B30" : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: hoursSpecial === s ? "#fff" : "#FF3B30" }}>（{s}）</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => { tap(); setHoursInput(""); setHoursSpecial(null); setSessionVal(null); }}
                style={[EM.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 13, color: colors.muted }}>清空</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* 午/晚标注 */}
          <View>
            <Text style={[EM.sectionLabel, { color: colors.muted }]}>班次标注（午/晚版）</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {SESSION_OPTIONS.map((opt) => (
                <TouchableOpacity key={String(opt.value)} onPress={() => { tap(); setSessionVal(opt.value); }}
                  style={[EM.chip, { backgroundColor: sessionVal === opt.value ? (opt.color ?? shiftColor) : colors.surface, borderColor: sessionVal === opt.value ? (opt.color ?? shiftColor) : colors.border }]}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: sessionVal === opt.value ? "#fff" : (opt.color ?? colors.muted) }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 人员筛选 Modal ───────────────────────────────────────────────────────────
function EmployeeFilterModal({ visible, employees, selected, deptColor, colors, onConfirm, onClose }: {
  visible: boolean; employees: Employee[]; selected: Set<string>;
  deptColor: string; colors: any;
  onConfirm: (ids: Set<string>) => void; onClose: () => void;
}) {
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set(selected));
  React.useEffect(() => { if (visible) setLocalSelected(new Set(selected)); }, [visible]);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const allSelected = localSelected.size === 0 || localSelected.size === employees.length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[EM.sheet, { backgroundColor: colors.background }]}>
        <View style={[EM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[EM.title, { color: colors.foreground }]}>筛选人员</Text>
          <Pressable onPress={() => { onConfirm(localSelected); onClose(); }}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: deptColor }}>确认</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
          {/* 全选 */}
          <TouchableOpacity onPress={() => { tap(); setLocalSelected(new Set()); }}
            style={[EM.filterRow, { backgroundColor: allSelected ? deptColor + "15" : colors.surface, borderColor: allSelected ? deptColor : colors.border }]}>
            <View style={[EM.filterCheck, { backgroundColor: allSelected ? deptColor : "transparent", borderColor: allSelected ? deptColor : colors.border }]}>
              {allSelected && <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text>}
            </View>
            <Text style={{ fontSize: 15, fontWeight: "600", color: allSelected ? deptColor : colors.foreground }}>全部人员</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginLeft: "auto" }}>{employees.length} 人</Text>
          </TouchableOpacity>
          {/* 分隔 */}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 }} />
          {employees.map((emp) => {
            const isSelected = localSelected.has(emp.id);
            return (
              <TouchableOpacity key={emp.id} onPress={() => {
                tap();
                const next = new Set(localSelected);
                if (next.has(emp.id)) next.delete(emp.id); else next.add(emp.id);
                setLocalSelected(next);
              }} style={[EM.filterRow, { backgroundColor: isSelected ? deptColor + "15" : colors.surface, borderColor: isSelected ? deptColor : colors.border }]}>
                <View style={[EM.filterCheck, { backgroundColor: isSelected ? deptColor : "transparent", borderColor: isSelected ? deptColor : colors.border }]}>
                  {isSelected && <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text>}
                </View>
                <View style={[EM.filterAvatar, { backgroundColor: deptColor + "22" }]}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: deptColor }}>{emp.code.slice(0, 2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{emp.code}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{emp.realName} · {emp.type === "fulltime" ? "全职" : "兼职"}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 薪水条卡片 ───────────────────────────────────────────────────────────────
function PaySlipCard({ employee, month, deptColor, colors }: {
  employee: Employee; month: string; deptColor: string; colors: any;
}) {
  const { getPaySlip } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();
  const slip = getPaySlip(employee.id, month);
  const att = getAttendance(employee.id, month);

  return (
    <View style={[PSC.card, { backgroundColor: colors.surface, borderColor: deptColor + "33" }]}>
      {/* 员工信息行 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <View style={[PSC.avatar, { backgroundColor: deptColor + "22" }]}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: deptColor }}>{employee.code.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{employee.code} · {employee.realName}</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>{monthLabel(month)} · {employee.type === "fulltime" ? "全职" : "兼职"}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {slip ? (
            <Text style={{ fontSize: 18, fontWeight: "800", color: deptColor }}>¥{slip.finalSalary.toFixed(0)}</Text>
          ) : att ? (
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.muted }}>¥{att.attendanceSalary.toFixed(0)}</Text>
          ) : (
            <Text style={{ fontSize: 12, color: colors.border }}>未填写</Text>
          )}
          {slip && <Text style={{ fontSize: 10, color: colors.muted }}>最终薪资</Text>}
          {!slip && att && <Text style={{ fontSize: 10, color: colors.muted }}>考勤薪资</Text>}
        </View>
      </View>
      {/* 明细行 */}
      {(att || slip) && (
        <View style={[PSC.detailRow, { borderTopColor: colors.border }]}>
          {att && (
            <>
              <View style={PSC.detailItem}>
                <Text style={PSC.detailLabel}>出勤</Text>
                <Text style={[PSC.detailValue, { color: colors.foreground }]}>{att.attendanceDays}天</Text>
              </View>
              <View style={PSC.detailItem}>
                <Text style={PSC.detailLabel}>工时</Text>
                <Text style={[PSC.detailValue, { color: colors.foreground }]}>{att.totalHours}h</Text>
              </View>
              {att.overtimeHours > 0 && (
                <View style={PSC.detailItem}>
                  <Text style={PSC.detailLabel}>加班</Text>
                  <Text style={[PSC.detailValue, { color: colors.success }]}>+{att.overtimeHours.toFixed(1)}h</Text>
                </View>
              )}
            </>
          )}
          {slip && (
            <>
              {slip.performanceBonus > 0 && (
                <View style={PSC.detailItem}>
                  <Text style={PSC.detailLabel}>绩效</Text>
                  <Text style={[PSC.detailValue, { color: colors.success }]}>+¥{slip.performanceBonus.toFixed(0)}</Text>
                </View>
              )}
              {(slip.mealAllowance + slip.transportAllowance + slip.otherAllowance) > 0 && (
                <View style={PSC.detailItem}>
                  <Text style={PSC.detailLabel}>补贴</Text>
                  <Text style={[PSC.detailValue, { color: colors.primary }]}>+¥{(slip.mealAllowance + slip.transportAllowance + slip.otherAllowance).toFixed(0)}</Text>
                </View>
              )}
              {slip.rewardPenalty !== 0 && (
                <View style={PSC.detailItem}>
                  <Text style={PSC.detailLabel}>奖惩</Text>
                  <Text style={[PSC.detailValue, { color: slip.rewardPenalty > 0 ? colors.success : colors.error }]}>
                    {slip.rewardPenalty > 0 ? "+" : ""}¥{slip.rewardPenalty.toFixed(0)}
                  </Text>
                </View>
              )}
            </>
          )}
        </View>
      )}
      {slip?.notes ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>备注：{slip.notes}</Text> : null}
    </View>
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

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [dept, setDept] = useState<EmployeeDept>("front");
  const [viewMode, setViewMode] = useState<ViewMode>("session");
  const [showBothShifts, setShowBothShifts] = useState(true); // 白晚班同屏

  // 人员筛选
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());
  const [showFilterModal, setShowFilterModal] = useState(false);

  // 编辑状态
  const [editModal, setEditModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editShiftType, setEditShiftType] = useState<ShiftType>("evening");

  // 薪水条面板
  const [showPaySlips, setShowPaySlips] = useState(false);

  const deptColor = DEPT_COLORS[dept];
  const dates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);

  // 按周分组（从周一开始）
  const weeks = useMemo(() => {
    const result: (string | null)[][] = [];
    const firstDow = getDayOfWeek(dates[0]);
    const offset = firstDow === 0 ? 6 : firstDow - 1;
    let week: (string | null)[] = Array(offset).fill(null);
    dates.forEach((d) => {
      week.push(d);
      if (week.length === 7) { result.push(week); week = []; }
    });
    if (week.length > 0) { while (week.length < 7) week.push(null); result.push(week); }
    return result;
  }, [dates]);

  // 当前部门全部员工
  const allDeptEmployees = useMemo(() => {
    return employees
      .filter((e) => e.active && (e.dept === dept || (dept === "front" && e.dept === "parttime")))
      .sort((a, b) => { if (a.type !== b.type) return a.type === "fulltime" ? -1 : 1; return a.code.localeCompare(b.code); });
  }, [employees, dept]);

  // 筛选后的员工
  const deptEmployees = useMemo(() => {
    if (selectedEmployeeIds.size === 0) return allDeptEmployees;
    return allDeptEmployees.filter((e) => selectedEmployeeIds.has(e.id));
  }, [allDeptEmployees, selectedEmployeeIds]);

  const monthShifts = useMemo(() => getShifts(currentMonth), [shifts, currentMonth]);

  const getEntry = useCallback((employeeId: string, date: string, shift: ShiftType): ShiftEntry | null => {
    return monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === shift) ?? null;
  }, [monthShifts]);

  const handleCellPress = (employee: Employee, date: string, shiftType: ShiftType) => {
    tap();
    setEditEmployee(employee);
    setEditDate(date);
    setEditShiftType(shiftType);
    setEditModal(true);
  };

  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  const { width: screenWidth } = useWindowDimensions();
  // 自适应列宽：姓名列固定56，剩余空间均分7列，最小36，最大52
  const NAME_W = 56;
  const CELL_W = Math.max(36, Math.min(52, Math.floor((screenWidth - NAME_W - 2) / 7)));
  const tableWidth = NAME_W + CELL_W * 7;

  const filterLabel = selectedEmployeeIds.size === 0
    ? `全部 (${allDeptEmployees.length}人)`
    : `已选 ${selectedEmployeeIds.size}人`;

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
        <View style={{ flexDirection: "row", gap: 12 }}>
          {/* 薪水条开关 */}
          <Pressable onPress={() => { tap(); setShowPaySlips((v) => !v); }}
            style={{ backgroundColor: showPaySlips ? colors.primary + "22" : "transparent", borderRadius: 8, padding: 4 }}>
            <IconSymbol name="banknote.fill" size={20} color={showPaySlips ? colors.primary : colors.muted} />
          </Pressable>
          <Pressable onPress={() => router.push("/labor-attendance" as any)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="chart.bar.fill" size={20} color={colors.primary} />
          </Pressable>
        </View>
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
            <TouchableOpacity key={d} onPress={() => { tap(); setDept(d); setSelectedEmployeeIds(new Set()); }}
              style={[S.segBtn, dept === d && { backgroundColor: DEPT_COLORS[d] }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: dept === d ? "#fff" : colors.muted }}>{DEPT_LABELS[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 视图切换 */}
        <View style={[S.segGroup, { backgroundColor: colors.border + "33" }]}>
          {([["session", "午/晚"], ["hours", "时长"]] as [ViewMode, string][]).map(([v, label]) => (
            <TouchableOpacity key={v} onPress={() => { tap(); setViewMode(v); }}
              style={[S.segBtn, viewMode === v && { backgroundColor: colors.primary }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: viewMode === v ? "#fff" : colors.muted }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 白晚同屏切换 */}
        <TouchableOpacity onPress={() => { tap(); setShowBothShifts((v) => !v); }}
          style={[S.segGroup, { backgroundColor: showBothShifts ? deptColor + "22" : colors.border + "33", paddingHorizontal: 8, paddingVertical: 5 }]}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: showBothShifts ? deptColor : colors.muted }}>白/晚</Text>
        </TouchableOpacity>

        {/* 人员筛选 */}
        <TouchableOpacity onPress={() => { tap(); setShowFilterModal(true); }}
          style={[S.segGroup, { backgroundColor: selectedEmployeeIds.size > 0 ? deptColor + "22" : colors.border + "33", paddingHorizontal: 8, paddingVertical: 5, flexDirection: "row", alignItems: "center", gap: 4 }]}>
          <IconSymbol name="person.2.fill" size={12} color={selectedEmployeeIds.size > 0 ? deptColor : colors.muted} />
          <Text style={{ fontSize: 11, fontWeight: "600", color: selectedEmployeeIds.size > 0 ? deptColor : colors.muted }}>{filterLabel}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {/* 排班表 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ width: tableWidth }}>
            {/* 表头：星期 */}
            <View style={[S.tableHeaderRow, { backgroundColor: deptColor + "18", borderBottomColor: deptColor + "44" }]}>
              <View style={{ width: NAME_W, paddingLeft: 8 }}>
                <Text style={[S.headerCell, { color: deptColor }]}>姓名</Text>
              </View>
              {["一", "二", "三", "四", "五", "六", "日"].map((d, i) => (
                <View key={i} style={{ width: CELL_W, alignItems: "center" }}>
                  <Text style={[S.headerCell, { color: i >= 5 ? colors.error : deptColor }]}>周{d}</Text>
                </View>
              ))}
            </View>

            {/* 按周展示 */}
            {weeks.map((week, wi) => {
              const firstDate = week.find((d) => d !== null);
              if (!firstDate) return null;
              return (
                <View key={wi}>
                  {/* 日期行（橙色背景，与 Excel 一致） */}
                  <View style={[S.dateRow, { backgroundColor: "#FF9500" + "22", borderBottomColor: "#FF9500" + "55" }]}>
                    <View style={{ width: NAME_W, paddingLeft: 8 }}>
                      <Text style={[S.dateCell, { color: "#FF9500" }]}>日期</Text>
                    </View>
                    {week.map((d, di) => {
                      const isToday = d === new Date().toISOString().slice(0, 10);
                      return (
                        <View key={di} style={{ width: CELL_W, alignItems: "center" }}>
                          {d ? (
                            <View style={isToday ? { backgroundColor: deptColor, borderRadius: 10, width: 22, height: 22, alignItems: "center", justifyContent: "center" } : undefined}>
                              <Text style={[S.dateCell, {
                                color: isToday ? "#fff" : (getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6 ? colors.error : "#FF9500"),
                                fontWeight: isToday ? "800" : "700",
                              }]}>{Number(d.slice(8))}</Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>

                  {/* 员工行 */}
                  {deptEmployees.map((emp, empIdx) => {
                    const isLastEmp = empIdx === deptEmployees.length - 1;
                    return (
                      <View key={emp.id} style={{ borderBottomWidth: isLastEmp ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.border + "88" }}>
                        {/* 白班行（浅蓝背景，与 Excel 一致） */}
                        {(showBothShifts || true) && (
                          <View style={[S.empRow, { borderBottomWidth: showBothShifts ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border + "44", backgroundColor: "#007AFF" + "06" }]}>
                            <View style={[S.nameCell, { width: NAME_W, backgroundColor: "#007AFF" + "10" }]}>
                              {showBothShifts ? (
                                <>
                                  <Text style={[S.empName, { color: deptColor }]} numberOfLines={1}>{emp.code}</Text>
                                  <View style={{ backgroundColor: "#FF9500" + "33", borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 }}>
                                    <Text style={{ fontSize: 9, color: "#FF9500", fontWeight: "700" }}>白</Text>
                                  </View>
                                </>
                              ) : (
                                <Text style={[S.empName, { color: deptColor }]} numberOfLines={1}>{emp.code}</Text>
                              )}
                            </View>
                            {week.map((d, di) => {
                              const entry = d ? getEntry(emp.id, d, "day") : null;
                              const isWeekend = d ? (getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6) : false;
                              return (
                                <TouchableOpacity key={di} onPress={() => d && handleCellPress(emp, d, "day")} disabled={!d}
                                  style={[S.cell, { width: CELL_W, backgroundColor: d ? (isWeekend ? "#FF9500" + "0C" : "#007AFF" + "05") : colors.surface + "44", borderRightColor: colors.border + "44" }]}>
                                  <CellDisplay entry={entry} viewMode={viewMode} deptColor={deptColor} colors={colors} shiftType="day" />
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                        {/* 晚班行（仅白晚同屏时显示） */}
                        {showBothShifts && (
                          <View style={S.empRow}>
                            <View style={[S.nameCell, { width: NAME_W, backgroundColor: deptColor + "05" }]}>
                              <View style={{ backgroundColor: deptColor + "33", borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 }}>
                                <Text style={{ fontSize: 9, color: deptColor, fontWeight: "700" }}>晚</Text>
                              </View>
                            </View>
                            {week.map((d, di) => {
                              const entry = d ? getEntry(emp.id, d, "evening") : null;
                              const isWeekend = d ? (getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6) : false;
                              return (
                                <TouchableOpacity key={di} onPress={() => d && handleCellPress(emp, d, "evening")} disabled={!d}
                                  style={[S.cell, { width: CELL_W, backgroundColor: d ? (isWeekend ? deptColor + "0C" : colors.background) : colors.surface + "44", borderRightColor: colors.border + "44" }]}>
                                  <CellDisplay entry={entry} viewMode={viewMode} deptColor={deptColor} colors={colors} shiftType="evening" />
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    );
                  })}

                  {/* 周间隔 */}
                  <View style={{ height: 6, backgroundColor: colors.surface }} />
                </View>
              );
            })}
          </View>
        </ScrollView>

        {/* 薪水条面板 */}
        {showPaySlips && (
          <View style={{ padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: deptColor }} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>
                {monthLabel(currentMonth)} 薪水条
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>({deptEmployees.length} 人)</Text>
            </View>
            {deptEmployees.map((emp) => (
              <PaySlipCard key={emp.id} employee={emp} month={currentMonth} deptColor={deptColor} colors={colors} />
            ))}
          </View>
        )}
      </ScrollView>

      {/* 编辑 Modal */}
      <EditShiftModal
        visible={editModal}
        date={editDate}
        employee={editEmployee}
        shift={editShiftType}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editShiftType) : null}
        viewMode={viewMode}
        deptColor={deptColor}
        colors={colors}
        onSave={(entry) => upsertShift(entry)}
        onClose={() => setEditModal(false)}
      />

      {/* 人员筛选 Modal */}
      <EmployeeFilterModal
        visible={showFilterModal}
        employees={allDeptEmployees}
        selected={selectedEmployeeIds}
        deptColor={deptColor}
        colors={colors}
        onConfirm={(ids) => setSelectedEmployeeIds(ids)}
        onClose={() => setShowFilterModal(false)}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 16 },
  monthLabel: { fontSize: 16, fontWeight: "700", minWidth: 90, textAlign: "center" },
  controlBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: "wrap" },
  segGroup: { flexDirection: "row", borderRadius: 8, padding: 2, gap: 2 },
  segBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 7 },
  headerCell: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  dateRow: { flexDirection: "row", borderBottomWidth: 1, paddingVertical: 5 },
  dateCell: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  empRow: { flexDirection: "row", minHeight: 30 },
  nameCell: { justifyContent: "center", alignItems: "center", paddingHorizontal: 4, gap: 2 },
  empName: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  cell: { alignItems: "center", justifyContent: "center", minHeight: 30, borderRightWidth: StyleSheet.hairlineWidth },
});

const CS = StyleSheet.create({
  cellHours: { fontSize: 12, fontWeight: "700" },
  cellSession: { fontSize: 13, fontWeight: "700" },
  cellSpecial: { fontSize: 9, fontWeight: "600" },
});

const EM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: "700" },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inputSmall: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, width: 64, textAlign: "center" },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  filterCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  filterAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
});

const PSC = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  detailItem: { alignItems: "center", minWidth: 48 },
  detailLabel: { fontSize: 10, color: "#999", marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: "600" },
});
