/**
 * 排班表页面 v2
 * - 午班行 / 晚班行分组显示（按 employee.defaultSession 归属）
 * - 班次模板（午/晚各自设置默认工时和时间段）
 * - 快速填充整行（长按姓名格 → 批量填充本月所有工作日）
 * - Mac 宽屏布局修复（tableWidth 上限 520）
 * - 移除多余的"白/晚"切换按键
 * - 节假日配置入口
 * - 加班预警（超出合同工时标红）
 * - 调休标记（overtime type = comp_off）
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert, Modal, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, useWindowDimensions
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, useShiftStore, useShiftTemplateStore,
  useAttendanceStore, usePaySlipStore,
} from "@/lib/labor/store";
import {
  Employee, EmployeeDept, ShiftEntry, ShiftHoursValue, ShiftSessionValue,
  ShiftTemplate, ShiftSession,
  DEPT_LABELS, DEPT_COLORS, WEEKDAY_LABELS,
  getMonthDates, getDayOfWeek, monthLabel, getContractHoursForDate,
  DEFAULT_SHIFT_TEMPLATES,
} from "@/lib/labor/types";

const DEPT_OPTIONS: EmployeeDept[] = ["front", "kitchen"];
const NOON_COLOR = "#FF9500";
const EVE_COLOR = "#5856D6";

// ─── 单元格显示 ───────────────────────────────────────────────────────────────
function CellDisplay({ entry, contractHours, colors }: {
  entry: ShiftEntry | null;
  contractHours: number;
  colors: any;
}) {
  if (!entry) return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border + "44" }} />;
  const h = entry.hoursValue;
  if (h === "休") return <Text style={[CS.cellSpecial, { color: "#FF3B30" }]}>休</Text>;
  if (h === "无早") return <Text style={[CS.cellSpecial, { color: colors.muted }]}>无早</Text>;
  if (h === null) return <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border + "44" }} />;
  if (typeof h === "number" && h > 0) {
    const isOvertime = contractHours > 0 && h > contractHours;
    const isCompOff = entry.overtimeType === "comp_off";
    return (
      <View style={{ alignItems: "center" }}>
        <Text style={[CS.cellHours, { color: isOvertime ? "#FF3B30" : colors.foreground }]}>{h}h</Text>
        {isCompOff && <Text style={{ fontSize: 8, color: "#34C759", fontWeight: "700" }}>换休</Text>}
        {isOvertime && !isCompOff && <Text style={{ fontSize: 8, color: "#FF3B30", fontWeight: "700" }}>+{(h - contractHours).toFixed(1)}</Text>}
      </View>
    );
  }
  return null;
}

// ─── 单元格编辑 Modal ─────────────────────────────────────────────────────────
function EditShiftModal({ visible, date, employee, session, existing, contractHours, defaultHours, colors, onSave, onClear, onClose }: {
  visible: boolean;
  date: string;
  employee: Employee | null;
  session: ShiftSession;
  existing: ShiftEntry | null;
  contractHours: number;
  defaultHours: number;
  colors: any;
  onSave: (entry: ShiftEntry) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const sessionColor = session === "午" ? NOON_COLOR : EVE_COLOR;
  const dow = date ? getDayOfWeek(date) : 1;

  const [hoursInput, setHoursInput] = useState(
    existing && typeof existing.hoursValue === "number" ? String(existing.hoursValue) : ""
  );
  const [hoursSpecial, setHoursSpecial] = useState<"休" | "无早" | null>(
    existing?.hoursValue === "休" ? "休" : existing?.hoursValue === "无早" ? "无早" : null
  );
  const [overtimeType, setOvertimeType] = useState<"pay" | "comp_off">(
    existing?.overtimeType ?? "pay"
  );

  React.useEffect(() => {
    if (visible) {
      setHoursInput(existing && typeof existing.hoursValue === "number" ? String(existing.hoursValue) : "");
      setHoursSpecial(existing?.hoursValue === "休" ? "休" : existing?.hoursValue === "无早" ? "无早" : null);
      setOvertimeType(existing?.overtimeType ?? "pay");
    }
  }, [visible, existing]);

  if (!employee || !date) return null;

  const currentHours = Number(hoursInput) || 0;
  const isOvertime = contractHours > 0 && currentHours > contractHours && !hoursSpecial;
  const overtimeAmt = isOvertime ? currentHours - contractHours : 0;

  const handleSave = () => {
    let hoursValue: ShiftHoursValue = null;
    if (hoursSpecial) { hoursValue = hoursSpecial; }
    else if (hoursInput) { hoursValue = Number(hoursInput) || null; }
    const shift = session === "午" ? "day" : "evening";
    onSave({
      employeeId: employee.id, date, shift,
      hoursValue,
      sessionValue: session as ShiftSessionValue,
      overtimeType: isOvertime ? overtimeType : "pay",
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[EM.sheet, { backgroundColor: colors.background }]}>
        <View style={[EM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ backgroundColor: sessionColor + "22", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: sessionColor }}>{session}班</Text>
              </View>
              <Text style={[EM.title, { color: colors.foreground }]}>{employee.code}</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.muted }}>{date.slice(5)} {WEEKDAY_LABELS[dow]}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: sessionColor }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={[EM.sectionLabel, { color: colors.muted }]}>工时（小时）</Text>
              {contractHours > 0 && (
                <Text style={{ fontSize: 11, color: colors.muted }}>合同工时：{contractHours}h</Text>
              )}
            </View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {[defaultHours, ...([5, 6, 7, 8, 9, 10, 11, 12].filter((h) => h !== defaultHours))].map((h) => (
                <TouchableOpacity key={h} onPress={() => { tap(); setHoursInput(String(h)); setHoursSpecial(null); }}
                  style={[EM.chip, {
                    backgroundColor: hoursInput === String(h) && !hoursSpecial
                      ? (h > contractHours && contractHours > 0 ? "#FF3B30" : sessionColor)
                      : colors.surface,
                    borderColor: hoursInput === String(h) && !hoursSpecial
                      ? (h > contractHours && contractHours > 0 ? "#FF3B30" : sessionColor)
                      : colors.border,
                  }]}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: hoursInput === String(h) && !hoursSpecial ? "#fff" : colors.muted }}>
                    {h}h{h === defaultHours ? " ★" : ""}
                  </Text>
                </TouchableOpacity>
              ))}
              <TextInput value={hoursInput} onChangeText={(v) => { setHoursInput(v); setHoursSpecial(null); }}
                placeholder="自定义" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[EM.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </View>

          {isOvertime && (
            <View style={{ backgroundColor: "#FF3B3010", borderRadius: 10, padding: 12, gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#FF3B30" }}>
                ⚠️ 加班 +{overtimeAmt.toFixed(1)}h（超出合同工时 {contractHours}h）
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>加班处理方式：</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([["pay", "计加班费"], ["comp_off", "换调休"]] as const).map(([v, label]) => (
                  <TouchableOpacity key={v} onPress={() => { tap(); setOvertimeType(v); }}
                    style={[EM.chip, {
                      backgroundColor: overtimeType === v ? (v === "pay" ? "#FF3B30" : "#34C759") : colors.surface,
                      borderColor: overtimeType === v ? (v === "pay" ? "#FF3B30" : "#34C759") : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: overtimeType === v ? "#fff" : colors.muted }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View>
            <Text style={[EM.sectionLabel, { color: colors.muted }]}>特殊标注</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["休", "无早"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => { tap(); setHoursSpecial(s); setHoursInput(""); }}
                  style={[EM.chip, { backgroundColor: hoursSpecial === s ? "#FF3B30" : colors.surface, borderColor: hoursSpecial === s ? "#FF3B30" : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: hoursSpecial === s ? "#fff" : "#FF3B30" }}>（{s}）</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => { tap(); onClear(); onClose(); }}
                style={[EM.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 13, color: colors.muted }}>清空</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 班次模板设置 Modal ───────────────────────────────────────────────────────
function ShiftTemplateModal({ visible, templates, colors, onSave, onClose }: {
  visible: boolean;
  templates: ShiftTemplate[];
  colors: any;
  onSave: (tpl: ShiftTemplate) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const noonTpl = templates.find((t) => t.session === "午") ?? DEFAULT_SHIFT_TEMPLATES[0];
  const eveTpl = templates.find((t) => t.session === "晚") ?? DEFAULT_SHIFT_TEMPLATES[1];

  const [noonStart, setNoonStart] = useState(noonTpl.startTime);
  const [noonEnd, setNoonEnd] = useState(noonTpl.endTime);
  const [noonHours, setNoonHours] = useState(String(noonTpl.defaultHours));
  const [eveStart, setEveStart] = useState(eveTpl.startTime);
  const [eveEnd, setEveEnd] = useState(eveTpl.endTime);
  const [eveHours, setEveHours] = useState(String(eveTpl.defaultHours));

  const handleSave = () => {
    onSave({ ...noonTpl, startTime: noonStart, endTime: noonEnd, defaultHours: Number(noonHours) || 6 });
    onSave({ ...eveTpl, startTime: eveStart, endTime: eveEnd, defaultHours: Number(eveHours) || 7 });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[EM.sheet, { backgroundColor: colors.background }]}>
        <View style={[EM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[EM.title, { color: colors.foreground }]}>班次模板设置</Text>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
          {[
            { label: "午班", color: NOON_COLOR, start: noonStart, setStart: setNoonStart, end: noonEnd, setEnd: setNoonEnd, hours: noonHours, setHours: setNoonHours },
            { label: "晚班", color: EVE_COLOR, start: eveStart, setStart: setEveStart, end: eveEnd, setEnd: setEveEnd, hours: eveHours, setHours: setEveHours },
          ].map((item) => (
            <View key={item.label} style={{ backgroundColor: item.color + "10", borderRadius: 14, padding: 16, gap: 12, borderWidth: 1, borderColor: item.color + "33" }}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: item.color }}>{item.label}</Text>
              <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>开始时间</Text>
                  <TextInput value={item.start} onChangeText={item.setStart} placeholder="11:00"
                    placeholderTextColor={colors.muted}
                    style={[EM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                </View>
                <Text style={{ color: colors.muted, paddingBottom: 8 }}>—</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>结束时间</Text>
                  <TextInput value={item.end} onChangeText={item.setEnd} placeholder="17:00"
                    placeholderTextColor={colors.muted}
                    style={[EM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>默认工时</Text>
                  <TextInput value={item.hours} onChangeText={item.setHours} placeholder="6"
                    placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                    style={[EM.inputSmall, { color: colors.foreground, borderColor: item.color, width: "100%" }]} />
                </View>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted }}>添加排班时自动带入 {item.hours}h，可单独修改</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 薪水条卡片 ───────────────────────────────────────────────────────────────
function PaySlipCard({ employee, month, sessionColor, colors }: {
  employee: Employee; month: string; sessionColor: string; colors: any;
}) {
  const { getPaySlip } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();
  const slip = getPaySlip(employee.id, month);
  const att = getAttendance(employee.id, month);
  return (
    <View style={[PSC.card, { backgroundColor: colors.surface, borderColor: sessionColor + "33" }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <View style={[PSC.avatar, { backgroundColor: sessionColor + "22" }]}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: sessionColor }}>{employee.code.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{employee.code} · {employee.realName}</Text>
          <Text style={{ fontSize: 11, color: colors.muted }}>{monthLabel(month)} · {employee.type === "fulltime" ? "全职" : "兼职"}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {slip ? (
            <Text style={{ fontSize: 18, fontWeight: "800", color: sessionColor }}>¥{slip.finalSalary.toFixed(0)}</Text>
          ) : att ? (
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.muted }}>¥{att.attendanceSalary.toFixed(0)}</Text>
          ) : (
            <Text style={{ fontSize: 12, color: colors.border }}>未填写</Text>
          )}
          {slip && <Text style={{ fontSize: 10, color: colors.muted }}>最终薪资</Text>}
          {!slip && att && <Text style={{ fontSize: 10, color: colors.muted }}>考勤薪资</Text>}
        </View>
      </View>
      {att && (
        <View style={[PSC.detailRow, { borderTopColor: colors.border }]}>
          <View style={PSC.detailItem}><Text style={PSC.detailLabel}>出勤</Text><Text style={[PSC.detailValue, { color: colors.foreground }]}>{att.attendanceDays}天</Text></View>
          <View style={PSC.detailItem}><Text style={PSC.detailLabel}>工时</Text><Text style={[PSC.detailValue, { color: colors.foreground }]}>{att.totalHours}h</Text></View>
          {att.overtimeHours > 0 && <View style={PSC.detailItem}><Text style={PSC.detailLabel}>加班</Text><Text style={[PSC.detailValue, { color: "#FF3B30" }]}>+{att.overtimeHours.toFixed(1)}h</Text></View>}
          {att.compOffHours > 0 && <View style={PSC.detailItem}><Text style={PSC.detailLabel}>换休</Text><Text style={[PSC.detailValue, { color: "#34C759" }]}>{att.compOffHours.toFixed(1)}h</Text></View>}
        </View>
      )}
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
  const { shifts, upsertShift, batchUpsertShifts, deleteShift, getShifts } = useShiftStore();
  const { templates, upsertTemplate, getTemplate } = useShiftTemplateStore();

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [dept, setDept] = useState<EmployeeDept>("front");
  const [showPaySlips, setShowPaySlips] = useState(false);
  const [showTplModal, setShowTplModal] = useState(false);

  const [editModal, setEditModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editSession, setEditSession] = useState<ShiftSession>("晚");

  const { width: screenWidth } = useWindowDimensions();
  const MAX_TABLE_W = 520;
  const NAME_W = 60;
  const availableW = Math.min(screenWidth, MAX_TABLE_W) - NAME_W - 2;
  const CELL_W = Math.max(36, Math.min(52, Math.floor(availableW / 7)));
  const tableWidth = NAME_W + CELL_W * 7;

  const deptColor = DEPT_COLORS[dept];
  const dates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);

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

  const allDeptEmployees = useMemo(() =>
    employees.filter((e) => e.active && (e.dept === dept || (dept === "front" && e.dept === "parttime"))),
    [employees, dept]
  );

  const noonEmployees = useMemo(() =>
    allDeptEmployees.filter((e) => e.defaultSession === "午"),
    [allDeptEmployees]
  );
  const eveEmployees = useMemo(() =>
    allDeptEmployees.filter((e) => e.defaultSession === "晚" || !e.defaultSession),
    [allDeptEmployees]
  );

  const monthShifts = useMemo(() => getShifts(currentMonth), [shifts, currentMonth]);

  const getEntry = useCallback((employeeId: string, date: string, session: ShiftSession): ShiftEntry | null => {
    const shift = session === "午" ? "day" : "evening";
    return monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === shift) ?? null;
  }, [monthShifts]);

  const handleCellPress = (employee: Employee, date: string, session: ShiftSession) => {
    tap();
    setEditEmployee(employee);
    setEditDate(date);
    setEditSession(session);
    setEditModal(true);
  };

  const handleFillRow = (employee: Employee, session: ShiftSession) => {
    tap();
    const tpl = getTemplate(session);
    const defaultHours = tpl?.defaultHours ?? (session === "午" ? 6 : 7);
    const shift = session === "午" ? "day" : "evening";
    Alert.alert(
      `快速填充 ${employee.code} ${session}班`,
      `将本月所有工作日（周一~周五）填入 ${defaultHours}h，已有数据不覆盖。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "填充工作日",
          onPress: () => {
            const entries: ShiftEntry[] = dates
              .filter((d) => { const dow = getDayOfWeek(d); return dow !== 0 && dow !== 6; })
              .filter((d) => !getEntry(employee.id, d, session))
              .map((d) => ({ employeeId: employee.id, date: d, shift, hoursValue: defaultHours, sessionValue: session as ShiftSessionValue, overtimeType: "pay" as const }));
            if (entries.length > 0) batchUpsertShifts(entries);
          },
        },
        {
          text: "填充全月",
          onPress: () => {
            const entries: ShiftEntry[] = dates
              .filter((d) => !getEntry(employee.id, d, session))
              .map((d) => ({ employeeId: employee.id, date: d, shift, hoursValue: defaultHours, sessionValue: session as ShiftSessionValue, overtimeType: "pay" as const }));
            if (entries.length > 0) batchUpsertShifts(entries);
          },
        },
      ]
    );
  };

  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  const noonTpl = getTemplate("午") ?? DEFAULT_SHIFT_TEMPLATES[0];
  const eveTpl = getTemplate("晚") ?? DEFAULT_SHIFT_TEMPLATES[1];

  const renderSessionGroup = (session: ShiftSession, empList: Employee[]) => {
    if (empList.length === 0) return null;
    const sessionColor = session === "午" ? NOON_COLOR : EVE_COLOR;
    const tpl = session === "午" ? noonTpl : eveTpl;
    const allDates = weeks.flat();

    return (
      <View key={session} style={{ marginBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: sessionColor + "12" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sessionColor }} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: sessionColor }}>
            {session}班 · {tpl.startTime}–{tpl.endTime} · 默认{tpl.defaultHours}h
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 4 }}>({empList.length}人)</Text>
        </View>
        {empList.map((emp) => (
          <View key={emp.id} style={[S.empRow, { borderBottomColor: colors.border + "33", borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <TouchableOpacity
              onLongPress={() => handleFillRow(emp, session)}
              style={[S.nameCell, { width: NAME_W, backgroundColor: sessionColor + "08" }]}>
              <Text style={[S.empName, { color: sessionColor }]} numberOfLines={1}>{emp.code}</Text>
              <Text style={{ fontSize: 9, color: colors.muted }} numberOfLines={1}>{emp.realName.slice(0, 3)}</Text>
            </TouchableOpacity>
            {allDates.map((d, idx) => {
              const entry = d ? getEntry(emp.id, d, session) : null;
              const contractH = d ? getContractHoursForDate(emp, d) : 0;
              const isWeekend = d ? (getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6) : false;
              const isToday = d === new Date().toISOString().slice(0, 10);
              return (
                <TouchableOpacity key={idx} onPress={() => d && handleCellPress(emp, d, session)} disabled={!d}
                  style={[S.cell, {
                    width: CELL_W,
                    backgroundColor: !d ? colors.surface + "44"
                      : isToday ? sessionColor + "15"
                      : isWeekend ? sessionColor + "08"
                      : colors.background,
                    borderRightColor: colors.border + "33",
                  }]}>
                  <CellDisplay entry={entry} contractHours={contractH} colors={colors} />
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const editTpl = editSession === "午" ? noonTpl : eveTpl;
  const editContractH = editEmployee && editDate ? getContractHoursForDate(editEmployee, editDate) : 0;

  return (
    <ScreenContainer>
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>排班表</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => router.push("/labor-holidays" as any)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="calendar.badge.exclamationmark" size={20} color={colors.muted} />
          </Pressable>
          <Pressable onPress={() => { tap(); setShowTplModal(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="gearshape.fill" size={20} color={colors.muted} />
          </Pressable>
          <Pressable onPress={() => { tap(); setShowPaySlips((v) => !v); }}
            style={{ backgroundColor: showPaySlips ? colors.primary + "22" : "transparent", borderRadius: 8, padding: 4 }}>
            <IconSymbol name="banknote.fill" size={20} color={showPaySlips ? colors.primary : colors.muted} />
          </Pressable>
        </View>
      </View>

      <View style={[S.monthBar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => { tap(); prevMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}>
          <IconSymbol name="chevron.left" size={18} color={colors.primary} />
        </Pressable>
        <Text style={[S.monthLabel, { color: colors.foreground }]}>{monthLabel(currentMonth)}</Text>
        <Pressable onPress={() => { tap(); nextMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}>
          <IconSymbol name="chevron.right" size={18} color={colors.primary} />
        </Pressable>
      </View>

      <View style={[S.controlBar, { borderBottomColor: colors.border }]}>
        <View style={[S.segGroup, { backgroundColor: colors.border + "33" }]}>
          {DEPT_OPTIONS.map((d) => (
            <TouchableOpacity key={d} onPress={() => { tap(); setDept(d); }}
              style={[S.segBtn, dept === d && { backgroundColor: DEPT_COLORS[d] }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: dept === d ? "#fff" : colors.muted }}>{DEPT_LABELS[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={{ fontSize: 11, color: colors.muted, marginLeft: "auto" }}>长按姓名快速填充</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ width: tableWidth }}>
            <View style={[S.tableHeaderRow, { backgroundColor: deptColor + "18", borderBottomColor: deptColor + "44" }]}>
              <View style={{ width: NAME_W, paddingLeft: 8 }}>
                <Text style={[S.headerCell, { color: deptColor }]}>姓名</Text>
              </View>
              {weeks.map((week, wi) =>
                week.map((d, di) => {
                  const dow = d ? getDayOfWeek(d) : ((wi * 7 + di + 1) % 7);
                  const dayLabel = ["日", "一", "二", "三", "四", "五", "六"][dow];
                  return (
                    <View key={`h-${wi}-${di}`} style={{ width: CELL_W, alignItems: "center" }}>
                      <Text style={[S.headerCell, { color: dow === 0 || dow === 6 ? colors.error : deptColor }]}>周{dayLabel}</Text>
                    </View>
                  );
                })
              )}
            </View>

            <View style={[S.dateRow, { backgroundColor: "#FF9500" + "22", borderBottomColor: "#FF9500" + "55" }]}>
              <View style={{ width: NAME_W, paddingLeft: 8 }}>
                <Text style={[S.dateCell, { color: "#FF9500" }]}>日期</Text>
              </View>
              {weeks.map((week, wi) =>
                week.map((d, di) => {
                  const isToday = d === new Date().toISOString().slice(0, 10);
                  return (
                    <View key={`d-${wi}-${di}`} style={{ width: CELL_W, alignItems: "center" }}>
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
                })
              )}
            </View>

            {renderSessionGroup("午", noonEmployees)}
            {renderSessionGroup("晚", eveEmployees)}
          </View>
        </ScrollView>

        {showPaySlips && (
          <View style={{ padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: deptColor }} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>{monthLabel(currentMonth)} 薪水条</Text>
            </View>
            {[...noonEmployees, ...eveEmployees].map((emp) => (
              <PaySlipCard key={emp.id} employee={emp} month={currentMonth}
                sessionColor={emp.defaultSession === "午" ? NOON_COLOR : EVE_COLOR} colors={colors} />
            ))}
          </View>
        )}
      </ScrollView>

      <EditShiftModal
        visible={editModal}
        date={editDate}
        employee={editEmployee}
        session={editSession}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editSession) : null}
        contractHours={editContractH}
        defaultHours={editTpl.defaultHours}
        colors={colors}
        onSave={(entry) => upsertShift(entry)}
        onClear={() => {
          if (editEmployee && editDate) {
            deleteShift(editEmployee.id, editDate, editSession === "午" ? "day" : "evening");
          }
        }}
        onClose={() => setEditModal(false)}
      />

      <ShiftTemplateModal
        visible={showTplModal}
        templates={templates}
        colors={colors}
        onSave={upsertTemplate}
        onClose={() => setShowTplModal(false)}
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
  empRow: { flexDirection: "row", minHeight: 34 },
  nameCell: { justifyContent: "center", alignItems: "center", paddingHorizontal: 4, gap: 1 },
  empName: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  cell: { alignItems: "center", justifyContent: "center", minHeight: 34, borderRightWidth: StyleSheet.hairlineWidth },
});

const CS = StyleSheet.create({
  cellHours: { fontSize: 12, fontWeight: "700" },
  cellSpecial: { fontSize: 9, fontWeight: "600" },
});

const EM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: "700" },
  sectionLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inputSmall: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, textAlign: "center" },
});

const PSC = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginHorizontal: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  detailItem: { alignItems: "center", minWidth: 48 },
  detailLabel: { fontSize: 10, color: "#999", marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: "600" },
});
