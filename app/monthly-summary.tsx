/**
 * 月度总报表主页面（Build 119C）
 *
 * 五个 Tab：
 *   总报表  — 完整科目树，防重复标注，净利润汇总
 *   账户    — 四账户余额追踪，差异分析
 *   薪资    — 薪资发放清单，一键复制
 *   货款    — 货款支付清单，已付/待付
 *   历史    — 历月净利润趋势
 */
import React, { useMemo, useState } from "react";
import {
  Alert, Clipboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { useEmployeeStore, usePaySlipStore } from "@/lib/labor/store";
import { useSpiritsInventoryStore } from "@/lib/spirits/crud-store";
import { calcMonthlyPourCost, pourCostColor } from "@/lib/spirits/pour-cost";
import { usePettyCashStore } from "@/lib/store/petty-store";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { useSupplierPurchaseStore } from "@/lib/food/ingredient-store";
import { useWineSnapshotStore, useWineManualPurchaseStore } from "@/lib/wine/store";
import { aggregateMonthlyReport } from "@/lib/store/monthly-summary/aggregator";
import {
  MonthlySummaryReport, SummaryLineItem, AccountBalance, MonthlyPaymentRecord,
  AccountType, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_COLORS,
  maskCardNumber, generatePaymentCopyText, SUPPLIER_CATEGORY_COLORS,
  PettyCodeConfig, InventoryReportConfig,
  DEFAULT_PETTY_CODE_CONFIGS, DEFAULT_INVENTORY_CONFIGS,
} from "@/lib/store/monthly-summary/types";
import { PETTY_CODE_LABELS, PETTY_GROUPS } from "@/lib/store/petty-store";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

type MainTab = "report" | "accounts" | "payroll" | "payments" | "history";

const TABS: { key: MainTab; label: string }[] = [
  { key: "report", label: "总报表" },
  { key: "accounts", label: "账户" },
  { key: "payroll", label: "薪资" },
  { key: "payments", label: "货款" },
  { key: "history", label: "历史" },
];

const CATEGORY_SECTIONS = [
  { key: "revenue", label: "本月收入", sign: 1, color: "#34C759" },
  { key: "cogs_food", label: "进货成本·食材", sign: -1, color: "#FF9500" },
  { key: "cogs_beverage", label: "进货成本·酒水", sign: -1, color: "#5856D6" },
  { key: "labor", label: "工资", sign: -1, color: "#FF3B30" },
  { key: "rent", label: "房租", sign: -1, color: "#007AFF" },
  { key: "utilities", label: "水电", sign: -1, color: "#00BCD4" },
  { key: "petty_other", label: "备用金其他费用", sign: -1, color: "#FF9500" },
  { key: "extra", label: "Extra INFO", sign: -1, color: "#8E8E93" },
];

// ─── 科目行组件 ───────────────────────────────────────────────────────────────
function LineItemRow({ item, colors }: { item: SummaryLineItem; colors: any }) {
  const isPositive = item.amount > 0;
  const amtColor = item.isDuplicate ? colors.muted : isPositive ? colors.success ?? "#34C759" : colors.error;

  return (
    <View style={[LI.row, { borderBottomColor: colors.border, opacity: item.isDuplicate ? 0.5 : 1 }]}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 13, color: item.isDuplicate ? colors.muted : colors.foreground }}>
            {item.label}
          </Text>
          {item.isDuplicate && (
            <View style={[LI.dupTag, { backgroundColor: colors.muted + "15" }]}>
              <Text style={{ fontSize: 9, color: colors.muted }}>已计算</Text>
            </View>
          )}
          {item.isPaid && !item.isDuplicate && (
            <View style={[LI.paidTag, { backgroundColor: "#34C75915" }]}>
              <Text style={{ fontSize: 9, color: "#34C759" }}>{item.paymentNote || "已付"}</Text>
            </View>
          )}
          {!item.isPaid && !item.isDuplicate && item.amount !== 0 && (
            <View style={[LI.unpaidTag, { backgroundColor: colors.error + "15" }]}>
              <Text style={{ fontSize: 9, color: colors.error }}>待付</Text>
            </View>
          )}
        </View>
        {item.notes ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{item.notes}</Text> : null}
        {item.isDuplicate && item.duplicateNote ? (
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 1, fontStyle: "italic" }}>{item.duplicateNote}</Text>
        ) : null}
      </View>
      <Text style={{ fontSize: 14, fontWeight: "700", color: amtColor, minWidth: 80, textAlign: "right" }}>
        {item.amount === 0 ? "—" : `${isPositive ? "+" : ""}¥${Math.abs(item.amount).toFixed(2)}`}
      </Text>
    </View>
  );
}

