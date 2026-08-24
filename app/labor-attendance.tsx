/**
 * 统一薪资总览页
 * - 收放式员工薪资卡（2行4列网格摘要）
 * - 考勤区：排班表自动推算（点击跳转考勤概况）
 * - 绩效补贴区：点击跳转绩效补贴页面
 * - 奖惩区：支持负数，可增删改
 * - 其他区：调休余额（加班换休/节假日调休分开显示）+ 本月兑换
 * - 备注、薪资汇总
 *
 * 即时同步：所有数据直接订阅 paySlips/attendances 响应式数组，
 * 任何 Store 更新立即触发重渲染，无需手动刷新。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/utils";
import { formatEditableMoney, moneyDraftToAmount, normalizeMoneyDraft, roundMoneyToCents } from "@/lib/labor/money-input";
import { numericColor, NUMERIC_TONE } from "@/lib/theme/numeric-color-tokens";
import { sortEmployeesByProfileOrder } from "@/lib/labor/employee-profile-order";
import {
  createCompOffCashOutSettlementSnapshot,
  getCompOffCashOutSettlementAmount,
  settleCompOffCashOut,
} from "@/lib/labor/comp-off-cashout-settlement";
import {
  Alert, FlatList, Platform, StyleSheet,
  Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import {
  useEmployeeStore, useAttendanceStore, usePaySlipStore,
  useCompOffBalanceEntryStore,
  useGlobalPayrollSettingsStore, useDeptOrderStore,
  useMonthCloseStore,
} from "@/lib/labor/store";
import { useSalaryAdvanceStore } from "@/lib/labor/advance-store";
import {
  Employee, MonthlyAttendance, PaySlip, RewardPenaltyItem,
  monthLabel,
} from "@/lib/labor/types";

const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
type AttendanceListRow = { kind: "header"; key: string; label: string; color: string; count: number } | { kind: "employee"; key: string; employee: Employee };

function calcTenure(joinDate?: string): string {
  if (!joinDate) return "";
  const start = new Date(joinDate);
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (months < 1) return "入职不满1月";
  if (months < 12) return `入职${months}月`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m > 0 ? `入职${y}年${m}月` : `入职${y}年`;
}

export default function LaborAttendancePage() {
  const { employeeId, month } = useLocalSearchParams<{ employeeId: string; month: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  // ── 唯一点位：直接订阅响应式数组，任何 Store 更新立即重渲染 ──
  const { employees } = useEmployeeStore();
  const { deptOrder } = useDeptOrderStore();
  const { records: attendances } = useAttendanceStore();
  const { paySlips, upsertPaySlip } = usePaySlipStore();
  const { entries: compOffEntries } = useCompOffBalanceEntryStore();
  const { advances } = useSalaryAdvanceStore();

  const currentMonth = month || new Date().toISOString().slice(0, 7);
  const [expandedId, setExpandedId] = useState<string>(employeeId || "");
  const [editingRewardFor, setEditingRewardFor] = useState<string>("");

  const activeEmployees = useMemo(
    () => sortEmployeesByProfileOrder(employees.filter((e) => e.active !== false && !e.archived), deptOrder),
    [employees, deptOrder],
  );
  // 性能优化：预建查找 Map，将 render 循环中的 O(n) find/filter 降为 O(1)
  const attMap = useMemo(() => {
    const m = new Map<string, typeof attendances[0]>();
    attendances.forEach((a) => { if (a.month === currentMonth) m.set(a.employeeId, a); });
    return m;
  }, [attendances, currentMonth]);
  const slipMap = useMemo(() => {
    const m = new Map<string, typeof paySlips[0]>();
    paySlips.forEach((s) => { if (s.month === currentMonth) m.set(s.employeeId, s); });
    return m;
  }, [paySlips, currentMonth]);
  const compOffByEmp = useMemo(() => {
    const m = new Map<string, typeof compOffEntries>();
    compOffEntries.forEach((e) => {
      if (!m.has(e.employeeId)) m.set(e.employeeId, []);
      m.get(e.employeeId)!.push(e);
    });
    return m;
  }, [compOffEntries]);

  const attendanceListRows = useMemo<AttendanceListRow[]>(() => {
    const groupDefinitions: { key: string; label: string; color: string; filter: (employee: Employee) => boolean }[] = [
      { key: "front", label: "前厅", color: "#007AFF", filter: (employee) => employee.dept === "front" && employee.type !== "parttime" },
      { key: "kitchen", label: "后厨", color: "#34C759", filter: (employee) => employee.dept === "kitchen" && employee.type !== "parttime" },
      { key: "other", label: "公司", color: "#722ED1", filter: (employee) => employee.dept === "other" && employee.type !== "parttime" },
      { key: "parttime", label: "临时兼职", color: "#FF9500", filter: (employee) => employee.type === "parttime" },
    ];
    return deptOrder.flatMap((key) => {
      const definition = groupDefinitions.find((entry) => entry.key === key) ?? groupDefinitions[0];
      const members = activeEmployees.filter(definition.filter);
      return members.length === 0 ? [] : [
        { kind: "header" as const, key: `header-${definition.key}`, label: definition.label, color: definition.color, count: members.length },
        ...members.map((employee) => ({ kind: "employee" as const, key: `employee-${employee.id}`, employee })),
      ];
    });
  }, [activeEmployees, deptOrder]);

  return (
    <ScreenContainer>
      <View style={[S.navbar, { paddingTop: 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
          <IconSymbol name="chevron.left" size={20} color={colors.primary} />
        </TouchableOpacity>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{monthLabel(currentMonth)} · 薪资总览</Text>
        <View style={{ width: 36 }} />
      </View>

      <FlatList<AttendanceListRow>
        data={attendanceListRows}
        keyExtractor={(row) => row.key}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== "web"}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 + insets.bottom, flexGrow: 1 }}
        renderItem={({ item: row }) => row.kind === "header" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingTop: 12, paddingBottom: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color }} />
            <Text style={{ fontSize: 13, fontWeight: "700", color: row.color }}>{row.label}</Text>
            <Text style={{ fontSize: 11, color: colors.muted }}>({row.count}人)</Text>
          </View>
        ) : (
          <EmployeeCard
            employee={row.employee}
            month={currentMonth}
            att={attMap.get(row.employee.id) ?? null}
            slip={slipMap.get(row.employee.id) ?? null}
            compOffEntries={compOffByEmp.get(row.employee.id) ?? []}
            advances={advances}
            expanded={expandedId === row.employee.id}
            onToggle={() => { tap(); setExpandedId(expandedId === row.employee.id ? "" : row.employee.id); }}
            colors={colors}
            upsertPaySlip={upsertPaySlip}
            editingReward={editingRewardFor === row.employee.id}
            onToggleRewardEdit={() => setEditingRewardFor(editingRewardFor === row.employee.id ? "" : row.employee.id)}
            router={router}
          />
        )}
      />
    </ScreenContainer>
  );
}

// ─── 员工卡片 ─────────────────────────────────────────────────────────────────
function EmployeeCard({
  employee, month, att, slip, compOffEntries,
  advances, expanded, onToggle, colors, upsertPaySlip,
  editingReward, onToggleRewardEdit, router,
}: {
  employee: Employee; month: string;
  att: MonthlyAttendance | null; slip: PaySlip | null;
  compOffEntries: any[];
  advances: any[]; expanded: boolean; onToggle: () => void; colors: any;
  upsertPaySlip: (slip: PaySlip) => void;
  editingReward: boolean; onToggleRewardEdit: () => void;
  router: any;
}) {
  // 修复：在卡片内直接调用 hooks，确保 saveRewards 能访问 buildPaySlipDraft 和 globalSettings
  const { buildPaySlipDraft } = usePaySlipStore();
  const { settings: globalSettings } = useGlobalPayrollSettingsStore();
  const { isMonthWritable } = useMonthCloseStore();
  const tenure = calcTenure(employee.joinDate);

    // ── 调休余额（useMemo 避免每次渲染重复 filter/reduce） ──
  const overtimeCompOff = useMemo(() =>
    compOffEntries
      .filter((e: any) => e.status === "available" && e.source === "overtime")
      .reduce((s: number, e: any) => s + (e.days ?? 0), 0),
    [compOffEntries]
  );
  const holidayCompOff = useMemo(() =>
    compOffEntries
      .filter((e: any) => e.status === "available" && e.source === "holiday")
      .reduce((s: number, e: any) => s + (e.days ?? 0), 0),
    [compOffEntries]
  );
  const totalCompOff = overtimeCompOff + holidayCompOff;
  // ── 本月调休兑换：只展示经事件账本验证的快照金额 ──
  const cashOutSettlementAmount = slip ? getCompOffCashOutSettlementAmount(slip) : 0;
  // ── 当月手动预支合计（useMemo 缓存）──
  // 过滤条件：employeeId + month（deductMonth 或 date 前缀）+ 未扣除/已扣除状态
  // 注意：这里只统计手动预支（advances），备用金已付由 slip.pettyLaborPaid 单独记录
  const advanceTotal = useMemo(() =>
    advances
      .filter((a: any) =>
        a.employeeId === employee.id &&
        (a.deductMonth === month || a.date?.startsWith(month)) &&
        (a.status === "pending" || a.status === "deducted")
      )
      .reduce((sum: number, a: any) => sum + (a.amount || 0), 0),
    [advances, employee.id, month]
  );

  const [rewardItems, setRewardItems] = useState<RewardPenaltyItem[]>(slip?.rewardPenaltyItems ?? []);
  const [rewardAmountDrafts, setRewardAmountDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries((slip?.rewardPenaltyItems ?? []).map((item) => [item.id, formatEditableMoney(item.amount)]))
  );
  // 备注状态：notes 为已保存的备注，noteInput 为编辑中的临时内容
  const [notes, setNotes] = useState(slip?.notes ?? "");
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteInput, setNoteInput] = useState(slip?.notes ?? "");
  // 当前实际备注内容：编辑中用 noteInput，未编辑用 notes
  const currentNotes = noteEditing ? noteInput : notes;

  // 防御性修复：slip prop 变化时（多设备同步/autoSync）同步本地 state
  // 只在用户未处于编辑状态时同步，避免覆盖用户正在输入的内容
  const slipId = slip?.id;
  const slipUpdatedAt = slip?.updatedAt;
  useEffect(() => {
    if (!editingReward) {
      const items = slip?.rewardPenaltyItems ?? [];
      setRewardItems(items);
      setRewardAmountDrafts(Object.fromEntries(items.map((item) => [item.id, formatEditableMoney(item.amount)])));
    }
  }, [slipId, slipUpdatedAt, editingReward]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!noteEditing) {
      const newNotes = slip?.notes ?? "";
      setNotes(newNotes);
      setNoteInput(newNotes);
    }
  }, [slipId, slipUpdatedAt, noteEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRewardItem = () => {
    const item = { id: Date.now().toString(), name: "", amount: 0, note: "" };
    setRewardItems([...rewardItems, item]);
    setRewardAmountDrafts((drafts) => ({ ...drafts, [item.id]: "" }));
  };
  const updateRewardItem = (id: string, field: keyof RewardPenaltyItem, value: any) => {
    setRewardItems(rewardItems.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };
  const updateRewardAmountDraft = (id: string, value: string) => {
    const draft = normalizeMoneyDraft(value);
    setRewardAmountDrafts((drafts) => ({ ...drafts, [id]: draft }));
    setRewardItems((items) => items.map((item) => {
      if (item.id !== id) return item;
      const amount = moneyDraftToAmount(draft);
      return { ...item, amount: item.amount < 0 ? -amount : amount };
    }));
  };
  const removeRewardItem = (id: string) => {
    Alert.alert("删除奖惩", "确定删除此条目？", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => {
        setRewardItems((items) => items.filter((i) => i.id !== id));
        setRewardAmountDrafts((drafts) => { const { [id]: _removed, ...next } = drafts; return next; });
      } },
    ]);
  };
  const saveRewards = useCallback(() => {
    if (!slip || !employee) return;
    // 锁定拦截：已确认发薪的月份不允许修改
    if (!isMonthWritable(month)) {
      Alert.alert("已锁定", "本月已确认发薪，如需修改请先进入差额调整模式。");
      return;
    }
    const normalizedItems = rewardItems.map((item) => ({ ...item, amount: roundMoneyToCents(item.amount) }));
    const totalReward = roundMoneyToCents(normalizedItems.reduce((sum, item) => sum + item.amount, 0));
    // 修复 Bug：先将新 rewardPenalty 写入 store，再调用 buildPaySlipDraft
    // 原因：buildPaySlipDraft 内部从 ref.current 读取 existing.rewardPenalty 来计算 grossSalary
    // 若先 buildPaySlipDraft 再覆盖 rewardPenalty，grossSalary 会基于旧值计算，导致应发薪资不正确
    upsertPaySlip({ ...slip, rewardPenalty: totalReward, rewardPenaltyItems: normalizedItems, notes: currentNotes });
    // 此时 ref.current 已更新，buildPaySlipDraft 能读到最新 rewardPenalty
    const settlement = settleCompOffCashOut(compOffEntries, employee.id, month);
    const draft = buildPaySlipDraft(
      employee,
      month,
      att ?? null,
      advanceTotal,
      globalSettings,
      undefined,
      undefined,
      settlement.lines.length > 0 ? createCompOffCashOutSettlementSnapshot(settlement) : undefined,
    );
    // draft 已包含所有控制字段（allowanceOverrides/workKPISelections/revenueActuals 等）
    // rewardPenalty/rewardPenaltyItems/notes 由 buildPaySlipDraft 内部从 existing 读取（Step 1 已写入）
    upsertPaySlip({ ...draft, id: slip.id });
    // 如果备注正在编辑中，同步到 notes state 并退出编辑态
    if (noteEditing) { setNotes(noteInput); setNoteEditing(false); }
    onToggleRewardEdit();
  }, [slip, employee, isMonthWritable, month, rewardItems, upsertPaySlip, currentNotes, compOffEntries, buildPaySlipDraft, att, advanceTotal, globalSettings, noteEditing, onToggleRewardEdit, noteInput]);

  // ── 收起状态：2行4列网格摘要 ──
  if (!expanded) {
    const attendanceSalary = att?.attendanceSalary ?? slip?.attendanceSalary ?? 0;
    const workKPI = slip?.workKPIBonus ?? 0;
    const revenueKPI = slip?.revenueKPIBonus ?? 0;
    const allowance = (slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0);
    const cashOut = slip ? getCompOffCashOutSettlementAmount(slip) : 0;
    // 已预支 = 手动预支 + 备用金已付（与展开状态保持一致）
    const advance = advanceTotal + (slip?.pettyLaborPaid ?? 0);
    const gross = slip?.grossSalary ?? 0;
    const final = slip?.finalSalary ?? 0;

    const grid1 = [
      { label: "考勤工资", value: attendanceSalary, color: numericColor(colors) },
      { label: "工作绩效", value: workKPI,           color: numericColor(colors, workKPI < 0 ? NUMERIC_TONE.negative : NUMERIC_TONE.value) },
      { label: "业绩绩效", value: revenueKPI,        color: numericColor(colors, revenueKPI < 0 ? NUMERIC_TONE.negative : NUMERIC_TONE.value) },
      { label: "补贴合计", value: allowance,         color: numericColor(colors) },
    ];
    const grid2 = [
      { label: "调休兑换", value: cashOut,  color: numericColor(colors) },
      { label: "已预支",   value: -advance, color: numericColor(colors) },
      { label: "应发",     value: gross,    color: numericColor(colors) },
      { label: "待发",     value: final,    color: numericColor(colors, NUMERIC_TONE.primary) },
    ];

    return (
      <TouchableOpacity onPress={onToggle} style={[S.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {/* 顶部：姓名 + 入职时间 */}
        <View style={S.cardHeader}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{employee.realName}</Text>
            {tenure ? <Text style={{ fontSize: 11, color: colors.muted }}>{tenure}</Text> : null}
          </View>
          <IconSymbol name="chevron.down" size={14} color={colors.muted} />
        </View>
        {/* 第一行：考勤工资 / 工作绩效 / 业绩绩效 / 补贴合计 */}
        <View style={[S.gridRow, { borderTopColor: colors.border }]}>
          {grid1.map((item) => (
            <View key={item.label} style={S.gridCell}>
              <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>{item.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: "700", color: item.color }}>
                {item.value !== 0 ? `¥${formatMoney(Math.abs(item.value))}` : "—"}
              </Text>
            </View>
          ))}
        </View>
        {/* 第二行：调休兑换 / 已预支 / 应发 / 待发 */}
        <View style={[S.gridRow, { borderTopColor: colors.border }]}>
          {grid2.map((item) => (
            <View key={item.label} style={S.gridCell}>
              <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 3 }}>{item.label}</Text>
              {/* 修复：加 adjustsFontSizeToFit 防止 iPhone SE 等小屏数字截断 */}
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 14, fontWeight: "700", color: item.color }}>
                {item.value !== 0 ? `${item.value < 0 ? "-" : ""}¥${formatMoney(Math.abs(item.value))}` : "—"}
              </Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
    );
  }

  // ── 展开状态 ──
  return (
    <View style={[S.card, S.cardExpanded, { backgroundColor: colors.surface, borderColor: colors.primary + "44" }]}>
      <TouchableOpacity onPress={onToggle} style={S.cardHeader}>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{employee.realName}</Text>
          {tenure ? <Text style={{ fontSize: 11, color: colors.muted }}>{tenure}</Text> : null}
        </View>
        <IconSymbol name="chevron.up" size={14} color={colors.primary} />
      </TouchableOpacity>

      {/* 考勤区（只读，点击跳转考勤概况） */}
      <TouchableOpacity
        onPress={() => router.push({ pathname: "/labor", params: { initialPage: "schedule" } } as any)}
        style={[S.section, { borderColor: colors.border }]}>
        <View style={S.sectionHeader}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>考勤（自动推算）</Text>
          <Text style={{ fontSize: 11, color: colors.primary }}>考勤概况 ›</Text>
        </View>
        {att ? (
          <View style={S.detailGrid}>
            <DetailRow label="实际到岗" value={`${att.attendanceDays - att.overtimeCompOffDays - att.balanceCompOffDays - att.holidayCompOffDays} 天`} colors={colors} bold />
            <DetailRow label="出勤/应出勤" value={`${att.attendanceDays} / ${att.expectedAttendanceDays} 天`} colors={colors} />
            <DetailRow label="实际工时" value={`${att.totalHours.toFixed(1)} h`} colors={colors} />
            <DetailRow label="标准工时" value={`${att.stdHours.toFixed(1)} h`} colors={colors} />
            <DetailRow label="原始加班" value={`${(att.overtimeHours ?? 0).toFixed(1)} h`} colors={colors} />
            <DetailRow label="加班换休" value={att.overtimeCompOffDays > 0 ? `${att.overtimeCompOffDays} 天（${att.overtimeCompOffHours.toFixed(1)} h）` : "—"} colors={colors} />
            <DetailRow label="计费加班" value={`${(att.paidOvertimeHours ?? 0).toFixed(1)} h`} colors={colors} />
            <DetailRow label="加班工资" value={att.overtimePay > 0 ? `+¥${formatMoney(att.overtimePay)}` : "—"} colors={colors} positive={att.overtimePay > 0} />
            {(att.holidayWorkDays ?? 0) > 0 && <DetailRow label="节假日上班" value={`${att.holidayWorkDays} 天`} colors={colors} />}
            <DetailRow label="节假日薪资" value={att.holidayBonus > 0 ? `+¥${formatMoney(att.holidayBonus)}` : "—"} colors={colors} positive={att.holidayBonus > 0} />
            {att.underRestDays !== 0 && <DetailRow label={att.underRestDays > 0 ? "少出勤" : "多出勤"} value={`${Math.abs(att.underRestDays)} 天`} colors={colors} negative={att.underRestDays > 0} />}
            <DetailRow label="特殊状态扣薪" value={att.totalSpecialDeduction > 0 ? `-¥${formatMoney(att.totalSpecialDeduction)}` : "—"} colors={colors} negative={att.totalSpecialDeduction > 0} />
            <DetailRow label="日薪" value={`¥${formatMoney(att.dailyRate)}`} colors={colors} />
            <DetailRow label="总考勤工资" value={`¥${formatMoney(att.attendanceSalary)}`} colors={colors} bold />
          </View>
        ) : (
          <Text style={{ fontSize: 12, color: colors.muted, paddingVertical: 8 }}>暂无考勤数据（请先在排班表填写）</Text>
        )}
      </TouchableOpacity>

      {/* 绩效补贴区 */}
      <TouchableOpacity onPress={() => router.push({ pathname: "/labor-kpi-allowance", params: { employeeId: employee.id, month } } as any)}
        style={[S.section, { borderColor: colors.border }]}>
        <View style={S.sectionHeader}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>绩效补贴</Text>
          <Text style={{ fontSize: 11, color: colors.primary }}>详情 ›</Text>
        </View>
        <View style={S.detailGrid}>
          {/* 补贴展示全部三项，与薪资卡片综合额外展示保持一致 */}
          <DetailRow label="餐补" value={`¥${formatMoney((slip?.mealAllowance ?? 0))}`} colors={colors} />
          <DetailRow label="交通补贴" value={`¥${formatMoney((slip?.transportAllowance ?? 0))}`} colors={colors} />
          {(slip?.otherAllowance ?? 0) > 0 && <DetailRow label="其他补贴" value={`¥${formatMoney((slip?.otherAllowance ?? 0))}`} colors={colors} />}
          <DetailRow label="工作绩效" value={`¥${formatMoney((slip?.workKPIBonus ?? 0))}`} colors={colors} />
          <DetailRow label="业绩绩效" value={`¥${formatMoney((slip?.revenueKPIBonus ?? 0))}`} colors={colors} />
          {/* 综合额外 = 补贴合计 + 工作绩效 + 业绩绩效 + 奖惩小计，与 grossSalary 保持一致。 */}
          <DetailRow label="综合额外" value={`¥${formatMoney(((slip?.workKPIBonus ?? 0) + (slip?.revenueKPIBonus ?? 0) + (slip?.mealAllowance ?? 0) + (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0) + (slip?.rewardPenalty ?? 0)))}`} colors={colors} bold />
        </View>
      </TouchableOpacity>

      {/* 奖惩区（支持负数） */}
      <View style={[S.section, { borderColor: colors.border }]}>
        <View style={S.sectionHeader}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>奖惩</Text>
          <TouchableOpacity onPress={editingReward ? saveRewards : onToggleRewardEdit}>
            <Text style={{ fontSize: 11, color: editingReward ? colors.success : colors.primary, fontWeight: "600" }}>
              {editingReward ? "✓ 保存" : "编辑"}
            </Text>
          </TouchableOpacity>
        </View>
        {rewardItems.length === 0 && !editingReward && (
          <Text style={{ fontSize: 12, color: colors.muted, paddingVertical: 8 }}>暂无奖惩条目</Text>
        )}
        {rewardItems.map((item) => (
          <View key={item.id} style={[S.rewardRow, { borderBottomColor: colors.border }]}>
            {editingReward ? (
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <TextInput value={item.name} onChangeText={(v) => updateRewardItem(item.id, "name", v)}
                    placeholder="名称" placeholderTextColor={colors.muted}
                    style={[S.rewardInput, { flex: 1, color: colors.foreground, borderColor: colors.border }]} />
                  <TouchableOpacity onPress={() => updateRewardItem(item.id, "amount", -item.amount)}
                    style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
                      backgroundColor: item.amount < 0 ? colors.error + "22" : colors.success + "22" }}>
                    <Text style={{ fontSize: 13, fontWeight: "700",
                      color: item.amount < 0 ? colors.error : colors.success }}>
                      {item.amount < 0 ? "−" : "+"}
                    </Text>
                  </TouchableOpacity>
                  <TextInput
                    value={rewardAmountDrafts[item.id] ?? formatEditableMoney(item.amount)}
                    onChangeText={(v) => updateRewardAmountDraft(item.id, v)}
                    onBlur={() => setRewardAmountDrafts((drafts) => ({ ...drafts, [item.id]: formatEditableMoney(item.amount) }))}
                    placeholder="金额（最多2位小数）" placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    style={[S.rewardInput, { width: 80, color: colors.foreground, borderColor: colors.border, textAlign: "center" }]} />
                  <TouchableOpacity onPress={() => removeRewardItem(item.id)} style={{ padding: 4 }}>
                    <IconSymbol name="trash" size={16} color={colors.error} />
                  </TouchableOpacity>
                </View>
                <TextInput value={item.note} onChangeText={(v) => updateRewardItem(item.id, "note", v)}
                  placeholder="说明（选填）" placeholderTextColor={colors.muted}
                  style={[S.rewardInput, { color: colors.foreground, borderColor: colors.border }]} />
              </View>
            ) : (
              <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View>
                  <Text style={{ fontSize: 13, color: colors.foreground }}>{item.name || "未命名"}</Text>
                  {item.note ? <Text style={{ fontSize: 11, color: colors.muted }}>{item.note}</Text> : null}
                </View>
                <Text style={{ fontSize: 14, fontWeight: "600", color: item.amount >= 0 ? colors.success : colors.error }}>
                  {item.amount >= 0 ? `+¥${item.amount}` : `-¥${Math.abs(item.amount)}`}
                </Text>
              </View>
            )}
          </View>
        ))}
        {editingReward && (
          <TouchableOpacity onPress={addRewardItem} style={[S.addBtn, { borderColor: colors.primary + "44" }]}>
            <Text style={{ fontSize: 12, color: colors.primary }}>+ 添加奖惩条目</Text>
          </TouchableOpacity>
        )}
        {rewardItems.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <DetailRow
              label="奖惩小计"
              value={`${rewardItems.reduce((s, i) => s + i.amount, 0) >= 0 ? "+" : ""}¥${rewardItems.reduce((s, i) => s + i.amount, 0)}`}
              colors={colors} bold
            />
          </View>
        )}
      </View>

      {/* 其他区：调休余额拆分 + 本月兑换 */}
      <View style={[S.section, { borderColor: colors.border }]}>
        <Text style={[S.sectionTitle, { color: colors.muted, marginBottom: 8 }]}>其他</Text>
        {overtimeCompOff > 0 && (
          <DetailRow label="调休余额（加班换休）" value={`${overtimeCompOff.toFixed(1)} 天`} colors={colors} />
        )}
        {holidayCompOff > 0 && (
          <DetailRow label="调休余额（节假日调休）" value={`${holidayCompOff.toFixed(1)} 天`} colors={colors} />
        )}
        {totalCompOff === 0 && (
          <DetailRow label="调休余额" value="0 天" colors={colors} />
        )}
        {cashOutSettlementAmount > 0 && (
          <DetailRow label="本月调休兑换" value={`+¥${formatMoney(cashOutSettlementAmount)}`} colors={colors} positive />
        )}
        {/* 已预支 = 手动预支（advanceTotal）+ 备用金已付（pettyLaborPaid）合并展示 */}
        {(() => {
          const totalAdvance = advanceTotal + (slip?.pettyLaborPaid ?? 0);
          return <DetailRow label="已预支" value={totalAdvance > 0 ? `-¥${formatMoney(totalAdvance)}` : "¥0"} colors={colors} negative={totalAdvance > 0} />;
        })()}
      </View>

      {/* 备注 */}
      <View style={[S.section, { borderColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <Text style={[S.sectionTitle, { color: colors.muted }]}>备注</Text>
          {!noteEditing ? (
            <TouchableOpacity
              onPress={() => { setNoteInput(notes); setNoteEditing(true); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "33" }}>
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>编辑</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                onPress={() => setNoteEditing(false)}
                style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const trimmed = noteInput.trim();
                  setNotes(trimmed);
                  if (slip) upsertPaySlip({ ...slip, notes: trimmed, updatedAt: new Date().toISOString() });
                  setNoteEditing(false);
                }}
                style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primary }}>
                <Text style={{ fontSize: 12, color: "#fff", fontWeight: "700" }}>保存</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {noteEditing ? (
          <TextInput
            value={noteInput}
            onChangeText={setNoteInput}
            placeholder="添加备注（如：含年终奖、代发差旅等）"
            placeholderTextColor={colors.muted}
            multiline
            autoFocus
            style={[S.notesInput, { color: colors.foreground, borderColor: colors.primary }]}
          />
        ) : notes ? (
          <TouchableOpacity onPress={() => { setNoteInput(notes); setNoteEditing(true); }} activeOpacity={0.7}>
            <Text style={{ fontSize: 13, color: colors.foreground, lineHeight: 20 }}>{notes}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => { setNoteInput(""); setNoteEditing(true); }}
            activeOpacity={0.7}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 4 }}>
            <IconSymbol name="plus.circle" size={14} color={colors.muted} />
            <Text style={{ fontSize: 13, color: colors.muted, fontStyle: "italic" }}>点击添加备注</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 薪资汇总 */}
      {slip && (
        <View style={[S.section, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
          <Text style={[S.sectionTitle, { color: colors.primary, marginBottom: 8 }]}>薪资汇总</Text>
          <DetailRow label="税前工资" value={`¥${formatMoney(slip.grossSalary)}`} colors={colors} />
          <DetailRow label="社保代缴（个人）" value={slip.socialInsuranceDeduction > 0 ? `-¥${formatMoney(slip.socialInsuranceDeduction)}` : "—"} colors={colors} negative={slip.socialInsuranceDeduction > 0} />
          <DetailRow label="公积金代缴（个人）" value={slip.housingFundDeduction > 0 ? `-¥${formatMoney(slip.housingFundDeduction)}` : "—"} colors={colors} negative={slip.housingFundDeduction > 0} />
          <DetailRow label="个税代缴" value={slip.incomeTax > 0 ? `-¥${formatMoney(slip.incomeTax)}` : "—"} colors={colors} negative={slip.incomeTax > 0} />
          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />
          <DetailRow label="实发薪资" value={`¥${formatMoney(slip.finalSalary)}`} colors={colors} bold primary />
          <View style={{ height: 8 }} />
          <DetailRow label="公司社保部分" value={slip.employerSocialInsurance > 0 ? `¥${formatMoney(slip.employerSocialInsurance)}` : "—"} colors={colors} muted />
          <DetailRow label="公司公积金部分" value={slip.employerHousingFund > 0 ? `¥${formatMoney(slip.employerHousingFund)}` : "—"} colors={colors} muted />
          <DetailRow label="公司总人力成本" value={`¥${formatMoney(slip.totalEmployerCost)}`} colors={colors} bold />
        </View>
      )}
    </View>
  );
}

