/**
 * 考勤工资 + 最终薪资汇总页
 * - 月份选择
 * - 考勤工资计算（底薪+加班+少休扣款+节假日补偿）
 * - 最终薪资汇总（绩效/提点/补贴/奖惩/备注）
 * - 按部门分组展示（前厅/后厨/兼职）
 * - 参考截图：考勤工资表 + 薪资汇总表
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, useShiftStore, useAttendanceStore, usePaySlipStore
} from "@/lib/labor/store";
import {
  Employee, MonthlyAttendance, PaySlip, DEPT_LABELS, DEPT_COLORS,
  calcDailyRate, calcAttendanceSalary, calcFinalSalary,
  getDaysInMonth, parseMonth, monthLabel, getMonthDates
} from "@/lib/labor/types";

type ViewTab = "attendance" | "payslip";
type CompareMode = "none" | "lastMonth" | "lastYear";

// ─── 考勤工资编辑 Modal ───────────────────────────────────────────────────────
function AttendanceEditModal({
  visible, employee, month, existing, colors, onSave, onClose
}: {
  visible: boolean;
  employee: Employee | null;
  month: string;
  existing: MonthlyAttendance | null;
  colors: any;
  onSave: (record: MonthlyAttendance) => void;
  onClose: () => void;
}) {
  const { year, month: m } = parseMonth(month);
  const daysInMonth = getDaysInMonth(year, m);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const [attendanceDays, setAttendanceDays] = useState(String(existing?.attendanceDays ?? ""));
  const [totalHours, setTotalHours] = useState(String(existing?.totalHours ?? ""));
  const [overtimeHours, setOvertimeHours] = useState(String(existing?.overtimeHours ?? ""));
  const [underRestDays, setUnderRestDays] = useState(String(existing?.underRestDays ?? "0"));
  const [holidayDays, setHolidayDays] = useState(String(existing?.holidayDays ?? "0"));
  const [dailyRateInput, setDailyRateInput] = useState(String(existing?.dailyRate ?? ""));
  const [dailyRateOverride, setDailyRateOverride] = useState(existing?.dailyRateOverride ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");

  if (!employee) return null;

  const autoDailyRate = calcDailyRate(employee.baseSalary, daysInMonth, employee.restDaysPerMonth);
  const effectiveDailyRate = dailyRateOverride ? Number(dailyRateInput) : autoDailyRate;

  // 实时计算
  const calc = useMemo(() => {
    return calcAttendanceSalary({
      type: employee.type,
      baseSalary: employee.baseSalary,
      dailyRate: effectiveDailyRate,
      totalHours: Number(totalHours) || 0,
      stdHoursPerDay: employee.stdHoursPerDay,
      attendanceDays: Number(attendanceDays) || 0,
      overtimeHourlyRate: employee.overtimeHourlyRate,
      underRestDays: Number(underRestDays) || 0,
      holidayDays: Number(holidayDays) || 0,
      holidayMultiplier: employee.holidayMultiplier,
    });
  }, [employee, effectiveDailyRate, totalHours, attendanceDays, underRestDays, holidayDays]);

  const handleSave = () => {
    if (!attendanceDays) { Alert.alert("请填写出勤天数"); return; }
    const record: MonthlyAttendance = {
      id: existing?.id ?? (Math.random().toString(36).slice(2) + Date.now().toString(36)),
      employeeId: employee.id,
      month,
      daysInMonth,
      attendanceDays: Number(attendanceDays) || 0,
      totalHours: Number(totalHours) || 0,
      stdHours: (Number(attendanceDays) || 0) * employee.stdHoursPerDay,
      overtimeHours: calc.overtimeHours,
      compOffHours: existing?.compOffHours ?? 0,
      paidOvertimeHours: calc.overtimeHours,
      underRestDays: Number(underRestDays) || 0,
      holidayDays: Number(holidayDays) || 0,
      dailyRate: effectiveDailyRate,
      dailyRateOverride,
      overtimePay: calc.overtimePay,
      underRestDeduction: calc.underRestDeduction,
      holidayBonus: calc.holidayBonus,
      attendanceSalary: calc.attendanceSalary,
      notes,
    };
    onSave(record);
    onClose();
  };

  const deptColor = DEPT_COLORS[employee.dept];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[AM.sheet, { backgroundColor: colors.background }]}>
          <View style={[AM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[AM.title, { color: colors.foreground }]}>{employee.code} 考勤工资</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{monthLabel(month)}</Text>
            </View>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: deptColor }}>保存</Text></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* 员工信息 */}
            <View style={[AM.infoCard, { backgroundColor: deptColor + "0e", borderColor: deptColor + "33" }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>{employee.code} · {employee.realName}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                {DEPT_LABELS[employee.dept]} · {employee.type === "fulltime" ? "全职" : "兼职"} ·
                底薪¥{employee.baseSalary} · 时薪¥{employee.hourlyRate}/h
              </Text>
            </View>

            {/* 日薪设置 */}
            {employee.type === "fulltime" && (
              <View style={[AM.section, { borderColor: colors.border }]}>
                <Text style={[AM.sectionTitle, { color: colors.muted }]}>日薪</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={[AM.autoTag, { backgroundColor: colors.primary + "15" }]}>
                    <Text style={{ fontSize: 11, color: colors.primary }}>
                      自动：¥{autoDailyRate.toFixed(2)}/天
                    </Text>
                    <Text style={{ fontSize: 10, color: colors.muted }}>
                      ¥{employee.baseSalary} ÷ ({daysInMonth}-{employee.restDaysPerMonth}休)
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => { tap(); setDailyRateOverride(!dailyRateOverride); }}
                    style={[AM.overrideBtn, { borderColor: dailyRateOverride ? colors.warning : colors.border }]}>
                    <Text style={{ fontSize: 12, color: dailyRateOverride ? colors.warning : colors.muted }}>
                      {dailyRateOverride ? "手动" : "自动"}
                    </Text>
                  </TouchableOpacity>
                  {dailyRateOverride && (
                    <TextInput value={dailyRateInput} onChangeText={setDailyRateInput}
                      placeholder={String(autoDailyRate.toFixed(2))} placeholderTextColor={colors.muted}
                      keyboardType="decimal-pad"
                      style={[AM.inputSmall, { color: colors.foreground, borderColor: colors.warning }]} />
                  )}
                </View>
              </View>
            )}

            {/* 出勤数据 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>出勤数据</Text>
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <FieldInput label="出勤天数" value={attendanceDays} onChange={setAttendanceDays}
                  suffix="天" colors={colors} required />
                {employee.type === "fulltime" && (
                  <>
                    <FieldInput label="总工时" value={totalHours} onChange={setTotalHours}
                      suffix="h" colors={colors} />
                    <FieldInput label="加班时间" value={overtimeHours} onChange={setOvertimeHours}
                      suffix="h" colors={colors} hint="自动计算" />
                  </>
                )}
                {employee.type === "parttime" && (
                  <FieldInput label="总工时" value={totalHours} onChange={setTotalHours}
                    suffix="h" colors={colors} required />
                )}
              </View>
            </View>

            {/* 少休/节假日（全职） */}
            {employee.type === "fulltime" && (
              <View style={[AM.section, { borderColor: colors.border }]}>
                <Text style={[AM.sectionTitle, { color: colors.muted }]}>少休 / 节假日</Text>
                <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                  <FieldInput label="少休天数" value={underRestDays} onChange={setUnderRestDays}
                    suffix="天" colors={colors}
                    hint="负数=少休扣款，0=正常" />
                  <FieldInput label="节假日加班天数" value={holidayDays} onChange={setHolidayDays}
                    suffix="天" colors={colors}
                    hint={`${employee.holidayMultiplier}x 倍率`} />
                </View>
              </View>
            )}

            {/* 计算预览 */}
            <View style={[AM.calcCard, { backgroundColor: deptColor + "0a", borderColor: deptColor + "33" }]}>
              <Text style={[AM.calcTitle, { color: deptColor }]}>考勤工资预览</Text>
              {employee.type === "fulltime" ? (
                <>
                  <CalcRow label="底薪" value={`¥${employee.baseSalary.toFixed(2)}`} colors={colors} />
                  {calc.overtimePay > 0 && (
                    <CalcRow label={`加班工资 (${calc.overtimeHours.toFixed(1)}h × ¥${employee.overtimeHourlyRate})`}
                      value={`+¥${calc.overtimePay.toFixed(2)}`} colors={colors} positive />
                  )}
                  {calc.underRestDeduction > 0 && (
                    <CalcRow label={`少休扣款 (${Math.abs(Number(underRestDays))}天 × ¥${effectiveDailyRate.toFixed(2)})`}
                      value={`-¥${calc.underRestDeduction.toFixed(2)}`} colors={colors} negative />
                  )}
                  {calc.holidayBonus > 0 && (
                    <CalcRow label={`节假日补偿 (${holidayDays}天 × ${employee.holidayMultiplier}x)`}
                      value={`+¥${calc.holidayBonus.toFixed(2)}`} colors={colors} positive />
                  )}
                </>
              ) : (
                <CalcRow label={`兼职工资 (${totalHours}h × ¥${employee.hourlyRate})`}
                  value={`¥${calc.attendanceSalary.toFixed(2)}`} colors={colors} />
              )}
              <View style={[AM.calcTotal, { borderTopColor: deptColor + "44" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: deptColor }}>考勤工资合计</Text>
                <Text style={{ fontSize: 20, fontWeight: "800", color: deptColor }}>
                  ¥{calc.attendanceSalary.toFixed(2)}
                </Text>
              </View>
            </View>

            {/* 备注 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>备注</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="备注（可选）"
                placeholderTextColor={colors.muted} multiline numberOfLines={2}
                style={[AM.textarea, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 薪资单编辑 Modal ─────────────────────────────────────────────────────────
function PaySlipEditModal({
  visible, employee, month, attendance, existing, colors, onSave, onClose
}: {
  visible: boolean;
  employee: Employee | null;
  month: string;
  attendance: MonthlyAttendance | null;
  existing: PaySlip | null;
  colors: any;
  onSave: (slip: PaySlip) => void;
  onClose: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const attendanceSalary = attendance?.attendanceSalary ?? 0;
  const [performance, setPerformance] = useState(String(existing?.performanceBonus ?? ""));
  const [commission, setCommission] = useState(String(existing?.salesCommission ?? ""));
  const [meal, setMeal] = useState(String(existing?.mealAllowance ?? ""));
  const [transport, setTransport] = useState(String(existing?.transportAllowance ?? ""));
  const [other, setOther] = useState(String(existing?.otherAllowance ?? ""));
  const [reward, setReward] = useState(String(existing?.rewardPenalty ?? ""));
  const [rewardNote, setRewardNote] = useState(existing?.rewardPenaltyNote ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");

  if (!employee) return null;

  const finalSalary = Math.round((
    attendanceSalary +
    (Number(performance) || 0) +
    (Number(commission) || 0) +
    (Number(meal) || 0) +
    (Number(transport) || 0) +
    (Number(other) || 0) +
    (Number(reward) || 0)
  ) * 100) / 100;

  const handleSave = () => {
    const slip: PaySlip = {
      id: existing?.id ?? (Math.random().toString(36).slice(2) + Date.now().toString(36)),
      employeeId: employee.id,
      month,
      attendanceDays: attendance?.attendanceDays ?? 0,
      attendanceSalary,
      performanceBonus: Number(performance) || 0,
      salesCommission: Number(commission) || 0,
      mealAllowance: Number(meal) || 0,
      transportAllowance: Number(transport) || 0,
      otherAllowance: Number(other) || 0,
      rewardPenalty: Number(reward) || 0,
      rewardPenaltyNote: rewardNote,
      advanceAmount: existing?.advanceAmount ?? 0,
      notes,
      finalSalary,
      updatedAt: new Date().toISOString(),
    };
    onSave(slip);
    onClose();
  };

  const deptColor = DEPT_COLORS[employee.dept];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[AM.sheet, { backgroundColor: colors.background }]}>
          <View style={[AM.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <View style={{ alignItems: "center" }}>
              <Text style={[AM.title, { color: colors.foreground }]}>{employee.code} 最终薪资</Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>{monthLabel(month)}</Text>
            </View>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: deptColor }}>保存</Text></Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* 考勤工资（只读） */}
            <View style={[AM.infoCard, { backgroundColor: deptColor + "0e", borderColor: deptColor + "33" }]}>
              <Text style={{ fontSize: 12, color: colors.muted }}>考勤工资（已计算）</Text>
              <Text style={{ fontSize: 22, fontWeight: "800", color: deptColor }}>¥{attendanceSalary.toFixed(2)}</Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>出勤 {attendance?.attendanceDays ?? 0} 天</Text>
            </View>

            {/* 各项补贴/绩效 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>绩效与提点</Text>
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <FieldInput label="工作绩效" value={performance} onChange={setPerformance} prefix="¥" colors={colors} />
                <FieldInput label="业绩提点" value={commission} onChange={setCommission} prefix="¥" colors={colors} />
              </View>
            </View>

            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>补贴</Text>
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <FieldInput label="吃饭补贴" value={meal} onChange={setMeal} prefix="¥" colors={colors} />
                <FieldInput label="交通补贴" value={transport} onChange={setTransport} prefix="¥" colors={colors} />
                <FieldInput label="其他补贴" value={other} onChange={setOther} prefix="¥" colors={colors} />
              </View>
            </View>

            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>奖惩（正=奖励，负=惩罚）</Text>
              <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                <FieldInput label="奖惩金额" value={reward} onChange={setReward} prefix="¥"
                  colors={colors} hint="负数为扣款" />
              </View>
              <TextInput value={rewardNote} onChangeText={setRewardNote}
                placeholder="奖惩说明（如：迟到扣款/优秀奖励）"
                placeholderTextColor={colors.muted}
                style={[AM.textarea, { color: colors.foreground, borderColor: colors.border, marginTop: 8 }]} />
            </View>

            {/* 最终薪资汇总 */}
            <View style={[AM.calcCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "33" }]}>
              <Text style={[AM.calcTitle, { color: colors.primary }]}>最终薪资</Text>
              <CalcRow label="考勤工资" value={`¥${attendanceSalary.toFixed(2)}`} colors={colors} />
              {Number(performance) > 0 && <CalcRow label="工作绩效" value={`+¥${Number(performance).toFixed(2)}`} colors={colors} positive />}
              {Number(commission) > 0 && <CalcRow label="业绩提点" value={`+¥${Number(commission).toFixed(2)}`} colors={colors} positive />}
              {Number(meal) > 0 && <CalcRow label="吃饭补贴" value={`+¥${Number(meal).toFixed(2)}`} colors={colors} positive />}
              {Number(transport) > 0 && <CalcRow label="交通补贴" value={`+¥${Number(transport).toFixed(2)}`} colors={colors} positive />}
              {Number(other) > 0 && <CalcRow label="其他补贴" value={`+¥${Number(other).toFixed(2)}`} colors={colors} positive />}
              {Number(reward) !== 0 && (
                <CalcRow label={`奖惩 (${rewardNote || ""})`}
                  value={`${Number(reward) > 0 ? "+" : ""}¥${Number(reward).toFixed(2)}`}
                  colors={colors} positive={Number(reward) > 0} negative={Number(reward) < 0} />
              )}
              <View style={[AM.calcTotal, { borderTopColor: colors.primary + "44" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>最终薪资合计</Text>
                <Text style={{ fontSize: 24, fontWeight: "800", color: colors.primary }}>
                  ¥{finalSalary.toFixed(2)}
                </Text>
              </View>
            </View>

            {/* 备注 */}
            <View style={[AM.section, { borderColor: colors.border }]}>
              <Text style={[AM.sectionTitle, { color: colors.muted }]}>备注</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="备注（如：本月表现说明）"
                placeholderTextColor={colors.muted} multiline numberOfLines={3}
                style={[AM.textarea, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function LaborAttendanceScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { employees } = useEmployeeStore();
  const { getShifts } = useShiftStore();
  const { records: attendances, upsertAttendance, getAttendance, calcFromShifts } = useAttendanceStore();
  const { paySlips, upsertPaySlip, getPaySlip } = usePaySlipStore();

  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  );
  const [viewTab, setViewTab] = useState<ViewTab>("attendance");
  const [compareMode, setCompareMode] = useState<CompareMode>("none");
  const [showComparePanel, setShowComparePanel] = useState(false);

  // 编辑状态
  const [attendEditEmp, setAttendEditEmp] = useState<Employee | null>(null);
  const [paySlipEditEmp, setPaySlipEditEmp] = useState<Employee | null>(null);

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

  // 当月排班数据
  const monthShifts = useMemo(() => getShifts(currentMonth), [attendances, currentMonth]);

  // 对比月份
  const compareMonth = useMemo(() => {
    const [y, m] = currentMonth.split("-").map(Number);
    if (compareMode === "lastMonth") { const d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
    if (compareMode === "lastYear") return `${y - 1}-${String(m).padStart(2, "0")}`;
    return null;
  }, [currentMonth, compareMode]);

  // 活跃员工（按部门分组）
  const activeEmployees = useMemo(() => employees.filter((e) => e.active), [employees]);

  const deptGroups: { dept: string; label: string; color: string; employees: Employee[] }[] = [
    { dept: "front", label: "前厅", color: DEPT_COLORS.front, employees: activeEmployees.filter((e) => e.dept === "front") },
    { dept: "kitchen", label: "后厨", color: DEPT_COLORS.kitchen, employees: activeEmployees.filter((e) => e.dept === "kitchen") },
    { dept: "parttime", label: "兼职", color: DEPT_COLORS.parttime, employees: activeEmployees.filter((e) => e.dept === "parttime") },
    { dept: "other", label: "其他", color: DEPT_COLORS.other, employees: activeEmployees.filter((e) => e.dept === "other") },
  ].filter((g) => g.employees.length > 0);

  // 月度汇总
  const totalFinalSalary = useMemo(() => {
    return paySlips
      .filter((s) => s.month === currentMonth)
      .reduce((sum, s) => sum + s.finalSalary, 0);
  }, [paySlips, currentMonth]);

  const totalAttendanceSalary = useMemo(() => {
    return attendances
      .filter((a) => a.month === currentMonth)
      .reduce((sum, a) => sum + a.attendanceSalary, 0);
  }, [attendances, currentMonth]);

  // 生成薪资单文本（分享）
  const generatePayrollText = () => {
    const lines = [
      `===== ${monthLabel(currentMonth)} 薪资汇总 =====`,
      `当月天数：${getDaysInMonth(...Object.values(parseMonth(currentMonth)) as [number, number])}天`,
      ``,
    ];
    deptGroups.forEach((g) => {
      lines.push(`── ${g.label} ──`);
      g.employees.forEach((emp) => {
        const att = getAttendance(emp.id, currentMonth);
        const slip = getPaySlip(emp.id, currentMonth);
        lines.push(`${emp.code}（${emp.realName}）`);
        if (att) {
          lines.push(`  出勤：${att.attendanceDays}天 · 总工时：${att.totalHours}h · 考勤工资：¥${att.attendanceSalary.toFixed(2)}`);
          if (att.overtimePay > 0) lines.push(`  加班：${att.overtimeHours.toFixed(1)}h × ¥${emp.overtimeHourlyRate} = ¥${att.overtimePay.toFixed(2)}`);
          if (att.underRestDeduction > 0) lines.push(`  少休扣款：-¥${att.underRestDeduction.toFixed(2)}`);
        }
        if (slip) {
          if (slip.performanceBonus > 0) lines.push(`  工作绩效：+¥${slip.performanceBonus.toFixed(2)}`);
          if (slip.salesCommission > 0) lines.push(`  业绩提点：+¥${slip.salesCommission.toFixed(2)}`);
          if (slip.mealAllowance > 0) lines.push(`  吃饭补贴：+¥${slip.mealAllowance.toFixed(2)}`);
          if (slip.transportAllowance > 0) lines.push(`  交通补贴：+¥${slip.transportAllowance.toFixed(2)}`);
          if (slip.otherAllowance > 0) lines.push(`  其他补贴：+¥${slip.otherAllowance.toFixed(2)}`);
          if (slip.rewardPenalty !== 0) lines.push(`  奖惩：${slip.rewardPenalty > 0 ? "+" : ""}¥${slip.rewardPenalty.toFixed(2)} (${slip.rewardPenaltyNote})`);
          if (slip.notes) lines.push(`  备注：${slip.notes}`);
          lines.push(`  ★ 最终薪资：¥${slip.finalSalary.toFixed(2)}`);
        }
        lines.push(``);
      });
    });
    lines.push(`─────────────────────`);
    lines.push(`总人工成本：¥${totalFinalSalary.toFixed(2)}`);
    lines.push(`=====================`);
    return lines.join("\n");
  };

  const handleShare = async () => {
    const text = generatePayrollText();
    try {
      const fileUri = (FileSystem.cacheDirectory ?? "") + `payroll_${currentMonth}.txt`;
      await FileSystem.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: "text/plain", dialogTitle: `${monthLabel(currentMonth)} 薪资汇总` });
      } else {
        Alert.alert("薪资汇总", text);
      }
    } catch (e) {
      Alert.alert("分享失败", String(e));
    }
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[S.navTitle, { color: colors.foreground }]}>人工成本</Text>
        </View>
        <Pressable onPress={handleShare} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="square.and.arrow.up" size={20} color={colors.primary} />
        </Pressable>
      </View>

      {/* 月份选择器 */}
      <View style={[S.monthBar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => { tap(); prevMonth(); }} style={{ padding: 8 }}>
          <IconSymbol name="chevron.left" size={18} color={colors.primary} />
        </Pressable>
        <Text style={[S.monthLabel, { color: colors.foreground }]}>{monthLabel(currentMonth)}</Text>
        <Pressable onPress={() => { tap(); nextMonth(); }} style={{ padding: 8 }}>
          <IconSymbol name="chevron.right" size={18} color={colors.primary} />
        </Pressable>
      </View>

      {/* Tab 切换 + 对比开关 */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 8, gap: 8 }}>
        <View style={[S.tabBar, { backgroundColor: colors.border + "33", flex: 1, margin: 0 }]}>
          {(["attendance", "payslip"] as ViewTab[]).map((v) => (
            <TouchableOpacity key={v} onPress={() => { tap(); setViewTab(v); }}
              style={[S.tabBtn, viewTab === v && { backgroundColor: colors.background }]}>
              <Text style={[S.tabText, { color: viewTab === v ? colors.foreground : colors.muted, fontWeight: viewTab === v ? "600" : "400" }]}>
                {v === "attendance" ? "考勤工资" : "最终薪资"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {viewTab === "payslip" && (
          <TouchableOpacity onPress={() => { tap(); setShowComparePanel((v) => !v); }}
            style={{ backgroundColor: showComparePanel ? colors.primary + "22" : colors.surface, borderRadius: 8, borderWidth: 1, borderColor: showComparePanel ? colors.primary + "44" : colors.border, paddingHorizontal: 8, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 4 }}>
            <IconSymbol name="chart.bar.xaxis" size={12} color={showComparePanel ? colors.primary : colors.muted} />
            <Text style={{ fontSize: 11, color: showComparePanel ? colors.primary : colors.muted, fontWeight: "600" }}>对比</Text>
          </TouchableOpacity>
        )}
      </View>
      {/* 对比选择面板 */}
      {viewTab === "payslip" && showComparePanel && (
        <View style={{ flexDirection: "row", gap: 6, paddingHorizontal: 12, paddingVertical: 6 }}>
          {(["none", "lastMonth", "lastYear"] as CompareMode[]).map((m) => (
            <TouchableOpacity key={m} onPress={() => { tap(); setCompareMode(m); }}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: compareMode === m ? colors.primary : colors.border, backgroundColor: compareMode === m ? colors.primary : colors.surface }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: compareMode === m ? "#fff" : colors.muted }}>
                {m === "none" ? "不对比" : m === "lastMonth" ? "与上月" : "与去年同期"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* 月度汇总卡片 */}
      <View style={[S.summaryCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>考勤工资合计</Text>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>¥{totalAttendanceSalary.toFixed(0)}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: colors.border }} />
        <View style={{ flex: 1, alignItems: "flex-end" }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>最终薪资合计</Text>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>¥{totalFinalSalary.toFixed(0)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {deptGroups.map((g) => (
          <View key={g.dept} style={{ marginBottom: 16 }}>
            {/* 部门标题 */}
            <View style={[S.deptHeader, { backgroundColor: g.color }]}>
              <Text style={S.deptLabel}>{g.label}</Text>
              <Text style={S.deptCount}>{g.employees.length}人</Text>
            </View>

            {/* 表头 */}
            {viewTab === "attendance" ? (
              <View style={[S.tableHeader, { backgroundColor: g.color + "15", borderColor: g.color + "33" }]}>
                <Text style={[S.th, { flex: 1.2, color: g.color }]}>员工</Text>
                <Text style={[S.th, { flex: 0.8, color: g.color }]}>出勤</Text>
                <Text style={[S.th, { flex: 1, color: g.color }]}>总工时</Text>
                <Text style={[S.th, { flex: 1, color: g.color }]}>加班</Text>
                <Text style={[S.th, { flex: 1.5, color: g.color }]}>考勤工资</Text>
                <View style={{ width: 28 }} />
              </View>
            ) : (
              <View style={[S.tableHeader, { backgroundColor: g.color + "15", borderColor: g.color + "33" }]}>
                <Text style={[S.th, { flex: 1.2, color: g.color }]}>员工</Text>
                <Text style={[S.th, { flex: 1, color: g.color }]}>考勤工资</Text>
                <Text style={[S.th, { flex: 0.8, color: g.color }]}>绩效+提点</Text>
                <Text style={[S.th, { flex: 0.8, color: g.color }]}>补贴</Text>
                <Text style={[S.th, { flex: 1.2, color: g.color }]}>最终薪资</Text>
                <View style={{ width: 28 }} />
              </View>
            )}

            {/* 员工行 */}
            {g.employees.map((emp) => {
              const att = getAttendance(emp.id, currentMonth);
              const slip = getPaySlip(emp.id, currentMonth);
              const deptColor = g.color;
              // 对比数据
              const compareSlip = compareMonth ? getPaySlip(emp.id, compareMonth) : null;
              const compareAtt = compareMonth ? getAttendance(emp.id, compareMonth) : null;

              if (viewTab === "attendance") {
                return (
                  <TouchableOpacity key={emp.id}
                    onPress={() => { tap(); setAttendEditEmp(emp); }}
                    style={[S.empRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1.2 }}>
                      <Text style={[S.empCode, { color: deptColor }]}>{emp.code}</Text>
                      <Text style={[S.empName, { color: colors.muted }]}>{emp.realName}</Text>
                    </View>
                    <Text style={[S.td, { flex: 0.8, color: colors.foreground }]}>
                      {att ? `${att.attendanceDays}天` : "—"}
                    </Text>
                    <Text style={[S.td, { flex: 1, color: colors.foreground }]}>
                      {att ? `${att.totalHours}h` : "—"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      {att && att.overtimeHours > 0 && (
                        <Text style={{ fontSize: 12, color: colors.success }}>+{att.overtimeHours.toFixed(1)}h</Text>
                      )}
                      {att && att.underRestDeduction > 0 && (
                        <Text style={{ fontSize: 11, color: colors.error }}>-¥{att.underRestDeduction.toFixed(0)}</Text>
                      )}
                      {att && att.holidayBonus > 0 && (
                        <Text style={{ fontSize: 11, color: colors.warning }}>节+¥{att.holidayBonus.toFixed(0)}</Text>
                      )}
                    </View>
                    <Text style={[S.salaryCell, { flex: 1.5, color: att ? deptColor : colors.muted }]}>
                      {att ? `¥${att.attendanceSalary.toFixed(0)}` : "未填写"}
                    </Text>
                    <TouchableOpacity onPress={() => { tap(); setAttendEditEmp(emp); }} style={{ width: 28, alignItems: "center" }}>
                      <IconSymbol name="pencil" size={14} color={colors.muted} />
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              } else {
                const totalAllowance = (slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0);
                const totalBonus = (slip?.performanceBonus ?? 0) + (slip?.salesCommission ?? 0);
                const diffSalary = slip && compareSlip ? slip.finalSalary - compareSlip.finalSalary : null;
                return (
                  <TouchableOpacity key={emp.id} onPress={() => { tap(); setPaySlipEditEmp(emp); }}
                    style={[SC.slipCard, { backgroundColor: colors.surface, borderColor: deptColor + "33" }]}>
                    {/* 头部 */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <View style={[SC.avatar, { backgroundColor: deptColor + "22" }]}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: deptColor }}>{emp.code.slice(0, 2)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{emp.code} · {emp.realName}</Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>{emp.type === "fulltime" ? "全职" : "兼职"} · {att ? `出勤${att.attendanceDays}天` : "考勤未填"}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 20, fontWeight: "800", color: slip ? deptColor : colors.muted }}>
                          {slip ? `¥${slip.finalSalary.toFixed(0)}` : "未填写"}
                        </Text>
                        {/* 对比浮动 */}
                        {diffSalary !== null && (
                          <Text style={{ fontSize: 11, fontWeight: "600", color: diffSalary > 0 ? colors.error : diffSalary < 0 ? colors.success : colors.muted }}>
                            {diffSalary > 0 ? "▲" : diffSalary < 0 ? "▼" : "—"} ¥{Math.abs(diffSalary).toFixed(0)}
                          </Text>
                        )}
                      </View>
                    </View>
                    {/* 明细 */}
                    {(att || slip) && (
                      <View style={[SC.detailRow, { borderTopColor: colors.border }]}>
                        {att && <SlipDetailItem label="考勤" value={`¥${att.attendanceSalary.toFixed(0)}`} color={colors.foreground} />}
                        {totalBonus > 0 && <SlipDetailItem label="绩效+提点" value={`+¥${totalBonus.toFixed(0)}`} color={colors.success} />}
                        {totalAllowance > 0 && <SlipDetailItem label="补贴" value={`+¥${totalAllowance.toFixed(0)}`} color={colors.primary} />}
                        {slip && slip.rewardPenalty !== 0 && <SlipDetailItem label="奖惩" value={`${slip.rewardPenalty > 0 ? "+" : ""}¥${slip.rewardPenalty.toFixed(0)}`} color={slip.rewardPenalty > 0 ? colors.success : colors.error} />}
                        {compareSlip && <SlipDetailItem label={compareMode === "lastMonth" ? "上月" : "去年"} value={`¥${compareSlip.finalSalary.toFixed(0)}`} color={colors.muted} />}
                      </View>
                    )}
                    {slip?.notes ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>备注：{slip.notes}</Text> : null}
                    {/* 编辑按鈕 */}
                    <View style={{ position: "absolute", top: 10, right: 10 }}>
                      <IconSymbol name="pencil" size={13} color={colors.muted} />
                    </View>
                  </TouchableOpacity>
                );
              }
            })}
          </View>
        ))}

        {activeEmployees.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <IconSymbol name="person.2.fill" size={48} color={colors.border} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.foreground, marginTop: 12 }}>暂无员工档案</Text>
            <Pressable onPress={() => router.push("/labor-employee-form" as any)}
              style={[S.addBtn, { backgroundColor: colors.primary }]}>
              <IconSymbol name="plus" size={16} color="#fff" />
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>添加员工</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* 考勤工资编辑 Modal */}
      <AttendanceEditModal
        visible={!!attendEditEmp}
        employee={attendEditEmp}
        month={currentMonth}
        existing={attendEditEmp ? getAttendance(attendEditEmp.id, currentMonth) : null}
        colors={colors}
        onSave={upsertAttendance}
        onClose={() => setAttendEditEmp(null)}
      />

      {/* 薪资单编辑 Modal */}
      <PaySlipEditModal
        visible={!!paySlipEditEmp}
        employee={paySlipEditEmp}
        month={currentMonth}
        attendance={paySlipEditEmp ? getAttendance(paySlipEditEmp.id, currentMonth) : null}
        existing={paySlipEditEmp ? getPaySlip(paySlipEditEmp.id, currentMonth) : null}
        colors={colors}
        onSave={upsertPaySlip}
        onClose={() => setPaySlipEditEmp(null)}
      />
    </ScreenContainer>
  );
}

// ─── 辅助组件 ─────────────────────────────────────────────────────────────────
function FieldInput({ label, value, onChange, prefix, suffix, hint, required, colors }: {
  label: string; value: string; onChange: (v: string) => void;
  prefix?: string; suffix?: string; hint?: string; required?: boolean; colors: any;
}) {
  return (
    <View style={{ minWidth: 100, flex: 1 }}>
      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>
        {label}{required && <Text style={{ color: colors.error }}> *</Text>}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {prefix && <Text style={{ fontSize: 13, color: colors.muted }}>{prefix}</Text>}
        <TextInput value={value} onChangeText={onChange} keyboardType="decimal-pad"
          placeholder="0" placeholderTextColor={colors.muted}
          style={[{ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 7, fontSize: 14, color: colors.foreground }]} />
        {suffix && <Text style={{ fontSize: 13, color: colors.muted }}>{suffix}</Text>}
      </View>
      {hint && <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{hint}</Text>}
    </View>
  );
}

function CalcRow({ label, value, positive, negative, colors }: {
  label: string; value: string; positive?: boolean; negative?: boolean; colors: any;
}) {
  const color = positive ? colors.success : negative ? colors.error : colors.foreground;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
      <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }} numberOfLines={1}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: "600", color }}>{value}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 16 },
  monthLabel: { fontSize: 16, fontWeight: "700", minWidth: 90, textAlign: "center" },
  tabBar: { flexDirection: "row", margin: 12, borderRadius: 10, padding: 2, gap: 2 },
  tabBtn: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tabText: { fontSize: 13 },
  summaryCard: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 4, borderRadius: 12, borderWidth: 1, padding: 14, gap: 16 },
  deptHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginBottom: 2 },
  deptLabel: { fontSize: 13, fontWeight: "700", color: "#fff" },
  deptCount: { fontSize: 12, color: "#fff99" },
  tableHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderRadius: 6, marginBottom: 2 },
  th: { fontSize: 11, fontWeight: "700" },
  empRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  empCode: { fontSize: 14, fontWeight: "700" },
  empName: { fontSize: 11, marginTop: 1 },
  td: { fontSize: 13 },
  salaryCell: { fontSize: 14, fontWeight: "700" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 16 },
});

// ─── 薪水条辅助组件 ─────────────────────────────────────────────────────────────
function SlipDetailItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ alignItems: "center", minWidth: 52 }}>
      <Text style={{ fontSize: 10, color: "#999", marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 12, fontWeight: "600", color }}>{value}</Text>
    </View>
  );
}

const SC = StyleSheet.create({
  slipCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, position: "relative" },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  detailRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingTop: 8, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
});

const AM = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: "700" },
  infoCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  autoTag: { borderRadius: 8, padding: 8, flex: 1 },
  overrideBtn: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  inputSmall: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, width: 80, textAlign: "center" },
  calcCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  calcTitle: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
  calcTotal: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingTop: 10, marginTop: 8 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 60 },
});
