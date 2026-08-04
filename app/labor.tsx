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
  usePerformanceRecordStore, useHolidayConfigStore,
  useSpecialStatusStore, useGlobalPayrollSettingsStore,
} from "@/lib/labor/store";
import { useSalaryAdvanceStore } from "@/lib/labor/advance-store";
import { usePettyCashStore } from "@/lib/store/petty-store";
import {
  Employee, EmployeeDept, EmployeeGroup, ShiftEntry, ShiftHoursValue, ShiftTemplate,
  SpecialStatus,
  DEPT_COLORS, DEPT_LABELS, EMPLOYEE_TYPE_LABELS, monthLabel,
  getMonthDates, getDayOfWeek, getContractHoursForDate,
  DEFAULT_SHIFT_TEMPLATES, DEFAULT_SPECIAL_STATUSES, SHIFT_COLOR_PRESETS, calcAllowance,
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
  const [showTrend, setShowTrend] = useState(false);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

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
            <Text style={{ fontSize: 10, color: diffSalary > 0 ? "#FF3B30" : "#34C759" }}>
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
          <Text style={[OV.value, { color: totalPending > 0 ? "#FF3B30" : colors.muted }]}>
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
  const { getPaySlip } = usePaySlipStore();
  const { getAttendance } = useAttendanceStore();
  const { templates: shiftTpls } = useShiftTemplateStore();
  const router = useRouter();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [expanded, setExpanded] = useState(false);

  const slip = getPaySlip(employee.id, month);
  const att = getAttendance(employee.id, month);
  const compareSlip = compareMonth ? getPaySlip(employee.id, compareMonth) : null;
  const deptColor = DEPT_COLORS[employee.dept];
  const isParttime = employee.type === "parttime";

  const diffSalary = slip && compareSlip ? slip.finalSalary - compareSlip.finalSalary : null;
  const pending = slip ? Math.max(0, slip.finalSalary - (slip.advanceAmount ?? 0)) : null;
  const attendanceSalary = att?.attendanceSalary ?? (slip?.attendanceSalary ?? 0);

  return (
    <TouchableOpacity activeOpacity={0.85}
      onPress={() => { tap(); setExpanded((v) => !v); }}
      onLongPress={() => { tap(); router.push({ pathname: "/labor-attendance", params: { employeeId: employee.id, month } } as any); }}
      style={[PC.card, { backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: deptColor, borderColor: colors.border }]}>

      {/* 顶部行：姓名 + 应发/待发 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
              {employee.code}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>({employee.realName})</Text>
            {isParttime && (
              <View style={{ backgroundColor: "#FF9500" + "22", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                <Text style={{ fontSize: 9, fontWeight: "700", color: "#FF9500" }}>兼职</Text>
              </View>
            )}
          </View>

        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 10, color: colors.muted }}>应发</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
                {slip ? `¥${slip.finalSalary.toFixed(0)}` : "—"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ fontSize: 10, color: colors.muted }}>待发</Text>
              <Text style={{ fontSize: 15, fontWeight: "700", color: pending && pending > 0 ? "#34C759" : colors.muted }}>
                {pending !== null ? `¥${pending.toFixed(0)}` : "—"}
              </Text>
            </View>
          </View>
          {diffSalary !== null && (
            <Text style={{ fontSize: 10, color: diffSalary > 0 ? "#FF3B30" : "#34C759" }}>
              {diffSalary > 0 ? "▲" : "▼"} ¥{Math.abs(diffSalary).toFixed(0)}
            </Text>
          )}
          {!slip && (
            <View style={{ backgroundColor: "#FF9500" + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ fontSize: 10, fontWeight: "600", color: "#FF9500" }}>待录入</Text>
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
            { label: "绩效奖金", value: slip?.performanceBonus ? `+¥${slip.performanceBonus.toFixed(0)}` : "—", color: slip?.performanceBonus ? "#34C759" : colors.muted },
            { label: "补贴合计", value: (slip && (slip.mealAllowance + slip.transportAllowance + slip.otherAllowance) > 0) ? `+¥${(slip.mealAllowance + slip.transportAllowance + slip.otherAllowance).toFixed(0)}` : "—", color: (slip && (slip.mealAllowance + slip.transportAllowance + slip.otherAllowance) > 0) ? "#007AFF" : colors.muted },
            { label: "奖惩小计", value: slip?.rewardPenalty ? (slip.rewardPenalty > 0 ? `+¥${slip.rewardPenalty.toFixed(0)}` : `-¥${Math.abs(slip.rewardPenalty).toFixed(0)}`) : "—", color: slip?.rewardPenalty ? (slip.rewardPenalty > 0 ? "#34C759" : "#FF3B30") : colors.muted },
            { label: "业绩提点", value: slip?.salesCommission ? `+¥${slip.salesCommission.toFixed(0)}` : "—", color: slip?.salesCommission ? "#007AFF" : colors.muted },
            { label: "预支小计", value: slip?.advanceAmount ? `-¥${slip.advanceAmount.toFixed(0)}` : "—", color: slip?.advanceAmount ? "#FF9500" : colors.muted },
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
                  <Text style={{ fontSize: 11, color: d.deduction > 0 ? "#FF3B30" : d.deduction < 0 ? "#34C759" : colors.muted }}>
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
                  <Text style={{ fontSize: 11, color: "#FF3B30" }}>-¥{slip.socialInsuranceDeduction.toFixed(0)}</Text>
                </View>
              )}
              {slip.housingFundDeduction > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>公积金代扣</Text>
                  <Text style={{ fontSize: 11, color: "#FF3B30" }}>-¥{slip.housingFundDeduction.toFixed(0)}</Text>
                </View>
              )}
              {slip.incomeTax > 0 && (
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>个人所得税</Text>
                  <Text style={{ fontSize: 11, color: "#FF3B30" }}>-¥{slip.incomeTax.toFixed(0)}</Text>
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
          {/* 操作按钮行：绩效设置 + 查看详情 */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <TouchableOpacity onPress={() => { tap(); router.push({ pathname: "/labor-performance", params: { employeeId: employee.id } } as any); }}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: "#34C759" + "15", borderWidth: 1, borderColor: "#34C759" + "44" }}>
              <IconSymbol name="chart.bar.fill" size={12} color="#34C759" />
              <Text style={{ fontSize: 12, color: "#34C759", fontWeight: "600" }}>绩效设置</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { tap(); router.push({ pathname: "/labor-attendance", params: { employeeId: employee.id, month } } as any); }}
              style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "44" }}>
              <IconSymbol name="pencil" size={12} color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>编辑薪资</Text>
            </TouchableOpacity>
          </View>
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
      const activeEmps = employees.filter((e) => e.active);

      const header = ["姓名", "代号", "部门", "类型", "出勤天", "总工时", "加班时", "考勤工资", "绩效", "补贴", "奖惩", "社保", "公积金", "个税", "预支", "应发", "实发"];
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
        ];
      });

      const csvContent = [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const csvWithBOM = "\uFEFF" + csvContent; // UTF-8 BOM for Excel

      const fileName = `薪资表_${month}.csv`;

      // 尝试使用 expo-file-system 导出
      try {
        const FileSystem = require("expo-file-system");
        const Sharing = require("expo-sharing");
        const fileUri = FileSystem.cacheDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, csvWithBOM, { encoding: FileSystem.EncodingType.UTF8 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(fileUri, { mimeType: "text/csv", dialogTitle: `导出${month}薪资表` });
        } else {
          Alert.alert("导出完成", `文件已保存到：${fileUri}`);
        }
      } catch {
        // 降级：直接分享文本
        Alert.alert(`薪资表 ${month}`, csvContent.slice(0, 500) + "...");
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
function AdvancePage({ month, colors }: { month: string; colors: any }) {
  const { employees } = useEmployeeStore();
  const { advances, addAdvance, updateAdvance, deleteAdvance } = useSalaryAdvanceStore();
  const { records: pettyRecords } = usePettyCashStore();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmpId, setAddEmpId] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addNotes, setAddNotes] = useState("");

  // 当月备用金 K1 记录（全部）
  const pettyK1Records = useMemo(() =>
    pettyRecords.filter((r) => r.code === "K1" && r.date.startsWith(month)),
    [pettyRecords, month]
  );

  // 固定兼职卡片：description 含"固定"/"全职"/"长期"的 K1 记录
  const fixedK1Records = useMemo(() =>
    pettyK1Records.filter((r) => {
      const d = (r.description ?? "").toLowerCase();
      return d.includes("固定") || d.includes("全职") || d.includes("长期");
    }),
    [pettyK1Records]
  );

  // 临时兼职卡片：其余 K1 记录
  const tempK1Records = useMemo(() =>
    pettyK1Records.filter((r) => {
      const d = (r.description ?? "").toLowerCase();
      return !(d.includes("固定") || d.includes("全职") || d.includes("长期"));
    }),
    [pettyK1Records]
  );

  // 自动同步：K1 记录全部自动纳入预支统计（智能化）
  const autoSyncedAdvances = useMemo(() => {
    const manual = advances.filter((a) => (a.deductMonth === month || a.date.startsWith(month)) && !a.pettyRecordId);
    const fromK1 = pettyK1Records.map((r) => ({
      id: "k1_" + r.id,
      employeeId: "",
      amount: r.amount,
      date: r.date,
      deductMonth: month,
      notes: r.description || "备用金支付",
      status: "pending" as const,
      paidViaPetty: true,
      pettyRecordId: r.id,
      createdAt: r.date,
      updatedAt: r.date,
    }));
    return [...fromK1, ...manual];
  }, [advances, pettyK1Records, month]);

  const totalAdvance = useMemo(() => autoSyncedAdvances.reduce((s, a) => s + a.amount, 0), [autoSyncedAdvances]);
  const totalFixedK1 = useMemo(() => fixedK1Records.reduce((s, r) => s + r.amount, 0), [fixedK1Records]);
  const totalTempK1 = useMemo(() => tempK1Records.reduce((s, r) => s + r.amount, 0), [tempK1Records]);
  const manualAdvances = useMemo(() => advances.filter((a) => (a.deductMonth === month || a.date.startsWith(month)) && !a.pettyRecordId), [advances, month]);

  const getEmployee = (id: string) => employees.find((e) => e.id === id);
  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);

  const handleAddAdvance = () => {
    if (!addEmpId || !addAmount) return;
    addAdvance({
      employeeId: addEmpId,
      amount: parseFloat(addAmount),
      date: month + "-01",
      deductMonth: month,
      notes: addNotes,
      status: "pending",
      paidViaPetty: false,
    });
    setShowAddModal(false);
    setAddEmpId(""); setAddAmount(""); setAddNotes("");
  };

  // 备用金卡片组件
  const PettyK1Card = ({ title, records, total, color }: { title: string; records: typeof pettyK1Records; total: number; color: string }) => {
    const [collapsed, setCollapsed] = useState(false);
    if (records.length === 0) return null;
    return (
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: color + "44", backgroundColor: color + "08", overflow: "hidden" }}>
        <TouchableOpacity onPress={() => setCollapsed((v) => !v)}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 12 }}>
          <IconSymbol name="bolt.fill" size={14} color={color} />
          <Text style={{ fontSize: 13, fontWeight: "700", color, flex: 1 }}>{title}（{records.length}笔）</Text>
          <Text style={{ fontSize: 13, fontWeight: "700", color }}>¥{total.toFixed(0)}</Text>
          <IconSymbol name={collapsed ? "chevron.right" : "chevron.down"} size={13} color={color} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
        {!collapsed && records.map((r, i) => (
          <View key={r.id} style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
            i > 0 && { borderTopWidth: 0.5, borderTopColor: color + "22" }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>{r.description || "备用金支付"}</Text>
              <Text style={{ fontSize: 10, color: colors.muted }}>{r.date.slice(5)}</Text>
            </View>
            <Text style={{ fontSize: 13, fontWeight: "600", color }}>¥{r.amount.toFixed(0)}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}>
        {/* 紫色汇总卡片 */}
        <View style={{ borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#AF52DE" + "33", backgroundColor: "#AF52DE" + "08" }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#AF52DE" }}>{monthLabel(month)} 薪资预支</Text>
          <Text style={{ fontSize: 28, fontWeight: "800", color: "#AF52DE", marginTop: 4 }}>
            {totalAdvance > 0 ? `¥${totalAdvance.toFixed(0)}` : "¥ —"}
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{autoSyncedAdvances.length} 笔预支记录（含备用金自动同步）</Text>
          {/* vs 对比 */}
          <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "#AF52DE" + "22" }}>
                <Text style={{ fontSize: 11, color: "#AF52DE" }}>固定兼职 ¥{totalFixedK1.toFixed(0)}</Text>
              </View>
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "#FF9500" + "22" }}>
                <Text style={{ fontSize: 11, color: "#FF9500" }}>临时兼职 ¥{totalTempK1.toFixed(0)}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 固定兼职备用金卡片 */}
        <PettyK1Card title="固定兼职 · 备用金 K1" records={fixedK1Records} total={totalFixedK1} color="#AF52DE" />

        {/* 临时兼职备用金卡片 */}
        <PettyK1Card title="临时兼职 · 备用金 K1" records={tempK1Records} total={totalTempK1} color="#FF9500" />

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
              return (
                <TouchableOpacity key={adv.id}
                  onLongPress={() => { tap(); Alert.alert("删除预支", `确认删除 ${emp?.code ?? ""} 的 ¥${adv.amount} 预支记录？`, [
                    { text: "取消", style: "cancel" },
                    { text: "删除", style: "destructive", onPress: () => deleteAdvance(adv.id) }
                  ]); }}
                  style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
                    i > 0 && { borderTopWidth: 0.5, borderTopColor: colors.border }
                  ]}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: deptColor + "22" }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: deptColor }}>{emp?.code.slice(0, 2) ?? "?"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                      {emp?.code ?? "未知员工"} · {adv.date.slice(5)}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{adv.notes || "手动录入"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: "#AF52DE" }}>¥{adv.amount.toFixed(0)}</Text>
                    <TouchableOpacity onPress={() => { tap(); updateAdvance(adv.id, { status: adv.status === "deducted" ? "pending" : "deducted" }); }}
                      style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: adv.status === "deducted" ? "#34C75922" : "#FF950022" }}>
                      <Text style={{ fontSize: 10, fontWeight: "600", color: adv.status === "deducted" ? "#34C759" : "#FF9500" }}>
                        {adv.status === "deducted" ? "已扣除" : "待扣除"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {autoSyncedAdvances.length === 0 && (
          <View style={{ alignItems: "center", padding: 32 }}>
            <IconSymbol name="creditcard.fill" size={48} color={colors.border} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>本月暂无预支记录</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 6, textAlign: "center" }}>备用金 K1 记录自动同步，也可手动新增</Text>
          </View>
        )}

        {/* 新增预支 Modal */}
        <Modal visible={showAddModal} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" }}>
            <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 }}>
              <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground }}>新增预支记录</Text>
              <View>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>员工</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {activeEmployees.map((emp) => (
                      <TouchableOpacity key={emp.id} onPress={() => setAddEmpId(emp.id)}
                        style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10,
                          backgroundColor: addEmpId === emp.id ? "#AF52DE" : colors.border + "44" }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: addEmpId === emp.id ? "#fff" : colors.foreground }}>{emp.code}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
              <View>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 6 }}>预支金额</Text>
                <TextInput value={addAmount} onChangeText={setAddAmount} keyboardType="numeric" placeholder="输入金额"
                  style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, backgroundColor: colors.background }} />
              </View>
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
            </View>
          </View>
        </Modal>
      </ScrollView>

      {/* 右下角悬浮 FAB 按钮 */}
      <TouchableOpacity onPress={() => { tap(); setShowAddModal(true); }}
        style={{ position: "absolute", right: 20, bottom: 20, flexDirection: "row", alignItems: "center", gap: 6,
          paddingHorizontal: 18, paddingVertical: 13, borderRadius: 28, backgroundColor: "#AF52DE",
          shadowColor: "#AF52DE", shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}>
        <IconSymbol name="plus" size={16} color="#fff" />
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>新增预支</Text>
      </TouchableOpacity>
    </View>
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
function SchEditModal({ visible, date, employee, session, sessionColor, existing, contractHours, defaultHours, colors, shiftTemplates, specialStatuses, onSave, onClear, onClose }: {
  visible: boolean; date: string; employee: Employee | null; session: string;
  sessionColor: string; existing: ShiftEntry | null; contractHours: number;
  defaultHours: number; colors: any;
  shiftTemplates: ShiftTemplate[];
  specialStatuses: SpecialStatus[];
  onSave: (e: ShiftEntry) => void; onClear: () => void; onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const DOW = ["日", "一", "二", "三", "四", "五", "六"];
  const dow = date ? getDayOfWeek(date) : 1;
  const [hoursInput, setHoursInput] = useState("");
  const [selectedSpecialId, setSelectedSpecialId] = useState<string | null>(null);
  const [selectedShiftSession, setSelectedShiftSession] = useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      if (existing?.specialStatusId) {
        setSelectedSpecialId(existing.specialStatusId);
        setSelectedShiftSession(null);
        setHoursInput("");
      } else if (existing) {
        setSelectedSpecialId(null);
        setSelectedShiftSession(existing.shift);
        setHoursInput(typeof existing.hoursValue === "number" ? String(existing.hoursValue) : "");
      } else {
        setSelectedSpecialId(null);
        setSelectedShiftSession(session);
        setHoursInput(String(defaultHours));
      }
    }
  }, [visible, existing, session, defaultHours]);

  if (!employee || !date) return null;

  const curH = Number(hoursInput) || 0;
  const isOT = contractHours > 0 && curH > contractHours && !selectedSpecialId;
  const otAmt = isOT ? curH - contractHours : 0;

  const selectedSpecial = selectedSpecialId ? specialStatuses.find((s) => s.id === selectedSpecialId) : null;

  const handleSave = () => {
    if (selectedSpecialId) {
      // 特殊状态
      const ss = specialStatuses.find((s) => s.id === selectedSpecialId);
      onSave({
        employeeId: employee.id, date,
        shift: ss?.name ?? selectedSpecialId,
        hoursValue: ss?.category === "work_day" ? (Number(hoursInput) || defaultHours) : null,
        sessionValue: ss?.name ?? selectedSpecialId,
        specialStatusId: selectedSpecialId,
      });
    } else {
      // 工作班次
      const hv: ShiftHoursValue = hoursInput ? (Number(hoursInput) || null) : null;
      onSave({
        employeeId: employee.id, date,
        shift: selectedShiftSession ?? session,
        hoursValue: hv,
        sessionValue: selectedShiftSession ?? session,
        specialStatusId: undefined,
      });
    }
    onClose();
  };

  const absenceStatuses = specialStatuses.filter((s) => s.category === "absence");
  const workDayStatuses = specialStatuses.filter((s) => s.category === "work_day");
  const compOffStatuses = specialStatuses.filter((s) => s.category === "comp_off");

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <View style={{ alignItems: "center" }}>
            <Text style={[SCHEM.title, { color: colors.foreground }]}>{employee.code}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }}>{date} 周{DOW[dow]}</Text>
          </View>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

          {/* 工作班次区 */}
          <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[SCHEM.label, { color: colors.foreground }]}>工作班次</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {shiftTemplates.map((tpl) => {
                const sel = !selectedSpecialId && selectedShiftSession === tpl.session;
                return (
                  <TouchableOpacity key={tpl.id} onPress={() => { tap(); setSelectedShiftSession(tpl.session); setSelectedSpecialId(null); if (!hoursInput) setHoursInput(String(tpl.defaultHours)); }}
                    style={[SCHEM.chip, { backgroundColor: sel ? tpl.color : colors.surface, borderColor: tpl.color }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sel ? "#fff" : tpl.color }} />
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : tpl.color }}>{tpl.session}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!selectedSpecialId && (
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 }}>
                <TextInput value={hoursInput} onChangeText={setHoursInput}
                  placeholder={`工时 ${defaultHours}h`} placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                  style={[SCHEM.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                <Text style={{ color: colors.muted }}>h</Text>
                {contractHours > 0 && <Text style={{ fontSize: 11, color: isOT ? "#FF9500" : colors.muted }}>合同 {contractHours}h{isOT ? ` · 加班+${otAmt.toFixed(1)}h` : ""}</Text>}
              </View>
            )}
          </View>

          {/* 特殊状态区（缺席类） */}
          {absenceStatuses.length > 0 && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[SCHEM.label, { color: colors.foreground }]}>特殊状态</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {absenceStatuses.map((ss) => {
                  const sel = selectedSpecialId === ss.id;
                  return (
                    <TouchableOpacity key={ss.id} onPress={() => { tap(); setSelectedSpecialId(sel ? null : ss.id); setSelectedShiftSession(null); setHoursInput(""); }}
                      style={[SCHEM.chip, { backgroundColor: sel ? ss.color : colors.surface, borderColor: ss.color }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : ss.color }}>
                        {ss.name}{ss.salaryMultiplier !== 1 ? ` ${ss.salaryMultiplier}x` : ""}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {workDayStatuses.map((ss) => {
                  const sel = selectedSpecialId === ss.id;
                  return (
                    <TouchableOpacity key={ss.id} onPress={() => { tap(); setSelectedSpecialId(sel ? null : ss.id); setSelectedShiftSession(null); }}
                      style={[SCHEM.chip, { backgroundColor: sel ? ss.color : colors.surface, borderColor: ss.color }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : ss.color }}>
                        {ss.name} {ss.salaryMultiplier}x
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {selectedSpecial?.category === "work_day" && (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 10 }}>
                  <TextInput value={hoursInput} onChangeText={setHoursInput}
                    placeholder={`工时 ${defaultHours}h`} placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                    style={[SCHEM.input, { color: colors.foreground, borderColor: selectedSpecial.color, flex: 1 }]} />
                  <Text style={{ color: colors.muted }}>h</Text>
                </View>
              )}
              {selectedSpecial && (
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                  {selectedSpecial.category === "absence"
                    ? selectedSpecial.salaryMultiplier === 0 ? "不扣薪"
                      : selectedSpecial.salaryMultiplier <= 1 ? `扣除 ${selectedSpecial.salaryMultiplier} 天日薪`
                      : `额外惩罚 ${selectedSpecial.salaryMultiplier - 1} 天日薪`
                    : `当天薪资 × ${selectedSpecial.salaryMultiplier}`
                  }
                </Text>
              )}
            </View>
          )}

          {/* 加班换休区 */}
          {compOffStatuses.length > 0 && (
            <View style={[SCHEM.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[SCHEM.label, { color: colors.foreground }]}>加班换休</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {compOffStatuses.map((ss) => {
                  const sel = selectedSpecialId === ss.id;
                  return (
                    <TouchableOpacity key={ss.id} onPress={() => { tap(); setSelectedSpecialId(sel ? null : ss.id); setSelectedShiftSession(null); setHoursInput(""); }}
                      style={[SCHEM.chip, { backgroundColor: sel ? ss.color : colors.surface, borderColor: ss.color }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: sel ? "#fff" : ss.color }}>{ss.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>不扣薪，从当月累积加班时数里扣除对应小时</Text>
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

// ─── 排班设置 Modal（班次 + 特殊状态两个 Tab） ─────────────────────────────────────────────────────────────────────────────
function SchTemplateModal({ visible, templates, specialStatuses, colors, onSaveShift, onDeleteShift, onSaveStatus, onDeleteStatus, onClose }: {
  visible: boolean; templates: ShiftTemplate[]; specialStatuses: SpecialStatus[]; colors: any;
  onSaveShift: (t: ShiftTemplate) => void; onDeleteShift: (id: string) => void;
  onSaveStatus: (s: SpecialStatus) => void; onDeleteStatus: (id: string) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [activeTab, setActiveTab] = useState<"shifts" | "statuses">("shifts");
  const [localShifts, setLocalShifts] = useState<ShiftTemplate[]>([]);
  const [localStatuses, setLocalStatuses] = useState<SpecialStatus[]>([]);
  React.useEffect(() => {
    if (visible) {
      setLocalShifts([...templates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
      setLocalStatuses([...specialStatuses].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    }
  }, [visible, templates, specialStatuses]);
  const updShift = (id: string, p: Partial<ShiftTemplate>) => setLocalShifts((prev) => prev.map((t) => t.id === id ? { ...t, ...p } : t));
  const addNewShift = () => { tap(); setLocalShifts((prev) => [...prev, { id: `tpl_${Date.now()}`, session: "新班次", startTime: "09:00", endTime: "18:00", defaultHours: 8, color: SHIFT_COLOR_PRESETS[prev.length % SHIFT_COLOR_PRESETS.length], sortOrder: prev.length }]); };
  const removeShift = (id: string) => { tap(); Alert.alert("删除班次", "删除后该班次历史排班记录不受影响。", [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => setLocalShifts((prev) => prev.filter((t) => t.id !== id)) }]); };
  const updStatus = (id: string, p: Partial<SpecialStatus>) => setLocalStatuses((prev) => prev.map((s) => s.id === id ? { ...s, ...p } : s));
  const addNewStatus = () => { tap(); setLocalStatuses((prev) => [...prev, { id: `ss_${Date.now()}`, name: "自定义", category: "absence" as const, salaryMultiplier: 1, color: SHIFT_COLOR_PRESETS[prev.length % SHIFT_COLOR_PRESETS.length], sortOrder: prev.length }]); };
  const removeStatus = (id: string) => { const t = localStatuses.find((s) => s.id === id); if (t?.isBuiltin) { Alert.alert("内置状态", "内置状态不可删除，但可修改名称和倍率。"); return; } tap(); Alert.alert("删除状态", "确认删除？", [{ text: "取消", style: "cancel" }, { text: "删除", style: "destructive", onPress: () => setLocalStatuses((prev) => prev.filter((s) => s.id !== id)) }]); };
  const handleSave = () => {
    const eShiftIds = templates.map((t) => t.id); const lShiftIds = localShifts.map((t) => t.id);
    eShiftIds.filter((id) => !lShiftIds.includes(id)).forEach((id) => onDeleteShift(id));
    localShifts.forEach((t, i) => onSaveShift({ ...t, sortOrder: i }));
    const eStatusIds = specialStatuses.map((s) => s.id); const lStatusIds = localStatuses.map((s) => s.id);
    eStatusIds.filter((id) => !lStatusIds.includes(id)).forEach((id) => onDeleteStatus(id));
    localStatuses.forEach((s, i) => onSaveStatus({ ...s, sortOrder: i }));
    onClose();
  };
  const CATEGORY_LABELS: Record<string, string> = { absence: "缺席类", work_day: "工作日类", comp_off: "加班换休" };
  const MULTIPLIER_PRESETS = [0, 0.5, 1, 1.5, 2, 3];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[SCHEM.sheet, { backgroundColor: colors.background }]}>
        <View style={[SCHEM.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
          <Text style={[SCHEM.title, { color: colors.foreground }]}>排班设置</Text>
          <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
        </View>
        <View style={{ flexDirection: "row", marginHorizontal: 16, marginVertical: 8, backgroundColor: colors.border + "44", borderRadius: 10, padding: 2 }}>
          {(["shifts", "statuses"] as const).map((tab) => (
            <TouchableOpacity key={tab} onPress={() => { tap(); setActiveTab(tab); }}
              style={{ flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center", backgroundColor: activeTab === tab ? colors.surface : "transparent" }}>
              <Text style={{ fontSize: 13, fontWeight: activeTab === tab ? "700" : "400", color: activeTab === tab ? "#1C1C1E" : colors.muted }}>{tab === "shifts" ? "工作班次" : "特殊状态"}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {activeTab === "shifts" ? (
            <>
              {localShifts.map((tpl) => (
                <View key={tpl.id} style={{ backgroundColor: tpl.color + "10", borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: tpl.color + "44" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tpl.color }} />
                    <TextInput value={tpl.session} onChangeText={(v) => updShift(tpl.id, { session: v })} placeholder="班次名称" placeholderTextColor={colors.muted} style={{ flex: 1, fontSize: 15, fontWeight: "700", color: tpl.color, paddingVertical: 2 }} />
                    <TouchableOpacity onPress={() => removeShift(tpl.id)} style={{ padding: 4 }}><IconSymbol name="trash" size={16} color={colors.error} /></TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}><Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>开始</Text><TextInput value={tpl.startTime} onChangeText={(v) => updShift(tpl.id, { startTime: v })} placeholder="10:30" placeholderTextColor={colors.muted} style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} /></View>
                    <View style={{ flex: 1 }}><Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>结束</Text><TextInput value={tpl.endTime} onChangeText={(v) => updShift(tpl.id, { endTime: v })} placeholder="17:00" placeholderTextColor={colors.muted} style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} /></View>
                    <View style={{ flex: 1 }}><Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>默认工时</Text><TextInput value={String(tpl.defaultHours)} onChangeText={(v) => updShift(tpl.id, { defaultHours: Number(v) || tpl.defaultHours })} keyboardType="decimal-pad" style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: tpl.color, width: "100%" }]} /></View>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{SHIFT_COLOR_PRESETS.map((c) => (<TouchableOpacity key={c} onPress={() => { tap(); updShift(tpl.id, { color: c }); }} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c, borderWidth: tpl.color === c ? 3 : 1, borderColor: tpl.color === c ? colors.foreground : c + "44" }} />))}</View>
                </View>
              ))}
              <TouchableOpacity onPress={addNewShift} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.primary + "66" }}>
                <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>添加班次</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {localStatuses.map((ss) => (
                <View key={ss.id} style={{ backgroundColor: ss.color + "10", borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: ss.color + "44" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ss.color }} />
                    <TextInput value={ss.name} onChangeText={(v) => updStatus(ss.id, { name: v })} placeholder="状态名称" placeholderTextColor={colors.muted} style={{ flex: 1, fontSize: 15, fontWeight: "700", color: ss.color, paddingVertical: 2 }} />
                    <TouchableOpacity onPress={() => removeStatus(ss.id)} style={{ padding: 4 }}><IconSymbol name="trash" size={16} color={ss.isBuiltin ? colors.muted : colors.error} /></TouchableOpacity>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {(["absence", "work_day", "comp_off"] as const).map((cat) => (
                      <TouchableOpacity key={cat} onPress={() => updStatus(ss.id, { category: cat })}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, backgroundColor: ss.category === cat ? ss.color : colors.surface, borderColor: ss.category === cat ? ss.color : colors.border }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: ss.category === cat ? "#fff" : colors.muted }}>{CATEGORY_LABELS[cat]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {ss.category !== "comp_off" && (
                    <View>
                      <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 6 }}>薪资倍率：{ss.salaryMultiplier}x</Text>
                      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                        {MULTIPLIER_PRESETS.map((m) => (
                          <TouchableOpacity key={m} onPress={() => updStatus(ss.id, { salaryMultiplier: m })}
                            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, backgroundColor: ss.salaryMultiplier === m ? ss.color : colors.surface, borderColor: ss.salaryMultiplier === m ? ss.color : colors.border }}>
                            <Text style={{ fontSize: 12, color: ss.salaryMultiplier === m ? "#fff" : colors.muted }}>{m}x</Text>
                          </TouchableOpacity>
                        ))}
                        <TextInput value={MULTIPLIER_PRESETS.includes(ss.salaryMultiplier) ? "" : String(ss.salaryMultiplier)} onChangeText={(v) => updStatus(ss.id, { salaryMultiplier: Number(v) || ss.salaryMultiplier })} placeholder="自定义" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={[SCHEM.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 60 }]} />
                      </View>
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>{ss.category === "absence" ? (ss.salaryMultiplier === 0 ? "不扣薪" : ss.salaryMultiplier <= 1 ? `扣除 ${ss.salaryMultiplier} 天日薪` : `额外惩罚 ${ss.salaryMultiplier - 1} 天日薪`) : `当天薪资 × ${ss.salaryMultiplier}`}</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{SHIFT_COLOR_PRESETS.map((c) => (<TouchableOpacity key={c} onPress={() => { tap(); updStatus(ss.id, { color: c }); }} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c, borderWidth: ss.color === c ? 3 : 1, borderColor: ss.color === c ? colors.foreground : c + "44" }} />))}</View>
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
  const { shifts, upsertShift, batchUpsertShifts, deleteShift, getShifts } = useShiftStore();
  const { templates, upsertTemplate, deleteTemplate } = useShiftTemplateStore();
  const { statuses: specialStatuses, upsertStatus, deleteStatus } = useSpecialStatusStore();
  const { getPaySlip, upsertPaySlip, buildPaySlipDraft } = usePaySlipStore();
  const { getAttendance, upsertAttendance, calcFromShifts } = useAttendanceStore();
  const { getRecord: getPerfRecord } = usePerformanceRecordStore();
  const { getHolidayForDate } = useHolidayConfigStore();
  const { advances } = useSalaryAdvanceStore();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const currentMonth = month;
  const [dept, setDept] = useState<EmployeeDept>("front");
  // 班次/时长切换
  const [viewMode, setViewMode] = useState<"session" | "hours">("hours");
  const [showTplModal, setShowTplModal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);
  const [editModal, setEditModal] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [editSession, setEditSession] = useState<string>("晚班");

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
    Alert.alert(`快速填充 ${emp.code}`, `将本月所有工作日（周一~周五）填入 ${dh}h，已有数据不覆盖。`,
      [{ text: "取消", style: "cancel" },
       { text: "工作日", onPress: () => { const es = dates.filter((d) => { const dow = getDayOfWeek(d); return dow !== 0 && dow !== 6; }).filter((d) => !getEntry(emp.id, d, session)).map((d): ShiftEntry => ({ employeeId: emp.id, date: d, shift: session, hoursValue: dh, sessionValue: session, overtimeType: "pay" })); if (es.length > 0) batchUpsertShifts(es); } },
       { text: "全月", onPress: () => { const es = dates.filter((d) => !getEntry(emp.id, d, session)).map((d): ShiftEntry => ({ employeeId: emp.id, date: d, shift: session, hoursValue: dh, sessionValue: session, overtimeType: "pay" })); if (es.length > 0) batchUpsertShifts(es); } }]
    );
  };

  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };

  const editTpl = sortedTemplates.find((t) => t.session === editSession) ?? sortedTemplates[0] ?? DEFAULT_SHIFT_TEMPLATES[0];
  const editContractH = editEmployee && editDate ? getContractHoursForDate(editEmployee, editDate) : 0;

  // 周标题（周一开头）
  const WEEK_HEADERS = ["周一 Monday", "周二 Tuesday", "周三 Wednesday", "周四 Thursday", "周五 Friday", "周六 Saturday", "周日 Sunday"];
  const WEEK_SHORT = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  // 单元格内容：班次模式显示班次名，时长模式显示工时数字
  // 数字统一深灰色，加班红色标注，调休维色标注
  const renderCellContent = (entry: ShiftEntry | null, session: string, contractH: number) => {
    if (!entry) return null;
    const h = entry.hoursValue;
    // 休假/无早：红色，两种模式都显示
    if (h === "休") return <Text style={EXL.cellRest}>(休)</Text>;
    if (h === "无早") return <Text style={EXL.cellNoMorning}>(无早)</Text>;
    if (viewMode === "session") {
      // 班次模式：显示班次名称第一个字（如「午」「晚」）
      const label = session.slice(0, 1);
      return <Text style={EXL.cellSession}>{label}</Text>;
    }
    // 时长模式：显示工时数字
    if (typeof h === "number" && h > 0) {
      return <Text style={EXL.cellHours}>{h % 1 === 0 ? `${h}.0` : `${h}`}</Text>;
    }
    return null;
  };

  // 每周区块：日期行 + 各班次员工行
  const renderWeekBlock = (week: { dateStr: string; isCurrentMonth: boolean }[], weekIdx: number) => {
    // iOS 日历配色方案
    // 日期行背景：深蓝灰 #2C3550（类似 iOS 日历表头）
    const DATE_ROW_BG = "#2C3550";
    // 今天：蓝色圆圈（iOS 标志色 #007AFF）
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
                isToday && { backgroundColor: "#007AFF", borderRadius: 4, margin: 2 }
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

        {/* 各班次员工行（无多余细线） */}
        {sortedTemplates.map((tpl, tplIdx) => {
          const empList = employeesBySession[tpl.session] ?? [];
          if (empList.length === 0) return null;
          return (
            <View key={tpl.session}>
              {tplIdx > 0 && <View style={{ height: 6, backgroundColor: colors.border + "44" }} />}
              {empList.map((emp, empIdx) => {
                const isLast = empIdx === empList.length - 1;
                return (
                  <View key={emp.id} style={[EXL.empRow,
                    !isLast && { borderBottomColor: colors.border + "33", borderBottomWidth: StyleSheet.hairlineWidth }
                  ]}>
                    {/* 班次色左竖条 */}
                    <View style={{ width: 3, height: 34, backgroundColor: tpl.color + "CC" }} />
                    <TouchableOpacity onLongPress={() => handleFillRow(emp, tpl.session)}
                      style={[EXL.nameCol, { backgroundColor: "transparent", width: EXL_NAME_W - 3 }]}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>{emp.code}</Text>
                    </TouchableOpacity>
                    {week.map(({ dateStr, isCurrentMonth }, di) => {
                      const entry = getEntry(emp.id, dateStr, tpl.session);
                      const contractH = getContractHoursForDate(emp, dateStr);
                      const isToday = dateStr === todayStr;
                      return (
                        <TouchableOpacity key={di}
                          onPress={() => isCurrentMonth && handleCellPress(emp, dateStr, tpl.session)}
                          style={[EXL.cell,
                            isToday && { backgroundColor: "#007AFF" + "15" },
                            !isCurrentMonth && { backgroundColor: colors.border + "18" }
                          ]}>
                          {isCurrentMonth ? renderCellContent(entry, tpl.session, contractH) : null}
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
  const deptAccent = dept === "front" ? "#34C759" : "#FF9500";

  return (
    <View style={{ flex: 1 }}>
      {/* 控制栏：前厅/后厨 + 班次/时长 + 齿轮 */}
      <View style={[EXL.controlBar, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        {/* 前厅/后厨 — 选中色统一为黑色 */}
        <View style={[EXL.segContainer, { backgroundColor: colors.border + "44" }]}>
          {DEPT_OPTIONS_SCH.map((d) => (
            <TouchableOpacity key={d} onPress={() => { tap(); setDept(d); }}
              style={[EXL.segItem, dept === d && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 }]}>
              <Text style={{ fontSize: 12, fontWeight: dept === d ? "700" : "400", color: dept === d ? "#1C1C1E" : colors.muted }}>{DEPT_LABELS[d]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* 班次/时长切换 — 选中色统一为黑色 */}
        <View style={[EXL.segContainer, { backgroundColor: colors.border + "44" }]}>
          {(["session", "hours"] as const).map((mode) => (
            <TouchableOpacity key={mode} onPress={() => { tap(); setViewMode(mode); }}
              style={[EXL.segItem, viewMode === mode && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 }]}>
              <Text style={{ fontSize: 12, fontWeight: viewMode === mode ? "700" : "400", color: viewMode === mode ? "#1C1C1E" : colors.muted }}>
                {mode === "session" ? "班次" : "时长"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* 班次设置 */}
        <Pressable onPress={() => { tap(); setShowTplModal(true); }} style={[EXL.gearBtn, { backgroundColor: colors.border + "44" }]}>
          <IconSymbol name="gearshape.fill" size={16} color={colors.muted} />
        </Pressable>
        {/* 一键生成薪资单 */}
        <TouchableOpacity
          onPress={() => {
            tap();
            Alert.alert(
              "一键生成薪资单",
              `将根据 ${monthLabel(currentMonth)} 排班表工时，自动计算所有在职员工的：\n• 出勤天数 / 总工时 / 加班时长\n• 考勤工资（包含加班费）\n• 补贴（饥补×出勤天数、交通补贴）\n• 绩效（已录入的绩效记录）\n\n已有薪资单的员工将被更新，手动修改的内容保留。`,
              [
                { text: "取消", style: "cancel" },
                {
                  text: "确认生成",
                  onPress: async () => {
                    setGenerating(true);
                    try {
                      const activeEmps = employees.filter((e) => e.active);
                      let count = 0;
                      for (const emp of activeEmps) {
                        const empShifts = getShifts(currentMonth).filter((s) => s.employeeId === emp.id);
                        if (empShifts.length === 0) continue;
                        // 1. 计算出勤记录
                        const holidayDaysList = empShifts
                          .map((s) => {
                            const hc = getHolidayForDate(s.date, emp.id);
                            return hc ? { date: s.date, multiplier: hc.multiplier } : null;
                          })
                          .filter((x): x is { date: string; multiplier: number } => x !== null);
                        const att = calcFromShifts(emp.id, currentMonth, emp, empShifts, specialStatuses, holidayDaysList);
                        upsertAttendance(att);
                        // 2. 计算绩效总额
                        const perfRecord = getPerfRecord(emp.id, currentMonth);
                        const performanceTotal = perfRecord?.totalPerformance ?? 0;
                        // 3. 计算预支总额
                        const advanceTotal = advances
                          .filter((a) => a.employeeId === emp.id && (a.deductMonth === currentMonth || a.date.startsWith(currentMonth)))
                          .reduce((s, a) => s + a.amount, 0);
                        // 4. 生成薪资单
                        const slip = buildPaySlipDraft(emp, currentMonth, att, performanceTotal, advanceTotal);
                        upsertPaySlip(slip);
                        count++;
                      }
                      setGenResult(`✅ 已生成 ${count} 人薪资单`);
                      setTimeout(() => setGenResult(null), 4000);
                    } catch (e) {
                      setGenResult("❌ 生成失败，请重试");
                      setTimeout(() => setGenResult(null), 3000);
                    } finally {
                      setGenerating(false);
                    }
                  }
                }
              ]
            );
          }}
          style={[EXL.gearBtn, { backgroundColor: "#34C759" + "22", width: "auto", paddingHorizontal: 10 }]}>
          {generating
            ? <Text style={{ fontSize: 11, fontWeight: "700", color: "#34C759" }}>计算中...</Text>
            : <Text style={{ fontSize: 11, fontWeight: "700", color: "#34C759" }}>生成薪资单</Text>
          }
        </TouchableOpacity>
      </View>

      {/* 生成结果提示 */}
      {genResult && (
        <View style={{ backgroundColor: "#34C759" + "15", paddingHorizontal: 16, paddingVertical: 6 }}>
          <Text style={{ fontSize: 12, color: "#34C759", fontWeight: "600", textAlign: "center" }}>{genResult}</Text>
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
      <Text style={{ fontSize: 9, color: colors.muted, paddingHorizontal: 12, paddingBottom: 2 }}>长按姓名快速填充</Text>

      {/* 排班表主体 */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 8, gap: 10, paddingBottom: 40 }}>
        {calendarWeeks.map((week, wi) => renderWeekBlock(week, wi))}
      </ScrollView>

      <SchEditModal
        visible={editModal} date={editDate} employee={editEmployee}
        session={editSession} sessionColor={editTpl?.color ?? "#5856D6"}
        existing={editEmployee && editDate ? getEntry(editEmployee.id, editDate, editSession) : null}
        contractHours={editContractH} defaultHours={editTpl?.defaultHours ?? 8}
        colors={colors}
        shiftTemplates={sortedTemplates}
        specialStatuses={specialStatuses}
        onSave={(entry) => upsertShift(entry)}
        onClear={() => { if (editEmployee && editDate) deleteShift(editEmployee.id, editDate, editSession); }}
        onClose={() => setEditModal(false)}
      />
      <SchTemplateModal
        visible={showTplModal} templates={sortedTemplates} specialStatuses={specialStatuses} colors={colors}
        onSaveShift={upsertTemplate} onDeleteShift={deleteTemplate}
        onSaveStatus={upsertStatus} onDeleteStatus={deleteStatus}
        onClose={() => setShowTplModal(false)}
      />
    </View>
  );
}

const DEPT_OPTIONS_SCH: EmployeeDept[] = ["front", "kitchen"];

// ─── 主页面 ───────────────────────────────────────────────────────────────────
const PAGES = [
  { key: "schedule", label: "排班表",   icon: "calendar.badge.clock" },
  { key: "roster",   label: "薪资统计", icon: "person.2.fill" },
  { key: "advances", label: "薪资预支", icon: "creditcard.fill" },
];
type PageKey = typeof PAGES[number]["key"];

// 统一选中色为蓝色，与 iOS 主色一致
const PAGE_COLORS: Record<PageKey, string> = {
  schedule: "#007AFF",
  roster:   "#007AFF",
  advances: "#007AFF",
};

export default function LaborScreen({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(currentMonthStr());
  const month = currentMonth;
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
            <Pressable onPress={() => { tap(); router.push("/labor-schedule" as any); }} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <IconSymbol name="calendar.badge.clock" size={22} color={colors.muted} />
            </Pressable>
          </View>
        </View>
      )}

      {/* 月份导航行 + 对比开关（单一行，不重复） */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 16, gap: 12 }}>
        <Pressable onPress={() => { tap(); const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m - 2, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }}
          style={({ pressed }) => [{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.border + "55", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="chevron.left" size={15} color="#3C3C43" />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: "600", color: colors.foreground, letterSpacing: -0.3 }}>{monthLabel(currentMonth)}</Text>
        <Pressable onPress={() => { tap(); const [y, m] = currentMonth.split("-").map(Number); const d = new Date(y, m, 1); setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }}
          style={({ pressed }) => [{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.border + "55", alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 }]}>
          <IconSymbol name="chevron.right" size={15} color="#3C3C43" />
        </Pressable>
      </View>

      {/* 总览卡片（含对比开关） */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
        <OverviewCard month={currentMonth} colors={colors} />
      </View>

      {/* Tab 切换栏：胶囊样式，固定不动 */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.background }}>
        <View style={{ flexDirection: "row", backgroundColor: colors.border + "44", borderRadius: 12, padding: 3 }}>
          {PAGES.map((p) => {
            const active = activePage === p.key;
            return (
              <TouchableOpacity key={p.key} onPress={() => handleTabPress(p.key)}
                style={[{ flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 10 },
                  active && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 }
                ]}>
                <Text style={{ fontSize: 13, fontWeight: active ? "700" : "400", color: active ? "#1C1C1E" : colors.muted }}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
          <SchedulePage colors={colors} month={currentMonth} onMonthChange={setCurrentMonth} />
        </View>

        {/* 第二页：员工档案（含对比开关） */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
          <EmployeeRosterPage month={currentMonth} colors={colors} />
        </View>

        {/* 第三页：薪资预支 */}
        <View style={{ width: SCREEN_W, flex: 1 }}>
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
  detailLabel: { fontSize: 10, color: "#999", marginBottom: 2 },
  detailValue: { fontSize: 13, fontWeight: "600" },
});

const CT = StyleSheet.create({
  btn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  panel: { position: "absolute", right: 0, top: 34, borderRadius: 10, borderWidth: 1, zIndex: 100, minWidth: 110, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
  option: { paddingHorizontal: 12, paddingVertical: 9 },
});

const CAL_NAME_W = 52;  // 月历表姓名列宽
const CAL_CELL_FLEX = 1; // 月历表日期格平分屏宽

const SCH = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  segBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  sessionHeader: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 4, borderLeftWidth: 3, marginBottom: 2 },
  // 月历格式
  calHeaderRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, marginBottom: 1 },
  calNameHeader: { width: CAL_NAME_W, height: 24, alignItems: "center", justifyContent: "center" },
  calDayHeader: { flex: CAL_CELL_FLEX, height: 24, alignItems: "center", justifyContent: "center" },
  calWeekRow: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 42 },
  calNameCell: { width: CAL_NAME_W, justifyContent: "center", alignItems: "center", borderRightWidth: 1, paddingVertical: 4 },
  calCell: { flex: CAL_CELL_FLEX, alignItems: "center", justifyContent: "center", paddingVertical: 3, borderWidth: StyleSheet.hairlineWidth, minHeight: 42 },
  // 保留旧字段（其他页面可能引用）
  headerRow: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  headerCell: { height: SCH_ROW_H, alignItems: "center", justifyContent: "center", gap: 1, borderRightWidth: StyleSheet.hairlineWidth },
  empRow: { flexDirection: "row", alignItems: "center" },
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
  cellOT: { color: "#FF3B30", fontWeight: "700" },
  cellCompOff: { color: "#34C759", fontWeight: "700" },
  cellRest: { fontSize: 11, color: "#FF3B30", fontWeight: "500" },
  cellNoMorning: { fontSize: 10, color: "#FF3B30", fontWeight: "500" },
  cellSession: { fontSize: 12, fontWeight: "500", color: "#3C3C43" },
  otDot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
});
