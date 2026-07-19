import React from "react";
import { Pressable, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

/**
 * 全局统一 FAB（Floating Action Button）。
 * bottom 默认 90（浮岛 Tab 栏高度 + 间距）。
 */
export function Fab({
  onPress,
  iconName = "plus",
  bottom = 90,
  right = 20,
}: {
  onPress: () => void;
  iconName?: string;
  bottom?: number;
  right?: number;
}) {
  const colors = useColors();
  const handlePress = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: colors.primary, bottom, right },
        pressed && { transform: [{ scale: 0.95 }], opacity: 0.9 },
      ]}
    >
      <IconSymbol name={iconName as any} size={28} color="#FFFFFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});

