/**
 * 排班表页面 v3
 * - 动态班次分行（按 ShiftTemplate 列表，不再硬编码午/晚）
 * - 班次模板支持增删改任意数量班次（名称/时间/工时/颜色）
 * - 快速填充整行（长按姓名格 → 批量填充本月所有工作日/全月）
 * - Mac 宽屏布局修复（tableWidth 上限 520）
 * - 节假日配置入口
 * - 加班预警（超出合同工时标红）
 * - 调休标记（overtime type = comp_off）
 * - 旧数据自动迁移（"day"→"午班"，"evening"→"晚班"）
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
  Employee, EmployeeDept, ShiftEntry, ShiftHoursValue,
  ShiftTemplate,
  DEPT_LABELS, DEPT_COLORS,
  getMonthDates, getDayOfWeek, monthLabel, getContractHoursForDate,
  DEFAULT_SHIFT_TEMPLATES, SHIFT_COLOR_PRESETS,
} from "@/lib/labor/types";

const DEPT_OPTIONS: EmployeeDept[] = ["front", "kitchen"];

/** 旧数据迁移：将 "day"/"evening"/"both" 映射到班次名称 */
function migrateShiftName(shift: string): string {
  if (shift === "day") return "午班";
  if (shift === "evening") return "晚班";
  if (shift === "both") return "午班"; // both 拆成两条，这里取午班
  return shift;
}

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
        <Text style={[CS.cellHours, {
          color: isOvertime ? (isCompOff ? "#34C759" : "#FF3B30") : colors.foreground,
          fontWeight: isOvertime ? "700" : "400",
        }]}>{h}</Text>
        {isOvertime && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isCompOff ? "#34C759" : "#FF3B30", marginTop: 1 }} />}
      </View>
    );
  }
  return null;
}

