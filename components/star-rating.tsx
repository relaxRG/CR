import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

/**
 * 星星评分展示/交互组件(1-10 整数,无半星,10 颗星)。
 * - readonly:列表小尺寸只读展示(只显示实心星数量 + 数值)
 * - interactive:详情页/评分面板点选
 */
export function StarRating({
  value,
  onChange,
  size = 22,
  readonly = false,
}: {
  value: number | null;
  onChange?: (v: number | null) => void;
  size?: number;
  readonly?: boolean;
}) {
  const colors = useColors();
  const v = typeof value === "number" ? Math.min(10, Math.max(0, Math.round(value))) : 0;

  if (readonly) {
    if (v <= 0) return null;
    return (
      <View style={styles.row}>
        <IconSymbol name="star.fill" size={size} color="#F5A623" />
        <Text style={[styles.compactText, { color: colors.text, fontSize: size * 0.72 }]}>
          {v}/10
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.rowWrap}>
      {Array.from({ length: 10 }, (_, i) => {
        const n = i + 1;
        const filled = n <= v;
        return (
          <Pressable
            key={n}
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              // 再点当前分数 = 清除评分
              onChange?.(n === v ? null : n);
            }}
            hitSlop={4}
            style={({ pressed }) => [styles.starBtn, pressed && { opacity: 0.6 }]}
          >
            <IconSymbol
              name={filled ? "star.fill" : "star"}
              size={size}
              color={filled ? "#F5A623" : colors.border}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 3 },
  rowWrap: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 2 },
  starBtn: { padding: 2 },
  compactText: { fontWeight: "600" },
});
