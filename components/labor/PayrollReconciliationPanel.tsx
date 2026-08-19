import React, { useMemo, useReducer } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import type { CompOffBalanceEntry, Employee, PaySlip } from "@/lib/labor/types";
import { getLegacyCompOffCashOutDelta, settleCompOffCashOut } from "@/lib/labor/comp-off-cashout-settlement";
import { reducePayrollReconciliationState } from "@/lib/labor/payroll-reconciliation-state";
import { formatMoney } from "@/lib/utils";

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

export function PayrollReconciliationPanel({ visible, month, employees, paySlips, entries, monthStatus, colors, onClose, onRebuildDraft, onOpenAdjustment }: Props) {
  const [state, dispatch] = useReducer(reducePayrollReconciliationState, { tag: "closed" });
  const rows = useMemo(() => employees.map((employee) => {
    const slip = paySlips.find((item) => item.employeeId === employee.id && item.month === month) ?? null;
    const settlement = settleCompOffCashOut(entries, employee.id, month);
    return { employee, slip, settlement, legacyDelta: slip ? getLegacyCompOffCashOutDelta(slip, settlement) : 0 };
  }), [employees, entries, month, paySlips]);
  const issueCount = rows.filter((row) => Math.abs(row.legacyDelta) >= 0.01).length;
  const busy = state.tag === "rebuilding_draft" || state.tag === "opening_adjustment";

  const close = () => { dispatch({ type: "CLOSE" }); onClose(); };
  const rebuild = async () => {
    dispatch({ type: "REBUILD_DRAFT" });
    try { await onRebuildDraft(); dispatch({ type: "SUCCESS", message: "草稿已从调休兑现流水重新汇总。" }); }
    catch { dispatch({ type: "FAIL", message: "重建失败，未写入新的薪资数据。" }); }
  };
  const adjust = async () => {
    dispatch({ type: "OPEN_ADJUSTMENT" });
    try {
      const opened = await onOpenAdjustment();
      if (!opened) throw new Error("OPEN_ADJUSTMENT_FAILED");
      dispatch({ type: "SUCCESS", message: "已创建已结算月份的薪资更正会话。" });
    } catch { dispatch({ type: "FAIL", message: "无法创建更正会话，请确认本月存在归档且尚未开启其他调整。" }); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onShow={() => dispatch({ type: "OPEN" })} onRequestClose={close}>
      <View style={S.overlay}>
        <View style={[S.sheet, { backgroundColor: colors.surface }]}> 
          <View style={[S.header, { borderBottomColor: colors.border }]}>
            <View><Text style={[S.title, { color: colors.foreground }]}>薪资核对与修正</Text><Text style={[S.sub, { color: colors.muted }]}>{month} · 兑现流水、薪资单与月结状态</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭薪资核对" onPress={close} disabled={busy}><IconSymbol name="xmark.circle.fill" size={22} color={colors.muted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={S.content}>
            <View style={[S.summary, { borderColor: issueCount ? "#D14343" : colors.border }]}> 
              <Text style={[S.summaryValue, { color: colors.foreground }]}>{issueCount}</Text>
              <Text style={[S.sub, { color: colors.muted }]}>{issueCount ? "笔历史调休兑现需要核对" : "没有发现未关联的调休兑现"}</Text>
              <Text style={[S.sub, { color: colors.muted }]}>草稿月可重建；已确认月将创建差额更正会话，不会改写已发历史。</Text>
            </View>
            {rows.map(({ employee, slip, settlement, legacyDelta }) => (
              <View key={employee.id} style={[S.row, { borderBottomColor: colors.border }]}> 
                <View style={S.rowHeader}><Text style={[S.name, { color: colors.foreground }]}>{employee.code} {employee.realName}</Text><Text style={[S.sub, { color: colors.muted }]}>{settlement.lines.length} 笔兑现流水</Text></View>
                <View style={S.amountLine}><Text style={[S.sub, { color: colors.muted }]}>流水兑现</Text><Text style={[S.amount, { color: colors.foreground }]}>+¥{formatMoney(settlement.amount)}</Text></View>
                <View style={S.amountLine}><Text style={[S.sub, { color: colors.muted }]}>薪资单兑现</Text><Text style={[S.amount, { color: colors.foreground }]}>+¥{formatMoney(slip?.compOffCashOut ?? 0)}</Text></View>
                {Math.abs(legacyDelta) >= 0.01 && <View style={S.warning}><IconSymbol name="exclamationmark.triangle.fill" size={13} color="#B45309" /><Text style={S.warningText}>未关联历史金额 {legacyDelta >= 0 ? "+" : ""}¥{formatMoney(legacyDelta)}，重建后将以兑现流水为准。</Text></View>}
                {settlement.lines.map((line) => <Text key={line.entryId} style={[S.source, { color: colors.muted }]}>来源：{line.earnedMonth} {line.source === "overtime" ? "加班" : "节假日"}余额 {line.days}天 × ¥{formatMoney(line.unitRate)}</Text>)}
              </View>
            ))}
            {state.tag === "completed" || state.tag === "failed" ? <Text style={[S.feedback, { color: state.tag === "failed" ? "#B91C1C" : colors.muted }]}>{state.message}</Text> : null}
          </ScrollView>
          <View style={[S.actions, { borderTopColor: colors.border }]}>
            {monthStatus === "draft" ? <Pressable disabled={busy} onPress={() => void rebuild()} style={[S.primary, { backgroundColor: colors.foreground, opacity: busy ? 0.5 : 1 }]}><Text style={S.primaryText}>{busy ? "正在重建…" : "从兑现流水重建草稿"}</Text></Pressable> : <Pressable disabled={busy} onPress={() => void adjust()} style={[S.primary, { backgroundColor: colors.foreground, opacity: busy ? 0.5 : 1 }]}><Text style={S.primaryText}>{busy ? "正在创建…" : "创建薪资更正会话"}</Text></Pressable>}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "86%", borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  header: { padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 17, fontWeight: "800" }, sub: { fontSize: 11, lineHeight: 17 }, content: { padding: 16, gap: 10 },
  summary: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 3 }, summaryValue: { fontSize: 22, fontWeight: "900" },
  row: { paddingVertical: 10, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth }, rowHeader: { flexDirection: "row", justifyContent: "space-between" }, name: { fontSize: 14, fontWeight: "700" },
  amountLine: { flexDirection: "row", justifyContent: "space-between" }, amount: { fontSize: 12, fontWeight: "700" }, source: { fontSize: 10 },
  warning: { flexDirection: "row", gap: 5, alignItems: "center", paddingTop: 3 }, warningText: { color: "#92400E", fontSize: 11, flex: 1 }, feedback: { fontSize: 12, fontWeight: "600", textAlign: "center", paddingVertical: 6 },
  actions: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth }, primary: { alignItems: "center", paddingVertical: 12, borderRadius: 10 }, primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
