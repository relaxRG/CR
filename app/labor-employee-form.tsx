/**
 * 员工档案设置页（新增/编辑）
 * 升级：详细档案（身份证/健康证/紧急联系人/住址）+ 银行卡一键复制
 */
import React, { useMemo, useState } from "react";
import {
  Alert, Clipboard, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeStore, useShiftTemplateStore } from "@/lib/labor/store";
import {
  Employee, EmployeeDept, EmployeeType, EmployeeBankAccount, WeeklyHoursRule,
  AllowanceRule,
  DEPT_LABELS, DEPT_COLORS, EMPLOYEE_TYPE_LABELS, EMPLOYEE_TYPE_COLORS,
  calcDailyRate, getDaysInMonth, DEFAULT_SHIFT_TEMPLATES, WEEKDAY_LABELS,
  DEFAULT_SOCIAL_INSURANCE,
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
  const { templates: shiftTemplates } = useShiftTemplateStore();
  const availableSessions = (shiftTemplates.length > 0 ? shiftTemplates : DEFAULT_SHIFT_TEMPLATES)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const existing = id ? employees.find((e) => e.id === id) : null;
  const isEdit = !!existing;

  // ── 基本信息 ──
  const [code, setCode] = useState(existing?.code ?? "");
  const [realName, setRealName] = useState(existing?.realName ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [dept, setDept] = useState<EmployeeDept>(existing?.dept ?? "front");
  const [type, setType] = useState<EmployeeType>(existing?.type ?? "fulltime");
  const [joinDate, setJoinDate] = useState(existing?.joinDate ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [defaultSession, setDefaultSession] = useState<string | undefined>(existing?.defaultSession);

  // ── 工资设置 ──
  const [baseSalary, setBaseSalary] = useState(String(existing?.baseSalary ?? ""));
  const [stdHours, setStdHours] = useState(String(existing?.stdHoursPerDay ?? "8"));
  const [restDays, setRestDays] = useState(String(existing?.restDaysPerMonth ?? "4"));
  const [hourlyRate, setHourlyRate] = useState(String(existing?.hourlyRate ?? "35"));
  const [overtimeRate, setOvertimeRate] = useState(String(existing?.overtimeHourlyRate ?? "35"));
  const [holidayMult, setHolidayMult] = useState(existing?.holidayMultiplier ?? 1.5);
  const [monthlyFixedSalary, setMonthlyFixedSalary] = useState(String(existing?.monthlyFixedSalary ?? "0"));

  // ── 灵活工时规则 ──
  const [weeklyHoursRules, setWeeklyHoursRules] = useState<WeeklyHoursRule[]>(
    existing?.weeklyHoursRules ?? []
  );

  // 添加规则
  const addHoursRule = () => {
    const newRule: WeeklyHoursRule = {
      id: Date.now().toString(),
      fromDay: 1,
      toDay: 4,
      hours: Number(stdHours) || 8,
    };
    setWeeklyHoursRules((prev) => [...prev, newRule]);
  };

  // 更新规则
  const updateHoursRule = (id: string, patch: Partial<WeeklyHoursRule>) => {
    setWeeklyHoursRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };

  // 删除规则
  const deleteHoursRule = (id: string) => {
    setWeeklyHoursRules((prev) => prev.filter((r) => r.id !== id));
  };

  // ── 详细档案 ──
  const [idNumber, setIdNumber] = useState(existing?.idNumber ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [emergencyName, setEmergencyName] = useState(existing?.emergencyContactName ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(existing?.emergencyContactPhone ?? "");
  const [emergencyRelation, setEmergencyRelation] = useState(existing?.emergencyContactRelation ?? "");
  const [healthCertExpiry, setHealthCertExpiry] = useState(existing?.healthCertExpiry ?? "");

  // ── 银行卡 ──
  const [bankAccounts, setBankAccounts] = useState<EmployeeBankAccount[]>(existing?.bankAccounts ?? []);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankAccountName, setBankAccountName] = useState(existing?.realName ?? "");
  const [bankName, setBankName] = useState("");
  const [bankCardNumber, setBankCardNumber] = useState("");
  const [bankNote, setBankNote] = useState("");
  const [editingBankId, setEditingBankId] = useState<string | null>(null);

  // ── 调休规则 ──
  const [compOffEnabled, setCompOffEnabled] = useState(existing?.compOffRule?.enabled ?? false);
  const [compOffHoursPerDay, setCompOffHoursPerDay] = useState(String(existing?.compOffRule?.hoursPerDay ?? 8));

  // ── 补贴规则 ──
  const [allowanceRules, setAllowanceRules] = useState<AllowanceRule[]>(existing?.allowanceRules ?? []);
  const addAllowanceRule = () => {
    setAllowanceRules((prev) => [...prev, { id: Date.now().toString(), type: "custom_fixed" as const, label: "自定义补贴", amount: 0, enabled: true }]);
  };
  const updateAllowanceRule = (id: string, patch: Partial<AllowanceRule>) => {
    setAllowanceRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };
  const deleteAllowanceRule = (id: string) => setAllowanceRules((prev) => prev.filter((r) => r.id !== id));

  // ── 社保/公积金 ──
  const [siEnabled, setSiEnabled] = useState(existing?.socialInsurance?.enabled ?? false);
  const [siCity, setSiCity] = useState(existing?.socialInsurance?.city ?? "");
  const [siBase, setSiBase] = useState(String(existing?.socialInsurance?.base ?? 0));
  const [siPension, setSiPension] = useState(String(((existing?.socialInsurance?.pensionRate ?? 0.08) * 100).toFixed(1)));
  const [siMedical, setSiMedical] = useState(String(((existing?.socialInsurance?.medicalRate ?? 0.02) * 100).toFixed(1)));
  const [siUnemployment, setSiUnemployment] = useState(String(((existing?.socialInsurance?.unemploymentRate ?? 0.005) * 100).toFixed(1)));
  const [siHousingFund, setSiHousingFund] = useState(String(((existing?.socialInsurance?.housingFundRate ?? 0.12) * 100).toFixed(1)));
  const [siHousingBase, setSiHousingBase] = useState(String(existing?.socialInsurance?.housingFundBase ?? 0));

  const now = new Date();
  const daysInMonth = getDaysInMonth(now.getFullYear(), now.getMonth() + 1);
  const dailyRatePreview = useMemo(() => {
    const base = Number(baseSalary);
    const rest = Number(restDays);
    if (!base || isNaN(base)) return 0;
    return calcDailyRate(base, daysInMonth, rest);
  }, [baseSalary, restDays, daysInMonth]);

  const isFulltime = type === "fulltime";
  const deptColor = DEPT_COLORS[dept];

  const handleSave = () => {
    if (!code.trim()) { Alert.alert("请填写员工代号"); return; }
    if (!realName.trim()) { Alert.alert("请填写真实姓名"); return; }
    if (isFulltime && !baseSalary) { Alert.alert("请填写底薪"); return; }
    if (!hourlyRate) { Alert.alert("请填写时薪"); return; }

    const draft: Omit<Employee, "id" | "createdAt"> = {
      code: code.trim(), realName: realName.trim(), phone: phone.trim(),
      dept, type, active, notes: notes.trim(),
      baseSalary: Number(baseSalary) || 0,
      stdHoursPerDay: Number(stdHours) || 8,
      restDaysPerMonth: Number(restDays) || 4,
      hourlyRate: Number(hourlyRate) || 35,
      overtimeHourlyRate: Number(overtimeRate) || Number(hourlyRate) || 35,
      holidayMultiplier: holidayMult,
      monthlyFixedSalary: Number(monthlyFixedSalary) || 0,
      weeklyHoursRules: weeklyHoursRules.length > 0 ? weeklyHoursRules : undefined,
      compOffRule: { enabled: compOffEnabled, hoursPerDay: Number(compOffHoursPerDay) || 8 },
      allowanceRules: allowanceRules.length > 0 ? allowanceRules : undefined,
      socialInsurance: siEnabled ? {
        ...DEFAULT_SOCIAL_INSURANCE, enabled: true, city: siCity.trim(),
        base: Number(siBase) || 0,
        pensionRate: Number(siPension) / 100 || 0.08,
        medicalRate: Number(siMedical) / 100 || 0.02,
        unemploymentRate: Number(siUnemployment) / 100 || 0.005,
        housingFundRate: Number(siHousingFund) / 100 || 0.12,
        housingFundBase: Number(siHousingBase) || 0,
      } : undefined,
      bankAccounts,
      idNumber: idNumber.trim() || undefined,
      address: address.trim() || undefined,
      emergencyContactName: emergencyName.trim() || undefined,
      emergencyContactPhone: emergencyPhone.trim() || undefined,
      emergencyContactRelation: emergencyRelation.trim() || undefined,
      healthCertExpiry: healthCertExpiry.trim() || undefined,
      joinDate: joinDate.trim() || undefined,
      defaultSession,
    };

    if (isEdit && existing) updateEmployee(existing.id, draft);
    else addEmployee(draft);
    tap();
    router.back();
  };

  // 银行卡操作
  const handleSaveBankAccount = () => {
    if (!bankName.trim() || !bankCardNumber.trim()) { Alert.alert("请填写开户行和卡号"); return; }
    if (editingBankId) {
      setBankAccounts((prev) => prev.map((b) => b.id === editingBankId ? { ...b, accountName: bankAccountName.trim(), bankName: bankName.trim(), cardNumber: bankCardNumber.trim(), note: bankNote.trim() } : b));
    } else {
      const newAccount: EmployeeBankAccount = {
        id: Date.now().toString(), accountName: bankAccountName.trim() || realName.trim(),
        bankName: bankName.trim(), cardNumber: bankCardNumber.trim(), note: bankNote.trim(), isDefault: bankAccounts.length === 0,
      };
      setBankAccounts((prev) => [...prev, newAccount]);
    }
    setShowBankForm(false); setEditingBankId(null);
    setBankName(""); setBankCardNumber(""); setBankNote("");
  };

  const handleCopyBankInfo = (account: EmployeeBankAccount) => {
    const text = `姓名：${account.accountName}\n开户行：${account.bankName}\n卡号：${account.cardNumber}`;
    Clipboard.setString(text);
    Alert.alert("已复制", "银行信息已复制到剪贴板");
  };

  const handleEditBank = (account: EmployeeBankAccount) => {
    setEditingBankId(account.id);
    setBankAccountName(account.accountName);
    setBankName(account.bankName);
    setBankCardNumber(account.cardNumber);
    setBankNote(account.note);
    setShowBankForm(true);
  };

  const handleDeleteBank = (id: string) => {
    Alert.alert("删除银行卡", "确认删除这张银行卡？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => setBankAccounts((prev) => prev.filter((b) => b.id !== id)) },
    ]);
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[S.navbar, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 17, color: colors.error }}>取消</Text>
          </Pressable>
          <Text style={[S.navTitle, { color: colors.foreground }]}>{isEdit ? "编辑员工档案" : "新增员工"}</Text>
          <Pressable onPress={handleSave} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

          {/* ── 基本信息 ── */}
          <SectionCard title="基本信息" colors={colors}>
            <FormRow label="员工代号" required colors={colors}>
              <TextInput value={code} onChangeText={setCode} placeholder="如 RG、Zik、权哥"
                placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="真实姓名" required colors={colors}>
              <TextInput value={realName} onChangeText={setRealName} placeholder="如 张三"
                placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="联系方式" colors={colors}>
              <TextInput value={phone} onChangeText={setPhone} placeholder="手机号"
                placeholderTextColor={colors.muted} keyboardType="phone-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="入职日期" colors={colors}>
              <TextInput value={joinDate} onChangeText={setJoinDate} placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
          </SectionCard>

          {/* ── 部门与类型 ── */}
          <SectionCard title="部门与类型" colors={colors}>
            <FormRow label="部门" colors={colors}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {DEPT_OPTIONS.map((d) => (
                  <TouchableOpacity key={d} onPress={() => { tap(); setDept(d); }}
                    style={[S.optionChip, { backgroundColor: dept === d ? DEPT_COLORS[d] : colors.surface, borderColor: dept === d ? DEPT_COLORS[d] : colors.border }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: dept === d ? "#fff" : colors.muted }}>{DEPT_LABELS[d]}</Text>
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
                      style={[S.optionChip, { backgroundColor: selected ? tColor : colors.surface, borderColor: selected ? tColor : colors.border }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: selected ? "#fff" : tColor }}>{t.label}</Text>
                      <Text style={{ fontSize: 10, color: selected ? "#ffffff99" : colors.muted }}>{t.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </FormRow>
                      <FormRow label="默认班次（排班表分组）" colors={colors}>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {availableSessions.map((tpl) => (
                  <TouchableOpacity key={tpl.id} onPress={() => { tap(); setDefaultSession(defaultSession === tpl.session ? undefined : tpl.session); }}
                    style={[S.optionChip, { backgroundColor: defaultSession === tpl.session ? tpl.color : colors.surface, borderColor: defaultSession === tpl.session ? tpl.color : colors.border }]}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: defaultSession === tpl.session ? "#fff" : tpl.color }} />
                      <Text style={{ fontSize: 13, fontWeight: "600", color: defaultSession === tpl.session ? "#fff" : colors.muted }}>{tpl.session}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={() => { tap(); setDefaultSession(undefined); }}
                  style={[S.optionChip, { backgroundColor: !defaultSession ? colors.primary + "22" : colors.surface, borderColor: !defaultSession ? colors.primary : colors.border }]}>
                  <Text style={{ fontSize: 13, color: !defaultSession ? colors.primary : colors.muted }}>未设置</Text>
                </TouchableOpacity>
              </View>
            </FormRow>
          </SectionCard>
          {/* ── 工资设置 ── */}
          <SectionCard title="工资设置" colors={colors}>
            {type === "longterm_parttime" && (
              <FormRow label="月度固定薪资（长期兼职）" colors={colors}>
                <TextInput value={monthlyFixedSalary} onChangeText={setMonthlyFixedSalary}
                  placeholder="0 = 按工时计算" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
            )}
            {isFulltime && (
              <>
                <FormRow label="底薪（月）" required colors={colors}>
                  <TextInput value={baseSalary} onChangeText={setBaseSalary} placeholder="如 10000"
                    placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <FormRow label="默认标准工时（无规则时使用）" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[6, 7, 8, 9, 10].map((h) => (
                      <TouchableOpacity key={h} onPress={() => { tap(); setStdHours(String(h)); }}
                        style={[S.numChip, { backgroundColor: stdHours === String(h) ? colors.primary : colors.surface, borderColor: stdHours === String(h) ? colors.primary : colors.border }]}>
                        <Text style={{ fontSize: 13, color: stdHours === String(h) ? "#fff" : colors.muted }}>{h}h</Text>
                      </TouchableOpacity>
                    ))}
                    <TextInput value={stdHours} onChangeText={setStdHours} keyboardType="decimal-pad"
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                </FormRow>

                {/* 灵活工时规则 */}
                <FormRow label="灵活标准工时（可增删改）" colors={colors}>
                  <View style={{ gap: 8 }}>
                    {weeklyHoursRules.map((rule) => (
                      <WeeklyHoursRuleRow
                        key={rule.id}
                        rule={rule}
                        colors={colors}
                        onUpdate={(patch) => updateHoursRule(rule.id, patch)}
                        onDelete={() => deleteHoursRule(rule.id)}
                      />
                    ))}
                    <TouchableOpacity
                      onPress={() => { tap(); addHoursRule(); }}
                      style={[S.addRuleBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
                      <IconSymbol name="plus" size={13} color={colors.primary} />
                      <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>添加工时规则</Text>
                    </TouchableOpacity>
                    {weeklyHoursRules.length > 0 && (
                      <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 16 }}>
                        提示：规则按顺序匹配，第一条命中的规则生效。未被规则覆盖的天使用默认标准工时 {stdHours}h。
                      </Text>
                    )}
                  </View>
                </FormRow>
                <FormRow label="月休息天数" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[2, 4, 6, 8].map((d) => (
                      <TouchableOpacity key={d} onPress={() => { tap(); setRestDays(String(d)); }}
                        style={[S.numChip, { backgroundColor: restDays === String(d) ? colors.primary : colors.surface, borderColor: restDays === String(d) ? colors.primary : colors.border }]}>
                        <Text style={{ fontSize: 13, color: restDays === String(d) ? "#fff" : colors.muted }}>{d}天</Text>
                      </TouchableOpacity>
                    ))}
                    <TextInput value={restDays} onChangeText={setRestDays} keyboardType="number-pad"
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                </FormRow>
                {dailyRatePreview > 0 && (
                  <View style={[S.dailyRatePreview, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>日薪预览（当月）</Text>
                    <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>¥{dailyRatePreview.toFixed(2)} / 天</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>¥{Number(baseSalary).toFixed(0)} ÷ ({daysInMonth}天 - {restDays}休)</Text>
                  </View>
                )}
              </>
            )}
            <FormRow label="时薪（元/小时）" required colors={colors}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {[25, 30, 35, 40, 45].map((r) => (
                  <TouchableOpacity key={r} onPress={() => { tap(); setHourlyRate(String(r)); }}
                    style={[S.numChip, { backgroundColor: hourlyRate === String(r) ? deptColor : colors.surface, borderColor: hourlyRate === String(r) ? deptColor : colors.border }]}>
                    <Text style={{ fontSize: 13, color: hourlyRate === String(r) ? "#fff" : colors.muted }}>¥{r}</Text>
                  </TouchableOpacity>
                ))}
                <TextInput value={hourlyRate} onChangeText={setHourlyRate} keyboardType="decimal-pad"
                  style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            </FormRow>
            {isFulltime && (
              <>
                <FormRow label="加班时薪" colors={colors}>
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
                <FormRow label="节假日倍率" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {HOLIDAY_MULTIPLIERS.map((m) => (
                      <TouchableOpacity key={m} onPress={() => { tap(); setHolidayMult(m); }}
                        style={[S.numChip, { backgroundColor: holidayMult === m ? colors.warning : colors.surface, borderColor: holidayMult === m ? colors.warning : colors.border }]}>
                        <Text style={{ fontSize: 13, color: holidayMult === m ? "#fff" : colors.muted }}>{m}x</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </FormRow>
              </>
            )}
          </SectionCard>

          {/* ── 银行卡信息 ── */}
          <SectionCard title="银行卡信息" colors={colors}>
            {bankAccounts.map((account) => (
              <View key={account.id} style={[S.bankCard, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "33" }]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{account.bankName}</Text>
                    {account.isDefault && (
                      <View style={{ backgroundColor: colors.primary + "22", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 10, color: colors.primary, fontWeight: "600" }}>默认</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 13, color: colors.muted, letterSpacing: 1 }}>{account.cardNumber}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>户名：{account.accountName}</Text>
                  {account.note ? <Text style={{ fontSize: 11, color: colors.muted }}>{account.note}</Text> : null}
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {/* 一键复制 */}
                  <TouchableOpacity onPress={() => handleCopyBankInfo(account)}
                    style={[S.iconBtn, { backgroundColor: colors.primary + "15" }]}>
                    <IconSymbol name="doc.on.doc.fill" size={14} color={colors.primary} />
                  </TouchableOpacity>
                  {/* 编辑 */}
                  <TouchableOpacity onPress={() => handleEditBank(account)}
                    style={[S.iconBtn, { backgroundColor: colors.surface }]}>
                    <IconSymbol name="pencil" size={14} color={colors.muted} />
                  </TouchableOpacity>
                  {/* 删除 */}
                  <TouchableOpacity onPress={() => handleDeleteBank(account.id)}
                    style={[S.iconBtn, { backgroundColor: colors.error + "15" }]}>
                    <IconSymbol name="trash.fill" size={14} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            {/* 添加银行卡表单 */}
            {showBankForm ? (
              <View style={[S.bankFormCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 10 }}>
                  {editingBankId ? "编辑银行卡" : "添加银行卡"}
                </Text>
                {[
                  { label: "户名（真实姓名）", value: bankAccountName, onChange: setBankAccountName, placeholder: "如 张三" },
                  { label: "开户行", value: bankName, onChange: setBankName, placeholder: "如 中国工商银行" },
                  { label: "银行卡号", value: bankCardNumber, onChange: setBankCardNumber, placeholder: "卡号", keyboard: "number-pad" as const },
                  { label: "备注（可选）", value: bankNote, onChange: setBankNote, placeholder: "如 工资卡" },
                ].map((field) => (
                  <View key={field.label} style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>{field.label}</Text>
                    <TextInput value={field.value} onChangeText={field.onChange} placeholder={field.placeholder}
                      placeholderTextColor={colors.muted} keyboardType={field.keyboard ?? "default"}
                      style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                ))}
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => { setShowBankForm(false); setEditingBankId(null); }}
                    style={[S.bankBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 14, color: colors.muted }}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleSaveBankAccount}
                    style={[S.bankBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>保存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => { tap(); setBankAccountName(realName); setShowBankForm(true); }}
                style={[S.addBankBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
                <IconSymbol name="plus" size={14} color={colors.primary} />
                <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>添加银行卡</Text>
              </TouchableOpacity>
            )}
          </SectionCard>

          {/* ── 调休规则 ── */}
          {isFulltime && (
            <SectionCard title="调休规则" colors={colors}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>开启加班换休</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>加班时数可换成调休假期，不计加班费</Text>
                </View>
                <TouchableOpacity onPress={() => { tap(); setCompOffEnabled(!compOffEnabled); }}
                  style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: compOffEnabled ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: compOffEnabled ? "flex-end" : "flex-start" }} />
                </TouchableOpacity>
              </View>
              {compOffEnabled && (
                <FormRow label="多少小时加班换一天休" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    {[6, 7, 8, 9, 10].map((h) => (
                      <TouchableOpacity key={h} onPress={() => { tap(); setCompOffHoursPerDay(String(h)); }}
                        style={[S.numChip, { backgroundColor: compOffHoursPerDay === String(h) ? colors.primary : colors.surface, borderColor: compOffHoursPerDay === String(h) ? colors.primary : colors.border }]}>
                        <Text style={{ fontSize: 13, color: compOffHoursPerDay === String(h) ? "#fff" : colors.muted }}>{h}h</Text>
                      </TouchableOpacity>
                    ))}
                    <TextInput value={compOffHoursPerDay} onChangeText={setCompOffHoursPerDay} keyboardType="decimal-pad"
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                </FormRow>
              )}
            </SectionCard>
          )}

          {/* ── 补贴设置 ── */}
          <SectionCard title="补贴设置" colors={colors}>
            {allowanceRules.map((rule) => (
              <View key={rule.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border + "44" }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    {(["meal_per_day", "transport_fixed", "custom_fixed"] as const).map((t) => (
                      <TouchableOpacity key={t} onPress={() => updateAllowanceRule(rule.id, { type: t })}
                        style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, backgroundColor: rule.type === t ? colors.primary : colors.surface, borderColor: rule.type === t ? colors.primary : colors.border }}>
                        <Text style={{ fontSize: 10, color: rule.type === t ? "#fff" : colors.muted }}>{t === "meal_per_day" ? "饭补/天" : t === "transport_fixed" ? "交通/月" : "自定义"}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <TextInput value={rule.label} onChangeText={(v) => updateAllowanceRule(rule.id, { label: v })} placeholder="名称" placeholderTextColor={colors.muted}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                    <TextInput value={String(rule.amount)} onChangeText={(v) => updateAllowanceRule(rule.id, { amount: Number(v) || 0 })} placeholder="金额" placeholderTextColor={colors.muted} keyboardType="decimal-pad"
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 70 }]} />
                    <Text style={{ fontSize: 11, color: colors.muted }}>{rule.type === "meal_per_day" ? "元/天" : "元/月"}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => deleteAllowanceRule(rule.id)} style={{ padding: 6 }}>
                  <IconSymbol name="trash" size={15} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity onPress={() => { tap(); addAllowanceRule(); }}
              style={[S.addRuleBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08", marginTop: 8 }]}>
              <IconSymbol name="plus" size={13} color={colors.primary} />
              <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>添加补贴项</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── 社保/公积金 ── */}
          <SectionCard title="社保 / 公积金" colors={colors}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>开启社保公积金计算</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>开启后将自动从应发薪资里扣除</Text>
              </View>
              <TouchableOpacity onPress={() => { tap(); setSiEnabled(!siEnabled); }}
                style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: siEnabled ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: siEnabled ? "flex-end" : "flex-start" }} />
              </TouchableOpacity>
            </View>
            {siEnabled && (
              <View style={{ gap: 10, marginTop: 8 }}>
                <FormRow label="城市（用于政策匹配）" colors={colors}>
                  <TextInput value={siCity} onChangeText={setSiCity} placeholder="如《上海》《北京》"
                    placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <FormRow label="社保基数（0=以工资为基数）" colors={colors}>
                  <TextInput value={siBase} onChangeText={setSiBase} placeholder="0" keyboardType="decimal-pad"
                    placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[
                    { label: "养老%", value: siPension, setter: setSiPension },
                    { label: "医疗%", value: siMedical, setter: setSiMedical },
                    { label: "失业%", value: siUnemployment, setter: setSiUnemployment },
                  ].map((item) => (
                    <View key={item.label} style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 4 }}>{item.label}</Text>
                      <TextInput value={item.value} onChangeText={item.setter} keyboardType="decimal-pad"
                        placeholderTextColor={colors.muted} style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 4 }}>公积金%</Text>
                    <TextInput value={siHousingFund} onChangeText={setSiHousingFund} keyboardType="decimal-pad"
                      placeholderTextColor={colors.muted} style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 4 }}>公积金基数（0=同社保）</Text>
                    <TextInput value={siHousingBase} onChangeText={setSiHousingBase} placeholder="0" keyboardType="decimal-pad"
                      placeholderTextColor={colors.muted} style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: "100%" }]} />
                  </View>
                </View>
              </View>
            )}
          </SectionCard>

          {/* ── 详细档案 ── */}
          <SectionCard title="详细档案" colors={colors}>
            <FormRow label="身份证号" colors={colors}>
              <TextInput value={idNumber} onChangeText={setIdNumber} placeholder="18位身份证号"
                placeholderTextColor={colors.muted} keyboardType="number-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="住址" colors={colors}>
              <TextInput value={address} onChangeText={setAddress} placeholder="现居住地址"
                placeholderTextColor={colors.muted} multiline
                style={[S.input, { color: colors.foreground, borderColor: colors.border, minHeight: 50 }]} />
            </FormRow>
            <FormRow label="健康证到期日期" colors={colors}>
              <TextInput value={healthCertExpiry} onChangeText={setHealthCertExpiry} placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
          </SectionCard>

          {/* ── 紧急联系人 ── */}
          <SectionCard title="紧急联系人" colors={colors}>
            <FormRow label="姓名" colors={colors}>
              <TextInput value={emergencyName} onChangeText={setEmergencyName} placeholder="紧急联系人姓名"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="关系" colors={colors}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {["父母", "配偶", "兄弟姐妹", "朋友", "其他"].map((r) => (
                  <TouchableOpacity key={r} onPress={() => { tap(); setEmergencyRelation(r); }}
                    style={[S.optionChip, { backgroundColor: emergencyRelation === r ? colors.primary : colors.surface, borderColor: emergencyRelation === r ? colors.primary : colors.border, paddingHorizontal: 10, paddingVertical: 6 }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: emergencyRelation === r ? "#fff" : colors.muted }}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput value={emergencyRelation} onChangeText={setEmergencyRelation} placeholder="或自定义关系"
                placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border, marginTop: 8 }]} />
            </FormRow>
            <FormRow label="电话" colors={colors}>
              <TextInput value={emergencyPhone} onChangeText={setEmergencyPhone} placeholder="紧急联系人电话"
                placeholderTextColor={colors.muted} keyboardType="phone-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
          </SectionCard>

          {/* ── 备注 ── */}
          <SectionCard title="备注" colors={colors}>
            <TextInput value={notes} onChangeText={setNotes} placeholder="备注信息（可选）"
              placeholderTextColor={colors.muted} multiline numberOfLines={3}
              style={[S.textarea, { color: colors.foreground, borderColor: colors.border }]} />
          </SectionCard>

          {/* ── 在职状态 ── */}
          <SectionCard title="状态" colors={colors}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {[{ v: true, label: "在职" }, { v: false, label: "离职" }].map((opt) => (
                <TouchableOpacity key={String(opt.v)} onPress={() => { tap(); setActive(opt.v); }}
                  style={[S.optionChip, { backgroundColor: active === opt.v ? (opt.v ? colors.success : colors.error) : colors.surface, borderColor: active === opt.v ? (opt.v ? colors.success : colors.error) : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: active === opt.v ? "#fff" : colors.muted }}>{opt.label}</Text>
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

// ─── 灵活工时规则行组件 ─────────────────────────────────────────────────────────────────────────────
const DAY_OPTIONS: Array<{ value: 0|1|2|3|4|5|6; label: string }> = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

function WeeklyHoursRuleRow({
  rule, colors, onUpdate, onDelete,
}: {
  rule: WeeklyHoursRule;
  colors: any;
  onUpdate: (patch: Partial<WeeklyHoursRule>) => void;
  onDelete: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);

  const fromLabel = DAY_OPTIONS.find((d) => d.value === rule.fromDay)?.label ?? "周一";
  const toLabel = DAY_OPTIONS.find((d) => d.value === rule.toDay)?.label ?? "周四";

  return (
    <View style={[WR.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* 开始星期 */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>开始</Text>
        <TouchableOpacity
          onPress={() => { tap(); setShowFromPicker((v) => !v); setShowToPicker(false); }}
          style={[WR.dayBtn, { borderColor: showFromPicker ? colors.primary : colors.border, backgroundColor: showFromPicker ? colors.primary + "15" : colors.surface }]}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: showFromPicker ? colors.primary : colors.foreground }}>{fromLabel}</Text>
          <IconSymbol name="chevron.down" size={10} color={colors.muted} />
        </TouchableOpacity>
        {showFromPicker && (
          <View style={[WR.picker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {DAY_OPTIONS.map((d) => (
              <TouchableOpacity key={d.value} onPress={() => { tap(); onUpdate({ fromDay: d.value }); setShowFromPicker(false); }}
                style={[WR.pickerItem, { backgroundColor: rule.fromDay === d.value ? colors.primary : "transparent" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: rule.fromDay === d.value ? "#fff" : colors.foreground }}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 18, marginHorizontal: 4 }}>至</Text>

      {/* 结束星期 */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>结束</Text>
        <TouchableOpacity
          onPress={() => { tap(); setShowToPicker((v) => !v); setShowFromPicker(false); }}
          style={[WR.dayBtn, { borderColor: showToPicker ? colors.primary : colors.border, backgroundColor: showToPicker ? colors.primary + "15" : colors.surface }]}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: showToPicker ? colors.primary : colors.foreground }}>{toLabel}</Text>
          <IconSymbol name="chevron.down" size={10} color={colors.muted} />
        </TouchableOpacity>
        {showToPicker && (
          <View style={[WR.picker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {DAY_OPTIONS.map((d) => (
              <TouchableOpacity key={d.value} onPress={() => { tap(); onUpdate({ toDay: d.value }); setShowToPicker(false); }}
                style={[WR.pickerItem, { backgroundColor: rule.toDay === d.value ? colors.primary : "transparent" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: rule.toDay === d.value ? "#fff" : colors.foreground }}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* 工时 */}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>每天工时</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <TextInput
            value={String(rule.hours)}
            onChangeText={(v) => onUpdate({ hours: Number(v) || 8 })}
            keyboardType="decimal-pad"
            style={[WR.hoursInput, { color: colors.foreground, borderColor: colors.border }]}
          />
          <Text style={{ fontSize: 12, color: colors.muted }}>h</Text>
        </View>
      </View>

      {/* 删除 */}
      <TouchableOpacity onPress={() => { tap(); onDelete(); }}
        style={[WR.deleteBtn, { backgroundColor: colors.error + "15" }]}>
        <IconSymbol name="trash.fill" size={13} color={colors.error} />
      </TouchableOpacity>
    </View>
  );
}

const WR = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", borderRadius: 10, borderWidth: 1, padding: 10, gap: 6 },
  dayBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
  picker: { position: "absolute", top: 34, left: 0, right: 0, zIndex: 100, borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  pickerItem: { paddingHorizontal: 10, paddingVertical: 8 },
  hoursInput: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6, fontSize: 14, width: 50, textAlign: "center" },
  deleteBtn: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 14 },
});

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
  bankCard: { flexDirection: "row", alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8, gap: 8 },
  bankFormCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  bankBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: "center" },
  addBankBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", paddingVertical: 12 },
  iconBtn: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  addRuleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", paddingVertical: 10 },
});
