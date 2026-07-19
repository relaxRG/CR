import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";

/**
 * iOS 风格大标题（34pt Bold）+ 可选副标题。
 * 用于四个 Tab 首屏顶部。
 */
export function LargeTitle({
  title,
  subtitle,
  rightSlot,
}: {
  title: string;
  subtitle?: string;
  /** 右侧插槽（如按钮） */
  rightSlot?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      <View style={styles.left}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.sub, { color: colors.muted }]}>{subtitle}</Text>
        ) : null}
      </View>
      {rightSlot ? <View style={styles.right}>{rightSlot}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  left: { flex: 1 },
  title: { fontSize: 34, fontWeight: "700", lineHeight: 41 },
  sub: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  right: { paddingBottom: 4 },
});
