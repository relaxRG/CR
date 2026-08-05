import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AccountBalance, AccountType, ACCOUNT_TYPE_COLORS, ACCOUNT_TYPE_LABELS } from "@/lib/store/monthly-summary/types";
function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const MI = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 12 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
});

export default function BalanceModal({ visible, balance, accountType, month, colors, onSave, onClose }: {
  visible: boolean;
  balance: AccountBalance | null;
  accountType: AccountType;
  month: string;
  colors: any;
  onSave: (bal: AccountBalance) => void;
  onClose: () => void;
}) {
  const [accountName, setAccountName] = useState(balance?.accountName ?? "");
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
            <View style={[MI.section, { borderColor: color + "33", borderLeftColor: color, borderLeftWidth: 3, backgroundColor: colors.surface }]}>
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
