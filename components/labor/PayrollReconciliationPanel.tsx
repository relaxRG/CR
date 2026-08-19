import React, { useMemo, useReducer } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useCan } from "@/hooks/use-can";
import type { CompOffBalanceEntry, Employee, PaySlip } from "@/lib/labor/types";
import { getLegacyCompOffCashOutDelta, settleCompOffCashOut } from "@/lib/labor/comp-off-cashout-settlement";
import { reducePayrollReconciliationState } from "@/lib/labor/payroll-reconciliation-state";
import { formatMoney } from "@/lib/utils";

type ReconciliationRow = Readonly<{
  employee: Employee;
  slip: PaySlip | null;
  settlement: ReturnType<typeof settleCompOffCashOut>;
  legacyDelta: number;
}>;

type Props = {
  visible: boolean;
  month: string;
  employees: readonly Employee[];
  paySlips: readonly PaySlip[];
  entries: readonly CompOffBalanceEntry[];
  monthStatus: "draft" | "adjusting" | "frozen";
  colors: any;
  onClose: () => void;
  onRebuildDraft: () => Promise<void>;
  onOpenAdjustment: () => Promise<boolean>;
};

function accessMessage(reason: string): string {
  if (reason === "offline") return "当前为离线缓存：可核对已缓存数据；网络恢复并完成会话核验后，修正操作会自动恢复可用。";
  if (reason === "policy_stale" || reason === "verifying") return "正在核验最新权限策略，核验完成后会自动恢复修正操作。";
  if (reason === "membership_revoked") return "当前设备成员资格已失效，不能修改薪资。";
  return "当前设备没有薪资修正权限。";
}

