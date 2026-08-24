/**
 * 账户余额组件（当月月报 → 账户 Tab）
 * 显示公司账户/私人账户/备用金账户/开店宝后台的期初/期末余额及差异分析
 */
import React, { useRef, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View , Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { StoreMetric, StoreSectionHeader, StoreToolbarAction } from "@/components/store/store-visual-primitives";
import { STORE_TEXT } from "@/lib/theme/store-visual-system";
import { BoundedBusinessMonthNavigator } from "@/components/months/BoundedBusinessMonthNavigator";
import { useReportMonthNavigation } from "@/hooks/use-report-month-navigation";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { AccountBalance, AccountType, ACCOUNT_TYPE_COLORS, ACCOUNT_TYPE_LABELS } from "@/lib/store/monthly-summary/types";
import BalanceModal from "@/components/store/balance-modal";
import { useModuleMonthCloseStore } from "@/lib/month-close/module-month-close-store";

export default function StoreAccountsScreen({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { reports, getBalancesForMonth, upsertBalance } = useMonthlySummaryStore();

  const { month: selectedMonth, bounds: reportMonthBounds, selectMonth: setSelectedMonth } = useReportMonthNavigation();

  const moduleClose = useModuleMonthCloseStore();
  const accountCloseStatus = moduleClose.getStatus("accounts", selectedMonth);
  const assertAccountsWritable = () => {
    if (moduleClose.isWritable("accounts", selectedMonth)) return true;
    Alert.alert("账户月份已归档", `${selectedMonth} 账户已归档。请先在账户模块开启调整，不能直接修改历史余额。`);
    return false;
  };
  const balances = getBalancesForMonth(selectedMonth);
  const report = reports?.find((r) => r.month === selectedMonth);
  const allItems = [...(report?.lineItems ?? []), ...(report?.manualItems ?? [])];
  const netProfit = allItems.filter((i) => !i.isDuplicate).reduce((s, i) => s + i.amount, 0);
  const latestArchiveSnapshot = useRef({ month: selectedMonth, balances, netProfit });
  latestArchiveSnapshot.current = { month: selectedMonth, balances, netProfit };

  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceAccountType, setBalanceAccountType] = useState<AccountType>("company");
  const [editingBalance, setEditingBalance] = useState<AccountBalance | null>(null);

  const accountTypes: AccountType[] = ["company", "personal", "petty", "pos"];

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        {!embedded && <BoundedBusinessMonthNavigator
          testID="accounts-month-navigator"
          subject="账户"
          month={selectedMonth}
          bounds={reportMonthBounds}
          onChange={setSelectedMonth}
        />}

        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 10 }}>
          <StoreToolbarAction label={accountCloseStatus === "draft" ? "归档本月账户" : "账户已归档"} icon="checkmark.circle" tone={accountCloseStatus === "draft" ? "primary" : "settled"} emphasis={accountCloseStatus === "draft"} colors={colors} onPress={() => {
            if (!assertAccountsWritable()) return;
            Alert.alert("账户月度归档", `确认归档 ${selectedMonth} 账户余额？归档后需先开启调整才能修改。`, [
              { text: "取消", style: "cancel" },
              { text: "确认归档", onPress: () => {
                const snapshot = latestArchiveSnapshot.current;
                moduleClose.finalize({ module: "accounts", month: snapshot.month, snapshot, paymentSummary: { payable: 0, paid: 0, remaining: 0 } });
                Alert.alert("归档完成", `${snapshot.month} 账户已独立归档。`);
              } },
            ]);
          }} />
        </View>

        <View style={{ borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 12, backgroundColor: colors.surface, borderColor: colors.border }}>
          <StoreMetric label="本月经营净利润（参考）" value={`${netProfit >= 0 ? "+" : ""}¥${netProfit.toFixed(2)}`} tone={netProfit >= 0 ? "settled" : "danger"} icon="chart.line.uptrend.xyaxis" colors={colors} primary />
          <Text style={{ ...STORE_TEXT.supporting, color: colors.muted, marginTop: 6 }}>账户余额差异 = 手动录入期末余额 - 系统计算期末余额</Text>
        </View>

        {/* 四账户卡片 */}
        {accountTypes.map((at) => {
          const bal = balances.find((b) => b.accountType === at);
          const color = ACCOUNT_TYPE_COLORS[at];
          const variance = bal ? bal.closingBalance - bal.computedClosingBalance : null;
          const hasVariance = variance !== null && Math.abs(variance) > 0.01;
          return (
            <View key={at} style={{ borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10,
              backgroundColor: colors.surface, borderColor: color + "33",
              borderLeftColor: color, borderLeftWidth: 3 }}>
              <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <StoreSectionHeader label={ACCOUNT_TYPE_LABELS[at]} icon="banknote.fill" tone="primary" colors={colors} />
                  {bal ? (
                    <>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{bal.accountName}</Text>
                      <View style={{ flexDirection: "row", gap: 16, marginTop: 8 }}>
                        <View>
                          <Text style={{ fontSize: 10, color: colors.muted }}>期初余额</Text>
                          <Text style={{ ...STORE_TEXT.metric, color: colors.foreground }}>¥{bal.openingBalance.toFixed(2)}</Text>
                        </View>
                        <View>
                          <Text style={{ fontSize: 10, color: colors.muted }}>期末余额（实际）</Text>
                          <Text style={{ ...STORE_TEXT.metric, color: colors.foreground }}>¥{bal.closingBalance.toFixed(2)}</Text>
                        </View>
                      </View>
                      {hasVariance && (
                        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 8, borderWidth: 1, padding: 10, marginTop: 8,
                          backgroundColor: colors.warning + "0a", borderColor: colors.warning + "33" }}>
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
                          <IconSymbol name="checkmark.circle.fill" size={12} color={colors.success} />
                          <Text style={{ fontSize: 11, color: colors.success }}>余额核对无差异</Text>
                        </View>
                      )}
                    </>
                  ) : (
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>尚未录入本月余额</Text>
                  )}
                </View>
                <TouchableOpacity onPress={() => {
                  if (!assertAccountsWritable()) return;
                  tap();
                  setBalanceAccountType(at);
                  setEditingBalance(bal ?? null);
                  setShowBalanceModal(true);
                }} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: color + "44" }}>
                  <IconSymbol name={bal ? "pencil" : "plus"} size={14} color={color} />
                  <Text style={{ fontSize: 12, color, fontWeight: "600" }}>{bal ? "更新" : "录入"}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* 差异分析说明 */}
        <View style={{ borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12,
          backgroundColor: colors.surface, borderColor: colors.border }}>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground, marginBottom: 6 }}>差异分析说明</Text>
          <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 20 }}>
            {"• "}<Text style={{ fontWeight: "600" }}>差异 {">"} 0</Text>：实际余额高于系统计算，可能有未录入的收入，或支出被重复计算{"\n"}
            {"• "}<Text style={{ fontWeight: "600" }}>差异 {"<"} 0</Text>：实际余额低于系统计算，可能有未录入的支出，或收入被高估{"\n"}
            {"• "}<Text style={{ fontWeight: "600" }}>开店宝后台</Text>：记录 POS 机未结算金额，通常有 1-3 天结算延迟{"\n"}
            {"• "}每月第二次录入期末余额时，系统自动对比上月期末与本月期初，检查是否一致
          </Text>
        </View>
      </ScrollView>

      <BalanceModal
        visible={showBalanceModal}
        balance={editingBalance}
        accountType={balanceAccountType}
        month={selectedMonth}
        colors={colors}
        onSave={(bal) => { if (!assertAccountsWritable()) return; upsertBalance(bal); setShowBalanceModal(false); }}
        onClose={() => setShowBalanceModal(false)}
      />
    </>
  );
}
