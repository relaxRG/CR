import React from "react";
import { StyleSheet, Text, View , Pressable } from "react-native";
import { useColors } from "@/hooks/use-colors";

/**
 * 全局统一空状态组件。
 * icon: emoji 或 SF Symbol 名称（传 string 直接渲染 emoji）
 */
export function EmptyState({
  icon = "🍸",
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {description ? (
        <Text style={[styles.desc, { color: colors.muted }]}>{description}</Text>
      ) : null}
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: colors.primary },
            pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
          ]}
        >
          <Text style={styles.btnText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  icon: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 22, textAlign: "center", marginBottom: 8 },
  desc: { fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 24 },
  btn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  btnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
});
