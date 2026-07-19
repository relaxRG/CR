import React from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  returnKeyType?: "done" | "search" | "go";
  autoFocus?: boolean;
  /** 额外的外层 style */
  style?: object;
}

/**
 * 全局统一搜索框：灰底无边框圆角12，高42，放大镜+清除按钮。
 * 用于替换所有页面的内联搜索框实现。
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder = "搜索…",
  returnKeyType = "search",
  autoFocus = false,
  style,
}: SearchBarProps) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.border + "44" },
        style,
      ]}
    >
      <IconSymbol name="magnifyingglass" size={17} color={colors.muted} />
      <TextInput
        style={[styles.input, { color: colors.foreground }]}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        returnKeyType={returnKeyType}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChangeText("")} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <IconSymbol name="xmark.circle.fill" size={17} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: Platform.OS === "ios" ? 20 : undefined,
    paddingVertical: 0,
  },
});