// ─── 单元格编辑 Modal ─────────────────────────────────────────────────────────
function EditShiftModal({ visible, date, employee, session, sessionColor, existing, contractHours, defaultHours, colors, onSave, onClear, onClose }: {
  visible: boolean;
  date: string;
  employee: Employee | null;
  session: string;
  sessionColor: string;
  existing: ShiftEntry | null;
  contractHours: number;
  defaultHours: number;
  colors: any;
  onSave: (entry: ShiftEntry) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
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
    onSave({
      employeeId: employee.id, date,
      shift: session,          // 直接存班次名称
      hoursValue,
      sessionValue: session,
      overtimeType: isOvertime ? overtimeType : "pay",
    });
    onClose();
  };

  const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[EM.sheet, { backgroundColor: colors.background }]}>
        <View style={[EM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[EM.title, { color: colors.foreground }]}>{employee.code} · {session}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{date} 周{WEEKDAY_LABELS[dow]}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: sessionColor }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          {/* 工时输入 */}
          <View style={[EM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[EM.sectionTitle, { color: colors.foreground }]}>工时（小时）</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 }}>
              <TextInput
                value={hoursInput}
                onChangeText={(t) => { setHoursInput(t); setHoursSpecial(null); }}
                placeholder={`默认 ${defaultHours}h`}
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                style={[EM.input, { color: colors.foreground, borderColor: sessionColor, flex: 1 }]}
              />
              <Text style={{ color: colors.muted }}>h</Text>
            </View>
            {contractHours > 0 && (
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                合同工时：{contractHours}h/天
                {isOvertime ? `  ·  加班 +${overtimeAmt.toFixed(1)}h` : ""}
              </Text>
            )}
          </View>
          {/* 特殊标注 */}
          <View style={[EM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[EM.sectionTitle, { color: colors.foreground }]}>特殊标注</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              {(["休", "无早"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => { tap(); setHoursSpecial(hoursSpecial === s ? null : s); setHoursInput(""); }}
                  style={[EM.chip, { backgroundColor: hoursSpecial === s ? (s === "休" ? "#FF3B30" : colors.muted) : colors.surface, borderColor: s === "休" ? "#FF3B30" : colors.muted }]}>
                  <Text style={{ fontSize: 13, color: hoursSpecial === s ? "#fff" : colors.muted }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {/* 加班处理 */}
          {isOvertime && (
            <View style={[EM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[EM.sectionTitle, { color: colors.foreground }]}>加班处理（+{overtimeAmt.toFixed(1)}h）</Text>
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
          {/* 清除 */}
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
  visible: boolean;
  templates: ShiftTemplate[];
  colors: any;
  onSave: (tpl: ShiftTemplate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  // 本地编辑状态（以 templates 为初始值）
  const [localTemplates, setLocalTemplates] = useState<ShiftTemplate[]>(() =>
    [...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  );
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null); // tpl.id

  React.useEffect(() => {
    if (visible) {
      setLocalTemplates([...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    }
  }, [visible, templates]);

  const updateLocal = (id: string, patch: Partial<ShiftTemplate>) => {
    setLocalTemplates((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t));
  };

  const addNew = () => {
    tap();
    const newTpl: ShiftTemplate = {
      id: `tpl_${Date.now()}`,
      session: "新班次",
      startTime: "09:00",
      endTime: "18:00",
      defaultHours: 8,
      color: SHIFT_COLOR_PRESETS[localTemplates.length % SHIFT_COLOR_PRESETS.length],
      sortOrder: localTemplates.length,
    };
    setLocalTemplates((prev) => [...prev, newTpl]);
  };

  const removeLocal = (id: string) => {
    tap();
    Alert.alert("删除班次", "删除后该班次的历史排班记录不受影响，但新排班将无法选择此班次。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => {
        setLocalTemplates((prev) => prev.filter((t) => t.id !== id));
      }},
    ]);
  };

  const handleSave = () => {
    // 保存所有本地模板
    const existingIds = templates.map((t) => t.id);
    const localIds = localTemplates.map((t) => t.id);
    // 删除已移除的模板
    existingIds.filter((id) => !localIds.includes(id)).forEach((id) => onDelete(id));
    // 保存/更新所有本地模板
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
          {localTemplates.map((tpl, idx) => (
            <View key={tpl.id} style={{ backgroundColor: tpl.color + "10", borderRadius: 14, padding: 16, gap: 12, borderWidth: 1, borderColor: tpl.color + "44" }}>
              {/* 班次名称 + 删除 */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tpl.color }} />
                <TextInput
                  value={tpl.session}
                  onChangeText={(v) => updateLocal(tpl.id, { session: v })}
                  placeholder="班次名称"
                  placeholderTextColor={colors.muted}
                  style={{ flex: 1, fontSize: 15, fontWeight: "700", color: tpl.color, paddingVertical: 2 }}
                />
                <TouchableOpacity onPress={() => removeLocal(tpl.id)} style={{ padding: 4 }}>
                  <IconSymbol name="trash" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
              {/* 时间段 + 工时 */}
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
              {/* 颜色选择 */}
              <View>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>班次颜色</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {SHIFT_COLOR_PRESETS.map((c) => (
                    <TouchableOpacity key={c} onPress={() => { tap(); updateLocal(tpl.id, { color: c }); }}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c,
                        borderWidth: tpl.color === c ? 3 : 1,
                        borderColor: tpl.color === c ? colors.foreground : c + "44" }} />
                  ))}
                </View>
              </View>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                添加排班时自动带入 {tpl.defaultHours}h，可单独修改
              </Text>
            </View>
          ))}
          {/* 新增班次按钮 */}
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
  const { templates, upsertTemplate, deleteTemplate } = useShiftTemplateStore();

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [dept, setDept] = useState<EmployeeDept>("front");
  const [showPaySlips, setShowPaySlips] = useState(false);
  const [showTplModal, setShowTplModal] = useState(false);

  const [editModal, setEditModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editSession, setEditSession] = useState<string>("晚班");

  const { width: screenWidth } = useWindowDimensions();
  const MAX_TABLE_W = 520;
  const NAME_W = 60;
  const availableW = Math.min(screenWidth, MAX_TABLE_W) - NAME_W - 2;
  const CELL_W = Math.max(36, Math.min(52, Math.floor(availableW / 7)));
  const tableWidth = NAME_W + CELL_W * 7;

  const deptColor = DEPT_COLORS[dept];
  const dates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);

  // 按 sortOrder 排序的班次模板列表（动态）
  const sortedTemplates = useMemo(() =>
    [...(templates.length > 0 ? templates : DEFAULT_SHIFT_TEMPLATES)]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [templates]
  );

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

  // 按班次分组员工（动态，不再硬编码午/晚）
  const employeesBySession = useMemo(() => {
    const map: Record<string, Employee[]> = {};
    for (const tpl of sortedTemplates) {
      map[tpl.session] = allDeptEmployees.filter((e) => e.defaultSession === tpl.session);
    }
    // 未分配班次的员工放到第一个班次
    const unassigned = allDeptEmployees.filter((e) => !e.defaultSession || !sortedTemplates.find((t) => t.session === e.defaultSession));
    if (sortedTemplates.length > 0) {
      const firstSession = sortedTemplates[sortedTemplates.length - 1].session;
      map[firstSession] = [...(map[firstSession] ?? []), ...unassigned];
    }
    return map;
  }, [allDeptEmployees, sortedTemplates]);

  const monthShifts = useMemo(() => {
    // 自动迁移旧数据
    return getShifts(currentMonth).map((s) => ({
      ...s,
      shift: migrateShiftName(s.shift),
    }));
  }, [shifts, currentMonth]);

  const getEntry = useCallback((employeeId: string, date: string, session: string): ShiftEntry | null => {
    return monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === session) ?? null;
  }, [monthShifts]);

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
        {
          text: "填充工作日",
          onPress: () => {
            const entries: ShiftEntry[] = dates
              .filter((d) => { const dow = getDayOfWeek(d); return dow !== 0 && dow !== 6; })
              .filter((d) => !getEntry(employee.id, d, session))
              .map((d) => ({ employeeId: employee.id, date: d, shift: session, hoursValue: defaultHours, sessionValue: session, overtimeType: "pay" as const }));
            if (entries.length > 0) batchUpsertShifts(entries);
          },
        },
        {
          text: "填充全月",
          onPress: () => {
            const entries: ShiftEntry[] = dates
              .filter((d) => !getEntry(employee.id, d, session))
              .map((d) => ({ employeeId: employee.id, date: d, shift: session, hoursValue: defaultHours, sessionValue: session, overtimeType: "pay" as const }));
            if (entries.length > 0) batchUpsertShifts(entries);
          },
        },
      ]
    );
  };

  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  const renderSessionGroup = (tpl: ShiftTemplate, empList: Employee[]) => {
    if (empList.length === 0) return null;
    const allDates = weeks.flat();

    return (
      <View key={tpl.session} style={{ marginBottom: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: tpl.color + "12" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tpl.color }} />
          <Text style={{ fontSize: 12, fontWeight: "700", color: tpl.color }}>
            {tpl.session} · {tpl.startTime}–{tpl.endTime} · 默认{tpl.defaultHours}h
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 4 }}>({empList.length}人)</Text>
        </View>
        {empList.map((emp) => (
          <View key={emp.id} style={[S.empRow, { borderBottomColor: colors.border + "33", borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <TouchableOpacity
              onLongPress={() => handleFillRow(emp, tpl.session)}
              style={[S.nameCell, { width: NAME_W, backgroundColor: tpl.color + "08" }]}>
              <Text style={[S.empName, { color: tpl.color }]} numberOfLines={1}>{emp.code}</Text>
              <Text style={{ fontSize: 9, color: colors.muted }} numberOfLines={1}>{emp.realName.slice(0, 3)}</Text>
            </TouchableOpacity>
            {allDates.map((d, idx) => {
              const entry = d ? getEntry(emp.id, d, tpl.session) : null;
              const contractH = d ? getContractHoursForDate(emp, d) : 0;
              const isWeekend = d ? (getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6) : false;
              const isToday = d === new Date().toISOString().slice(0, 10);
              return (
                <TouchableOpacity key={idx} onPress={() => d && handleCellPress(emp, d, tpl.session)} disabled={!d}
                  style={[S.cell, {
                    width: CELL_W,
                    backgroundColor: !d ? colors.surface + "44"
                      : isToday ? tpl.color + "15"
                      : isWeekend ? tpl.color + "08"
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

  const editTpl = sortedTemplates.find((t) => t.session === editSession) ?? sortedTemplates[0] ?? DEFAULT_SHIFT_TEMPLATES[0];
  const editContractH = editEmployee && editDate ? getContractHoursForDate(editEmployee, editDate) : 0;

  const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

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
            {/* 表头：星期 */}
            <View style={[S.tableHeaderRow, { backgroundColor: deptColor + "18", borderBottomColor: deptColor + "44" }]}>
              <View style={{ width: NAME_W, paddingLeft: 8 }}>
                <Text style={[S.headerCell, { color: deptColor }]}>姓名</Text>
              </View>
              {weeks.map((week, wi) =>
                week.map((d, di) => {
                  const dow = d ? getDayOfWeek(d) : ((wi * 7 + di + 1) % 7);
                  const dayLabel = WEEKDAY_LABELS[dow];
                  return (
                    <View key={`h-${wi}-${di}`} style={{ width: CELL_W, alignItems: "center" }}>
                      <Text style={[S.headerCell, { color: dow === 0 || dow === 6 ? colors.error : deptColor }]}>周{dayLabel}</Text>
                    </View>
                  );
                })
              )}
            </View>

            {/* 日期行 */}
            <View style={[S.dateRow, { backgroundColor: deptColor + "22", borderBottomColor: deptColor + "55" }]}>
              <View style={{ width: NAME_W, paddingLeft: 8 }}>
                <Text style={[S.dateCell, { color: deptColor }]}>日期</Text>
              </View>
              {weeks.map((week, wi) =>
                week.map((d, di) => {
                  const isToday = d === new Date().toISOString().slice(0, 10);
                  return (
                    <View key={`d-${wi}-${di}`} style={{ width: CELL_W, alignItems: "center" }}>
                      {d ? (
                        <View style={isToday ? { backgroundColor: deptColor, borderRadius: 10, width: 22, height: 22, alignItems: "center", justifyContent: "center" } : undefined}>
                          <Text style={[S.dateCell, {
                            color: isToday ? "#fff" : (getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6 ? colors.error : deptColor),
                            fontWeight: isToday ? "800" : "700",
                          }]}>{Number(d.slice(8))}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })
              )}
            </View>

            {/* 动态班次分行 */}
            {sortedTemplates.map((tpl) => renderSessionGroup(tpl, employeesBySession[tpl.session] ?? []))}
          </View>
        </ScrollView>

        {showPaySlips && (
          <View style={{ padding: 12, gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: deptColor }} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>{monthLabel(currentMonth)} 薪水条</Text>
            </View>
            {allDeptEmployees.map((emp) => {
              const tpl = sortedTemplates.find((t) => t.session === emp.defaultSession) ?? sortedTemplates[sortedTemplates.length - 1] ?? DEFAULT_SHIFT_TEMPLATES[1];
              return (
                <PaySlipCard key={emp.id} employee={emp} month={currentMonth}
                  sessionColor={tpl?.color ?? "#5856D6"} colors={colors} />
              );
            })}
          </View>
        )}
      </ScrollView>

      <EditShiftModal
        visible={editModal}
        date={editDate}
        employee={editEmployee}
        session={editSession}
        sessionColor={editTpl?.color ?? "#5856D6"}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editSession) : null}
        contractHours={editContractH}
        defaultHours={editTpl?.defaultHours ?? 8}
        colors={colors}
        onSave={(entry) => upsertShift(entry)}
        onClear={() => {
          if (editEmployee && editDate) {
            deleteShift(editEmployee.id, editDate, editSession);
          }
        }}
        onClose={() => setEditModal(false)}
      />

      <ShiftTemplateModal
        visible={showTplModal}
        templates={sortedTemplates}
        colors={colors}
        onSave={upsertTemplate}
        onDelete={deleteTemplate}
        onClose={() => setShowTplModal(false)}
      />
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "700" },
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  monthLabel: { fontSize: 17, fontWeight: "700" },
  controlBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  segGroup: { flexDirection: "row", borderRadius: 8, overflow: "hidden", padding: 2 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  tableHeaderRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4, borderBottomWidth: 1 },
  dateRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4, borderBottomWidth: 1 },
  headerCell: { fontSize: 10, fontWeight: "700", textAlign: "center" },
  dateCell: { fontSize: 11, fontWeight: "700", textAlign: "center" },
  empRow: { flexDirection: "row", alignItems: "center" },
  nameCell: { justifyContent: "center", alignItems: "center", paddingVertical: 6 },
  empName: { fontSize: 11, fontWeight: "700" },
  cell: { alignItems: "center", justifyContent: "center", height: 36, borderRightWidth: StyleSheet.hairlineWidth },
});

const CS = StyleSheet.create({
  cellHours: { fontSize: 12, textAlign: "center" },
  cellSpecial: { fontSize: 10, fontWeight: "700" },
});

const EM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "700" },
  card: { borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, textAlign: "center" },
  inputSmall: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, textAlign: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
});

const PSC = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, borderWidth: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  detailItem: { flex: 1, alignItems: "center" },
  detailLabel: { fontSize: 10, color: "#8E8E93" },
  detailValue: { fontSize: 13, fontWeight: "700" },
});
