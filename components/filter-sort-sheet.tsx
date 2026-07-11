import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

/** 一个筛选维度(如分类/风味/工艺),options 为可勾选标签 */
export interface FilterDimension {
  key: string;
  title: string;
  options: { value: string; label: string; color?: string }[];
  /** 已选值集合 */
  selected: string[];
  onToggle: (value: string) => void;
}

/** 排序方式选项 */
export interface SortOption {
  value: string;
  label: string;
}

/**
 * 统一筛选与排序面板:iOS 风格底部弹层。
 * 标签多选勾选(checkmark),排序单选(radio 样式),底部清除/完成。
 */
export function FilterSortSheet({
  visible,
  onClose,
  dimensions,
  sortOptions,
  sortValue,
  onSortChange,
  onClearAll,
  resultCount,
}: {
  visible: boolean;
  onClose: () => void;
  dimensions: FilterDimension[];
  sortOptions?: SortOption[];
  sortValue?: string;
  onSortChange?: (value: string) => void;
  onClearAll: () => void;
  resultCount: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  const selectedTotal =
    dimensions.reduce((sum, d) => sum + d.selected.length, 0) +
    (sortValue && sortValue !== "default" ? 1 : 0);

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* 背景遮罩 */}
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        {/* 把手与标题 */}
        <View style={styles.handleWrap}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
        </View>
        <View style={styles.headerRow}>
          <Text className="text-lg font-semibold text-foreground" style={{ lineHeight: 24 }}>
            {t("fs.title")}
          </Text>
          <Pressable onPress={onClose} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <IconSymbol name="xmark.circle.fill" size={24} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
          {/* 排序 */}
          {sortOptions && sortOptions.length > 0 && onSortChange ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.muted }]}>{t("fs.sort")}</Text>
              <View style={[styles.groupBox, { backgroundColor: colors.surface }]}>
                {sortOptions.map((opt, i) => {
                  const active = sortValue === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        haptic();
                        onSortChange(opt.value);
                      }}
                      style={({ pressed }) => [
                        styles.optionRow,
                        i > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 15,
                          lineHeight: 21,
                          color: active ? colors.primary : colors.foreground,
                          fontWeight: active ? "600" : "400",
                        }}
                      >
                        {opt.label}
                      </Text>
                      {active ? (
                        <IconSymbol name="checkmark" size={17} color={colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* 各筛选维度:标签勾选 */}
          {dimensions.map((dim) =>
            dim.options.length > 0 ? (
              <View key={dim.key} style={styles.section}>
                <View style={styles.dimHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.muted }]}>{dim.title}</Text>
                  {dim.selected.length > 0 ? (
                    <Text style={[styles.dimCount, { color: colors.primary }]}>
                      {dim.selected.length}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.tagWrap}>
                  {dim.options.map((opt) => {
                    const active = dim.selected.includes(opt.value);
                    const tint = opt.color ?? colors.primary;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          haptic();
                          dim.onToggle(opt.value);
                        }}
                        style={({ pressed }) => [
                          styles.tag,
                          {
                            backgroundColor: active ? tint : colors.surface,
                            borderColor: active ? tint : colors.border,
                          },
                          pressed && { opacity: 0.75 },
                        ]}
                      >
                        {active ? <IconSymbol name="checkmark" size={12} color="#FFFFFF" /> : null}
                        <Text
                          style={{
                            fontSize: 13,
                            lineHeight: 18,
                            fontWeight: active ? "600" : "400",
                            color: active ? "#FFFFFF" : colors.foreground,
                          }}
                        >
                          {opt.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null,
          )}
        </ScrollView>

        {/* 底部操作 */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={() => {
              haptic();
              onClearAll();
            }}
            disabled={selectedTotal === 0}
            style={({ pressed }) => [
              styles.clearBtn,
              { borderColor: colors.border, opacity: selectedTotal === 0 ? 0.4 : pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={{ fontSize: 15, lineHeight: 21, color: colors.foreground, fontWeight: "500" }}>
              {t("fs.clear")}
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.doneBtn,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Text style={{ fontSize: 15, lineHeight: 21, color: "#FFFFFF", fontWeight: "600" }}>
              {t("fs.done", { n: resultCount })}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
  },
  handleWrap: {
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 5,
    borderRadius: 3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  dimHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dimCount: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  groupBox: {
    borderRadius: 12,
    marginTop: 8,
    overflow: "hidden",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  tagWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 12,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  clearBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  doneBtn: {
    flex: 2,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
  },
});