export function PayrollReconciliationPanel({ visible, month, employees, paySlips, entries, monthStatus, colors, onClose, onRebuildDraft, onOpenAdjustment }: Props) {
  const [state, dispatch] = useReducer(reducePayrollReconciliationState, { tag: "closed" });
  const payrollEditAccess = useCan("payroll.edit");
  const rows = useMemo<readonly ReconciliationRow[]>(() => employees.map((employee) => {
    const slip = paySlips.find((item) => item.employeeId === employee.id && item.month === month) ?? null;
    const settlement = settleCompOffCashOut(entries, employee.id, month);
    return { employee, slip, settlement, legacyDelta: slip ? getLegacyCompOffCashOutDelta(slip, settlement) : 0 };
  }), [employees, entries, month, paySlips]);
  const issueCount = rows.filter((row) => Math.abs(row.legacyDelta) >= 0.01).length;
  const busy = state.tag === "rebuilding_draft" || state.tag === "opening_adjustment";
  const actionable = payrollEditAccess.allowed && !busy;

  const close = () => { dispatch({ type: "CLOSE" }); onClose(); };
  const rebuild = async () => {
    if (!payrollEditAccess.allowed) return;
    dispatch({ type: "REBUILD_DRAFT" });
    try { await onRebuildDraft(); dispatch({ type: "SUCCESS", message: "已打开安全重建确认；确认后草稿会按兑现流水重新汇总。" }); }
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

  const renderRow = ({ item }: { item: ReconciliationRow }) => {
    const { employee, slip, settlement, legacyDelta } = item;
    return <View style={[S.row, { borderBottomColor: colors.border }]}>
      <View style={S.rowHeader}><Text style={[S.name, { color: colors.foreground }]}>{employee.code} {employee.realName}</Text><Text style={[S.sub, { color: colors.muted }]}>{settlement.lines.length} 笔兑现流水</Text></View>
      <View style={S.amountLine}><Text style={[S.sub, { color: colors.muted }]}>流水兑现</Text><Text style={[S.amount, { color: colors.foreground }]}>+¥{formatMoney(settlement.amount)}</Text></View>
      <View style={S.amountLine}><Text style={[S.sub, { color: colors.muted }]}>薪资单兑现</Text><Text style={[S.amount, { color: colors.foreground }]}>+¥{formatMoney(slip?.compOffCashOut ?? 0)}</Text></View>
      {Math.abs(legacyDelta) >= 0.01 && <View style={S.warning}><IconSymbol name="exclamationmark.triangle.fill" size={13} color="#B45309" /><Text style={S.warningText}>未关联历史金额 {legacyDelta >= 0 ? "+" : ""}¥{formatMoney(legacyDelta)}，重建后将以兑现流水为准。</Text></View>}
      {settlement.lines.map((line) => <Text key={line.entryId} style={[S.source, { color: colors.muted }]}>来源：{line.earnedMonth} {line.source === "overtime" ? "加班" : "节假日"}余额 {line.days}天 × ¥{formatMoney(line.unitRate)}</Text>)}
    </View>;
  };

  return <Modal visible={visible} transparent animationType="slide" onShow={() => dispatch({ type: "OPEN" })} onRequestClose={close}>
    <View style={S.overlay}>
      <View style={[S.sheet, { backgroundColor: colors.surface }]}>
        <View style={[S.header, { borderBottomColor: colors.border }]}>
          <View><Text style={[S.title, { color: colors.foreground }]}>薪资核对与修正</Text><Text style={[S.sub, { color: colors.muted }]}>{month} · 兑现流水、薪资单与月结状态</Text></View>
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
          ListHeaderComponent={<View style={[S.summary, { borderColor: issueCount ? "#D14343" : colors.border }]}>
            <Text style={[S.summaryValue, { color: colors.foreground }]}>{issueCount}</Text>
            <Text style={[S.sub, { color: colors.muted }]}>{issueCount ? "笔历史调休兑现需要核对" : "没有发现未关联的调休兑现"}</Text>
            <Text style={[S.sub, { color: colors.muted }]}>草稿月可重建；已确认月将创建差额更正会话，不会改写已发历史。</Text>
            {!payrollEditAccess.allowed && <Text accessibilityLiveRegion="polite" style={S.accessNote}>{accessMessage(payrollEditAccess.reason)}</Text>}
          </View>}
          ListFooterComponent={state.tag === "completed" || state.tag === "failed" ? <Text accessibilityLiveRegion="polite" style={[S.feedback, { color: state.tag === "failed" ? "#B91C1C" : colors.muted }]}>{state.message}</Text> : <View style={{ height: 8 }} />}
        />
        <View style={[S.actions, { borderTopColor: colors.border }]}>
          {monthStatus === "draft" ? <Pressable accessibilityRole="button" accessibilityLabel="从兑现流水重建草稿" disabled={!actionable} onPress={() => void rebuild()} style={[S.primary, { backgroundColor: colors.foreground, opacity: actionable ? 1 : 0.42 }]}><Text style={S.primaryText}>{busy ? "正在重建…" : "从兑现流水重建草稿"}</Text></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="创建薪资更正会话" disabled={!actionable} onPress={() => void adjust()} style={[S.primary, { backgroundColor: colors.foreground, opacity: actionable ? 1 : 0.42 }]}><Text style={S.primaryText}>{busy ? "正在创建…" : "创建薪资更正会话"}</Text></Pressable>}
        </View>
      </View>
    </View>
  </Modal>;
}

const S = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "86%", minHeight: 360, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: { padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "800" }, sub: { fontSize: 11, lineHeight: 17 }, content: { padding: 16, gap: 10 },
  summary: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 3, marginBottom: 2 }, summaryValue: { fontSize: 22, fontWeight: "900" },
  row: { paddingVertical: 10, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth }, rowHeader: { flexDirection: "row", justifyContent: "space-between" }, name: { fontSize: 14, fontWeight: "700" },
  amountLine: { flexDirection: "row", justifyContent: "space-between" }, amount: { fontSize: 12, fontWeight: "700" }, source: { fontSize: 10 },
  warning: { flexDirection: "row", gap: 5, alignItems: "center", paddingTop: 3 }, warningText: { color: "#92400E", fontSize: 11, flex: 1 }, accessNote: { color: "#92400E", fontSize: 11, lineHeight: 16, paddingTop: 4 }, feedback: { fontSize: 12, fontWeight: "600", textAlign: "center", paddingVertical: 8 },
  actions: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth }, primary: { alignItems: "center", paddingVertical: 12, borderRadius: 10 }, primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
