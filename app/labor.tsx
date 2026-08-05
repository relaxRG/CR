/**
 * 员工管理主界面 v3
 * 横滑三页：排班表 / 员工档案（含发薪卡片）/ 薪资预支
 * 顶部：总览卡片（含对比开关：上月 / 去年同期）
 * 员工档案：自定义分组 + 每人发薪卡片（含对比开关）
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  Alert, Dimensions, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions, KeyboardAvoidingView} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, useEmployeeGroupStore, useAttendanceStore,
  usePaySlipStore, useShiftStore, useShiftTemplateStore,
  useHolidayConfigStore,
  useSpecialStatusStore, useGlobalPayrollSettingsStore,
  useCompOffBalanceEntryStore, useHolidayCompOffStore, useUnexplainedRestAlertStore,
  useCustomDeptStore, useBusinessHoursStore, useShiftGroupStore, useFillPresetStore,
} from "@/lib/labor/store";
import { useSalaryAdvanceStore, useAdvanceCategoryStore, BUILTIN_ADVANCE_CATEGORIES } from "@/lib/labor/advance-store";
import { usePettyCashStore, PETTY_CODE_LABELS, PettyRecord } from "@/lib/store/petty-store";
import { fabBottom } from "@/components/floating-tab-bar";
import { usePettyLaborLinkStore, PettyCashLaborLink, matchEmployeeFromDescription, extractKeywords } from "@/lib/store/petty-labor-link-store";
import {
  Employee, EmployeeDept, EmployeeGroup, ShiftEntry, ShiftHoursValue, ShiftTemplate,
  SpecialStatus, SpecialStatusDirection, DeptCategory, DEPT_CATEGORY_LABELS,
  DEPT_COLORS, DEPT_LABELS, EMPLOYEE_TYPE_LABELS, monthLabel,
  getMonthDates, getDayOfWeek, getContractHoursForDate,
  DEFAULT_SHIFT_TEMPLATES, DEFAULT_SPECIAL_STATUSES, SHIFT_COLOR_PRESETS, calcAllowance,
  calcCompOffExpiresMonth, BusinessHoursEntry, ShiftGroup, WEEKDAY_SHORT,
  DEFAULT_BUSINESS_HOURS, DEFAULT_SHIFT_GROUPS, FillPreset, isDayInRange,
  WEEKDAY_LABELS,
} from "@/lib/labor/types";

const { width: SCREEN_W } = Dimensions.get("window");
const SCH_NAME_W = 64;   // 排班表左侧姓名列宽
const SCH_CELL_W = 44;  // 排班表每天列宽
const SCH_ROW_H = 38;   // 排班表行高



type CompareMode = "none" | "lastMonth" | "lastYear" | "custom";
type HolidayDecisionItem = {
  key: string;
  employeeId: string;
  employeeCode: string;
  date: string;
  specialStatusId: string;
  holidayName: string;
  bonusAmount: number;
  mode: "cash" | "rest";
};

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
  const [showTrend, setShowTrend] = useState(false);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const compareMonth = getCompareMonth(month, compareMode, customMonth);

  const activeEmployees = useMemo(() => employees.filter((e) => e.active && !e.archived), [employees]);
  const monthSlips = useMemo(() => paySlips.filter((s) => s.month === month), [paySlips, month]);
  const totalSalary = useMemo(() => monthSlips.reduce((s, p) => s + p.finalSalary, 0), [monthSlips]);
  // finalSalary 已含预支扣除，待发合计直接累加 finalSalary
  const totalPending = useMemo(() => monthSlips.reduce((s, p) => s + Math.max(0, p.finalSalary), 0), [monthSlips]);
  const attendCount = useMemo(() => attendances.filter((a) => a.month === month).length, [attendances, month]);

  // 对比月数据
  const compareSlips = useMemo(() => compareMonth ? paySlips.filter((s) => s.month === compareMonth) : [], [paySlips, compareMonth]);
  const compareTotalSalary = useMemo(() => compareSlips.reduce((s, p) => s + p.finalSalary, 0), [compareSlips]);
  const diffSalary = compareMonth && totalSalary > 0 && compareTotalSalary > 0 ? totalSalary - compareTotalSalary : null;

  // 趋势图数据：近12个月的人力总成本
  const trendData = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(y, m - 1 - (11 - i), 1);
      const mo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const slips = paySlips.filter((s) => s.month === mo);
      const total = slips.reduce((s, p) => s + p.finalSalary, 0);
      return { month: mo, label: `${d.getMonth() + 1}月`, total };
    });
  }, [paySlips, month]);

  const maxTrend = useMemo(() => Math.max(...trendData.map((d) => d.total), 1), [trendData]);

  return (
    <View style={[OV.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* 标题行 + 对比开关 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Text style={[OV.title, { color: colors.foreground }]}>人力总览</Text>
        <CompareToggle mode={compareMode} customMonth={customMonth} baseMonth={month} onChange={setCompareMode} onCustomMonthChange={setCustomMonth} colors={colors} />
      </View>

      {/* 核心数字行：移除已录考勤，改为已发薪资 */}
      <View style={OV.row}>
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>在职</Text>
          <Text style={[OV.value, { color: colors.foreground }]}>{activeEmployees.length}<Text style={OV.unit}>人</Text></Text>
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>薪资合计</Text>
          <Text style={[OV.value, { color: colors.foreground }]}>
            {totalSalary > 0 ? `¥${totalSalary.toFixed(0)}` : "—"}
          </Text>
          {diffSalary !== null && (
            <Text style={{ fontSize: 10, color: diffSalary > 0 ? colors.error : colors.success }}>
              {diffSalary > 0 ? "▲" : "▼"} ¥{Math.abs(diffSalary).toFixed(0)}
            </Text>
          )}
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>已发</Text>
          <Text style={[OV.value, { color: colors.foreground }]}>
            {totalSalary - totalPending > 0 ? `¥${(totalSalary - totalPending).toFixed(0)}` : "—"}
          </Text>
        </View>
        <View style={[OV.divider, { backgroundColor: colors.border }]} />
        <View style={OV.item}>
          <Text style={[OV.label, { color: colors.muted }]}>待发</Text>
          <Text style={[OV.value, { color: totalPending > 0 ? colors.error : colors.muted }]}>
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
            <Text style={{ fontSize: 11, color: diffSalary > 0 ? colors.error : colors.success, marginLeft: 8 }}>
              {diffSalary > 0 ? "增加" : "减少"} ¥{Math.abs(diffSalary).toFixed(0)}（{((Math.abs(diffSalary) / compareTotalSalary) * 100).toFixed(1)}%）
            </Text>
          )}
        </View>
      )}

      {/* 趋势图展开按鈕 */}
      <TouchableOpacity onPress={() => { tap(); setShowTrend((v) => !v); }}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "44", marginTop: 8 }}>
        <IconSymbol name={showTrend ? "chevron.up" : "chart.line.uptrend.xyaxis"} size={12} color={colors.muted} />
        <Text style={{ fontSize: 11, color: colors.muted }}>{showTrend ? "收起趋势图" : "近12月薪资趋势"}</Text>
      </TouchableOpacity>

      {/* 趋势图内容：简单柱状图 */}
      {showTrend && (
        <View style={{ marginTop: 10, gap: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }}>近12个月人力总成本</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 80 }}>
            {trendData.map((d, i) => {
              const barH = maxTrend > 0 ? Math.max(4, (d.total / maxTrend) * 72) : 4;
              const isCurrent = d.month === month;
              return (
                <View key={d.month} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                  <View style={{ width: "100%", height: barH, borderRadius: 3, backgroundColor: isCurrent ? colors.primary : colors.primary + "44" }} />
                  <Text style={{ fontSize: 8, color: isCurrent ? colors.primary : colors.muted, fontWeight: isCurrent ? "700" : "400" }}>{d.label}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 10, color: colors.muted }}>最高：¥{maxTrend.toFixed(0)}</Text>
            <Text style={{ fontSize: 10, color: colors.primary, fontWeight: "600" }}>本月：¥{totalSalary.toFixed(0)}</Text>
          </View>
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
  const { getPaySlip, upsertPaySlip } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();
  const { templates: shiftTpls } = useShiftTemplateStore();
  const { getAvailableDays: getCompOffDays, addEntry: addCompOffEntry, getEntries: getCompOffEntries, cashOutEntry: cashOutCompOff } = useCompOffBalanceEntryStore();
  const { getAvailableDays: getHolidayCompOffDays } = useHolidayCompOffStore();
  const { getAlert, resolveAlert } = useUnexplainedRestAlertStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [expanded, setExpanded] = useState(false);
  const [showCompOffModal, setShowCompOffModal] = useState(false);
  // 面板模式：add（增加）| deduct（减少）
  const [panelMode, setPanelMode] = useState<"add" | "deduct">("add");
  // 增加子模式：hours（按加班小时）| days（直接天数）
  const [addMode, setAddMode] = useState<"hours" | "days">("hours");
  const [compOffHoursInput, setCompOffHoursInput] = useState("8");
  const [addDaysInput, setAddDaysInput] = useState("1");
  // 减少子模式：direct（直接减）| cashout（兑换现金）
  const [deductMode, setDeductMode] = useState<"direct" | "cashout">("direct");
  const [deductDaysInput, setDeductDaysInput] = useState("1");

  const slip = getPaySlip(employee.id, month);
  const att = getAttendance(employee.id, month);
  const compareSlip = compareMonth ? getPaySlip(employee.id, compareMonth) : null;
  const deptColor = DEPT_COLORS[employee.dept];
  const isParttime = employee.type === "parttime";

  const diffSalary = slip && compareSlip ? slip.finalSalary - compareSlip.finalSalary : null;
  // finalSalary 已含预支扣除，待发 = 实发（不再重复减 advanceAmount）
  const pending = slip ? slip.finalSalary : null;
  const attendanceSalary = att?.attendanceSalary ?? (slip?.attendanceSalary ?? 0);

  // 换休余额
  const compOffDays = getCompOffDays(employee.id, month);
  const holidayCompOffDays = getHolidayCompOffDays(employee.id, month);
  const totalCompOffDays = compOffDays + holidayCompOffDays;

  // 无来源多休提醒
  const restAlert = getAlert(employee.id, month);

  // ── 增加：按加班小时存入 ──
  const handleAddByHours = () => {
    const hours = Number(compOffHoursInput) || 8;
    if (hours < 4) { Alert.alert("最少需4小时加班"); return; }
    const days = hours >= 8 ? 1 : 0.5;
    addCompOffEntry({
      employeeId: employee.id,
      earnedMonth: month,
      source: "overtime",
      hoursDeducted: hours,
      days,
      expiresMonth: calcCompOffExpiresMonth(month),
      status: "available",
      notes: `加班存入，扣除${hours}h`,
    });
    setShowCompOffModal(false);
    Alert.alert("存入成功", `已存入 ${days} 天调休余额（${hours}h 加班），有效期3个月`);
  };
  // ── 增加：直接增加天数（不消耗加班时间）──
  const handleAddByDays = () => {
    const days = parseFloat(addDaysInput);
    if (isNaN(days) || days <= 0) { Alert.alert("请输入有效天数"); return; }
    addCompOffEntry({
      employeeId: employee.id,
      earnedMonth: month,
      source: "overtime",
      days,
      expiresMonth: calcCompOffExpiresMonth(month),
      status: "available",
      notes: `手动增加 ${days} 天`,
    });
    setShowCompOffModal(false);
    Alert.alert("增加成功", `已手动增加 ${days} 天调休余额，有效期3个月`);
  };
  // ── 减少：直接扣除天数（不产生金额）──
  const handleDeductDirect = () => {
    const days = parseFloat(deductDaysInput);
    if (isNaN(days) || days <= 0) { Alert.alert("请输入有效天数"); return; }
    const avail = getCompOffEntries(employee.id)
      .filter((e) => e.status === "available" && e.expiresMonth >= month)
      .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth));
    let remaining = days;
    for (const entry of avail) {
      if (remaining <= 0) break;
      if (entry.days <= remaining) {
        cashOutCompOff(entry.id, 0, month);
        remaining -= entry.days;
      }
    }
    setShowCompOffModal(false);
    Alert.alert("减少成功", `已手动减少 ${days} 天调休余额`);
  };
  // ── 减少：兑换现金（加班换休按时薪×小时，节假日换休按日薪）──
  const handleCashOut = (entry: ReturnType<typeof getCompOffEntries>[number]) => {
    const hourlyRate = employee.hourlyRate ?? 0;
    const dailyRate = att?.dailyRate ?? 0;
    // 加班换休：hoursDeducted × 时薪；节假日换休：days × 日薪
    const amount = entry.source === "overtime"
      ? Math.round((entry.hoursDeducted ?? entry.days * 8) * hourlyRate * 100) / 100
      : Math.round(entry.days * dailyRate * 100) / 100;
    cashOutCompOff(entry.id, amount / entry.days, month);
    // 同步更新薪资单
    const currentSlip = getPaySlip(employee.id, month);
    if (currentSlip) {
      upsertPaySlip({
        ...currentSlip,
        compOffCashOut: (currentSlip.compOffCashOut ?? 0) + amount,
        compOffCashOutNote: `兑换调休 ${entry.days}天 ¥${amount.toFixed(2)}`,
        grossSalary: currentSlip.grossSalary + amount,
        finalSalary: currentSlip.finalSalary + amount,
        totalEmployerCost: currentSlip.totalEmployerCost + amount,
        updatedAt: new Date().toISOString(),
      });
    }
    setShowCompOffModal(false);
    Alert.alert("兑换成功", `已将 ${entry.days} 天调休余额兑换 ¥${amount.toFixed(2)}，已加入本月薪资单`);
  };

  return (
    <TouchableOpacity activeOpacity={0.85}
      onPress={() => { tap(); setExpanded((v) => !v); }}
      onLongPress={() => { tap(); router.push({ pathname: "/labor-attendance", params: { employeeId: employee.id, month } } as any); }}
      style={[PC.card, { backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: deptColor, borderColor: colors.border }]}>

      {/* 顶部行：姓名 + 应发/待发 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {/* 左侧：员工信息 */}
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{employee.code}</Text>
            <Text style={{ fontSize: 13, color: colors.muted }}>{employee.realName}</Text>
            {isParttime && (
              <View style={{ backgroundColor: colors.warning + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: colors.warning }}>兼职</Text>
              </View>
            )}
          </View>
          {/* 调休余额小标签 */}
          {totalCompOffDays > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ backgroundColor: colors.success + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                <Text style={{ fontSize: 10, fontWeight: "600", color: colors.success }}>调休 {totalCompOffDays}天</Text>
              </View>
            </View>
          )}
        </View>
        {/* 右侧：应发/待发 */}
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14 }}>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 10, color: colors.muted }}>应发</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground, lineHeight: 22 }}>
                {slip ? `¥${slip.finalSalary.toFixed(0)}` : "—"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 10, color: colors.muted }}>待发</Text>
              <Text style={{ fontSize: 18, fontWeight: "800", color: pending && pending > 0 ? colors.success : colors.muted, lineHeight: 22 }}>
                {pending !== null ? `¥${pending.toFixed(0)}` : "—"}
              </Text>
            </View>
          </View>
          {diffSalary !== null && (
            <Text style={{ fontSize: 10, color: diffSalary > 0 ? colors.error : colors.success }}>
              {diffSalary > 0 ? "▲" : "▼"} ¥{Math.abs(diffSalary).toFixed(0)}
            </Text>
          )}
          {!slip && (
            <View style={{ backgroundColor: colors.warning + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ fontSize: 10, fontWeight: "600", color: colors.warning }}>待录入</Text>
            </View>
          )}
        </View>
      </View>

      {/* 展开明细（点击卡片展开） */}
      {expanded && (
        <View style={{ marginTop: 10, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "55", paddingTop: 10 }}>
          {/* 明细表格 */}
          {[
            { label: "出勤天数", value: att ? `${att.attendanceDays}天（应${att.expectedAttendanceDays ?? "—"}天）` : "—", color: colors.foreground },
            { label: "加班时长", value: att ? `${att.overtimeHours.toFixed(1)}h（计费${att.paidOvertimeHours?.toFixed(1) ?? att.overtimeHours.toFixed(1)}h）` : "—", color: colors.foreground },
            { label: "考勤工资", value: attendanceSalary > 0 ? `¥${attendanceSalary.toFixed(0)}` : "—", color: colors.foreground },
            { label: "绩效奖金", value: slip?.performanceBonus ? `+¥${slip.performanceBonus.toFixed(0)}` : "—", color: slip?.performanceBonus ? colors.success : colors.muted },
            { label: "补贴合计", value: (slip && (slip.mealAllowance + slip.transportAllowance + slip.otherAllowance) > 0) ? `+¥${(slip.mealAllowance + slip.transportAllowance + slip.otherAllowance).toFixed(0)}` : "—", color: (slip && (slip.mealAllowance + slip.transportAllowance + slip.otherAllowance) > 0) ? "#1677FF" : colors.muted },
            { label: "奖惩小计", value: slip?.rewardPenalty ? (slip.rewardPenalty > 0 ? `+¥${slip.rewardPenalty.toFixed(0)}` : `-¥${Math.abs(slip.rewardPenalty).toFixed(0)}`) : "—", color: slip?.rewardPenalty ? (slip.rewardPenalty > 0 ? colors.success : colors.error) : colors.muted },
            { label: "业绩提点", value: slip?.salesCommission ? `+¥${slip.salesCommission.toFixed(0)}` : "—", color: slip?.salesCommission ? "#1677FF" : colors.muted },
            { label: "预支小计", value: slip?.advanceAmount ? `-¥${slip.advanceAmount.toFixed(0)}` : "—", color: slip?.advanceAmount ? colors.warning : colors.muted },
          ].map(({ label, value, color }) => (
            <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
              <Text style={{ fontSize: 12, fontWeight: "600", color }}>{value}</Text>
            </View>
          ))}
          {/* 特殊状态扣薪明细 */}
          {att && Object.keys(att.specialStatusDeductions ?? {}).length > 0 && (
            <View style={{ gap: 2 }}>
              {Object.values(att.specialStatusDeductions).map((d) => (
                <View key={d.name} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{d.name}（{d.count}天）</Text>
                  <Text style={{ fontSize: 11, color: d.deduction > 0 ? colors.error : d.deduction < 0 ? colors.success : colors.muted }}>
                    {d.deduction > 0 ? `-¥${d.deduction.toFixed(0)}` : d.deduction < 0 ? `+¥${Math.abs(d.deduction).toFixed(0)}` : "不扣薪"}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {/* 社保/公积金/个税 */}
          {slip && (slip.socialInsuranceDeduction > 0 || slip.housingFundDeduction > 0 || slip.incomeTax > 0) && (
            <View style={{ gap: 2 }}>
              {slip.socialInsuranceDeduction > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>社保代扣</Text>
                  <Text style={{ fontSize: 11, color: colors.error }}>-¥{slip.socialInsuranceDeduction.toFixed(0)}</Text>
                </View>
              )}
              {slip.housingFundDeduction > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>公积金代扣</Text>
                  <Text style={{ fontSize: 11, color: colors.error }}>-¥{slip.housingFundDeduction.toFixed(0)}</Text>
                </View>
              )}
              {slip.incomeTax > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>个人所得税</Text>
                  <Text style={{ fontSize: 11, color: colors.error }}>-¥{slip.incomeTax.toFixed(0)}</Text>
                </View>
              )}
            </View>
          )}
          {/* 应发（税前）→ 实发（税后） */}
          {slip && (slip.socialInsuranceDeduction > 0 || slip.incomeTax > 0) && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>应发（税前）</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>¥{(slip.grossSalary ?? slip.finalSalary).toFixed(0)}</Text>
            </View>
          )}
          {/* 分隔线 + 最终薪资 */}
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 6, flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>实发薪资</Text>
            <Text style={{ fontSize: 15, fontWeight: "800", color: deptColor }}>{slip ? `¥${slip.finalSalary.toFixed(0)}` : "—"}</Text>
          </View>
          {/* 对比数据 */}
          {compareSlip && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>{compareModeLabel(compareMode)}实发薪资</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>¥{compareSlip.finalSalary.toFixed(0)}</Text>
            </View>
          )}
          {/* 备注 */}
          {slip?.notes && (
            <View style={{ backgroundColor: colors.border + "22", borderRadius: 6, padding: 8, marginTop: 4 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>备注：{slip.notes}</Text>
            </View>
          )}
          {/* 公司承担成本行 */}
          {slip && (slip.totalEmployerCost ?? 0) > 0 && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "44" }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>公司总人力成本</Text>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.warning }}>¥{(slip.totalEmployerCost ?? 0).toFixed(0)}</Text>
                {(slip.employerSocialInsurance ?? 0) + (slip.employerHousingFund ?? 0) > 0 && (
                  <Text style={{ fontSize: 10, color: colors.muted }}>含公司社保¥{((slip.employerSocialInsurance ?? 0) + (slip.employerHousingFund ?? 0)).toFixed(0)}</Text>
                )}
              </View>
            </View>
          )}

          {/* 调休余额 + 存入/兑换按钮 */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>调休余额</Text>
              <View style={{ backgroundColor: totalCompOffDays > 0 ? colors.success + "22" : colors.border + "44", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, fontWeight: "700", color: totalCompOffDays > 0 ? colors.success : colors.muted }}>{totalCompOffDays}天</Text>
              </View>
            </View>
            <TouchableOpacity onPress={() => { tap(); setPanelMode("add"); setAddMode("hours"); setShowCompOffModal(!showCompOffModal); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.success + "15", borderWidth: 1, borderColor: colors.success + "44" }}>
              <IconSymbol name="plusminus" size={11} color={colors.success} />
              <Text style={{ fontSize: 11, color: colors.success, fontWeight: "600" }}>存入/兑换</Text>
            </TouchableOpacity>
          </View>

          {/* 调休余额管理面板 */}
          {showCompOffModal && (
            <View style={{ backgroundColor: colors.background, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>调休余额管理</Text>
                <TouchableOpacity onPress={() => setShowCompOffModal(false)}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>关闭</Text>
                </TouchableOpacity>
              </View>
              {/* 主模式切换：增加 / 减少 */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {([["add", "+ 增加"] as const, ["deduct", "- 减少"] as const]).map(([mode, label]) => (
                  <TouchableOpacity key={mode} onPress={() => setPanelMode(mode)}
                    style={{ flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: "center",
                      backgroundColor: panelMode === mode ? (mode === "add" ? colors.success : colors.error) : colors.surface,
                      borderColor: panelMode === mode ? (mode === "add" ? colors.success : colors.error) : colors.border }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: panelMode === mode ? "#fff" : colors.muted }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── 增加面板 ── */}
              {panelMode === "add" && (
                <View style={{ gap: 10 }}>
                  {/* 子模式：按加班小时 / 直接天数 */}
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {([["hours", "按加班小时（消耗加班）"] as const, ["days", "直接增加天数"] as const]).map(([m, label]) => (
                      <TouchableOpacity key={m} onPress={() => setAddMode(m)}
                        style={{ flex: 1, paddingVertical: 6, borderRadius: 7, borderWidth: 1, alignItems: "center",
                          backgroundColor: addMode === m ? colors.success + "22" : colors.surface,
                          borderColor: addMode === m ? colors.success : colors.border }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: addMode === m ? colors.success : colors.muted }}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {addMode === "hours" && (
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>当月加班：{att?.overtimeHours?.toFixed(1) ?? 0}h · 已计费：{att?.paidOvertimeHours?.toFixed(1) ?? 0}h · 时薪 ¥{employee.hourlyRate}</Text>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        {[4, 8].map((h) => (
                          <TouchableOpacity key={h} onPress={() => setCompOffHoursInput(String(h))}
                            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7,
                              backgroundColor: compOffHoursInput === String(h) ? colors.success : colors.surface,
                              borderWidth: 1, borderColor: compOffHoursInput === String(h) ? colors.success : colors.border }}>
                            <Text style={{ fontSize: 12, color: compOffHoursInput === String(h) ? "#fff" : colors.muted }}>{h}h = {h >= 8 ? 1 : 0.5}天</Text>
                          </TouchableOpacity>
                        ))}
                        <TextInput value={compOffHoursInput} onChangeText={setCompOffHoursInput} keyboardType="decimal-pad"
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6, color: colors.foreground, width: 55, fontSize: 12 }} />
                        <Text style={{ fontSize: 11, color: colors.muted }}>h</Text>
                      </View>
                      <TouchableOpacity onPress={handleAddByHours}
                        style={{ paddingVertical: 9, borderRadius: 8, backgroundColor: colors.success, alignItems: "center" }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>
                          确认存入（{Number(compOffHoursInput) >= 8 ? 1 : 0.5}天）
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {addMode === "days" && (
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>直接增加天数，不消耗加班时间</Text>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        {[0.5, 1, 2].map((d) => (
                          <TouchableOpacity key={d} onPress={() => setAddDaysInput(String(d))}
                            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7,
                              backgroundColor: addDaysInput === String(d) ? colors.success : colors.surface,
                              borderWidth: 1, borderColor: addDaysInput === String(d) ? colors.success : colors.border }}>
                            <Text style={{ fontSize: 12, color: addDaysInput === String(d) ? "#fff" : colors.muted }}>{d}天</Text>
                          </TouchableOpacity>
                        ))}
                        <TextInput value={addDaysInput} onChangeText={setAddDaysInput} keyboardType="decimal-pad"
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6, color: colors.foreground, width: 55, fontSize: 12 }} />
                        <Text style={{ fontSize: 11, color: colors.muted }}>天</Text>
                      </View>
                      <TouchableOpacity onPress={handleAddByDays}
                        style={{ paddingVertical: 9, borderRadius: 8, backgroundColor: colors.success, alignItems: "center" }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>确认增加 {addDaysInput || "0"} 天</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              {/* ── 减少面板 ── */}
              {panelMode === "deduct" && (
                <View style={{ gap: 10 }}>
                  {/* 子模式：直接减 / 兑换现金 */}
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {([["direct", "直接减少天数"] as const, ["cashout", "兑换现金"] as const]).map(([m, label]) => (
                      <TouchableOpacity key={m} onPress={() => setDeductMode(m)}
                        style={{ flex: 1, paddingVertical: 6, borderRadius: 7, borderWidth: 1, alignItems: "center",
                          backgroundColor: deductMode === m ? colors.error + "22" : colors.surface,
                          borderColor: deductMode === m ? colors.error : colors.border }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: deductMode === m ? colors.error : colors.muted }}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {deductMode === "direct" && (
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>当前余额 {totalCompOffDays} 天，直接扣除（不产生金额）</Text>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        {[0.5, 1, 2].map((d) => (
                          <TouchableOpacity key={d} onPress={() => setDeductDaysInput(String(d))}
                            style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7,
                              backgroundColor: deductDaysInput === String(d) ? colors.error : colors.surface,
                              borderWidth: 1, borderColor: deductDaysInput === String(d) ? colors.error : colors.border }}>
                            <Text style={{ fontSize: 12, color: deductDaysInput === String(d) ? "#fff" : colors.muted }}>{d}天</Text>
                          </TouchableOpacity>
                        ))}
                        <TextInput value={deductDaysInput} onChangeText={setDeductDaysInput} keyboardType="decimal-pad"
                          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 6, color: colors.foreground, width: 55, fontSize: 12 }} />
                        <Text style={{ fontSize: 11, color: colors.muted }}>天</Text>
                      </View>
                      <TouchableOpacity onPress={handleDeductDirect}
                        style={{ paddingVertical: 9, borderRadius: 8, backgroundColor: colors.error, alignItems: "center" }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>确认减少 {deductDaysInput || "0"} 天</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {deductMode === "cashout" && (
                    <View style={{ gap: 8 }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{`加班换休 → 时薪 ¥${employee.hourlyRate} × 加班小时数\n节假日换休 → 日薪 ¥${att?.dailyRate?.toFixed(0) ?? "—"} × 天数`}</Text>
                      {getCompOffEntries(employee.id)
                        .filter((e) => e.status === "available" && e.expiresMonth >= month)
                        .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth))
                        .map((entry) => {
                          const isOT = entry.source === "overtime";
                          const hours = entry.hoursDeducted ?? entry.days * 8;
                          const amount = isOT
                            ? Math.round(hours * (employee.hourlyRate ?? 0) * 100) / 100
                            : Math.round(entry.days * (att?.dailyRate ?? 0) * 100) / 100;
                          return (
                            <View key={entry.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 10, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                                  {isOT ? `加班换休 ${entry.days}天（${hours}h）` : `${entry.holidayName ?? "节假日"} 换休 ${entry.days}天`}
                                </Text>
                                <Text style={{ fontSize: 11, color: colors.muted }}>
                                  {isOT ? `¥${employee.hourlyRate} × ${hours}h` : `¥${att?.dailyRate?.toFixed(0) ?? "—"} × ${entry.days}天`} · 到期 {entry.expiresMonth}
                                </Text>
                              </View>
                              <TouchableOpacity onPress={() => { tap(); handleCashOut(entry); }}
                                style={{ backgroundColor: colors.warning, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginLeft: 8 }}>
                                <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>兑换 ¥{amount.toFixed(0)}</Text>
                              </TouchableOpacity>
                            </View>
                          );
                        })}
                      {getCompOffEntries(employee.id).filter((e) => e.status === "available" && e.expiresMonth >= month).length === 0 && (
                        <Text style={{ fontSize: 12, color: colors.muted, textAlign: "center", paddingVertical: 8 }}>暂无可兑换余额</Text>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* 无来源多休提醒 */}
          {restAlert && restAlert.resolution === "pending" && (
            <View style={{ backgroundColor: colors.warning + "15", borderRadius: 8, padding: 8, gap: 6, borderWidth: 1, borderColor: colors.warning + "44" }}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.warning }}>⚠️ 本月多休{restAlert.unexplainedDays}天，无换休余额可抵扣</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[{ label: "扣薪", res: "deduct" as const, color: colors.error }, { label: "不扣薪", res: "waive" as const, color: colors.success }].map((opt) => (
                  <TouchableOpacity key={opt.res} onPress={() => resolveAlert(employee.id, month, opt.res)}
                    style={{ flex: 1, paddingVertical: 5, borderRadius: 6, backgroundColor: opt.color + "15", alignItems: "center" }}>
                    <Text style={{ fontSize: 11, color: opt.color, fontWeight: "600" }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* 操作按钮行：绩效补贴 | 编辑薪资 | 历史 */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <TouchableOpacity onPress={() => { tap(); router.push({ pathname: "/labor-kpi-allowance", params: { employeeId: employee.id, month } } as any); }}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.success + "15", borderWidth: 1, borderColor: colors.success + "44" }}>
              <IconSymbol name="chart.bar.fill" size={12} color={colors.success} />
              <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600" }}>绩效补贴</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { tap(); router.push({ pathname: "/labor-attendance", params: { employeeId: employee.id, month } } as any); }}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "44" }}>
              <IconSymbol name="pencil" size={12} color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>编辑薪资</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { tap(); router.push({ pathname: "/labor-salary-history", params: { employeeId: employee.id } } as any); }}
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#5856D6" + "15", borderWidth: 1, borderColor: "#5856D6" + "44" }}>
              <IconSymbol name="clock.fill" size={12} color="#5856D6" />
              <Text style={{ fontSize: 12, color: "#5856D6", fontWeight: "600" }}>历史</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── 员工档案页（第二页） ─────────────────────────────────────────────────────
function EmployeeRosterPage({ month, colors, headerComponent }: { month: string; colors: any; headerComponent?: React.ReactNode }) {
  const rosterInsets = useSafeAreaInsets();
  const { employees } = useEmployeeStore();
  const { groups, toggleCollapse } = useEmployeeGroupStore();
  const { templates: shiftTemplates } = useShiftTemplateStore();
  const { paySlips } = usePaySlipStore();
  const { records: attendances } = useAttendanceStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  // 导出 CSV
  const handleExport = useCallback(async () => {
    tap();
    try {
      const monthSlips = paySlips.filter((s) => s.month === month);
      const monthAtts = attendances.filter((a) => a.month === month);
      const activeEmps = employees.filter((e) => e.active && !e.archived);

      const header = ["姓名", "代号", "部门", "类型", "出勤天", "总工时", "加班时", "考勤工资", "绩效", "补贴", "奖惩", "社保(个人)", "公积金(个人)", "个税", "预支", "应发", "实发", "公司社保", "公司公积金", "公司总成本"];
      const rows = activeEmps.map((emp) => {
        const slip = monthSlips.find((s) => s.employeeId === emp.id);
        const att = monthAtts.find((a) => a.employeeId === emp.id);
        return [
          emp.realName, emp.code,
          DEPT_LABELS[emp.dept], EMPLOYEE_TYPE_LABELS[emp.type],
          att?.attendanceDays ?? "",
          att?.totalHours?.toFixed(1) ?? "",
          att?.paidOvertimeHours?.toFixed(1) ?? "",
          slip?.attendanceSalary?.toFixed(2) ?? "",
          slip?.performanceBonus?.toFixed(2) ?? "",
          ((slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0)).toFixed(2),
          slip?.rewardPenalty?.toFixed(2) ?? "",
          slip?.socialInsuranceDeduction?.toFixed(2) ?? "",
          slip?.housingFundDeduction?.toFixed(2) ?? "",
          slip?.incomeTax?.toFixed(2) ?? "",
          slip?.advanceAmount?.toFixed(2) ?? "",
          (slip?.grossSalary ?? slip?.finalSalary ?? 0).toFixed(2),
          slip?.finalSalary?.toFixed(2) ?? "",
          slip?.employerSocialInsurance?.toFixed(2) ?? "0",
          slip?.employerHousingFund?.toFixed(2) ?? "0",
          slip?.totalEmployerCost?.toFixed(2) ?? (slip?.grossSalary ?? 0).toFixed(2),
        ];
      });

      const csvContent = [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const csvWithBOM = "\uFEFF" + csvContent; // UTF-8 BOM for Excel

      const fileName = `薪资表_${month}.csv`;

      // 使用静态 import 的 expo-file-system 和 expo-sharing
      const fileUri = (FileSystem.cacheDirectory ?? "") + fileName;
      await FileSystem.writeAsStringAsync(fileUri, csvWithBOM, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: "text/csv", dialogTitle: `导出${month}薪资表` });
      } else {
        Alert.alert("导出完成", `文件已保存到：${fileUri}`);
      }
    } catch (e) {
      Alert.alert("导出失败", String(e));
    }
  }, [paySlips, attendances, employees, month]);

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

  const activeEmployees = useMemo(() => employees.filter((e) => e.active && !e.archived), [employees]);

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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: fabBottom(rosterInsets.bottom) + 20 }}>
      {headerComponent}
      {/* 工具栏：员工管理 + 对比开关 + 设置 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {/* 员工管理按鈕 - 跳转到员工列表页 */}
        <TouchableOpacity onPress={() => { tap(); router.push("/labor-employees" as any); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.border + "44" }}>
          <IconSymbol name="person.2.fill" size={15} color={colors.foreground} />
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>员工管理</Text>
        </TouchableOpacity>
        {/* 新增员工 */}
        <TouchableOpacity onPress={() => { tap(); router.push("/labor-employee-form" as any); }}
          style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.primary + "66", backgroundColor: colors.primary + "08" }}>
          <IconSymbol name="plus" size={13} color={colors.primary} />
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>添加员工</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        {/* 薪资对比开关 */}
        <CompareToggle mode={compareMode} customMonth={customMonth} baseMonth={month} onChange={setCompareMode} onCustomMonthChange={setCustomMonth} colors={colors} />
        {/* 导出按鈕 */}
        <TouchableOpacity onPress={handleExport}
          style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.border + "44", alignItems: "center", justifyContent: "center" }}>
          <IconSymbol name="square.and.arrow.up" size={16} color={colors.muted} />
        </TouchableOpacity>
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
// 备用金人工关联卡片：显示备用金条目、员工匹配、同步薪资单
function AdvancePage({ month, colors, headerComponent }: { month: string; colors: any; headerComponent?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { employees } = useEmployeeStore();
  const { advances, addAdvance, updateAdvance, deleteAdvance } = useSalaryAdvanceStore();
  const { allCategories, addCategory: addAdvanceCategory, updateCategory, deleteCategory } = useAdvanceCategoryStore();
  const { records: pettyRecords, addRecord: addPettyRecord } = usePettyCashStore();
  const { links, aliases, addLink, updateLink, deleteLink, learnAlias, getLinksForMonth, isLinked } = usePettyLaborLinkStore();
  const { getPaySlip, upsertPaySlip } = usePaySlipStore();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  // ── 新增预支 Modal state ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmpId, setAddEmpId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addCategory, setAddCategoryState] = useState("fulltime_advance");
  const [addDate, setAddDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addDateMode, setAddDateMode] = useState<"today" | "yesterday" | "custom">("today");
  const [addPettyRecordId, setAddPettyRecordId] = useState<string>("");
  const [addUsePetty, setAddUsePetty] = useState(false);
  // 新增备用金快速录入 state
  const [showQuickPetty, setShowQuickPetty] = useState(false);
  const [quickPettyCode, setQuickPettyCode] = useState<"K1" | "K9">("K1");
  const [quickPettyAmount, setQuickPettyAmount] = useState("");
  const [quickPettyDesc, setQuickPettyDesc] = useState("");

  // ── 员工匹配弹窗 state ──
  const [matchingLink, setMatchingLink] = useState<PettyCashLaborLink | null>(null);
  const [matchEmpId, setMatchEmpId] = useState("");

  // ── 匹配备用金 Modal state ──
  const [showMatchPettyModal, setShowMatchPettyModal] = useState(false);
  const [matchPettySelections, setMatchPettySelections] = useState<Record<string, { checked: boolean; empId: string }>>({});

  // ── 分类管理 Modal state ──
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");

  // 人工相关备用金代码
  const LABOR_PETTY_CODES = ["K1", "K9"];

  // 当月备用金记录（人工相关，未被关联的）
  const monthPettyRecords = React.useMemo(() =>
    pettyRecords.filter((r) => r.date.startsWith(month)),
    [pettyRecords, month]
  );
  // 当月已关联的 links
  const monthLinks = React.useMemo(() => getLinksForMonth(month), [links, month]);
  // 智能识别：当月未被关联的人工相关备用金记录
  const unlinkedLaborRecords = React.useMemo(() =>
    monthPettyRecords.filter((r) => LABOR_PETTY_CODES.includes(r.code) && !isLinked(r.id)),
    [monthPettyRecords, isLinked]
  );
  // 自动生成草稿关联（智能识别，未保存）
  const autoDraftLinks = React.useMemo(() =>
    unlinkedLaborRecords.map((r) => {
      const match = matchEmployeeFromDescription(r.description, aliases, employees);
      return { pettyRecord: r, suggestedEmployeeId: match.employeeId, matchType: match.matchType };
    }),
    [unlinkedLaborRecords, aliases, employees]
  );

  const activeEmployees = React.useMemo(() => employees.filter((e) => e.active && !e.archived), [employees]);
  const getEmployee = (id: string) => employees.find((e) => e.id === id);

  // ── 员工按部门分组 ──
  const employeesByDept = React.useMemo(() => {
    const groups: { dept: EmployeeDept; label: string; color: string; employees: Employee[] }[] = [
      { dept: "front", label: "前厅", color: DEPT_COLORS.front, employees: [] },
      { dept: "kitchen", label: "后厨", color: DEPT_COLORS.kitchen, employees: [] },
      { dept: "parttime", label: "兼职", color: DEPT_COLORS.parttime, employees: [] },
      { dept: "other", label: "其他", color: DEPT_COLORS.other, employees: [] },
    ];
    for (const emp of activeEmployees) {
      const group = groups.find((g) => g.dept === emp.dept);
      if (group) group.employees.push(emp);
    }
    return groups.filter((g) => g.employees.length > 0);
  }, [activeEmployees]);

  // ── 当月可选备用金条目（K1/K9，未被关联）──
  const availablePettyForAdvance = React.useMemo(() =>
    monthPettyRecords.filter((r) => LABOR_PETTY_CODES.includes(r.code)),
    [monthPettyRecords]
  );

  // ── 即时同步薪资单 ──
  const syncAdvanceToPaySlip = React.useCallback((employeeId: string, delta: number) => {
    const existing = getPaySlip(employeeId, month);
    if (!existing) return;
    const newAdvance = Math.max(0, (existing.advanceAmount ?? 0) + delta);
    const newFinal = Math.round((existing.finalSalary - delta) * 100) / 100;
    upsertPaySlip({ ...existing, advanceAmount: newAdvance, finalSalary: newFinal, updatedAt: new Date().toISOString() });
  }, [getPaySlip, upsertPaySlip, month]);

  // ── 将关联同步到薪资单 ──
  const syncLinkToPaySlip = React.useCallback((link: PettyCashLaborLink) => {
    if (!link.employeeId || !link.syncedToPaySlip) return;
    const existing = getPaySlip(link.employeeId, month);
    if (!existing) return;
    const currentLinkIds = existing.pettyLaborLinkIds ?? [];
    if (currentLinkIds.includes(link.id)) return;
    const newLinkIds = [...currentLinkIds, link.id];
    const newPaid = (existing.pettyLaborPaid ?? 0) + link.amount;
    const newFinal = Math.round((existing.finalSalary - link.amount) * 100) / 100;
    upsertPaySlip({ ...existing, pettyLaborPaid: newPaid, pettyLaborLinkIds: newLinkIds, finalSalary: newFinal });
  }, [getPaySlip, upsertPaySlip, month]);

  // ── 从薪资单移除关联 ──
  const removeLinkFromPaySlip = React.useCallback((link: PettyCashLaborLink) => {
    if (!link.employeeId) return;
    const existing = getPaySlip(link.employeeId, month);
    if (!existing) return;
    const newLinkIds = (existing.pettyLaborLinkIds ?? []).filter((id) => id !== link.id);
    const newPaid = Math.max(0, (existing.pettyLaborPaid ?? 0) - link.amount);
    const newFinal = Math.round((existing.finalSalary + link.amount) * 100) / 100;
    upsertPaySlip({ ...existing, pettyLaborPaid: newPaid, pettyLaborLinkIds: newLinkIds, finalSalary: newFinal });
  }, [getPaySlip, upsertPaySlip, month]);

  // ── 确认纳入一条草稿关联 ──
  const confirmDraftLink = (pettyRecord: PettyRecord, empId: string, matchType: "auto" | "manual" | "unmatched") => {
    const id = addLink({
      pettyRecordId: pettyRecord.id, pettyCode: pettyRecord.code, amount: pettyRecord.amount,
      date: pettyRecord.date, description: pettyRecord.description, paymentMethod: pettyRecord.paymentMethod,
      employeeId: empId, matchType, month, syncedToPaySlip: empId !== "",
    });
    if (empId && matchType === "manual") {
      extractKeywords(pettyRecord.description).forEach((kw) => learnAlias(kw, empId));
    }
    if (empId) {
      const link = { id, pettyRecordId: pettyRecord.id, pettyCode: pettyRecord.code, amount: pettyRecord.amount,
        date: pettyRecord.date, description: pettyRecord.description, paymentMethod: pettyRecord.paymentMethod,
        employeeId: empId, matchType, month, syncedToPaySlip: true, createdAt: "", updatedAt: "" };
      syncLinkToPaySlip(link);
    }
  };

  // ── 手动匹配员工 ──
  const handleManualMatch = (link: PettyCashLaborLink, newEmpId: string) => {
    if (link.employeeId) removeLinkFromPaySlip(link);
    updateLink(link.id, { employeeId: newEmpId, matchType: "manual", syncedToPaySlip: newEmpId !== "" });
    if (newEmpId) {
      extractKeywords(link.description).forEach((kw) => learnAlias(kw, newEmpId));
      syncLinkToPaySlip({ ...link, employeeId: newEmpId, syncedToPaySlip: true });
    }
    setMatchingLink(null);
  };

  // ── 删除关联 ──
  const handleDeleteLink = (link: PettyCashLaborLink) => {
    Alert.alert("取消关联", `确认将「${link.description}」¥${link.amount} 从薪资预支中移除？`, [
      { text: "取消", style: "cancel" },
      { text: "移除", style: "destructive", onPress: () => { removeLinkFromPaySlip(link); deleteLink(link.id); } },
    ]);
  };

  // ── 新增手动预支（即时同步薪资单）──
  const handleAddAdvance = () => {
    if (!addEmpId) { Alert.alert("请选择员工"); return; }
    if (!addAmount || isNaN(Number(addAmount)) || Number(addAmount) <= 0) { Alert.alert("请填写正确的预支金额"); return; }
    const amount = parseFloat(addAmount);
    addAdvance({
      employeeId: addEmpId, amount, date: addDate,
      deductMonth: month, status: "pending",
      category: addCategory,
      pettyRecordId: addUsePetty && addPettyRecordId ? addPettyRecordId : undefined,
      notes: addNotes,
    });
    // 即时同步薪资单
    syncAdvanceToPaySlip(addEmpId, amount);
    setShowAddModal(false);
    setAddEmpId(""); setAddAmount(""); setAddNotes(""); setAddPettyRecordId(""); setAddUsePetty(false);
  };

  // ── 快速新增备用金条目 ──
  const handleQuickAddPetty = () => {
    if (!quickPettyAmount || isNaN(Number(quickPettyAmount))) { Alert.alert("请填写金额"); return; }
    addPettyRecord({
      date: addDate, code: quickPettyCode, amount: parseFloat(quickPettyAmount),
      description: quickPettyDesc || `${PETTY_CODE_LABELS[quickPettyCode]} 支出`,
      paymentMethod: "现金", receiptUri: "",
    });
    setShowQuickPetty(false);
    setQuickPettyAmount(""); setQuickPettyDesc("");
    Alert.alert("已添加", `已新增 ${quickPettyCode} 备用金条目 ¥${quickPettyAmount}`);
  };

  // ── 匹配备用金：初始化选择状态 ──
  const initMatchPettySelections = () => {
    const init: Record<string, { checked: boolean; empId: string }> = {};
    unlinkedLaborRecords.forEach((r) => {
      const match = matchEmployeeFromDescription(r.description, aliases, employees);
      init[r.id] = { checked: true, empId: match.employeeId };
    });
    setMatchPettySelections(init);
    setShowMatchPettyModal(true);
  };

  // ── 批量确认匹配备用金 ──
  const handleBatchConfirmMatch = () => {
    const toConfirm = unlinkedLaborRecords.filter((r) => matchPettySelections[r.id]?.checked);
    for (const r of toConfirm) {
      const empId = matchPettySelections[r.id]?.empId ?? "";
      confirmDraftLink(r, empId, empId ? "manual" : "unmatched");
    }
    setShowMatchPettyModal(false);
    Alert.alert("匹配完成", `已关联 ${toConfirm.length} 条备用金记录`);
  };

  // ── 分组全选/取消全选 ──
  const toggleGroupSelection = (code: string, checked: boolean) => {
    const ids = unlinkedLaborRecords.filter((r) => r.code === code).map((r) => r.id);
    setMatchPettySelections((prev) => {
      const next = { ...prev };
      ids.forEach((id) => { next[id] = { ...next[id], checked }; });
      return next;
    });
  };

  const totalLinked = React.useMemo(() => monthLinks.reduce((s, l) => s + l.amount, 0), [monthLinks]);
  const manualAdvances = React.useMemo(() =>
    advances.filter((a) => (a.deductMonth === month || a.date.startsWith(month))),
    [advances, month]
  );

  // ── 日期快捷选 ──
  const handleDateMode = (mode: "today" | "yesterday" | "custom") => {
    setAddDateMode(mode);
    if (mode === "today") setAddDate(new Date().toISOString().slice(0, 10));
    else if (mode === "yesterday") {
      const d = new Date(); d.setDate(d.getDate() - 1);
      setAddDate(d.toISOString().slice(0, 10));
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: fabBottom(insets.bottom) + 80 }}>
        {headerComponent}

        {/* 汇总卡片 */}
        <View style={{ borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#AF52DE" + "33", backgroundColor: "#AF52DE" + "08" }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }}>{monthLabel(month)} 薪资预支</Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: "#AF52DE", marginTop: 4 }}>
            ¥{(totalLinked + manualAdvances.reduce((s, a) => s + a.amount, 0)).toFixed(0)}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
            备用金关联 {monthLinks.length} 笔 · 手动录入 {manualAdvances.length} 笔
          </Text>
          <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "#AF52DE" + "22" }}>
              <Text style={{ fontSize: 11, color: "#AF52DE" }}>备用金已付 ¥{totalLinked.toFixed(0)}</Text>
            </View>
            {autoDraftLinks.length > 0 && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.warning + "22" }}>
                <Text style={{ fontSize: 11, color: colors.warning }}>待确认 {autoDraftLinks.length} 笔</Text>
              </View>
            )}
          </View>
        </View>

        {/* 智能识别草稿（待确认纳入） */}
        {autoDraftLinks.length > 0 && (
          <View style={{ borderRadius: 14, borderWidth: 1.5, borderColor: colors.warning + "66", backgroundColor: colors.warning + "08", overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.warning, flex: 1 }}>
                ⚡ 智能识别 · 待确认（{autoDraftLinks.length}笔）
              </Text>
              <Text style={{ fontSize: 10, color: colors.muted }}>点击纳入薪资预支</Text>
            </View>
            {autoDraftLinks.map((draft, i) => {
              const emp = draft.suggestedEmployeeId ? getEmployee(draft.suggestedEmployeeId) : null;
              return (
                <View key={draft.pettyRecord.id} style={[{ padding: 12, gap: 6 }, i > 0 && { borderTopWidth: 0.5, borderTopColor: colors.warning + "33" }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{draft.pettyRecord.description || "备用金支付"}</Text>
                      <Text style={{ fontSize: 10, color: colors.muted }}>{draft.pettyRecord.code} · {draft.pettyRecord.date.slice(5)} · {draft.pettyRecord.paymentMethod}</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.warning }}>¥{draft.pettyRecord.amount.toFixed(0)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {emp ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flex: 1 }}>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.success + "22" }}>
                          <Text style={{ fontSize: 11, color: colors.success }}>✓ 匹配 {emp.code}</Text>
                        </View>
                        <Text style={{ fontSize: 10, color: colors.muted }}>自动识别</Text>
                      </View>
                    ) : (
                      <Text style={{ fontSize: 11, color: colors.muted, flex: 1 }}>未识别员工，可纳入后手动匹配</Text>
                    )}
                    <TouchableOpacity onPress={() => { tap(); confirmDraftLink(draft.pettyRecord, draft.suggestedEmployeeId, draft.matchType); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.warning }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>纳入</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* 已关联的备用金卡片 */}
        {monthLinks.length > 0 && (
          <View style={{ borderRadius: 14, borderWidth: 1, borderColor: "#AF52DE" + "44", backgroundColor: "#AF52DE" + "06", overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#AF52DE", flex: 1 }}>备用金关联（{monthLinks.length}笔）</Text>
              <Text style={{ fontSize: 13, fontWeight: "700", color: "#AF52DE" }}>¥{totalLinked.toFixed(0)}</Text>
            </View>
            {monthLinks.map((link, i) => {
              const emp = link.employeeId ? getEmployee(link.employeeId) : null;
              return (
                <TouchableOpacity key={link.id} onLongPress={() => { tap(); handleDeleteLink(link); }}
                  style={[{ flexDirection: "row", alignItems: "center", padding: 12, gap: 10 }, i > 0 && { borderTopWidth: 0.5, borderTopColor: "#AF52DE" + "22" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{link.description || "备用金支付"}</Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>{link.pettyCode} · {link.date.slice(5)} · {link.paymentMethod}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }}>¥{link.amount.toFixed(0)}</Text>
                    <TouchableOpacity onPress={() => { tap(); setMatchingLink(link); setMatchEmpId(link.employeeId); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: emp ? colors.success + "22" : colors.error + "22" }}>
                      <Text style={{ fontSize: 10, fontWeight: "600", color: emp ? colors.success : colors.error }}>
                        {emp ? `✓ ${emp.code}` : "未匹配 点击设置"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* 手动录入的预支记录 */}
        {manualAdvances.length > 0 && (
          <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, flex: 1 }}>手动录入预支</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>长按可删除</Text>
            </View>
            {manualAdvances.map((adv, i) => {
              const emp = getEmployee(adv.employeeId);
              const deptColor = emp ? DEPT_COLORS[emp.dept] : colors.muted;
              const cat = allCategories.find((c) => c.id === adv.category);
              return (
                <TouchableOpacity key={adv.id}
                  onLongPress={() => { tap(); Alert.alert("删除预支", `确认删除 ${emp?.code ?? ""} 的 ¥${adv.amount} 预支记录？`, [
                    { text: "取消", style: "cancel" },
                    { text: "删除", style: "destructive", onPress: () => {
                      deleteAdvance(adv.id);
                      // 即时同步薪资单
                      syncAdvanceToPaySlip(adv.employeeId, -adv.amount);
                    }},
                  ]); }}
                  style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }, i > 0 && { borderTopWidth: 0.5, borderTopColor: colors.border }]}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: deptColor + "22" }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: deptColor }}>{emp?.code.slice(0, 2) ?? "?"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{emp?.code ?? "未知员工"} · {adv.date.slice(5)}</Text>
                      {cat && (
                        <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#AF52DE" + "18" }}>
                          <Text style={{ fontSize: 10, color: "#AF52DE", fontWeight: "600" }}>{cat.name}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{adv.notes || "手动录入"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: "#AF52DE" }}>¥{adv.amount.toFixed(0)}</Text>
                    <TouchableOpacity onPress={() => { tap(); updateAdvance(adv.id, { status: adv.status === "deducted" ? "pending" : "deducted" }); }}
                      style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: adv.status === "deducted" ? "#52C41A22" : "#FA8C1622" }}>
                      <Text style={{ fontSize: 10, fontWeight: "600", color: adv.status === "deducted" ? colors.success : colors.warning }}>
                        {adv.status === "deducted" ? "已扣除" : "待扣除"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {monthLinks.length === 0 && manualAdvances.length === 0 && autoDraftLinks.length === 0 && (
          <View style={{ alignItems: "center", padding: 32 }}>
            <IconSymbol name="creditcard.fill" size={48} color={colors.border} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月暂无预支记录</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>备用金 K1/K9 记录自动识别，也可手动新增</Text>
          </View>
        )}

        {/* ── 新增手动预支 Modal ── */}
        <Modal visible={showAddModal} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
              <ScrollView style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
                contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>新增预支记录</Text>
                  <TouchableOpacity onPress={() => setShowCategoryModal(true)}>
                    <Text style={{ fontSize: 13, color: colors.primary }}>⚙ 分类管理</Text>
                  </TouchableOpacity>
                </View>

                {/* 员工选择（按部门分组） */}
                <View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 8 }}>员工</Text>
                  {employeesByDept.map((group) => (
                    <View key={group.dept} style={{ marginBottom: 8 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: group.color, marginBottom: 6 }}>{group.label}</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {group.employees.map((emp) => (
                          <TouchableOpacity key={emp.id} onPress={() => { tap(); setAddEmpId(emp.id); }}
                            style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                              backgroundColor: addEmpId === emp.id ? group.color : colors.border + "44",
                              borderWidth: 1, borderColor: addEmpId === emp.id ? group.color : "transparent" }}>
                            <Text style={{ fontSize: 13, fontWeight: "600", color: addEmpId === emp.id ? "#fff" : colors.foreground }}>{emp.code}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>

                {/* 分类选择 */}
                <View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>分类</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {allCategories.map((cat) => (
                        <TouchableOpacity key={cat.id} onPress={() => { tap(); setAddCategoryState(cat.id); }}
                          style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                            backgroundColor: addCategory === cat.id ? "#AF52DE" : colors.border + "44" }}>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: addCategory === cat.id ? "#fff" : colors.muted }}>{cat.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </View>

                {/* 预支金额 */}
                <View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>预支金额</Text>
                  <TextInput value={addAmount} onChangeText={setAddAmount} keyboardType="decimal-pad" placeholder="输入金额"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, backgroundColor: colors.background }} />
                </View>

                {/* 日期快捷选 */}
                <View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>预支日期</Text>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    {([["today", "今天"], ["yesterday", "昨天"], ["custom", "自定义"]] as const).map(([mode, label]) => (
                      <TouchableOpacity key={mode} onPress={() => { tap(); handleDateMode(mode); }}
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                          backgroundColor: addDateMode === mode ? "#AF52DE" : colors.border + "44" }}>
                        <Text style={{ fontSize: 12, fontWeight: "600", color: addDateMode === mode ? "#fff" : colors.muted }}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                    {addDateMode === "custom" && (
                      <TextInput value={addDate} onChangeText={setAddDate} placeholder="YYYY-MM-DD"
                        style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 8, fontSize: 13, color: colors.foreground, backgroundColor: colors.background, flex: 1 }} />
                    )}
                    {addDateMode !== "custom" && (
                      <Text style={{ fontSize: 12, color: colors.muted }}>{addDate}</Text>
                    )}
                  </View>
                </View>

                {/* 备用金支付 */}
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>通过备用金支付</Text>
                    <TouchableOpacity onPress={() => { tap(); setAddUsePetty(!addUsePetty); setAddPettyRecordId(""); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8,
                        backgroundColor: addUsePetty ? "#AF52DE" : colors.border + "44" }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: addUsePetty ? "#fff" : colors.muted }}>{addUsePetty ? "已开启" : "未开启"}</Text>
                    </TouchableOpacity>
                  </View>
                  {addUsePetty && (
                    <View style={{ gap: 8 }}>
                      {availablePettyForAdvance.length > 0 ? (
                        <>
                          <Text style={{ fontSize: 11, color: colors.muted }}>选择备用金条目（可选）</Text>
                          {availablePettyForAdvance.map((r) => (
                            <TouchableOpacity key={r.id} onPress={() => {
                              tap();
                              setAddPettyRecordId(addPettyRecordId === r.id ? "" : r.id);
                              if (addPettyRecordId !== r.id && !addAmount) setAddAmount(String(r.amount));
                            }}
                              style={{ flexDirection: "row", alignItems: "center", padding: 10, borderRadius: 10, borderWidth: 1,
                                backgroundColor: addPettyRecordId === r.id ? "#AF52DE" + "15" : colors.background,
                                borderColor: addPettyRecordId === r.id ? "#AF52DE" : colors.border }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{r.description || r.code}</Text>
                                <Text style={{ fontSize: 10, color: colors.muted }}>{r.code} · {r.date.slice(5)} · {r.paymentMethod}</Text>
                              </View>
                              <Text style={{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }}>¥{r.amount.toFixed(0)}</Text>
                            </TouchableOpacity>
                          ))}
                        </>
                      ) : (
                        <View style={{ padding: 10, borderRadius: 10, backgroundColor: colors.warning + "10", borderWidth: 1, borderColor: colors.warning + "33" }}>
                          <Text style={{ fontSize: 12, color: colors.warning }}>当月暂无 K1/K9 备用金条目</Text>
                        </View>
                      )}
                      <TouchableOpacity onPress={() => setShowQuickPetty(true)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 10,
                          borderWidth: 1, borderStyle: "dashed", borderColor: colors.border }}>
                        <IconSymbol name="plus" size={14} color={colors.primary} />
                        <Text style={{ fontSize: 12, color: colors.primary }}>没有找到？直接新增到备用金</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/* 快速新增备用金 */}
                {showQuickPetty && (
                  <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, gap: 10 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>快速新增备用金条目</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["K1", "K9"] as const).map((code) => (
                        <TouchableOpacity key={code} onPress={() => setQuickPettyCode(code)}
                          style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
                            backgroundColor: quickPettyCode === code ? "#AF52DE" : colors.border + "44" }}>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: quickPettyCode === code ? "#fff" : colors.muted }}>
                            {code} {PETTY_CODE_LABELS[code]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput value={quickPettyAmount} onChangeText={setQuickPettyAmount} keyboardType="decimal-pad" placeholder="金额"
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 14, color: colors.foreground }} />
                    <TextInput value={quickPettyDesc} onChangeText={setQuickPettyDesc} placeholder="描述（可选）"
                      style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, fontSize: 13, color: colors.foreground }} />
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity onPress={() => setShowQuickPetty(false)}
                        style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: colors.border + "44", alignItems: "center" }}>
                        <Text style={{ color: colors.muted }}>取消</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleQuickAddPetty}
                        style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: "#AF52DE", alignItems: "center" }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>添加到备用金</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* 备注 */}
                <View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>备注（可选）</Text>
                  <TextInput value={addNotes} onChangeText={setAddNotes} placeholder="备注说明"
                    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: colors.foreground, backgroundColor: colors.background }} />
                </View>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity onPress={() => setShowAddModal(false)}
                    style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.border + "44", alignItems: "center" }}>
                    <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleAddAdvance}
                    style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#AF52DE", alignItems: "center" }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>确认添加</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        {/* ── 员工匹配弹窗 ── */}
        <Modal visible={matchingLink !== null} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
            <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>匹配员工 · {matchingLink?.description}</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>选择后将记忆此备注与员工的对应关系，下次自动匹配</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity onPress={() => setMatchEmpId("")}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: matchEmpId === "" ? colors.error : colors.border + "44" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: matchEmpId === "" ? "#fff" : colors.muted }}>不匹配</Text>
                  </TouchableOpacity>
                  {activeEmployees.map((emp) => (
                    <TouchableOpacity key={emp.id} onPress={() => setMatchEmpId(emp.id)}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: matchEmpId === emp.id ? "#AF52DE" : colors.border + "44" }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: matchEmpId === emp.id ? "#fff" : colors.foreground }}>{emp.code}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity onPress={() => setMatchingLink(null)}
                  style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: colors.border + "44", alignItems: "center" }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { if (matchingLink) handleManualMatch(matchingLink, matchEmpId); }}
                  style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: "#AF52DE", alignItems: "center" }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>确认匹配</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── 匹配备用金 Modal ── */}
        <Modal visible={showMatchPettyModal} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
            <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%", paddingBottom: 20 }}>
              <View style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, flex: 1 }}>匹配备用金</Text>
                <TouchableOpacity onPress={() => setShowMatchPettyModal(false)}>
                  <Text style={{ fontSize: 15, color: colors.muted }}>关闭</Text>
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
                {(["K1", "K9"] as const).map((code) => {
                  const groupRecords = unlinkedLaborRecords.filter((r) => r.code === code);
                  if (groupRecords.length === 0) return null;
                  const allChecked = groupRecords.every((r) => matchPettySelections[r.id]?.checked);
                  return (
                    <View key={code} style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", padding: 12, backgroundColor: colors.background }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#AF52DE", flex: 1 }}>{PETTY_CODE_LABELS[code]}</Text>
                        <TouchableOpacity onPress={() => { tap(); toggleGroupSelection(code, !allChecked); }}
                          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 7,
                            backgroundColor: allChecked ? "#AF52DE" : colors.border + "44" }}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: allChecked ? "#fff" : colors.muted }}>
                            {allChecked ? "取消全选" : "全选"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      {groupRecords.map((r, i) => {
                        const sel = matchPettySelections[r.id];
                        return (
                          <View key={r.id} style={[{ padding: 12, gap: 8 }, i > 0 && { borderTopWidth: 0.5, borderTopColor: colors.border }]}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <TouchableOpacity onPress={() => {
                                tap();
                                setMatchPettySelections((prev) => ({ ...prev, [r.id]: { ...prev[r.id], checked: !prev[r.id]?.checked } }));
                              }}
                                style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                                  borderColor: sel?.checked ? "#AF52DE" : colors.border,
                                  backgroundColor: sel?.checked ? "#AF52DE" : "transparent",
                                  alignItems: "center", justifyContent: "center" }}>
                                {sel?.checked && <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>✓</Text>}
                              </TouchableOpacity>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{r.description || r.code}</Text>
                                <Text style={{ fontSize: 10, color: colors.muted }}>{r.date.slice(5)} · {r.paymentMethod}</Text>
                              </View>
                              <Text style={{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }}>¥{r.amount.toFixed(0)}</Text>
                            </View>
                            {sel?.checked && (
                              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={{ flexDirection: "row", gap: 6 }}>
                                  <TouchableOpacity onPress={() => setMatchPettySelections((prev) => ({ ...prev, [r.id]: { ...prev[r.id], empId: "" } }))}
                                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                                      backgroundColor: !sel.empId ? colors.error : colors.border + "44" }}>
                                    <Text style={{ fontSize: 12, color: !sel.empId ? "#fff" : colors.muted }}>不匹配</Text>
                                  </TouchableOpacity>
                                  {employeesByDept.map((group) => group.employees.map((emp) => (
                                    <TouchableOpacity key={emp.id}
                                      onPress={() => setMatchPettySelections((prev) => ({ ...prev, [r.id]: { ...prev[r.id], empId: emp.id } }))}
                                      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                                        backgroundColor: sel.empId === emp.id ? group.color : colors.border + "44" }}>
                                      <Text style={{ fontSize: 12, fontWeight: "600", color: sel.empId === emp.id ? "#fff" : colors.foreground }}>{emp.code}</Text>
                                    </TouchableOpacity>
                                  )))}
                                </View>
                              </ScrollView>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
                {unlinkedLaborRecords.length === 0 && (
                  <View style={{ alignItems: "center", padding: 32 }}>
                    <Text style={{ fontSize: 15, color: colors.muted }}>当月无待匹配的 K1/K9 备用金条目</Text>
                  </View>
                )}
              </ScrollView>
              {unlinkedLaborRecords.length > 0 && (
                <View style={{ padding: 16, borderTopWidth: 0.5, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10, textAlign: "center" }}>
                    已选 {Object.values(matchPettySelections).filter((s) => s.checked).length} 条 · 合计 ¥{
                      unlinkedLaborRecords.filter((r) => matchPettySelections[r.id]?.checked).reduce((s, r) => s + r.amount, 0).toFixed(0)
                    }
                  </Text>
                  <TouchableOpacity onPress={handleBatchConfirmMatch}
                    style={{ padding: 14, borderRadius: 12, backgroundColor: "#AF52DE", alignItems: "center" }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>确认创建关联</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* ── 分类管理 Modal ── */}
        <Modal visible={showCategoryModal} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
            <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14, maxHeight: "70%" }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>分类管理</Text>
              <ScrollView>
                {allCategories.map((cat) => (
                  <View key={cat.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                    {editingCategoryId === cat.id ? (
                      <TextInput value={editingCategoryName} onChangeText={setEditingCategoryName} autoFocus
                        style={{ flex: 1, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, padding: 8, fontSize: 14, color: colors.foreground }} />
                    ) : (
                      <Text style={{ flex: 1, fontSize: 14, color: colors.foreground }}>{cat.name}</Text>
                    )}
                    {cat.isBuiltin ? (
                      <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 8 }}>内置</Text>
                    ) : editingCategoryId === cat.id ? (
                      <View style={{ flexDirection: "row", gap: 8, marginLeft: 8 }}>
                        <TouchableOpacity onPress={() => { updateCategory(cat.id, editingCategoryName); setEditingCategoryId(null); }}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: colors.success }}>
                          <Text style={{ fontSize: 12, color: "#fff", fontWeight: "600" }}>保存</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setEditingCategoryId(null)}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: colors.border + "44" }}>
                          <Text style={{ fontSize: 12, color: colors.muted }}>取消</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={{ flexDirection: "row", gap: 8, marginLeft: 8 }}>
                        <TouchableOpacity onPress={() => { setEditingCategoryId(cat.id); setEditingCategoryName(cat.name); }}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: colors.primary + "22" }}>
                          <Text style={{ fontSize: 12, color: colors.primary }}>编辑</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => Alert.alert("删除分类", `确认删除「${cat.name}」？`, [
                          { text: "取消", style: "cancel" },
                          { text: "删除", style: "destructive", onPress: () => deleteCategory(cat.id) },
                        ])}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7, backgroundColor: colors.error + "22" }}>
                          <Text style={{ fontSize: 12, color: colors.error }}>删除</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                <TextInput value={newCategoryName} onChangeText={setNewCategoryName} placeholder="新分类名称"
                  style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 14, color: colors.foreground }} />
                <TouchableOpacity onPress={() => { if (newCategoryName.trim()) { addAdvanceCategory(newCategoryName.trim()); setNewCategoryName(""); } }}
                  style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: "#AF52DE" }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>添加</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setShowCategoryModal(false)}
                style={{ padding: 12, borderRadius: 12, backgroundColor: colors.border + "44", alignItems: "center" }}>
                <Text style={{ fontSize: 15, color: colors.muted }}>关闭</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>

      {/* FAB：匹配备用金（上）+ 新增预支（下） */}
      <TouchableOpacity onPress={() => { tap(); initMatchPettySelections(); }}
        style={{ position: "absolute", right: 20, bottom: fabBottom(insets.bottom) + 64, flexDirection: "row", alignItems: "center", gap: 6,
          paddingHorizontal: 18, paddingVertical: 13, borderRadius: 28, backgroundColor: "#5856D6",
          shadowColor: "#5856D6", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 7 }}>
        <IconSymbol name="link" size={16} color="#fff" />
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>匹配备用金</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => { tap(); setShowAddModal(true); }}
        style={{ position: "absolute", right: 20, bottom: fabBottom(insets.bottom), flexDirection: "row", alignItems: "center", gap: 6,
          paddingHorizontal: 18, paddingVertical: 13, borderRadius: 28, backgroundColor: "#AF52DE",
          shadowColor: "#AF52DE", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
        <IconSymbol name="plus" size={16} color="#fff" />
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>新增预支</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── 排班表单元格显示 ─────────────────────────────────────────────────────────
// ─── 快速填充 Modal ──────────────────────────────────────────────────────────
function QuickFillModal({ visible, employee, shiftTemplates, todayStr, currentMonth, colors, presets, onSavePreset, onDeletePreset, onFill, onClose }: {
  visible: boolean;
  employee: Employee | null;
  shiftTemplates: ShiftTemplate[];
  todayStr: string;
  currentMonth: string;
  colors: any;
  presets: FillPreset[];
  onSavePreset: (preset: Omit<FillPreset, "id" | "createdAt">) => void;
  onDeletePreset: (id: string) => void;
  onFill: (dates: string[], session: string, hoursPerDate: (d: string) => number) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const DOW_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

  const [selectedSession, setSelectedSession] = useState(shiftTemplates[0]?.session ?? "");
  const [fromDay, setFromDay] = useState(1);
  const [toDay, setToDay] = useState(5);
  const [scope, setScope] = useState<"week" | "month">("month");

  React.useEffect(() => {
    if (visible && shiftTemplates.length > 0) setSelectedSession(shiftTemplates[0].session);
  }, [visible, shiftTemplates]);

  if (!employee) return null;

  const presetLabel = (f: number, t: number, s: "week" | "month") =>
    `周${DOW_LABELS[f]}~周${DOW_LABELS[t]}·${s === "week" ? "当周" : "当月"}`;

  const currentWeekDates = (() => {
    const todayDow = new Date(todayStr).getDay();
    const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow;
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(todayStr);
      d.setDate(d.getDate() + mondayOffset + i);
      return d.toISOString().slice(0, 10);
    });
  })();

  const currentMonthDates = (() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) =>
      `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
    );
  })();

  const getTargetDates = (f: number, t: number, s: "week" | "month") => {
    const pool = s === "week" ? currentWeekDates : currentMonthDates;
    return pool.filter((d) => isDayInRange(new Date(d).getDay(), f, t));
  };

  const handleFill = (f: number, t: number, s: "week" | "month", sess: string) => {
    const targetDates = getTargetDates(f, t, s);
    if (targetDates.length === 0) { Alert.alert("提示", "没有匹配的日期，请调整星期范围"); return; }
    const fillH = (d: string) => { const h = getContractHoursForDate(employee, d); return h > 0 ? h : 8; };
    onFill(targetDates, sess, fillH);
    onClose();
  };

  const tpl = shiftTemplates.find((t) => t.session === selectedSession);
  const chipColor = tpl?.color ?? colors.primary;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[SCHEM.title, { color: colors.foreground }]}>快速填充 {employee.code}</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

          {/* 常用预设 */}
          {presets.length > 0 && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[SCHEM.label, { color: colors.foreground, marginBottom: 8 }]}>常用</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {presets.map((p) => (
                  <View key={p.id} style={{ flexDirection: "row", alignItems: "center" }}>
                    <TouchableOpacity onPress={() => { tap(); handleFill(p.fromDay, p.toDay, p.scope, p.session); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderTopRightRadius: 0, borderBottomRightRadius: 0,
                        borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primary + "12" }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{p.label}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { tap(); onDeletePreset(p.id); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16, borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
                        borderWidth: 1.5, borderLeftWidth: 0, borderColor: colors.primary, backgroundColor: colors.primary + "08" }}>
                      <Text style={{ fontSize: 12, color: colors.error }}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 班次选择 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground, marginBottom: 8 }]}>班次</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {shiftTemplates.map((t) => {
                const sel = selectedSession === t.session;
                return (
                  <TouchableOpacity key={t.id} onPress={() => { tap(); setSelectedSession(t.session); }}
                    style={[SCHEM.chip, { backgroundColor: sel ? t.color : colors.surface, borderColor: t.color }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : t.color }}>{t.session}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* 星期范围 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={[SCHEM.label, { color: colors.foreground }]}>星期范围</Text>
              <Text style={{ fontSize: 11, color: chipColor, fontWeight: "600" }}>周{DOW_LABELS[fromDay]} ~ 周{DOW_LABELS[toDay]}</Text>
            </View>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>起始</Text>
            <View style={{ flexDirection: "row", gap: 5, marginBottom: 10 }}>
              {DOW_ORDER.map((dow) => (
                <TouchableOpacity key={"from_" + dow} onPress={() => { tap(); setFromDay(dow); }}
                  style={{ flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center",
                    backgroundColor: fromDay === dow ? chipColor : colors.border + "33",
                    borderWidth: 1, borderColor: fromDay === dow ? chipColor : colors.border }}>
                  <Text style={{ fontSize: 10, fontWeight: "600", color: fromDay === dow ? "#fff" : colors.muted }}>周{DOW_LABELS[dow]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>结束</Text>
            <View style={{ flexDirection: "row", gap: 5, marginBottom: 8 }}>
              {DOW_ORDER.map((dow) => (
                <TouchableOpacity key={"to_" + dow} onPress={() => { tap(); setToDay(dow); }}
                  style={{ flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center",
                    backgroundColor: toDay === dow ? chipColor : colors.border + "33",
                    borderWidth: 1, borderColor: toDay === dow ? chipColor : colors.border }}>
                  <Text style={{ fontSize: 10, fontWeight: "600", color: toDay === dow ? "#fff" : colors.muted }}>周{DOW_LABELS[dow]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 10, color: colors.muted }}>
              当月匹配 {getTargetDates(fromDay, toDay, "month").length} 天 · 当周匹配 {getTargetDates(fromDay, toDay, "week").length} 天
            </Text>
          </View>

          {/* 范围 + 操作 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground, marginBottom: 10 }]}>填充范围</Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              {(["week", "month"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => { tap(); setScope(s); }}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                    backgroundColor: scope === s ? chipColor : colors.border + "22",
                    borderWidth: 1.5, borderColor: scope === s ? chipColor : colors.border }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: scope === s ? "#fff" : colors.muted }}>
                    {s === "week" ? "当前周" : "当前月"}
                  </Text>
                  <Text style={{ fontSize: 10, color: scope === s ? "rgba(255,255,255,0.8)" : colors.muted, marginTop: 2 }}>
                    {getTargetDates(fromDay, toDay, s).length} 天
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => { tap(); onSavePreset({ label: presetLabel(fromDay, toDay, scope), session: selectedSession, fromDay, toDay, scope, mode: "shift" }); }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                  borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primary + "10" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>★ 保存常用</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { tap(); handleFill(fromDay, toDay, scope, selectedSession); }}
                style={{ flex: 1.4, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: chipColor }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>立即填充</Text>
              </TouchableOpacity>
            </View>
          </View>

        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 时长模式长按快速填充 Modal ────────────────────────────────────────────
// 只填工时，不影响班次；复用现有星期范围+填充范围 UI
function QuickFillHoursModal({ visible, employee, todayStr, currentMonth, colors, presets, onSavePreset, onDeletePreset, onFill, onClose }: {
  visible: boolean;
  employee: Employee | null;
  todayStr: string;
  currentMonth: string;
  colors: any;
  presets: FillPreset[];
  onSavePreset: (preset: Omit<FillPreset, "id" | "createdAt">) => void;
  onDeletePreset: (id: string) => void;
  onFill: (dates: string[], hours: number) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const DOW_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

  const [hoursInput, setHoursInput] = useState("8");
  const [fromDay, setFromDay] = useState(1);
  const [toDay, setToDay] = useState(5);
  const [scope, setScope] = useState<"week" | "month">("month");

  React.useEffect(() => {
    if (visible) {
      setHoursInput("8");
      setFromDay(1);
      setToDay(5);
      setScope("month");
    }
  }, [visible]);

  if (!employee) return null;

  const presetLabel = (f: number, t: number, s: "week" | "month", h: number) =>
    `周${DOW_LABELS[f]}~周${DOW_LABELS[t]}·${s === "week" ? "当周" : "当月"}·${h}h`;

  const currentWeekDates = (() => {
    const todayDow = new Date(todayStr).getDay();
    const mondayOffset = todayDow === 0 ? -6 : 1 - todayDow;
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(todayStr);
      d.setDate(d.getDate() + mondayOffset + i);
      return d.toISOString().slice(0, 10);
    });
  })();

  const currentMonthDates = (() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) =>
      `${y}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`
    );
  })();

  const getTargetDates = (f: number, t: number, s: "week" | "month") => {
    const pool = s === "week" ? currentWeekDates : currentMonthDates;
    return pool.filter((d) => isDayInRange(new Date(d).getDay(), f, t));
  };

  const handleFill = (f: number, t: number, s: "week" | "month") => {
    const h = Number(hoursInput);
    if (!h || h <= 0) { Alert.alert("提示", "请先填写工时数"); return; }
    const targetDates = getTargetDates(f, t, s);
    if (targetDates.length === 0) { Alert.alert("提示", "没有匹配的日期，请调整星期范围"); return; }
    onFill(targetDates, h);
    onClose();
  };

  const hoursPresets = presets.filter((p) => p.mode === "hours");

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[SCHEM.title, { color: colors.foreground }]}>快速填充时长 {employee.code}</Text>
          <View style={{ width: 44 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

          {/* 常用预设 */}
          {hoursPresets.length > 0 && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[SCHEM.label, { color: colors.foreground, marginBottom: 8 }]}>常用</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {hoursPresets.map((p) => (
                  <View key={p.id} style={{ flexDirection: "row", alignItems: "center" }}>
                    <TouchableOpacity onPress={() => { tap(); if (p.hours) { setHoursInput(String(p.hours)); setFromDay(p.fromDay); setToDay(p.toDay); setScope(p.scope); handleFill(p.fromDay, p.toDay, p.scope); } }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderTopRightRadius: 0, borderBottomRightRadius: 0,
                        borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primary + "12" }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{p.label}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => { tap(); onDeletePreset(p.id); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 6, borderRadius: 16, borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
                        borderWidth: 1.5, borderLeftWidth: 0, borderColor: colors.primary, backgroundColor: colors.primary + "08" }}>
                      <Text style={{ fontSize: 12, color: colors.error }}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 工时输入 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground, marginBottom: 8 }]}>工时</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={hoursInput}
                onChangeText={(v) => {
                  const cleaned = v.replace(/[^0-9.]/g, "");
                  const parts = cleaned.split(".");
                  if (parts.length > 2) return;
                  if (parts[1] && parts[1].length > 1) return;
                  setHoursInput(cleaned);
                }}
                placeholder="如 9 或 8.5"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                style={[SCHEM.input, { color: colors.foreground, borderColor: colors.border, flex: 1, fontSize: 20, textAlign: "center" }]}
              />
              <Text style={{ color: colors.muted, fontSize: 15 }}>h</Text>
            </View>
          </View>

          {/* 星期范围 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <Text style={[SCHEM.label, { color: colors.foreground }]}>星期范围</Text>
              <Text style={{ fontSize: 11, color: colors.primary, fontWeight: "600" }}>周{DOW_LABELS[fromDay]} ~ 周{DOW_LABELS[toDay]}</Text>
            </View>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>起始</Text>
            <View style={{ flexDirection: "row", gap: 5, marginBottom: 10 }}>
              {DOW_ORDER.map((dow) => (
                <TouchableOpacity key={"from_" + dow} onPress={() => { tap(); setFromDay(dow); }}
                  style={{ flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center",
                    backgroundColor: fromDay === dow ? colors.primary : colors.border + "33",
                    borderWidth: 1, borderColor: fromDay === dow ? colors.primary : colors.border }}>
                  <Text style={{ fontSize: 10, fontWeight: "600", color: fromDay === dow ? "#fff" : colors.muted }}>周{DOW_LABELS[dow]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>结束</Text>
            <View style={{ flexDirection: "row", gap: 5, marginBottom: 8 }}>
              {DOW_ORDER.map((dow) => (
                <TouchableOpacity key={"to_" + dow} onPress={() => { tap(); setToDay(dow); }}
                  style={{ flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center",
                    backgroundColor: toDay === dow ? colors.primary : colors.border + "33",
                    borderWidth: 1, borderColor: toDay === dow ? colors.primary : colors.border }}>
                  <Text style={{ fontSize: 10, fontWeight: "600", color: toDay === dow ? "#fff" : colors.muted }}>周{DOW_LABELS[dow]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 10, color: colors.muted }}>
              当月匹配 {getTargetDates(fromDay, toDay, "month").length} 天 · 当周匹配 {getTargetDates(fromDay, toDay, "week").length} 天
            </Text>
          </View>

          {/* 填充范围 + 操作 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground, marginBottom: 10 }]}>填充范围</Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
              {(["week", "month"] as const).map((s) => (
                <TouchableOpacity key={s} onPress={() => { tap(); setScope(s); }}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                    backgroundColor: scope === s ? colors.primary : colors.border + "22",
                    borderWidth: 1.5, borderColor: scope === s ? colors.primary : colors.border }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: scope === s ? "#fff" : colors.muted }}>
                    {s === "week" ? "当前周" : "当前月"}
                  </Text>
                  <Text style={{ fontSize: 10, color: scope === s ? "rgba(255,255,255,0.8)" : colors.muted, marginTop: 2 }}>
                    {getTargetDates(fromDay, toDay, s).length} 天
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => {
                  tap();
                  const h = Number(hoursInput);
                  if (!h || h <= 0) { Alert.alert("提示", "请先填写工时数"); return; }
                  onSavePreset({ label: presetLabel(fromDay, toDay, scope, h), session: "", fromDay, toDay, scope, hours: h, mode: "hours" });
                }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                  borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primary + "10" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>★ 保存常用</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { tap(); handleFill(fromDay, toDay, scope); }}
                style={{ flex: 1.4, paddingVertical: 12, borderRadius: 12, alignItems: "center", backgroundColor: colors.primary }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>立即填充</Text>
              </TouchableOpacity>
            </View>
          </View>

        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 班次模式格子编辑 Modal（点击即保存，无需保存按钮） ─────────────────────────
// 所有操作（班次/特殊状态/调休）点击即立即保存，取消不做任何操作
function SchShiftModal({ visible, date, employee, session, existing, contractHours, currentMonth, colors, shiftTemplates, specialStatuses, shiftGroups, onSave, onClear, onClose }: {
  visible: boolean; date: string; employee: Employee | null; session: string;
  existing: ShiftEntry | null; contractHours: number;
  currentMonth: string; colors: any;
  shiftTemplates: ShiftTemplate[];
  specialStatuses: SpecialStatus[];
  shiftGroups: ShiftGroup[];
  onSave: (e: ShiftEntry) => void; onClear: () => void; onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { getEntries: getCompOffEntries } = useCompOffBalanceEntryStore();
  const { getAvailableDays: getHolidayCompOffDays } = useHolidayCompOffStore();
  const compOffBalance = employee ? getCompOffEntries(employee.id).filter((e: any) => e.status === "available").reduce((s: number, e: any) => s + (e.days ?? 1), 0) : 0;
  const holidayCompOffBalance = employee ? getHolidayCompOffDays(employee.id, currentMonth) : 0;
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];
  const dow = date ? getDayOfWeek(date) : 1;

  // 当前格子已有的工时（用于切换班次时保留）
  const existingHours = existing && typeof existing.hoursValue === "number" ? existing.hoursValue : null;

  if (!employee || !date) return null;

  // 点击班次标签：立即保存，不需要点保存按钮
  // 工时逻辑：格子已有工时则保留；无工时则自动带入模板默认工时
  const handleSelectShift = (tpl: ShiftTemplate) => {
    tap();
    const finalHours = existingHours ?? tpl.defaultHours ?? 8;
    onSave({ employeeId: employee.id, date, shift: tpl.session, hoursValue: finalHours, specialStatusId: undefined });
    onClose();
  };

  // 点击特殊状态：立即保存
  // 班次模式不管工时，工时由时长模式单独管理
  const handleSelectSpecial = (ss: SpecialStatus) => {
    tap();
    const isSelected = existing?.specialStatusId === ss.id;
    if (isSelected) {
      // 再次点击已选中的特殊状态 → 取消（恢复为普通班次，保留已有工时）
      onSave({ employeeId: employee.id, date, shift: session, hoursValue: existingHours, specialStatusId: undefined });
    } else {
      // 保留已有工时，只更新特殊状态
      onSave({ employeeId: employee.id, date, shift: session, hoursValue: existingHours, specialStatusId: ss.id });
    }
    onClose();
  };

  // 点击调休换休：立即保存
  const handleSelectCompOff = (ss: SpecialStatus) => {
    tap();
    const isSelected = existing?.specialStatusId === ss.id;
    if (isSelected) {
      onSave({ employeeId: employee.id, date, shift: session, hoursValue: existingHours, specialStatusId: undefined });
    } else {
      onSave({ employeeId: employee.id, date, shift: session, hoursValue: null, specialStatusId: ss.id });
    }
    onClose();
  };

  const absenceStatuses = specialStatuses.filter((s) => s.category === "absence");
  const workDayStatuses = specialStatuses.filter((s) => s.category === "work_day");
  const compOffStatuses = specialStatuses.filter((s) => s.category === "comp_off" && s.id !== "ss_comp_off");
  const displayCompOffStatuses = compOffStatuses.length > 0 ? compOffStatuses : specialStatuses.filter((s) => s.category === "comp_off");

  // 班次按分组展示
  const groupedShifts = shiftGroups.length > 0
    ? shiftGroups.map((grp) => ({
        group: grp,
        templates: shiftTemplates.filter((t) => grp.templateIds.includes(t.id)),
      })).filter((g) => g.templates.length > 0)
    : [{ group: null as ShiftGroup | null, templates: shiftTemplates }];
  const ungroupedShifts = shiftTemplates.filter((t) => !shiftGroups.some((g) => g.templateIds.includes(t.id)));

  return (
    <Modal visible={visible} animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "formSheet"}
      onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[SCHEM.title, { color: colors.foreground }]}>{employee.code}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>{date} 周{DOW[dow]}</Text>
              {date && !date.startsWith(currentMonth) && (
                <View style={{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.warning + "22" }}>
                  <Text style={{ fontSize: 10, color: colors.warning, fontWeight: "600" }}>跨月·不计入本月</Text>
                </View>
              )}
            </View>
          </View>
          {/* 删除按钮：清空格子全部内容 */}
          {existing ? (
            <Pressable onPress={() => { tap(); onClear(); onClose(); }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.error }}>删除</Text>
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

          {/* 工作班次区（点击即保存） */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground }]}>工作班次</Text>
            {groupedShifts.map(({ group, templates }) => (
              <View key={group?.id ?? "ungrouped"} style={{ marginTop: 10 }}>
                {group && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: group.color }} />
                    <Text style={{ fontSize: 11, color: group.color, fontWeight: "600" }}>{group.name}</Text>
                  </View>
                )}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {templates.map((tpl) => {
                    const sel = !existing?.specialStatusId && existing?.shift === tpl.session;
                    const chipColor = group ? group.color : tpl.color;
                    return (
                      <TouchableOpacity key={tpl.id} onPress={() => handleSelectShift(tpl)}
                        style={[SCHEM.chip, { backgroundColor: sel ? chipColor : colors.surface, borderColor: chipColor }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sel ? "#fff" : chipColor }} />
                          <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : chipColor }}>{tpl.session}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
            {ungroupedShifts.length > 0 && shiftGroups.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 6 }}>未分组</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {ungroupedShifts.map((tpl) => {
                    const sel = !existing?.specialStatusId && existing?.shift === tpl.session;
                    return (
                      <TouchableOpacity key={tpl.id} onPress={() => handleSelectShift(tpl)}
                        style={[SCHEM.chip, { backgroundColor: sel ? tpl.color : colors.surface, borderColor: tpl.color }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sel ? "#fff" : tpl.color }} />
                          <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : tpl.color }}>{tpl.session}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* 特殊状态区（点击即保存） */}
          {(absenceStatuses.length > 0 || workDayStatuses.length > 0) && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[SCHEM.label, { color: colors.foreground }]}>特殊状态</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {[...absenceStatuses, ...workDayStatuses].map((ss) => {
                  const sel = existing?.specialStatusId === ss.id;
                  return (
                    <TouchableOpacity key={ss.id} onPress={() => handleSelectSpecial(ss)}
                      style={[SCHEM.chip, { backgroundColor: sel ? ss.color : colors.surface, borderColor: ss.color }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : ss.color }}>
                        {ss.name}{ss.salaryMultiplier !== 1 ? ` ${ss.salaryMultiplier}x` : ""}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* 调休换休区（点击即保存） */}
          {displayCompOffStatuses.length > 0 && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[SCHEM.label, { color: colors.foreground }]}>调休换休</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                    backgroundColor: compOffBalance > 0 ? "#007AFF" + "18" : colors.border + "33" }}>
                    <Text style={{ fontSize: 10, color: compOffBalance > 0 ? "#007AFF" : colors.muted }}>
                      加班余额 {compOffBalance.toFixed(1)}天
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                    backgroundColor: holidayCompOffBalance > 0 ? "#34C759" + "18" : colors.border + "33" }}>
                    <Text style={{ fontSize: 10, color: holidayCompOffBalance > 0 ? "#34C759" : colors.muted }}>
                      节假日调休 {holidayCompOffBalance.toFixed(1)}天
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {displayCompOffStatuses.map((ss) => {
                  const sel = existing?.specialStatusId === ss.id;
                  return (
                    <TouchableOpacity key={ss.id} onPress={() => handleSelectCompOff(ss)}
                      style={[SCHEM.chip, { backgroundColor: sel ? ss.color : colors.surface, borderColor: ss.color }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : ss.color }}>{ss.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                加班换休：优先扣加班时间 | 调休余额：优先扣余额 | 节假日调休：优先匹配节假日
              </Text>
            </View>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 时长模式格子编辑 Modal ────────────────────────────────────────────────────
// 只编辑工时数字，完全不影响班次；特殊状态/调休点击即保存
function SchHoursModal({ visible, date, employee, session, existing, contractHours, currentMonth, colors, specialStatuses, onSave, onClear, onClose }: {
  visible: boolean; date: string; employee: Employee | null; session: string;
  existing: ShiftEntry | null; contractHours: number;
  currentMonth: string; colors: any;
  specialStatuses: SpecialStatus[];
  onSave: (e: ShiftEntry) => void; onClear: () => void; onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { getEntries: getCompOffEntries } = useCompOffBalanceEntryStore();
  const { getAvailableDays: getHolidayCompOffDays } = useHolidayCompOffStore();
  const compOffBalance = employee ? getCompOffEntries(employee.id).filter((e: any) => e.status === "available").reduce((s: number, e: any) => s + (e.days ?? 1), 0) : 0;
  const holidayCompOffBalance = employee ? getHolidayCompOffDays(employee.id, currentMonth) : 0;
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];
  const dow = date ? getDayOfWeek(date) : 1;
  const [hoursInput, setHoursInput] = useState("");

  React.useEffect(() => {
    if (visible) {
      setHoursInput(existing && typeof existing.hoursValue === "number" ? String(existing.hoursValue) : "");
    }
  }, [visible, existing]);

  if (!employee || !date) return null;

  const curH = Number(hoursInput) || 0;
  const isOT = contractHours > 0 && curH > contractHours;
  const otAmt = isOT ? curH - contractHours : 0;

  const handleSave = () => {
    // 只改工时，保留原有班次；若格子无排班则用当前行 session 创建
    const hv = hoursInput ? (Number(hoursInput) || null) : null;
    onSave({ employeeId: employee.id, date, shift: existing?.shift ?? session, hoursValue: hv, specialStatusId: undefined });
    onClose();
  };

  // 特殊状态/调休：点击即立即保存
  const handleSelectSpecial = (ss: SpecialStatus) => {
    tap();
    const isSelected = existing?.specialStatusId === ss.id;
    if (isSelected) {
      onSave({ employeeId: employee.id, date, shift: existing?.shift ?? session, hoursValue: null, specialStatusId: undefined });
    } else {
      onSave({ employeeId: employee.id, date, shift: existing?.shift ?? session, hoursValue: ss.category === "work_day" ? (Number(hoursInput) || 8) : null, specialStatusId: ss.id });
    }
    onClose();
  };

  const handleSelectCompOff = (ss: SpecialStatus) => {
    tap();
    const isSelected = existing?.specialStatusId === ss.id;
    if (isSelected) {
      onSave({ employeeId: employee.id, date, shift: existing?.shift ?? session, hoursValue: null, specialStatusId: undefined });
    } else {
      onSave({ employeeId: employee.id, date, shift: existing?.shift ?? session, hoursValue: null, specialStatusId: ss.id });
    }
    onClose();
  };

  const absenceStatuses = specialStatuses.filter((s) => s.category === "absence");
  const workDayStatuses = specialStatuses.filter((s) => s.category === "work_day");
  const compOffStatuses = specialStatuses.filter((s) => s.category === "comp_off" && s.id !== "ss_comp_off");
  const displayCompOffStatuses = compOffStatuses.length > 0 ? compOffStatuses : specialStatuses.filter((s) => s.category === "comp_off");
  // 当前选中的特殊状态
  const selectedSS = existing?.specialStatusId ? specialStatuses.find((s) => s.id === existing.specialStatusId) : null;
  // absence 类和 comp_off 类：工时输入框锁定（不在工作，无需填写工时）
  // work_day 类（节日上班）：工时输入框正常（需要填写实际工时）
  const lockHoursInput = !!(selectedSS && (selectedSS.category === "absence" || selectedSS.category === "comp_off"));

  return (
    <Modal visible={visible} animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "formSheet"}
      onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[SCHEM.title, { color: colors.foreground }]}>{employee.code}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>{date} 周{DOW[dow]}</Text>
              {date && !date.startsWith(currentMonth) && (
                <View style={{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.warning + "22" }}>
                  <Text style={{ fontSize: 10, color: colors.warning, fontWeight: "600" }}>跨月·不计入本月</Text>
                </View>
              )}
            </View>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

          {/* 工时输入区：absence/comp_off 类锁定，work_day 类正常 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {!lockHoursInput && session && (
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>
                当前班次：{existing?.shift ?? session}{contractHours > 0 ? `  ·  合同工时 ${contractHours}h` : ""}
                {isOT ? `  ·  加班 +${otAmt.toFixed(1)}h` : ""}
              </Text>
            )}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={lockHoursInput ? "" : hoursInput}
                onChangeText={(v) => {
                  if (lockHoursInput) return;
                  const cleaned = v.replace(/[^0-9.]/g, "");
                  const parts = cleaned.split(".");
                  if (parts.length > 2) return;
                  if (parts[1] && parts[1].length > 1) return;
                  setHoursInput(cleaned);
                }}
                placeholder={lockHoursInput ? "---" : "工时（如 9 或 8.5）"}
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                editable={!lockHoursInput}
                style={[SCHEM.input, {
                  color: lockHoursInput ? colors.muted : colors.foreground,
                  borderColor: lockHoursInput ? colors.border : (isOT ? colors.warning : colors.border),
                  flex: 1,
                  opacity: lockHoursInput ? 0.5 : 1,
                }]}
              />
              <Text style={{ color: colors.muted, fontSize: 15 }}>h</Text>
            </View>
            {lockHoursInput && (
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                当前为「不在工作」状态，无需填写工时
              </Text>
            )}
          </View>

          {/* 特殊状态区（点击即保存） */}
          {(absenceStatuses.length > 0 || workDayStatuses.length > 0) && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[SCHEM.label, { color: colors.foreground }]}>特殊状态</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {[...absenceStatuses, ...workDayStatuses].map((ss) => {
                  const sel = existing?.specialStatusId === ss.id;
                  return (
                    <TouchableOpacity key={ss.id} onPress={() => handleSelectSpecial(ss)}
                      style={[SCHEM.chip, { backgroundColor: sel ? ss.color : colors.surface, borderColor: ss.color }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : ss.color }}>
                        {ss.name}{ss.salaryMultiplier !== 1 ? ` ${ss.salaryMultiplier}x` : ""}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* 调休换休区（点击即保存） */}
          {displayCompOffStatuses.length > 0 && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[SCHEM.label, { color: colors.foreground }]}>调休换休</Text>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                    backgroundColor: compOffBalance > 0 ? "#007AFF" + "18" : colors.border + "33" }}>
                    <Text style={{ fontSize: 10, color: compOffBalance > 0 ? "#007AFF" : colors.muted }}>
                      加班余额 {compOffBalance.toFixed(1)}天
                    </Text>
                  </View>
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
                    backgroundColor: holidayCompOffBalance > 0 ? "#34C759" + "18" : colors.border + "33" }}>
                    <Text style={{ fontSize: 10, color: holidayCompOffBalance > 0 ? "#34C759" : colors.muted }}>
                      节假日调休 {holidayCompOffBalance.toFixed(1)}天
                    </Text>
                  </View>
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {displayCompOffStatuses.map((ss) => {
                  const sel = existing?.specialStatusId === ss.id;
                  return (
                    <TouchableOpacity key={ss.id} onPress={() => handleSelectCompOff(ss)}
                      style={[SCHEM.chip, { backgroundColor: sel ? ss.color : colors.surface, borderColor: ss.color }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : ss.color }}>{ss.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                加班换休：优先扣加班时间 | 调休余额：优先扣余额 | 节假日调休：优先匹配节假日
              </Text>
            </View>
          )}

          {/* 清除此排班 */}
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

// ─── 排班设置 Modal（四个 Tab：工作班次 / 班次分组 / 店铺经营时间 / 特殊状态） ────
function SchTemplateModal({ visible, templates, specialStatuses, businessHours, shiftGroups, colors,
  onSaveShift, onDeleteShift, onSaveStatus, onDeleteStatus,
  onSaveBusinessHours, onSaveShiftGroups, onClose }: {
  visible: boolean;
  templates: ShiftTemplate[];
  specialStatuses: SpecialStatus[];
  businessHours: BusinessHoursEntry[];
  shiftGroups: ShiftGroup[];
  colors: any;
  onSaveShift: (t: ShiftTemplate) => void;
  onDeleteShift: (id: string) => void;
  onSaveStatus: (s: SpecialStatus) => void;
  onDeleteStatus: (id: string) => void;
  onSaveBusinessHours: (entries: BusinessHoursEntry[]) => void;
  onSaveShiftGroups: (groups: ShiftGroup[]) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [activeTab, setActiveTab] = useState<"shifts" | "groups" | "hours" | "statuses">("shifts");
  const [localShifts, setLocalShifts] = useState<ShiftTemplate[]>([]);
  const [localStatuses, setLocalStatuses] = useState<SpecialStatus[]>([]);
  const [localHours, setLocalHours] = useState<BusinessHoursEntry[]>([]);
  const [localGroups, setLocalGroups] = useState<ShiftGroup[]>([]);

  React.useEffect(() => {
    if (visible) {
      setLocalShifts([...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      setLocalStatuses([...specialStatuses].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      setLocalHours([...businessHours]);
      setLocalGroups([...shiftGroups].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    }
  }, [visible, templates, specialStatuses, businessHours, shiftGroups]);

  // ── 班次操作 ──
  const updShift = (id: string, p: Partial<ShiftTemplate>) =>
    setLocalShifts((prev) => prev.map((t) => t.id === id ? { ...t, ...p } : t));
  const addNewShift = () => {
    tap();
    setLocalShifts((prev) => [...prev, {
      id: `tpl_${Date.now()}`, session: "新班次", startTime: "09:00", endTime: "18:00",
      defaultHours: 8, color: SHIFT_COLOR_PRESETS[prev.length % SHIFT_COLOR_PRESETS.length],
      sortOrder: prev.length,
    }]);
  };
  const removeShift = (id: string) => {
    tap();
    Alert.alert("删除班次", "删除后该班次历史排班记录不受影响。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => setLocalShifts((prev) => prev.filter((t) => t.id !== id)) },
    ]);
  };

  // ── 特殊状态操作 ──
  const updStatus = (id: string, p: Partial<SpecialStatus>) =>
    setLocalStatuses((prev) => prev.map((s) => s.id === id ? { ...s, ...p } : s));
  const addNewStatus = () => {
    tap();
    setLocalStatuses((prev) => [...prev, {
      id: `ss_${Date.now()}`, name: "自定义", category: "absence" as const,
      direction: "negative" as const, countAsAttendance: false,
      salaryMultiplier: 1, color: SHIFT_COLOR_PRESETS[prev.length % SHIFT_COLOR_PRESETS.length],
      sortOrder: prev.length,
    }]);
  };
  const removeStatus = (id: string) => {
    const t = localStatuses.find((s) => s.id === id);
    if (t?.isBuiltin) { Alert.alert("内置状态", "内置状态不可删除，但可修改名称和倍率。"); return; }
    tap();
    Alert.alert("删除状态", "确认删除？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => setLocalStatuses((prev) => prev.filter((s) => s.id !== id)) },
    ]);
  };

  // ── 店铺经营时间操作 ──
  const updHours = (id: string, p: Partial<BusinessHoursEntry>) =>
    setLocalHours((prev) => prev.map((e) => e.id === id ? { ...e, ...p } : e));
  const addNewHours = () => {
    tap();
    setLocalHours((prev) => [...prev, {
      id: `bh_${Date.now()}`, fromDay: 1, toDay: 5, openTime: "10:00", closeTime: "22:00",
    }]);
  };
  const removeHours = (id: string) => {
    tap();
    Alert.alert("删除时间段", "确认删除？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => setLocalHours((prev) => prev.filter((e) => e.id !== id)) },
    ]);
  };

  // ── 班次分组操作 ──
  const updGroup = (id: string, p: Partial<ShiftGroup>) =>
    setLocalGroups((prev) => prev.map((g) => g.id === id ? { ...g, ...p } : g));
  const addNewGroup = () => {
    tap();
    setLocalGroups((prev) => [...prev, {
      id: `sg_${Date.now()}`, name: "新分组",
      color: SHIFT_COLOR_PRESETS[prev.length % SHIFT_COLOR_PRESETS.length],
      sortOrder: prev.length, templateIds: [],
    }]);
  };
  const removeGroup = (id: string) => {
    tap();
    Alert.alert("删除分组", "确认删除？班次不会被删除。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => setLocalGroups((prev) => prev.filter((g) => g.id !== id)) },
    ]);
  };
  const toggleTemplateInGroup = (groupId: string, templateId: string) => {
    tap();
    setLocalGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) {
        // 从其他分组移除
        return { ...g, templateIds: g.templateIds.filter((id) => id !== templateId) };
      }
      // 当前分组：切换
      const has = g.templateIds.includes(templateId);
      return { ...g, templateIds: has ? g.templateIds.filter((id) => id !== templateId) : [...g.templateIds, templateId] };
    }));
  };

  // ── 保存 ──
  const handleSave = () => {
    // 班次
    const eShiftIds = templates.map((t) => t.id);
    const lShiftIds = localShifts.map((t) => t.id);
    eShiftIds.filter((id) => !lShiftIds.includes(id)).forEach((id) => onDeleteShift(id));
    localShifts.forEach((t, i) => onSaveShift({ ...t, sortOrder: i }));
    // 特殊状态
    const eStatusIds = specialStatuses.map((s) => s.id);
    const lStatusIds = localStatuses.map((s) => s.id);
    eStatusIds.filter((id) => !lStatusIds.includes(id)).forEach((id) => onDeleteStatus(id));
    localStatuses.forEach((s, i) => onSaveStatus({ ...s, sortOrder: i }));
    // 店铺经营时间
    onSaveBusinessHours(localHours);
    // 班次分组
    onSaveShiftGroups(localGroups.map((g, i) => ({ ...g, sortOrder: i })));
    onClose();
  };

  const CATEGORY_LABELS: Record<string, string> = { absence: "缺席类", work_day: "工作日类", comp_off: "调休换休" };
  const DIRECTION_LABELS: Record<string, string> = { positive: "正向（加钱）", negative: "负向（扣钱）", neutral: "中性（不加不扣）" };
  const DIRECTION_COLORS: Record<string, string> = { positive: colors.success, negative: colors.error, neutral: colors.muted };
  const MULTIPLIER_PRESETS = [0, 0.5, 1, 1.5, 2, 3];
  const TABS = [
    { key: "shifts",   label: "班次" },
    { key: "groups",   label: "分组" },
    { key: "hours",    label: "营业时间" },
    { key: "statuses", label: "特殊状态" },
  ] as const;

  return (
    <Modal visible={visible} animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "formSheet"}
      onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[SCHEM.title, { color: colors.foreground }]}>排班设置</Text>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
        </View>

        {/* Tab 栏 */}
        <View style={{ flexDirection: "row", marginHorizontal: 16, marginVertical: 8, backgroundColor: colors.border + "44", borderRadius: 10, padding: 2 }}>
          {TABS.map((tab) => (
            <TouchableOpacity key={tab.key} onPress={() => { tap(); setActiveTab(tab.key); }}
              style={{ flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center", backgroundColor: activeTab === tab.key ? colors.surface : "transparent" }}>
              <Text style={{ fontSize: 12, fontWeight: activeTab === tab.key ? "700" : "400", color: activeTab === tab.key ? colors.foreground : colors.muted }}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>

          {/* ── Tab: 工作班次 ── */}
          {activeTab === "shifts" && (
            <>
              {localShifts.map((tpl) => {
                // 找到所属分组
                const grp = localGroups.find((g) => g.templateIds.includes(tpl.id));
                const displayColor = grp ? grp.color : tpl.color;
                return (
                  <View key={tpl.id} style={{ backgroundColor: displayColor + "10", borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: displayColor + "44" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: displayColor }} />
                      <TextInput value={tpl.session} onChangeText={(v) => updShift(tpl.id, { session: v })}
                        placeholder="班次名称" placeholderTextColor={colors.muted}
                        style={{ flex: 1, fontSize: 15, fontWeight: "700", color: displayColor, paddingVertical: 2 }} />
                      {grp && (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: grp.color + "22" }}>
                          <Text style={{ fontSize: 10, color: grp.color, fontWeight: "600" }}>{grp.name}</Text>
                        </View>
                      )}
                      <TouchableOpacity onPress={() => removeShift(tpl.id)} style={{ padding: 4 }}>
                        <IconSymbol name="trash" size={16} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>开始时间</Text>
                        <TextInput value={tpl.startTime} onChangeText={(v) => updShift(tpl.id, { startTime: v })}
                          placeholder="10:30" placeholderTextColor={colors.muted}
                          style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>结束时间</Text>
                        <TextInput value={tpl.endTime} onChangeText={(v) => updShift(tpl.id, { endTime: v })}
                          placeholder="17:00" placeholderTextColor={colors.muted}
                          style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>营业额预警</Text>
                        <TextInput value={tpl.revenueWarning ? String(tpl.revenueWarning) : ""}
                          onChangeText={(v) => updShift(tpl.id, { revenueWarning: Number(v) || 0 })}
                          placeholder="0=关闭" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                          style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                      </View>
                    </View>
                    <Text style={{ fontSize: 10, color: colors.muted }}>工时由员工档案 stdHoursPerDay 自动带入，无需在此设置</Text>
                  </View>
                );
              })}
              <TouchableOpacity onPress={addNewShift} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary + "66" }}>
                <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加班次</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Tab: 班次分组 ── */}
          {activeTab === "groups" && (
            <>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>每个分组设颜色，班次归属分组后员工左侧竖条显示分组颜色</Text>
              {localGroups.map((grp) => (
                <View key={grp.id} style={{ backgroundColor: grp.color + "10", borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: grp.color + "44" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: grp.color }} />
                    <TextInput value={grp.name} onChangeText={(v) => updGroup(grp.id, { name: v })}
                      placeholder="分组名称" placeholderTextColor={colors.muted}
                      style={{ flex: 1, fontSize: 15, fontWeight: "700", color: grp.color, paddingVertical: 2 }} />
                    <TouchableOpacity onPress={() => removeGroup(grp.id)} style={{ padding: 4 }}>
                      <IconSymbol name="trash" size={16} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                  {/* 颜色选择 */}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {SHIFT_COLOR_PRESETS.map((c) => (
                      <TouchableOpacity key={c} onPress={() => { tap(); updGroup(grp.id, { color: c }); }}
                        style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c, borderWidth: grp.color === c ? 3 : 1, borderColor: grp.color === c ? colors.foreground : c + "44" }} />
                    ))}
                  </View>
                  {/* 班次归属 */}
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 6 }}>归属班次（点击切换）</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {localShifts.map((tpl) => {
                        const inGroup = grp.templateIds.includes(tpl.id);
                        return (
                          <TouchableOpacity key={tpl.id} onPress={() => toggleTemplateInGroup(grp.id, tpl.id)}
                            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5,
                              backgroundColor: inGroup ? grp.color : colors.surface,
                              borderColor: inGroup ? grp.color : colors.border }}>
                            <Text style={{ fontSize: 12, fontWeight: "600", color: inGroup ? "#fff" : colors.muted }}>{tpl.session}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {localShifts.length === 0 && (
                        <Text style={{ fontSize: 12, color: colors.muted }}>请先在「班次」Tab 添加班次</Text>
                      )}
                    </View>
                  </View>
                </View>
              ))}
              <TouchableOpacity onPress={addNewGroup} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary + "66" }}>
                <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加分组</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Tab: 店铺经营时间 ── */}
          {activeTab === "hours" && (
            <>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>设置每周各时段的营业时间，可添加多条规则</Text>
              {localHours.map((entry) => (
                <View key={entry.id} style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                      {WEEKDAY_SHORT[entry.fromDay]}
                      {entry.fromDay !== entry.toDay ? ` — ${WEEKDAY_SHORT[entry.toDay]}` : ""}
                    </Text>
                    <TouchableOpacity onPress={() => removeHours(entry.id)} style={{ padding: 4 }}>
                      <IconSymbol name="trash" size={16} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                  {/* 星期范围 */}
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontSize: 10, color: colors.muted }}>开始星期</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {([1, 2, 3, 4, 5, 6, 0] as const).map((d) => (
                        <TouchableOpacity key={d} onPress={() => { tap(); updHours(entry.id, { fromDay: d }); }}
                          style={{ width: 36, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1,
                            backgroundColor: entry.fromDay === d ? colors.primary : colors.surface,
                            borderColor: entry.fromDay === d ? colors.primary : colors.border }}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: entry.fromDay === d ? "#fff" : colors.muted }}>{WEEKDAY_SHORT[d]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={{ fontSize: 10, color: colors.muted }}>结束星期</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {([1, 2, 3, 4, 5, 6, 0] as const).map((d) => (
                        <TouchableOpacity key={d} onPress={() => { tap(); updHours(entry.id, { toDay: d }); }}
                          style={{ width: 36, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1,
                            backgroundColor: entry.toDay === d ? colors.primary : colors.surface,
                            borderColor: entry.toDay === d ? colors.primary : colors.border }}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: entry.toDay === d ? "#fff" : colors.muted }}>{WEEKDAY_SHORT[d]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  {/* 时间段 */}
                  <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>开门时间</Text>
                      <TextInput value={entry.openTime} onChangeText={(v) => updHours(entry.id, { openTime: v })}
                        placeholder="10:00" placeholderTextColor={colors.muted}
                        style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%", textAlign: "left" }]} />
                    </View>
                    <Text style={{ color: colors.muted, marginTop: 14 }}>—</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>关门时间</Text>
                      <TextInput value={entry.closeTime} onChangeText={(v) => updHours(entry.id, { closeTime: v })}
                        placeholder="22:00" placeholderTextColor={colors.muted}
                        style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%", textAlign: "left" }]} />
                    </View>
                  </View>
                  {/* 备注 */}
                  <TextInput value={entry.notes ?? ""} onChangeText={(v) => updHours(entry.id, { notes: v })}
                    placeholder="备注（可选）" placeholderTextColor={colors.muted}
                    style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, textAlign: "left" }]} />
                </View>
              ))}
              <TouchableOpacity onPress={addNewHours} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary + "66" }}>
                <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加时间段</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── Tab: 特殊状态 ── */}
          {activeTab === "statuses" && (
            <>
              {localStatuses.map((ss) => (
                <View key={ss.id} style={{ backgroundColor: ss.color + "10", borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: ss.color + "44" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ss.color }} />
                    <TextInput value={ss.name} onChangeText={(v) => updStatus(ss.id, { name: v })}
                      placeholder="状态名称" placeholderTextColor={colors.muted}
                      style={{ flex: 1, fontSize: 15, fontWeight: "700", color: ss.color, paddingVertical: 2 }} />
                    <TouchableOpacity onPress={() => removeStatus(ss.id)} style={{ padding: 4 }}>
                      <IconSymbol name="trash" size={16} color={ss.isBuiltin ? colors.muted : colors.error} />
                    </TouchableOpacity>
                  </View>
                  {/* 方向选择 */}
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 4 }}>薪资方向</Text>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      {(["positive", "negative", "neutral"] as const).map((dir) => (
                        <TouchableOpacity key={dir} onPress={() => updStatus(ss.id, { direction: dir })}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                            backgroundColor: (ss.direction ?? "negative") === dir ? DIRECTION_COLORS[dir] : colors.surface,
                            borderColor: (ss.direction ?? "negative") === dir ? DIRECTION_COLORS[dir] : colors.border }}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: (ss.direction ?? "negative") === dir ? "#fff" : colors.muted }}>{DIRECTION_LABELS[dir]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  {/* 是否计工时 */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View>
                      <Text style={{ fontSize: 13, color: colors.foreground }}>计入工时</Text>
                      <Text style={{ fontSize: 10, color: colors.muted }}>该天是否有实际上班工时</Text>
                    </View>
                    <TouchableOpacity onPress={() => updStatus(ss.id, { countAsAttendance: !(ss.countAsAttendance ?? false) })}
                      style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: (ss.countAsAttendance ?? false) ? colors.success : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: (ss.countAsAttendance ?? false) ? "flex-end" : "flex-start" }} />
                    </TouchableOpacity>
                  </View>
                  {/* 是否节假日 */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View>
                      <Text style={{ fontSize: 13, color: colors.foreground }}>节假日性质</Text>
                      <Text style={{ fontSize: 10, color: colors.muted }}>开启后可选择「拿钱」或「换休」</Text>
                    </View>
                    <TouchableOpacity onPress={() => updStatus(ss.id, { isHoliday: !(ss.isHoliday ?? false) })}
                      style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: (ss.isHoliday ?? false) ? "#FF2D55" : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: (ss.isHoliday ?? false) ? "flex-end" : "flex-start" }} />
                    </TouchableOpacity>
                  </View>
                  {/* 薪资倍率 */}
                  {ss.category !== "comp_off" && (
                    <View>
                      <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 6 }}>
                        薪资倍率：{ss.salaryMultiplier}x · {(() => {
                          const dir = ss.direction ?? "negative";
                          const m = ss.salaryMultiplier;
                          if (dir === "neutral") return "不加不扣";
                          if (dir === "positive") {
                            if (!ss.countAsAttendance) return m === 1 ? "不扣薪（退回1天）" : `退回${m}天日薪`;
                            return m <= 1 ? "正常日薪" : `额外补偿${(m - 1).toFixed(1)}倍日薪`;
                          }
                          if (!ss.countAsAttendance) {
                            if (m === 0) return "不扣薪";
                            if (m < 1) return `只扣${m}天日薪（退回${(1 - m).toFixed(1)}天）`;
                            if (m === 1) return "扣1天日薪";
                            return `扣${m}天日薪（额外惩罚${(m - 1).toFixed(1)}天）`;
                          }
                          return `扣${m}倍日薪（上班但违规）`;
                        })()}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        {MULTIPLIER_PRESETS.map((m) => (
                          <TouchableOpacity key={m} onPress={() => updStatus(ss.id, { salaryMultiplier: m })}
                            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                              backgroundColor: ss.salaryMultiplier === m ? ss.color : colors.surface,
                              borderColor: ss.salaryMultiplier === m ? ss.color : colors.border }}>
                            <Text style={{ fontSize: 12, color: ss.salaryMultiplier === m ? "#fff" : colors.muted }}>{m}x</Text>
                          </TouchableOpacity>
                        ))}
                        <TextInput value={MULTIPLIER_PRESETS.includes(ss.salaryMultiplier) ? "" : String(ss.salaryMultiplier)}
                          onChangeText={(v) => updStatus(ss.id, { salaryMultiplier: Number(v) || ss.salaryMultiplier })}
                          placeholder="自定义" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                          style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 60 }]} />
                      </View>
                    </View>
                  )}
                  {/* 分类 */}
                  <View>
                    <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 4 }}>UI 分类（仅分组显示）</Text>
                    <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                      {(["absence", "work_day", "comp_off"] as const).map((cat) => (
                        <TouchableOpacity key={cat} onPress={() => updStatus(ss.id, { category: cat })}
                          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                            backgroundColor: ss.category === cat ? ss.color : colors.surface,
                            borderColor: ss.category === cat ? ss.color : colors.border }}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: ss.category === cat ? "#fff" : colors.muted }}>{CATEGORY_LABELS[cat]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {SHIFT_COLOR_PRESETS.map((c) => (
                      <TouchableOpacity key={c} onPress={() => { tap(); updStatus(ss.id, { color: c }); }}
                        style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c, borderWidth: ss.color === c ? 3 : 1, borderColor: ss.color === c ? colors.foreground : c + "44" }} />
                    ))}
                  </View>
                </View>
              ))}
              <TouchableOpacity onPress={addNewStatus} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary + "66" }}>
                <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加特殊状态</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 11, color: colors.muted, textAlign: "center" }}>内置状态可修改名称和倍率，不可删除</Text>
            </>
          )}

        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── 内嵌排班表页（第一页） ───────────────────────────────────────────────────
// Excel 风格排班表：每周一个区块
// 结构：日期行（橙色背景）→ 各班次员工行（工时数字）→ 班次间空行分隔
function SchedulePage({ colors, month, onMonthChange }: { colors: any; month: string; onMonthChange: (m: string) => void }) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { employees } = useEmployeeStore();
  const { shifts, upsertShift, batchUpsertShifts, deleteShift, batchDeleteShifts, getShifts } = useShiftStore();
  const { templates, upsertTemplate, deleteTemplate } = useShiftTemplateStore();
  const { statuses: specialStatuses, upsertStatus, deleteStatus } = useSpecialStatusStore();
  const { paySlips, getPaySlip, upsertPaySlip, buildPaySlipDraft } = usePaySlipStore();
  const { getAttendance, upsertAttendance, calcFromShifts } = useAttendanceStore();
  // 旧绩效 Store 已移除，performanceTotal 从新 KPI 系统计算
  const { getHolidayForDate } = useHolidayConfigStore();
  const { advances } = useSalaryAdvanceStore();
  const { settings: globalSettings } = useGlobalPayrollSettingsStore();
  const { getAvailableDays: getCompOffAvailDays, addEntry: addCompOffEntry, updateEntry: updateCompOffEntry, getEntries: getCompOffEntries, expireOldEntries: expireCompOff, cashOutEntry: cashOutCompOff } = useCompOffBalanceEntryStore();
  const { getAvailableDays: getHolidayCompOffAvailDays, updateEntry: updateHolidayCompOff, getEntries: getHolidayCompOffEntries, addEntry: addHolidayCompOff, expireOldEntries: expireHolidayCompOff } = useHolidayCompOffStore();
  const { upsertAlert } = useUnexplainedRestAlertStore();
  const { businessHours, setBusinessHours } = useBusinessHoursStore();
  const { shiftGroups, upsertShiftGroup, deleteShiftGroup, setShiftGroups, getGroupForTemplate } = useShiftGroupStore();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentMonth = month;
  const { depts: customDepts, resolveEmployeeDept } = useCustomDeptStore();
  const schPageWidth = SCREEN_W;
  const [deptCategory, setDeptCategory] = useState<DeptCategory>("front");
  // 班次/时长切换
  const [viewMode, setViewMode] = useState<"session" | "hours">("hours");
  const [showTplModal, setShowTplModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);
  const [showHolidayDecisionModal, setShowHolidayDecisionModal] = useState(false);
  const [pendingHolidayDecisions, setPendingHolidayDecisions] = useState<HolidayDecisionItem[]>([]);
  // 班次模式格子编辑 Modal
  const [showShiftModal, setShowShiftModal] = useState(false);
  // 时长模式格子编辑 Modal
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editSession, setEditSession] = useState<string>("晚班");
  // 班次模式快速填充
  const [showQuickFill, setShowQuickFill] = useState(false);
  // 时长模式快速填充
  const [showQuickFillHours, setShowQuickFillHours] = useState(false);
  const [quickFillEmployee, setQuickFillEmployee] = useState<Employee | null>(null);
  const { presets: fillPresets, savePreset: saveFillPreset, deletePreset: deleteFillPreset } = useFillPresetStore();
  // 批量删除模式
  const [editMode, setEditMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set()); // key: `${empId}_${date}_${session}`

  const toggleCellSelection = (empId: string, date: string, session: string) => {
    const key = `${empId}_${date}_${session}`;
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const selectAllMonth = () => {
    const keys = new Set<string>();
    for (const { tpl, empList } of groupedScheduleRows) {
      if (!tpl) continue; // 未分组员工无班次，跳过
      for (const emp of empList) {
        for (const d of dates) {
          const entry = getEntry(emp.id, d, tpl.session);
          if (entry) keys.add(`${emp.id}_${d}_${tpl.session}`);
        }
      }
    }
    setSelectedCells(keys);
  };

  const deleteSelected = () => {
    if (selectedCells.size === 0) return;
    Alert.alert(
      "确认删除",
      `确认删除 ${selectedCells.size} 条排班记录？此操作不可撤销。`,
      [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => {
          // 批量删除：一次性写入，避免逐条调用导致的竞态条件
          const keys: Array<{ employeeId: string; date: string; shift: string }> = [];
          selectedCells.forEach((key) => {
            const parts = key.split("_");
            // key 格式: empId_date_session（empId 是 UUID 含-，date 是 YYYY-MM-DD 含-，session 是班次名）
            // 第一个 _ 前是 empId，第二个 _ 前是 date，剩下是 session
            const empId = parts[0];
            const date = parts[1];
            const session = parts.slice(2).join("_");
            // 优先用实际存储的 shift 字段（避免 editSession 与存储字段不匹配）
            const actualEntry = monthShifts.find((s) => s.employeeId === empId && s.date === date && s.shift === session)
              ?? adjacentShifts.find((s) => s.employeeId === empId && s.date === date && s.shift === session);
            if (actualEntry) {
              keys.push({ employeeId: actualEntry.employeeId, date: actualEntry.date, shift: actualEntry.shift });
            }
          });
          batchDeleteShifts(keys);
          setSelectedCells(new Set());
          setEditMode(false);
        }},
      ]
    );
  };

  // 排班数据自动同步薪资单：每次 shifts 变化时自动重算当月已有排班的员工薪资单
  const autoSyncTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    // 防抖：500ms 内多次修改只触发一次
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      const activeEmps = employees.filter((e) => e.active && !e.archived);
      for (const emp of activeEmps) {
        const empShifts = getShifts(currentMonth).filter((s) => s.employeeId === emp.id);
        if (empShifts.length === 0) continue;
        const holidayDaysList = empShifts
          .map((s) => { const hc = getHolidayForDate(s.date, emp.id); return hc ? { date: s.date, multiplier: hc.multiplier } : null; })
          .filter((x): x is { date: string; multiplier: number } => x !== null);
        const att = calcFromShifts(emp.id, currentMonth, emp, empShifts, specialStatuses, holidayDaysList);
        upsertAttendance(att);
        const advanceTotal = advances
          .filter((a) => a.employeeId === emp.id && (a.deductMonth === currentMonth || a.date.startsWith(currentMonth)))
          .reduce((s, a) => s + a.amount, 0);
        const [curYear] = currentMonth.split("-");
        const prevMonthSlips = paySlips.filter((s) => s.employeeId === emp.id && s.month.startsWith(curYear) && s.month < currentMonth);
        const taxThreshold = emp.incomeTax?.threshold ?? 5000;
        const taxSpecialDed = emp.incomeTax?.specialDeductions ?? 0;
        const cumulativeIncome = prevMonthSlips.reduce((sum, s) => {
          const taxable = Math.max(0, s.grossSalary - (s.socialInsuranceDeduction ?? 0) - (s.housingFundDeduction ?? 0) - taxThreshold - taxSpecialDed);
          return sum + taxable;
        }, 0);
        const cumulativeTaxPaid = prevMonthSlips.reduce((sum, s) => sum + (s.incomeTax ?? 0), 0);
        // buildPaySlipDraft 内部已通过 existing 保留手动字段
        // 并已在 finalSalary 中正确扣除 pettyLaborPaid（不需重复扣）
        // 重要：performanceTotal 从 existing 读取，防止覆盖手动录入的绩效奖金
        const existingSlip = getPaySlip(emp.id, currentMonth);
        const performanceTotal = existingSlip?.performanceBonus ?? 0;
        const slip = buildPaySlipDraft(emp, currentMonth, att, performanceTotal, advanceTotal, globalSettings, cumulativeIncome, cumulativeTaxPaid);
        upsertPaySlip(slip);
      }
    }, 500);
    return () => { if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current); };
  }, [shifts, currentMonth]);

  const sortedTemplates = useMemo(() =>
    [...(templates.length > 0 ? templates : DEFAULT_SHIFT_TEMPLATES)].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [templates]
  );

  // 按周分组：周一开头，跨月日期也显示（颜色淡化）
  const calendarWeeks = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const firstDow = new Date(y, m - 1, 1).getDay();
    const firstOffset = firstDow === 0 ? 6 : firstDow - 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const numWeeks = Math.ceil((firstOffset + daysInMonth) / 7);
    return Array.from({ length: numWeeks }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const idx = w * 7 + d - firstOffset;
        if (idx >= 0 && idx < daysInMonth) {
          // 当月日期
          return { dateStr: `${y}-${String(m).padStart(2, "0")}-${String(idx + 1).padStart(2, "0")}`, isCurrentMonth: true };
        } else if (idx < 0) {
          // 上月日期
          const prevDate = new Date(y, m - 1, idx + 1);
          return { dateStr: `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}-${String(prevDate.getDate()).padStart(2, "0")}`, isCurrentMonth: false };
        } else {
          // 下月日期
          const nextDate = new Date(y, m, idx - daysInMonth + 1);
          return { dateStr: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}-${String(nextDate.getDate()).padStart(2, "0")}`, isCurrentMonth: false };
        }
      })
    );
  }, [currentMonth]);

  const dates = useMemo(() => getMonthDates(currentMonth), [currentMonth]);
  const deptColor = deptCategory === "front" ? "#1677FF" : "#52C41A";
  const monthShifts = useMemo(() => getShifts(currentMonth), [shifts, currentMonth]);

  // 跨月格子需要查询相邻月数据：取上月和下月的排班记录
  const adjacentShifts = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number);
    const prevM = new Date(y, m - 2, 1);
    const nextM = new Date(y, m, 1);
    const prevMonth = `${prevM.getFullYear()}-${String(prevM.getMonth() + 1).padStart(2, "0")}`;
    const nextMonth = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, "0")}`;
    return [
      ...getShifts(prevMonth),
      ...getShifts(nextMonth),
    ];
  }, [shifts, currentMonth]);
  const allDeptEmployees = useMemo(() => employees.filter((e) => e.active && !e.archived && resolveEmployeeDept(e).category === deptCategory), [employees, deptCategory, resolveEmployeeDept]);

  // 分组引擎：以「班次」为主体
  // - 每个班次行：显示本月在该班次有排班记录的所有员工（员工可同时出现在多个班次行）
  // - 未分组行：本月完全无排班记录的员工
  const employeesBySession = useMemo(() => {
    const map: Record<string, Employee[]> = { __unassigned: [] };
    for (const tpl of sortedTemplates) {
      map[tpl.session] = [];
    }
    for (const emp of allDeptEmployees) {
      // 找出该员工本月在各班次的排班记录
      const sessionsWithShifts = new Set(
        monthShifts
          .filter((s) => s.employeeId === emp.id && sortedTemplates.some((t) => t.session === s.shift))
          .map((s) => s.shift)
      );
      if (sessionsWithShifts.size === 0) {
        // 本月完全无排班 → 未分组
        map["__unassigned"].push(emp);
      } else {
        // 员工同时加入所有有排班记录的班次行
        for (const session of sessionsWithShifts) {
          if (map[session] !== undefined) {
            map[session].push(emp);
          }
        }
      }
    }
    return map;
  }, [allDeptEmployees, sortedTemplates, monthShifts]);

  // 班次分组排序：按 ShiftGroup 分组显示员工
  const sortedShiftGroups = useMemo(() =>
    [...(shiftGroups.length > 0 ? shiftGroups : DEFAULT_SHIFT_GROUPS)].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [shiftGroups]
  );

  // 构建分组展示数据：{ group, tpl, empList, groupColor }
  // 构建分组展示数据
  // - 每个班次始终显示（无人时显示「暂无排班」占位）
  // - 员工可同时出现在多个班次行
  // - 未分组员工（本月无任何排班）始终显示在最后
  const groupedScheduleRows = useMemo(() => {
    const rows: Array<{ groupId: string; groupName: string; groupColor: string; tpl: ShiftTemplate | null; empList: Employee[] }> = [];
    const coveredTplIds = new Set<string>();

    // 1. 已配置分组的班次：始终显示
    for (const grp of sortedShiftGroups) {
      for (const tplId of grp.templateIds) {
        const tpl = sortedTemplates.find((t) => t.id === tplId);
        if (!tpl) continue;
        coveredTplIds.add(tpl.id);
        const empList = employeesBySession[tpl.session] ?? [];
        rows.push({ groupId: grp.id, groupName: grp.name, groupColor: grp.color, tpl, empList });
      }
    }
    // 2. 未分组的班次：始终显示（包括无员工的）
    for (const tpl of sortedTemplates) {
      if (coveredTplIds.has(tpl.id)) continue;
      const empList = employeesBySession[tpl.session] ?? [];
      rows.push({ groupId: "__ungrouped", groupName: "未分组", groupColor: tpl.color, tpl, empList });
    }
    // 3. 未分组员工（本月无任何排班）：始终显示在最后
    const unassigned = employeesBySession["__unassigned"] ?? [];
    rows.push({ groupId: "__unassigned", groupName: "未分组", groupColor: "#8E8E93", tpl: null, empList: unassigned });
    return rows;
  }, [sortedShiftGroups, sortedTemplates, employeesBySession]);

  // getEntry 支持跨月查询：先查当月，再查相邻月
  const getEntry = useCallback((employeeId: string, date: string, session: string): ShiftEntry | null => {
    const inMonth = monthShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === session);
    if (inMonth) return inMonth;
    return adjacentShifts.find((s) => s.employeeId === employeeId && s.date === date && s.shift === session) ?? null;
  }, [monthShifts, adjacentShifts]);

  // 班次模式格子点击 → SchShiftModal
  // 时长模式格子点击 → SchHoursModal
  const handleCellPress = (emp: Employee, date: string, session: string) => {
    tap();
    setEditEmployee(emp);
    setEditDate(date);
    setEditSession(session);
    if (viewMode === "session") {
      setShowShiftModal(true);
    } else {
      setShowHoursModal(true);
    }
  };


  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  const collectHolidayDecisionItems = useCallback((): HolidayDecisionItem[] => {
    const activeEmps = employees.filter((e) => e.active && !e.archived);
    const items: HolidayDecisionItem[] = [];
    for (const emp of activeEmps) {
      const empShifts = getShifts(currentMonth).filter((s) => s.employeeId === emp.id);
      if (empShifts.length === 0) continue;
      const holidayDaysList = empShifts
        .map((s) => {
          const hc = getHolidayForDate(s.date, emp.id);
          return hc ? { date: s.date, multiplier: hc.multiplier } : null;
        })
        .filter((x): x is { date: string; multiplier: number } => x !== null);
      const att = calcFromShifts(emp.id, currentMonth, emp, empShifts, specialStatuses, holidayDaysList);
      const existingSlip = getPaySlip(emp.id, currentMonth);
      empShifts.forEach((s) => {
        if (!s.specialStatusId) return;
        const ss = specialStatuses.find((st) => st.id === s.specialStatusId);
        if (!ss?.isHoliday || ss.salaryMultiplier <= 1) return;
        const key = `${emp.id}_${s.date}_${ss.id}`;
        const bonusAmount = Math.round(att.dailyRate * (ss.salaryMultiplier - 1) * 100) / 100;
        items.push({
          key,
          employeeId: emp.id,
          employeeCode: emp.code,
          date: s.date,
          specialStatusId: ss.id,
          holidayName: ss.name,
          bonusAmount,
          mode: existingSlip?.holidayBonusAllocation?.[key]?.mode === "rest" ? "rest" : "cash",
        });
      });
    }
    return items;
  }, [employees, getShifts, currentMonth, getHolidayForDate, calcFromShifts, specialStatuses, getPaySlip]);

  const runPayrollGeneration = useCallback(async (holidayDecisions: HolidayDecisionItem[]) => {
    setGenerating(true);
    try {
      const activeEmps = employees.filter((e) => e.active && !e.archived);
      const holidayDecisionMap = new Map(holidayDecisions.map((item) => [item.key, item.mode]));
      let count = 0;
      for (const emp of activeEmps) {
        const empShifts = getShifts(currentMonth).filter((s) => s.employeeId === emp.id);
        if (empShifts.length === 0) continue;
        const holidayDaysList = empShifts
          .map((s) => {
            const hc = getHolidayForDate(s.date, emp.id);
            return hc ? { date: s.date, multiplier: hc.multiplier } : null;
          })
          .filter((x): x is { date: string; multiplier: number } => x !== null);
        const baseAtt = calcFromShifts(emp.id, currentMonth, emp, empShifts, specialStatuses, holidayDaysList);
        const holidayBonusAllocation: Record<string, {
          date: string;
          name: string;
          totalBonus: number;
          cashAmount: number;
          restDays: number;
          mode: "cash" | "rest" | "split";
        }> = {};
        let holidayRestBonus = 0;
        empShifts.forEach((s) => {
          if (!s.specialStatusId) return;
          const ss = specialStatuses.find((st) => st.id === s.specialStatusId);
          if (!ss?.isHoliday || ss.salaryMultiplier <= 1) return;
          const key = `${emp.id}_${s.date}_${ss.id}`;
          const dayBonus = Math.round(baseAtt.dailyRate * (ss.salaryMultiplier - 1) * 100) / 100;
          const mode = holidayDecisionMap.get(key) ?? (getPaySlip(emp.id, currentMonth)?.holidayBonusAllocation?.[key]?.mode === "rest" ? "rest" : "cash");
          holidayBonusAllocation[key] = {
            date: s.date,
            name: ss.name,
            totalBonus: dayBonus,
            cashAmount: mode === "cash" ? dayBonus : 0,
            restDays: mode === "rest" ? 1 : 0,
            mode,
          };
          const existingEntry = getCompOffEntries(emp.id).find((e) => e.source === "holiday" && e.workDate === s.date && e.earnedMonth === currentMonth);
          if (mode === "rest") {
            holidayRestBonus += dayBonus;
            if (!existingEntry) {
              addCompOffEntry({
                employeeId: emp.id,
                earnedMonth: currentMonth,
                source: "holiday",
                workDate: s.date,
                holidayName: ss.name,
                holidayBonusAmount: dayBonus,
                days: 1,
                expiresMonth: calcCompOffExpiresMonth(currentMonth),
                status: "available",
                notes: "节假日上班选择换休自动生成",
              });
            } else if (existingEntry.status === "expired") {
              updateCompOffEntry(existingEntry.id, {
                status: "available",
                usedMonth: undefined,
                holidayBonusAmount: dayBonus,
                expiresMonth: calcCompOffExpiresMonth(currentMonth),
                notes: "重新生成薪资单后恢复为换休",
              });
            }
          } else if (existingEntry && existingEntry.status === "available") {
            updateCompOffEntry(existingEntry.id, {
              status: "expired",
              notes: "重新生成薪资单后改为拿钱，自动作废",
            });
          }
        });
        const att = holidayRestBonus > 0
          ? {
              ...baseAtt,
              holidayBonus: Math.max(0, Math.round((baseAtt.holidayBonus - holidayRestBonus) * 100) / 100),
              attendanceSalary: Math.round((baseAtt.attendanceSalary - holidayRestBonus) * 100) / 100,
            }
          : baseAtt;
        upsertAttendance(att);
        // 绩效奖金从 existing 读取（已在 labor-kpi-allowance 页手动录入）
        // 不传 0，防止覆盖手动录入的绩效奖金
        const performanceTotal = getPaySlip(emp.id, currentMonth)?.performanceBonus ?? 0;
        const advanceTotal = advances
          .filter((a) => a.employeeId === emp.id && (a.deductMonth === currentMonth || a.date.startsWith(currentMonth)))
          .reduce((s, a) => s + a.amount, 0);
        const [curYear] = currentMonth.split("-");
        const prevMonthSlips = paySlips.filter((s) =>
          s.employeeId === emp.id &&
          s.month.startsWith(curYear) &&
          s.month < currentMonth
        );
        const taxThreshold = emp.incomeTax?.threshold ?? 5000;
        const taxSpecialDed = emp.incomeTax?.specialDeductions ?? 0;
        const cumulativeIncome = prevMonthSlips.reduce((sum, s) => {
          const taxable = Math.max(0,
            s.grossSalary - (s.socialInsuranceDeduction ?? 0) - (s.housingFundDeduction ?? 0) - taxThreshold - taxSpecialDed
          );
          return sum + taxable;
        }, 0);
        const cumulativeTaxPaid = prevMonthSlips.reduce((sum, s) => sum + (s.incomeTax ?? 0), 0);
        expireCompOff(currentMonth);
        expireHolidayCompOff(currentMonth);

        // 三种调休换休单独处理：按班次中的 specialStatusId 分别扣除对应余额
        const empShiftsForCompOff = getShifts(currentMonth).filter((s) => s.employeeId === emp.id && s.specialStatusId);
        for (const s of empShiftsForCompOff) {
          if (s.specialStatusId === "ss_comp_off_holiday") {
            // 节假日调休：优先消耗节假日调休余额
            const hEntries = getHolidayCompOffEntries(emp.id)
              .filter((e) => e.status === "available" && e.expiresMonth >= currentMonth)
              .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth));
            if (hEntries.length > 0) {
              const entry = hEntries[0];
              const usedays = Math.min(entry.days, 1);
              updateHolidayCompOff(entry.id, {
                status: usedays >= entry.days ? "used_rest" : "available",
                days: entry.days - usedays,
                usedMonth: currentMonth,
              });
            }
          } else if (s.specialStatusId === "ss_comp_off_overtime") {
            // 加班换休：优先消耗加班调休余额
            const otEntries = getCompOffEntries(emp.id)
              .filter((e) => e.status === "available" && e.source === "overtime" && e.expiresMonth >= currentMonth)
              .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth));
            if (otEntries.length > 0) {
              const entry = otEntries[0];
              const usedays = Math.min(entry.days, 1);
              updateCompOffEntry(entry.id, {
                status: usedays >= entry.days ? "used_rest" : "available",
                days: entry.days - usedays,
                usedMonth: currentMonth,
              });
            }
          } else if (s.specialStatusId === "ss_comp_off_balance") {
            // 调休余额：消耗任意可用余额
            const balEntries = getCompOffEntries(emp.id)
              .filter((e) => e.status === "available" && e.expiresMonth >= currentMonth)
              .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth));
            if (balEntries.length > 0) {
              const entry = balEntries[0];
              const usedays = Math.min(entry.days, 1);
              updateCompOffEntry(entry.id, {
                status: usedays >= entry.days ? "used_rest" : "available",
                days: entry.days - usedays,
                usedMonth: currentMonth,
              });
            }
          }
        }

        const extraRestDays = Math.max(0, -(att.underRestDays));
        let remainingExtraRest = extraRestDays;
        if (remainingExtraRest > 0) {
          const holidayEntries = getHolidayCompOffEntries(emp.id)
            .filter((e) => e.status === "available" && e.expiresMonth >= currentMonth)
            .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth));
          for (const entry of holidayEntries) {
            if (remainingExtraRest <= 0) break;
            const usedays = Math.min(entry.days, remainingExtraRest);
            updateHolidayCompOff(entry.id, {
              status: usedays >= entry.days ? "used_rest" : "available",
              days: entry.days - usedays,
              usedMonth: currentMonth,
            });
            remainingExtraRest -= usedays;
          }
        }
        if (remainingExtraRest > 0) {
          const compOffEntries = getCompOffEntries(emp.id)
            .filter((e) => e.status === "available" && e.expiresMonth >= currentMonth)
            .sort((a, b) => a.expiresMonth.localeCompare(b.expiresMonth));
          for (const entry of compOffEntries) {
            if (remainingExtraRest <= 0) break;
            const usedays = Math.min(entry.days, remainingExtraRest);
            updateCompOffEntry(entry.id, {
              status: usedays >= entry.days ? "used_rest" : "available",
              days: entry.days - usedays,
              usedMonth: currentMonth,
            });
            remainingExtraRest -= usedays;
          }
        }
        if (remainingExtraRest > 0) {
          upsertAlert({
            id: `${emp.id}_${currentMonth}`,
            employeeId: emp.id,
            month: currentMonth,
            unexplainedDays: remainingExtraRest,
            resolution: "pending",
            updatedAt: new Date().toISOString(),
          });
        }
        const slip = buildPaySlipDraft(emp, currentMonth, att, performanceTotal, advanceTotal, globalSettings, cumulativeIncome, cumulativeTaxPaid);
        if (Object.keys(holidayBonusAllocation).length > 0) slip.holidayBonusAllocation = holidayBonusAllocation;
        upsertPaySlip(slip);
        count++;
      }
      setShowHolidayDecisionModal(false);
      setPendingHolidayDecisions([]);
      setGenResult(`✅ 已生成 ${count} 人薪资单`);
      setTimeout(() => setGenResult(null), 4000);
    } catch (e) {
      setGenResult("❌ 生成失败，请重试");
      setTimeout(() => setGenResult(null), 3000);
    } finally {
      setGenerating(false);
    }
  }, [employees, getShifts, currentMonth, getHolidayForDate, calcFromShifts, specialStatuses, getPaySlip, getCompOffEntries, addCompOffEntry, updateCompOffEntry, upsertAttendance, advances, paySlips, expireCompOff, expireHolidayCompOff, getHolidayCompOffEntries, updateHolidayCompOff, upsertAlert, buildPaySlipDraft, globalSettings, upsertPaySlip]);

  const editTpl = sortedTemplates.find((t) => t.session === editSession) ?? sortedTemplates[0] ?? DEFAULT_SHIFT_TEMPLATES[0];
  const editContractH = editEmployee && editDate ? getContractHoursForDate(editEmployee, editDate) : 0;

  // 周标题（周一开头）
  const WEEK_HEADERS = ["周一 Monday", "周二 Tuesday", "周三 Wednesday", "周四 Thursday", "周五 Friday", "周六 Saturday", "周日 Sunday"];
  const WEEK_SHORT = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  // 单元格内容：班次模式显示班次完整名称（最多3字），时长模式显示工时数字
  // 数字统一深灰色，加班红色标注，调休维色标注
  // shortLabel：前两字 + 倍率（倍率=1不显示，倍率=0.5显示.5，倍率=2显示2）
  const ssShortLabel = (ss: SpecialStatus): string => {
    const name = ss.name.slice(0, 2);
    const m = ss.salaryMultiplier;
    if (m === 1) return name;
    if (m === 0.5) return `${name}.5`;
    return `${name}${m}`;
  };

  const renderCellContent = (entry: ShiftEntry | null, session: string, contractH: number, groupColor?: string) => {
    if (!entry) return null;
    const h = entry.hoursValue;
    // 向后兼容：旧版 "休"/"无早" hoursValue
    if (h === "休") return <Text style={EXL.cellRest}>(休)</Text>;
    if (h === "无早") return <Text style={EXL.cellNoMorning}>(无早)</Text>;
    // 特殊状态
    if (entry.specialStatusId) {
      const ss = specialStatuses.find((s) => s.id === entry.specialStatusId);
      if (ss) {
        const ssColor = ss.color;
        if (viewMode === "hours") {
          // 时长模式：
          // work_day 类 → 显示工时数字 + 右上角颜色角标
          if (ss.category === "work_day" && typeof h === "number" && h > 0) {
            const isOT = contractH > 0 && h > contractH;
            return (
              <View style={{ alignItems: "center" }}>
                <View style={{ position: "relative" }}>
                  <Text style={[EXL.cellHours, isOT && { color: "#FF4D4F", fontWeight: "700" }]}>
                    {h % 1 === 0 ? `${h}.0` : `${h}`}
                  </Text>
                  <View style={{ position: "absolute", top: -2, right: -4, width: 5, height: 5, borderRadius: 2.5, backgroundColor: ssColor }} />
                </View>
              </View>
            );
          }
          // absence / comp_off 类 → 文字缩写（前两字）
          return <Text style={{ fontSize: 9, fontWeight: "700", color: ssColor }} numberOfLines={1}>{ss.name.slice(0, 2)}</Text>;
        } else {
          // 班次模式：前两字 + 倍率（如「节日3」「旷工2」「病假.5」）
          return <Text style={{ fontSize: 9, fontWeight: "700", color: ssColor }} numberOfLines={1}>{ssShortLabel(ss)}</Text>;
        }
      }
    }
    if (viewMode === "session") {
      // 班次模式：显示班次名称前两字
      const label = session.slice(0, 2);
      const textColor = groupColor ?? "#3C3C43";
      return <Text style={[EXL.cellSession, { color: textColor, fontSize: 10 }]} numberOfLines={1}>{label}</Text>;
    }
    // 时长模式：显示工时数字
    if (typeof h === "number" && h > 0) {
      const isOT = contractH > 0 && h > contractH;
      return <Text style={[EXL.cellHours, isOT && { color: "#FF4D4F", fontWeight: "700" }]}>{h % 1 === 0 ? `${h}.0` : `${h}`}</Text>;
    }
    return null;
  };

  // 每周区块：日期行 + 各班次员工行
  const renderWeekBlock = (week: { dateStr: string; isCurrentMonth: boolean }[], weekIdx: number) => {
    // iOS 日历配色方案
    // 日期行背景：深蓝灰 #2C3550（类似 iOS 日历表头）
    const DATE_ROW_BG = "#2C3550";
    // 今天：蓝色圆圈（iOS 标志色 #1677FF）
    // 当月日期：白色文字
    // 跨月日期：半透明白色（rgba(255,255,255,0.3)）

    return (
      <View key={weekIdx} style={[EXL.weekBlock, { backgroundColor: colors.surface, shadowColor: "#000" }]}>
        {/* 日期行：深蓝灰背景，参考 iOS 日历 */}
        <View style={[EXL.dateRow, { backgroundColor: DATE_ROW_BG }]}>
          <View style={[EXL.nameCol, { backgroundColor: "transparent" }]}>
            <Text style={EXL.dateLabel}>日期</Text>
          </View>
          {week.map(({ dateStr, isCurrentMonth }, di) => {
            const isToday = dateStr === todayStr;
            const dayNum = Number(dateStr.slice(8));
            return (
              <View key={di} style={[EXL.dateCell,
                isToday && { backgroundColor: "#1677FF", borderRadius: 4, margin: 2 }
              ]}>
                <Text style={[
                  EXL.dateCellText,
                  !isCurrentMonth && { color: "rgba(255,255,255,0.3)" },
                  isToday && { color: "#fff", fontWeight: "700" }
                ]}>{dayNum}</Text>
              </View>
            );
          })}
        </View>

        {/* 各班次员工行（按分组排序，左侧竖条用分组颜色） */}
        {groupedScheduleRows.map(({ groupId, groupName, groupColor, tpl, empList }, rowIdx) => {
          // 空分组：显示分组标题行（提示该班次暂无人排班）
          if (empList.length === 0 && tpl !== null) {
            return (
              <View key={`${groupId}_${tpl.id}_empty`}>
                {rowIdx > 0 && <View style={{ height: 4, backgroundColor: colors.border + "33" }} />}
                <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 8, backgroundColor: groupColor + "08" }}>
                  <View style={{ width: 3, height: 20, borderRadius: 1.5, backgroundColor: groupColor + "66", marginRight: 6 }} />
                  <Text style={{ fontSize: 10, color: groupColor + "99", fontStyle: "italic" }}>{tpl.session} · 暂无排班</Text>
                </View>
              </View>
            );
          }
          // 未分组员工：显示姓名，格子可点击→弹出班次选择器→直接排班
          if (tpl === null) {
            if (empList.length === 0) return null; // 无未分组员工时不显示该行
            return (
              <View key="__unassigned_row">
                {rowIdx > 0 && <View style={{ height: 4, backgroundColor: colors.border + "33" }} />}
                <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 8, backgroundColor: "#8E8E93" + "08" }}>
                  <View style={{ width: 3, height: 20, borderRadius: 1.5, backgroundColor: "#8E8E93" + "66", marginRight: 6 }} />
                  <Text style={{ fontSize: 10, color: "#8E8E93", fontWeight: "600" }}>未分组 · 未排班 ({empList.length})</Text>
                </View>
                {empList.map((emp, empIdx) => {
                  const isLast = empIdx === empList.length - 1;
                  return (
                    <View key={emp.id} style={[EXL.empRow,
                      !isLast && { borderBottomColor: colors.border + "33", borderBottomWidth: StyleSheet.hairlineWidth }
                    ]}>
                      <View style={{ width: 3, height: 34, backgroundColor: "#8E8E93" + "66" }} />
                      <TouchableOpacity
                        onLongPress={() => { if (!editMode) { tap(); setQuickFillEmployee(emp); if (viewMode === "session") { setShowQuickFill(true); } else { setShowQuickFillHours(true); } } }}
                        style={[EXL.nameCol, { backgroundColor: "transparent", width: EXL_NAME_W - 3 }]}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted }} numberOfLines={1}>{emp.code}</Text>
                      </TouchableOpacity>
                      {week.map(({ dateStr, isCurrentMonth }, di) => {
                        const isToday = dateStr === todayStr;
                        return (
                          <TouchableOpacity key={di}
                            onPress={() => {
                              if (editMode) return;
                              // 先选择班次，再打开排班编辑
                              tap();
                              if (sortedTemplates.length === 1) {
                                handleCellPress(emp, dateStr, sortedTemplates[0].session);
                              } else {
                                Alert.alert(
                                  `选择班次：${emp.code} ${dateStr}`,
                                  "请选择要排入的班次",
                                  [
                                    { text: "取消", style: "cancel" },
                                    ...sortedTemplates.map((t) => ({
                                      text: t.session,
                                      onPress: () => handleCellPress(emp, dateStr, t.session),
                                    })),
                                  ]
                                );
                              }
                            }}
                            style={[EXL.cell,
                              isToday && { backgroundColor: "#8E8E93" + "10" },
                              !isCurrentMonth && { backgroundColor: colors.border + "0A" },
                            ]}>
                            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: "#8E8E93" + "44", borderStyle: "dashed" }} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            );
          }
          return (
            <View key={`${groupId}_${tpl.id}`}>
              {rowIdx > 0 && <View style={{ height: 6, backgroundColor: colors.border + "44" }} />}
              {empList.map((emp, empIdx) => {
                const isLast = empIdx === empList.length - 1;
                return (
                  <View key={emp.id} style={[EXL.empRow,
                    !isLast && { borderBottomColor: colors.border + "33", borderBottomWidth: StyleSheet.hairlineWidth }
                  ]}>
                    {/* 分组色左竖条（颜色由分组决定） */}
                    <View style={{ width: 3, height: 34, backgroundColor: groupColor + "CC" }} />
                    <TouchableOpacity
                      onLongPress={() => { if (!editMode) { tap(); setQuickFillEmployee(emp); if (viewMode === "session") { setShowQuickFill(true); } else { setShowQuickFillHours(true); } } }}
                      style={[EXL.nameCol, { backgroundColor: "transparent", width: EXL_NAME_W - 3 }]}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{emp.code}</Text>
                    </TouchableOpacity>
                    {week.map(({ dateStr, isCurrentMonth }, di) => {
                      const entry = getEntry(emp.id, dateStr, tpl.session);
                      const contractH = getContractHoursForDate(emp, dateStr);
                      const isToday = dateStr === todayStr;
                      const cellKey = `${emp.id}_${dateStr}_${tpl.session}`;
                      const isSelected = editMode && selectedCells.has(cellKey);
                      return (
                        <TouchableOpacity key={di}
                          onPress={() => {
                            if (editMode) {
                              tap();
                              toggleCellSelection(emp.id, dateStr, tpl.session);
                            } else {
                              handleCellPress(emp, dateStr, tpl.session);
                            }
                          }}
                          style={[EXL.cell,
                            isToday && !isSelected && { backgroundColor: "#1677FF" + "15" },
                            !isCurrentMonth && !isSelected && { backgroundColor: colors.border + "18" },
                            isSelected && { backgroundColor: colors.error + "25" },
                          ]}>
                          {isSelected
                            ? <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.error, alignItems: "center", justifyContent: "center" }}>
                                <Text style={{ fontSize: 9, color: "#fff", fontWeight: "700" }}>✓</Text>
                              </View>
                            : renderCellContent(entry, tpl.session, contractH, groupColor)
                          }
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>
    );
  };

  // 部门主色：前厅绿色，后厨橙色
  const deptAccent = deptCategory === "front" ? colors.primary : colors.success;

  return (
    <View style={{ flex: 1 }}>
      {/* 控制栏：正常模式 / 编辑模式 */}
      <View style={[EXL.controlBar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        {editMode ? (
          // 编辑模式控制栏
          <>
            <TouchableOpacity onPress={() => { tap(); selectAllMonth(); }}
              style={[EXL.gearBtn, { backgroundColor: colors.border + "44", width: "auto", paddingHorizontal: 10 }]}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }}>全选当月</Text>
            </TouchableOpacity>
            <Text style={{ flex: 1, fontSize: 12, color: colors.muted, textAlign: "center" }}>
              {selectedCells.size > 0 ? `已选 ${selectedCells.size} 个` : "点击格子选中"}
            </Text>
            <TouchableOpacity onPress={() => { tap(); deleteSelected(); }}
              style={[EXL.gearBtn, { backgroundColor: selectedCells.size > 0 ? colors.error + "22" : colors.border + "22", width: "auto", paddingHorizontal: 10 }]}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: selectedCells.size > 0 ? colors.error : colors.muted }}>🗑 删除选中</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { tap(); setEditMode(false); setSelectedCells(new Set()); }}
              style={[EXL.gearBtn, { backgroundColor: colors.border + "44", width: "auto", paddingHorizontal: 10 }]}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.foreground }}>✓ 完成</Text>
            </TouchableOpacity>
          </>
        ) : (
          // 正常模式控制栏
          <>
            {/* 前厅/后厨 */}
            <View style={[EXL.segContainer, { backgroundColor: colors.border + "44" }]}>
              {(["front", "kitchen"] as DeptCategory[]).map((cat) => (
                <TouchableOpacity key={cat} onPress={() => { tap(); setDeptCategory(cat); }}
                  style={[EXL.segItem, deptCategory === cat && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 }]}>
                  <Text style={{ fontSize: 12, fontWeight: deptCategory === cat ? "700" : "400", color: deptCategory === cat ? colors.foreground : colors.muted }}>{DEPT_CATEGORY_LABELS[cat]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* 班次/时长切换 */}
            <View style={[EXL.segContainer, { backgroundColor: colors.border + "44" }]}>
              {(["session", "hours"] as const).map((mode) => (
                <TouchableOpacity key={mode} onPress={() => { tap(); setViewMode(mode); }}
                  style={[EXL.segItem, viewMode === mode && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 }]}>
                  <Text style={{ fontSize: 12, fontWeight: viewMode === mode ? "700" : "400", color: viewMode === mode ? colors.foreground : colors.muted }}>
                    {mode === "session" ? "班次" : "时长"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* 编辑按鈕 */}
            <TouchableOpacity onPress={() => { tap(); setEditMode(true); }}
              style={[EXL.gearBtn, { backgroundColor: colors.border + "44", width: "auto", paddingHorizontal: 10 }]}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }}>✐ 编辑</Text>
            </TouchableOpacity>
            {/* 班次设置 */}
            <Pressable onPress={() => { tap(); setShowTplModal(true); }} style={[EXL.gearBtn, { backgroundColor: colors.border + "44" }]}>
              <IconSymbol name="gearshape.fill" size={16} color={colors.muted} />
            </Pressable>
          </>
        )}
      </View>

      {/* 生成结果提示 */}
      {genResult && (
        <View style={{ backgroundColor: colors.success + "15", paddingHorizontal: 16, paddingVertical: 6 }}>
          <Text style={{ fontSize: 12, color: colors.success, fontWeight: "600", textAlign: "center" }}>{genResult}</Text>
        </View>
      )}

      {/* 周标题固定行（与日期格子等宽对齐） */}
      <View style={[EXL.weekHeaderRow, { backgroundColor: colors.background, borderBottomColor: colors.border + "66" }]}>
        <View style={{ width: EXL_NAME_W }}>
          <Text style={{ fontSize: 9, color: colors.muted, textAlign: "center" }}>星期</Text>
        </View>
        {WEEK_SHORT.map((h) => (
          <View key={h} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontSize: 10, fontWeight: "500", color: colors.muted }}>{h}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 9, color: colors.muted, paddingHorizontal: 12, paddingBottom: 2 }}>长按姓名快速填充 · 右滑查看考勤{editMode ? " · 编辑模式：点击格子选中" : ""}</Text>

      {/* 排班表主体 + 考勤卡片（左右滑动） */}
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
        {/* 左页：排班表 */}
        <ScrollView style={{ width: schPageWidth, flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 8, gap: 10, paddingBottom: 120 }}>
          {calendarWeeks.map((week, wi) => renderWeekBlock(week, wi))}
        </ScrollView>
        {/* 右页：考勤卡片 */}
        <ScrollView style={{ width: schPageWidth, flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 120 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>考勤概况（{monthLabel(currentMonth)}）</Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>← 左滑返回排班表</Text>
          {allDeptEmployees.map((emp) => {
            const att = getAttendance(emp.id, currentMonth);
            const compOffEntries = getCompOffEntries(emp.id);
            const compOffBalance = compOffEntries.filter((e: any) => e.status === "available").length;
            const currentMonthStr = currentMonth;
            return (
              <View key={emp.id} style={{ backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, borderLeftWidth: 3, borderLeftColor: DEPT_COLORS[emp.dept] }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={{ fontSize: 15, fontWeight: "800", color: colors.foreground }}>{emp.code}</Text>
                      <Text style={{ fontSize: 13, color: colors.muted }}>{emp.realName}</Text>
                    </View>
                    {compOffBalance > 0 && (
                      <View style={{ flexDirection: "row" }}>
                        <View style={{ backgroundColor: colors.success + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                          <Text style={{ fontSize: 10, fontWeight: "600", color: colors.success }}>调休 {compOffBalance} 天</Text>
                        </View>
                      </View>
                    )}
                  </View>
                  {att && (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ fontSize: 10, color: colors.muted }}>考勤工资</Text>
                      <Text style={{ fontSize: 17, fontWeight: "800", color: DEPT_COLORS[emp.dept], lineHeight: 21 }}>¥{att.attendanceSalary.toFixed(0)}</Text>
                    </View>
                  )}
                </View>
                {att ? (
                  <View style={{ gap: 4 }}>
                    <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>出勤 <Text style={{ color: colors.foreground, fontWeight: "500" }}>{att.attendanceDays}/{att.expectedAttendanceDays}</Text></Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>加班 <Text style={{ color: colors.foreground, fontWeight: "500" }}>{(att.paidOvertimeHours ?? 0).toFixed(1)}h</Text></Text>
                      {att.underRestDays < 0 && <Text style={{ fontSize: 11, color: colors.success }}>少休 {Math.abs(att.underRestDays)}天</Text>}
                      {att.holidayBonus > 0 && <Text style={{ fontSize: 11, color: colors.success }}>节假日+¥{att.holidayBonus.toFixed(0)}</Text>}
                      {att.totalSpecialDeduction > 0 && <Text style={{ fontSize: 11, color: colors.error }}>扣薪-¥{att.totalSpecialDeduction.toFixed(0)}</Text>}
                    </View>

                    {/* 节假日拿钱/换休选择 */}
                    {(() => {
                      const empShifts = getShifts(currentMonthStr).filter((s: any) => s.employeeId === emp.id);
                      const holidayShifts = empShifts.filter((s: any) => {
                        if (!s.specialStatusId) return false;
                        const ss = specialStatuses.find((st: any) => st.id === s.specialStatusId);
                        return ss?.isHoliday && ss.salaryMultiplier > 1;
                      });
                      if (holidayShifts.length === 0) return null;
                      const slip = getPaySlip(emp.id, currentMonthStr);
                      return (
                        <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                          <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>节假日上班处理：</Text>
                          {holidayShifts.map((s: any) => {
                            const ss = specialStatuses.find((st: any) => st.id === s.specialStatusId)!;
                            const key = `${emp.id}_${s.date}_${ss.id}`;
                            const bonusAmt = Math.round(att.dailyRate * (ss.salaryMultiplier - 1) * 100) / 100;
                            const currentMode = slip?.holidayBonusAllocation?.[key]?.mode ?? "cash";
                            const toggleMode = () => {
                              const newMode = currentMode === "cash" ? "rest" : "cash";
                              const alloc = { ...(slip?.holidayBonusAllocation ?? {}) };
                              alloc[key] = { date: s.date, name: ss.name, totalBonus: bonusAmt, cashAmount: newMode === "cash" ? bonusAmt : 0, restDays: newMode === "rest" ? 1 : 0, mode: newMode };
                              if (slip) {
                                // 同步更新 finalSalary：拿钱时加上奖金，换休时减去奖金
                                const oldCash = Object.values(slip.holidayBonusAllocation ?? {}).reduce((s: number, a: any) => s + (a.cashAmount ?? 0), 0);
                                const newCash = Object.values(alloc).reduce((s: number, a: any) => s + (a.cashAmount ?? 0), 0);
                                const cashDiff = newCash - oldCash;
                                const newFinal = Math.round((slip.finalSalary + cashDiff) * 100) / 100;
                                const newGross = Math.round((slip.grossSalary + cashDiff) * 100) / 100;
                                upsertPaySlip({ ...slip, holidayBonusAllocation: alloc, finalSalary: newFinal, grossSalary: newGross, updatedAt: new Date().toISOString() });
                              }
                              if (newMode === "rest") {
                                const existing = getCompOffEntries(emp.id).find((e: any) => e.source === "holiday" && e.workDate === s.date && e.earnedMonth === currentMonthStr);
                                if (!existing) { addCompOffEntry({ employeeId: emp.id, earnedMonth: currentMonthStr, source: "holiday", workDate: s.date, holidayName: ss.name, holidayBonusAmount: bonusAmt, days: 1, expiresMonth: calcCompOffExpiresMonth(currentMonthStr), status: "available" }); }
                              } else {
                                const existing = getCompOffEntries(emp.id).find((e: any) => e.source === "holiday" && e.workDate === s.date && e.earnedMonth === currentMonthStr);
                                if (existing) { updateCompOffEntry(existing.id, { status: "expired" }); }
                              }
                            };
                            return (
                              <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 3 }}>
                                <Text style={{ fontSize: 11, color: colors.muted }}>{s.date.slice(5)} {ss.name} ¥{bonusAmt}</Text>
                                <TouchableOpacity onPress={() => { tap(); toggleMode(); }}
                                  style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: currentMode === "cash" ? colors.success + "20" : colors.primary + "20" }}>
                                  <Text style={{ fontSize: 10, fontWeight: "600", color: currentMode === "cash" ? colors.success : colors.primary }}>
                                    {currentMode === "cash" ? "拿钱" : "换休"}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      );
                    })()}
                  </View>
                ) : (
                  <Text style={{ fontSize: 11, color: colors.muted }}>暂无考勤数据</Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      </ScrollView>

      <Modal visible={showHolidayDecisionModal} transparent animationType="fade" onRequestClose={() => setShowHolidayDecisionModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 20 }}>
          <View style={{ backgroundColor: colors.background, borderRadius: 18, overflow: "hidden", maxHeight: "82%" }}>
            <View style={{ paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>节假日上班处理</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>生成薪资单前，请为每条节假日上班记录选择「拿钱」或「换休」。</Text>
            </View>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
              {pendingHolidayDecisions.map((item) => (
                <View key={item.key} style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 10, backgroundColor: colors.surface }}>
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{item.employeeCode} · {item.date}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{item.holidayName}，节假日补偿 ¥{item.bonusAmount.toFixed(2)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    {(["cash", "rest"] as const).map((mode) => {
                      const selected = item.mode === mode;
                      return (
                        <TouchableOpacity
                          key={mode}
                          onPress={() => setPendingHolidayDecisions((prev) => prev.map((it) => it.key === item.key ? { ...it, mode } : it))}
                          style={{
                            flex: 1,
                            paddingVertical: 10,
                            borderRadius: 10,
                            alignItems: "center",
                            backgroundColor: selected ? (mode === "cash" ? colors.success : "#1677FF") : colors.background,
                            borderWidth: 1,
                            borderColor: selected ? (mode === "cash" ? colors.success : "#1677FF") : colors.border,
                          }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: selected ? "#fff" : colors.foreground }}>{mode === "cash" ? "拿钱" : "换休"}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: 12, padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
              <TouchableOpacity
                onPress={() => { setShowHolidayDecisionModal(false); setPendingHolidayDecisions([]); }}
                style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: colors.border + "66" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => runPayrollGeneration(pendingHolidayDecisions)}
                style={{ flex: 1.2, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: "#1677FF" }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>确认并生成</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 班次模式格子编辑 Modal（点击即保存） */}
      <SchShiftModal
        visible={showShiftModal}
        date={editDate}
        employee={editEmployee}
        session={editSession}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editSession) : null}
        contractHours={editContractH}
        currentMonth={currentMonth}
        colors={colors}
        shiftTemplates={sortedTemplates}
        specialStatuses={specialStatuses}
        shiftGroups={shiftGroups}
        onSave={(entry) => upsertShift(entry)}
        onClear={() => {
          if (editEmployee && editDate) {
            // 优先用实际存储的 shift 字段，避免 editSession 与存储字段不匹配导致删除失败
            const actualShift = getEntry(editEmployee.id, editDate, editSession)?.shift ?? editSession;
            deleteShift(editEmployee.id, editDate, actualShift);
          }
        }}
        onClose={() => setShowShiftModal(false)}
      />
      {/* 时长模式格子编辑 Modal（只改工时，不影响班次） */}
      <SchHoursModal
        visible={showHoursModal}
        date={editDate}
        employee={editEmployee}
        session={editSession}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editSession) : null}
        contractHours={editContractH}
        currentMonth={currentMonth}
        colors={colors}
        specialStatuses={specialStatuses}
        onSave={(entry) => upsertShift(entry)}
        onClear={() => {
          if (editEmployee && editDate) {
            const actualShift = getEntry(editEmployee.id, editDate, editSession)?.shift ?? editSession;
            deleteShift(editEmployee.id, editDate, actualShift);
          }
        }}
        onClose={() => setShowHoursModal(false)}
      />
      <SchTemplateModal
        visible={showTplModal}
        templates={sortedTemplates}
        specialStatuses={specialStatuses}
        businessHours={businessHours}
        shiftGroups={shiftGroups}
        colors={colors}
        onSaveShift={upsertTemplate}
        onDeleteShift={deleteTemplate}
        onSaveStatus={upsertStatus}
        onDeleteStatus={deleteStatus}
        onSaveBusinessHours={setBusinessHours}
        onSaveShiftGroups={setShiftGroups}
        onClose={() => setShowTplModal(false)}
      />
      {/* 班次模式快速填充（长按姓名） */}
      <QuickFillModal
        visible={showQuickFill}
        employee={quickFillEmployee}
        shiftTemplates={sortedTemplates}
        todayStr={todayStr}
        currentMonth={currentMonth}
        colors={colors}
        presets={fillPresets.filter((p) => !p.mode || p.mode === "shift")}
        onSavePreset={saveFillPreset}
        onDeletePreset={deleteFillPreset}
        onFill={(targetDates, session, hoursPerDate) => {
          const entries: ShiftEntry[] = targetDates
            .filter((d) => !getEntry(quickFillEmployee!.id, d, session))
            .map((d): ShiftEntry => ({
              employeeId: quickFillEmployee!.id,
              date: d,
              shift: session,
              hoursValue: hoursPerDate(d),
            }));
          if (entries.length > 0) batchUpsertShifts(entries);
        }}
        onClose={() => setShowQuickFill(false)}
      />
      {/* 时长模式快速填充（长按姓名） */}
      <QuickFillHoursModal
        visible={showQuickFillHours}
        employee={quickFillEmployee}
        todayStr={todayStr}
        currentMonth={currentMonth}
        colors={colors}
        presets={fillPresets}
        onSavePreset={saveFillPreset}
        onDeletePreset={deleteFillPreset}
        onFill={(targetDates, hours) => {
          // 只改工时，不影响班次；跳过已有工时的格子
          const entries: ShiftEntry[] = targetDates
            .filter((d) => {
              const existing = getEntry(quickFillEmployee!.id, d, editSession);
              return !existing || typeof existing.hoursValue !== "number";
            })
            .map((d): ShiftEntry => {
              const existing = getEntry(quickFillEmployee!.id, d, editSession);
              return {
                employeeId: quickFillEmployee!.id,
                date: d,
                shift: existing?.shift ?? editSession,
                hoursValue: hours,
              };
            });
          if (entries.length > 0) batchUpsertShifts(entries);
        }}
        onClose={() => setShowQuickFillHours(false)}
      />
    </View>
  );
}

// DEPT_OPTIONS_SCH 已废弃，直接使用 DeptCategory 切换

// ─── 主页面 ───────────────────────────────────────────────────────────────────
const PAGES = [
  { key: "roster",   label: "薪资统计", icon: "person.2.fill" },
  { key: "schedule", label: "排班表",   icon: "calendar.badge.clock" },
  { key: "advances", label: "薪资预支", icon: "creditcard.fill" },
];
type PageKey = typeof PAGES[number]["key"];

// 统一选中色为蓝色，与 iOS 主色一致
const PAGE_COLORS: Record<PageKey, string> = {
  schedule: "#1677FF",
  roster:   "#1677FF",
  advances: "#1677FF",
};

export default function LaborScreen({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const { initialPage } = useLocalSearchParams<{ initialPage?: string }>();
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(currentMonthStr());
  const month = currentMonth;
  const [activePage, setActivePage] = useState<PageKey>((initialPage as PageKey) ?? "roster");
  const scrollRef = useRef<ScrollView>(null);

  const handleTabPress = (key: PageKey) => {
    tap();
    setActivePage(key);
    const idx = PAGES.findIndex((p) => p.key === key);
    scrollRef.current?.scrollTo({ x: idx * winW, animated: true });
  };

  const handleScroll = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / winW);
    const key = PAGES[idx]?.key;
    if (key && key !== activePage) setActivePage(key);
  };

  return (
    <ScreenContainer edges={embedded ? [] : ["top", "left", "right"]}>
      {/* 导航栏：嵌入模式下隐藏 */}
      {!embedded && (
        <View style={[S.navbar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          </Pressable>
          <Text style={[S.navTitle, { color: colors.foreground }]}>员工管理</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable onPress={() => { tap(); router.push("/labor-employee-form" as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <IconSymbol name="person.badge.plus" size={22} color={colors.primary} />
            </Pressable>
          </View>
        </View>
      )}

      {/* Tab 切换栏：移到月份导航上方，固定不动 */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.background }}>
        <View style={{ flexDirection: "row", backgroundColor: colors.border + "44", borderRadius: 12, padding: 3 }}>
          {PAGES.map((p) => {
            const active = activePage === p.key;
            return (
              <TouchableOpacity key={p.key} onPress={() => handleTabPress(p.key)}
                style={[{ flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 10 },
                  active && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 }
                ]}>
                <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? colors.foreground : colors.muted }}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 月份导航行（Tab 下方，内容区上方） */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 16, gap: 12 }}>
        <Pressable onPress={() => { tap(); const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }}
          style={({ pressed }) => [{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.border + "55", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="chevron.left" size={15} color={colors.muted} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.foreground, letterSpacing: -0.3 }}>{monthLabel(currentMonth)}</Text>
        <Pressable onPress={() => { tap(); const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }}
          style={({ pressed }) => [{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.border + "55", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="chevron.right" size={15} color={colors.muted} />
        </Pressable>
      </View>

      {/* 横滑内容区（总览卡片 + 各页面内容，整体可横滑切换） */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ flexDirection: "row" }}>
        {/* 第一页：薪资统计（含人力总览卡片） */}
        <View style={{ width: winW, flex: 1 }}>
          <EmployeeRosterPage month={currentMonth} colors={colors}
            headerComponent={<OverviewCard month={currentMonth} colors={colors} />} />
        </View>

        {/* 第二页：排班表（不显示人力总览卡片） */}
        <View style={{ width: winW, flex: 1 }}>
          <SchedulePage colors={colors} month={currentMonth} onMonthChange={setCurrentMonth} />
        </View>

        {/* 第三页：薪资预支（不显示人力总览卡片） */}
        <View style={{ width: winW, flex: 1 }}>
          <AdvancePage month={currentMonth} colors={colors} />
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
  detailLabel: { fontSize: 10, color: "#8E8E93", marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: "600" },
});

const CT = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  panel: { position: "absolute", right: 0, top: 34, borderRadius: 10, borderWidth: 1, zIndex: 100, minWidth: 110, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  option: { paddingHorizontal: 12, paddingVertical: 9 },
});

const CAL_NAME_W = 52;  // 月历表姓名列宽
const CAL_CELL_FLEX = 1; // 月历表日期格平分屏宽


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

// Excel 风格排班表样式
const EXL_NAME_W = 56;  // 姓名列宽

const EXL = StyleSheet.create({
  controlBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  segContainer: { flexDirection: "row", borderRadius: 8, overflow: "hidden", padding: 2 },
  segItem: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  gearBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  weekHeaderRow: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  weekBlock: { borderRadius: 12, overflow: "hidden", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  dateRow: { flexDirection: "row", alignItems: "center" },
  dateCell: { flex: 1, height: 26, alignItems: "center", justifyContent: "center", borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: "rgba(255,255,255,0.3)" },
  dateCellText: { fontSize: 12, fontWeight: "700", color: "#fff" },
  dateLabel: { fontSize: 9, fontWeight: "600", color: "rgba(255,255,255,0.85)" },
  nameCol: { width: EXL_NAME_W, height: 34, alignItems: "center", justifyContent: "center" },
  empRow: { flexDirection: "row", alignItems: "center" },
  cell: { flex: 1, height: 34, alignItems: "center", justifyContent: "center" },
  sessionDivider: { height: 4 },
  // 单元格文字样式
  cellHours: { fontSize: 13, fontWeight: "500", color: "#1C1C1E" },
  cellOT: { color: "#FF4D4F", fontWeight: "700" },
  cellCompOff: { color: "#52C41A", fontWeight: "700" },
  cellRest: { fontSize: 11, color: "#FF4D4F", fontWeight: "500" },
  cellNoMorning: { fontSize: 10, color: "#FF4D4F", fontWeight: "500" },
  cellSession: { fontSize: 12, fontWeight: "500", color: "#3C3C43" },
  otDot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
});
