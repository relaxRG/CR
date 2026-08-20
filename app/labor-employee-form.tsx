/**
 * 员工档案设置页（新增/编辑）
 * v3：修复社保/公积金/个税默认关闭Bug、灵活工时写入、日薪预览天数、绩效负数
 *     升级社保/公积金/个税卡片（联网更新+置信度+信息卡）
 *     重构详细档案（身份证照片/健康证照片）+ 紧急联系方式（实际住址）
 */
import React, { useCallback, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  ActionSheetIOS, Alert, Clipboard, Image, KeyboardAvoidingView, Linking,
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { MoneyInput } from "@/components/forms/MoneyInput";
import { useEmployeeStore, useCustomDeptStore } from "@/lib/labor/store";
import { ALLOWANCE_PRESETS, createAllowanceRule, type AllowanceRulePreset } from "@/lib/labor/allowance-rule-factory";
import {
  CUSTOM_ALLOWANCE_UNIT_OPTIONS,
  isPeriodicAllowanceUnit,
  normalizeAllowanceRuleForSave,
  validateAllowanceRulesForSave,
} from "@/lib/labor/allowance-rule-config";
import { isProtectedAllowancePreset } from "@/lib/labor/allowance-rule-semantics";
import {
  Employee, EmployeeDept, EmployeeType, EmployeeBankAccount, WeeklyHoursRule,
  AllowanceRule, SocialInsuranceConfig, InsuranceItem, HousingFundItem,
  IncomeTaxConfig, INCOME_TAX_BRACKETS,
  ALLOWANCE_UNIT_LABELS, ALLOWANCE_PERIOD_MODE_LABELS,
  WorkKPIRule,
  RevenueKPIRule, RevenueKPISource, RevenueKPIPayMode, RevenueKPICalcType,
  REVENUE_KPI_SOURCE_LABELS, REVENUE_KPI_CALC_TYPE_LABELS,

  calcDailyRate, getDaysInMonth,
  DEFAULT_SOCIAL_INSURANCE, DEFAULT_INCOME_TAX, BUILTIN_CITY_POLICIES, getCityPolicy, applyCityPolicy,
} from "@/lib/labor/types";

const TYPE_OPTIONS: { key: EmployeeType; label: string; desc: string }[] = [
  { key: "fulltime", label: "全职", desc: "底薪+加班，按月结算" },
  { key: "longterm_parttime", label: "长期兼职", desc: "固定排班，支持薪资预支" },
  { key: "parttime", label: "临时兼职", desc: "按次/按小时，无预支" },
];

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
  const { depts: customDepts, resolveEmployeeDept } = useCustomDeptStore();
  const [selectedDeptId, setSelectedDeptId] = useState<string>(
    existing ? resolveEmployeeDept(existing).id : customDepts[0]?.id ?? "dept_front"
  );
  const [type, setType] = useState<EmployeeType>(existing?.type ?? "fulltime");
  const [joinDate, setJoinDate] = useState(existing?.joinDate ?? "");
  const [leaveDate, setLeaveDate] = useState(existing?.leaveDate ?? "");
  const formatDateInput = (text: string, setter: (v: string) => void) => {
    const digits = text.replace(/\D/g, "").slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) formatted = digits.slice(0, 4) + "-" + digits.slice(4);
    if (digits.length > 6) formatted = digits.slice(0, 4) + "-" + digits.slice(4, 6) + "-" + digits.slice(6);
    setter(formatted);
  };
  const [active, setActive] = useState(existing?.active ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? "");

  // ── 工资设置 ──
  const [baseSalary, setBaseSalary] = useState(String(existing?.baseSalary ?? ""));
  // stdHours 已删除 UI，不再展示默认工时输入框，全部改用灵活工时规则
  const [restDays, setRestDays] = useState(String(existing?.restDaysPerMonth ?? "4"));
  const [hourlyRate, setHourlyRate] = useState(String(existing?.hourlyRate ?? "35"));
  const [overtimeRate, setOvertimeRate] = useState(String(existing?.overtimeHourlyRate ?? "35"));
  // 日薪分母始终使用当前自然月天数；不得允许仅修改预览而不影响实际薪资的伪配置。
  // 兼职计费模式：按天（daily）或按小时（hourly）
  // 优先读取已保存的 parttimeMode，新员工默认按小时
  const [parttimeMode, setParttimeMode] = useState<"daily" | "hourly">(
    existing?.parttimeMode ?? "hourly"
  );

  // ── 灵活工时规则 ──
  const [weeklyHoursRules, setWeeklyHoursRules] = useState<WeeklyHoursRule[]>(
    existing?.weeklyHoursRules ?? []
  );
  const addHoursRule = () => {
    const newRule: WeeklyHoursRule = {
      id: Date.now().toString(),
      fromDay: 1, toDay: 4,
      hours: 8, // 默认 8 小时，用户可自行修改
    };
    setWeeklyHoursRules((prev) => [...prev, newRule]);
  };
  const updateHoursRule = (id: string, patch: Partial<WeeklyHoursRule>) => {
    setWeeklyHoursRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };
  const deleteHoursRule = (id: string) => {
    setWeeklyHoursRules((prev) => prev.filter((r) => r.id !== id));
  };

  // ── 详细档案（身份证） ──
  const [idNumber, setIdNumber] = useState(existing?.idNumber ?? "");
  const [idCardFrontUrl, setIdCardFrontUrl] = useState(existing?.idCardFrontUrl ?? "");
  const [idCardBackUrl, setIdCardBackUrl] = useState(existing?.idCardBackUrl ?? "");
  // ── 详细档案（健康证） ──
  const [healthCertExpiry, setHealthCertExpiry] = useState(existing?.healthCertExpiry ?? "");
  const [healthCertUrl, setHealthCertUrl] = useState(existing?.healthCertUrl ?? "");
  // ── 紧急联系方式 ──
  const [actualAddress, setActualAddress] = useState(existing?.actualAddress ?? "");
  const [emergencyName, setEmergencyName] = useState(existing?.emergencyContactName ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(existing?.emergencyContactPhone ?? "");
  const [emergencyRelation, setEmergencyRelation] = useState(existing?.emergencyContactRelation ?? "");

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
  const [allowanceEditMode, setAllowanceEditMode] = useState(false);
  const addAllowanceRule = (preset?: AllowanceRulePreset) => {
    setAllowanceRules((prev) => [...prev, createAllowanceRule(Date.now().toString(), preset)]);
  };
  const updateAllowanceRule = (id: string, patch: Partial<AllowanceRule>) => {
    setAllowanceRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };
  const deleteAllowanceRule = (id: string) => setAllowanceRules((prev) => prev.filter((r) => r.id !== id));

  // ── 工作绩效（Task-based KPI） ──
  const [workKPIRules, setWorkKPIRules] = useState<WorkKPIRule[]>(existing?.workKPIRules ?? []);
  const [workKPIEditMode, setWorkKPIEditMode] = useState(false);
  const addWorkKPI = () => {
    setWorkKPIRules((prev) => [...prev, {
      id: Date.now().toString(), name: "", cycle: "monthly" as const, notes: "", enabled: true,
      tiers: [
        { id: "1", label: "优秀", amount: 200, sortOrder: 1 },
        { id: "2", label: "良好", amount: 100, sortOrder: 2 },
        { id: "3", label: "合格", amount: 0, sortOrder: 3 },
        { id: "4", label: "不合格", amount: -50, sortOrder: 4 },
      ],
    }]);
  };
  const updateWorkKPI = (id: string, patch: Partial<WorkKPIRule>) => {
    setWorkKPIRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };
  const deleteWorkKPI = (id: string) => setWorkKPIRules((prev) => prev.filter((r) => r.id !== id));

  // ── 业绩绩效（Revenue-based KPI） ──
  const [revenueKPIRules, setRevenueKPIRules] = useState<RevenueKPIRule[]>(existing?.revenueKPIRules ?? []);
  const [revenueKPIEditMode, setRevenueKPIEditMode] = useState(false);
  const addRevenueKPI = () => {
    setRevenueKPIRules((prev) => [...prev, {
      id: Date.now().toString(), name: "", source: "total_revenue" as RevenueKPISource,
      tiers: [{ id: "1", threshold: 50000, amount: 500, sortOrder: 1 }],
      payMode: "highest" as RevenueKPIPayMode, calcType: "fixed" as RevenueKPICalcType,
      enabled: true,
    }]);
  };
  const updateRevenueKPI = (id: string, patch: Partial<RevenueKPIRule>) => {
    setRevenueKPIRules((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  };
  const deleteRevenueKPI = (id: string) => setRevenueKPIRules((prev) => prev.filter((r) => r.id !== id));

  // ── 社保（五险）──
  // Bug修复：始终保存完整配置，enabled 字段控制开关，不保存 undefined
  const [siEnabled, setSiEnabled] = useState(existing?.socialInsurance?.enabled ?? false);
  const [siConfig, setSiConfig] = useState<SocialInsuranceConfig>(
    existing?.socialInsurance ?? { ...DEFAULT_SOCIAL_INSURANCE }
  );
  const [siCityInput, setSiCityInput] = useState(existing?.socialInsurance?.city ?? "");
  const [siUpdating, setSiUpdating] = useState(false);

  const handleCityAutoFill = (city: string) => {
    setSiCityInput(city);
    const policy = getCityPolicy(city);
    if (policy) {
      setSiConfig((prev) => applyCityPolicy({ ...prev, enabled: siEnabled }, policy));
    }
  };

  const handleOnlineUpdate = async () => {
    if (!siCityInput.trim()) { Alert.alert("请先填写城市"); return; }
    setSiUpdating(true);
    try {
      const policy = getCityPolicy(siCityInput);
      if (policy) {
        setSiConfig((prev) => applyCityPolicy({ ...prev, enabled: siEnabled }, policy));
        Alert.alert("更新成功", `已更新${policy.city}${policy.year}年社保政策数据\n数据来源：${policy.source}`);
      } else {
        Alert.alert("未找到城市数据", `暂无${siCityInput}的内置数据，请手动填写各险种比例。\n已支持城市：${BUILTIN_CITY_POLICIES.map((p) => p.city).join("、")}`);
      }
    } catch (e) {
      Alert.alert("更新失败", String(e));
    } finally {
      setSiUpdating(false);
    }
  };

  const updateInsuranceItem = (
    key: keyof Pick<SocialInsuranceConfig, "pension" | "medical" | "unemployment" | "workInjury" | "maternity">,
    patch: Partial<InsuranceItem>
  ) => {
    setSiConfig((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  // ── 公积金 ──
  // Bug修复：公积金开关独立，不依赖 siConfig.housingFund.enabled 的初始值
  const [hfEnabled, setHfEnabled] = useState(existing?.socialInsurance?.housingFund?.enabled ?? false);
  const [hfCityInput, setHfCityInput] = useState(existing?.socialInsurance?.city ?? "");
  const [hfUpdating, setHfUpdating] = useState(false);
  const updateHousingFund = (patch: Partial<HousingFundItem>) => {
    setSiConfig((prev) => ({ ...prev, housingFund: { ...prev.housingFund, ...patch } }));
  };

  const handleHfOnlineUpdate = async () => {
    if (!hfCityInput.trim()) { Alert.alert("请先填写城市"); return; }
    setHfUpdating(true);
    try {
      const policy = getCityPolicy(hfCityInput);
      if (policy) {
        setSiConfig((prev) => ({
          ...prev,
          housingFund: {
            ...prev.housingFund,
            employeeRate: policy.housingFund.employeeRate,
            employerRate: policy.housingFund.employerRate,
            baseMin: policy.housingFund.baseMin,
            baseMax: policy.housingFund.baseMax,
          },
          dataSource: "builtin",
          lastUpdated: new Date().toISOString(),
        }));
        Alert.alert("更新成功", `已更新${policy.city}${policy.year}年公积金数据`);
      } else {
        Alert.alert("未找到城市数据", `暂无${hfCityInput}的内置数据，请手动填写比例。`);
      }
    } catch (e) {
      Alert.alert("更新失败", String(e));
    } finally {
      setHfUpdating(false);
    }
  };

  // ── 个税 ──
  // Bug修复：始终保存完整配置，enabled 字段控制开关
  const [taxEnabled, setTaxEnabled] = useState(existing?.incomeTax?.enabled ?? false);
  const [taxConfig, setTaxConfig] = useState<IncomeTaxConfig>(
    existing?.incomeTax ?? { ...DEFAULT_INCOME_TAX }
  );
  const [taxUpdating, setTaxUpdating] = useState(false);

  const handleTaxOnlineUpdate = async () => {
    setTaxUpdating(true);
    try {
      // 个税为全国统一标准，内置数据即最新
      setTaxConfig((prev) => ({
        ...prev,
        threshold: 5000,
        dataSource: "builtin",
        lastUpdated: new Date().toISOString(),
      }));
      Alert.alert("更新成功", "已确认2025年个税标准：起征点¥5,000，税率表为全国统一标准。");
    } catch (e) {
      Alert.alert("更新失败", String(e));
    } finally {
      setTaxUpdating(false);
    }
  };

  // ── 日薪预览 ──
  const now = new Date();
  const daysInMonth = getDaysInMonth(now.getFullYear(), now.getMonth() + 1);
  const dailyRatePreview = useMemo(() => {
    const base = Number(baseSalary);
    const rest = Number(restDays);
    if (!base || isNaN(base)) return 0;
    return calcDailyRate(base, daysInMonth, rest);
  }, [baseSalary, restDays, daysInMonth]);

  // ── 日薪参考时薪（日薪 ÷ 平均灵活工时；只读且不参与实际薪资计算）──
  const autoHourlyRatePreview = useMemo(() => {
    if (dailyRatePreview <= 0) return 0;
    // 计算灵活工时规则的平均工时（所有规则的小时平均値）
    if (weeklyHoursRules.length === 0) return 0; // 无规则时不自动计算
    const avgHours = weeklyHoursRules.reduce((s, r) => s + r.hours, 0) / weeklyHoursRules.length;
    if (avgHours <= 0) return 0;
    return Math.round((dailyRatePreview / avgHours) * 100) / 100;
  }, [dailyRatePreview, weeklyHoursRules]);

  // ── 个税计算明细 ──
  const taxPreview = useMemo(() => {
    if (!taxEnabled) return null;
    const salary = Number(baseSalary) || 0;
    if (salary <= 0) return null;
    // 修复 Bug：社保基数应应用城市政策的上下限约束，与 calcSocialInsurance 保持一致
    const siDeduct = siEnabled ? (() => {
      const rawBase = siConfig.base > 0 ? siConfig.base : salary;
      const base = siConfig.baseMax > 0
        ? Math.min(siConfig.baseMax, Math.max(siConfig.baseMin, rawBase))
        : Math.max(siConfig.baseMin, rawBase);
      return (siConfig.pension.enabled ? base * siConfig.pension.employeeRate : 0) +
        (siConfig.medical.enabled ? base * siConfig.medical.employeeRate : 0) +
        (siConfig.unemployment.enabled ? base * siConfig.unemployment.employeeRate : 0) +
        (siConfig.workInjury.enabled ? base * siConfig.workInjury.employeeRate : 0) +
        (siConfig.maternity.enabled ? base * siConfig.maternity.employeeRate : 0);
    })() : 0;
    // 修复 Bug：公积金基数同样应应用上下限约束
    const hfDeduct = hfEnabled ? (() => {
      const hfRawBase = siConfig.housingFund.base > 0 ? siConfig.housingFund.base : salary;
      const hfBase = siConfig.housingFund.baseMax > 0
        ? Math.min(siConfig.housingFund.baseMax, Math.max(siConfig.housingFund.baseMin, hfRawBase))
        : Math.max(siConfig.housingFund.baseMin, hfRawBase);
      return hfBase * siConfig.housingFund.employeeRate;
    })() : 0;
    const threshold = taxConfig.threshold || 5000;
    const specialDeductions = taxConfig.specialDeductions || 0;
    const taxableIncome = Math.max(0, salary - threshold - siDeduct - hfDeduct - specialDeductions);
    // 月应纳税所得额对应年税率表（÷12换算）
    const annualIncome = taxableIncome * 12;
    const bracket = INCOME_TAX_BRACKETS.find((b) => annualIncome >= b.min && annualIncome < b.max) ?? INCOME_TAX_BRACKETS[0];
    const annualTax = Math.max(0, annualIncome * bracket.rate - bracket.quickDeduction);
    const monthlyTax = annualTax / 12;
    const netSalary = salary - siDeduct - hfDeduct - monthlyTax;
    return { salary, siDeduct, hfDeduct, threshold, specialDeductions, taxableIncome, bracket, monthlyTax, netSalary };
  }, [taxEnabled, baseSalary, siEnabled, siConfig, hfEnabled, taxConfig]);

  // ── 社保计算明细 ──
  const siPreview = useMemo(() => {
    if (!siEnabled) return null;
    const salary = Number(baseSalary) || 0;
    // 修复 Bug：社保基数应应用城市政策的上下限约束
    const rawBase = siConfig.base > 0 ? siConfig.base : salary;
    if (rawBase <= 0) return null;
    const base = siConfig.baseMax > 0
      ? Math.min(siConfig.baseMax, Math.max(siConfig.baseMin, rawBase))
      : Math.max(siConfig.baseMin, rawBase);
    const empTotal = (siConfig.pension.enabled ? base * siConfig.pension.employeeRate : 0) +
      (siConfig.medical.enabled ? base * siConfig.medical.employeeRate : 0) +
      (siConfig.unemployment.enabled ? base * siConfig.unemployment.employeeRate : 0) +
      (siConfig.workInjury.enabled ? base * siConfig.workInjury.employeeRate : 0) +
      (siConfig.maternity.enabled ? base * siConfig.maternity.employeeRate : 0);
    const erTotal = (siConfig.pension.enabled ? base * siConfig.pension.employerRate : 0) +
      (siConfig.medical.enabled ? base * siConfig.medical.employerRate : 0) +
      (siConfig.unemployment.enabled ? base * siConfig.unemployment.employerRate : 0) +
      (siConfig.workInjury.enabled ? base * siConfig.workInjury.employerRate : 0) +
      (siConfig.maternity.enabled ? base * siConfig.maternity.employerRate : 0);
    return { base, empTotal, erTotal };
  }, [siEnabled, siConfig, baseSalary]);

  // ── 公积金计算明细 ──
  const hfPreview = useMemo(() => {
    if (!hfEnabled) return null;
    const salary = Number(baseSalary) || 0;
    // 修复 Bug：公积金基数应应用上下限约束
    const hfRawBase = siConfig.housingFund.base > 0 ? siConfig.housingFund.base : salary;
    if (hfRawBase <= 0) return null;
    const hfBase = siConfig.housingFund.baseMax > 0
      ? Math.min(siConfig.housingFund.baseMax, Math.max(siConfig.housingFund.baseMin, hfRawBase))
      : Math.max(siConfig.housingFund.baseMin, hfRawBase);
    const empAmount = hfBase * siConfig.housingFund.employeeRate;
    const erAmount = hfBase * siConfig.housingFund.employerRate;
    return { base: hfBase, empAmount, erAmount, total: empAmount + erAmount };
  }, [hfEnabled, siConfig.housingFund, baseSalary]);

  const isFulltime = type === "fulltime";
  const deptColor = customDepts.find((d) => d.id === selectedDeptId)?.color ?? "#1677FF";

  // ── 图片选择 ──
  const handlePickImage = useCallback(async (
    setter: (uri: string) => void,
    label: string
  ) => {
    const options = [
      { text: "拍照", action: "camera" as const },
      { text: "从相册选择", action: "library" as const },
      { text: "取消", action: "cancel" as const },
    ];
    const doPickImage = async (kind: "camera" | "library") => {
      try {
        if (kind === "camera") {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("需要相机权限", "请在设置中允许访问相机", [
              { text: "去设置", onPress: () => Linking.openSettings() },
              { text: "取消", style: "cancel" },
            ]);
            return;
          }
        } else if (Platform.OS === "android") {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== "granted") {
            Alert.alert("需要相册权限", "请在设置中允许访问相册", [
              { text: "去设置", onPress: () => Linking.openSettings() },
              { text: "取消", style: "cancel" },
            ]);
            return;
          }
        }
        const result = kind === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.75, exif: false })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.75, exif: false });
        if (result.canceled || !result.assets?.[0]) return;
        const asset = result.assets[0];
        let sourceUri = asset.uri;
        if (Platform.OS === "ios" && asset.uri.startsWith("ph://")) {
          const cacheDir = `${FileSystem.cacheDirectory}employee-docs/`;
          const cacheDirInfo = await FileSystem.getInfoAsync(cacheDir);
          if (!cacheDirInfo.exists) await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
          const tmpPath = `${cacheDir}tmp_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: asset.uri, to: tmpPath });
          sourceUri = tmpPath;
        }
        try {
          const manipulated = await ImageManipulator.manipulateAsync(
            sourceUri,
            asset.width && asset.width > 1600 ? [{ resize: { width: 1600 } }] : [],
            { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
          );
          sourceUri = manipulated.uri;
        } catch { /* 压缩失败回退原图 */ }
        const dir = `${FileSystem.documentDirectory}employee-docs/`;
        const dirInfo = await FileSystem.getInfoAsync(dir);
        if (!dirInfo.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const destPath = `${dir}${Date.now()}.jpg`;
        await FileSystem.copyAsync({ from: sourceUri, to: destPath });
        setter(destPath);
      } catch (err) {
        Alert.alert("上传失败", String(err));
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: options.map((o) => o.text), cancelButtonIndex: 2, title: label },
        (index) => { if (index < 2) doPickImage(options[index].action as "camera" | "library"); }
      );
    } else {
      Alert.alert(label, "", [
        { text: "拍照", onPress: () => doPickImage("camera") },
        { text: "从相册选择", onPress: () => doPickImage("library") },
        { text: "取消", style: "cancel" },
      ]);
    }
  }, []);

  // ── 保存 ──
  const handleSave = () => {
    if (!code.trim()) { Alert.alert("请填写员工代号"); return; }
    if (!realName.trim()) { Alert.alert("请填写真实姓名"); return; }
    if (isFulltime && !baseSalary) { Alert.alert("请填写底薪"); return; }
    if ((type === "parttime" || type === "longterm_parttime") && parttimeMode === "hourly" && !hourlyRate) {
      Alert.alert("请填写兼职时薪");
      return;
    }

    const overtimeRateValue = overtimeRate.trim() === "" || Number.isNaN(Number(overtimeRate))
      ? (isFulltime ? autoHourlyRatePreview : Number(hourlyRate) || 0)
      : Number(overtimeRate);

    const allowanceValidationError = validateAllowanceRulesForSave(allowanceRules);
    if (allowanceValidationError) { Alert.alert("补贴设置", allowanceValidationError); return; }
    const normalizedAllowanceRules = allowanceRules.map(normalizeAllowanceRuleForSave);

    const draft: Omit<Employee, "id" | "createdAt"> = {
      code: code.trim(), realName: realName.trim(), phone: phone.trim(),
      dept: (customDepts.find((d) => d.id === selectedDeptId)?.category ?? "front") as EmployeeDept,
      customDeptId: selectedDeptId,
      type, active, notes: notes.trim(),
      // 兼职员工：baseSalary 仅在按天结算时为日薪，按小时结算时为 0
      baseSalary: Number(baseSalary) || 0,
      // stdHoursPerDay 保留字段向后兼容
      stdHoursPerDay: 0,
      // 兼职员工不依赖月休息天数，设为 0 避免影响 expectedAttendanceDays 计算
      restDaysPerMonth: (type === "parttime" || type === "longterm_parttime") ? 0 : (Number(restDays) || 4),
      // 全职日薪参考时薪由日薪 ÷ 平均灵活工时自动推导；兼职时薪保留人工输入。
      // 该字段仅兼容历史数据与加班时薪兜底，不作为全职的人工填写项。
      hourlyRate: isFulltime ? autoHourlyRatePreview : (Number(hourlyRate) || 0),
      // 加班时薪 / 兼职时薪（实际计算依据）；支持显式填写 0。
      overtimeHourlyRate: overtimeRateValue,
      // 兼职员工不需要灵活工时规则（无合同工时概念）
      weeklyHoursRules: (type === "parttime" || type === "longterm_parttime") ? undefined : (weeklyHoursRules.length > 0 ? weeklyHoursRules : undefined),
      // 兼职计费模式
      parttimeMode: (type === "parttime" || type === "longterm_parttime") ? parttimeMode : undefined,
      compOffRule: { enabled: compOffEnabled, hoursPerDay: Number(compOffHoursPerDay) || 8 },
      allowanceRules: normalizedAllowanceRules.length > 0 ? normalizedAllowanceRules : undefined,
      workKPIRules: workKPIRules.length > 0 ? workKPIRules : undefined,
      revenueKPIRules: revenueKPIRules.length > 0 ? revenueKPIRules : undefined,
      // Bug修复：始终保存完整配置，enabled 字段控制开关，不保存 undefined
      socialInsurance: { ...siConfig, enabled: siEnabled, city: siCityInput.trim(), housingFund: { ...siConfig.housingFund, enabled: hfEnabled } },
      incomeTax: { ...taxConfig, enabled: taxEnabled },
      bankAccounts,
      idNumber: idNumber.trim() || undefined,
      idCardFrontUrl: idCardFrontUrl || undefined,
      idCardBackUrl: idCardBackUrl || undefined,
      healthCertExpiry: healthCertExpiry.trim() || undefined,
      healthCertUrl: healthCertUrl || undefined,
      actualAddress: actualAddress.trim() || undefined,
      emergencyContactName: emergencyName.trim() || undefined,
      emergencyContactPhone: emergencyPhone.trim() || undefined,
      emergencyContactRelation: emergencyRelation.trim() || undefined,
      joinDate: joinDate.trim() || undefined,
      leaveDate: leaveDate.trim() || undefined,
    };

    if (isEdit && existing) updateEmployee(existing.id, draft);
    else addEmployee(draft);
    tap();
    router.back();
  };

  // ── 银行卡操作 ──
  const handleSaveBankAccount = () => {
    if (!bankName.trim() || !bankCardNumber.trim()) { Alert.alert("请填写开户行和卡号"); return; }
    if (editingBankId) {
      setBankAccounts((prev) => prev.map((b) => b.id === editingBankId
        ? { ...b, accountName: bankAccountName.trim(), bankName: bankName.trim(), cardNumber: bankCardNumber.trim(), note: bankNote.trim() }
        : b));
    } else {
      const newAccount: EmployeeBankAccount = {
        id: Date.now().toString(), accountName: bankAccountName.trim() || realName.trim(),
        bankName: bankName.trim(), cardNumber: bankCardNumber.trim(), note: bankNote.trim(),
        isDefault: bankAccounts.length === 0,
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

  const insets = useSafeAreaInsets();

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

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>

          {/* ── 基本信息 ── */}
          <SectionCard title="基本信息" colors={colors}>
            <FormRow label="员工代号" required colors={colors}>
              <TextInput value={code} onChangeText={setCode} placeholder="如 Jason、小宇"
                placeholderTextColor={colors.muted} autoCapitalize="none"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="真实姓名" required colors={colors}>
              <TextInput value={realName} onChangeText={setRealName} placeholder="真实姓名"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="联系方式" colors={colors}>
              <TextInput value={phone} onChangeText={setPhone} placeholder="手机号码"
                placeholderTextColor={colors.muted} keyboardType="phone-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
          </SectionCard>

          {/* ── 部门与类型 ── */}
          <SectionCard title="部门与类型" colors={colors}>
            <FormRow label="部门" colors={colors}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {customDepts.map((dept) => {
                  const selected = selectedDeptId === dept.id;
                  const color = dept.color ?? "#1677FF";
                  return (
                    <TouchableOpacity key={dept.id} onPress={() => { tap(); setSelectedDeptId(dept.id); }}
                      style={[S.optionChip, { backgroundColor: selected ? color + "22" : colors.surface, borderColor: selected ? color : colors.border }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: selected ? color : colors.muted }}>{dept.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </FormRow>
            <FormRow label="类型" colors={colors}>
              <View style={{ gap: 8 }}>
                {TYPE_OPTIONS.map((opt) => {
                  const selected = type === opt.key;
                  return (
                    <TouchableOpacity key={opt.key} onPress={() => { tap(); setType(opt.key); }}
                      style={[S.optionChip, { backgroundColor: selected ? deptColor + "22" : colors.surface, borderColor: selected ? deptColor : colors.border, flexDirection: "row", alignItems: "center", gap: 8 }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: selected ? deptColor : colors.muted }}>{opt.label}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{opt.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </FormRow>
          </SectionCard>

          {/* ── 工资设置 ── */}
          <SectionCard title="工资设置" colors={colors}>

            {isFulltime && (
              <>
                <FormRow label="底薪（月）" required colors={colors}>
                  <TextInput value={baseSalary} onChangeText={setBaseSalary}
                    placeholder="如 5600" keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                {/* 灵活标准工时（已删除默认工时输入框，全部改用灵活工时规则） */}
                <FormRow label="灵活标准工时" colors={colors}>
                  <View style={{ gap: 8 }}>
                    {weeklyHoursRules.length === 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, backgroundColor: colors.warning + "18", borderWidth: 1, borderColor: colors.warning + "44" }}>
                        <IconSymbol name="exclamationmark.triangle" size={14} color={colors.warning} />
                        <Text style={{ fontSize: 12, color: colors.warning, flex: 1 }}>请添加工时规则，未配置规则的天将不计入标准工时</Text>
                      </View>
                    )}
                    {weeklyHoursRules.map((rule) => (
                      <WeeklyHoursRuleRow
                        key={rule.id} rule={rule} colors={colors}
                        onUpdate={(patch) => updateHoursRule(rule.id, patch)}
                        onDelete={() => deleteHoursRule(rule.id)}
                      />
                    ))}
                    <TouchableOpacity onPress={() => { tap(); addHoursRule(); }}
                      style={[S.addRuleBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
                      <IconSymbol name="plus" size={13} color={colors.primary} />
                      <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>添加工时规则</Text>
                    </TouchableOpacity>
                    {weeklyHoursRules.length > 0 && (
                      <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 16 }}>
                        提示：规则按顺序匹配，第一条命中的规则生效。未被规则覆盖的天将不计入标准工时，请确保所有工作日均被覆盖。
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
                <FormRow label="日薪计薪天数" colors={colors}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={[S.inputSmall, { width: 76, borderColor: colors.border, justifyContent: "center" }]}>
                      <Text style={{ fontSize: 16, color: colors.foreground, textAlign: "center" }}>{daysInMonth}</Text>
                    </View>
                    <Text style={{ fontSize: 12, color: colors.muted }}>天（自然月天数，自动计算）</Text>
                  </View>
                </FormRow>
                {dailyRatePreview > 0 && (
                  <View style={[S.dailyRatePreview, { backgroundColor: colors.primary + "0e", borderColor: colors.primary + "33" }]}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>日薪预览（当月）</Text>
                    <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>¥{formatMoney(dailyRatePreview)} / 天</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                      ¥{formatMoney(Number(baseSalary))} ÷ ({daysInMonth}天 - {restDays}休)（自然月计薪）
                    </Text>
                  </View>
                )}
              </>
            )}
            {/* 兼职员工：计费模式选择（按天 / 按小时） */}
            {(type === "parttime" || type === "longterm_parttime") && (
              <FormRow label="计费模式" colors={colors}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity onPress={() => { tap(); setParttimeMode("daily"); }}
                    style={[S.optionChip, { backgroundColor: parttimeMode === "daily" ? deptColor + "22" : colors.surface, borderColor: parttimeMode === "daily" ? deptColor : colors.border }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: parttimeMode === "daily" ? deptColor : colors.muted }}>按天结算</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { tap(); setParttimeMode("hourly"); }}
                    style={[S.optionChip, { backgroundColor: parttimeMode === "hourly" ? deptColor + "22" : colors.surface, borderColor: parttimeMode === "hourly" ? deptColor : colors.border }]}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: parttimeMode === "hourly" ? deptColor : colors.muted }}>按小时结算</Text>
                  </TouchableOpacity>
                </View>
              </FormRow>
            )}
            {/* 兼职按天：日薪 */}
            {(type === "parttime" || type === "longterm_parttime") && parttimeMode === "daily" && (
              <FormRow label="兼职日薪" required colors={colors}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <TextInput value={baseSalary} onChangeText={setBaseSalary}
                    placeholder="如 300" keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                    style={[S.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>元/天</Text>
                </View>
              </FormRow>
            )}
            {/* 兼职按小时：实际计薪时薪；全职不再提供“正常时薪”人工填写项。 */}
            {(type === "parttime" || type === "longterm_parttime") && parttimeMode === "hourly" && (
              <FormRow label="兼职时薪" required colors={colors}>
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
            )}
            {/* 加班时薪（全职员工实际计算依据） */}
            {isFulltime && (
              <FormRow label="加班时薪（实际计算）" colors={colors}>
                <View style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <TouchableOpacity disabled={autoHourlyRatePreview <= 0} onPress={() => { tap(); setOvertimeRate(String(autoHourlyRatePreview)); }}
                      style={[S.optionChip, { borderColor: colors.border, backgroundColor: overtimeRate === String(autoHourlyRatePreview) ? colors.primary + "15" : colors.surface, opacity: autoHourlyRatePreview > 0 ? 1 : 0.45 }]}>
                      <Text style={{ fontSize: 12, color: overtimeRate === String(autoHourlyRatePreview) ? colors.primary : colors.muted }}>采用日薪参考</Text>
                    </TouchableOpacity>
                    <TextInput value={overtimeRate} onChangeText={setOvertimeRate} keyboardType="decimal-pad"
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>元/小时</Text>
                  </View>
                  {autoHourlyRatePreview > 0 && (
                    <Text style={{ fontSize: 11, color: colors.muted }}>日薪参考：¥{formatMoney(autoHourlyRatePreview)}/小时（日薪 ÷ 平均工时，不参与实际计算）</Text>
                  )}
                  <Text style={{ fontSize: 11, color: colors.muted }}>加班工资、调休兑现均按此字段计算，支持填 0</Text>
                </View>
              </FormRow>
            )}
          </SectionCard>

          {/* ── 银行卡信息 ── */}
          <SectionCard title="银行卡信息" colors={colors}>
            {bankAccounts.map((account) => (
              <View key={account.id} style={[S.bankCard, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "33" }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{account.accountName}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{account.bankName}</Text>
                  <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 2, letterSpacing: 1 }}>
                    {account.cardNumber.replace(/(.{4})/g, "$1 ").trim()}
                  </Text>
                  {account.note ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{account.note}</Text> : null}
                </View>
                <View style={{ gap: 6 }}>
                  <TouchableOpacity onPress={() => handleCopyBankInfo(account)}
                    style={[S.iconBtn, { backgroundColor: colors.primary + "15" }]}>
                    <IconSymbol name="doc.on.doc" size={14} color={colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleEditBank(account)}
                    style={[S.iconBtn, { backgroundColor: colors.surface }]}>
                    <IconSymbol name="pencil" size={14} color={colors.muted} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeleteBank(account.id)}
                    style={[S.iconBtn, { backgroundColor: colors.error + "15" }]}>
                    <IconSymbol name="trash.fill" size={14} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {showBankForm && (
              <View style={[S.bankFormCard, { borderColor: colors.border }]}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground, marginBottom: 10 }}>
                  {editingBankId ? "编辑银行卡" : "添加银行卡"}
                </Text>
                <FormRow label="账户姓名" colors={colors}>
                  <TextInput value={bankAccountName} onChangeText={setBankAccountName} placeholder={realName || "账户姓名"}
                    placeholderTextColor={colors.muted}
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <FormRow label="开户行" colors={colors}>
                  <TextInput value={bankName} onChangeText={setBankName} placeholder="如 工商银行、招商银行"
                    placeholderTextColor={colors.muted}
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <FormRow label="卡号" colors={colors}>
                  <TextInput value={bankCardNumber} onChangeText={setBankCardNumber} placeholder="银行卡号"
                    placeholderTextColor={colors.muted} keyboardType="number-pad"
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <FormRow label="备注（可选）" colors={colors}>
                  <TextInput value={bankNote} onChangeText={setBankNote} placeholder="如 工资卡"
                    placeholderTextColor={colors.muted}
                    style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
                </FormRow>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => { setShowBankForm(false); setEditingBankId(null); }}
                    style={[S.bankBtn, { borderColor: colors.border }]}>
                    <Text style={{ fontSize: 14, color: colors.muted }}>取消</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleSaveBankAccount}
                    style={[S.bankBtn, { borderColor: colors.primary, backgroundColor: colors.primary + "15" }]}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.primary }}>保存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {!showBankForm && (
              <TouchableOpacity onPress={() => { tap(); setBankAccountName(realName); setShowBankForm(true); }}
                style={[S.addBankBtn, { borderColor: colors.primary + "44" }]}>
                <IconSymbol name="plus" size={14} color={colors.primary} />
                <Text style={{ fontSize: 13, color: colors.primary }}>添加银行卡</Text>
              </TouchableOpacity>
            )}
          </SectionCard>

          {/* ── 调休规则 ── */}
          {isFulltime && (
            <SectionCard title="调休规则" colors={colors}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
                <Text style={{ fontSize: 14, color: colors.foreground }}>开启调休换休</Text>
                <TouchableOpacity onPress={() => { tap(); setCompOffEnabled(!compOffEnabled); }}
                  style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: compOffEnabled ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: compOffEnabled ? "flex-end" : "flex-start" }} />
                </TouchableOpacity>
              </View>
              {compOffEnabled && (
                <FormRow label="多少小时加班换一天休" colors={colors}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <TextInput value={compOffHoursPerDay} onChangeText={setCompOffHoursPerDay}
                      keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>小时</Text>
                  </View>
                </FormRow>
              )}
            </SectionCard>
          )}

          {/* ── 补贴设置 ── */}
          <SectionCard title="补贴设置" colors={colors} rightAction={
            <TouchableOpacity onPress={() => { tap(); setAllowanceEditMode(!allowanceEditMode); }}>
              <Text style={{ fontSize: 18, color: colors.muted }}>{allowanceEditMode ? "✓" : "⚙"}</Text>
            </TouchableOpacity>
          }>
            {!allowanceEditMode && allowanceRules.length === 0 && (
              <Text style={{ fontSize: 12, color: colors.muted }}>暂无补贴，点击 ⚙ 添加</Text>
            )}
            {allowanceEditMode && (
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {[ALLOWANCE_PRESETS.meal, ALLOWANCE_PRESETS.transport].map((preset) => (
                  <TouchableOpacity key={preset.label} onPress={() => { tap(); addAllowanceRule(preset); }}
                    style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }}>
                    <Text style={{ fontSize: 12, color: colors.primary }}>+ {preset.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {allowanceRules.map((rule) => {
              const isBusinessPreset = isProtectedAllowancePreset(rule);
              const isPeriodic = isPeriodicAllowanceUnit(rule.unit);
              const isRolling = rule.periodMode === "rolling";
              const periodKind = rule.unit === "per_quarter" ? "quarter" : "year";
              return (
                <View key={rule.id} style={{ paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  {allowanceEditMode ? (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput value={rule.label} onChangeText={(v) => updateAllowanceRule(rule.id, { label: v })} placeholder="补贴名称" placeholderTextColor={colors.muted}
                          style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                        <MoneyInput value={rule.amount} onValueChange={(amount) => updateAllowanceRule(rule.id, { amount })}
                          style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 70, textAlign: "center" }]} />
                        <Text style={{ fontSize: 11, color: colors.muted }}>{ALLOWANCE_UNIT_LABELS[rule.unit]}</Text>
                        <TouchableOpacity onPress={() => deleteAllowanceRule(rule.id)}>
                          <Text style={{ fontSize: 16, color: colors.error }}>×</Text>
                        </TouchableOpacity>
                      </View>

                      {isBusinessPreset ? (
                        <Text style={{ marginTop: 6, fontSize: 11, color: colors.muted }}>
                          {rule.type === "meal_per_day" ? "餐补固定按实际出勤天数结算" : "交通补贴固定按月结算"}
                        </Text>
                      ) : (
                        <View style={{ marginTop: 8, gap: 7 }}>
                          <Text style={{ fontSize: 11, color: colors.muted }}>发放单位</Text>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                            {CUSTOM_ALLOWANCE_UNIT_OPTIONS.map((unit) => {
                              const selected = rule.unit === unit;
                              return (
                                <TouchableOpacity key={unit} onPress={() => updateAllowanceRule(rule.id, {
                                  unit,
                                  periodMode: isPeriodicAllowanceUnit(unit) ? (rule.periodMode ?? "natural") : undefined,
                                  effectiveMonth: isPeriodicAllowanceUnit(unit) && (rule.periodMode ?? "natural") === "rolling"
                                    ? (rule.effectiveMonth ?? new Date().toISOString().slice(0, 7))
                                    : undefined,
                                })}
                                  style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "12" : colors.surface }}>
                                  <Text style={{ fontSize: 11, color: selected ? colors.primary : colors.foreground }}>{ALLOWANCE_UNIT_LABELS[unit]}</Text>
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          {isPeriodic && (
                            <>
                              <Text style={{ fontSize: 11, color: colors.muted }}>发放周期</Text>
                              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                                {(["natural", "rolling"] as const).map((periodMode) => {
                                  const selected = (rule.periodMode ?? "natural") === periodMode;
                                  return (
                                    <TouchableOpacity key={periodMode} onPress={() => updateAllowanceRule(rule.id, {
                                      periodMode,
                                      effectiveMonth: periodMode === "rolling" ? (rule.effectiveMonth ?? new Date().toISOString().slice(0, 7)) : undefined,
                                    })}
                                      style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary + "12" : colors.surface }}>
                                      <Text style={{ fontSize: 11, color: selected ? colors.primary : colors.foreground }}>{ALLOWANCE_PERIOD_MODE_LABELS[periodMode][periodKind]}</Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>
                              {isRolling && (
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                  <Text style={{ fontSize: 11, color: colors.muted }}>生效月</Text>
                                  <TextInput value={rule.effectiveMonth ?? ""} onChangeText={(v) => updateAllowanceRule(rule.id, { effectiveMonth: v })}
                                    placeholder="YYYY-MM" placeholderTextColor={colors.muted}
                                    style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 100, textAlign: "center" }]} />
                                </View>
                              )}
                            </>
                          )}
                        </View>
                      )}
                    </>
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: "500", color: colors.foreground, flex: 1 }}>{rule.label}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted }}>
                        ¥{rule.amount}/{rule.unit === "per_day" ? "天" : rule.unit === "per_month" ? "月" : rule.unit === "per_quarter" ? "季" : "年"}
                        {isPeriodic ? ` · ${(rule.periodMode ?? "natural") === "rolling" ? "滚动" : "自然"}` : ""}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
            {allowanceEditMode && (
              <TouchableOpacity onPress={() => { tap(); addAllowanceRule(); }}
                style={{ paddingVertical: 10, borderWidth: 1, borderColor: colors.primary, borderStyle: "dashed", borderRadius: 8, marginTop: 8, alignItems: "center" }}>
                <Text style={{ fontSize: 13, color: colors.primary }}>+ 添加自定义补贴</Text>
              </TouchableOpacity>
            )}
          </SectionCard>

          {/* ── 工作绩效（Task-based KPI） ── */}
          <SectionCard title="工作绩效" colors={colors} rightAction={
            <TouchableOpacity onPress={() => { tap(); setWorkKPIEditMode(!workKPIEditMode); }}>
              <Text style={{ fontSize: 18, color: colors.muted }}>{workKPIEditMode ? "✓" : "⚙"}</Text>
            </TouchableOpacity>
          }>
            {workKPIRules.map((rule) => (
              <View key={rule.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {workKPIEditMode ? (
                    <TextInput value={rule.name} onChangeText={(v) => updateWorkKPI(rule.id, { name: v })}
                      placeholder="绩效名称" placeholderTextColor={colors.muted}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, flex: 1 }}>{rule.name || "未命名"}</Text>
                  )}
                  {workKPIEditMode && (
                    <TouchableOpacity onPress={() => deleteWorkKPI(rule.id)} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 16, color: colors.error }}>🗑</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={{ marginTop: 8, gap: 4 }}>
                  {rule.tiers.sort((a, b) => a.sortOrder - b.sortOrder).map((tier) => (
                    <View key={tier.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {workKPIEditMode ? (
                        <>
                          <TextInput value={tier.label} onChangeText={(v) => {
                            const newTiers = rule.tiers.map((t) => t.id === tier.id ? { ...t, label: v } : t);
                            updateWorkKPI(rule.id, { tiers: newTiers });
                          }} placeholder="档位名" placeholderTextColor={colors.muted}
                            style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 70 }]} />
                          {/* 修复：绩效支持负数，使用 default keyboard 允许负号 */}
                          <MoneyInput
                            value={tier.amount}
                            allowNegative
                            onValueChange={(amount) => {
                              const newTiers = rule.tiers.map((t) => t.id === tier.id ? { ...t, amount } : t);
                              updateWorkKPI(rule.id, { tiers: newTiers });
                            }}
                            placeholder="金额（可负数）"
                            placeholderTextColor={colors.muted}
                            style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 90, textAlign: "center" }]}
                          />
                          <Text style={{ fontSize: 11, color: colors.muted }}>元</Text>
                          <TouchableOpacity onPress={() => {
                            const newTiers = rule.tiers.filter((t) => t.id !== tier.id);
                            updateWorkKPI(rule.id, { tiers: newTiers });
                          }}><Text style={{ fontSize: 14, color: colors.error }}>×</Text></TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tier.amount > 0 ? colors.success : tier.amount < 0 ? colors.error : colors.muted }} />
                          <Text style={{ fontSize: 13, color: colors.foreground, width: 60 }}>{tier.label}</Text>
                          <Text style={{ fontSize: 13, color: tier.amount > 0 ? colors.success : tier.amount < 0 ? colors.error : colors.muted, fontWeight: "500" }}>
                            {tier.amount > 0 ? `+¥${tier.amount}` : tier.amount < 0 ? `-¥${Math.abs(tier.amount)}` : "¥0"}
                          </Text>
                        </>
                      )}
                    </View>
                  ))}
                  {workKPIEditMode && (
                    <TouchableOpacity onPress={() => {
                      const newTiers = [...rule.tiers, { id: Date.now().toString(), label: "", amount: 0, sortOrder: rule.tiers.length + 1 }];
                      updateWorkKPI(rule.id, { tiers: newTiers });
                    }} style={{ paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.primary }}>+ 添加档位</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {workKPIEditMode && (
                  <View style={{ marginTop: 8, gap: 6 }}>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["monthly", "quarterly"] as const).map((c) => (
                        <TouchableOpacity key={c} onPress={() => updateWorkKPI(rule.id, { cycle: c })}
                          style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, backgroundColor: rule.cycle === c ? colors.primary : colors.surface, borderColor: rule.cycle === c ? colors.primary : colors.border }}>
                          <Text style={{ fontSize: 11, color: rule.cycle === c ? "#fff" : colors.muted }}>{c === "monthly" ? "每月" : "每季度"}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput value={rule.notes} onChangeText={(v) => updateWorkKPI(rule.id, { notes: v })}
                      placeholder="备注（可选）" placeholderTextColor={colors.muted} multiline
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border }]} />
                  </View>
                )}
              </View>
            ))}
            <TouchableOpacity onPress={() => { tap(); addWorkKPI(); }}
              style={{ paddingVertical: 12, borderWidth: 1, borderColor: colors.primary, borderStyle: "dashed", borderRadius: 8, marginTop: 8, alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: colors.primary }}>+ 添加工作绩效项</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── 业绩绩效（Revenue-based KPI） ── */}
          <SectionCard title="业绩绩效" colors={colors} rightAction={
            <TouchableOpacity onPress={() => { tap(); setRevenueKPIEditMode(!revenueKPIEditMode); }}>
              <Text style={{ fontSize: 18, color: colors.muted }}>{revenueKPIEditMode ? "✓" : "⚙"}</Text>
            </TouchableOpacity>
          }>
            {revenueKPIRules.map((rule) => (
              <View key={rule.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {revenueKPIEditMode ? (
                    <TextInput value={rule.name} onChangeText={(v) => updateRevenueKPI(rule.id, { name: v })}
                      placeholder="绩效名称" placeholderTextColor={colors.muted}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground, flex: 1 }}>{rule.name || "未命名"}</Text>
                  )}
                  {revenueKPIEditMode && (
                    <TouchableOpacity onPress={() => deleteRevenueKPI(rule.id)} style={{ padding: 4 }}>
                      <Text style={{ fontSize: 16, color: colors.error }}>🗑</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {revenueKPIEditMode && (
                  <View style={{ marginTop: 8, gap: 8 }}>
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      {(Object.keys(REVENUE_KPI_SOURCE_LABELS) as RevenueKPISource[]).map((s) => (
                        <TouchableOpacity key={s} onPress={() => updateRevenueKPI(rule.id, { source: s })}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, backgroundColor: rule.source === s ? colors.primary : colors.surface, borderColor: rule.source === s ? colors.primary : colors.border }}>
                          <Text style={{ fontSize: 11, color: rule.source === s ? "#fff" : colors.muted }}>{REVENUE_KPI_SOURCE_LABELS[s]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(Object.keys(REVENUE_KPI_CALC_TYPE_LABELS) as RevenueKPICalcType[]).map((ct) => (
                        <TouchableOpacity key={ct} onPress={() => updateRevenueKPI(rule.id, { calcType: ct })}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, backgroundColor: rule.calcType === ct ? colors.primary : colors.surface, borderColor: rule.calcType === ct ? colors.primary : colors.border }}>
                          <Text style={{ fontSize: 11, color: rule.calcType === ct ? "#fff" : colors.muted }}>{REVENUE_KPI_CALC_TYPE_LABELS[ct]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {rule.tiers.map((tier) => (
                      <View key={tier.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 11, color: colors.muted }}>≥¥</Text>
                        <MoneyInput value={tier.threshold} onValueChange={(threshold) => {
                          const newTiers = rule.tiers.map((t) => t.id === tier.id ? { ...t, threshold } : t);
                          updateRevenueKPI(rule.id, { tiers: newTiers });
                        }} style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 80 }]} />
                        <Text style={{ fontSize: 11, color: colors.muted }}>{rule.calcType === "percentage" ? "提成%" : "奖励¥"}</Text>
                        <MoneyInput value={tier.amount} onValueChange={(amount) => {
                          const newTiers = rule.tiers.map((t) => t.id === tier.id ? { ...t, amount } : t);
                          updateRevenueKPI(rule.id, { tiers: newTiers });
                        }} style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 70 }]} />
                        <TouchableOpacity onPress={() => {
                          const newTiers = rule.tiers.filter((t) => t.id !== tier.id);
                          updateRevenueKPI(rule.id, { tiers: newTiers });
                        }}><Text style={{ fontSize: 14, color: colors.error }}>×</Text></TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity onPress={() => {
                      const newTiers = [...rule.tiers, { id: Date.now().toString(), threshold: 0, amount: 0, sortOrder: rule.tiers.length + 1 }];
                      updateRevenueKPI(rule.id, { tiers: newTiers });
                    }} style={{ paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.primary }}>+ 添加档位</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {!revenueKPIEditMode && (
                  <View style={{ marginTop: 4, gap: 2 }}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{REVENUE_KPI_SOURCE_LABELS[rule.source]} · {REVENUE_KPI_CALC_TYPE_LABELS[rule.calcType]}</Text>
                    {rule.tiers.map((tier) => (
                      <Text key={tier.id} style={{ fontSize: 12, color: colors.foreground }}>
                        ≥¥{tier.threshold.toLocaleString()} → {rule.calcType === "percentage" ? `${tier.amount}%` : `+¥${tier.amount}`}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            ))}
            <TouchableOpacity onPress={() => { tap(); addRevenueKPI(); }}
              style={{ paddingVertical: 12, borderWidth: 1, borderColor: colors.primary, borderStyle: "dashed", borderRadius: 8, marginTop: 8, alignItems: "center" }}>
              <Text style={{ fontSize: 13, color: colors.primary }}>+ 添加业绩绩效项</Text>
            </TouchableOpacity>
          </SectionCard>

          {/* ── 社保（五险）── */}
          <SectionCard title="社保（五险）" colors={colors}>
            {/* 开关 */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>开启社保计算</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>个人部分从应发扣除，公司部分计入人力成本</Text>
              </View>
              <TouchableOpacity onPress={() => { tap(); setSiEnabled(!siEnabled); }}
                style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: siEnabled ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: siEnabled ? "flex-end" : "flex-start" }} />
              </TouchableOpacity>
            </View>
            {siEnabled && (
              <View style={{ gap: 12, marginTop: 4 }}>
                {/* 城市 + 联网更新 */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>城市（自动填充政策数据）</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput value={siCityInput} onChangeText={(v) => { setSiCityInput(v); handleCityAutoFill(v); }}
                      placeholder="如上海、北京、广州、深圳" placeholderTextColor={colors.muted}
                      style={[S.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                    <TouchableOpacity onPress={handleOnlineUpdate} disabled={siUpdating}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "44", justifyContent: "center" }}>
                      <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>{siUpdating ? "更新中..." : "联网更新 ↻"}</Text>
                    </TouchableOpacity>
                  </View>
                  {/* 快捷城市 */}
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    {["上海", "北京", "广州", "深圳", "杭州", "成都"].map((city) => (
                      <TouchableOpacity key={city} onPress={() => handleCityAutoFill(city)}
                        style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, backgroundColor: siCityInput === city ? colors.primary : colors.surface, borderColor: siCityInput === city ? colors.primary : colors.border }}>
                        <Text style={{ fontSize: 11, color: siCityInput === city ? "#fff" : colors.muted }}>{city}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* 置信度 */}
                  {siConfig.dataSource && (
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      置信度：● {siConfig.dataSource === "builtin" ? "高 · 内置数据 2025年" : siConfig.dataSource === "network" ? "高 · 联网数据" : "低（手动修改）"}
                      {siConfig.lastUpdated ? `  · 更新于 ${siConfig.lastUpdated.slice(0, 10)}` : ""}
                    </Text>
                  )}
                </View>
                {/* 社保基数 */}
                <FormRow label="社保基数（0=以工资为基数）" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <MoneyInput value={siConfig.base} onValueChange={(base) => setSiConfig((p) => ({ ...p, base }))}
                      placeholder="0" placeholderTextColor={colors.muted}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                    {siConfig.baseMin > 0 && <Text style={{ fontSize: 10, color: colors.muted }}>下限 ¥{siConfig.baseMin.toLocaleString()}</Text>}
                    {siConfig.baseMax > 0 && <Text style={{ fontSize: 10, color: colors.muted }}>上限 ¥{siConfig.baseMax.toLocaleString()}</Text>}
                  </View>
                </FormRow>
                {/* 险种表格（合并比例+金额同行） */}
                <View style={{ gap: 2 }}>
                  <View style={{ flexDirection: "row", paddingHorizontal: 4, paddingBottom: 6 }}>
                    <Text style={{ flex: 2, fontSize: 10, color: colors.muted }}>险种</Text>
                    <Text style={{ flex: 1.5, fontSize: 10, color: colors.muted, textAlign: "center" }}>个人%</Text>
                    <Text style={{ flex: 1.5, fontSize: 10, color: colors.muted, textAlign: "center" }}>个人金额</Text>
                    <Text style={{ flex: 1.5, fontSize: 10, color: colors.muted, textAlign: "center" }}>单位%</Text>
                    <Text style={{ flex: 1.5, fontSize: 10, color: colors.muted, textAlign: "center" }}>单位金额</Text>
                    <Text style={{ width: 32, fontSize: 10, color: colors.muted, textAlign: "center" }}>启用</Text>
                  </View>
                  {(["pension", "medical", "unemployment", "workInjury", "maternity"] as const).map((key) => {
                    const item = siConfig[key];
                    const base = siConfig.base > 0 ? siConfig.base : 0;
                    const empAmt = base > 0 && item.enabled ? (base * item.employeeRate).toFixed(0) : "-";
                    const erAmt = base > 0 && item.enabled ? (base * item.employerRate).toFixed(0) : "-";
                    return (
                      <View key={key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "44" }}>
                        <Text style={{ flex: 2, fontSize: 12, color: item.enabled ? colors.foreground : colors.muted }}>{item.name}</Text>
                        <MoneyInput value={item.employeeRate * 100} onValueChange={(percentage) => updateInsuranceItem(key, { employeeRate: percentage / 100 })}
                          style={[S.inputSmall, { flex: 1.5, color: colors.foreground, borderColor: colors.border, textAlign: "center", fontSize: 11 }]} />
                        <Text style={{ flex: 1.5, fontSize: 11, color: item.enabled ? colors.primary : colors.muted, textAlign: "center" }}>¥{empAmt}</Text>
                        <MoneyInput value={item.employerRate * 100} onValueChange={(percentage) => updateInsuranceItem(key, { employerRate: percentage / 100 })}
                          style={[S.inputSmall, { flex: 1.5, color: colors.foreground, borderColor: colors.border, textAlign: "center", fontSize: 11 }]} />
                        <Text style={{ flex: 1.5, fontSize: 11, color: item.enabled ? colors.warning : colors.muted, textAlign: "center" }}>¥{erAmt}</Text>
                        <TouchableOpacity onPress={() => updateInsuranceItem(key, { enabled: !item.enabled })} style={{ width: 32, alignItems: "center" }}>
                          <View style={{ width: 26, height: 15, borderRadius: 8, backgroundColor: item.enabled ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 1 }}>
                            <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: "#fff", alignSelf: item.enabled ? "flex-end" : "flex-start" }} />
                          </View>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
                {/* 社保信息卡 */}
                {siPreview && (
                  <View style={{ backgroundColor: colors.primary + "08", borderRadius: 10, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.primary + "22" }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary }}>ℹ 社保计算明细（基数 ¥{siPreview.base.toLocaleString()} · {siCityInput || "—"} 2025年）</Text>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                      <Text style={{ fontSize: 12, color: colors.foreground }}>个人合计：¥{formatMoney(siPreview.empTotal)}/月</Text>
                      <Text style={{ fontSize: 12, color: colors.warning }}>单位合计：¥{formatMoney(siPreview.erTotal)}/月</Text>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.muted }}>员工实发：底薪 - ¥{formatMoney(siPreview.empTotal)} = 到手工资减少 ¥{formatMoney(siPreview.empTotal)}</Text>
                  </View>
                )}
              </View>
            )}
          </SectionCard>

          {/* ── 住房公积金 ── */}
          <SectionCard title="住房公积金" colors={colors}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>开启公积金计算</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>个人+公司各承担一半，专项用于住房消费</Text>
              </View>
              <TouchableOpacity onPress={() => { tap(); setHfEnabled(!hfEnabled); }}
                style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: hfEnabled ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: hfEnabled ? "flex-end" : "flex-start" }} />
              </TouchableOpacity>
            </View>
            {hfEnabled && (
              <View style={{ gap: 12, marginTop: 4 }}>
                {/* 城市 + 联网更新 */}
                <View style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>城市</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <TextInput value={hfCityInput} onChangeText={setHfCityInput}
                      placeholder="如上海、北京" placeholderTextColor={colors.muted}
                      style={[S.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
                    <TouchableOpacity onPress={handleHfOnlineUpdate} disabled={hfUpdating}
                      style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "44", justifyContent: "center" }}>
                      <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>{hfUpdating ? "更新中..." : "联网更新 ↻"}</Text>
                    </TouchableOpacity>
                  </View>
                  {siConfig.dataSource && (
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      置信度：● {siConfig.dataSource === "builtin" ? "高 · 内置数据 2025年" : siConfig.dataSource === "network" ? "高 · 联网数据" : "低（手动修改）"}
                      {siConfig.lastUpdated ? `  · 更新于 ${siConfig.lastUpdated.slice(0, 10)}` : ""}
                    </Text>
                  )}
                </View>
                {/* 基数 */}
                <FormRow label="公积金基数（0=同社保）" colors={colors}>
                  <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                    <MoneyInput value={siConfig.housingFund.base} onValueChange={(base) => updateHousingFund({ base })}
                      placeholder="0" placeholderTextColor={colors.muted}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 100 }]} />
                    {siConfig.housingFund.baseMin > 0 && <Text style={{ fontSize: 10, color: colors.muted }}>下限 ¥{siConfig.housingFund.baseMin.toLocaleString()}</Text>}
                    {siConfig.housingFund.baseMax > 0 && <Text style={{ fontSize: 10, color: colors.muted }}>上限 ¥{siConfig.housingFund.baseMax.toLocaleString()}</Text>}
                  </View>
                </FormRow>
                {/* 比例 */}
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>个人比例</Text>
                    <MoneyInput value={siConfig.housingFund.employeeRate * 100} onValueChange={(percentage) => updateHousingFund({ employeeRate: percentage / 100 })}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 60, textAlign: "center" }]} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>%</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>单位比例</Text>
                    <MoneyInput value={siConfig.housingFund.employerRate * 100} onValueChange={(percentage) => updateHousingFund({ employerRate: percentage / 100 })}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 60, textAlign: "center" }]} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>%（范围 5%~12%）</Text>
                  </View>
                </View>
                {/* 公积金信息卡 */}
                {hfPreview && (
                  <View style={{ backgroundColor: colors.primary + "08", borderRadius: 10, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.primary + "22" }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary }}>ℹ 公积金计算明细（基数 ¥{hfPreview.base.toLocaleString()} · {hfCityInput || "—"} 2025年）</Text>
                    <Text style={{ fontSize: 12, color: colors.foreground, marginTop: 4 }}>
                      个人 ¥{hfPreview.base.toLocaleString()}×{(siConfig.housingFund.employeeRate * 100).toFixed(0)}%=¥{formatMoney(hfPreview.empAmount)}/月
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.warning }}>
                      单位 ¥{hfPreview.base.toLocaleString()}×{(siConfig.housingFund.employerRate * 100).toFixed(0)}%=¥{formatMoney(hfPreview.erAmount)}/月
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>合计缴存 ¥{formatMoney(hfPreview.total)}/月（计入员工公积金账户）</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>员工实发：底薪 - ¥{formatMoney(hfPreview.empAmount)} = 到手工资减少 ¥{formatMoney(hfPreview.empAmount)}</Text>
                  </View>
                )}
              </View>
            )}
          </SectionCard>

          {/* ── 个人所得税 ── */}
          <SectionCard title="个人所得税" colors={colors}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4, marginBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>开启个税计算</Text>
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>累计预扣法，自动扣除起征点 ¥5,000</Text>
              </View>
              <TouchableOpacity onPress={() => { tap(); setTaxEnabled(!taxEnabled); }}
                style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: taxEnabled ? colors.primary : colors.border, justifyContent: "center", paddingHorizontal: 2 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: taxEnabled ? "flex-end" : "flex-start" }} />
              </TouchableOpacity>
            </View>
            {taxEnabled && (
              <View style={{ gap: 12, marginTop: 4 }}>
                {/* 联网更新 + 置信度 */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <TouchableOpacity onPress={handleTaxOnlineUpdate} disabled={taxUpdating}
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "44" }}>
                    <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>{taxUpdating ? "更新中..." : "联网更新 ↻"}</Text>
                  </TouchableOpacity>
                  {taxConfig.dataSource && (
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      置信度：● {taxConfig.dataSource === "builtin" ? "高 · 全国统一 2025年" : "低（手动修改）"}
                      {taxConfig.lastUpdated ? `  · ${taxConfig.lastUpdated.slice(0, 10)}` : ""}
                    </Text>
                  )}
                </View>
                {/* 起征点 + 专项扣除 */}
                <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>起征点</Text>
                    <MoneyInput value={taxConfig.threshold} onValueChange={(threshold) => setTaxConfig((p) => ({ ...p, threshold }))}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 70 }]} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>元/月</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 12, color: colors.foreground }}>专项附加扣除</Text>
                    <MoneyInput value={taxConfig.specialDeductions} onValueChange={(specialDeductions) => setTaxConfig((p) => ({ ...p, specialDeductions }))}
                      style={[S.inputSmall, { color: colors.foreground, borderColor: colors.border, width: 70 }]} />
                    <Text style={{ fontSize: 12, color: colors.muted }}>元/月</Text>
                  </View>
                </View>
                {/* 税率表（系统内置） */}
                <View style={{ gap: 2 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>税率表（系统内置 · 2025年综合所得适用）</Text>
                  <View style={{ flexDirection: "row", paddingHorizontal: 4, paddingBottom: 4 }}>
                    <Text style={{ flex: 1, fontSize: 10, color: colors.muted }}>级数</Text>
                    <Text style={{ flex: 3, fontSize: 10, color: colors.muted }}>月应纳税所得额</Text>
                    <Text style={{ flex: 1, fontSize: 10, color: colors.muted, textAlign: "center" }}>税率</Text>
                    <Text style={{ flex: 1.5, fontSize: 10, color: colors.muted, textAlign: "right" }}>速算扣除数</Text>
                  </View>
                  {INCOME_TAX_BRACKETS.map((b, i) => (
                    <View key={i} style={{ flexDirection: "row", paddingVertical: 5, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "44" }}>
                      <Text style={{ flex: 1, fontSize: 11, color: colors.muted }}>{i + 1}</Text>
                      <Text style={{ flex: 3, fontSize: 11, color: colors.foreground }}>
                        {b.max === Infinity ? `超过 ¥${(b.min / 12).toLocaleString()}` : `¥${(b.min / 12).toLocaleString()} ~ ¥${(b.max / 12).toLocaleString()}`}
                      </Text>
                      <Text style={{ flex: 1, fontSize: 11, color: colors.primary, textAlign: "center" }}>{(b.rate * 100).toFixed(0)}%</Text>
                      <Text style={{ flex: 1.5, fontSize: 11, color: colors.muted, textAlign: "right" }}>¥{formatMoney((b.quickDeduction / 12))}</Text>
                    </View>
                  ))}
                </View>
                {/* 个税信息卡 */}
                {taxPreview && (
                  <View style={{ backgroundColor: colors.primary + "08", borderRadius: 10, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.primary + "22" }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary }}>
                      ℹ 个税计算明细（底薪¥{taxPreview.salary.toLocaleString()} · 社保¥{formatMoney(taxPreview.siDeduct)} · 公积金¥{formatMoney(taxPreview.hfDeduct)}）
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                      ¥{taxPreview.salary.toLocaleString()} - ¥{taxPreview.threshold.toLocaleString()} - ¥{formatMoney(taxPreview.siDeduct)} - ¥{formatMoney(taxPreview.hfDeduct)} - ¥{taxPreview.specialDeductions} = 应纳税所得额 ¥{formatMoney(taxPreview.taxableIncome)}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.foreground }}>
                      适用 {(taxPreview.bracket.rate * 100).toFixed(0)}% 档 · 应纳税额 ¥{formatMoney(taxPreview.monthlyTax)}/月
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.success }}>
                      员工实发：¥{formatMoney(taxPreview.netSalary)}/月
                    </Text>
                  </View>
                )}
              </View>
            )}
          </SectionCard>

          {/* ── 详细档案：身份证 ── */}
          <SectionCard title="身份证" colors={colors}>
            <FormRow label="真实姓名" colors={colors}>
              <TextInput value={realName} onChangeText={setRealName} placeholder="与身份证一致"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="身份证号" colors={colors}>
              <TextInput value={idNumber} onChangeText={setIdNumber} placeholder="18位身份证号"
                placeholderTextColor={colors.muted} keyboardType="number-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="身份证照片" colors={colors}>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <PhotoSlot
                  label="正面" uri={idCardFrontUrl} colors={colors}
                  onPick={() => handlePickImage(setIdCardFrontUrl, "上传身份证正面")}
                  onDelete={() => setIdCardFrontUrl("")}
                />
                <PhotoSlot
                  label="反面" uri={idCardBackUrl} colors={colors}
                  onPick={() => handlePickImage(setIdCardBackUrl, "上传身份证反面")}
                  onDelete={() => setIdCardBackUrl("")}
                />
              </View>
            </FormRow>
          </SectionCard>

          {/* ── 详细档案：健康证 ── */}
          <SectionCard title="健康证" colors={colors}>
            <FormRow label="有效期至" colors={colors}>
              <TextInput value={healthCertExpiry} onChangeText={setHealthCertExpiry} placeholder="YYYY-MM"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="健康证照片" colors={colors}>
              <PhotoSlot
                label="健康证" uri={healthCertUrl} colors={colors}
                onPick={() => handlePickImage(setHealthCertUrl, "上传健康证照片")}
                onDelete={() => setHealthCertUrl("")}
              />
            </FormRow>
          </SectionCard>

          {/* ── 紧急联系方式 ── */}
          <SectionCard title="紧急联系方式" colors={colors}>
            <FormRow label="实际住址" colors={colors}>
              <TextInput value={actualAddress} onChangeText={setActualAddress} placeholder="现居住地址"
                placeholderTextColor={colors.muted} multiline
                style={[S.input, { color: colors.foreground, borderColor: colors.border, minHeight: 50 }]} />
            </FormRow>
            <FormRow label="紧急联系人" colors={colors}>
              <TextInput value={emergencyName} onChangeText={setEmergencyName} placeholder="紧急联系人姓名"
                placeholderTextColor={colors.muted}
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="关系" colors={colors}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {["父母", "配偶", "兄弟姐妹", "朋友", "其他"].map((r) => (
                  <TouchableOpacity key={r} onPress={() => { tap(); setEmergencyRelation(r); }}
                    style={[S.optionChip, { backgroundColor: emergencyRelation === r ? colors.primary : colors.surface, borderColor: emergencyRelation === r ? colors.primary : colors.border, paddingHorizontal: 10, paddingVertical: 6 }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: emergencyRelation === r ? "#fff" : colors.muted }}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput value={emergencyRelation} onChangeText={setEmergencyRelation} placeholder="或自定义关系"
                placeholderTextColor={colors.muted} style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            <FormRow label="联系电话" colors={colors}>
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

          {/* ── 状态 ── */}
          <SectionCard title="状态" colors={colors}>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              {[{ v: true, label: "在职" }, { v: false, label: "离职" }].map((opt) => (
                <TouchableOpacity key={String(opt.v)} onPress={() => { tap(); setActive(opt.v); }}
                  style={[S.optionChip, { backgroundColor: active === opt.v ? (opt.v ? colors.success : colors.error) : colors.surface, borderColor: active === opt.v ? (opt.v ? colors.success : colors.error) : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: active === opt.v ? "#fff" : colors.muted }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <FormRow label="入职日期" colors={colors}>
              <TextInput value={joinDate} onChangeText={(t) => formatDateInput(t, setJoinDate)} placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.muted} keyboardType="number-pad"
                style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
            </FormRow>
            {!active && (
              <FormRow label="离职日期" colors={colors}>
                <TextInput value={leaveDate} onChangeText={(t) => formatDateInput(t, setLeaveDate)} placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted} keyboardType="number-pad"
                  style={[S.input, { color: colors.foreground, borderColor: colors.border }]} />
              </FormRow>
            )}
          </SectionCard>

        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ─── 照片插槽组件 ────────────────────────────────────────────────────────────────
function PhotoSlot({
  label, uri, colors, onPick, onDelete,
}: {
  label: string;
  uri: string;
  colors: any;
  onPick: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={{ alignItems: "center", gap: 4 }}>
      <TouchableOpacity onPress={onPick}
        style={{ width: 100, height: 70, borderRadius: 10, borderWidth: 1, borderStyle: uri ? "solid" : "dashed", borderColor: uri ? colors.primary + "66" : colors.border, backgroundColor: uri ? "transparent" : colors.surface, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {uri ? (
          <Image source={{ uri }} style={{ width: 100, height: 70, borderRadius: 10 }} resizeMode="cover" />
        ) : (
          <View style={{ alignItems: "center", gap: 4 }}>
            <IconSymbol name="camera" size={20} color={colors.muted} />
            <Text style={{ fontSize: 10, color: colors.muted }}>{label}</Text>
          </View>
        )}
      </TouchableOpacity>
      {uri ? (
        <TouchableOpacity onPress={onDelete}>
          <Text style={{ fontSize: 10, color: colors.error }}>删除</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── SectionCard ────────────────────────────────────────────────────────────────
function SectionCard({ title, children, colors, rightAction }: {
  title: string; children: React.ReactNode; colors: any; rightAction?: React.ReactNode;
}) {
  return (
    <View style={[S.sectionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Text style={[S.sectionTitle, { color: colors.muted }]}>{title.toUpperCase()}</Text>
        {rightAction}
      </View>
      {children}
    </View>
  );
}

// ─── FormRow ────────────────────────────────────────────────────────────────────
function FormRow({ label, required, children, colors }: {
  label: string; required?: boolean; children: React.ReactNode; colors: any;
}) {
  return (
    <View style={S.formRow}>
      <Text style={[S.formLabel, { color: colors.foreground }]}>
        {label}{required && <Text style={{ color: colors.error }}> *</Text>}
      </Text>
      {children}
    </View>
  );
}

// ─── 灵活工时规则行 ──────────────────────────────────────────────────────────────
const DAY_OPTIONS: Array<{ value: 0|1|2|3|4|5|6; label: string }> = [
  { value: 1, label: "周一" }, { value: 2, label: "周二" }, { value: 3, label: "周三" },
  { value: 4, label: "周四" }, { value: 5, label: "周五" }, { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

function WeeklyHoursRuleRow({
  rule, colors, onUpdate, onDelete,
}: {
  rule: WeeklyHoursRule; colors: any;
  onUpdate: (patch: Partial<WeeklyHoursRule>) => void;
  onDelete: () => void;
}) {
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  // 修复：使用本地 string 状态，失焦才转 Number，避免输入时被截断
  const [hoursStr, setHoursStr] = useState(String(rule.hours));

  const fromLabel = DAY_OPTIONS.find((d) => d.value === rule.fromDay)?.label ?? "周一";
  const toLabel = DAY_OPTIONS.find((d) => d.value === rule.toDay)?.label ?? "周四";

  return (
    <View style={[WR.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>开始</Text>
        <TouchableOpacity onPress={() => { tap(); setShowFromPicker((v) => !v); setShowToPicker(false); }}
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
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>结束</Text>
        <TouchableOpacity onPress={() => { tap(); setShowToPicker((v) => !v); setShowFromPicker(false); }}
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
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>每天工时</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <TextInput
            value={hoursStr}
            onChangeText={(v) => {
              const clean = v.replace(/[^0-9.]/g, "");
              setHoursStr(clean);
            }}
            onBlur={() => {
              const n = parseFloat(hoursStr);
              if (isNaN(n) || n < 0.5) { setHoursStr("0.5"); onUpdate({ hours: 0.5 }); }
              else if (n > 24) { setHoursStr("24"); onUpdate({ hours: 24 }); }
              else {
                const rounded = Math.round(n * 2) / 2;
                setHoursStr(String(rounded));
                onUpdate({ hours: rounded });
              }
            }}
            keyboardType="decimal-pad"
            style={[WR.hoursInput, { color: colors.foreground, borderColor: colors.border }]}
          />
          <Text style={{ fontSize: 12, color: colors.muted }}>h</Text>
        </View>
      </View>
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
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 0 },
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
