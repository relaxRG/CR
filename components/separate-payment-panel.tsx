/**
 * 单独补发单 UI 面板
 * 展示待付款/已付款的补发单列表，支持标记付款和对账
 */
import React, { useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSeparatePaymentStore } from "@/lib/labor/separate-payment-store";
import type { SeparatePaymentSlip } from "@/lib/labor/adjustment-settlement";

interface Props {
  colors: any;
  /** 筛选月份（可选） */
  filterMonth?: string;
  /** 筛选员工（可选） */
  filterEmployeeId?: string;
}

export function SeparatePaymentPanel({ colors, filterMonth, filterEmployeeId }: Props) {
  const { payments, markPaid, deletePayment, getSummary } = useSeparatePaymentStore();
  const [tab, setTab] = useState<"pending" | "paid" | "all">("pending");

  // 筛选
  const filtered = useMemo(() => {
    let list = payments;
    if (filterMonth) list = list.filter((p) => p.sourceMonth === filterMonth);
    if (filterEmployeeId) list = list.filter((p) => p.employeeId === filterEmployeeId);
    if (tab === "pending") list = list.filter((p) => p.paymentStatus === "pending");
    if (tab === "paid") list = list.filter((p) => p.paymentStatus === "paid");
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [payments, filterMonth, filterEmployeeId, tab]);

  const summary = getSummary();

  // 标记付款
  const handleMarkPaid = (slip: SeparatePaymentSlip) => {
    Alert.alert(
      "确认付款",
      `确认已向 ${slip.employeeName} ${slip.amount > 0 ? "补发" : "扣回"} ¥${Math.abs(slip.amount)}？`,
      [
        { text: "取消", style: "cancel" },
        { text: "确认已付", style: "default", onPress: () => markPaid(slip.id) },
      ]
    );
  };

  // 删除
  const handleDelete = (slip: SeparatePaymentSlip) => {
    Alert.alert(
      "删除补发单",
      `确认删除 ${slip.employeeName} 的 ¥${Math.abs(slip.amount)} 补发记录？`,
      [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => deletePayment(slip.id) },
      ]
    );
  };

  // 渲染单条补发单
  const renderItem = ({ item }: { item: SeparatePaymentSlip }) => {
    const isPaid = item.paymentStatus === "paid";
    const isPositive = item.amount > 0;
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border + "33" }]}>
        {/* 头部：员工名 + 金额 */}
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.empName, { color: colors.foreground }]}>{item.employeeName}</Text>
            <Text style={[styles.sourceMonth, { color: colors.muted }]}>
              来源：{item.sourceMonth} · {new Date(item.createdAt).toLocaleDateString("zh-CN")}
            </Text>
          </View>
          <Text style={[styles.amount, { color: isPositive ? colors.success : colors.danger }]}>
            {isPositive ? "+" : ""}¥{Math.abs(item.amount).toFixed(2)}
          </Text>
        </View>

        {/* 明细 */}
        {item.details ? (
          <Text style={[styles.details, { color: colors.muted }]} numberOfLines={2}>
            {item.details}
          </Text>
        ) : null}

        {/* 底部：状态 + 操作 */}
        <View style={styles.cardFooter}>
          <View style={[styles.statusBadge, { backgroundColor: isPaid ? colors.success + "15" : colors.warning + "15" }]}>
            <IconSymbol name={isPaid ? "checkmark.circle.fill" : "clock"} size={10} color={isPaid ? colors.success : colors.warning} />
            <Text style={{ fontSize: 10, color: isPaid ? colors.success : colors.warning, marginLeft: 3 }}>
              {isPaid ? `已付 ${item.paidAt ? new Date(item.paidAt).toLocaleDateString("zh-CN") : ""}` : "待付款"}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          {!isPaid && (
            <TouchableOpacity onPress={() => handleMarkPaid(item)} style={[styles.actionBtn, { backgroundColor: colors.success + "15", borderColor: colors.success + "44" }]}>
              <Text style={{ fontSize: 10, color: colors.success, fontWeight: "600" }}>标记已付</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => handleDelete(item)} style={[styles.actionBtn, { backgroundColor: colors.danger + "10", borderColor: colors.danger + "33", marginLeft: 6 }]}>
            <Text style={{ fontSize: 10, color: colors.danger }}>删除</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* 汇总栏 */}
      <View style={[styles.summaryBar, { backgroundColor: colors.surface, borderColor: colors.border + "22" }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>{summary.total}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>总计</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.warning }]}>{summary.pending}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>待付</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.success }]}>{summary.paid}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>已付</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.primary }]}>¥{summary.pendingAmount.toFixed(0)}</Text>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>待付金额</Text>
        </View>
      </View>

      {/* Tab 切换 */}
      <View style={[styles.tabBar, { borderColor: colors.border + "22" }]}>
        {(["pending", "paid", "all"] as const).map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)}
            style={[styles.tab, tab === t && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}>
            <Text style={{ fontSize: 12, color: tab === t ? colors.primary : colors.muted, fontWeight: tab === t ? "600" : "400" }}>
              {t === "pending" ? "待付款" : t === "paid" ? "已付款" : "全部"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 列表 */}
      <FlatList
        data={filtered}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <Text style={{ color: colors.muted, fontSize: 13 }}>暂无补发记录</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  summaryBar: { flexDirection: "row", paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, gap: 4 },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryValue: { fontSize: 16, fontWeight: "700" },
  summaryLabel: { fontSize: 9, marginTop: 2 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1, paddingHorizontal: 16 },
  tab: { paddingVertical: 10, paddingHorizontal: 16 },
  card: { borderRadius: 12, padding: 12, borderWidth: 1 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start" },
  empName: { fontSize: 14, fontWeight: "700" },
  sourceMonth: { fontSize: 10, marginTop: 2 },
  amount: { fontSize: 18, fontWeight: "700" },
  details: { fontSize: 11, marginTop: 6, lineHeight: 16 },
  cardFooter: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  statusBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1 },
});
