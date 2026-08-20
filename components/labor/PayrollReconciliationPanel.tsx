import React, { useMemo, useReducer } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useCan } from "@/hooks/use-can";
import type { CompOffBalanceEntry, Employee, PaySlip } from "@/lib/labor/types";
import {
  auditCompOffCashOutIntegrity,
  getCompOffCashOutSettlementAmount,
  getCompOffCashOutSnapshotIssue,
  settleCompOffCashOut,
} from "@/lib/labor/comp-off-cashout-settlement";
import { reducePayrollReconciliationState } from "@/lib/labor/payroll-reconciliation-state";
import { formatMoney } from "@/lib/utils";
import { checkPettyLaborIntegrity } from "@/lib/labor/data-integrity-check";

type ReconciliationRow = Readonly<{
  employee: Employee;
  slip: PaySlip | null;
  settlement: ReturnType<typeof settleCompOffCashOut>;
  snapshotIssue: ReturnType<typeof getCompOffCashOutSnapshotIssue>;
}>;

type Props = {
  visible: boolean;
  month: string;
  employees: readonly Employee[];
  paySlips: readonly PaySlip[];
  entries: readonly CompOffBalanceEntry[];
  pettyLaborLinks?: readonly { id: string; amount: number; employeeId: string; month: string }[];
  monthStatus: "draft" | "adjusting" | "frozen";
  colors: any;
  onClose: () => void;
  onRebuildDraft: () => Promise<void>;
  onOpenAdjustment: () => Promise<boolean>;
  onVoidDraftSettlement?: (entryId: string, reason: string) => Promise<boolean>;
};

function accessMessage(reason: string): string {
  if (reason === "offline") return "当前为离线缓存：可核对已缓存数据；网络恢复并完成会话核验后，修正操作会自动恢复可用。";
  if (reason === "policy_stale" || reason === "verifying") return "正在核验最新权限策略，核验完成后会自动恢复修正操作。";
  if (reason === "membership_revoked") return "当前设备成员资格已失效，不能修改薪资。";
  return "当前设备没有薪资修正权限。";
}

function issueLabel(code: string): string {
  if (code === "ZERO_RATE_NON_ZERO_AMOUNT") return "零费率却有金额";
  if (code === "AMOUNT_RATE_MISMATCH") return "费率与金额不匹配";
  if (code === "ORPHAN_PAYSLIP_CASHOUT") return "旧薪资直接金额";
  if (code === "SETTLEMENT_SNAPSHOT_MISMATCH") return "薪资快照不一致";
  if (code === "DUPLICATE_EVENT_ID") return "兑现事件重复";
  if (code.startsWith("EVENT_")) return "事件与余额不一致";
  if (code === "INVALID_SETTLEMENT_HISTORY") return "作废审计记录异常";
  return "兑现来源缺失";
}

