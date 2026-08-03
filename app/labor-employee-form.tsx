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
import { useEmployeeStore } from "@/lib/labor/store";
import {
  Employee, EmployeeDept, EmployeeType, EmployeeBankAccount,
  DEPT_LABELS, DEPT_COLORS, EMPLOYEE_TYPE_LABELS, EMPLOYEE_TYPE_COLORS,
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

  // ── 基本信息 ──
  const [code, setCode] = useState(existing?.code ?? "");
  const [realName, setRealName] = useState(existing?.realName ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [dept, setDept] = useState<EmployeeDept>(existing?.dept ?? "front");
  const [type, setType] = useState<EmployeeType>(existing?.type ?? "fulltime");
  const [joinDate, setJoinDate] = useState(existing?.joinDate ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? "");

  // ── 工资设置 ──
  const [baseSalary, setBaseSalary] = useState(String(existing?.baseSalary ?? ""));
  const [stdHours, setStdHours] = useState(String(existing?.stdHoursPerDay ?? "8"));
  const [restDays, setRestDays] = useState(String(existing?.restDaysPerMonth ?? "4"));
  const [hourlyRate, setHourlyRate] = useState(String(existing?.hourlyRate ?? "35"));
  const [overtimeRate, setOvertimeRate] = useState(String(existing?.overtimeHourlyRate ?? "35"));
  const [holidayMult, setHolidayMult] = useState(existing?.holidayMultiplier ?? 1.5);
  const [monthlyFixedSalary, setMonthlyFixedSalary] = useState(String(existing?.monthlyFixedSalary ?? "0"));

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
      bankAccounts,
      idNumber: idNumber.trim() || undefined,
      address: address.trim() || undefined,
      emergencyContactName: emergencyName.trim() || undefined,
      emergencyContactPhone: emergencyPhone.trim() || undefined,
      emergencyContactRelation: emergencyRelation.trim() || undefined,
      healthCertExpiry: healthCertExpiry.trim() || undefined,
      joinDate: joinDate.trim() || undefined,
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
                <FormRow label="每日标准工时" colors={colors}>
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
});
