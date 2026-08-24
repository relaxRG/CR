import React, { useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, Text, View } from "react-native";
import { resolveChartGesture } from "@/lib/wine/supplier-trend-touch-gesture";

export function WineSupplierTrendTouchChart({
  children,
  onSelectSupplier,
}: {
  children: React.ReactNode;
  onSelectSupplier: (supplierId: string) => void;
}) {
  const [isHorizontalGesture, setIsHorizontalGesture] = useState(false);
  const suppressPressRef = useRef(false);

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => {
      const decision = resolveChartGesture({ dx: gesture.dx, dy: gesture.dy, moved: true });
      setIsHorizontalGesture(decision.direction === "horizontal");
      suppressPressRef.current = decision.suppressPress;
      // 只有横向意图由图表接管；纵向意图继续交由外层页面 ScrollView。
      return decision.direction === "horizontal";
    },
    onPanResponderRelease: () => {
      // 延迟到本轮触摸结束后恢复点击，避免滑动末尾误触柱体。
      requestAnimationFrame(() => { suppressPressRef.current = false; setIsHorizontalGesture(false); });
    },
    onPanResponderTerminate: () => { suppressPressRef.current = false; setIsHorizontalGesture(false); },
  })).current;

  const select = (supplierId: string) => {
    if (suppressPressRef.current) return;
    onSelectSupplier(supplierId);
  };

  return (
    <View accessibilityRole="adjustable" accessibilityLabel="供应商采购趋势图" {...panResponder.panHandlers}>
      <ScrollView horizontal={isHorizontalGesture} scrollEnabled={isHorizontalGesture} showsHorizontalScrollIndicator={false}>
        {React.Children.map(children, (child, index) => (
          <Pressable key={index} onPress={() => select(String(index))} accessibilityHint="轻点选择供应商，横向滑动查看更多柱体">
            {child}
          </Pressable>
        ))}
      </ScrollView>
      <Text accessibilityLiveRegion="polite">{isHorizontalGesture ? "正在横向浏览供应商" : "轻点柱体查看明细"}</Text>
    </View>
  );
}