export function PayrollReconciliationPanel({ visible, month, employees, paySlips, entries, pettyLaborLinks = [], monthStatus, colors, onClose, onRebuildDraft, onOpenAdjustment, onVoidDraftSettlement }: Props) {
  const [state, dispatch] = useReducer(reducePayrollReconciliationState, { tag: "closed" });
  const payrollEditAccess = useCan("payroll.edit");
  const rows = useMemo<readonly ReconciliationRow[]>(() => employees.map((employee) => {
    const slip = paySlips.find((item) => item.employeeId === employee.id && item.month === month) ?? null;
    const settlement = settleCompOffCashOut(entries, employee.id, month);
    return { employee, slip, settlement, snapshotIssue: slip ? getCompOffCashOutSnapshotIssue(slip, settlement) : null };
  }), [employees, entries, month, paySlips]);
  const integrity = useMemo(() => auditCompOffCashOutIntegrity(entries, paySlips), [entries, paySlips]);
  const pettyIntegrity = useMemo(() => checkPettyLaborIntegrity([...paySlips], [...pettyLaborLinks]), [paySlips, pettyLaborLinks]);
  const monthCashOutIssues = integrity.issues.filter((issue) => issue.month === month);
  const monthPettyIssues = pettyIntegrity.issues.filter((issue) => issue.month === month);
  const monthIssueCount = monthCashOutIssues.length + monthPettyIssues.length;
  const busy = state.tag === "rebuilding_draft" || state.tag === "opening_adjustment";
  const actionable = payrollEditAccess.allowed && !busy;

  const close = () => { dispatch({ type: "CLOSE" }); onClose(); };
  const rebuild = async () => {
    if (!payrollEditAccess.allowed) return;
    dispatch({ type: "REBUILD_DRAFT" });
    try { await onRebuildDraft(); dispatch({ type: "SUCCESS", message: "已打开安全重建确认；确认后草稿会按有效兑现事件重新汇总。" }); }
    catch { dispatch({ type: "FAIL", message: "重建失败，未写入新的薪资数据；网络恢复后可再次尝试。" }); }
  };
  const adjust = async () => {
    if (!payrollEditAccess.allowed) return;
    dispatch({ type: "OPEN_ADJUSTMENT" });
    try {
      const opened = await onOpenAdjustment();
      if (!opened) throw new Error("OPEN_ADJUSTMENT_FAILED");
      dispatch({ type: "SUCCESS", message: "已创建已结算月份的薪资更正会话。" });
    } catch { dispatch({ type: "FAIL", message: "无法创建更正会话；网络恢复后或关闭现有调整后可再次尝试。" }); }
  };
  const voidIssue = async (entryId: string) => {
    if (!onVoidDraftSettlement || monthStatus !== "draft" || !payrollEditAccess.allowed) return;
    dispatch({ type: "REBUILD_DRAFT" });
    try {
      if (!await onVoidDraftSettlement(entryId, "核对面板作废：费率、金额或事件载荷不一致")) throw new Error("VOID_FAILED");
      dispatch({ type: "SUCCESS", message: "错误兑现事件已作废，余额已恢复为可用；请重建本月草稿。" });
    } catch { dispatch({ type: "FAIL", message: "未能作废该错误事件，原始数据未被修改。" }); }
  };

  const renderRow = ({ item }: { item: ReconciliationRow }) => {
    const { employee, slip, settlement, snapshotIssue } = item;
    const snapshotAmount = slip ? getCompOffCashOutSettlementAmount(slip) : 0;
    const quarantine = slip?.payrollDataQuarantine ?? [];
    const pettyIssues = monthPettyIssues.filter((issue) => issue.employeeId === employee.id);
    return <View style={[S.row, { borderBottomColor: colors.border }]}>
      <View style={S.rowHeader}><Text style={[S.name, { color: colors.foreground }]}>{employee.code} {employee.realName}</Text><Text style={[S.sub, { color: colors.muted }]}>{settlement.lines.length} 笔有效流水</Text></View>
      <View style={S.amountLine}><Text style={[S.sub, { color: colors.muted }]}>有效流水兑现</Text><Text style={[S.amount, { color: colors.foreground }]}>+¥{formatMoney(settlement.amount)}</Text></View>
      <View style={S.amountLine}><Text style={[S.sub, { color: colors.muted }]}>薪资账本快照</Text><Text style={[S.amount, { color: colors.foreground }]}>+¥{formatMoney(snapshotAmount)}</Text></View>
      {quarantine.map((record) => <View key={record.id} style={S.issue}><View style={{ flex: 1, gap: 2 }}><Text style={S.issueTitle}>已隔离历史数据 · {issueLabel(record.code)}</Text><Text style={S.warningText}>{record.description}</Text></View></View>)}
      {snapshotIssue && <View style={S.issue}><View style={{ flex: 1, gap: 2 }}><Text style={S.issueTitle}>数据异常 · {issueLabel(snapshotIssue.code)}</Text><Text style={S.warningText}>{snapshotIssue.description}</Text></View></View>}
      {pettyIssues.map((issue) => <View key={`${issue.slipId}-${issue.type}`} style={S.issue}><View style={{ flex: 1, gap: 2 }}><Text style={S.issueTitle}>数据异常 · 备用金人工已付关联不完整</Text><Text style={S.warningText}>{issue.description}（记录 ¥{formatMoney(issue.currentValue)}，可验证关联 ¥{formatMoney(issue.expectedValue)}）。请在预支页核对关联记录；草稿月重建前不得把该差额当作正常已付。</Text></View></View>)}
      {settlement.lines.map((line) => <Text key={line.eventId} style={[S.source, { color: colors.muted }]}>事件 {line.eventId.slice(-8)} · 来源：{line.earnedMonth} {line.source === "overtime" ? "加班" : "节假日"}余额 {line.days}天 × ¥{formatMoney(line.unitRate)} · ¥{formatMoney(line.amount)}</Text>)}
      {settlement.issues.map((issue) => <View key={`${issue.entryId ?? "slip"}-${issue.code}`} style={S.issue}><View style={{ flex: 1, gap: 2 }}><Text style={S.issueTitle}>数据异常 · {issueLabel(issue.code)}</Text><Text style={S.warningText}>{issue.description} {issue.entryId ? `事件 ${issue.entryId.slice(-8)} · ¥${formatMoney(issue.amount)}` : ""}</Text></View>{monthStatus === "draft" && issue.entryId && onVoidDraftSettlement && <Pressable accessibilityRole="button" accessibilityLabel={`作废错误兑现事件 ${issue.entryId}`} disabled={!actionable} onPress={() => void voidIssue(issue.entryId!)} style={[S.voidButton, { opacity: actionable ? 1 : 0.42 }]}><Text style={S.voidText}>作废</Text></Pressable>}</View>)}
    </View>;
  };

  return <Modal visible={visible} transparent animationType="slide" onShow={() => dispatch({ type: "OPEN" })} onRequestClose={close}>
    <View style={S.overlay}>
      <View style={[S.sheet, { backgroundColor: colors.surface }]}>
        <View style={[S.header, { borderBottomColor: colors.border }]}>
          <View><Text style={[S.title, { color: colors.foreground }]}>薪资核对与修正</Text><Text style={[S.sub, { color: colors.muted }]}>{month} · 有效流水、账本快照与隔离区</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭薪资核对" onPress={close} disabled={busy}><IconSymbol name="xmark.circle.fill" size={22} color={colors.muted} /></Pressable>
        </View>
        <FlatList
          testID="payroll-reconciliation-list"
          data={rows}
          keyExtractor={(item) => item.employee.id}
          renderItem={renderRow}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews
          contentContainerStyle={S.content}
          ListHeaderComponent={<View style={[S.summary, { borderColor: monthIssueCount ? "#D14343" : colors.border }]}>
            <Text style={[S.summaryValue, { color: colors.foreground }]}>{monthIssueCount}</Text>
            <Text style={[S.sub, { color: colors.muted }]}>{monthIssueCount ? "笔调休兑现需要核对" : "没有发现未关联或不完整的调休兑现"}</Text>
            <Text style={[S.sub, { color: colors.muted }]}>已审计：{integrity.entriesChecked} 条调休余额、{integrity.activeEvents} 笔有效事件、{integrity.quarantinedEvents} 笔隔离事件、{integrity.voidedEvents} 笔作废事件；备用金人工已付检查 {pettyIntegrity.totalSlipsChecked} 张薪资单。</Text>
            <Text style={[S.sub, { color: colors.muted }]}>草稿月可重建；已确认月将创建差额更正会话，不会改写已发历史。</Text>
            {!payrollEditAccess.allowed && <Text accessibilityLiveRegion="polite" style={S.accessNote}>{accessMessage(payrollEditAccess.reason)}</Text>}
          </View>}
          ListFooterComponent={state.tag === "completed" || state.tag === "failed" ? <Text accessibilityLiveRegion="polite" style={[S.feedback, { color: state.tag === "failed" ? "#B91C1C" : colors.muted }]}>{state.message}</Text> : <View style={{ height: 8 }} />}
        />
        <View style={[S.actions, { borderTopColor: colors.border }]}>
          {monthStatus === "draft" ? <Pressable accessibilityRole="button" accessibilityLabel="从兑现流水重建草稿" disabled={!actionable} onPress={() => void rebuild()} style={[S.primary, { backgroundColor: colors.foreground, opacity: actionable ? 1 : 0.42 }]}><Text style={S.primaryText}>{busy ? "正在重建…" : "从有效流水重建草稿"}</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="创建薪资更正会话" disabled={!actionable} onPress={() => void adjust()} style={[S.primary, { backgroundColor: colors.foreground, opacity: actionable ? 1 : 0.42 }]}><Text style={S.primaryText}>{busy ? "正在创建…" : "创建薪资更正会话"}</Text></Pressable>}
        </View>
      </View>
    </View>
  </Modal>;
}

