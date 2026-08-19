import type { ComponentProps, ReactNode } from "react";
import React from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import { IconSymbol } from "@/components/ui/icon-symbol";
import {
  getStoreDensity,
  storeContentShell,
  storeTone,
  storeToneSurface,
  STORE_TEXT,
  STORE_VISUAL_SYSTEM,
  type StoreVisualColors,
  type StoreVisualTone,
} from "@/lib/theme/store-visual-system";

type StoreIconName = ComponentProps<typeof IconSymbol>["name"];

function storeSegmentItemTestID(testID: string | undefined, key: string) {
  if (!testID) return undefined;
  if (testID.endsWith("-segmented-tabs")) return `${testID.replace("-segmented-tabs", "-segment")}-${key}`;
  return `${testID.slice(0, -1)}-${key}`;
}

export type StoreSegmentItem<T extends string> = {
  key: T;
  label: string;
  icon?: StoreIconName;
};

/** 整个门店唯一的模块二级页签。视觉仅以文字和细下划线体现选中，图标只在确有业务辨识必要时出现。 */
export function StoreSegmentedTabs<T extends string>({
  items,
  active,
  onChange,
  colors,
  testID,
}: {
  items: readonly StoreSegmentItem<T>[];
  active: T;
  onChange: (key: T) => void;
  colors: StoreVisualColors;
  testID?: string;
}) {
  return (
    <View style={{ minHeight: 40, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID} contentContainerStyle={{ minHeight: 40, alignItems: "center", gap: 4, paddingHorizontal: 12 }}>
        {items.map((item) => {
          const selected = item.key === active;
          const tint = selected ? storeTone(colors, "primary") : colors.muted;
          return (
            <Pressable
              key={item.key}
              testID={storeSegmentItemTestID(testID, item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onChange(item.key)}
              style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 5, opacity: pressed ? 0.65 : 1 })}
            >
              {item.icon ? <IconSymbol name={item.icon} size={STORE_VISUAL_SYSTEM.icon.detail} color={tint} /> : null}
              <Text style={{ ...STORE_TEXT.body, color: tint, fontWeight: selected ? STORE_VISUAL_SYSTEM.weight.emphasis : STORE_VISUAL_SYSTEM.weight.quiet }}>
                {item.label}
              </Text>
              {selected ? <View style={{ position: "absolute", height: 2, left: 10, right: 10, bottom: 0, borderRadius: 1, backgroundColor: tint }} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** 分类、部门、台账分组的唯一标题形态：每组最多一个14pt语义图标。 */
export function StoreSectionHeader({
  label,
  detail,
  icon,
  tone = "neutral",
  colors,
  action,
  style,
}: {
  label: string;
  detail?: string;
  icon?: StoreIconName;
  tone?: StoreVisualTone;
  colors: StoreVisualColors;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const tint = storeTone(colors, tone);
  return (
    <View style={[{ minHeight: 30, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 2 }, style]}>
      {icon ? <IconSymbol name={icon} size={STORE_VISUAL_SYSTEM.icon.section} color={tint} /> : <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: tint }} />}
      <Text style={{ ...STORE_TEXT.sectionTitle, color: colors.foreground }}>{label}</Text>
      {detail ? <Text style={{ ...STORE_TEXT.supporting, color: colors.muted }}>{detail}</Text> : null}
      <View style={{ flex: 1 }} />
      {action}
    </View>
  );
}

/** 汇总区的指标。每个指标使用文字和色点共同表达语义，避免仅靠彩色大数字。 */
export function StoreMetric({
  label,
  value,
  tone = "neutral",
  icon,
  colors,
  primary = false,
}: {
  label: string;
  value: string;
  tone?: StoreVisualTone;
  icon?: StoreIconName;
  colors: StoreVisualColors;
  primary?: boolean;
}) {
  const tint = storeTone(colors, tone);
  return (
    <View style={{ minWidth: 0, flex: 1, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        {icon ? <IconSymbol name={icon} size={STORE_VISUAL_SYSTEM.icon.detail} color={tint} /> : <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />}
        <Text numberOfLines={1} style={{ ...STORE_TEXT.supporting, color: colors.muted }}>{label}</Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ ...(primary ? STORE_TEXT.metricLarge : STORE_TEXT.metric), color: tint }}>
        {value}
      </Text>
    </View>
  );
}

/** 统一36pt上下文操作；仅主要操作使用着色表面，其他操作保持中性。 */
export function StoreToolbarAction({
  label,
  icon,
  accessibilityLabel = label,
  accessibilityHint,
  testID,
  tone = "neutral",
  emphasis = false,
  colors,
  onPress,
  disabled = false,
}: {
  label: string;
  icon?: StoreIconName;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  tone?: StoreVisualTone;
  emphasis?: boolean;
  colors: StoreVisualColors;
  onPress: () => void;
  disabled?: boolean;
}) {
  const tint = storeTone(colors, tone);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        paddingHorizontal: 10,
        borderRadius: STORE_VISUAL_SYSTEM.radius.control,
        borderWidth: 1,
        borderColor: emphasis ? `${tint}44` : colors.border,
        backgroundColor: emphasis ? storeToneSurface(colors, tone) : colors.surface,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        opacity: disabled ? 0.45 : pressed ? 0.66 : 1,
      })}
    >
      {icon ? <IconSymbol name={icon} size={STORE_VISUAL_SYSTEM.icon.toolbar} color={tint} /> : null}
      <Text style={{ ...STORE_TEXT.supporting, color: tint, fontWeight: STORE_VISUAL_SYSTEM.weight.emphasis }}>{label}</Text>
    </Pressable>
  );
}

/** 自适应内容壳。业务页面只需放置内容，三端宽度控制不再散落在各个页面。 */
export function StoreContentShell({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { width } = useWindowDimensions();
  return <View style={[storeContentShell(width), { gap: STORE_VISUAL_SYSTEM.spacing.sectionGap }, style]}>{children}</View>;
}

export function useStoreDensity() {
  const { width } = useWindowDimensions();
  return getStoreDensity(width);
}
