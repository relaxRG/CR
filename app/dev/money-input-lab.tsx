import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { MoneyInput } from "@/components/forms/MoneyInput";

export default function MoneyInputLab() {
  const [allowance, setAllowance] = useState(0);
  const [deduction, setDeduction] = useState(0);
  const [rate, setRate] = useState(0);

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>金额输入回归夹具</Text>
        <Text style={styles.hint}>仅用于自动化验证：编辑时允许尾随小数点，保存值统一保留两位小数。</Text>

        <View style={styles.group}>
          <Text style={styles.label}>津贴金额</Text>
          <MoneyInput testID="money-input-allowance" value={allowance} onValueChange={setAllowance} placeholder="例如 38.50" style={styles.input} />
          <Text testID="money-input-allowance-value" style={styles.value}>¥{allowance.toFixed(2)}</Text>
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>扣款金额</Text>
          <MoneyInput testID="money-input-deduction" value={deduction} allowNegative onValueChange={setDeduction} placeholder="例如 -12.25" style={styles.input} />
          <Text testID="money-input-deduction-value" style={styles.value}>¥{deduction.toFixed(2)}</Text>
        </View>

        <View style={styles.group}>
          <Text style={styles.label}>调薪倍率</Text>
          <MoneyInput testID="money-input-rate" value={rate} onValueChange={setRate} placeholder="例如 1.50" style={styles.input} />
          <Text testID="money-input-rate-value" style={styles.value}>{rate.toFixed(2)}x</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 18 },
  title: { fontSize: 22, fontWeight: "700" },
  hint: { fontSize: 13, color: "#666", lineHeight: 20 },
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600" },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#c8c8c8", borderRadius: 8, paddingHorizontal: 12, fontSize: 16 },
  value: { fontSize: 14, fontWeight: "600" },
});
