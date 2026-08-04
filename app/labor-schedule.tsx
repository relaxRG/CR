/**
 * 排班表页面 v4
 * 布局：固定左侧姓名列 + 右侧按日展开横向滚动（参考钉钉/飞书排班表）
 * - 按日展开（一月最多31列），不再按周分组
 * - 动态班次分行（从 ShiftTemplate 列表读取，不硬编码）
 * - 班次模板支持增删改任意数量班次
 * - 快速填充整行（长按姓名格）
 * - 旧数据自动迁移（"day"→"午班"，"evening"→"晚班"，"午"→"午班"，"晚"→"晚班"）
 * - 加班预警（超出合同工时标红）
 * - 调休标记
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
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
  Employee, EmployeeDept, ShiftEntry, ShiftHoursValue,
  ShiftTemplate,
  DEPT_LABELS, DEPT_COLORS,
  getMonthDates, getDayOfWeek, monthLabel, getContractHoursForDate,
  DEFAULT_SHIFT_TEMPLATES, SHIFT_COLOR_PRESETS,
} from "@/lib/labor/types";

const DEPT_OPTIONS: EmployeeDept[] = ["front", "kitchen"];
const NAME_W = 64;   // 左侧固定姓名列宽
const CELL_W = 44;   // 每天列宽
const ROW_H = 38;    // 行高

/** 旧数据迁移：将各种旧班次标识统一映射到新班次名称 */
function migrateShiftName(shift: string): string {
  if (shift === "day" || shift === "午") return "午班";
  if (shift === "evening" || shift === "晚") return "晚班";
  if (shift === "both") return "午班";
  return shift;
}

// ─── 单元格显示 ───────────────────────────────────────────────────────────────
function CellDisplay({ entry, contractHours, tplColor, colors }: {
  entry: ShiftEntry | null;
  contractHours: number;
  tplColor: string;
  colors: any;
}) {
  if (!entry) return null;
  const h = entry.hoursValue;
  if (h === "休") return (
    <View style={[CS.badge, { backgroundColor: colors.error + "22" }]}>
      <Text style={[CS.badgeText, { color: colors.error }]}>休</Text>
    </View>
  );
  if (h === "无早") return (
    <View style={[CS.badge, { backgroundColor: colors.muted + "22" }]}>
      <Text style={[CS.badgeText, { color: colors.muted }]}>无早</Text>
    </View>
  );
  if (typeof h === "number" && h > 0) {
    const isOvertime = contractHours > 0 && h > contractHours;
    const isCompOff = entry.overtimeType === "comp_off";
    const dotColor = isCompOff ? colors.success : colors.error;
    return (
      <View style={{ alignItems: "center" }}>
        <Text style={[CS.hours, {
          color: isOvertime ? dotColor : tplColor,
          fontWeight: isOvertime ? "800" : "600",
        }]}>{h}</Text>
        {isOvertime && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor, marginTop: 1 }} />}
      </View>
    );
  }
  return null;
}

