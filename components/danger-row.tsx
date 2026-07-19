import React from "react";
import { Alert, Platform, Pressable, StyleSheet, Text } from "react-native";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/use-colors";

/**
 * 危险操作行：居中红字按钮，点击弹确认弹窗。
 * 用于 device-manager、data-manager 等页面的破坏性操作。
 */
export function DangerRow({
  label,
  confirmTitle,
  confirmMessage,
  confirmLabel,
  cancelLabel = "取消",
  onConfirm,
}: {
  label: string;
  confirmTitle: string;
  confirmMessage: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
}) {
  const colors = useColors();
  const handlePress = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === "web") {
      if (window.confirm(`${confirmTitle}\n${confirmMessage}`)) onConfirm();
      return;
    }
    Alert.alert(confirmTitle, confirmMessage, [
      { text: cancelLabel, style: "cancel" },
      { text: confirmLabel, style: "destructive", onPress: onConfirm },
    ]);
  };
  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.label, { color: colors.error }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    marginHorizontal: 20,
    marginTop: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 22,
  },
});
