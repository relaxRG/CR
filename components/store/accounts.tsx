/**
 * 账户余额组件（当月月报 → 账户 Tab）
 * 显示公司账户/私人账户/备用金账户/开店宝后台的期初/期末余额及差异分析
 */
import React, { useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useMonthlySummaryStore } from "@/lib/store/monthly-summary/store";
import { AccountBalance, AccountType, ACCOUNT_TYPE_COLORS, ACCOUNT_TYPE_LABELS } from "@/lib/store/monthly-summary/types";
import BalanceModal from "@/components/store/balance-modal";

// ── MonthSelector（月份选择横向滚动）────────────────────────────────────────
function MonthSelector({ selectedMonth, onSelect, colors }: { selectedMonth: string; onSelect: (m: string) => void; colors: any }) {
  const months = React.useMemo(() => {
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
          style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1,
            backgroundColor: selectedMonth === m ? colors.primary : colors.surface,
            borderColor: selectedMonth === m ? colors.primary : colors.border }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: selectedMonth === m ? "#fff" : colors.muted }}>{m}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

export default function StoreAccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const { reports, getBalancesForMonth, upsertBalance } = useMonthlySummaryStore();

  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  const balances = getBalancesForMonth(selectedMonth);
  const report = reports?.find((r) => r.month === selectedMonth);
  const allItems = [...(report?.lineItems ?? []), ...(report?.manualItems ?? [])];
  const netProfit = allItems.filter((i) => !i.isDuplicate).reduce((s, i) => s + i.amount, 0);

  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [balanceAccountType, setBalanceAccountType] = useState<AccountType>("company");
  const [editingBalance, setEditingBalance] = useState<AccountBalance | null>(null);

  const accountTypes: AccountType[] = ["company", "personal", "petty", "pos"];

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom }}>
        <MonthSelector selectedMonth={selectedMonth} onSelect={setSelectedMonth} colors={colors} />

        {/* 净利润参考 */}
        <View style={{ borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12,
          backgroundColor: colors.primary + "08", borderColor: colors.primary + "22" }}>
          <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "700" }}>本月经营净利润（参考）</Text>
          <Text style={{ fontSize: 20, fontWeight: "800", color: netProfit >= 0 ? colors.success : colors.error }}>
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
            <View key={at} style={{ borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10,
              backgroundColor: colors.surface, borderColor: color + "33",
              borderLeftColor: color, borderLeftWidth: 3 }}>
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
        onSave={(bal) => { upsertBalance(bal); setShowBalanceModal(false); }}
        onClose={() => setShowBalanceModal(false)}
      />
    </>
  );
}
