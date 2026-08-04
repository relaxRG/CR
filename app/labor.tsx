/**
 * 员工管理主界面 v3
 * 横滑三页：排班表 / 员工档案（含发薪卡片）/ 薪资预支
 * 顶部：总览卡片（含对比开关：上月 / 去年同期）
 * 员工档案：自定义分组 + 每人发薪卡片（含对比开关）
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert, Dimensions, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, useEmployeeGroupStore, useAttendanceStore,
  usePaySlipStore, useShiftStore, useShiftTemplateStore,
} from "@/lib/labor/store";
import { useSalaryAdvanceStore } from "@/lib/labor/advance-store";
import { usePettyCashStore } from "@/lib/store/petty-store";
import {
  Employee, EmployeeDept, EmployeeGroup, ShiftEntry, ShiftHoursValue, ShiftTemplate,
  DEPT_COLORS, DEPT_LABELS, monthLabel,
  getMonthDates, getDayOfWeek, getContractHoursForDate,
  DEFAULT_SHIFT_TEMPLATES, SHIFT_COLOR_PRESETS,
} from "@/lib/labor/types";

const { width: SCREEN_W } = Dimensions.get("window");
const SCH_NAME_W = 64;   // 排班表左侧姓名列宽
const SCH_CELL_W = 44;  // 排班表每天列宽
const SCH_ROW_H = 38;   // 排班表行高

/** 旧数据迁移：将各种旧班次标识统一映射到新班次名称 */
function migrateShiftName(shift: string): string {
  if (shift === "day" || shift === "午") return "午班";
  if (shift === "evening" || shift === "晚") return "晚班";
  if (shift === "both") return "午班";
  return shift;
}

type CompareMode = "none" | "lastMonth" | "lastYear" | "custom";

