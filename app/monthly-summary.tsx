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
import { useEmployeeStore } from "@/lib/labor/store";
import {
  MonthlySummaryReport, SummaryLineItem, AccountBalance, MonthlyPaymentRecord,
  AccountType, ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_COLORS,
  maskCardNumber, generatePaymentCopyText,
} from "@/lib/store/monthly-summary/types";

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

  const { reports, upsertReport, getReport, getPaymentsForMonth, getBalancesForMonth, upsertBalance, addPaymentEntry, suppliers } = useMonthlySummaryStore();
  const { employees } = useEmployeeStore();

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
    const totalPaid = payrollPayments.reduce((s, p) => s + p.paidAmount, 0);
    const totalRemaining = payrollPayments.reduce((s, p) => s + p.remainingAmount, 0);

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 汇总 */}
        <View style={[S.payrollSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>本月薪资总额</Text>
            <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>¥{totalPayroll.toFixed(2)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 11, color: "#34C759" }}>已发 ¥{totalPaid.toFixed(2)}</Text>
            <Text style={{ fontSize: 11, color: colors.error }}>待发 ¥{totalRemaining.toFixed(2)}</Text>
          </View>
        </View>

        {/* 员工薪资卡片 */}
        {employees.filter((e) => e.active).map((emp) => {
          const payment = payrollPayments.find((p) => p.payeeId === emp.id);
          const defaultBank = emp.bankAccounts?.find((b) => b.isDefault) ?? emp.bankAccounts?.[0];
          const totalAmt = payment?.totalAmount ?? 0;
          const paidAmt = payment?.paidAmount ?? 0;
          const remaining = payment?.remainingAmount ?? totalAmt;
          const status = payment?.status ?? "unpaid";

          return (
            <View key={emp.id} style={[S.payrollCard, {
              backgroundColor: colors.surface, borderColor: colors.border,
              borderLeftColor: status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error,
              borderLeftWidth: 3,
            }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{emp.realName}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>（{emp.code}）</Text>
                    <View style={[S.statusTag, {
                      backgroundColor: status === "paid" ? "#34C75915" : status === "partial" ? colors.warning + "15" : colors.error + "15",
                    }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error }}>
                        {status === "paid" ? "已发" : status === "partial" ? "部分已发" : "待发"}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
                    <View>
                      <Text style={{ fontSize: 10, color: colors.muted }}>应发金额</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>¥{totalAmt.toFixed(2)}</Text>
                    </View>
                    {paidAmt > 0 && (
                      <View>
                        <Text style={{ fontSize: 10, color: colors.muted }}>已发</Text>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: "#34C759" }}>¥{paidAmt.toFixed(2)}</Text>
                      </View>
                    )}
                    {remaining > 0 && (
                      <View>
                        <Text style={{ fontSize: 10, color: colors.muted }}>待发</Text>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.error }}>¥{remaining.toFixed(2)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* 银行卡信息 */}
              {defaultBank ? (
                <View style={[S.bankInfo, { backgroundColor: "#007AFF08", borderColor: "#007AFF22" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{defaultBank.accountName}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{defaultBank.bankName}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground, letterSpacing: 1 }}>
                      {maskCardNumber(defaultBank.cardNumber)}
                    </Text>
                  </View>
                  <View style={{ gap: 6 }}>
                    <TouchableOpacity onPress={() => {
                      const text = generatePaymentCopyText({
                        recipientName: defaultBank.accountName,
                        bankName: defaultBank.bankName,
                        cardNumber: defaultBank.cardNumber,
                        amount: remaining > 0 ? remaining : totalAmt,
                        note: `${emp.realName} ${selectedMonth} 薪资`,
                      });
                      handleCopy(text);
                    }} style={[S.copyBtn, { backgroundColor: colors.primary }]}>
                      <IconSymbol name="doc.on.clipboard" size={12} color="#fff" />
                      <Text style={{ fontSize: 11, color: "#fff", fontWeight: "600" }}>复制付款信息</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={() => router.push(`/labor-employee-form?id=${emp.id}` as any)}
                  style={[S.addBankHint, { borderColor: colors.border }]}>
                  <IconSymbol name="creditcard.fill" size={14} color={colors.muted} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>未设置银行卡 · 点击前往员工档案添加</Text>
                </TouchableOpacity>
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
    const totalAmt = supplierPayments.reduce((s, p) => s + p.totalAmount, 0);
    const totalPaid = supplierPayments.reduce((s, p) => s + p.paidAmount, 0);
    const totalRemaining = supplierPayments.reduce((s, p) => s + p.remainingAmount, 0);

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

        {/* 供应商货款卡片 */}
        {supplierPayments.map((payment) => {
          const sup = suppliers.find((s) => s.id === payment.payeeId);
          if (!sup) return null;
          const defaultBank = sup.bankAccounts.find((b) => b.isDefault) ?? sup.bankAccounts[0];
          const status = payment.status;

          return (
            <View key={payment.id} style={[S.payrollCard, {
              backgroundColor: colors.surface, borderColor: colors.border,
              borderLeftColor: status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error,
              borderLeftWidth: 3,
            }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{sup.name}</Text>
                    {sup.paymentTerms ? (
                      <View style={[S.statusTag, { backgroundColor: colors.border + "33" }]}>
                        <Text style={{ fontSize: 10, color: colors.muted }}>{sup.paymentTerms}</Text>
                      </View>
                    ) : null}
                    <View style={[S.statusTag, {
                      backgroundColor: status === "paid" ? "#34C75915" : status === "partial" ? colors.warning + "15" : colors.error + "15",
                    }]}>
                      <Text style={{ fontSize: 10, fontWeight: "700", color: status === "paid" ? "#34C759" : status === "partial" ? colors.warning : colors.error }}>
                        {status === "paid" ? "已付" : status === "partial" ? "部分已付" : "待付"}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 16, marginTop: 6 }}>
                    <View>
                      <Text style={{ fontSize: 10, color: colors.muted }}>应付金额</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>¥{payment.totalAmount.toFixed(2)}</Text>
                    </View>
                    {payment.paidAmount > 0 && (
                      <View>
                        <Text style={{ fontSize: 10, color: colors.muted }}>已付</Text>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: "#34C759" }}>¥{payment.paidAmount.toFixed(2)}</Text>
                      </View>
                    )}
                    {payment.remainingAmount > 0 && (
                      <View>
                        <Text style={{ fontSize: 10, color: colors.muted }}>待付</Text>
                        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.error }}>¥{payment.remainingAmount.toFixed(2)}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* 银行卡 */}
              {defaultBank ? (
                <View style={[S.bankInfo, { backgroundColor: "#007AFF08", borderColor: "#007AFF22" }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>{defaultBank.accountName}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{defaultBank.bankName}</Text>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground, letterSpacing: 1 }}>
                      {maskCardNumber(defaultBank.cardNumber)}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => {
                    const text = generatePaymentCopyText({
                      recipientName: defaultBank.accountName,
                      bankName: defaultBank.bankName,
                      cardNumber: defaultBank.cardNumber,
                      amount: payment.remainingAmount > 0 ? payment.remainingAmount : payment.totalAmount,
                      note: `${sup.name} ${selectedMonth} 货款`,
                    });
                    handleCopy(text);
                  }} style={[S.copyBtn, { backgroundColor: colors.primary }]}>
                    <IconSymbol name="doc.on.clipboard" size={12} color="#fff" />
                    <Text style={{ fontSize: 11, color: "#fff", fontWeight: "600" }}>复制付款信息</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => router.push("/suppliers" as any)}
                  style={[S.addBankHint, { borderColor: colors.border }]}>
                  <IconSymbol name="creditcard.fill" size={14} color={colors.muted} />
                  <Text style={{ fontSize: 12, color: colors.muted }}>未设置银行卡 · 前往供应商档案添加</Text>
                </TouchableOpacity>
              )}

              {/* 付款记录 */}
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
        })}

        {supplierPayments.length === 0 && (
          <View style={{ alignItems: "center", padding: 40 }}>
            <Text style={{ fontSize: 36 }}>💳</Text>
            <Text style={{ fontSize: 15, color: colors.muted, marginTop: 12 }}>暂无货款记录</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6, textAlign: "center" }}>
              在总报表中录入进货成本后，货款记录将自动生成
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
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>{`${Number(selectedMonth.slice(5, 7))}月报表`}</Text>
        <Pressable onPress={() => router.push("/suppliers" as any)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <IconSymbol name="building.2.fill" size={20} color={colors.muted} />
        </Pressable>
      </View>

      {/* Tab 栏 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 4 }}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} onPress={() => { tap(); setTab(t.key); }}
            style={[S.tabBtn, {
              backgroundColor: tab === t.key ? colors.primary : colors.surface,
              borderColor: tab === t.key ? colors.primary : colors.border,
            }]}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === t.key ? "#fff" : colors.muted }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === "report" && renderReport()}
      {tab === "accounts" && renderAccounts()}
      {tab === "payroll" && renderPayroll()}
      {tab === "payments" && renderPayments()}
      {tab === "history" && renderHistory()}

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
