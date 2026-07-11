import { router } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { SwipeableRecipeRow } from "@/components/swipeable-recipe-row";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { displayNames } from "@/lib/utils";
import { Recipe } from "@/lib/recipes/types";
import { useRecipeTagRows } from "@/lib/recipes/recipe-tag-renderer";

/**
 * 同名配方折叠组：同一鸡尾酒的多个版本折叠为一个组头，
 * 点击展开查看各版本；组头提供"对比"入口跳转对比分析页。
 *
 * 标签排序/删减规则与普通 RecipeCard 完全一致，均由 useRecipeTagRows 驱动。
 */
export function RecipeGroupCard({
  recipes,
  isFirst = true,
  isLast = true,
  onTagPress,
}: {
  recipes: Recipe[];
  isFirst?: boolean;
  isLast?: boolean;
  onTagPress?: (type: string, value: string) => void;
}) {
  const colors = useColors();
  const { lang } = useI18n();
  const [expanded, setExpanded] = useState(false);

  // 箭头旋转动画
  const rotation = useSharedValue(0);
  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  // 单版本直接渲染普通卡片（含滑动操作）
  if (recipes.length <= 1) {
    return (
      <SwipeableRecipeRow
        recipe={recipes[0]}
        isFirst={isFirst}
        isLast={isLast}
        onTagPress={onTagPress}
      />
    );
  }

  const head = recipes[0];
  const dn = displayNames(head.nameEn, head.name, lang);

  // 调用共享标签 Hook（以组头配方为基准，标签规则与普通卡片完全一致）
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { row1Nodes, row2Nodes, hasRow2 } = useRecipeTagRows(head, onTagPress);

  const toggle = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const next = !expanded;
    rotation.value = withTiming(next ? 90 : 0, { duration: 200 });
    setExpanded(next);
  };

  const goCompare = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push({
      pathname: "/compare",
      params: { type: "recipe", ids: recipes.map((r) => r.id).join(",") },
    });
  };

  return (
    <View>
      {/* 组头 */}
      <Pressable onPress={toggle} style={({ pressed }) => [pressed && { opacity: 0.7 }]}>
        <View
          className="bg-surface px-4 py-3"
          style={[
            isFirst && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
            !expanded && isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
            // 左侧蓝色边框标识"可展开的组"
            styles.groupBorder,
            { borderLeftColor: colors.primary + "99" },
          ]}
        >
          <View className="flex-row items-start">
            <View className="flex-1 pr-2">
              {/* 名称行 */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ height: 24 }}
                contentContainerStyle={{ alignItems: "baseline", gap: 6 }}
              >
                <Text className="text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
                  {dn.primary}
                </Text>
                {dn.secondary ? (
                  <Text className="text-xs text-muted" style={{ lineHeight: 22 }}>
                    {dn.secondary}
                  </Text>
                ) : null}
              </ScrollView>

              {/* 版本数徽章 + 对比按钮（紧跟名称行下方） */}
              <View className="flex-row items-center mt-0.5" style={{ gap: 6 }}>
                <View
                  style={[
                    styles.versionBadge,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  <Text style={[styles.versionBadgeText, { color: "#fff" }]}>
                    {recipes.length} 个版本
                  </Text>
                </View>
                <Pressable
                  onPress={goCompare}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.compareBtn,
                    { borderColor: colors.primary + "66", backgroundColor: colors.primary + "10" },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <IconSymbol name="rectangle.split.2x1" size={12} color={colors.primary} />
                  <Text style={[styles.compareBtnText, { color: colors.primary }]}>对比</Text>
                </Pressable>
              </View>

              {/* ── 第一排标签（与普通卡片完全一致）── */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mt-1.5"
                style={{ height: 24 }}
                contentContainerStyle={{ alignItems: "center", gap: 6 }}
              >
                {row1Nodes}
              </ScrollView>

              {/* ── 第二排标签（与普通卡片完全一致）── */}
              {hasRow2 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="mt-1"
                  style={{ height: 22 }}
                  contentContainerStyle={{ alignItems: "center", gap: 5 }}
                >
                  {row2Nodes}
                </ScrollView>
              )}
            </View>

            {/* 展开箭头（旋转动画） */}
            <View style={{ paddingTop: 2 }}>
              <Animated.View style={arrowStyle}>
                <IconSymbol name="chevron.right" size={18} color={colors.muted} />
              </Animated.View>
            </View>
          </View>

          {/* 配料摘要行（与普通卡片对齐） */}
          <Text className="text-sm text-muted mt-2" numberOfLines={1} style={{ height: 20 }}>
            {head.ingredients.map((i) => i.name).filter(Boolean).slice(0, 4).join(" · ") || " "}
          </Text>
        </View>
      </Pressable>

      {/* 展开的版本列表（左侧蓝色缩进条） */}
      {expanded ? (
        <View
          style={[
            styles.expandWrap,
            { borderLeftColor: colors.primary + "55" },
            isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: "hidden" },
          ]}
        >
          {recipes.map((r, i) => (
            <SwipeableRecipeRow
              key={r.id}
              recipe={r}
              isFirst={false}
              isLast={i === recipes.length - 1 && isLast}
              onTagPress={onTagPress}
            />
          ))}
        </View>
      ) : null}

      {/* 分隔线（未展开且非组尾） */}
      {!isLast ? (
        <View className="bg-surface">
          <View
            className="bg-border"
            style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  groupBorder: {
    borderLeftWidth: 3,
  },
  versionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  versionBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  compareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  compareBtnText: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
  },
  expandWrap: {
    borderLeftWidth: 3,
  },
});