// ─── 单元格编辑 Modal ─────────────────────────────────────────────────────────
function EditShiftModal({ visible, date, employee, session, sessionColor, existing, contractHours, defaultHours, colors, onSave, onClear, onClose }: {
  visible: boolean; date: string; employee: Employee | null; session: string;
  sessionColor: string; existing: ShiftEntry | null; contractHours: number;
  defaultHours: number; colors: any;
  onSave: (entry: ShiftEntry) => void; onClear: () => void; onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];
  const dow = date ? getDayOfWeek(date) : 1;

  const [hoursInput, setHoursInput] = useState("");
  const [hoursSpecial, setHoursSpecial] = useState<"休" | "无早" | null>(null);
  const [overtimeType, setOvertimeType] = useState<"pay" | "comp_off">("pay");

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
    onSave({ employeeId: employee.id, date, shift: session, hoursValue, sessionValue: session, overtimeType: isOvertime ? overtimeType : "pay" });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[EM.sheet, { backgroundColor: colors.background }]}>
        <View style={[EM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[EM.title, { color: colors.foreground }]}>{employee.code} · {session}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{date} 周{DOW[dow]}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: sessionColor }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={[EM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[EM.label, { color: colors.foreground }]}>工时（小时）</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 }}>
              <TextInput value={hoursInput} onChangeText={(t) => { setHoursInput(t); setHoursSpecial(null); }}
                placeholder={`默认 ${defaultHours}h`} placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[EM.input, { color: colors.foreground, borderColor: sessionColor, flex: 1 }]} />
              <Text style={{ color: colors.muted }}>h</Text>
            </View>
            {contractHours > 0 && (
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                合同工时：{contractHours}h/天{isOvertime ? `  ·  加班 +${overtimeAmt.toFixed(1)}h` : ""}
              </Text>
            )}
          </View>
          <View style={[EM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[EM.label, { color: colors.foreground }]}>特殊标注</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              {(["休", "无早"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => { tap(); setHoursSpecial(hoursSpecial === s ? null : s); setHoursInput(""); }}
                  style={[EM.chip, { backgroundColor: hoursSpecial === s ? (s === "休" ? colors.error : colors.muted) : colors.surface, borderColor: s === "休" ? colors.error : colors.muted }]}>
                  <Text style={{ fontSize: 13, color: hoursSpecial === s ? "#fff" : colors.muted }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {isOvertime && (
            <View style={[EM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[EM.label, { color: colors.foreground }]}>加班处理（+{overtimeAmt.toFixed(1)}h）</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {([["pay", "计加班费"], ["comp_off", "换调休"]] as const).map(([v, label]) => (
                  <TouchableOpacity key={v} onPress={() => { tap(); setOvertimeType(v); }}
                    style={[EM.chip, { backgroundColor: overtimeType === v ? sessionColor : colors.surface, borderColor: sessionColor }]}>
                    <Text style={{ fontSize: 13, color: overtimeType === v ? "#fff" : sessionColor }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {existing && (
            <TouchableOpacity onPress={() => { tap(); onClear(); onClose(); }}
              style={[EM.chip, { borderColor: colors.error, alignSelf: "center", paddingHorizontal: 24 }]}>
              <Text style={{ color: colors.error }}>清除此排班</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 班次模板设置 Modal（支持增删改任意班次） ────────────────────────────────
function ShiftTemplateModal({ visible, templates, colors, onSave, onDelete, onClose }: {
  visible: boolean; templates: ShiftTemplate[]; colors: any;
  onSave: (tpl: ShiftTemplate) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [localTemplates, setLocalTemplates] = useState<ShiftTemplate[]>(() =>
    [...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );

  React.useEffect(() => {
    if (visible) setLocalTemplates([...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
  }, [visible, templates]);

  const updateLocal = (id: string, patch: Partial<ShiftTemplate>) =>
    setLocalTemplates((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));

  const addNew = () => {
    tap();
    setLocalTemplates((prev) => [...prev, {
      id: `tpl_${Date.now()}`,
      session: "新班次",
      startTime: "09:00", endTime: "18:00", defaultHours: 8,
      color: SHIFT_COLOR_PRESETS[prev.length % SHIFT_COLOR_PRESETS.length],
      sortOrder: prev.length,
    }]);
  };

  const removeLocal = (id: string) => {
    tap();
    Alert.alert("删除班次", "删除后该班次历史排班记录不受影响，但新排班将无法选择此班次。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => setLocalTemplates((prev) => prev.filter((t) => t.id !== id)) },
    ]);
  };

  const handleSave = () => {
    const existingIds = templates.map((t) => t.id);
    const localIds = localTemplates.map((t) => t.id);
    existingIds.filter((id) => !localIds.includes(id)).forEach((id) => onDelete(id));
    localTemplates.forEach((tpl, i) => onSave({ ...tpl, sortOrder: i }));
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
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          {localTemplates.map((tpl) => (
            <View key={tpl.id} style={{ backgroundColor: tpl.color + "10", borderRadius: 14, padding: 16, gap: 12, borderWidth: 1, borderColor: tpl.color + "44" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tpl.color }} />
                <TextInput value={tpl.session} onChangeText={(v) => updateLocal(tpl.id, { session: v })}
                  placeholder="班次名称" placeholderTextColor={colors.muted}
                  style={{ flex: 1, fontSize: 15, fontWeight: "700", color: tpl.color, paddingVertical: 2 }} />
                <TouchableOpacity onPress={() => removeLocal(tpl.id)} style={{ padding: 4 }}>
                  <IconSymbol name="trash" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>开始时间</Text>
                  <TextInput value={tpl.startTime} onChangeText={(v) => updateLocal(tpl.id, { startTime: v })}
                    placeholder="10:30" placeholderTextColor={colors.muted}
                    style={[EM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                </View>
                <Text style={{ color: colors.muted, paddingBottom: 10 }}>—</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>结束时间</Text>
                  <TextInput value={tpl.endTime} onChangeText={(v) => updateLocal(tpl.id, { endTime: v })}
                    placeholder="17:00" placeholderTextColor={colors.muted}
                    style={[EM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>默认工时</Text>
                  <TextInput value={String(tpl.defaultHours)} onChangeText={(v) => updateLocal(tpl.id, { defaultHours: Number(v) || tpl.defaultHours })}
                    placeholder="8" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                    style={[EM.inputSmall, { color: colors.foreground, borderColor: tpl.color, width: "100%" }]} />
                </View>
              </View>
              <View>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>班次颜色</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {SHIFT_COLOR_PRESETS.map((c) => (
                    <TouchableOpacity key={c} onPress={() => { tap(); updateLocal(tpl.id, { color: c }); }}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c,
                        borderWidth: tpl.color === c ? 3 : 1, borderColor: tpl.color === c ? colors.foreground : c + "44" }} />
                  ))}
                </View>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted }}>添加排班时自动带入 {tpl.defaultHours}h，可单独修改</Text>
            </View>
          ))}
          <TouchableOpacity onPress={addNew}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary + "66" }}>
            <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加班次</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>
            参考：早班 / 午班 / 晚班 / 大夜班 / 全天班 / 中班
          </Text>
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
  const { shifts, upsertShift, batchUpsertShifts, deleteShift, getShifts } = useShiftStore();
  const { templates, upsertTemplate, deleteTemplate } = useShiftTemplateStore();
  const { getPaySlip } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const [currentMonth, setCurrentMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [dept, setDept] = useState<EmployeeDept>("front");
  const [showPaySlips, setShowPaySlips] = useState(false);
  const [showTplModal, setShowTplModal] = useState(false);

  const [editModal, setEditModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editSession, setEditSession] = useState<string>("晚班");

  // 按 sortOrder 排序的班次模板列表（动态，不硬编码）
  const sortedTemplates = useMemo(() =>
    [...(templates.length > 0 ? templates : DEFAULT_SHIFT_TEMPLATES)]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [templates]
  );

  // 当月所有日期（按日展开，不按周分组）
  const dates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);
  const deptColor = DEPT_COLORS[dept];

  // 当月排班数据（含旧数据迁移）
  const monthShifts = useMemo(() =>
    getShifts(currentMonth).map((s) => ({ ...s, shift: migrateShiftName(s.shift) })),
    [shifts, currentMonth]
  );

  // 当前部门的在职员工
  const allDeptEmployees = useMemo(() =>
    employees.filter((e) => e.active && (e.dept === dept || (dept === "front" && e.dept === "parttime"))),
    [employees, dept]
  );

  // 按班次分组员工（动态，支持旧数据迁移）
  const employeesBySession = useMemo(() => {
    const map: Record<string, Employee[]> = {};
    for (const tpl of sortedTemplates) {
      // 同时兼容旧值（"午"→"午班"，"晚"→"晚班"）
      map[tpl.session] = allDeptEmployees.filter((e) => {
        const s = migrateShiftName(e.defaultSession ?? "");
        return s === tpl.session;
      });
    }
    // 未分配班次的员工放到最后一个班次行
    const unassigned = allDeptEmployees.filter((e) => {
      const s = migrateShiftName(e.defaultSession ?? "");
      return !sortedTemplates.find((t) => t.session === s);
    });
    if (sortedTemplates.length > 0) {
      const lastSession = sortedTemplates[sortedTemplates.length - 1].session;
      map[lastSession] = [...(map[lastSession] ?? []), ...unassigned];
    }
    return map;
  }, [allDeptEmployees, sortedTemplates]);

  const getEntry = useCallback((employeeId: string, date: string, session: string): ShiftEntry | null =>
    monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === session) ?? null,
    [monthShifts]
  );

  const handleCellPress = (employee: Employee, date: string, session: string) => {
    tap();
    setEditEmployee(employee);
    setEditDate(date);
    setEditSession(session);
    setEditModal(true);
  };

  const handleFillRow = (employee: Employee, session: string) => {
    tap();
    const tpl = sortedTemplates.find((t) => t.session === session) ?? sortedTemplates[0];
    const defaultHours = tpl?.defaultHours ?? 8;
    Alert.alert(
      `快速填充 ${employee.code} ${session}`,
      `将本月所有工作日（周一~周五）填入 ${defaultHours}h，已有数据不覆盖。`,
      [
        { text: "取消", style: "cancel" },
        { text: "填充工作日", onPress: () => {
          const entries = dates.filter((d) => { const dow = getDayOfWeek(d); return dow !== 0 && dow !== 6; })
            .filter((d) => !getEntry(employee.id, d, session))
            .map((d): ShiftEntry => ({ employeeId: employee.id, date: d, shift: session, hoursValue: defaultHours, sessionValue: session, overtimeType: "pay" }));
          if (entries.length > 0) batchUpsertShifts(entries);
        }},
        { text: "填充全月", onPress: () => {
          const entries = dates.filter((d) => !getEntry(employee.id, d, session))
            .map((d): ShiftEntry => ({ employeeId: employee.id, date: d, shift: session, hoursValue: defaultHours, sessionValue: session, overtimeType: "pay" }));
          if (entries.length > 0) batchUpsertShifts(entries);
        }},
      ]
    );
  };

  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  const editTpl = sortedTemplates.find((t) => t.session === editSession) ?? sortedTemplates[0] ?? DEFAULT_SHIFT_TEMPLATES[0];
  const editContractH = editEmployee && editDate ? getContractHoursForDate(editEmployee, editDate) : 0;

  const DOW_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
  const totalW = CELL_W * dates.length;

  // ─── 渲染班次分组 ──────────────────────────────────────────────────────────
  const renderSessionGroup = (tpl: ShiftTemplate) => {
    const empList = employeesBySession[tpl.session] ?? [];
    if (empList.length === 0) return null;

    return (
      <View key={tpl.session}>
        {/* 班次标题行（固定在左侧，不参与横向滚动） */}
        <View style={[S.sessionHeader, { backgroundColor: tpl.color + "15", borderLeftColor: tpl.color }]}>
          <View style={{ width: NAME_W, paddingLeft: 10 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: tpl.color }}>{tpl.session}</Text>
            <Text style={{ fontSize: 9, color: tpl.color + "99" }}>{tpl.startTime}–{tpl.endTime} · {tpl.defaultHours}h</Text>
          </View>
          {/* 占位（右侧日期区域不需要内容） */}
        </View>

        {/* 员工行（左侧固定姓名 + 右侧滚动日期格） */}
        {empList.map((emp) => {
          const slip = getPaySlip(emp.id, currentMonth);
          const att = getAttendance(emp.id, currentMonth);
          return (
            <View key={emp.id} style={[S.empRow, { borderBottomColor: colors.border + "33" }]}>
              {/* 左侧固定姓名格 */}
              <TouchableOpacity
                onLongPress={() => handleFillRow(emp, tpl.session)}
                style={[S.nameCell, { width: NAME_W, backgroundColor: tpl.color + "08", borderRightColor: tpl.color + "33" }]}>
                <Text style={[S.empCode, { color: tpl.color }]} numberOfLines={1}>{emp.code}</Text>
                <Text style={[S.empName, { color: colors.muted }]} numberOfLines={1}>{emp.realName.slice(0, 4)}</Text>
                {(slip || att) && (
                  <Text style={{ fontSize: 8, color: tpl.color + "99" }} numberOfLines={1}>
                    {slip ? `¥${slip.finalSalary.toFixed(0)}` : att ? `${att.attendanceDays}天` : ""}
                  </Text>
                )}
              </TouchableOpacity>
              {/* 右侧日期格（通过外层 ScrollView 同步滚动） */}
              {dates.map((d) => {
                const entry = getEntry(emp.id, d, tpl.session);
                const contractH = getContractHoursForDate(emp, d);
                const dow = getDayOfWeek(d);
                const isWeekend = dow === 0 || dow === 6;
                const isToday = d === todayStr;
                return (
                  <TouchableOpacity key={d} onPress={() => handleCellPress(emp, d, tpl.session)}
                    style={[S.cell, {
                      width: CELL_W,
                      backgroundColor: isToday ? tpl.color + "18" : isWeekend ? tpl.color + "07" : "transparent",
                      borderRightColor: colors.border + "22",
                    }]}>
                    <CellDisplay entry={entry} contractHours={contractH} tplColor={tpl.color} colors={colors} />
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </View>
    );
  };

  // ─── 主渲染 ────────────────────────────────────────────────────────────────
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

      {/* 月份切换 */}
      <View style={[S.monthBar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => { tap(); prevMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}>
          <IconSymbol name="chevron.left" size={18} color={colors.primary} />
        </Pressable>
        <Text style={[S.monthLabel, { color: colors.foreground }]}>{monthLabel(currentMonth)}</Text>
        <Pressable onPress={() => { tap(); nextMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 8 })}>
          <IconSymbol name="chevron.right" size={18} color={colors.primary} />
        </Pressable>
      </View>

      {/* 部门切换 */}
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

      {/* 排班表主体：固定左侧 + 右侧横向滚动 */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        {/* 整体横向滚动容器（表头+所有员工行同步） */}
        <ScrollView horizontal showsHorizontalScrollIndicator={true} bounces={false}>
          <View>
            {/* ── 固定表头：左侧"姓名"占位 + 右侧日期列 ── */}
            <View style={[S.headerRow, { backgroundColor: deptColor + "15", borderBottomColor: deptColor + "55" }]}>
              <View style={[S.nameCell, { width: NAME_W, backgroundColor: deptColor + "20", borderRightColor: deptColor + "44" }]}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: deptColor }}>姓名</Text>
              </View>
              {dates.map((d) => {
                const dow = getDayOfWeek(d);
                const isWeekend = dow === 0 || dow === 6;
                const isToday = d === todayStr;
                const dayNum = Number(d.slice(8));
                return (
                  <View key={d} style={[S.headerCell, {
                    width: CELL_W,
                    backgroundColor: isToday ? deptColor + "30" : "transparent",
                    borderRightColor: colors.border + "22",
                  }]}>
                    <Text style={{ fontSize: 9, color: isWeekend ? colors.error : deptColor, fontWeight: "600" }}>
                      {DOW_LABELS[dow]}
                    </Text>
                    <View style={isToday ? { backgroundColor: deptColor, borderRadius: 9, width: 18, height: 18, alignItems: "center", justifyContent: "center" } : undefined}>
                      <Text style={{ fontSize: 11, fontWeight: isToday ? "800" : "600", color: isToday ? "#fff" : isWeekend ? colors.error : colors.foreground }}>
                        {dayNum}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* ── 各班次分组 ── */}
            {sortedTemplates.map((tpl) => renderSessionGroup(tpl))}

            {/* ── 薪水条（可选展开） ── */}
            {showPaySlips && (
              <View style={{ paddingVertical: 12, paddingHorizontal: 8, gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: deptColor }} />
                  <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>{monthLabel(currentMonth)} 薪水条</Text>
                </View>
                {allDeptEmployees.map((emp) => {
                  const tpl = sortedTemplates.find((t) => t.session === migrateShiftName(emp.defaultSession ?? "")) ?? sortedTemplates[sortedTemplates.length - 1] ?? DEFAULT_SHIFT_TEMPLATES[1];
                  const slip = getPaySlip(emp.id, currentMonth);
                  const att = getAttendance(emp.id, currentMonth);
                  const sessionColor = tpl?.color ?? "#5856D6";
                  return (
                    <View key={emp.id} style={[PSC.card, { backgroundColor: colors.surface, borderColor: sessionColor + "33" }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={[PSC.avatar, { backgroundColor: sessionColor + "22" }]}>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: sessionColor }}>{emp.code.slice(0, 2)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{emp.code} · {emp.realName}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>{tpl?.session ?? "—"} · {emp.type === "fulltime" ? "全职" : "兼职"}</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          {slip ? <Text style={{ fontSize: 17, fontWeight: "800", color: sessionColor }}>¥{slip.finalSalary.toFixed(0)}</Text>
                            : att ? <Text style={{ fontSize: 15, fontWeight: "700", color: colors.muted }}>¥{att.attendanceSalary.toFixed(0)}</Text>
                            : <Text style={{ fontSize: 12, color: colors.border }}>未填写</Text>}
                          <Text style={{ fontSize: 9, color: colors.muted }}>{slip ? "最终薪资" : att ? "考勤薪资" : ""}</Text>
                        </View>
                      </View>
                      {att && (
                        <View style={[PSC.detailRow, { borderTopColor: colors.border }]}>
                          <View style={PSC.di}><Text style={PSC.dl}>出勤</Text><Text style={[PSC.dv, { color: colors.foreground }]}>{att.attendanceDays}天</Text></View>
                          <View style={PSC.di}><Text style={PSC.dl}>工时</Text><Text style={[PSC.dv, { color: colors.foreground }]}>{att.totalHours}h</Text></View>
                          {att.overtimeHours > 0 && <View style={PSC.di}><Text style={PSC.dl}>加班</Text><Text style={[PSC.dv, { color: colors.error }]}>+{att.overtimeHours.toFixed(1)}h</Text></View>}
                          {((att.compOffCount ?? 0) * (att.hoursPerCompOff ?? 8)) > 0 && <View style={PSC.di}><Text style={PSC.dl}>换休</Text><Text style={[PSC.dv, { color: colors.success }]}>{((att.compOffCount ?? 0) * (att.hoursPerCompOff ?? 8)).toFixed(1)}h</Text></View>}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </ScrollView>

      {/* 编辑单元格 Modal */}
      <EditShiftModal
        visible={editModal} date={editDate} employee={editEmployee}
        session={editSession} sessionColor={editTpl?.color ?? "#5856D6"}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editSession) : null}
        contractHours={editContractH} defaultHours={editTpl?.defaultHours ?? 8}
        colors={colors}
        onSave={(entry) => upsertShift(entry)}
        onClear={() => { if (editEmployee && editDate) deleteShift(editEmployee.id, editDate, editSession); }}
        onClose={() => setEditModal(false)}
      />

      {/* 班次模板设置 Modal */}
      <ShiftTemplateModal
        visible={showTplModal} templates={sortedTemplates} colors={colors}
        onSave={upsertTemplate} onDelete={deleteTemplate}
        onClose={() => setShowTplModal(false)}
      />
    </ScreenContainer>
  );
}

// ─── 样式 ─────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "700" },
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  monthLabel: { fontSize: 17, fontWeight: "700" },
  controlBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  segGroup: { flexDirection: "row", borderRadius: 8, overflow: "hidden", padding: 2 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  headerRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  headerCell: { height: ROW_H, alignItems: "center", justifyContent: "center", gap: 1, borderRightWidth: StyleSheet.hairlineWidth },
  sessionHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 5, borderLeftWidth: 3 },
  empRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  nameCell: { height: ROW_H + 8, justifyContent: "center", alignItems: "center", borderRightWidth: 1 },
  empCode: { fontSize: 11, fontWeight: "700" },
  empName: { fontSize: 9 },
  cell: { height: ROW_H + 8, alignItems: "center", justifyContent: "center", borderRightWidth: StyleSheet.hairlineWidth },
});

const CS = StyleSheet.create({
  hours: { fontSize: 12, textAlign: "center" },
  badge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: "700" },
});

const EM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "700" },
  card: { borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, textAlign: "center" },
  inputSmall: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, textAlign: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
});

const PSC = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, borderWidth: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  di: { flex: 1, alignItems: "center" },
  dl: { fontSize: 10, color: "#8E8E93" },
  dv: { fontSize: 13, fontWeight: "700" },
});
