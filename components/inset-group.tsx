import React from "react";
import { StyleSheet, Text, View, type ViewProps } from "react-native";

import { cn } from "@/lib/utils";

/**
 * iOS 风格 inset grouped 分组容器。
 * - 外层圆角白色(surface)卡片,水平内缩
 * - 子元素之间自动插入细分隔线(hairline),缩进对齐 iOS 设置页
 * - 可选 header(组标题,大写灰字)与 footer(说明文字)
 */
export function InsetGroup({
  children,
  header,
  footer,
  className,
  separatorInset = 16,
  style,
  ...props
}: ViewProps & {
  header?: string;
  footer?: string;
  className?: string;
  /** 分隔线左侧缩进,默认 16;传 0 通栏 */
  separatorInset?: number;
}) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style} {...props}>
      {header ? (
        <Text className="text-[13px] text-muted uppercase px-4 mb-2" style={styles.header}>
          {header}
        </Text>
      ) : null}
      <View className={cn("bg-surface rounded-xl overflow-hidden", className)}>
        {items.map((child, idx) => (
          <View key={idx}>
            {child}
            {idx < items.length - 1 ? (
              <View
                className="bg-border"
                style={[styles.separator, { marginLeft: separatorInset }]}
              />
            ) : null}
          </View>
        ))}
      </View>
      {footer ? (
        <Text className="text-[13px] text-muted px-4 mt-2" style={styles.footer}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** 分组内的标准行容器:统一高度与内边距 */
export function InsetRow({
  children,
  className,
  ...props
}: ViewProps & { className?: string }) {
  return (
    <View className={cn("flex-row items-center px-4 py-3 bg-surface", className)} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    letterSpacing: 0.4,
    lineHeight: 18,
  },
  footer: {
    lineHeight: 18,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
});

