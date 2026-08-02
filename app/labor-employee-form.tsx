/**
 * 员工档案设置页（新增/编辑）
 * 字段：员工代号/真实姓名/联系方式/部门/类型/底薪/每日标准工时/月休息天数/时薪/加班时薪/节假日倍率/备注
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore } from "@/lib/labor/store";
import {
  Employee, EmployeeDept, EmployeeType, DEPT_LABELS, DEPT_COLORS,
  EMPLOYEE_TYPE_LABELS, EMPLOYEE_TYPE_COLORS,
  calcDailyRate, getDaysInMonth
} from "@/lib/labor/types";

const DEPT_OPTIONS: EmployeeDept[] = ["front", "kitchen", "parttime", "other"];
const TYPE_OPTIONS: { key: EmployeeType; label: string; desc: string }[] = [
  { key: "fulltime", label: "全职", desc: "底薪+加班，按月结算" },
  { key: "longterm_parttime", label: "长期兼职", desc: "固定排班，支持薪资预支" },
  { key: "parttime", label: "临时兼职", desc: "按次/按小时，无预支" },
];
const HOLIDAY_MULTIPLIERS = [1.0, 1.5, 2.0, 3.0];

export default function LaborEmployeeFormScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { employees, addEmployee, updateEmployee } = useEmployeeStore();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const existing = id ? employees.find((e) => e.id === id) : null;
  const isEdit = !!existing;

  // 表单状态
  const [code, setCode] = useState(existing?.code ?? "");
  const [realName, setRealName] = useState(existing?.realName ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [dept, setDept] = useState<EmployeeDept>(existing?.dept ?? "front");
  const [type, setType] = useState<EmployeeType>(existing?.type ?? "fulltime");
  const [baseSalary, setBaseSalary] = useState(String(existing?.baseSalary ?? ""));
  const [stdHours, setStdHours] = useState(String(existing?.stdHoursPerDay ?? "8"));
  const [restDays, setRestDays] = useState(String(existing?.restDaysPerMonth ?? "4"));
  const [hourlyRate, setHourlyRate] = useState(String(existing?.hourlyRate ?? "35"));
  const [overtimeRate, setOvertimeRate] = useState(String(existing?.overtimeHourlyRate ?? "35"));
  const [holidayMult, setHolidayMult] = useState(existing?.holidayMultiplier ?? 1.5);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [monthlyFixedSalary, setMonthlyFixedSalary] = useState(String(existing?.monthlyFixedSalary ?? "0"));
  const [active, setActive] = useState(existing?.active ?? true);

  // 日薪预览（自动计算）
  const now = new Date();
  const daysInMonth = getDaysInMonth(now.getFullYear(), now.getMonth() + 1);
  const dailyRatePreview = useMemo(() => {
    const base = Number(baseSalary);
    const rest = Number(restDays);
    if (!base || isNaN(base)) return 0;
    return calcDailyRate(base, daysInMonth, rest);
  }, [baseSalary, restDays, daysInMonth]);

  const isFulltime = type === "fulltime";

  const handleSave = () => {
    if (!code.trim()) { Alert.alert("请填写员工代号"); return; }
    if (!realName.trim()) { Alert.alert("请填写真实姓名"); return; }
    if (isFulltime && !baseSalary) { Alert.alert("请填写底薪"); return; }
    if (!hourlyRate) { Alert.alert("请填写时薪"); return; }

    const draft: Omit<Employee, "id" | "createdAt"> = {
      code: code.trim(),
      realName: realName.trim(),
      phone: phone.trim(),
      dept,
      type,
      baseSalary: Number(baseSalary) || 0,
      stdHoursPerDay: Number(stdHours) || 8,
      restDaysPerMonth: Number(restDays) || 4,
      hourlyRate: Number(hourlyRate) || 35,
      overtimeHourlyRate: Number(overtimeRate) || Number(hourlyRate) || 35,
      holidayMultiplier: holidayMult,
      monthlyFixedSalary: Number(monthlyFixedSalary) || 0,
      notes: notes.trim(),
      active,
    };

    if (isEdit && existing) {
      updateEmployee(existing.id, draft);
    } else {
      addEmployee(draft);
    }
    tap();
    router.back();
  };

  const deptColor = DEPT_COLORS[dept];

  return (
    <ScreenContainer>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* 导航栏 */}
        <View style={[S.navbar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 17, color: colors.error }}>取消</Text>
          </Pressable>
          <Text style={[S.navTitle, { color: colors.foreground }]}>
            {isEdit ? "编辑员工档案" : "新增员工"}
          </Text>
          <Pressable onPress={handleSave} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {/* 基本信息 */}
          <SectionCard title="基本信息" colors={colors}>
            <FormRow label="员工代号" required colors={colors}>
              <TextInput value={code} onChangeText={setCode} placeholder="如 RG、Zik、权哥"
                placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="真实姓名" required colors={colors}>
              <TextInput value={realName} onChangeText={setRealName} placeholder="如 荀瑞雪"
                placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="联系方式" colors={colors}>
              <TextInput value={phone} onChangeText={setPhone} placeholder="手机号"
                placeholderTextColor={colors.muted} keyboardType="phone-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
          </SectionCard>

          {/* 部门与类型 */}
          <SectionCard title="部门与类型" colors={colors}>
            <FormRow label="部门" colors={colors}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {DEPT_OPTIONS.map((d) => (
                  <TouchableOpacity key={d} onPress={() => { tap(); setDept(d); }}
                    style={[S.optionChip, {
                      backgroundColor: dept === d ? DEPT_COLORS[d] : colors.surface,
                      borderColor: dept === d ? DEPT_COLORS[d] : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: dept === d ? "#fff" : colors.muted }}>
                      {DEPT_LABELS[d]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </FormRow>
            <FormRow label="类型" colors={colors}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {TYPE_OPTIONS.map((t) => {
                  const tColor = EMPLOYEE_TYPE_COLORS[t.key];
                  const selected = type === t.key;
                  return (
                    <TouchableOpacity key={t.key} onPress={() => { tap(); setType(t.key); }}
                      style={[S.optionChip, {
                        backgroundColor: selected ? tColor : colors.surface,
                        borderColor: selected ? tColor : colors.border,
                      }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: selected ? "#fff" : tColor }}>
                        {t.label}
                      </Text>
                      <Text style={{ fontSize: 10, color: selected ? "#ffffff99" : colors.muted }}>
                        {t.desc}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </FormRow>
          </SectionCard>

          {/* 工资设置 */}
          <SectionCard title="工资设置" colors={colors}>
            {type === "longterm_parttime" && (
              <FormRow label="月度固定薪资（长期兼职）" colors={colors}>
                <View style={{ gap: 4 }}>
                  <TextInput value={monthlyFixedSalary} onChangeText={setMonthlyFixedSalary}
                    placeholder="0 = 不设置，仍按小时计算" placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    设置后按月结算，支持薪资预支功能。不设置则仍按工时×时薪计算。
                  </Text>
                </View>
              </FormRow>
            )}
            {isFulltime && (
              <>
                <FormRow label="底薪（月）" required colors={colors}>
                  <TextInput value={baseSalary} onChangeText={setBaseSalary} placeholder="如 10000"
                    placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <FormRow label="每日标准工时（小时/天）" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[6, 7, 8, 9, 10].map((h) => (
                      <TouchableOpacity key={h} onPress={() => { tap(); setStdHours(String(h)); }}
                        style={[S.numChip, {
                          backgroundColor: stdHours === String(h) ? colors.primary : colors.surface,
                          borderColor: stdHours === String(h) ? colors.primary : colors.border,
                        }]}>
                        <Text style={{ fontSize: 13, color: stdHours === String(h) ? "#fff" : colors.muted }}>{h}h</Text>
                      </TouchableOpacity>
                    ))}
                    <TextInput value={stdHours} onChangeText={setStdHours} keyboardType="decimal-pad"
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                </FormRow>
                <FormRow label="月休息天数" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[2, 4, 6, 8].map((d) => (
                      <TouchableOpacity key={d} onPress={() => { tap(); setRestDays(String(d)); }}
                        style={[S.numChip, {
                          backgroundColor: restDays === String(d) ? colors.primary : colors.surface,
                          borderColor: restDays === String(d) ? colors.primary : colors.border,
                        }]}>
                        <Text style={{ fontSize: 13, color: restDays === String(d) ? "#fff" : colors.muted }}>{d}天</Text>
                      </TouchableOpacity>
                    ))}
                    <TextInput value={restDays} onChangeText={setRestDays} keyboardType="number-pad"
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                </FormRow>
                {/* 日薪预览 */}
                {dailyRatePreview > 0 && (
                  <View style={[S.dailyRatePreview, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>日薪预览（当月）</Text>
                    <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>
                      ¥{dailyRatePreview.toFixed(2)} / 天
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      ¥{Number(baseSalary).toFixed(0)} ÷ ({daysInMonth}天 - {restDays}休) = ¥{dailyRatePreview.toFixed(2)}
                    </Text>
                  </View>
                )}
              </>
            )}

            <FormRow label="时薪（元/小时）" required colors={colors}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {[25, 30, 35, 40, 45].map((r) => (
                  <TouchableOpacity key={r} onPress={() => { tap(); setHourlyRate(String(r)); if (overtimeRate === hourlyRate) setOvertimeRate(String(r)); }}
                    style={[S.numChip, {
                      backgroundColor: hourlyRate === String(r) ? deptColor : colors.surface,
                      borderColor: hourlyRate === String(r) ? deptColor : colors.border,
                    }]}>
                    <Text style={{ fontSize: 13, color: hourlyRate === String(r) ? "#fff" : colors.muted }}>¥{r}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput value={hourlyRate} onChangeText={setHourlyRate} keyboardType="decimal-pad"
                  style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            </FormRow>

            {isFulltime && (
              <FormRow label="加班时薪（元/小时）" colors={colors}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TouchableOpacity onPress={() => { tap(); setOvertimeRate(hourlyRate); }}
                    style={[S.optionChip, { borderColor: colors.border, backgroundColor: overtimeRate === hourlyRate ? colors.primary + "15" : colors.surface }]}>
                    <Text style={{ fontSize: 12, color: overtimeRate === hourlyRate ? colors.primary : colors.muted }}>同时薪</Text>
                  </TouchableOpacity>
                  <TextInput value={overtimeRate} onChangeText={setOvertimeRate} keyboardType="decimal-pad"
                    style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>元/小时</Text>
                </View>
              </FormRow>
            )}

            {isFulltime && (
              <FormRow label="节假日倍率" colors={colors}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {HOLIDAY_MULTIPLIERS.map((m) => (
                    <TouchableOpacity key={m} onPress={() => { tap(); setHolidayMult(m); }}
                      style={[S.numChip, {
                        backgroundColor: holidayMult === m ? colors.warning : colors.surface,
                        borderColor: holidayMult === m ? colors.warning : colors.border,
                      }]}>
                      <Text style={{ fontSize: 13, color: holidayMult === m ? "#fff" : colors.muted }}>{m}x</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                  节假日加班 = 日薪 × (倍率-1) × 天数
                </Text>
              </FormRow>
            )}
          </SectionCard>

          {/* 备注 */}
          <SectionCard title="备注" colors={colors}>
            <TextInput value={notes} onChangeText={setNotes} placeholder="备注信息（可选）"
              placeholderTextColor={colors.muted} multiline numberOfLines={3}
              style={[S.textarea, { color: colors.foreground, borderColor: colors.border }]} />
          </SectionCard>

          {/* 在职状态 */}
          <SectionCard title="状态" colors={colors}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[{ v: true, label: "在职" }, { v: false, label: "离职" }].map((opt) => (
                <TouchableOpacity key={String(opt.v)} onPress={() => { tap(); setActive(opt.v); }}
                  style={[S.optionChip, {
                    backgroundColor: active === opt.v ? (opt.v ? colors.success : colors.error) : colors.surface,
                    borderColor: active === opt.v ? (opt.v ? colors.success : colors.error) : colors.border,
                  }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: active === opt.v ? "#fff" : colors.muted }}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </SectionCard>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function SectionCard({ title, children, colors }: { title: string; children: React.ReactNode; colors: any }) {
  return (
    <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[S.sectionTitle, { color: colors.muted }]}>{title}</Text>
      {children}
    </View>
  );
}

function FormRow({ label, required, children, colors }: { label: string; required?: boolean; children: React.ReactNode; colors: any }) {
  return (
    <View style={S.formRow}>
      <Text style={[S.formLabel, { color: colors.foreground }]}>
        {label}{required && <Text style={{ color: colors.error }}> *</Text>}
      </Text>
      {children}
    </View>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  sectionCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 12 },
  formRow: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  inputSmall: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, width: 60, textAlign: "center" },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 70 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  numChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, alignItems: "center" },
  dailyRatePreview: { borderRadius: 10, borderWidth: 1, padding: 12, marginTop: 4, marginBottom: 4 },
});