const S = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "86%", minHeight: 360, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: { padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "600" }, sub: { fontSize: 11, lineHeight: 17 }, content: { padding: 16, gap: 10 },
  summary: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 3, marginBottom: 2 }, summaryValue: { fontSize: 22, fontWeight: "600" },
  row: { paddingVertical: 10, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth }, rowHeader: { flexDirection: "row", justifyContent: "space-between" }, name: { fontSize: 14, fontWeight: "600" },
  amountLine: { flexDirection: "row", justifyContent: "space-between" }, amount: { fontSize: 12, fontWeight: "600" }, source: { fontSize: 10 },
  issue: { flexDirection: "row", gap: 8, borderRadius: 8, padding: 8, backgroundColor: "#FEF3C7", marginTop: 4 }, warningText: { color: "#92400E", fontSize: 11, flex: 1 }, issueTitle: { color: "#92400E", fontSize: 11, fontWeight: "600" }, voidButton: { alignSelf: "center", borderWidth: 1, borderColor: "#B45309", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 }, voidText: { color: "#92400E", fontSize: 11, fontWeight: "600" }, accessNote: { color: "#92400E", fontSize: 11, lineHeight: 16, paddingTop: 4 }, feedback: { fontSize: 12, fontWeight: "600", textAlign: "center", paddingVertical: 8 },
  actions: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth }, primary: { alignItems: "center", paddingVertical: 12, borderRadius: 10 }, primaryText: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
});
