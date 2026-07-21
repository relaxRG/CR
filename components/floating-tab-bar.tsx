import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";

export interface FloatingTabItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  activeIcon?: React.ReactNode;
}

/**
 * 浮岛式底部 Tab 栏。
 * - 左右边距 16，圆角 28，白底（surface），阴影悬浮
 * - 选中项：浅蓝底块 + 主色图标+文字
 * - 未选中：透明底 + muted 图标+文字
 */
export function FloatingTabBar({
  items,
  activeKey,
  onChange,
}: {
  items: FloatingTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Platform.OS === "web" ? 12 : Math.max(insets.bottom, 8);

  return (
    <View
      style={[
        styles.container,
        {
          bottom: bottomPad + 8,
          backgroundColor: colors.surface,
          shadowColor: "#000",
        },
      ]}
      pointerEvents="box-none"
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <Pressable
            key={item.key}
            onPress={() => {
              if (!active) {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onChange(item.key);
              }
            }}
            style={({ pressed }) => [
              styles.tab,
              active && { backgroundColor: colors.border },
              pressed && !active && { opacity: 0.6 },
            ]}
          >
            <View style={styles.iconWrap}>
              {active ? (item.activeIcon ?? item.icon) : item.icon}
            </View>
            <Text
              style={[
                styles.label,
                { color: active ? colors.primary : colors.muted },
              ]}
              numberOfLines={1}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 各页面需要在底部留出的间距，防止内容被 FloatingTabBar 遮挡 */
export const FLOATING_TAB_BOTTOM_OFFSET = 90;

/**
 * 统一布局常量：浮岛 Tab 栏 bottom = max(insets.bottom,8)+8，栏体高度 ≈ 57（icon 28 + label 13 + padding/gap）。
 * Tab 栏顶部距屏幕底 ≈ max(insets.bottom,8) + 8 + 57。
 * 所有悬浮元素（FAB、多选操作栏）必须引用以下函数计算 bottom，禁止各页面自行硬编码。
 */
const TAB_BAR_BODY_HEIGHT = 57;
const TAB_BAR_BOTTOM_GAP = 8;

/** 浮岛 Tab 栏顶部到屏幕底部的距离 */
export function tabBarTop(insetsBottom: number): number {
  const pad = Platform.OS === "web" ? 12 : Math.max(insetsBottom, 8);
  return pad + TAB_BAR_BOTTOM_GAP + TAB_BAR_BODY_HEIGHT;
}

/** FAB 的 bottom：悬浮在 Tab 栏上方 16px */
export function fabBottom(insetsBottom: number): number {
  return tabBarTop(insetsBottom) + 16;
}

/** 浮岛式多选操作栏的 bottom：悬浮在 Tab 栏上方 10px */
export function bulkBarBottom(insetsBottom: number): number {
  return tabBarTop(insetsBottom) + 10;
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    borderRadius: 28,
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
    alignItems: "center",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 20,
    gap: 3,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 13,
  },
});
