import React, { useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable, {
  SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import Reanimated, { SharedValue, useAnimatedStyle } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";

/** 滑动露出的单个操作按钮定义 */
export interface SwipeAction {
  key: string;
  label: string;
  /** icon-symbol 中已映射的图标名 */
  icon: string;
  /** 按钮背景色 */
  color: string;
  onPress: () => void;
  /** 触发后是否自动收起(默认 true) */
  closeOnPress?: boolean;
}

const ACTION_WIDTH = 76;

function ActionButtons({
  actions,
  progress: _progress,
  drag,
  side,
  close,
}: {
  actions: SwipeAction[];
  progress: SharedValue<number>;
  drag: SharedValue<number>;
  side: "left" | "right";
  close: () => void;
}) {
  const total = ACTION_WIDTH * actions.length;
  const animatedStyle = useAnimatedStyle(() => {
    // iOS 邮件式跟手位移:按钮随拖动距离滑入
    const translateX = side === "right" ? drag.value + total : drag.value - total;
    return { transform: [{ translateX }] };
  });
  return (
    <Reanimated.View style={[styles.actionsWrap, { width: total }, animatedStyle]}>
      {actions.map((a) => (
        <Pressable
          key={a.key}
          onPress={() => {
            if (Platform.OS !== "web") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            if (a.closeOnPress !== false) close();
            a.onPress();
          }}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: a.color },
            pressed && { opacity: 0.85 },
          ]}
        >
          <IconSymbol name={a.icon as never} size={22} color="#FFFFFF" />
          <Text style={styles.actionLabel} numberOfLines={1}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </Reanimated.View>
  );
}

/**
 * 通用滑动行:参考 iOS 邮件/备忘录交互。
 * 左滑(rightActions)露出编辑/删除等,右滑(leftActions)露出收藏/做过等快捷操作。
 */
export function SwipeableRow({
  children,
  leftActions = [],
  rightActions = [],
}: {
  children: React.ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
}) {
  const ref = useRef<SwipeableMethods>(null);
  const close = () => ref.current?.close();

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      overshootFriction={8}
      leftThreshold={36}
      rightThreshold={36}
      renderLeftActions={
        leftActions.length > 0
          ? (progress, drag) => (
              <ActionButtons
                actions={leftActions}
                progress={progress}
                drag={drag}
                side="left"
                close={close}
              />
            )
          : undefined
      }
      renderRightActions={
        rightActions.length > 0
          ? (progress, drag) => (
              <ActionButtons
                actions={rightActions}
                progress={progress}
                drag={drag}
                side="right"
                close={close}
              />
            )
          : undefined
      }
      onSwipeableWillOpen={() => {
        if (Platform.OS !== "web") {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  actionsWrap: {
    flexDirection: "row",
  },
  actionBtn: {
    width: ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  actionLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
});
