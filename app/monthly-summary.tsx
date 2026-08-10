/**
 * 月度总报表主页面（Build 120）
 *
 * 单页总报表：
 *   1. 科目树（收入 / 成本 / 人工 / 房租 / 水电 / Extra）
 *   2. 工资科目区块（按部门 + 临时兼职自动分组）
 *   3. 供应商货款区块（嵌入进货成本科目）
 *   4. 月报设置（备用金/库存显示规则）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/utils";
import {
  Alert, Clipboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useFeature } from "@/hooks/use-feature";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { useEmployeeStore, usePaySlipStore, useDeptOrderStore, DEFAULT_DEPT_ORDER } from "@/lib/labor/store";
import { useSpiritsInventoryStore } from "@/lib/spirits/crud-store";
import { calcMonthlyPourCost, pourCostColor } from "@/lib/spirits/pour-cost";
import { usePettyCashStore } from "@/lib/store/petty-store";
import { useMonthlyReportStore } from "@/lib/store/monthly-report/store";
import { useSupplierPurchaseStore } from "@/lib/food/ingredient-store";
import { useWineSnapshotStore, useWineManualPurchaseStore } from "@/lib/wine/store";
import { aggregateMonthlyReport } from "@/lib/store/monthly-summary/aggregator";
import { usePettyLaborLinkStore } from "@/lib/store/petty-labor-link-store";
import {
  MonthlySummaryReport, SummaryLineItem,
  ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_COLORS,
  maskCardNumber, generatePaymentCopyText, SUPPLIER_CATEGORY_COLORS,
  PettyCodeConfig, InventoryReportConfig,
  DEFAULT_PETTY_CODE_CONFIGS, DEFAULT_INVENTORY_CONFIGS,
} from "@/lib/store/monthly-summary/types";
import { PETTY_CODE_LABELS, PETTY_GROUPS } from "@/lib/store/petty-store";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }


const CATEGORY_SECTIONS = [
  { key: "revenue", label: "本月收入", sign: 1, color: "#52C41A" },
  { key: "cogs_food", label: "进货成本·食材", sign: -1, color: "#FA8C16" },
  { key: "cogs_beverage", label: "进货成本·酒水", sign: -1, color: "#5856D6" },
  { key: "cogs_wine", label: "进货成本·葡萄酒", sign: -1, color: "#C2185B" },
  { key: "labor", label: "工资", sign: -1, color: "#FF4D4F" },
  { key: "rent", label: "房租", sign: -1, color: "#1677FF" },
  { key: "utilities", label: "水电", sign: -1, color: "#00BCD4" },
  { key: "petty_other", label: "备用金其他费用", sign: -1, color: "#FA8C16" },
  { key: "extra", label: "Extra INFO", sign: -1, color: "#8E8E93" },
];

// ─── 科目行组件 ───────────────────────────────────────────────────────────────
function LineItemRow({ item, colors, linkedModule }: { item: SummaryLineItem; colors: any; linkedModule?: string }) {
  const isPositive = item.amount > 0;
  const amtColor = item.isDuplicate ? colors.muted : isPositive ? colors.success ?? colors.success : colors.error;
  const isNavigable = !item.isManual && !!linkedModule;

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
            <View style={[LI.paidTag, { backgroundColor: colors.success + "15" }]}>
              <Text style={{ fontSize: 9, color: colors.success }}>{item.paymentNote || "已付"}</Text>
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: amtColor, minWidth: 80, textAlign: "right" }}>
          {item.amount === 0 ? "—" : `${isPositive ? "+" : ""}¥${formatMoney(Math.abs(item.amount))}`}
        </Text>
        {isNavigable && (
          <IconSymbol name="chevron.right" size={12} color={colors.muted} />
        )}
      </View>
    </View>
  );
}

// ─── 手动录入 Modal ───────────────────────────────────────────────────────────
// ─── 部分付款 Modal ────────────────────────────────────────────────────────────
function PaymentEntryModal({ visible, target, colors, onConfirm, onClose }: {
  visible: boolean;
  target: { id: string; name: string; remaining: number } | null;
  colors: any;
  onConfirm: (paymentId: string, amount: number, method: string, accountType: string, notes: string) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState("转账");
  const [accountType, setAccountType] = React.useState("公司账户");
  const [notes, setNotes] = React.useState("");

  React.useEffect(() => {
    if (visible && target) {
      setAmount(target.remaining > 0 ? String(target.remaining.toFixed(0)) : "");
      setMethod("转账");
      setAccountType("公司账户");
      setNotes("");
    }
  }, [visible, target]);

  const METHODS = ["转账", "现金", "微信", "支付宝"];
  const ACCOUNT_TYPES = ["公司账户", "私人账户", "备用金", "POS汇款"];

  const handleConfirm = () => {
    if (!target) return;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert("请输入有效金额"); return; }
    onConfirm(target.id, amt, method, accountType, notes.trim());
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={[MI.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>录入付款</Text>
            <Pressable onPress={handleConfirm}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>确认</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {target && (
              <View style={[MI.section, { borderColor: colors.border, marginBottom: 12 }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{target.name}</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>待付金额：¥{formatMoney(target.remaining)}</Text>
              </View>
            )}
            <View style={[MI.section, { borderColor: colors.border }]}>
              <Text style={[MI.sectionTitle, { color: colors.muted }]}>付款信息</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>本次付款金额 *</Text>
              <TextInput value={amount} onChangeText={setAmount} placeholder="0.00"
                keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                style={[MI.input, { color: colors.foreground, borderColor: colors.border }]} />
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>付款方式</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {METHODS.map((m) => (
                  <TouchableOpacity key={m} onPress={() => setMethod(m)}
                    style={[MI.catChip, { backgroundColor: method === m ? colors.primary : colors.surface, borderColor: method === m ? colors.primary : colors.border }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: method === m ? "#fff" : colors.foreground }}>{m}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>付款账户</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {ACCOUNT_TYPES.map((a) => (
                  <TouchableOpacity key={a} onPress={() => setAccountType(a)}
                    style={[MI.catChip, { backgroundColor: accountType === a ? colors.primary : colors.surface, borderColor: accountType === a ? colors.primary : colors.border }]}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: accountType === a ? "#fff" : colors.foreground }}>{a}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4, marginTop: 10 }}>备注</Text>
              <TextInput value={notes} onChangeText={setNotes} placeholder="备注信息"
                placeholderTextColor={colors.muted}
                style={[MI.input, { color: colors.foreground, borderColor: colors.border }]} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

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
                  style={[MI.typeBtn, { backgroundColor: !isExpense ? "#52C41A15" : colors.surface, borderColor: !isExpense ? colors.success : colors.border }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: !isExpense ? colors.success : colors.muted }}>收入 +</Text>
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

// ─── 主页面 ───────────────────────────────────────────────────────────────────
export default function MonthlySummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isReadOnly } = useFeature();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const {
    reports, upsertReport, getReport, getPaymentsForMonth,
    upsertPayment, deletePayment, suppliers,
    pettyCodeConfigs, inventoryConfigs,
    upsertPettyCodeConfig, deletePettyCodeConfig, resetPettyCodeConfigs,
    upsertInventoryConfig, resetInventoryConfigs,
    getPettyCodeConfig, getInventoryConfig,
  } = useMonthlySummaryStore();
  const { employees } = useEmployeeStore();
  const { deptOrder } = useDeptOrderStore();
  const paySlipStore = usePaySlipStore();
  const spiritsStore = useSpiritsInventoryStore();
  const pettyStore = usePettyCashStore();
  const pettyLaborLinkStore = usePettyLaborLinkStore();
  const monthlyReportStore = useMonthlyReportStore();
  const supplierPurchaseStore = useSupplierPurchaseStore();
  const wineSnapshotStore = useWineSnapshotStore();
  const wineManualPurchaseStore = useWineManualPurchaseStore();

  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [showManualModal, setShowManualModal] = useState(false);
  const [editingItem, setEditingItem] = useState<SummaryLineItem | null>(null);
  const [copyToast, setCopyToast] = useState("");
  // 月报设置 Modal
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"petty" | "inventory">("petty");

  const report = useMemo(() => getReport(selectedMonth), [reports, selectedMonth]);
  const payments = useMemo(() => getPaymentsForMonth(selectedMonth), [selectedMonth]);

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
      notes: "", isFinalized: false,
      createdAt: now, updatedAt: now,
    };
    upsertReport(newReport);
    return newReport;
  };

  // ── 自动同步：paySlips 变化时自动更新月报 labor lineItems（防抖 800ms）──
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncLaborLineItems = useCallback((month: string) => {
    const slips = paySlipStore?.paySlips?.filter((s: any) => s.month === month) ?? [];
    if (slips.length === 0) return;
    const r = getReport(month);
    if (!r) return; // 月报不存在时不自动创建
    const existingNonLabor = (r.lineItems ?? []).filter((i: any) => i.category !== "labor");
    const laborItems = slips.map((slip: any) => {
      const emp = employees.find((e) => e.id === slip.employeeId);
      return {
        id: `labor_${slip.employeeId}`,
        code: `labor_${slip.employeeId}`,
        label: emp?.realName ?? slip.employeeId,
        category: "labor" as import("@/lib/store/monthly-summary/types").AccountCategory,
        amount: -(slip.finalSalary ?? 0),
        source: "labor" as import("@/lib/store/monthly-summary/types").DataSource,
        employeeId: slip.employeeId,
        linkedModule: "labor-attendance",
        notes: slip.notes ?? "",
        isManual: false,
        isDuplicate: false,
        isPaid: false,
        paymentNote: "",
        duplicateNote: "",
      };
    });
    const newLineItems = [...existingNonLabor, ...laborItems];
    const totalLabor = laborItems.reduce((s: number, i: any) => s + Math.abs(i.amount), 0);
    upsertReport({ ...r, lineItems: newLineItems, totalLabor, updatedAt: new Date().toISOString() });
  }, [paySlipStore, employees, getReport, upsertReport]);

  useEffect(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncLaborLineItems(selectedMonth);
    }, 800);
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [paySlipStore?.paySlips, selectedMonth, syncLaborLineItems]);

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

  // 科目行长按菜单（所有行均支持手工标记重复/取消重复）
  const handleLineItemLongPress = (item: SummaryLineItem) => {
    const r = getOrCreateReport();
    const isManualDup = item.manualDuplicate === true;
    const isAutoOrManualDup = item.isDuplicate || isManualDup;
    const actions: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [];
    if (!isAutoOrManualDup) {
      actions.push({
        text: "标记为已在其他科目计入（不重复叠加）",
        onPress: () => {
          const update = (arr: SummaryLineItem[]) =>
            arr.map((i) => i.id === item.id ? { ...i, manualDuplicate: true, isDuplicate: true, duplicateNote: "手工标记：已在其他科目计算" } : i);
          upsertReport({ ...r, lineItems: update(r.lineItems), manualItems: update(r.manualItems), updatedAt: new Date().toISOString() });
        },
      });
    } else {
      actions.push({
        text: "取消重复标记",
        onPress: () => {
          const update = (arr: SummaryLineItem[]) =>
            arr.map((i) => i.id === item.id ? { ...i, manualDuplicate: false, isDuplicate: false, duplicateNote: "" } : i);
          upsertReport({ ...r, lineItems: update(r.lineItems), manualItems: update(r.manualItems), updatedAt: new Date().toISOString() });
        },
      });
    }
    if (item.isManual) {
      actions.push({ text: "编辑", onPress: () => { setEditingItem(item); setShowManualModal(true); } });
      actions.push({ text: "删除", style: "destructive", onPress: () => handleDeleteManualItem(item.id) });
    }
    actions.push({ text: "取消", style: "cancel" });
    Alert.alert("操作", item.label, actions);
  };

  // 部分付款 Modal 状态
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{ id: string; name: string; remaining: number } | null>(null);

  const handleOpenPaymentModal = (paymentId: string, name: string, remaining: number) => {
    setPaymentTarget({ id: paymentId, name, remaining });
    setShowPaymentModal(true);
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
    // 备用金人工关联数据（已纳入薪资预支的条目）
    const monthLaborLinks = pettyLaborLinkStore.getLinksForMonth(selectedMonth);
    const laborLinkedPettyIds = new Set(monthLaborLinks.map((l) => l.pettyRecordId));
    const laborLinkedTotal = monthLaborLinks.reduce((s, l) => s + l.amount, 0);
    // 调用聚合器（labor 科目由自动同步负责，不传入 paySlips/allEmployees）
    const aggregated = aggregateMonthlyReport({
      month: selectedMonth,
      monthlyReport,
      pettyRecords,
      // paySlips 和 allEmployees 不传入：labor lineItems 由 syncLaborLineItems 自动同步维护
      spiritPurchaseSummary,
      allSpiritSupplierNames,
      foodPurchaseRecords,
      wineSnapshotSupplierTotals,
      wineManualPurchases,
      allWineSupplierNames,
      pettyCodeConfigs,
      inventoryConfigs,
      laborLinkedPettyIds,
      laborLinkedTotal,
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
            // 保留现有 labor lineItems（由自动同步维护），只覆盖非 labor 科目
            const existingLaborItems = (r.lineItems ?? []).filter((i) => i.category === "labor");
            const nonLaborAggregated = (aggregated.lineItems ?? []).filter((i) => i.category !== "labor");
            upsertReport({
              ...r,
              ...aggregated,
              lineItems: [...nonLaborAggregated, ...existingLaborItems],
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

  // ── 手工新增货款 Modal 状态 ──
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [addPaymentType, setAddPaymentType] = useState<"supplier" | "employee">("supplier");
  const [addPaymentName, setAddPaymentName] = useState("");
  const [addPaymentAmount, setAddPaymentAmount] = useState("");
  const [addPaymentNotes, setAddPaymentNotes] = useState("");

  const handleAddManualPayment = () => {
    const amt = parseFloat(addPaymentAmount);
    if (!addPaymentName.trim()) { Alert.alert("请填写名称"); return; }
    if (!amt || amt <= 0) { Alert.alert("请输入有效金额"); return; }
    const now = new Date().toISOString();
    upsertPayment({
      id: uuid(), month: selectedMonth,
      payeeId: `manual_${uuid()}`,
      payeeType: addPaymentType,
      totalAmount: amt, paidAmount: 0, remainingAmount: amt,
      status: "unpaid", payments: [], advanceAmount: 0,
      notes: `${addPaymentName.trim()}${addPaymentNotes.trim() ? " · " + addPaymentNotes.trim() : ""}`,
      createdAt: now, updatedAt: now,
    });
    setShowAddPaymentModal(false);
    setAddPaymentName("");
    setAddPaymentAmount("");
    setAddPaymentNotes("");
    tap();
  };
  // ── 总报表 Tab 数据计算（useMemo 避免每次渲染重复计算）
  const reportCalc = useMemo(() => {
    const allItems = [...(report?.lineItems ?? []), ...(report?.manualItems ?? [])];
    const payrollPaymentsR = payments.filter((p) => p.payeeType === "employee");
    const sections = CATEGORY_SECTIONS.map((cs) => ({
      ...cs,
      items: allItems.filter((i) => i.category === cs.key),
      subtotal: allItems.filter((i) => i.category === cs.key && !i.isDuplicate).reduce((s, i) => s + i.amount, 0),
    }));
    const totalRevenue = sections.find((s) => s.key === "revenue")?.subtotal ?? 0;
    const totalExpenses = sections.filter((s) => s.key !== "revenue").reduce((s, sec) => s + sec.subtotal, 0);
    const netProfit = totalRevenue + totalExpenses;
    return { allItems, payrollPaymentsR, sections, totalRevenue, totalExpenses, netProfit };
  }, [report, payments]);

  // ── 总报表 Tab ────────────────────────────────────────────────────────────
  const renderReport = () => {
    const { allItems, payrollPaymentsR, sections, totalRevenue, totalExpenses, netProfit } = reportCalc;

    return (
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 月份选择 */}
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 净利润大卡 */}
        <View style={[S.profitCard, {
          backgroundColor: netProfit >= 0 ? "#52C41A08" : colors.error + "08",
          borderColor: netProfit >= 0 ? "#52C41A33" : colors.error + "33",
        }]}>
          <Text style={{ fontSize: 12, color: colors.muted }}>本月净利润</Text>
          <Text style={{ fontSize: 32, fontWeight: "800", color: netProfit >= 0 ? colors.success : colors.error }}>
            {netProfit >= 0 ? "+" : ""}¥{formatMoney(netProfit)}
          </Text>
          <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
            <View>
              <Text style={{ fontSize: 10, color: colors.muted }}>总收入</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.success }}>+¥{formatMoney(totalRevenue)}</Text>
            </View>
            <View>
              <Text style={{ fontSize: 10, color: colors.muted }}>总支出</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.error }}>-¥{formatMoney(Math.abs(totalExpenses))}</Text>
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
              <Text style={{ fontSize: 14, fontWeight: "700", color: sec.sign > 0 ? colors.success : colors.error }}>
                {sec.sign > 0 ? "+" : ""}¥{formatMoney(sec.subtotal)}
              </Text>
            </View>
            {/* 工资科目不渲染科目行，只保留下方的「工资发放明细」卡片（避免重复） */}
            {sec.key !== "labor" && sec.items.map((item) => (
              <TouchableOpacity key={item.id}
                onPress={() => {
                  if (!item.isManual && item.linkedModule) {
                    const moduleRoutes: Record<string, string> = {
                      "labor-attendance": "/labor",
                      "monthly-report": "/monthly-report",
                      "spirits-inventory": "/spirits-inventory",
                      "wine-inventory": "/wine-inventory",
                      "supplier-import": "/suppliers",
                    };
                    const route = moduleRoutes[item.linkedModule];
                    if (route) router.push(route as any);
                  }
                }}
                onLongPress={() => handleLineItemLongPress(item)}>
                <LineItemRow item={item} colors={colors} linkedModule={item.linkedModule} />
              </TouchableOpacity>
            ))}
            {sec.key !== "labor" && sec.items.length === 0 && (
              <View style={{ padding: 12, alignItems: "center" }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>暂无数据 · 长按手动录入行可编辑</Text>
              </View>
            )}

            {/* 工资科目：按部门分组的员工薪资卡片（自动同步，无需手动刷新）*/}
            {sec.key === "labor" && (() => {
              const DEPT_GROUP_DEFS_MS: Record<string, { label: string; color: string; filter: (e: any) => boolean }> = {
                front:    { label: "前厅",   color: "#007AFF", filter: (e: any) => e.dept === "front" && e.type !== "parttime" },
                kitchen:  { label: "后厨",   color: "#34C759", filter: (e: any) => e.dept === "kitchen" && e.type !== "parttime" },
                other:    { label: "公司",   color: "#722ED1", filter: (e: any) => e.dept === "other" && e.type !== "parttime" },
                parttime: { label: "临时兼职", color: "#FF9500", filter: (e: any) => e.type === "parttime" },
              };
              const LABOR_DEPT_GROUPS = deptOrder.map((k) => ({ key: k, ...(DEPT_GROUP_DEFS_MS[k] ?? DEPT_GROUP_DEFS_MS.front) }));
              const activeEmps = employees.filter((e) => e.active !== false && !e.archived);
              const totalPending = payrollPaymentsR.reduce((s, p) => s + p.remainingAmount, 0);
              return (
                <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  {/* 标题栏 */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 10, paddingBottom: 6 }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.muted }}>工资发放明细</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {totalPending > 0 && <Text style={{ fontSize: 11, color: colors.error, fontWeight: "700" }}>待发 ¥{formatMoney(totalPending)}</Text>}
                      <TouchableOpacity onPress={() => router.push("/labor" as any)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary + "33" }}>
                        <Text style={{ fontSize: 10, color: colors.primary, fontWeight: "600" }}>薪资管理</Text>
                        <IconSymbol name="chevron.right" size={10} color={colors.primary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  {/* 按部门分组 */}
                  {LABOR_DEPT_GROUPS.map(({ key: gKey, label: gLabel, color: gColor, filter: gFilter }) => {
                    const deptEmps = activeEmps.filter(gFilter);
                    if (deptEmps.length === 0) return null;
                    return (
                      <View key={gKey} style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
                        {/* 分组标题 */}
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 5 }}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: gColor }} />
                          <Text style={{ fontSize: 11, fontWeight: "700", color: gColor }}>{gLabel}</Text>
                          <Text style={{ fontSize: 10, color: colors.muted }}>({deptEmps.length}人)</Text>
                        </View>
                        {/* 员工卡片 */}
                        {deptEmps.map((emp) => {
                          const payment = payrollPaymentsR.find((p) => p.payeeId === emp.id);
                          const slip = paySlipStore?.paySlips?.find((s: any) => s.employeeId === emp.id && s.month === selectedMonth);
                          const defaultBank = emp.bankAccounts?.find((b: any) => b.isDefault) ?? emp.bankAccounts?.[0];
                          const grossAmt = slip?.grossSalary ?? payment?.totalAmount ?? 0;
                          const advAmt = slip?.advanceAmount ?? payment?.advanceAmount ?? 0;
                          const finalAmt = slip?.finalSalary ?? Math.max(0, grossAmt - advAmt);
                          const status = payment?.status ?? "unpaid";
                          const isPaid = status === "paid";
                          const deptColor = gColor;
                          if (grossAmt === 0 && !slip && !payment) return null;
                          return (
                            <TouchableOpacity key={emp.id}
                              onPress={() => router.push({ pathname: "/labor-attendance" as any, params: { employeeId: emp.id, month: selectedMonth } })}
                              style={[S.inlineCard, { borderLeftColor: deptColor, marginBottom: 6 }]}>
                              {/* 新排版：左列（姓名）+ 中间三列（应发/预支/待发）+ 右列（未发已发+复制付款）*/}
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                {/* 左：姓名（上）+ 英文名（下）*/}
                                <View style={{ width: 64 }}>
                                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }} numberOfLines={1}>{emp.realName}</Text>
                                  {emp.realName !== emp.code && emp.code
                                    ? <Text style={{ fontSize: 11, color: colors.muted }} numberOfLines={1}>（{emp.code}）</Text>
                                    : null}
                                </View>
                                {/* 中间：应发 / 预支 / 待发 三列（标签 + 数字，完全对齐）*/}
                                <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }}>
                                  <View style={S.amtBlock}>
                                    <Text style={S.amtLabel}>应发</Text>
                                    <Text style={[S.amtValue, { color: colors.foreground }]}>¥{formatMoney(grossAmt)}</Text>
                                  </View>
                                  <View style={S.amtBlock}>
                                    <Text style={S.amtLabel}>预支</Text>
                                    <Text style={[S.amtValue, { color: advAmt > 0 ? colors.warning : colors.muted }]}>
                                      {advAmt > 0 ? `-¥${formatMoney(advAmt)}` : "0"}
                                    </Text>
                                  </View>
                                  <View style={S.amtBlock}>
                                    <Text style={S.amtLabel}>待发</Text>
                                    <Text style={[S.amtValue, { color: isPaid ? colors.success : colors.error, fontWeight: "800" }]}>¥{formatMoney(finalAmt)}</Text>
                                  </View>
                                </View>
                                {/* 右：未发/已发（上）+ 复制付款（下）*/}
                                <View style={{ alignItems: "flex-end", gap: 4, minWidth: 64 }}>
                                  {/* 未发/已发标签 */}
                                  {payment ? (
                                    <TouchableOpacity
                                      onPress={(e) => {
                                        e.stopPropagation?.();
                                        if (!isPaid) handleOpenPaymentModal(payment.id, emp.realName, finalAmt);
                                      }}
                                      style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                                        backgroundColor: isPaid ? colors.success + "18" : colors.error + "18",
                                        borderWidth: 1, borderColor: isPaid ? colors.success + "44" : colors.error + "44" }}>
                                      <Text style={{ fontSize: 11, fontWeight: "700", color: isPaid ? colors.success : colors.error }}>
                                        {isPaid ? "✓ 已发" : "未发"}
                                      </Text>
                                    </TouchableOpacity>
                                  ) : (
                                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.muted + "15" }}>
                                      <Text style={{ fontSize: 11, color: colors.muted }}>未发</Text>
                                    </View>
                                  )}
                                  {/* 复制付款按鈕 */}
                                  {defaultBank ? (
                                    <TouchableOpacity
                                      onPress={(e) => {
                                        e.stopPropagation?.();
                                        handleCopy([
                                          `姓名：${emp.realName}`,
                                          `银行：${defaultBank.bankName}`,
                                          `卡号：${defaultBank.cardNumber}`,
                                          `金额：${finalAmt.toFixed(0)}`,
                                        ].join("\n"));
                                      }}
                                      style={[S.miniBtn, { backgroundColor: colors.primary }]}>
                                      <IconSymbol name="doc.on.clipboard" size={10} color="#fff" />
                                      <Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>复制付款</Text>
                                    </TouchableOpacity>
                                  ) : (
                                    <View style={{ height: 22 }} />
                                  )}
                                </View>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>
              );
            })()}

            {/* 进货成本科目：供应商货款已移至底部「货款汇总」区域，此处不再重复展示 */}
          </View>
        ))}

        {/* 手动录入按钮 */}
        <TouchableOpacity onPress={() => { tap(); setEditingItem(null); setShowManualModal(true); }}
          style={[S.addItemBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
          <IconSymbol name="plus.circle.fill" size={18} color={colors.primary} />
          <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>手动录入科目</Text>
        </TouchableOpacity>

        {/* ── 货款汇总区域（独立展示，不重复嵌入科目） ── */}
        {(() => {
          const allPayments = payments.filter((p) => p.month === selectedMonth);
          if (allPayments.length === 0 && !isReadOnly) {
            return (
              <TouchableOpacity onPress={() => { tap(); setShowAddPaymentModal(true); }}
                style={[S.addItemBtn, { borderColor: colors.success + "44", backgroundColor: colors.success + "08" }]}>
                <IconSymbol name="creditcard.fill" size={18} color={colors.success} />
                <Text style={{ fontSize: 14, color: colors.success, fontWeight: "600" }}>新增货款卡片</Text>
              </TouchableOpacity>
            );
          }
          if (allPayments.length === 0) return null;

          const supplierPmts = allPayments.filter((p) => p.payeeType === "supplier");
          const employeePmts = allPayments.filter((p) => p.payeeType === "employee");
          const totalSupplierRemaining = supplierPmts.reduce((s, p) => s + p.remainingAmount, 0);
          const totalEmployeeRemaining = employeePmts.reduce((s, p) => s + p.remainingAmount, 0);
          const totalRemaining = totalSupplierRemaining + totalEmployeeRemaining;

          const SUPPLIER_GROUPS: { key: string; label: string; color: string; categories: string[] }[] = [
            { key: "food", label: "食材供应商", color: "#34C759", categories: ["food"] },
            { key: "spirits", label: "烈酒供应商", color: "#5856D6", categories: ["spirits", "beer", "ice"] },
            { key: "wine", label: "葡萄酒供应商", color: "#C2185B", categories: ["wine"] },
            { key: "other", label: "其他供应商", color: "#8E8E93", categories: ["equipment", "other"] },
          ];

          const renderPaymentCard = (payment: typeof allPayments[0], name: string, bankInfo: { bankName: string; cardNumber: string; accountName: string } | null) => {
            const advAmt = payment.advanceAmount ?? 0;
            const actualRemaining = Math.max(0, payment.totalAmount - advAmt - payment.paidAmount);
            const status = payment.status;
            const statusColor = status === "paid" ? colors.success : status === "partial" ? colors.warning : colors.error;
            return (
              <TouchableOpacity key={payment.id}
                onLongPress={() => {
                  if (!isReadOnly) {
                    Alert.alert("操作", name, [
                      { text: "删除此货款记录", style: "destructive", onPress: () => {
                        Alert.alert("确认删除", `确定删除「${name}」的货款记录？`, [
                          { text: "取消", style: "cancel" },
                          { text: "删除", style: "destructive", onPress: () => deletePayment(payment.id) },
                        ]);
                      }},
                      { text: "取消", style: "cancel" },
                    ]);
                  }
                }}
                style={[S.inlineCard, { borderLeftColor: statusColor, marginBottom: 6 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: colors.foreground }}>{name}</Text>
                  <View style={[S.statusTag, { backgroundColor: statusColor + "18" }]}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: statusColor }}>{status === "paid" ? "✓ 已付" : status === "partial" ? "部分" : "待付"}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 6 }}>
                  <View style={S.amtBlock}><Text style={S.amtLabel}>货款</Text><Text style={[S.amtValue, { color: colors.foreground }]}>¥{formatMoney(payment.totalAmount)}</Text></View>
                  {advAmt > 0 && <View style={S.amtBlock}><Text style={S.amtLabel}>预付</Text><Text style={[S.amtValue, { color: colors.warning }]}>-¥{formatMoney(advAmt)}</Text></View>}
                  {payment.paidAmount > 0 && <View style={S.amtBlock}><Text style={S.amtLabel}>已付</Text><Text style={[S.amtValue, { color: colors.success }]}>¥{formatMoney(payment.paidAmount)}</Text></View>}
                  <View style={S.amtBlock}><Text style={S.amtLabel}>待付</Text><Text style={[S.amtValue, { color: actualRemaining > 0 ? colors.error : colors.success, fontWeight: "800" }]}>¥{formatMoney(actualRemaining)}</Text></View>
                </View>
                {payment.notes ? <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>{payment.notes}</Text> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {bankInfo ? (
                    <Text style={{ flex: 1, fontSize: 11, color: colors.muted }}>{bankInfo.bankName} {maskCardNumber(bankInfo.cardNumber)}</Text>
                  ) : <View style={{ flex: 1 }} />}
                  {bankInfo && (
                    <TouchableOpacity onPress={() => handleCopy([
                      `收款人：${bankInfo.accountName}`,
                      `开户行：${bankInfo.bankName}`,
                      `卡号：${bankInfo.cardNumber}`,
                      `金额：¥${formatMoney((actualRemaining > 0 ? actualRemaining : payment.totalAmount))}`,
                      `备注：${name} ${selectedMonth} 货款`,
                    ].join("\n"))} style={[S.miniBtn, { backgroundColor: colors.primary }]}>
                      <IconSymbol name="doc.on.clipboard" size={10} color="#fff" />
                      <Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>复制</Text>
                    </TouchableOpacity>
                  )}
                  {status !== "paid" && !isReadOnly && (
                    <TouchableOpacity
                      onPress={() => handleOpenPaymentModal(payment.id, name, actualRemaining)}
                      style={[S.miniBtn, { backgroundColor: colors.success }]}>
                      <IconSymbol name="checkmark.circle.fill" size={10} color="#fff" />
                      <Text style={{ fontSize: 10, color: "#fff", fontWeight: "600" }}>录入付款</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          };

          return (
            <View style={[S.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[S.sectionHeader, { borderBottomColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: "#FF9500" }} />
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>货款汇总</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {totalRemaining > 0 && (
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.error }}>待付 ¥{formatMoney(totalRemaining)}</Text>
                  )}
                  {!isReadOnly && (
                    <TouchableOpacity onPress={() => { tap(); setShowAddPaymentModal(true); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.success + "15", borderWidth: 1, borderColor: colors.success + "44" }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", color: colors.success }}>+ 新增</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {SUPPLIER_GROUPS.map(({ key: gKey, label: gLabel, color: gColor, categories: gCats }) => {
                const groupPmts = supplierPmts.filter((p) => {
                  const sup = suppliers.find((s) => s.id === p.payeeId);
                  if (!sup) return gKey === "other" && p.payeeId.startsWith("manual_");
                  return gCats.includes(sup.category);
                });
                if (groupPmts.length === 0) return null;
                const groupRemaining = groupPmts.reduce((s, p) => s + p.remainingAmount, 0);
                return (
                  <View key={gKey} style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 6 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: gColor }} />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: gColor }}>{gLabel}</Text>
                      {groupRemaining > 0 && <Text style={{ fontSize: 10, color: colors.error, marginLeft: 4 }}>待付 ¥{formatMoney(groupRemaining)}</Text>}
                    </View>
                    {groupPmts.map((payment) => {
                      const sup = suppliers.find((s) => s.id === payment.payeeId);
                      const name = sup ? sup.name : (payment.notes || "手工录入");
                      const defaultBank = sup?.bankAccounts?.find((b: any) => b.isDefault) ?? sup?.bankAccounts?.[0];
                      return renderPaymentCard(payment, name, defaultBank ?? null);
                    })}
                  </View>
                );
              })}

              {employeePmts.length > 0 && (
                <View style={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#FF4D4F" }} />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: "#FF4D4F" }}>工资小计</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>应发 ¥{formatMoney(employeePmts.reduce((s, p) => s + p.totalAmount, 0))}</Text>
                      {totalEmployeeRemaining > 0 && <Text style={{ fontSize: 11, fontWeight: "700", color: colors.error }}>待发 ¥{formatMoney(totalEmployeeRemaining)}</Text>}
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => router.push("/labor" as any)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, backgroundColor: colors.primary + "10" }}>
                    <Text style={{ fontSize: 11, color: colors.primary, flex: 1 }}>工资明细在上方「工资」科目区查看</Text>
                    <IconSymbol name="chevron.right" size={10} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })()}

        {/* 供应商档案入口 */}
        <TouchableOpacity onPress={() => router.push("/suppliers" as any)}
          style={[S.linkBtn, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <IconSymbol name="building.2.fill" size={16} color={colors.muted} />
          <Text style={{ fontSize: 13, color: colors.muted, flex: 1 }}>管理供应商档案 & 銀行卡</Text>
          <IconSymbol name="chevron.right" size={14} color={colors.muted} />
        </TouchableOpacity>
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
          {/* 一键汇总按鈕（只读模式隐藏） */}
          {!isReadOnly && (
            <Pressable onPress={handleAutoAggregate}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <IconSymbol name="arrow.clockwise.circle.fill" size={22} color={colors.primary} />
            </Pressable>
          )}
          {/* 月报设置（只读模式隐藏） */}
          {!isReadOnly && (
            <Pressable onPress={() => setShowSettingsModal(true)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <IconSymbol name="gearshape.fill" size={20} color={colors.muted} />
            </Pressable>
          )}
          {/* 供应商档案入口 */}
          <Pressable onPress={() => router.push("/suppliers" as any)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <IconSymbol name="building.2.fill" size={20} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {renderReport()}

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
      <PaymentEntryModal
        visible={showPaymentModal}
        target={paymentTarget}
        colors={colors}
        onConfirm={(paymentId, amount, method, accountType, notes) => {
          const existing = payments.find((p) => p.id === paymentId);
          if (!existing) return;
          const now = new Date().toISOString();
          const newPaid = existing.paidAmount + amount;
          const advAmt = existing.advanceAmount ?? 0;
          const newRemaining = Math.max(0, existing.totalAmount - advAmt - newPaid);
          const newStatus: "unpaid" | "partial" | "paid" = newRemaining <= 0 ? "paid" : newPaid > 0 ? "partial" : "unpaid";
          upsertPayment({
            ...existing,
            paidAmount: newPaid,
            remainingAmount: newRemaining,
            status: newStatus,
            payments: [...existing.payments, {
              id: uuid(),
              date: now.slice(0, 10),
              amount,
              bankAccountId: "",
              paymentMethod: method,
              accountType: accountType as any,
              notes,
              paidAt: now,
            }],
            updatedAt: now,
          });
          tap();
        }}
        onClose={() => { setShowPaymentModal(false); setPaymentTarget(null); }}
      />
      {/* ── 手工新增货款 Modal ── */}
      <Modal visible={showAddPaymentModal} animationType="slide" presentationStyle="formSheet"
        onRequestClose={() => setShowAddPaymentModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={[MI.header, { borderBottomColor: colors.border }]}>
              <Pressable onPress={() => setShowAddPaymentModal(false)}><Text style={{ fontSize: 17, color: colors.error }}>取消</Text></Pressable>
              <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground }}>新增货款卡片</Text>
              <Pressable onPress={handleAddManualPayment}><Text style={{ fontSize: 17, fontWeight: "600", color: colors.primary }}>保存</Text></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View style={[MI.section, { borderColor: colors.border }]}>
                <Text style={[MI.sectionTitle, { color: colors.muted }]}>货款信息</Text>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>类型</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                  {(["supplier", "employee"] as const).map((t) => (
                    <TouchableOpacity key={t} onPress={() => setAddPaymentType(t)}
                      style={[MI.catChip, { backgroundColor: addPaymentType === t ? colors.primary : colors.surface, borderColor: addPaymentType === t ? colors.primary : colors.border }]}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: addPaymentType === t ? "#fff" : colors.foreground }}>{t === "supplier" ? "供应商货款" : "员工薪资"}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>名称 *</Text>
                <TextInput value={addPaymentName} onChangeText={setAddPaymentName}
                  placeholder={addPaymentType === "supplier" ? "供应商名称" : "员工姓名"}
                  placeholderTextColor={colors.muted}
                  style={[MI.input, { color: colors.foreground, borderColor: colors.border, marginBottom: 10 }]} />
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>金额 *</Text>
                <TextInput value={addPaymentAmount} onChangeText={setAddPaymentAmount}
                  placeholder="0.00" keyboardType="decimal-pad" placeholderTextColor={colors.muted}
                  style={[MI.input, { color: colors.foreground, borderColor: colors.border, marginBottom: 10 }]} />
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>备注</Text>
                <TextInput value={addPaymentNotes} onChangeText={setAddPaymentNotes}
                  placeholder="备注信息" placeholderTextColor={colors.muted}
                  style={[MI.input, { color: colors.foreground, borderColor: colors.border }]} />
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
  monthChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  profitCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  section: { borderRadius: 12, borderWidth: 1, marginBottom: 10, overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  addItemBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", padding: 14, marginBottom: 10 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  payrollCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  statusTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  inlineCard: { borderRadius: 10, borderWidth: 1, borderLeftWidth: 3, borderColor: "transparent", padding: 10, backgroundColor: "transparent" },
  miniBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7 },
  amtBlock: { alignItems: "center", minWidth: 48 },
  amtLabel: { fontSize: 10, color: "#8E8E93", marginBottom: 2 },
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