// ─── 月份工具 ─────────────────────────────────────────────────────────────────
function currentMonthStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getCompareMonth(base: string, mode: CompareMode, customMonth?: string): string | null {
  if (mode === "none") return null;
  if (mode === "custom") return customMonth ?? null;
  const [y, m] = base.split("-").map(Number);
  if (mode === "lastMonth") {
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${y - 1}-${String(m).padStart(2, "0")}`;
}

function recentMonths(base: string, count = 24): string[] {
  const [y, m] = base.split("-").map(Number);
  const result: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return result;
}

function compareModeLabel(mode: CompareMode, customMonth?: string) {
  if (mode === "lastMonth") return "上月";
  if (mode === "lastYear") return "去年同期";
  if (mode === "custom") return customMonth ? monthLabel(customMonth) : "筛选月";
  return "不对比";
}

// ─── 对比按钮组件 ─────────────────────────────────────────────────────────────
function CompareToggle({ mode, customMonth, baseMonth, onChange, onCustomMonthChange, colors }: {
  mode: CompareMode;
  customMonth?: string;
  baseMonth: string;
  onChange: (m: CompareMode) => void;
  onCustomMonthChange?: (m: string) => void;
  colors: any;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [open, setOpen] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const months = recentMonths(baseMonth, 24);

  return (
    <View style={{ position: "relative" }}>
      <TouchableOpacity onPress={() => { tap(); setOpen((v) => !v); setShowMonthPicker(false); }}
        style={[CT.btn, {
          backgroundColor: mode !== "none" ? colors.primary + "22" : colors.surface,
          borderColor: mode !== "none" ? colors.primary + "44" : colors.border,
        }]}>
        <IconSymbol name="chart.bar.xaxis" size={12} color={mode !== "none" ? colors.primary : colors.muted} />
        <Text style={{ fontSize: 11, fontWeight: "600", color: mode !== "none" ? colors.primary : colors.muted }}>
          {mode !== "none" ? compareModeLabel(mode, customMonth) : "对比"}
        </Text>
      </TouchableOpacity>

      {open && !showMonthPicker && (
        <View style={[CT.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {(["none", "lastMonth", "lastYear"] as CompareMode[]).map((m) => (
            <TouchableOpacity key={m} onPress={() => { tap(); onChange(m); setOpen(false); }}
              style={[CT.option, { backgroundColor: mode === m ? colors.primary : "transparent" }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: mode === m ? "#fff" : colors.foreground }}>
                {compareModeLabel(m)}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => { tap(); setShowMonthPicker(true); }}
            style={[CT.option, { backgroundColor: mode === "custom" ? colors.primary : "transparent", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: mode === "custom" ? "#fff" : colors.foreground }}>
              {mode === "custom" && customMonth ? monthLabel(customMonth) : "筛选月"}
            </Text>
            <IconSymbol name="chevron.right" size={10} color={mode === "custom" ? "#fff" : colors.muted} />
          </TouchableOpacity>
        </View>
      )}

      {open && showMonthPicker && (
        <View style={[CT.panel, { backgroundColor: colors.surface, borderColor: colors.border, width: 130 }]}>
          <TouchableOpacity onPress={() => setShowMonthPicker(false)}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, padding: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            <IconSymbol name="chevron.left" size={12} color={colors.primary} />
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>返回</Text>
          </TouchableOpacity>
          <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
            {months.map((m) => (
              <TouchableOpacity key={m} onPress={() => {
                tap();
                onCustomMonthChange?.(m);
                onChange("custom");
                setOpen(false);
                setShowMonthPicker(false);
              }} style={[CT.option, { backgroundColor: mode === "custom" && customMonth === m ? colors.primary : "transparent" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: mode === "custom" && customMonth === m ? "#fff" : colors.foreground }}>
                  {monthLabel(m)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ─── 总览卡片 ─────────────────────────────────────────────────────────────────
function OverviewCard({ month, colors }: { month: string; colors: any }) {
  const { employees } = useEmployeeStore();
  const { paySlips } = usePaySlipStore();
  const { records: attendances } = useAttendanceStore();
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [customMonth, setCustomMonth] = useState<string | undefined>();

  const compareMonth = getCompareMonth(month, compareMode, customMonth);

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);
  const monthSlips = useMemo(() => paySlips.filter((s) => s.month === month), [paySlips, month]);
  const totalSalary = useMemo(() => monthSlips.reduce((s, p) => s + p.finalSalary, 0), [monthSlips]);
  const totalPending = useMemo(() => monthSlips.reduce((s, p) => s + Math.max(0, p.finalSalary - p.advanceAmount), 0), [monthSlips]);
  const attendCount = useMemo(() => attendances.filter((a) => a.month === month).length, [attendances, month]);

  // 对比月数据
  const compareSlips = useMemo(() => compareMonth ? paySlips.filter((s) => s.month === compareMonth) : [], [paySlips, compareMonth]);
  const compareTotalSalary = useMemo(() => compareSlips.reduce((s, p) => s + p.finalSalary, 0), [compareSlips]);
  const diffSalary = compareMonth && totalSalary > 0 && compareTotalSalary > 0 ? totalSalary - compareTotalSalary : null;

  return (
    <View style={[OV.card, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
      {/* 标题行 + 对比开关 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={[OV.title, { color: colors.primary }]}>{monthLabel(month)} 人力总览</Text>
        <CompareToggle mode={compareMode} customMonth={customMonth} baseMonth={month} onChange={setCompareMode} onCustomMonthChange={setCustomMonth} colors={colors} />
      </View>

      {/* 核心数字行 */}
      <View style={OV.row}>
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>在职人数</Text>
          <Text style={[OV.value, { color: colors.foreground }]}>{activeEmployees.length}<Text style={OV.unit}>人</Text></Text>
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>已录考勤</Text>
          <Text style={[OV.value, { color: colors.foreground }]}>{attendCount}<Text style={OV.unit}>人</Text></Text>
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>薪资合计</Text>
          <Text style={[OV.value, { color: colors.primary }]}>
            {totalSalary > 0 ? `¥${totalSalary.toFixed(0)}` : "—"}
          </Text>
          {diffSalary !== null && (
            <Text style={{ fontSize: 10, fontWeight: "600", color: diffSalary > 0 ? "#FF3B30" : "#34C759" }}>
              {diffSalary > 0 ? "▲" : "▼"} ¥{Math.abs(diffSalary).toFixed(0)}
            </Text>
          )}
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>待发</Text>
          <Text style={[OV.value, { color: totalPending > 0 ? "#FF9500" : colors.muted }]}>
            {totalPending > 0 ? `¥${totalPending.toFixed(0)}` : "—"}
          </Text>
        </View>
      </View>

      {/* 对比详情行 */}
      {compareMonth && compareTotalSalary > 0 && (
        <View style={[OV.compareRow, { borderTopColor: colors.border }]}>
          <Text style={{ fontSize: 11, color: colors.muted }}>{compareModeLabel(compareMode, customMonth)}薪资合计：</Text>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>¥{compareTotalSalary.toFixed(0)}</Text>
          {diffSalary !== null && (
            <Text style={{ fontSize: 11, color: diffSalary > 0 ? "#FF3B30" : "#34C759", marginLeft: 8 }}>
              {diffSalary > 0 ? "增加" : "减少"} ¥{Math.abs(diffSalary).toFixed(0)}（{((Math.abs(diffSalary) / compareTotalSalary) * 100).toFixed(1)}%）
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── 个人发薪卡片（嵌入员工档案页） ──────────────────────────────────────────
function PaySlipMiniCard({ employee, month, compareMonth, compareMode, colors }: {
  employee: Employee;
  month: string;
  compareMonth: string | null;
  compareMode: CompareMode;
  colors: any;
}) {
  const { getPaySlip } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();
  const { templates: shiftTpls } = useShiftTemplateStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const slip = getPaySlip(employee.id, month);
  const att = getAttendance(employee.id, month);
  const compareSlip = compareMonth ? getPaySlip(employee.id, compareMonth) : null;
  const deptColor = DEPT_COLORS[employee.dept];

  const getSessionColor = (session: string | undefined): string => {
    if (!session) return colors.muted;
    const tpl = (shiftTpls.length > 0 ? shiftTpls : DEFAULT_SHIFT_TEMPLATES).find((t) => t.session === session);
    return tpl?.color ?? colors.primary;
  };

  const diffSalary = slip && compareSlip ? slip.finalSalary - compareSlip.finalSalary : null;

  return (
    <TouchableOpacity
      onPress={() => { tap(); router.push({ pathname: "/labor-attendance", params: { employeeId: employee.id, month } } as any); }}
      style={[PC.card, { backgroundColor: colors.surface, borderColor: deptColor + "33" }]}>
      {/* 员工信息行 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={[PC.avatar, { backgroundColor: deptColor + "22" }]}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: deptColor }}>{employee.code.slice(0, 2)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{employee.code}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{employee.realName}</Text>
              {employee.defaultSession && (
              <View style={{ backgroundColor: getSessionColor(employee.defaultSession) + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: getSessionColor(employee.defaultSession) }}>{employee.defaultSession}</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, color: colors.muted }}>
            {DEPT_LABELS[employee.dept]} · {employee.type === "fulltime" ? `底薪¥${employee.baseSalary}` : `时薪¥${employee.hourlyRate}/h`}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          {slip ? (
            <>
              <Text style={{ fontSize: 16, fontWeight: "800", color: deptColor }}>¥{slip.finalSalary.toFixed(0)}</Text>
              {/* 对比差额 */}
              {diffSalary !== null && (
                <Text style={{ fontSize: 10, fontWeight: "600", color: diffSalary > 0 ? "#FF3B30" : "#34C759" }}>
                  {diffSalary > 0 ? "▲" : "▼"} ¥{Math.abs(diffSalary).toFixed(0)}
                </Text>
              )}
              {!diffSalary && <Text style={{ fontSize: 10, color: colors.muted }}>最终薪资</Text>}
            </>
          ) : att ? (
            <>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.muted }}>¥{att.attendanceSalary.toFixed(0)}</Text>
              <Text style={{ fontSize: 10, color: colors.muted }}>考勤薪资</Text>
            </>
          ) : (
            <Text style={{ fontSize: 11, color: colors.border }}>未录入</Text>
          )}
        </View>
      </View>

      {/* 薪资明细行（有数据时显示） */}
      {slip && (
        <View style={[PC.detailRow, { borderTopColor: colors.border }]}>
          {att && <View style={PC.detailItem}><Text style={PC.detailLabel}>出勤</Text><Text style={[PC.detailValue, { color: colors.foreground }]}>{att.attendanceDays}天</Text></View>}
          {att && att.overtimeHours > 0 && <View style={PC.detailItem}><Text style={PC.detailLabel}>加班</Text><Text style={[PC.detailValue, { color: "#FF3B30" }]}>+{att.overtimeHours.toFixed(1)}h</Text></View>}
          {slip.performanceBonus > 0 && <View style={PC.detailItem}><Text style={PC.detailLabel}>绩效</Text><Text style={[PC.detailValue, { color: "#34C759" }]}>+¥{slip.performanceBonus.toFixed(0)}</Text></View>}
          {slip.advanceAmount > 0 && <View style={PC.detailItem}><Text style={PC.detailLabel}>预支</Text><Text style={[PC.detailValue, { color: "#FF9500" }]}>-¥{slip.advanceAmount.toFixed(0)}</Text></View>}
          <View style={PC.detailItem}>
            <Text style={PC.detailLabel}>待发</Text>
            <Text style={[PC.detailValue, { color: deptColor }]}>¥{Math.max(0, slip.finalSalary - slip.advanceAmount).toFixed(0)}</Text>
          </View>
          {/* 对比月薪资 */}
          {compareSlip && (
            <View style={PC.detailItem}>
              <Text style={PC.detailLabel}>{compareModeLabel(compareMode)}</Text>
              <Text style={[PC.detailValue, { color: colors.muted }]}>¥{compareSlip.finalSalary.toFixed(0)}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── 员工档案页（第二页） ─────────────────────────────────────────────────────
function EmployeeRosterPage({ month, colors }: { month: string; colors: any }) {
  const { employees } = useEmployeeStore();
  const { groups, toggleCollapse } = useEmployeeGroupStore();
  const { templates: shiftTemplates } = useShiftTemplateStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  // 班次颜色查找辅助函数（动态读取模板）
  const getSessionColor = useCallback((session: string | undefined): string => {
    if (!session) return colors.muted;
    const tpl = (shiftTemplates.length > 0 ? shiftTemplates : DEFAULT_SHIFT_TEMPLATES).find((t) => t.session === session);
    return tpl?.color ?? colors.primary;
  }, [shiftTemplates, colors]);

  // 薪资对比开关（统一控制所有卡片）
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [customMonth, setCustomMonth] = useState<string | undefined>();
  const compareMonth = getCompareMonth(month, compareMode, customMonth);

  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);

  const sortedGroups = useMemo(() =>
    [...groups].sort((a, b) => a.sortOrder - b.sortOrder),
    [groups]
  );

  const ungroupedEmployees = useMemo(() => {
    const allGroupedIds = new Set(groups.flatMap((g) => g.employeeIds));
    return activeEmployees.filter((e) => !allGroupedIds.has(e.id));
  }, [activeEmployees, groups]);

  const getGroupEmployees = (group: EmployeeGroup): Employee[] => {
    return group.employeeIds
      .map((id) => activeEmployees.find((e) => e.id === id))
      .filter((e): e is Employee => !!e);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      {/* 工具栏：添加员工 + 对比开关 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <TouchableOpacity onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
          style={[{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary + "66", backgroundColor: colors.primary + "08" }]}>
          <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加员工</Text>
        </TouchableOpacity>
        {/* 薪资对比开关 */}
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>薪资对比</Text>
          <CompareToggle mode={compareMode} customMonth={customMonth} baseMonth={month} onChange={setCompareMode} onCustomMonthChange={setCustomMonth} colors={colors} />
        </View>
      </View>

      {/* 分组列表 */}
      {sortedGroups.map((group) => {
        const empList = getGroupEmployees(group);
        if (empList.length === 0) return null;
        return (
          <View key={group.id} style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }]}>
            {/* 分组标题 */}
            <TouchableOpacity onPress={() => { tap(); toggleCollapse(group.id); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: group.color + "10" }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: group.color }} />
              <Text style={{ fontSize: 14, fontWeight: "700", color: group.color }}>{group.name}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginLeft: 2 }}>({empList.length}人)</Text>
              <IconSymbol name={group.collapsed ? "chevron.right" : "chevron.down"} size={14} color={colors.muted} style={{ marginLeft: "auto" }} />
            </TouchableOpacity>
            {/* 员工卡片 */}
            {!group.collapsed && empList.map((emp) => (
              <View key={emp.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                <PaySlipMiniCard employee={emp} month={month} compareMonth={compareMonth} compareMode={compareMode} colors={colors} />
              </View>
            ))}
          </View>
        );
      })}

      {/* 未分组员工 */}
      {ungroupedEmployees.length > 0 && (
        <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: colors.muted + "10" }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.muted }}>未分组</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>({ungroupedEmployees.length}人)</Text>
          </View>
          {ungroupedEmployees.map((emp) => (
            <View key={emp.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <PaySlipMiniCard employee={emp} month={month} compareMonth={compareMonth} compareMode={compareMode} colors={colors} />
            </View>
          ))}
        </View>
      )}

      {activeEmployees.length === 0 && (
        <View style={{ alignItems: "center", padding: 40 }}>
          <IconSymbol name="person.2.fill" size={56} color={colors.border} />
          <Text style={{ fontSize: 18, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>暂无员工档案</Text>
          <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 8 }}>
            点击上方按钮添加员工，设置底薪、时薪等参数
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

// ─── 薪资预支页（第三页） ─────────────────────────────────────────────────────
function AdvancePage({ month, colors }: { month: string; colors: any }) {
  const { employees } = useEmployeeStore();
  const { advances } = useSalaryAdvanceStore();
  const { records: pettyRecords } = usePettyCashStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const monthAdvances = useMemo(() => {
    return advances.filter((a) => a.deductMonth === month || a.date.startsWith(month));
  }, [advances, month]);

  const pettyK1Records = useMemo(() => {
    return pettyRecords.filter((r) => r.code === "K1" && r.date.startsWith(month));
  }, [pettyRecords, month]);

  const totalAdvance = useMemo(() => monthAdvances.reduce((s, a) => s + a.amount, 0), [monthAdvances]);

  const getEmployee = (id: string) => employees.find((e) => e.id === id);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
      <View style={[{ borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#AF52DE" + "33", backgroundColor: "#AF52DE" + "08" }]}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }}>{monthLabel(month)} 薪资预支</Text>
        <Text style={{ fontSize: 28, fontWeight: "800", color: "#AF52DE", marginTop: 4 }}>
          {totalAdvance > 0 ? `¥${totalAdvance.toFixed(0)}` : "—"}
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{monthAdvances.length} 笔预支记录</Text>
      </View>

      {pettyK1Records.length > 0 && (
        <View style={[{ borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#FF9500" + "44", backgroundColor: "#FF9500" + "08" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <IconSymbol name="bolt.fill" size={14} color="#FF9500" />
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#FF9500" }}>备用金 K1 记录（{pettyK1Records.length}笔）</Text>
          </View>
          {pettyK1Records.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>{r.description || "固定兼职"}</Text>
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#FF9500" }}>¥{r.amount.toFixed(0)}</Text>
            </View>
          ))}
        </View>
      )}

      {monthAdvances.length > 0 ? (
        <View style={[{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }]}>
          {monthAdvances.map((adv, i) => {
            const emp = getEmployee(adv.employeeId);
            const deptColor = emp ? DEPT_COLORS[emp.dept] : colors.muted;
            return (
              <View key={adv.id} style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <View style={[{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: deptColor + "22" }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: deptColor }}>{emp?.code.slice(0, 2) ?? "?"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{emp?.code ?? "未知员工"} · {adv.date.slice(5)}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{adv.notes || (adv.paidViaPetty ? "备用金支付" : "手动录入")}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: "#AF52DE" }}>¥{adv.amount.toFixed(0)}</Text>
                  <View style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: adv.status === "deducted" ? "#34C75922" : "#FF950022" }]}>
                    <Text style={{ fontSize: 10, fontWeight: "600", color: adv.status === "deducted" ? "#34C759" : "#FF9500" }}>
                      {adv.status === "deducted" ? "已扣除" : "待扣除"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={{ alignItems: "center", padding: 32 }}>
          <IconSymbol name="creditcard.fill" size={48} color={colors.border} />
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月暂无预支记录</Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>可前往预支管理页面添加</Text>
        </View>
      )}

      <TouchableOpacity onPress={() => { tap(); router.push("/labor-advances" as any); }}
        style={[{ flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: "#AF52DE" + "44", backgroundColor: "#AF52DE" + "08" }]}>
        <IconSymbol name="creditcard.fill" size={18} color="#AF52DE" />
        <Text style={{ fontSize: 14, fontWeight: "600", color: "#AF52DE" }}>前往完整预支管理</Text>
        <IconSymbol name="chevron.right" size={14} color="#AF52DE" style={{ marginLeft: "auto" }} />
      </TouchableOpacity>
    </ScrollView>
  );
}

// ─── 排班表单元格显示 ─────────────────────────────────────────────────────────
function SchCellDisplay({ entry, contractHours, tplColor, colors }: {
  entry: ShiftEntry | null; contractHours: number; tplColor: string; colors: any;
}) {
  if (!entry) return null;
  const h = entry.hoursValue;
  if (h === "休") return <View style={[SCH.badge, { backgroundColor: "#FF3B30" + "22" }]}><Text style={[SCH.badgeText, { color: "#FF3B30" }]}>休</Text></View>;
  if (h === "无早") return <View style={[SCH.badge, { backgroundColor: colors.muted + "22" }]}><Text style={[SCH.badgeText, { color: colors.muted }]}>无早</Text></View>;
  if (typeof h === "number" && h > 0) {
    const isOT = contractHours > 0 && h > contractHours;
    const dotColor = entry.overtimeType === "comp_off" ? "#34C759" : "#FF3B30";
    return (
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontSize: 12, fontWeight: isOT ? "800" : "600", color: isOT ? dotColor : tplColor }}>{h}</Text>
        {isOT && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dotColor, marginTop: 1 }} />}
      </View>
    );
  }
  return null;
}

// ─── 排班表单元格编辑 Modal ────────────────────────────────────────────────────
function SchEditModal({ visible, date, employee, session, sessionColor, existing, contractHours, defaultHours, colors, onSave, onClear, onClose }: {
  visible: boolean; date: string; employee: Employee | null; session: string;
  sessionColor: string; existing: ShiftEntry | null; contractHours: number;
  defaultHours: number; colors: any;
  onSave: (e: ShiftEntry) => void; onClear: () => void; onClose: () => void;
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
  const curH = Number(hoursInput) || 0;
  const isOT = contractHours > 0 && curH > contractHours && !hoursSpecial;
  const otAmt = isOT ? curH - contractHours : 0;
  const handleSave = () => {
    let hv: ShiftHoursValue = null;
    if (hoursSpecial) hv = hoursSpecial;
    else if (hoursInput) hv = Number(hoursInput) || null;
    onSave({ employeeId: employee.id, date, shift: session, hoursValue: hv, sessionValue: session, overtimeType: isOT ? overtimeType : "pay" });
    onClose();
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[SCHEM.title, { color: colors.foreground }]}>{employee.code} · {session}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{date} 周{DOW[dow]}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: sessionColor }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground }]}>工时（小时）</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 8 }}>
              <TextInput value={hoursInput} onChangeText={(t) => { setHoursInput(t); setHoursSpecial(null); }}
                placeholder={`默认 ${defaultHours}h`} placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                style={[SCHEM.input, { color: colors.foreground, borderColor: sessionColor, flex: 1 }]} />
              <Text style={{ color: colors.muted }}>h</Text>
            </View>
            {contractHours > 0 && <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>合同工时：{contractHours}h/天{isOT ? `  ·  加班 +${otAmt.toFixed(1)}h` : ""}</Text>}
          </View>
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground }]}>特殊标注</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              {(["休", "无早"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => { tap(); setHoursSpecial(hoursSpecial === s ? null : s); setHoursInput(""); }}
                  style={[SCHEM.chip, { backgroundColor: hoursSpecial === s ? (s === "休" ? "#FF3B30" : colors.muted) : colors.surface, borderColor: s === "休" ? "#FF3B30" : colors.muted }]}>
                  <Text style={{ fontSize: 13, color: hoursSpecial === s ? "#fff" : colors.muted }}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          {isOT && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[SCHEM.label, { color: colors.foreground }]}>加班处理（+{otAmt.toFixed(1)}h）</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                {(["pay", "comp_off"] as const).map((v) => (
                  <TouchableOpacity key={v} onPress={() => { tap(); setOvertimeType(v); }}
                    style={[SCHEM.chip, { backgroundColor: overtimeType === v ? sessionColor : colors.surface, borderColor: sessionColor }]}>
                    <Text style={{ fontSize: 13, color: overtimeType === v ? "#fff" : sessionColor }}>{v === "pay" ? "计加班费" : "换调休"}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
          {existing && (
            <TouchableOpacity onPress={() => { tap(); onClear(); onClose(); }}
              style={[SCHEM.chip, { borderColor: colors.error, alignSelf: "center", paddingHorizontal: 24 }]}>
              <Text style={{ color: colors.error }}>清除此排班</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 班次模板设置 Modal ────────────────────────────────────────────────────────
function SchTemplateModal({ visible, templates, colors, onSave, onDelete, onClose }: {
  visible: boolean; templates: ShiftTemplate[]; colors: any;
  onSave: (t: ShiftTemplate) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [local, setLocal] = useState<ShiftTemplate[]>(() => [...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
  React.useEffect(() => { if (visible) setLocal([...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))); }, [visible, templates]);
  const upd = (id: string, p: Partial<ShiftTemplate>) => setLocal((prev) => prev.map((t) => t.id === id ? { ...t, ...p } : t));
  const addNew = () => { tap(); setLocal((prev) => [...prev, { id: `tpl_${Date.now()}`, session: "新班次", startTime: "09:00", endTime: "18:00", defaultHours: 8, color: SHIFT_COLOR_PRESETS[prev.length % SHIFT_COLOR_PRESETS.length], sortOrder: prev.length }]); };
  const removeLocal = (id: string) => { tap(); Alert.alert("删除班次", "删除后该班次历史排班记录不受影响。", [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => setLocal((prev) => prev.filter((t) => t.id !== id)) }]); };
  const handleSave = () => { const eIds = templates.map((t) => t.id); const lIds = local.map((t) => t.id); eIds.filter((id) => !lIds.includes(id)).forEach((id) => onDelete(id)); local.forEach((t, i) => onSave({ ...t, sortOrder: i })); onClose(); };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[SCHEM.title, { color: colors.foreground }]}>班次模板设置</Text>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          {local.map((tpl) => (
            <View key={tpl.id} style={{ backgroundColor: tpl.color + "10", borderRadius: 14, padding: 16, gap: 12, borderWidth: 1, borderColor: tpl.color + "44" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tpl.color }} />
                <TextInput value={tpl.session} onChangeText={(v) => upd(tpl.id, { session: v })} placeholder="班次名称" placeholderTextColor={colors.muted} style={{ flex: 1, fontSize: 15, fontWeight: "700", color: tpl.color, paddingVertical: 2 }} />
                <TouchableOpacity onPress={() => removeLocal(tpl.id)} style={{ padding: 4 }}><IconSymbol name="trash" size={16} color={colors.error} /></TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>开始时间</Text><TextInput value={tpl.startTime} onChangeText={(v) => upd(tpl.id, { startTime: v })} placeholder="10:30" placeholderTextColor={colors.muted} style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} /></View>
                <Text style={{ color: colors.muted, paddingBottom: 10 }}>—</Text>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>结束时间</Text><TextInput value={tpl.endTime} onChangeText={(v) => upd(tpl.id, { endTime: v })} placeholder="17:00" placeholderTextColor={colors.muted} style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} /></View>
                <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>默认工时</Text><TextInput value={String(tpl.defaultHours)} onChangeText={(v) => upd(tpl.id, { defaultHours: Number(v) || tpl.defaultHours })} placeholder="8" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: tpl.color, width: "100%" }]} /></View>
              </View>
              <View><Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>班次颜色</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{SHIFT_COLOR_PRESETS.map((c) => (<TouchableOpacity key={c} onPress={() => { tap(); upd(tpl.id, { color: c }); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: tpl.color === c ? 3 : 1, borderColor: tpl.color === c ? colors.foreground : c + "44" }} />))}</View></View>
              <Text style={{ fontSize: 11, color: colors.muted }}>添加排班时自动带入 {tpl.defaultHours}h，可单独修改</Text>
            </View>
          ))}
          <TouchableOpacity onPress={addNew} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary + "66" }}>
            <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
            <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加班次</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center" }}>参考：早班 / 午班 / 晚班 / 大夜班 / 全天班 / 中班</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 内嵌排班表页（第一页） ───────────────────────────────────────────────────
function SchedulePage({ colors }: { colors: any }) {
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
  const [showTplModal, setShowTplModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editSession, setEditSession] = useState<string>("晚班");

  const sortedTemplates = useMemo(() =>
    [...(templates.length > 0 ? templates : DEFAULT_SHIFT_TEMPLATES)].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [templates]
  );
  const dates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);
  const deptColor = DEPT_COLORS[dept];
  const monthShifts = useMemo(() => getShifts(currentMonth).map((s) => ({ ...s, shift: migrateShiftName(s.shift) })), [shifts, currentMonth]);
  const allDeptEmployees = useMemo(() => employees.filter((e) => e.active && (e.dept === dept || (dept === "front" && e.dept === "parttime"))), [employees, dept]);

  const employeesBySession = useMemo(() => {
    const map: Record<string, Employee[]> = {};
    for (const tpl of sortedTemplates) {
      map[tpl.session] = allDeptEmployees.filter((e) => migrateShiftName(e.defaultSession ?? "") === tpl.session);
    }
    const unassigned = allDeptEmployees.filter((e) => !sortedTemplates.find((t) => t.session === migrateShiftName(e.defaultSession ?? "")));
    if (sortedTemplates.length > 0) {
      const last = sortedTemplates[sortedTemplates.length - 1].session;
      map[last] = [...(map[last] ?? []), ...unassigned];
    }
    return map;
  }, [allDeptEmployees, sortedTemplates]);

  const getEntry = useCallback((employeeId: string, date: string, session: string): ShiftEntry | null =>
    monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === session) ?? null,
    [monthShifts]
  );

  const handleCellPress = (emp: Employee, date: string, session: string) => { tap(); setEditEmployee(emp); setEditDate(date); setEditSession(session); setEditModal(true); };

  const handleFillRow = (emp: Employee, session: string) => {
    tap();
    const tpl = sortedTemplates.find((t) => t.session === session) ?? sortedTemplates[0];
    const dh = tpl?.defaultHours ?? 8;
    Alert.alert(`快速填充 ${emp.code} ${session}`, `将本月所有工作日（周一~周五）填入 ${dh}h，已有数据不覆盖。`,
      [{ text: "取消", style: "cancel" },
       { text: "填充工作日", onPress: () => { const es = dates.filter((d) => { const dow = getDayOfWeek(d); return dow !== 0 && dow !== 6; }).filter((d) => !getEntry(emp.id, d, session)).map((d): ShiftEntry => ({ employeeId: emp.id, date: d, shift: session, hoursValue: dh, sessionValue: session, overtimeType: "pay" })); if (es.length > 0) batchUpsertShifts(es); } },
       { text: "填充全月", onPress: () => { const es = dates.filter((d) => !getEntry(emp.id, d, session)).map((d): ShiftEntry => ({ employeeId: emp.id, date: d, shift: session, hoursValue: dh, sessionValue: session, overtimeType: "pay" })); if (es.length > 0) batchUpsertShifts(es); } }]
    );
  };

  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  const editTpl = sortedTemplates.find((t) => t.session === editSession) ?? sortedTemplates[0] ?? DEFAULT_SHIFT_TEMPLATES[0];
  const editContractH = editEmployee && editDate ? getContractHoursForDate(editEmployee, editDate) : 0;
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];

  const renderSessionGroup = (tpl: ShiftTemplate) => {
    const empList = employeesBySession[tpl.session] ?? [];
    if (empList.length === 0) return null;
    return (
      <View key={tpl.session}>
        <View style={[SCH.sessionHeader, { backgroundColor: tpl.color + "15", borderLeftColor: tpl.color }]}>
          <View style={{ width: SCH_NAME_W, paddingLeft: 10 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: tpl.color }}>{tpl.session}</Text>
            <Text style={{ fontSize: 9, color: tpl.color + "99" }}>{tpl.startTime}–{tpl.endTime} · {tpl.defaultHours}h</Text>
          </View>
        </View>
        {empList.map((emp) => (
          <View key={emp.id} style={[SCH.empRow, { borderBottomColor: colors.border + "33" }]}>
            <TouchableOpacity onLongPress={() => handleFillRow(emp, tpl.session)}
              style={[SCH.nameCell, { width: SCH_NAME_W, backgroundColor: tpl.color + "08", borderRightColor: tpl.color + "33" }]}>
              <Text style={[SCH.empCode, { color: tpl.color }]} numberOfLines={1}>{emp.code}</Text>
              <Text style={[SCH.empName, { color: colors.muted }]} numberOfLines={1}>{emp.realName.slice(0, 4)}</Text>
            </TouchableOpacity>
            {dates.map((d) => {
              const entry = getEntry(emp.id, d, tpl.session);
              const contractH = getContractHoursForDate(emp, d);
              const dow = getDayOfWeek(d);
              const isWeekend = dow === 0 || dow === 6;
              const isToday = d === todayStr;
              return (
                <TouchableOpacity key={d} onPress={() => handleCellPress(emp, d, tpl.session)}
                  style={[SCH.cell, { width: SCH_CELL_W, backgroundColor: isToday ? tpl.color + "18" : isWeekend ? tpl.color + "07" : "transparent", borderRightColor: colors.border + "22" }]}>
                  <SchCellDisplay entry={entry} contractHours={contractH} tplColor={tpl.color} colors={colors} />
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* 月份切换 + 班次设置 */}
      <View style={[SCH.monthBar, { borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {DEPT_OPTIONS_SCH.map((d) => (
            <TouchableOpacity key={d} onPress={() => { tap(); setDept(d); }}
              style={[SCH.segBtn, dept === d && { backgroundColor: DEPT_COLORS[d] }]}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: dept === d ? "#fff" : colors.muted }}>{DEPT_LABELS[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable onPress={() => { tap(); prevMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <IconSymbol name="chevron.left" size={18} color={colors.primary} />
          </Pressable>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{monthLabel(currentMonth)}</Text>
          <Pressable onPress={() => { tap(); nextMonth(); }} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <IconSymbol name="chevron.right" size={18} color={colors.primary} />
          </Pressable>
        </View>
        <Pressable onPress={() => { tap(); setShowTplModal(true); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="gearshape.fill" size={18} color={colors.muted} />
        </Pressable>
      </View>
      <Text style={{ fontSize: 10, color: colors.muted, paddingHorizontal: 12, paddingVertical: 4 }}>长按姓名快速填充整行</Text>

      {/* 排班表主体 */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={true} bounces={false}>
          <View>
            {/* 表头 */}
            <View style={[SCH.headerRow, { backgroundColor: deptColor + "15", borderBottomColor: deptColor + "55" }]}>
              <View style={[SCH.nameCell, { width: SCH_NAME_W, backgroundColor: deptColor + "20", borderRightColor: deptColor + "44" }]}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: deptColor }}>姓名</Text>
              </View>
              {dates.map((d) => {
                const dow = getDayOfWeek(d);
                const isWeekend = dow === 0 || dow === 6;
                const isToday = d === todayStr;
                return (
                  <View key={d} style={[SCH.headerCell, { width: SCH_CELL_W, backgroundColor: isToday ? deptColor + "30" : "transparent", borderRightColor: colors.border + "22" }]}>
                    <Text style={{ fontSize: 9, color: isWeekend ? colors.error : deptColor, fontWeight: "600" }}>{DOW[dow]}</Text>
                    <View style={isToday ? { backgroundColor: deptColor, borderRadius: 9, width: 18, height: 18, alignItems: "center", justifyContent: "center" } : undefined}>
                      <Text style={{ fontSize: 11, fontWeight: isToday ? "800" : "600", color: isToday ? "#fff" : isWeekend ? colors.error : colors.foreground }}>{Number(d.slice(8))}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
            {/* 班次分组 */}
            {sortedTemplates.map((tpl) => renderSessionGroup(tpl))}
          </View>
        </ScrollView>
      </ScrollView>

      <SchEditModal
        visible={editModal} date={editDate} employee={editEmployee}
        session={editSession} sessionColor={editTpl?.color ?? "#5856D6"}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editSession) : null}
        contractHours={editContractH} defaultHours={editTpl?.defaultHours ?? 8}
        colors={colors}
        onSave={(entry) => upsertShift(entry)}
        onClear={() => { if (editEmployee && editDate) deleteShift(editEmployee.id, editDate, editSession); }}
        onClose={() => setEditModal(false)}
      />
      <SchTemplateModal
        visible={showTplModal} templates={sortedTemplates} colors={colors}
        onSave={upsertTemplate} onDelete={deleteTemplate}
        onClose={() => setShowTplModal(false)}
      />
    </View>
  );
}

const DEPT_OPTIONS_SCH: EmployeeDept[] = ["front", "kitchen"];

// ─── 主页面 ───────────────────────────────────────────────────────────────────
const PAGES = [
  { key: "schedule", label: "排班表",  icon: "calendar.badge.clock" },
  { key: "roster",   label: "员工档案", icon: "person.2.fill" },
  { key: "advances", label: "薪资预支", icon: "creditcard.fill" },
] as const;
type PageKey = typeof PAGES[number]["key"];

const PAGE_COLORS: Record<PageKey, string> = {
  schedule: "#34C759",
  roster:   "#007AFF",
  advances: "#AF52DE",
};

export default function LaborScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const month = currentMonthStr();
  const [activePage, setActivePage] = useState<PageKey>("schedule");
  const scrollRef = useRef<ScrollView>(null);

  const handleTabPress = (key: PageKey) => {
    tap();
    setActivePage(key);
    const idx = PAGES.findIndex((p) => p.key === key);
    scrollRef.current?.scrollTo({ x: idx * SCREEN_W, animated: true });
  };

  const handleScroll = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    const key = PAGES[idx]?.key;
    if (key && key !== activePage) setActivePage(key);
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>员工管理</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="person.badge.plus" size={22} color={colors.primary} />
          </Pressable>
          <Pressable onPress={() => { tap(); router.push("/labor-schedule" as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="calendar.badge.clock" size={22} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {/* 总览卡片（含对比开关） */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <OverviewCard month={month} colors={colors} />
      </View>

      {/* Tab 切换栏 */}
      <View style={[S.tabBar, { borderBottomColor: colors.border }]}>
        {PAGES.map((p) => {
          const active = activePage === p.key;
          const col = PAGE_COLORS[p.key];
          return (
            <TouchableOpacity key={p.key} onPress={() => handleTabPress(p.key)}
              style={[S.tabBtn, active && { borderBottomColor: col, borderBottomWidth: 2.5 }]}>
              <IconSymbol name={p.icon as any} size={16} color={active ? col : colors.muted} />
              <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? col : colors.muted, marginTop: 2 }}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 横滑内容区 */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexDirection: "row" }}>
        {/* 第一页：内嵌排班表 */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <SchedulePage colors={colors} />
        </View>

        {/* 第二页：员工档案（含对比开关） */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <EmployeeRosterPage month={month} colors={colors} />
        </View>

        {/* 第三页：薪资预支 */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <AdvancePage month={month} colors={colors} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent", gap: 2 },
});

const OV = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  title: { fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center" },
  item: { flex: 1, alignItems: "center" },
  divider: { width: StyleSheet.hairlineWidth, height: 32 },
  label: { fontSize: 10, marginBottom: 3 },
  value: { fontSize: 18, fontWeight: "800" },
  unit: { fontSize: 12, fontWeight: "400" },
  compareRow: { flexDirection: "row", alignItems: "center", paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
});

const PC = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  detailItem: { alignItems: "center", minWidth: 52 },
  detailLabel: { fontSize: 10, color: "#999", marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: "600" },
});

const CT = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  panel: { position: "absolute", right: 0, top: 34, borderRadius: 10, borderWidth: 1, zIndex: 100, minWidth: 110, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  option: { paddingHorizontal: 12, paddingVertical: 9 },
});

const SCH = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  segBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  headerRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  headerCell: { height: SCH_ROW_H, alignItems: "center", justifyContent: "center", gap: 1, borderRightWidth: StyleSheet.hairlineWidth },
  sessionHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 5, borderLeftWidth: 3 },
  empRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  nameCell: { height: SCH_ROW_H + 8, justifyContent: "center", alignItems: "center", borderRightWidth: 1 },
  empCode: { fontSize: 11, fontWeight: "700" },
  empName: { fontSize: 9 },
  cell: { height: SCH_ROW_H + 8, alignItems: "center", justifyContent: "center", borderRightWidth: StyleSheet.hairlineWidth },
  badge: { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  badgeText: { fontSize: 9, fontWeight: "700" },
});

const SCHEM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "700" },
  card: { borderRadius: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 13, fontWeight: "600" },
  input: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, textAlign: "center" },
  inputSmall: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, textAlign: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5 },
});