// ─── 辅助组件 ─────────────────────────────────────────────────────────────────
function DetailRow({ label, value, colors, bold, negative, primary, muted: isMuted }: {
  label: string; value: string; colors: any; bold?: boolean; positive?: boolean; negative?: boolean; primary?: boolean; muted?: boolean;
}) {
  // 普通收入、补贴和扣款只靠正负号表达；颜色只强调主结果、真实异常和次要信息。
  const valueColor = numericColor(
    colors,
    primary ? NUMERIC_TONE.primary : negative ? NUMERIC_TONE.negative : isMuted ? NUMERIC_TONE.muted : NUMERIC_TONE.value,
  );
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 }}>
      {/* flex:1 + numberOfLines=1 防止 label 换行挤压 value 区域 */}
      <Text numberOfLines={1} style={{ fontSize: 13, color: colors.foreground, fontWeight: bold ? "600" : "400", flex: 1, marginRight: 8 }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontSize: 13, color: valueColor, fontWeight: bold ? "700" : "500", flexShrink: 0 }}>{value}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, height: 48 },
  navTitle: { fontSize: 16, fontWeight: "600" },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  cardExpanded: { borderWidth: 1.5 },
  cardHeader: { flexDirection: "row", alignItems: "center", padding: 12 },
  gridRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth },
  gridCell: { flex: 1, alignItems: "center", paddingVertical: 10, paddingHorizontal: 4 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, padding: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: "600" },
  detailGrid: { gap: 2 },
  warningBanner: { marginTop: 8, padding: 6, borderRadius: 6, borderWidth: 1 },
  rewardRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  rewardInput: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 13 },
  addBtn: { marginTop: 8, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", alignItems: "center" },
  notesInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 13, minHeight: 60, textAlignVertical: "top" },
});