// ─── 手动录入 Modal ───────────────────────────────────────────────────────────
function ManualItemModal({ visible, item, colors, onSave, onClose }: {
  visible: boolean; item: SummaryLineItem | null; colors: any;
  onSave: (item: SummaryLineItem) => void; onClose: () => void;
}) {
  const [label, setLabel] = useState(item?.label ?? "");
  const [amount, setAmount] = useState(item ? String(Math.abs(item.amount)) : "");
  const [isExpense, setIsExpense] = useState(item ? item.amount < 0 : true);
  const [category, setCategory] = useState(item?.category ?? "revenue");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [paymentNote, setPaymentNote] = useState(item?.paymentNote ?? "");

  React.useEffect(() => {
    if (visible) {
      setLabel(item?.label ?? "");
      setAmount(item ? String(Math.abs(item.amount)) : "");
      setIsExpense(item ? item.amount < 0 : true);
      setCategory(item?.category ?? "revenue");
      setNotes(item?.notes ?? "");
      setPaymentNote(item?.paymentNote ?? "");
    }
  }, [visible, item]);

  const handleSave = () => {
    if (!label.trim()) { Alert.alert("请填写科目名称"); return; }
    const amt = Number(amount) || 0;
    onSave({
      id: item?.id ?? uuid(),
      code: item?.code ?? `manual_${uuid()}`,
      label: label.trim(),
      category: category as any,
      amount: isExpense ? -amt : amt,
      source: "manual",
      isPaid: false,
      paymentNote: paymentNote.trim(),
      isDuplicate: false,
      duplicateNote: "",
      isManual: true,
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[MI.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>{item ? "编辑科目" : "新增科目"}</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={[MI.section, { borderColor: colors.border }]}>
              <Text style={[MI.sectionTitle, { color: colors.muted }]}>科目信息</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>科目名称 *</Text>
              <TextInput value={label} onChangeText={setLabel} placeholder="如 房租、活动收入"
                placeholderTextColor={colors.muted} style={[MI.input, { color: colors.foreground, borderColor: colors.border }]} />
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>金额</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={() => setIsExpense(false)}
                  style={[MI.typeBtn, { backgroundColor: !isExpense ? "#34C75915" : colors.surface, borderColor: !isExpense ? "#34C759" : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: !isExpense ? "#34C759" : colors.muted }}>收入 +</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setIsExpense(true)}
                  style={[MI.typeBtn, { backgroundColor: isExpense ? colors.error + "15" : colors.surface, borderColor: isExpense ? colors.error : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: isExpense ? colors.error : colors.muted }}>支出 -</Text>
                </TouchableOpacity>
                <TextInput value={amount} onChangeText={setAmount} placeholder="0.00"
                  keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                  style={[MI.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>归属科目</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {CATEGORY_SECTIONS.map((cs) => (
                  <TouchableOpacity key={cs.key} onPress={() => setCategory(cs.key as any)}
                    style={[MI.catChip, { backgroundColor: category === cs.key ? cs.color : colors.surface, borderColor: category === cs.key ? cs.color : colors.border }]}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: category === cs.key ? "#fff" : cs.color }}>{cs.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>付款说明</Text>
              <TextInput value={paymentNote} onChangeText={setPaymentNote} placeholder="如 20号前付、已付(备用金)"
                placeholderTextColor={colors.muted} style={[MI.input, { color: colors.foreground, borderColor: colors.border }]} />
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>备注</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="备注信息"
                multiline numberOfLines={2} placeholderTextColor={colors.muted}
                style={[MI.input, { color: colors.foreground, borderColor: colors.border, height: 60, textAlignVertical: "top" }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 账户余额录入 Modal ────────────────────────────────────────────────────────
function BalanceModal({ visible, balance, accountType, month, colors, onSave, onClose }: {
  visible: boolean; balance: AccountBalance | null; accountType: AccountType; month: string;
  colors: any; onSave: (b: AccountBalance) => void; onClose: () => void;
}) {
  const [accountName, setAccountName] = useState(balance?.accountName ?? ACCOUNT_TYPE_LABELS[accountType]);
  const [opening, setOpening] = useState(balance ? String(balance.openingBalance) : "");
  const [closing, setClosing] = useState(balance ? String(balance.closingBalance) : "");
  const [varianceNote, setVarianceNote] = useState(balance?.varianceNote ?? "");

  React.useEffect(() => {
    if (visible) {
      setAccountName(balance?.accountName ?? ACCOUNT_TYPE_LABELS[accountType]);
      setOpening(balance ? String(balance.openingBalance) : "");
      setClosing(balance ? String(balance.closingBalance) : "");
      setVarianceNote(balance?.varianceNote ?? "");
    }
  }, [visible, balance, accountType]);

  const handleSave = () => {
    const ob = Number(opening) || 0;
    const cb = Number(closing) || 0;
    const now = new Date().toISOString();
    onSave({
      id: balance?.id ?? uuid(),
      month,
      accountType,
      accountName: accountName.trim(),
      openingBalance: ob,
      closingBalance: cb,
      computedClosingBalance: balance?.computedClosingBalance ?? 0,
      variance: cb - (balance?.computedClosingBalance ?? 0),
      varianceNote: varianceNote.trim(),
      isReconciled: false,
      inflows: balance?.inflows ?? [],
      outflows: balance?.outflows ?? [],
      createdAt: balance?.createdAt ?? now,
      updatedAt: now,
    });
    onClose();
  };

  const color = ACCOUNT_TYPE_COLORS[accountType];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[MI.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>录入账户余额</Text>
            <Pressable onPress={handleSave}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={[MI.section, { borderColor: color + "33", borderLeftColor: color, borderLeftWidth: 3 }]}>
              <Text style={{ fontSize: 14, fontWeight: "700", color, marginBottom: 12 }}>{ACCOUNT_TYPE_LABELS[accountType]}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>账户名称</Text>
              <TextInput value={accountName} onChangeText={setAccountName}
                placeholderTextColor={colors.muted} style={[MI.input, { color: colors.foreground, borderColor: colors.border }]} />
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>期初余额（月初实际余额）</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 16, color: colors.muted }}>¥</Text>
                <TextInput value={opening} onChangeText={setOpening} placeholder="0.00"
                  keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                  style={[MI.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>期末余额（月末实际余额，手动录入）</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 16, color: colors.muted }}>¥</Text>
                <TextInput value={closing} onChangeText={setClosing} placeholder="0.00"
                  keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                  style={[MI.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]} />
              </View>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6, lineHeight: 16 }}>
                系统将对比手动录入余额与计算余额，分析是否有金额纰漏。
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>差异说明（如有）</Text>
              <TextInput value={varianceNote} onChangeText={setVarianceNote}
                placeholder="如：含未到账美团结算款 ¥3,200" multiline numberOfLines={2}
                placeholderTextColor={colors.muted}
                style={[MI.input, { color: colors.foreground, borderColor: colors.border, height: 60, textAlignVertical: "top" }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function MonthlySummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const {
    reports, upsertReport, getReport, getPaymentsForMonth, getBalancesForMonth,
    upsertBalance, upsertPayment, addPaymentEntry, deletePayment, suppliers,
    pettyCodeConfigs, inventoryConfigs,
    upsertPettyCodeConfig, deletePettyCodeConfig, resetPettyCodeConfigs,
    upsertInventoryConfig, resetInventoryConfigs,
    getPettyCodeConfig, getInventoryConfig,
  } = useMonthlySummaryStore();
  const { employees } = useEmployeeStore();
  const paySlipStore = usePaySlipStore();
  const spiritsStore = useSpiritsInventoryStore();
  const pettyStore = usePettyCashStore();
  const monthlyReportStore = useMonthlyReportStore();
  const supplierPurchaseStore = useSupplierPurchaseStore();
  const wineSnapshotStore = useWineSnapshotStore();
  const wineManualPurchaseStore = useWineManualPurchaseStore();

  const [tab, setTab] = useState<MainTab>("report");
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingItem, setEditingItem] = useState<SummaryLineItem | null>(null);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceAccountType, setBalanceAccountType] = useState<AccountType>("company");
  const [editingBalance, setEditingBalance] = useState<AccountBalance | null>(null);
  const [copyToast, setCopyToast] = useState("");
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  // 部分付款 Modal
  const [showPartialPayModal, setShowPartialPayModal] = useState(false);
  const [partialPayTarget, setPartialPayTarget] = useState<MonthlyPaymentRecord | null>(null);
  const [partialPayAmount, setPartialPayAmount] = useState("");
  const [partialPayMethod, setPartialPayMethod] = useState("转账");
  const [partialPayAccountType, setPartialPayAccountType] = useState<"company" | "personal" | "petty" | "pos">("company");
  const [partialPayNotes, setPartialPayNotes] = useState("");
  // 月报设置 Modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"petty" | "inventory">("petty");
  // 手工新增货款卡片 Modal
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [addPaymentLabel, setAddPaymentLabel] = useState("");
  const [addPaymentAmount, setAddPaymentAmount] = useState("");
  const [addPaymentNotes, setAddPaymentNotes] = useState("");

  const report = useMemo(() => getReport(selectedMonth), [reports, selectedMonth]);
  const payments = useMemo(() => getPaymentsForMonth(selectedMonth), [selectedMonth]);
  const balances = useMemo(() => getBalancesForMonth(selectedMonth), [selectedMonth]);

  const handleCopy = (text: string) => {
    Clipboard.setString(text);
    setCopyToast("已复制到剪贴板");
    setTimeout(() => setCopyToast(""), 2000);
  };

  const getOrCreateReport = (): MonthlySummaryReport => {
    if (report) return report;
    const now = new Date().toISOString();
    const newReport: MonthlySummaryReport = {
      id: uuid(), month: selectedMonth, lineItems: [], manualItems: [],
      totalRevenue: 0, totalCOGS: 0, totalLabor: 0, totalRent: 0,
      totalUtilities: 0, totalPettyOther: 0, totalExtra: 0, netProfit: 0,
      accountBalances: [], paymentRecords: [], notes: "", isFinalized: false,
      createdAt: now, updatedAt: now,
    };
    upsertReport(newReport);
    return newReport;
  };

  const handleSaveManualItem = (item: SummaryLineItem) => {
    const r = getOrCreateReport();
    const existing = r.manualItems.findIndex((i) => i.id === item.id);
    const updated = existing >= 0
      ? r.manualItems.map((i) => i.id === item.id ? item : i)
      : [...r.manualItems, item];
    upsertReport({ ...r, manualItems: updated, updatedAt: new Date().toISOString() });
  };

  const handleDeleteManualItem = (id: string) => {
    const r = getOrCreateReport();
    upsertReport({ ...r, manualItems: r.manualItems.filter((i) => i.id !== id), updatedAt: new Date().toISOString() });
  };

  // 一键自动汇总：调用 aggregator 从各模块拉取数据并写入 lineItems
  const handleAutoAggregate = () => {
    tap();
    // 备用金原始记录
    const pettyRecords = pettyStore?.records?.filter((r: any) => r.date?.startsWith(selectedMonth)) ?? [];
    // 月度经营分析报告
    // 月度经营分析报告（rawMonth 格式 "2026/07"，需转换匹配）
    const monthlyReport = monthlyReportStore?.reports?.find((r: any) => {
      const raw: string = r.rawMonth ?? "";
      // rawMonth 可能是 "2026/07" 或 "2026-07"，统一转换后比较
      return raw.replace("/", "-") === selectedMonth;
    });
    // 薪资单
    const paySlips = paySlipStore?.paySlips?.filter((s: any) => s.month === selectedMonth) ?? [];
    // 烈酒进货汇总（按供应商分组）
    const monthPurchases = spiritsStore.getMonthPurchases(selectedMonth);
    const spiritSupplierMap: Record<string, { totalAmount: number; itemCount: number }> = {};
    monthPurchases.forEach((p: any) => {
      const sup = p.supplier ?? "未知";
      if (!spiritSupplierMap[sup]) spiritSupplierMap[sup] = { totalAmount: 0, itemCount: 0 };
      spiritSupplierMap[sup].totalAmount += p.amount;
      spiritSupplierMap[sup].itemCount += 1;
    });
    const spiritPurchaseSummary = Object.entries(spiritSupplierMap).map(([supplier, v]) => ({
      supplier,
      totalAmount: v.totalAmount,
      itemCount: v.itemCount,
      isPaid: false,
    }));
    // 食材进货记录（当月）
    const foodPurchaseRecords = supplierPurchaseStore?.records?.filter((r: any) => {
      // periodLabel 格式如 "2026年6月"，需要匹配当月
      const [y, m] = selectedMonth.split("-");
      return r.periodLabel?.includes(`${parseInt(y)}年`) && r.periodLabel?.includes(`${parseInt(m)}月`);
    }) ?? [];
    // ★ 葡萄酒进货数据
    const wineSnap = wineSnapshotStore.snapshots.find((s: any) => {
      const [y, m] = selectedMonth.split("-");
      return s.monthLabel?.includes(`${parseInt(y)}年`) && s.monthLabel?.includes(`${parseInt(m)}月`);
    });
    const wineSnapshotSupplierTotals = wineSnap?.supplierTotals ?? {};
    const wineManualPurchases = wineManualPurchaseStore.getMonthPurchases(selectedMonth).map((p: any) => ({
      supplier: p.supplier,
      amount: p.amount,
      productName: p.productName,
    }));
    // 所有烈酒供应商名称（用于生成金额为0的行）
    const allSpiritSupplierNames = spiritsStore.suppliers.map((s: any) => s.name);
    // 所有葡萄酒供应商名称（从历史进货记录中提取）
    const allWineSupplierNamesSet = new Set<string>([
      ...Object.keys(wineSnapshotSupplierTotals),
      ...wineManualPurchaseStore.purchases.map((p: any) => p.supplier),
    ]);
    const allWineSupplierNames = Array.from(allWineSupplierNamesSet);
    // 月报供应商档案中的葡萄酒/烈酒/啤酒/冰块供应商名称
    const allRegisteredSupplierNames = suppliers.map((s) => s.name);
    // 所有活跃员工
    const allEmployees = employees
      .filter((e: any) => e.active)
      .map((e: any) => ({ id: e.id, realName: e.realName, code: e.code }));
    // 调用聚合器（传入用户配置）
    const aggregated = aggregateMonthlyReport({
      month: selectedMonth,
      monthlyReport,
      pettyRecords,
      paySlips,
      spiritPurchaseSummary,
      allSpiritSupplierNames,
      foodPurchaseRecords,
      wineSnapshotSupplierTotals,
      wineManualPurchases,
      allWineSupplierNames,
      allEmployees,
      pettyCodeConfigs,
      inventoryConfigs,
    });
    // 确认后写入月报
    Alert.alert(
      "自动汇总",
      `将自动从以下模块拉取数据：\n\n` +
      `• 备用金：${pettyRecords.length} 条记录\n` +
      `• 烈酒进货：${monthPurchases.length} 条（${Object.keys(spiritSupplierMap).length} 供应商）\n` +
      `• 葡萄酒进货：${Object.keys(wineSnapshotSupplierTotals).length} 供应商 + 手动 ${wineManualPurchases.length} 条\n` +
      `• 食材进货：${foodPurchaseRecords.length} 条记录\n` +
      `• 薪资单：${paySlips.length} 人\n\n` +
      `将生成 ${(aggregated.lineItems?.length ?? 0)} 个科目行。是否覆盖当前科目？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "覆盖并保存",
          onPress: () => {
            const r = getOrCreateReport();
            const now = new Date().toISOString();
            upsertReport({
              ...r,
              ...aggregated,
              id: r.id,
              month: r.month,
              manualItems: r.manualItems, // 保留手动录入项
              updatedAt: now,
            });
            // ── 自动创建/更新供应商货款记录（货款 Tab 数据源）──
            // 月报供应商档案中的供应商（按名称匹配）
            const existingPayments = getPaymentsForMonth(selectedMonth);
            const upsertSupplierPayment = (supId: string, totalAmt: number, notesStr: string) => {
              const existing = existingPayments.find((p) => p.payeeId === supId && p.payeeType === "supplier");
              if (existing) {
                // 已有记录：只更新金额（保留已付状态）
                if (existing.totalAmount !== totalAmt) {
                  const newRemaining = Math.max(0, totalAmt - existing.paidAmount);
                  const newStatus: "unpaid" | "partial" | "paid" = existing.paidAmount >= totalAmt ? "paid" : existing.paidAmount > 0 ? "partial" : "unpaid";
                  upsertPayment({ ...existing, totalAmount: totalAmt, remainingAmount: newRemaining, status: newStatus, notes: notesStr, updatedAt: now });
                }
              } else {
                // 新建记录
                upsertPayment({
                  id: uuid(), month: selectedMonth, payeeId: supId, payeeType: "supplier",
                  totalAmount: totalAmt, paidAmount: 0, remainingAmount: totalAmt,
                  status: "unpaid", payments: [], advanceAmount: 0, notes: notesStr,
                  createdAt: now, updatedAt: now,
                });
              }
            };
            // 为月报供应商档案中所有活跃供应商创建货款记录
            suppliers.filter((s) => s.active).forEach((sup) => {
              // 从聚合后的科目行中找该供应商的金额
              const lineItems = aggregated.lineItems ?? [];
              const supAmt = lineItems
                .filter((li) => !li.isDuplicate && li.amount < 0 &&
                  (li.label === sup.name || li.label.includes(sup.name)))
                .reduce((s, li) => s + Math.abs(li.amount), 0);
              upsertSupplierPayment(sup.id, supAmt, `${sup.paymentTerms || ""}`);
            });
            // 为所有活跃员工创建薪资发放记录
            employees.filter((e: any) => e.active).forEach((emp: any) => {
              const slip = paySlips.find((s: any) => s.employeeId === emp.id);
              const totalAmt = slip?.finalSalary ?? 0;
              const existing = existingPayments.find((p) => p.payeeId === emp.id && p.payeeType === "employee");
              if (existing) {
                if (existing.totalAmount !== totalAmt) {
                  const newRemaining = Math.max(0, totalAmt - existing.paidAmount);
                  const newStatus: "unpaid" | "partial" | "paid" = existing.paidAmount >= totalAmt ? "paid" : existing.paidAmount > 0 ? "partial" : "unpaid";
                  upsertPayment({ ...existing, totalAmount: totalAmt, remainingAmount: newRemaining, status: newStatus, notes: slip?.notes ?? "", updatedAt: now });
                }
              } else {
                upsertPayment({
                  id: uuid(), month: selectedMonth, payeeId: emp.id, payeeType: "employee",
                  totalAmount: totalAmt, paidAmount: 0, remainingAmount: totalAmt,
                  status: "unpaid", payments: [], advanceAmount: 0, notes: slip?.notes ?? "",
                  createdAt: now, updatedAt: now,
                });
              }
            });
            tap();
          },
        },
      ]
    );
  };

  // ── 单页滚动视图（主入口） ────────────────────────────────────────────────────
  const renderSinglePage = () => {
    const allItems = [...(report?.lineItems ?? []), ...(report?.manualItems ?? [])];
    const sections = CATEGORY_SECTIONS.map((cs) => ({
      ...cs,
      items: allItems.filter((i) => i.category === cs.key),
      subtotal: allItems.filter((i) => i.category === cs.key && !i.isDuplicate).reduce((s, i) => s + i.amount, 0),
    }));
    const totalRevenue = sections.find((s) => s.key === "revenue")?.subtotal ?? 0;
    const totalExpenses = sections.filter((s) => s.key !== "revenue").reduce((s, sec) => s + sec.subtotal, 0);
    const netProfit = totalRevenue + totalExpenses;
    const accountTypes: AccountType[] = ["company", "personal", "petty", "pos"];
    const payrollPayments = payments.filter((p) => p.payeeType === "employee");
    const supplierPayments = payments.filter((p) => p.payeeType === "supplier");

    const handleMarkSupplierPaid = (payment: MonthlyPaymentRecord, supName: string) => {
      if (payment.status === "paid") return;
      const advAmt = payment.advanceAmount ?? 0;
      const actualRemaining = payment.totalAmount - advAmt - payment.paidAmount;
      Alert.alert("标记已付款", `确认已向 ${supName} 付款？\n实付：¥${actualRemaining.toFixed(2)}`, [
        { text: "取消", style: "cancel" },
        { text: "确认已付款", onPress: () => {
          const now = new Date().toISOString();
          upsertPayment({ ...payment, advanceAmount: payment.advanceAmount ?? 0, paidAmount: payment.totalAmount, remainingAmount: 0, status: "paid",
            payments: [...payment.payments, { id: uuid(), date: now.slice(0, 10), amount: actualRemaining, bankAccountId: "", paymentMethod: "转账", notes: `${selectedMonth} 货款`, paidAt: now }],
            updatedAt: now });
          tap();
        }},
      ]);
    };

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 净利润大卡 */}
        <View style={[S.profitCard, { backgroundColor: netProfit >= 0 ? "#34C75908" : colors.error + "08", borderColor: netProfit >= 0 ? "#34C75933" : colors.error + "33" }]}>
          <Text style={{ fontSize: 12, color: colors.muted }}>本月净利润</Text>
          <Text style={{ fontSize: 32, fontWeight: "800", color: netProfit >= 0 ? "#34C759" : colors.error }}>{netProfit >= 0 ? "+" : ""}¥{netProfit.toFixed(2)}</Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <View><Text style={{ fontSize: 10, color: colors.muted }}>总收入</Text><Text style={{ fontSize: 14, fontWeight: "600", color: "#34C759" }}>+¥{totalRevenue.toFixed(2)}</Text></View>
            <View><Text style={{ fontSize: 10, color: colors.muted }}>总支出</Text><Text style={{ fontSize: 14, fontWeight: "600", color: colors.error }}>-¥{Math.abs(totalExpenses).toFixed(2)}</Text></View>
          </View>
        </View>

        {/* 四账户格子 2×2 */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {accountTypes.map((at) => {
            const bal = balances.find((b) => b.accountType === at);
            const color = ACCOUNT_TYPE_COLORS[at];
            return (
              <TouchableOpacity key={at} onPress={() => { tap(); setBalanceAccountType(at); setEditingBalance(bal ?? null); setShowBalanceModal(true); }}
                style={[S.accountMini, { backgroundColor: color + "0a", borderColor: color + "33" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                  <Text style={{ fontSize: 11, fontWeight: "700", color }}>{ACCOUNT_TYPE_LABELS[at]}</Text>
                  {bal?.isReconciled && <IconSymbol name="checkmark.circle.fill" size={10} color="#34C759" />}
                </View>
                {bal ? (
                  <><Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>¥{bal.closingBalance.toFixed(0)}</Text>
                  <Text style={{ fontSize: 10, color: colors.muted }}>{bal.accountName}</Text></>
                ) : (
                  <Text style={{ fontSize: 12, color: colors.muted }}>未录入 · 点击录入</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* 各科目分组 */}
        {sections.map((sec) => {
          const isLabor = sec.key === "labor";
          const isCogs = sec.key === "cogs_food" || sec.key === "cogs_beverage";
          return (
            <View key={sec.key} style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[S.sectionHeader, { borderBottomColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: sec.color }} />
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{sec.label}</Text>
                </View>
                <Text style={{ fontSize: 14, fontWeight: "700", color: sec.sign > 0 ? "#34C759" : colors.error }}>{sec.sign > 0 ? "+" : ""}¥{sec.subtotal.toFixed(2)}</Text>
              </View>
              {sec.items.map((item) => (
                <TouchableOpacity key={item.id} onLongPress={() => {
                  const effectiveDup = item.manualDuplicate !== undefined ? item.manualDuplicate : item.isDuplicate;
                  const menuOptions: any[] = [];
                  // 所有行都可以标记/取消重复叠加
                  if (!effectiveDup) {
                    menuOptions.push({ text: "标记为已在其他科目计入（不重复叠加）", onPress: () => {
                      const r = getOrCreateReport();
                      const updatedItems = r.lineItems.map((i) => i.id === item.id ? { ...i, manualDuplicate: true } : i);
                      upsertReport({ ...r, lineItems: updatedItems, updatedAt: new Date().toISOString() });
                      tap();
                    }});
                  } else {
                    menuOptions.push({ text: "取消重复标记（恢复计入）", onPress: () => {
                      const r = getOrCreateReport();
                      const updatedItems = r.lineItems.map((i) => i.id === item.id ? { ...i, manualDuplicate: false } : i);
                      upsertReport({ ...r, lineItems: updatedItems, updatedAt: new Date().toISOString() });
                      tap();
                    }});
                  }
                  // 手工录入行额外支持编辑/删除
                  if (item.isManual) {
                    menuOptions.push({ text: "编辑", onPress: () => { setEditingItem(item); setShowManualModal(true); } });
                    menuOptions.push({ text: "删除", style: "destructive", onPress: () => handleDeleteManualItem(item.id) });
                  }
                  // 备用金汇总行支持拆分
                  if (item.code === "petty_other") {
                    menuOptions.push({ text: "拆分为独立科目（选择备用金分类）", onPress: () => {
                      Alert.alert(
                        "拆分备用金其他费用",
                        "选择要单独显示的备用金分类，该分类将从「备用金其他费用」中拆出，独立显示为科目行。\n\n请前往「月报设置」→「备用金分类配置」进行设置。",
                        [
                          { text: "前往设置", onPress: () => { setSettingsTab("petty"); setShowSettingsModal(true); } },
                          { text: "取消", style: "cancel" },
                        ]
                      );
                    }});
                  }
                  menuOptions.push({ text: "取消", style: "cancel" });
                  Alert.alert("科目操作", item.label, menuOptions);
                }}><LineItemRow item={item} colors={colors} /></TouchableOpacity>
              ))}
              {sec.items.length === 0 && (
                <View style={{ padding: 12, alignItems: "center" }}>
                  <Text style={{ fontSize: 12, color: colors.muted }}>暂无数据 · 长按手动录入行可编辑</Text>
                </View>
              )}
              {/* 工资科目：内嵌员工薪资卡片 */}
              {isLabor && payrollPayments.length > 0 && (
                <View style={{ padding: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted }}>工资发放明细</Text>
                    <Text style={{ fontSize: 11, color: colors.error }}>待发 ¥{payrollPayments.reduce((s, p) => s + p.remainingAmount, 0).toFixed(0)}</Text>
                  </View>
                  {employees.filter((e) => e.active).map((emp) => {
                    const payment = payrollPayments.find((p) => p.payeeId === emp.id);
                    const defaultBank = emp.bankAccounts?.find((b) => b.isDefault) ?? emp.bankAccounts?.[0];
                    const totalAmt = payment?.totalAmount ?? 0;
                    const advAmt = payment?.advanceAmount ?? 0;
                    const paidAmt = payment?.paidAmount ?? 0;
                    const actualRemaining = Math.max(0, totalAmt - advAmt - paidAmt);
                    const status = payment?.status ?? "unpaid";
                    const statusColor = status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error;
                    if (totalAmt === 0 && !payment) return null;
                    return (
                      <View key={emp.id} style={[S.inlineCard, { borderLeftColor: statusColor }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                          <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: colors.foreground }}>{emp.realName} <Text style={{ fontSize: 11, color: colors.muted }}>（{emp.code}）</Text></Text>
                          <View style={[S.statusTag, { backgroundColor: statusColor + "18" }]}>
                            <Text style={{ fontSize: 10, fontWeight: "700", color: statusColor }}>{status === "paid" ? "✓ 已发" : status === "partial" ? "部分" : "待发"}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 10, marginBottom: 6 }}>
                          <View style={S.amtBlock}><Text style={S.amtLabel}>应发</Text><Text style={[S.amtValue, { color: colors.foreground }]}>¥{totalAmt.toFixed(0)}</Text></View>
                          {advAmt > 0 && <View style={S.amtBlock}><Text style={S.amtLabel}>预支</Text><Text style={[S.amtValue, { color: colors.warning }]}>-¥{advAmt.toFixed(0)}</Text></View>}
                          {paidAmt > 0 && <View style={S.amtBlock}><Text style={S.amtLabel}>已发</Text><Text style={[S.amtValue, { color: "#34C759" }]}>¥{paidAmt.toFixed(0)}</Text></View>}
                          <View style={S.amtBlock}><Text style={S.amtLabel}>{advAmt > 0 ? "实发" : "待发"}</Text><Text style={[S.amtValue, { color: actualRemaining > 0 ? colors.error : "#34C759", fontWeight: "800" }]}>¥{actualRemaining.toFixed(0)}</Text></View>
                        </View>
                        {defaultBank && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ flex: 1, fontSize: 11, color: colors.muted }}>{defaultBank.bankName} {maskCardNumber(defaultBank.cardNumber)}</Text>
                            <TouchableOpacity onPress={() => handleCopy([`收款人：${defaultBank.accountName}`, `开户行：${defaultBank.bankName}`, `卡号：${defaultBank.cardNumber}`, `金额：¥${(actualRemaining > 0 ? actualRemaining : totalAmt).toFixed(2)}`, `备注：${emp.realName} ${selectedMonth} 薪资`].join("\n"))} style={[S.miniBtn, { backgroundColor: colors.primary }]}>
                              <IconSymbol name="doc.on.clipboard" size={10} color="#fff" /><Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>复制</Text>
                            </TouchableOpacity>
                            {status !== "paid" && payment && (
                              <TouchableOpacity onPress={() => {
                                const now = new Date().toISOString();
                                const actualRem2 = payment.totalAmount - (payment.advanceAmount ?? 0) - payment.paidAmount;
                                Alert.alert("标记已发放", `确认已向 ${emp.realName} 发放薪资？\n实发：¥${actualRem2.toFixed(2)}`, [
                                  { text: "取消", style: "cancel" },
                                  { text: "确认已发放", onPress: () => { upsertPayment({ ...payment, advanceAmount: payment.advanceAmount ?? 0, paidAmount: payment.totalAmount, remainingAmount: 0, status: "paid", payments: [...payment.payments, { id: uuid(), date: now.slice(0, 10), amount: actualRem2, bankAccountId: "", paymentMethod: "转账", notes: `${selectedMonth} 薪资`, paidAt: now }], updatedAt: now }); tap(); }},
                                ]);
                              }} style={[S.miniBtn, { backgroundColor: "#34C759" }]}>
                                <IconSymbol name="checkmark.circle.fill" size={10} color="#fff" /><Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>已发</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
              {/* 进货成本科目：内嵌烈酒库存成本卡片 */}
              {sec.key === "cogs_beverage" && (() => {
                const monthLedger = spiritsStore.getMonthLedger(selectedMonth);
                const totalClosingCost = monthLedger.reduce((s, e) => s + (e.closingCost ?? 0), 0);
                const totalPurchaseCost = monthLedger.reduce((s, e) => s + (e.purchaseCost ?? 0), 0);
                // 价格涨跌分析：对比当月进货单价与参考单价
                const priceChanges: { name: string; diff: number; pct: number }[] = [];
                spiritsStore.purchases
                  .filter((p) => p.month === selectedMonth && p.itemId)
                  .forEach((p) => {
                    const item = spiritsStore.items.find((i) => i.id === p.itemId);
                    if (!item) return;
                    const refPrice = spiritsStore.getRefPrice(item.id, selectedMonth);
                    if (refPrice > 0 && p.unitPrice !== refPrice) {
                      const diff = p.unitPrice - refPrice;
                      const pct = Math.round(diff / refPrice * 100);
                      const existing = priceChanges.find((c) => c.name === item.name);
                      if (!existing) priceChanges.push({ name: item.name, diff, pct });
                    }
                  });
                if (monthLedger.length === 0 && priceChanges.length === 0) return null;
                return (
                  <View style={{ padding: 10, gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted }}>烈酒库存摘要</Text>
                      <Text style={{ fontSize: 11, color: "#5856D6", fontWeight: "600" }}>期未成本 ¥{totalClosingCost.toFixed(0)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={[S.amtBlock, { flex: 1 }]}>
                        <Text style={S.amtLabel}>当月进货</Text>
                        <Text style={[S.amtValue, { color: colors.foreground }]}>¥{totalPurchaseCost.toFixed(0)}</Text>
                      </View>
                      <View style={[S.amtBlock, { flex: 1 }]}>
                        <Text style={S.amtLabel}>库存款数</Text>
                        <Text style={[S.amtValue, { color: colors.foreground }]}>{monthLedger.length} 款</Text>
                      </View>
                    </View>
                    {priceChanges.length > 0 && (
                      <View style={{ marginTop: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted, marginBottom: 4 }}>当月单价变动</Text>
                        {priceChanges.slice(0, 5).map((c, i) => (
                          <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3,
                            borderBottomWidth: i < priceChanges.slice(0, 5).length - 1 ? StyleSheet.hairlineWidth : 0,
                            borderBottomColor: colors.border }}>
                            <Text style={{ fontSize: 11, color: colors.foreground, flex: 1 }} numberOfLines={1}>{c.name}</Text>
                            <Text style={{ fontSize: 11, fontWeight: "700",
                              color: c.diff > 0 ? "#EF4444" : "#10B981" }}>
                              {c.diff > 0 ? "↑" : "↓"}¥{Math.abs(c.diff).toFixed(0)} ({c.pct > 0 ? "+" : ""}{c.pct}%)
                            </Text>
                          </View>
                        ))}
                        {priceChanges.length > 5 && (
                          <Text style={{ fontSize: 10, color: colors.muted, textAlign: "center", marginTop: 4 }}>还有 {priceChanges.length - 5} 款商品价格变动</Text>
                        )}
                      </View>
                    )}
                    {/* 整体月度 Pour Cost */}
                    {(() => {
                      const totalRevenue = sections.find((s) => s.key === "revenue")?.subtotal ?? 0;
                      const pourResult = calcMonthlyPourCost(totalPurchaseCost, totalRevenue);
                      if (pourResult.pourCostPct === null) return null;
                      const color = pourCostColor(pourResult.pourCostPct);
                      return (
                        <View style={{ marginTop: 8, padding: 10, borderRadius: 8, backgroundColor: color + "12", borderWidth: 1, borderColor: color + "44" }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 12, fontWeight: "700", color }}>整体酒水 Pour Cost</Text>
                            <Text style={{ fontSize: 20, fontWeight: "800", color }}>{pourResult.pourCostPct.toFixed(1)}%</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
                            <Text style={{ fontSize: 10, color: colors.muted }}>酒水进货 ¥{pourResult.totalPurchaseCost.toFixed(0)}</Text>
                            <Text style={{ fontSize: 10, color: colors.muted }}>酒水收入 ¥{pourResult.totalRevenue.toFixed(0)}</Text>
                          </View>
                          <Text style={{ fontSize: 9, color: colors.muted, marginTop: 2 }}>行业标准：绿色 &lt;20% / 橙色 20-30% / 红色 &gt;30%</Text>
                        </View>
                      );
                    })()}
                  </View>
                );
              })()}

              {/* 进货成本科目：内嵌供应商货款卡片 */}
              {isCogs && supplierPayments.length > 0 && (
                <View style={{ padding: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted }}>货款付款明细</Text>
                    <Text style={{ fontSize: 11, color: colors.error }}>待付 ¥{supplierPayments.reduce((s, p) => s + p.remainingAmount, 0).toFixed(0)}</Text>
                  </View>
                  {supplierPayments.map((payment) => {
                    const sup = suppliers.find((s) => s.id === payment.payeeId);
                    if (!sup) return null;
                    const defaultBank = sup.bankAccounts.find((b) => b.isDefault) ?? sup.bankAccounts[0];
                    const advAmt = payment.advanceAmount ?? 0;
                    const actualRemaining = Math.max(0, payment.totalAmount - advAmt - payment.paidAmount);
                    const status = payment.status;
                    const statusColor = status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error;
                    return (
                      <View key={payment.id} style={[S.inlineCard, { borderLeftColor: statusColor }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                          <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: colors.foreground }}>{sup.name}</Text>
                          <View style={[S.statusTag, { backgroundColor: statusColor + "18" }]}>
                            <Text style={{ fontSize: 10, fontWeight: "700", color: statusColor }}>{status === "paid" ? "✓ 已付" : status === "partial" ? "部分" : "待付"}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", gap: 10, marginBottom: 6 }}>
                          <View style={S.amtBlock}><Text style={S.amtLabel}>应付</Text><Text style={[S.amtValue, { color: colors.foreground }]}>¥{payment.totalAmount.toFixed(0)}</Text></View>
                          {advAmt > 0 && <View style={S.amtBlock}><Text style={S.amtLabel}>定金</Text><Text style={[S.amtValue, { color: colors.warning }]}>-¥{advAmt.toFixed(0)}</Text></View>}
                          {payment.paidAmount > 0 && <View style={S.amtBlock}><Text style={S.amtLabel}>已付</Text><Text style={[S.amtValue, { color: "#34C759" }]}>¥{payment.paidAmount.toFixed(0)}</Text></View>}
                          <View style={S.amtBlock}><Text style={S.amtLabel}>待付</Text><Text style={[S.amtValue, { color: actualRemaining > 0 ? colors.error : "#34C759", fontWeight: "800" }]}>¥{actualRemaining.toFixed(0)}</Text></View>
                        </View>
                        {defaultBank && (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ flex: 1, fontSize: 11, color: colors.muted }}>{defaultBank.bankName} {maskCardNumber(defaultBank.cardNumber)}</Text>
                            <TouchableOpacity onPress={() => handleCopy([`收款人：${defaultBank.accountName}`, `开户行：${defaultBank.bankName}`, `卡号：${defaultBank.cardNumber}`, `金额：¥${(actualRemaining > 0 ? actualRemaining : payment.totalAmount).toFixed(2)}`, `备注：${sup.name} ${selectedMonth} 货款`].join("\n"))} style={[S.miniBtn, { backgroundColor: colors.primary }]}>
                              <IconSymbol name="doc.on.clipboard" size={10} color="#fff" /><Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>复制</Text>
                            </TouchableOpacity>
                            {status !== "paid" && (
                              <TouchableOpacity onPress={() => handleMarkSupplierPaid(payment, sup.name)} style={[S.miniBtn, { backgroundColor: "#34C759" }]}>
                                <IconSymbol name="checkmark.circle.fill" size={10} color="#fff" /><Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>已付</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {/* 操作按钮区 */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <TouchableOpacity onPress={handleAutoAggregate}
            style={[S.addItemBtn, { flex: 1, minWidth: 120, borderColor: "#10B981" + "44", backgroundColor: "#10B981" + "10" }]}>
            <IconSymbol name="arrow.triangle.2.circlepath" size={16} color="#10B981" />
            <Text style={{ fontSize: 13, color: "#10B981", fontWeight: "700" }}>一键自动汇总</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { tap(); setEditingItem(null); setShowManualModal(true); }}
            style={[S.addItemBtn, { flex: 1, minWidth: 120, borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
            <IconSymbol name="plus.circle.fill" size={16} color={colors.primary} />
            <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>手动录入科目</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { tap(); setShowSettingsModal(true); }}
            style={[S.addItemBtn, { borderColor: colors.muted + "44", backgroundColor: colors.surface }]}>
            <IconSymbol name="gearshape.fill" size={16} color={colors.muted} />
            <Text style={{ fontSize: 13, color: colors.muted, fontWeight: "600" }}>月报设置</Text>
          </TouchableOpacity>
        </View>

        {/* 历史报表 Modal */}
        <Modal visible={showHistoryModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowHistoryModal(false)}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[S.navbar, { borderBottomColor: colors.border }]}>
              <View style={{ width: 44 }} />
              <Text style={[S.navTitle, { color: colors.foreground }]}>历史报表</Text>
              <Pressable onPress={() => setShowHistoryModal(false)} style={{ padding: 8 }}>
                <Text style={{ fontSize: 17, color: colors.primary }}>关闭</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {[...reports].sort((a, b) => b.month.localeCompare(a.month)).map((r) => (
                <TouchableOpacity key={r.id} onPress={() => { tap(); setSelectedMonth(r.month); setShowHistoryModal(false); }}
                  style={[S.historyRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{r.month}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>净利润</Text>
                  </View>
                  <Text style={{ fontSize: 18, fontWeight: "800", color: r.netProfit >= 0 ? "#34C759" : colors.error }}>{r.netProfit >= 0 ? "+" : ""}¥{r.netProfit.toFixed(0)}</Text>
                  <IconSymbol name="chevron.right" size={14} color={colors.muted} style={{ marginLeft: 8 }} />
                </TouchableOpacity>
              ))}
              {reports.length === 0 && (
                <View style={{ alignItems: "center", padding: 40 }}>
                  <Text style={{ fontSize: 36 }}>📊</Text>
                  <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>暂无历史报表</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </Modal>
      </ScrollView>
    );
  };

  // ── 总报表 Tab ────────────────────────────────────────────────────────────
  const renderReport = () => {
    const allItems = [...(report?.lineItems ?? []), ...(report?.manualItems ?? [])];
    const sections = CATEGORY_SECTIONS.map((cs) => ({
      ...cs,
      items: allItems.filter((i) => i.category === cs.key),
      subtotal: allItems.filter((i) => i.category === cs.key && !i.isDuplicate).reduce((s, i) => s + i.amount, 0),
    }));

    const totalRevenue = sections.find((s) => s.key === "revenue")?.subtotal ?? 0;
    const totalExpenses = sections.filter((s) => s.key !== "revenue").reduce((s, sec) => s + sec.subtotal, 0);
    const netProfit = totalRevenue + totalExpenses;

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 月份选择 */}
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 净利润大卡 */}
        <View style={[S.profitCard, {
          backgroundColor: netProfit >= 0 ? "#34C75908" : colors.error + "08",
          borderColor: netProfit >= 0 ? "#34C75933" : colors.error + "33",
        }]}>
          <Text style={{ fontSize: 12, color: colors.muted }}>本月净利润</Text>
          <Text style={{ fontSize: 32, fontWeight: "800", color: netProfit >= 0 ? "#34C759" : colors.error }}>
            {netProfit >= 0 ? "+" : ""}¥{netProfit.toFixed(2)}
          </Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <View>
              <Text style={{ fontSize: 10, color: colors.muted }}>总收入</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: "#34C759" }}>+¥{totalRevenue.toFixed(2)}</Text>
            </View>
            <View>
              <Text style={{ fontSize: 10, color: colors.muted }}>总支出</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.error }}>-¥{Math.abs(totalExpenses).toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* 各科目分组 */}
        {sections.map((sec) => (
          <View key={sec.key} style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[S.sectionHeader, { borderBottomColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: sec.color }} />
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{sec.label}</Text>
              </View>
              <Text style={{ fontSize: 14, fontWeight: "700", color: sec.sign > 0 ? "#34C759" : colors.error }}>
                {sec.sign > 0 ? "+" : ""}¥{sec.subtotal.toFixed(2)}
              </Text>
            </View>
            {sec.items.map((item) => (
              <TouchableOpacity key={item.id} onLongPress={() => {
                if (item.isManual) {
                  Alert.alert("操作", item.label, [
                    { text: "编辑", onPress: () => { setEditingItem(item); setShowManualModal(true); } },
                    { text: "删除", style: "destructive", onPress: () => handleDeleteManualItem(item.id) },
                    { text: "取消", style: "cancel" },
                  ]);
                }
              }}>
                <LineItemRow item={item} colors={colors} />
              </TouchableOpacity>
            ))}
            {sec.items.length === 0 && (
              <View style={{ padding: 12, alignItems: "center" }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>暂无数据 · 长按手动录入行可编辑</Text>
              </View>
            )}
          </View>
        ))}

        {/* 手动录入按钮 */}
        <TouchableOpacity onPress={() => { tap(); setEditingItem(null); setShowManualModal(true); }}
          style={[S.addItemBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
          <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>手动录入科目</Text>
        </TouchableOpacity>

        {/* 供应商档案入口 */}
        <TouchableOpacity onPress={() => router.push("/suppliers" as any)}
          style={[S.linkBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <IconSymbol name="building.2.fill" size={16} color={colors.muted} />
          <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }}>管理供应商档案 & 银行卡</Text>
          <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        </TouchableOpacity>
      </ScrollView>
    );
  };

  // ── 账户 Tab ──────────────────────────────────────────────────────────────
  const renderAccounts = () => {
    const accountTypes: AccountType[] = ["company", "personal", "petty", "pos"];
    const allItems = [...(report?.lineItems ?? []), ...(report?.manualItems ?? [])];
    const netProfit = allItems.filter((i) => !i.isDuplicate).reduce((s, i) => s + i.amount, 0);

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 净利润参考 */}
        <View style={[S.infoBox, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "22" }]}>
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "700" }}>本月经营净利润（参考）</Text>
          <Text style={{ fontSize: 20, fontWeight: "800", color: netProfit >= 0 ? "#34C759" : colors.error }}>
            {netProfit >= 0 ? "+" : ""}¥{netProfit.toFixed(2)}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
            账户余额差异 = 手动录入期末余额 - 系统计算期末余额
          </Text>
        </View>

        {/* 四账户卡片 */}
        {accountTypes.map((at) => {
          const bal = balances.find((b) => b.accountType === at);
          const color = ACCOUNT_TYPE_COLORS[at];
          const variance = bal ? bal.closingBalance - bal.computedClosingBalance : null;
          const hasVariance = variance !== null && Math.abs(variance) > 0.01;

          return (
            <View key={at} style={[S.accountCard, { backgroundColor: colors.surface, borderColor: color + "33", borderLeftColor: color, borderLeftWidth: 3 }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color }}>{ACCOUNT_TYPE_LABELS[at]}</Text>
                  {bal ? (
                    <>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{bal.accountName}</Text>
                      <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
                        <View>
                          <Text style={{ fontSize: 10, color: colors.muted }}>期初余额</Text>
                          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>¥{bal.openingBalance.toFixed(2)}</Text>
                        </View>
                        <View>
                          <Text style={{ fontSize: 10, color: colors.muted }}>期末余额（实际）</Text>
                          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>¥{bal.closingBalance.toFixed(2)}</Text>
                        </View>
                      </View>
                      {hasVariance && (
                        <View style={[S.varianceBox, { backgroundColor: colors.warning + "0a", borderColor: colors.warning + "33" }]}>
                          <IconSymbol name="exclamationmark.triangle.fill" size={12} color={colors.warning} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.warning }}>
                              差异：{variance! > 0 ? "+" : ""}¥{variance!.toFixed(2)}
                            </Text>
                            <Text style={{ fontSize: 11, color: colors.muted }}>
                              手动录入 ¥{bal.closingBalance.toFixed(2)} vs 系统计算 ¥{bal.computedClosingBalance.toFixed(2)}
                            </Text>
                            {bal.varianceNote ? <Text style={{ fontSize: 11, color: colors.muted }}>{bal.varianceNote}</Text> : null}
                          </View>
                        </View>
                      )}
                      {!hasVariance && bal.closingBalance > 0 && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
                          <IconSymbol name="checkmark.circle.fill" size={12} color="#34C759" />
                          <Text style={{ fontSize: 11, color: "#34C759" }}>余额核对无差异</Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>尚未录入本月余额</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => {
                  tap();
                  setBalanceAccountType(at);
                  setEditingBalance(bal ?? null);
                  setShowBalanceModal(true);
                }} style={[S.editBalBtn, { borderColor: color + "44" }]}>
                  <IconSymbol name={bal ? "pencil" : "plus"} size={14} color={color} />
                  <Text style={{ fontSize: 12, color, fontWeight: "600" }}>{bal ? "更新" : "录入"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* 差异分析说明 */}
        <View style={[S.infoBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 6 }}>差异分析说明</Text>
          <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 20 }}>
            • <Text style={{ fontWeight: "600" }}>差异 &gt; 0</Text>：实际余额高于系统计算，可能有未录入的收入，或支出被重复计算{"\n"}
            • <Text style={{ fontWeight: "600" }}>差异 &lt; 0</Text>：实际余额低于系统计算，可能有未录入的支出，或收入被高估{"\n"}
            • <Text style={{ fontWeight: "600" }}>开店宝后台</Text>：记录 POS 机未结算金额，通常有 1-3 天结算延迟{"\n"}
            • 每月第二次录入期末余额时，系统自动对比上月期末与本月期初，检查是否一致
          </Text>
        </View>
      </ScrollView>
    );
  };

  // ── 薪资 Tab ──────────────────────────────────────────────────────────────
  const renderPayroll = () => {
    const payrollPayments = payments.filter((p) => p.payeeType === "employee");
    const totalPayroll = payrollPayments.reduce((s, p) => s + p.totalAmount, 0);
    const totalAdvance = payrollPayments.reduce((s, p) => s + (p.advanceAmount ?? 0), 0);
    const totalPaid = payrollPayments.reduce((s, p) => s + p.paidAmount, 0);
    const totalRemaining = payrollPayments.reduce((s, p) => s + p.remainingAmount, 0);
    const totalActual = totalPayroll - totalAdvance; // 实发总额

    const handleMarkPaid = (payment: MonthlyPaymentRecord, emp: any) => {
      if (payment.status === "paid") return;
      const advAmt = payment.advanceAmount ?? 0;
      const actualRemaining = Math.max(0, payment.totalAmount - advAmt - payment.paidAmount);
      // 使用部分付款 Modal
      setPartialPayTarget(payment);
      setPartialPayAmount(actualRemaining.toFixed(2));
      setPartialPayMethod("转账");
      setPartialPayAccountType("company");
      setPartialPayNotes(`${emp.realName} ${selectedMonth} 薪资`);
      setShowPartialPayModal(true);
    };

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 汇总卡片 */}
        <View style={[S.payrollSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: colors.muted }}>本月薪资总额</Text>
            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>¥{totalPayroll.toFixed(2)}</Text>
          </View>
          <View style={{ gap: 4, alignItems: "flex-end" }}>
            {totalAdvance > 0 && (
              <Text style={{ fontSize: 11, color: colors.warning }}>预支 ¥{totalAdvance.toFixed(2)}</Text>
            )}
            <Text style={{ fontSize: 11, color: "#34C759" }}>已发 ¥{totalPaid.toFixed(2)}</Text>
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.error }}>待发 ¥{totalRemaining.toFixed(2)}</Text>
          </View>
        </View>

        {/* 员工薪资卡片 */}
        {employees.filter((e) => e.active).map((emp) => {
          const payment = payrollPayments.find((p) => p.payeeId === emp.id);
          const defaultBank = emp.bankAccounts?.find((b) => b.isDefault) ?? emp.bankAccounts?.[0];
          const totalAmt = payment?.totalAmount ?? 0;
          const advAmt = payment?.advanceAmount ?? 0;
          const paidAmt = payment?.paidAmount ?? 0;
          const remaining = payment?.remainingAmount ?? totalAmt;
          const actualRemaining = totalAmt - advAmt - paidAmt; // 实际待发
          const status = payment?.status ?? "unpaid";
          const statusColor = status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error;
          const statusLabel = status === "paid" ? "✓ 已发放" : status === "partial" ? "部分已发" : "待发放";

          return (
            <View key={emp.id} style={[S.payrollCard, {
              backgroundColor: colors.surface, borderColor: colors.border,
              borderLeftColor: statusColor, borderLeftWidth: 3,
            }]}>
              {/* 头部：姓名 + 代号 + 状态标签 */}
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{emp.realName}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>（{emp.code}）</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{emp.type === "fulltime" ? "全职" : "兴趣工"} · {emp.dept === "front" ? "前厅" : emp.dept === "kitchen" ? "后厨" : "其他"}</Text>
                </View>
                <View style={[S.statusTag, { backgroundColor: statusColor + "18" }]}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: statusColor }}>{statusLabel}</Text>
                </View>
              </View>

              {/* 金额明细行 */}
              <View style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
                <View style={S.amtBlock}>
                  <Text style={S.amtLabel}>应发</Text>
                  <Text style={[S.amtValue, { color: colors.foreground }]}>¥{totalAmt.toFixed(0)}</Text>
                </View>
                {advAmt > 0 && (
                  <View style={S.amtBlock}>
                    <Text style={S.amtLabel}>预支</Text>
                    <Text style={[S.amtValue, { color: colors.warning }]}>-¥{advAmt.toFixed(0)}</Text>
                  </View>
                )}
                {paidAmt > 0 && (
                  <View style={S.amtBlock}>
                    <Text style={S.amtLabel}>已发</Text>
                    <Text style={[S.amtValue, { color: "#34C759" }]}>¥{paidAmt.toFixed(0)}</Text>
                  </View>
                )}
                <View style={S.amtBlock}>
                  <Text style={S.amtLabel}>{advAmt > 0 ? "实发" : "待发"}</Text>
                  <Text style={[S.amtValue, { color: actualRemaining > 0 ? colors.error : "#34C759", fontWeight: "800" }]}>
                    ¥{Math.max(0, actualRemaining).toFixed(0)}
                  </Text>
                </View>
              </View>

              {/* 銀行卡信息 + 操作按鈕 */}
              {defaultBank ? (
                <View style={[S.bankInfo, { backgroundColor: "#007AFF08", borderColor: "#007AFF22" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{defaultBank.accountName}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{defaultBank.bankName}</Text>
                    <Text style={{ fontSize: 12, color: colors.foreground, letterSpacing: 1 }}>{maskCardNumber(defaultBank.cardNumber)}</Text>
                  </View>
                  <View style={{ gap: 6 }}>
                    {/* 一键复制 */}
                    <TouchableOpacity onPress={() => {
                      const copyAmt = actualRemaining > 0 ? actualRemaining : totalAmt;
                      const text = [
                        `收款人：${defaultBank.accountName}`,
                        `开户行：${defaultBank.bankName}`,
                        `卡号：${defaultBank.cardNumber}`,
                        `金额：¥${copyAmt.toFixed(2)}`,
                        `备注：${emp.realName} ${selectedMonth} 薪资`,
                      ].join("\n");
                      handleCopy(text);
                    }} style={[S.copyBtn, { backgroundColor: colors.primary }]}>
                      <IconSymbol name="doc.on.clipboard" size={12} color="#fff" />
                      <Text style={{ fontSize: 11, color: "#fff", fontWeight: "600" }}>复制付款信息</Text>
                    </TouchableOpacity>
                    {/* 标记已发放 */}
                    {status !== "paid" && payment && (
                      <TouchableOpacity onPress={() => handleMarkPaid(payment, emp)}
                        style={[S.copyBtn, { backgroundColor: "#34C759" }]}>
                        <IconSymbol name="checkmark.circle.fill" size={12} color="#fff" />
                        <Text style={{ fontSize: 11, color: "#fff", fontWeight: "600" }}>标记已发放</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={() => router.push(`/labor-employee-form?id=${emp.id}` as any)}
                  style={[S.addBankHint, { borderColor: colors.border }]}>
                  <IconSymbol name="creditcard.fill" size={14} color={colors.muted} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>未设置銀行卡 · 点击前往员工档案添加</Text>
                </TouchableOpacity>
              )}

              {/* 预支记录 */}
              {advAmt > 0 && (
                <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  <Text style={{ fontSize: 11, color: colors.warning }}>⚠️ 已预支 ¥{advAmt.toFixed(2)}，实发金额已自动扣除</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    );
  };

  // ── 货款 Tab ──────────────────────────────────────────────────────────────
  const renderPayments = () => {
    const supplierPayments = payments.filter((p) => p.payeeType === "supplier");
    const employeePayments = payments.filter((p) => p.payeeType === "employee");
    const totalAmt = supplierPayments.reduce((s, p) => s + p.totalAmount, 0);
    const totalPaid = supplierPayments.reduce((s, p) => s + p.paidAmount, 0);
    const totalRemaining = supplierPayments.reduce((s, p) => s + p.remainingAmount, 0);

    // 按品类分组供应商
    const CATEGORY_ORDER: import("@/lib/store/monthly-summary/types").SupplierCategory[] = ["spirits", "wine", "beer", "ice", "food", "equipment", "other"];
    const CATEGORY_LABELS: Record<string, string> = {
      spirits: "烈酒", wine: "葡萄酒", beer: "啤酒", ice: "冰块",
      food: "食材", equipment: "设备", other: "其他",
    };

    const renderSupplierCard = (payment: MonthlyPaymentRecord, sup: import("@/lib/store/monthly-summary/types").Supplier) => {
      const defaultBank = sup.bankAccounts.find((b) => b.isDefault) ?? sup.bankAccounts[0];
      const status = payment.status;
      const statusColor = status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error;
      const advAmt = payment.advanceAmount ?? 0;
      const actualRemaining = Math.max(0, payment.totalAmount - advAmt - payment.paidAmount);
      return (
        <View key={payment.id} style={[S.payrollCard, {
          backgroundColor: colors.surface, borderColor: colors.border,
          borderLeftColor: statusColor, borderLeftWidth: 3,
        }]}>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{sup.name}</Text>
                {sup.paymentTerms ? (
                  <View style={[S.statusTag, { backgroundColor: colors.border + "33" }]}>
                    <Text style={{ fontSize: 10, color: colors.muted }}>{sup.paymentTerms}</Text>
                  </View>
                ) : null}
                <View style={[S.statusTag, { backgroundColor: statusColor + "15" }]}>
                  <Text style={{ fontSize: 10, fontWeight: "700", color: statusColor }}>
                    {status === "paid" ? "✓ 已付" : status === "partial" ? "部分已付" : payment.totalAmount === 0 ? "—" : "待付"}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
                <View>
                  <Text style={{ fontSize: 10, color: colors.muted }}>应付</Text>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: payment.totalAmount === 0 ? colors.muted : colors.foreground }}>
                    {payment.totalAmount === 0 ? "—" : `¥${payment.totalAmount.toFixed(0)}`}
                  </Text>
                </View>
                {advAmt > 0 && <View><Text style={{ fontSize: 10, color: colors.muted }}>定金</Text><Text style={{ fontSize: 13, color: colors.warning }}>-¥{advAmt.toFixed(0)}</Text></View>}
                {payment.paidAmount > 0 && <View><Text style={{ fontSize: 10, color: colors.muted }}>已付</Text><Text style={{ fontSize: 13, color: "#34C759" }}>¥{payment.paidAmount.toFixed(0)}</Text></View>}
                {actualRemaining > 0 && <View><Text style={{ fontSize: 10, color: colors.muted }}>待付</Text><Text style={{ fontSize: 14, fontWeight: "700", color: colors.error }}>¥{actualRemaining.toFixed(0)}</Text></View>}
              </View>
            </View>
          </View>
          {defaultBank ? (
            <View style={[S.bankInfo, { backgroundColor: "#007AFF08", borderColor: "#007AFF22" }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{defaultBank.accountName}</Text>
                <Text style={{ fontSize: 11, color: colors.muted }}>{defaultBank.bankName} {maskCardNumber(defaultBank.cardNumber)}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <TouchableOpacity onPress={() => {
                  const text = generatePaymentCopyText({
                    recipientName: defaultBank.accountName,
                    bankName: defaultBank.bankName,
                    cardNumber: defaultBank.cardNumber,
                    amount: actualRemaining > 0 ? actualRemaining : payment.totalAmount,
                    note: `${sup.name} ${selectedMonth} 货款`,
                  });
                  handleCopy(text);
                }} style={[S.copyBtn, { backgroundColor: colors.primary }]}>
                  <IconSymbol name="doc.on.clipboard" size={12} color="#fff" />
                  <Text style={{ fontSize: 11, color: "#fff", fontWeight: "600" }}>复制</Text>
                </TouchableOpacity>
                {status !== "paid" && payment.totalAmount > 0 && (
                  <TouchableOpacity onPress={() => {
                    setPartialPayTarget(payment);
                    setPartialPayAmount(actualRemaining > 0 ? actualRemaining.toFixed(2) : payment.totalAmount.toFixed(2));
                    setPartialPayMethod("转账");
                    setPartialPayAccountType("company");
                    setPartialPayNotes(`${sup.name} ${selectedMonth} 货款`);
                    setShowPartialPayModal(true);
                  }} style={[S.copyBtn, { backgroundColor: "#34C759" }]}>
                    <IconSymbol name="checkmark.circle.fill" size={12} color="#fff" />
                    <Text style={{ fontSize: 11, color: "#fff", fontWeight: "600" }}>录入付款</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => {
                  Alert.alert("删除货款记录", `确认删除 ${sup.name} 的货款记录？`, [
                    { text: "取消", style: "cancel" },
                    { text: "删除", style: "destructive", onPress: () => { deletePayment(payment.id); tap(); } },
                  ]);
                }} style={[S.copyBtn, { backgroundColor: colors.error + "20" }]}>
                  <IconSymbol name="trash.fill" size={12} color={colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => router.push("/suppliers" as any)}
              style={[S.addBankHint, { borderColor: colors.border }]}>
              <IconSymbol name="creditcard.fill" size={14} color={colors.muted} />
              <Text style={{ fontSize: 12, color: colors.muted }}>未设置银行卡 · 前往供应商档案添加</Text>
            </TouchableOpacity>
          )}
          {payment.payments.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>付款记录：</Text>
              {payment.payments.map((p) => (
                <View key={p.id} style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, width: 80 }}>{p.date}</Text>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: "#34C759" }}>¥{p.amount.toFixed(2)}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{p.paymentMethod}</Text>
                  {p.notes ? <Text style={{ fontSize: 11, color: colors.muted }}>{p.notes}</Text> : null}
                </View>
              ))}
            </View>
          )}
        </View>
      );
    };

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 汇总 */}
        <View style={[S.payrollSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>本月货款总额</Text>
            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>¥{totalAmt.toFixed(2)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 11, color: "#34C759" }}>已付 ¥{totalPaid.toFixed(2)}</Text>
            <Text style={{ fontSize: 11, color: colors.error }}>待付 ¥{totalRemaining.toFixed(2)}</Text>
          </View>
        </View>

        {/* 按品类分组的供应商货款卡片 */}
        {CATEGORY_ORDER.map((cat) => {
          const catSuppliers = suppliers.filter((s) => s.category === cat && s.active);
          if (catSuppliers.length === 0) return null;
          return (
            <View key={cat} style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, marginTop: 8 }}>
                <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: SUPPLIER_CATEGORY_COLORS[cat] }} />
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>{CATEGORY_LABELS[cat]}</Text>
              </View>
              {catSuppliers.map((sup) => {
                const payment = supplierPayments.find((p) => p.payeeId === sup.id);
                if (!payment) {
                  // 没有货款记录：显示空卡片
                  return (
                    <View key={sup.id} style={[S.payrollCard, {
                      backgroundColor: colors.surface, borderColor: colors.border,
                      borderLeftColor: colors.border, borderLeftWidth: 3,
                    }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: colors.foreground }}>{sup.name}</Text>
                        {sup.paymentTerms ? (
                          <View style={[S.statusTag, { backgroundColor: colors.border + "33" }]}>
                            <Text style={{ fontSize: 10, color: colors.muted }}>{sup.paymentTerms}</Text>
                          </View>
                        ) : null}
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.muted }}>—</Text>
                      </View>
                    </View>
                  );
                }
                return renderSupplierCard(payment, sup);
              })}
            </View>
          );
        })}

        {/* 工资发放 */}
        {employees.filter((e: any) => e.active).length > 0 && (
          <View style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, marginTop: 8 }}>
              <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: "#5856D6" }} />
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>工资</Text>
            </View>
            {employees.filter((e: any) => e.active).map((emp: any) => {
              const payment = employeePayments.find((p) => p.payeeId === emp.id);
              const defaultBank = emp.bankAccounts?.find((b: any) => b.isDefault) ?? emp.bankAccounts?.[0];
              const totalAmt2 = payment?.totalAmount ?? 0;
              const advAmt2 = payment?.advanceAmount ?? 0;
              const paidAmt2 = payment?.paidAmount ?? 0;
              const actualRemaining2 = Math.max(0, totalAmt2 - advAmt2 - paidAmt2);
              const status2 = payment?.status ?? "unpaid";
              const statusColor2 = status2 === "paid" ? "#34C759" : status2 === "partial" ? colors.warning : colors.error;
              return (
                <View key={emp.id} style={[S.payrollCard, {
                  backgroundColor: colors.surface, borderColor: colors.border,
                  borderLeftColor: totalAmt2 === 0 ? colors.border : statusColor2, borderLeftWidth: 3,
                }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 15, fontWeight: "700", color: colors.foreground }}>{emp.realName}</Text>
                    {payment?.notes ? <Text style={{ fontSize: 11, color: colors.muted }}>{payment.notes}</Text> : null}
                    {totalAmt2 > 0 && (
                      <View style={[S.statusTag, { backgroundColor: statusColor2 + "15" }]}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: statusColor2 }}>
                          {status2 === "paid" ? "✓ 已发" : status2 === "partial" ? "部分" : "待发"}
                        </Text>
                      </View>
                    )}
                    <Text style={{ fontSize: 14, fontWeight: "700", color: totalAmt2 === 0 ? colors.muted : colors.foreground }}>
                      {totalAmt2 === 0 ? "—" : `¥${totalAmt2.toFixed(0)}`}
                    </Text>
                  </View>
                  {totalAmt2 > 0 && defaultBank && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <Text style={{ flex: 1, fontSize: 11, color: colors.muted }}>{defaultBank.bankName} {maskCardNumber(defaultBank.cardNumber)}</Text>
                      <TouchableOpacity onPress={() => handleCopy([`收款人：${defaultBank.accountName}`, `开户行：${defaultBank.bankName}`, `卡号：${defaultBank.cardNumber}`, `金额：¥${(actualRemaining2 > 0 ? actualRemaining2 : totalAmt2).toFixed(2)}`, `备注：${emp.realName} ${selectedMonth} 薪资`].join("\n"))} style={[S.miniBtn, { backgroundColor: colors.primary }]}>
                        <IconSymbol name="doc.on.clipboard" size={10} color="#fff" /><Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>复制</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* 备用金已付科目卡片（从月报 lineItems 中提取） */}
        {(() => {
          const pettyItems = [...(report?.lineItems ?? []), ...(report?.manualItems ?? [])]
            .filter((i) => i.source === "petty_cash" && !i.isManual && i.amount !== 0 && !(i.manualDuplicate !== undefined ? i.manualDuplicate : i.isDuplicate));
          if (pettyItems.length === 0) return null;
          return (
            <View style={{ marginBottom: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, marginTop: 8 }}>
                <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: "#FF9500" }} />
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted }}>备用金已付项目</Text>
              </View>
              {pettyItems.map((item) => (
                <View key={item.id} style={[S.payrollCard, {
                  backgroundColor: colors.surface, borderColor: colors.border,
                  borderLeftColor: "#34C759", borderLeftWidth: 3,
                }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.foreground }}>{item.label}</Text>
                    <View style={[S.statusTag, { backgroundColor: "#34C75915" }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: "#34C759" }}>
                        {item.paymentNote || "已付(备用金)"}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
                      {Math.abs(item.amount) === 0 ? "—" : `¥${Math.abs(item.amount).toFixed(0)}`}
                    </Text>
                  </View>
                  {item.notes ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{item.notes}</Text> : null}
                </View>
              ))}
            </View>
          );
        })()}

        {/* 手工新增货款卡片按钮 */}
        <TouchableOpacity onPress={() => { tap(); setAddPaymentLabel(""); setAddPaymentAmount(""); setAddPaymentNotes(""); setShowAddPaymentModal(true); }}
          style={[S.addItemBtn, { marginTop: 8, borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
          <IconSymbol name="plus.circle.fill" size={16} color={colors.primary} />
          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600" }}>新增货款卡片</Text>
        </TouchableOpacity>

        {supplierPayments.length === 0 && employeePayments.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 36 }}>💳</Text>
            <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>暂无货款记录</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6, textAlign: "center" }}>
              点击「一键自动汇总」后，货款记录将自动生成
            </Text>
          </View>
        )}
      </ScrollView>
    );
  };

  // ── 历史 Tab ──────────────────────────────────────────────────────────────
  const renderHistory = () => {
    const sortedReports = [...reports].sort((a, b) => a.month.localeCompare(b.month));
    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {sortedReports.length === 0 ? (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 36 }}>📊</Text>
            <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>暂无历史报表</Text>
          </View>
        ) : (
          sortedReports.map((r) => (
            <TouchableOpacity key={r.id} onPress={() => { tap(); setSelectedMonth(r.month); setTab("report"); }}
              style={[S.historyRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{r.month}</Text>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>净利润</Text>
                <Text style={{ fontSize: 16, fontWeight: "700", color: r.netProfit >= 0 ? "#34C759" : colors.error }}>
                  {r.netProfit >= 0 ? "+" : ""}¥{r.netProfit.toFixed(2)}
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={14} color={colors.muted} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    );
  };

  return (
    <ScreenContainer>
      {/* 导航栏：左返回 + 标题 + 右上角历史/供应商 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{`${Number(selectedMonth.slice(5, 7))}月报表`}</Text>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          {/* 历史报表入口 */}
          <Pressable onPress={() => { tap(); setShowHistoryModal(true); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="clock.arrow.circlepath" size={20} color={colors.muted} />
          </Pressable>
          {/* 供应商档案入口 */}
          <Pressable onPress={() => router.push("/suppliers" as any)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="building.2.fill" size={20} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {/* 单页滚动视图 */}
      {renderSinglePage()}

      {copyToast ? (
        <View style={[S.toast, { backgroundColor: colors.foreground }]}>
          <Text style={{ color: colors.background, fontSize: 13 }}>{copyToast}</Text>
        </View>
      ) : null}

      <ManualItemModal
        visible={showManualModal} item={editingItem} colors={colors}
        onSave={handleSaveManualItem}
        onClose={() => { setShowManualModal(false); setEditingItem(null); }}
      />
      <BalanceModal
        visible={showBalanceModal} balance={editingBalance}
        accountType={balanceAccountType} month={selectedMonth} colors={colors}
        onSave={(b) => upsertBalance(b)}
        onClose={() => { setShowBalanceModal(false); setEditingBalance(null); }}
      />

      {/* ── 部分付款 Modal ── */}
      <Modal visible={showPartialPayModal} animationType="slide" presentationStyle="formSheet"
        onRequestClose={() => setShowPartialPayModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[S.navbar, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setShowPartialPayModal(false)} style={{ padding: 8 }}>
                <Text style={{ fontSize: 17, color: colors.error }}>取消</Text>
              </Pressable>
              <Text style={[S.navTitle, { color: colors.foreground }]}>录入付款</Text>
              <Pressable onPress={() => {
                if (!partialPayTarget) return;
                const amt = parseFloat(partialPayAmount) || 0;
                if (amt <= 0) { Alert.alert("请输入有效金额"); return; }
                addPaymentEntry(partialPayTarget.id, {
                  date: new Date().toISOString().slice(0, 10),
                  amount: amt,
                  bankAccountId: "",
                  paymentMethod: partialPayMethod,
                  accountType: partialPayAccountType,
                  notes: partialPayNotes,
                });
                setShowPartialPayModal(false);
                tap();
              }} style={{ padding: 8 }}>
                <Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>确认</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>本次付款金额</Text>
                <TextInput value={partialPayAmount} onChangeText={setPartialPayAmount}
                  keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.muted}
                  style={{ fontSize: 28, fontWeight: "700", color: colors.foreground, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 12 }} />
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>付款方式</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                  {["转账", "现金", "微信", "支付宝"].map((m) => (
                    <TouchableOpacity key={m} onPress={() => setPartialPayMethod(m)}
                      style={[S.statusTag, { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: partialPayMethod === m ? colors.primary : colors.surface, borderColor: partialPayMethod === m ? colors.primary : colors.border, borderWidth: 1 }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: partialPayMethod === m ? "#fff" : colors.foreground }}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>付款账户</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
                  {(["company", "personal", "petty", "pos"] as const).map((t) => (
                    <TouchableOpacity key={t} onPress={() => setPartialPayAccountType(t)}
                      style={[S.statusTag, { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: partialPayAccountType === t ? ACCOUNT_TYPE_COLORS[t] : colors.surface, borderColor: partialPayAccountType === t ? ACCOUNT_TYPE_COLORS[t] : colors.border, borderWidth: 1 }]}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: partialPayAccountType === t ? "#fff" : colors.foreground }}>{ACCOUNT_TYPE_LABELS[t]}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>备注</Text>
                <TextInput value={partialPayNotes} onChangeText={setPartialPayNotes}
                  placeholder="付款备注" placeholderTextColor={colors.muted}
                  style={{ fontSize: 14, color: colors.foreground, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 手工新增货款卡片 Modal ── */}
      <Modal visible={showAddPaymentModal} animationType="slide" presentationStyle="formSheet"
        onRequestClose={() => setShowAddPaymentModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[S.navbar, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setShowAddPaymentModal(false)} style={{ padding: 8 }}>
                <Text style={{ fontSize: 17, color: colors.error }}>取消</Text>
              </Pressable>
              <Text style={[S.navTitle, { color: colors.foreground }]}>新增货款卡片</Text>
              <Pressable onPress={() => {
                if (!addPaymentLabel.trim()) { Alert.alert("请填写名称"); return; }
                const amt = parseFloat(addPaymentAmount) || 0;
                const now = new Date().toISOString();
                upsertPayment({
                  id: uuid(), month: selectedMonth,
                  payeeId: `manual_${uuid()}`, payeeType: "supplier",
                  sourceType: "manual", displayLabel: addPaymentLabel.trim(),
                  totalAmount: amt, paidAmount: 0, remainingAmount: amt,
                  status: "unpaid", payments: [], advanceAmount: 0,
                  notes: addPaymentNotes.trim(),
                  createdAt: now, updatedAt: now,
                });
                setShowAddPaymentModal(false);
                tap();
              }} style={{ padding: 8 }}>
                <Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>名称 *</Text>
                <TextInput value={addPaymentLabel} onChangeText={setAddPaymentLabel}
                  placeholder="如 房租、冰块供应商" placeholderTextColor={colors.muted}
                  style={{ fontSize: 15, color: colors.foreground, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 12 }} />
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>应付金额</Text>
                <TextInput value={addPaymentAmount} onChangeText={setAddPaymentAmount}
                  keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.muted}
                  style={{ fontSize: 15, color: colors.foreground, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 12 }} />
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>备注</Text>
                <TextInput value={addPaymentNotes} onChangeText={setAddPaymentNotes}
                  placeholder="备注信息" placeholderTextColor={colors.muted}
                  style={{ fontSize: 14, color: colors.foreground, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }} />
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── 月报设置 Modal ── */}
      <Modal visible={showSettingsModal} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => setShowSettingsModal(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[S.navbar, { borderBottomColor: colors.border }]}>
            <View style={{ width: 44 }} />
            <Text style={[S.navTitle, { color: colors.foreground }]}>月报设置</Text>
            <Pressable onPress={() => setShowSettingsModal(false)} style={{ padding: 8 }}>
              <Text style={{ fontSize: 17, color: colors.primary }}>完成</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            {(["petty", "inventory"] as const).map((k) => (
              <TouchableOpacity key={k} onPress={() => setSettingsTab(k)}
                style={{ flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: settingsTab === k ? colors.primary : "transparent" }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: settingsTab === k ? colors.primary : colors.muted }}>
                  {k === "petty" ? "备用金分类" : "库存模块"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {settingsTab === "petty" && (
              <View>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>
                  配置每个备用金分类是否在月报中单独显示。开启后，该分类将生成独立科目行；关闭后归入「备用金其他费用」汇总。
                </Text>
                <TouchableOpacity onPress={() => Alert.alert("重置", "确认重置所有备用金分类配置为默认值？", [{ text: "取消", style: "cancel" }, { text: "重置", style: "destructive", onPress: () => { resetPettyCodeConfigs(); tap(); } }])}
                  style={[S.addItemBtn, { marginBottom: 12, borderColor: colors.error + "44", backgroundColor: colors.error + "08" }]}>
                  <Text style={{ fontSize: 13, color: colors.error }}>重置为默认配置</Text>
                </TouchableOpacity>
                {PETTY_GROUPS.map((group) => (
                  <View key={group.label} style={{ marginBottom: 16 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>{group.label}</Text>
                    {group.codes.map((code) => {
                      const cfg = getPettyCodeConfig(code) ?? { code, inventoryModule: null, isLabor: false, showInReport: false, customLabel: null, reportCategory: null };
                      return (
                        <View key={code} style={[S.payrollCard, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftWidth: 0 }]}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>
                                {cfg.customLabel ?? (PETTY_CODE_LABELS as any)[code] ?? code}
                              </Text>
                              <Text style={{ fontSize: 11, color: colors.muted }}>
                                {cfg.inventoryModule ? `归属：${cfg.inventoryModule}` : cfg.isLabor ? "归属：人工" : "归属：备用金汇总"}
                              </Text>
                            </View>
                            <TouchableOpacity onPress={() => { upsertPettyCodeConfig({ ...cfg, showInReport: !cfg.showInReport }); tap(); }}
                              style={[S.statusTag, { backgroundColor: cfg.showInReport ? colors.primary + "15" : colors.surface, borderColor: cfg.showInReport ? colors.primary : colors.border, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 }]}>
                              <Text style={{ fontSize: 11, fontWeight: "700", color: cfg.showInReport ? colors.primary : colors.muted }}>
                                {cfg.showInReport ? "单独显示 ✓" : "归入汇总"}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}
            {settingsTab === "inventory" && (
              <View>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>
                  配置每个库存模块是否在月报中单独显示。关闭后，该模块的进货金额将归入「备用金其他费用」，但库存分析仍然使用该数据。
                </Text>
                <TouchableOpacity onPress={() => Alert.alert("重置", "确认重置所有库存模块配置为默认值？", [{ text: "取消", style: "cancel" }, { text: "重置", style: "destructive", onPress: () => { resetInventoryConfigs(); tap(); } }])}
                  style={[S.addItemBtn, { marginBottom: 12, borderColor: colors.error + "44", backgroundColor: colors.error + "08" }]}>
                  <Text style={{ fontSize: 13, color: colors.error }}>重置为默认配置</Text>
                </TouchableOpacity>
                {DEFAULT_INVENTORY_CONFIGS.map((defaultCfg) => {
                  const cfg = getInventoryConfig(defaultCfg.module) ?? defaultCfg;
                  return (
                    <View key={cfg.module} style={[S.payrollCard, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftWidth: 0 }]}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{cfg.groupLabel}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted }}>
                            {cfg.showInReport ? "在月报中单独显示供应商科目行" : "进货金额归入备用金汇总（库存分析仍使用）"}
                          </Text>
                        </View>
                        <TouchableOpacity onPress={() => { upsertInventoryConfig({ ...cfg, showInReport: !cfg.showInReport }); tap(); }}
                          style={[S.statusTag, { backgroundColor: cfg.showInReport ? colors.primary + "15" : colors.surface, borderColor: cfg.showInReport ? colors.primary : colors.border, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 }]}>
                          <Text style={{ fontSize: 11, fontWeight: "700", color: cfg.showInReport ? colors.primary : colors.muted }}>
                            {cfg.showInReport ? "单独显示 ✓" : "归入汇总"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

// ─── 月份选择器 ───────────────────────────────────────────────────────────────
function MonthSelector({ selectedMonth, onSelect, colors }: { selectedMonth: string; onSelect: (m: string) => void; colors: any }) {
  const months = useMemo(() => {
    const result: string[] = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return result;
  }, []);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, marginBottom: 12 }}>
      {months.map((m) => (
        <TouchableOpacity key={m} onPress={() => onSelect(m)}
          style={[S.monthChip, { backgroundColor: selectedMonth === m ? colors.primary : colors.surface, borderColor: selectedMonth === m ? colors.primary : colors.border }]}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: selectedMonth === m ? "#fff" : colors.muted }}>{m}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  tabBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  monthChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  profitCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  section: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  addItemBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", padding: 14, marginBottom: 10 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  infoBox: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
  accountCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  varianceBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 8, borderWidth: 1, padding: 10, marginTop: 8 },
  editBalBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  payrollSummary: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  payrollCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  statusTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  bankInfo: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 8, borderWidth: 1, padding: 10, marginTop: 10 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  addBankHint: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", padding: 10, marginTop: 10 },
  historyRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  accountMini: { borderRadius: 12, borderWidth: 1, padding: 12, flex: 1, minWidth: "45%" },
  inlineCard: { borderRadius: 10, borderWidth: 1, borderLeftWidth: 3, borderColor: "transparent", padding: 10, backgroundColor: "transparent" },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7 },
  amtBlock: { alignItems: "center", minWidth: 48 },
  amtLabel: { fontSize: 10, color: "#999", marginBottom: 2 },
  amtValue: { fontSize: 13, fontWeight: "600" },
  toast: { position: "absolute", bottom: 40, alignSelf: "center", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
});

const LI = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  dupTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  paidTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  unpaidTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
});

const MI = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  typeBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
});
