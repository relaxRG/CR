/**
 * 共享配方标签渲染 Hook
 * RecipeCard 和 RecipeGroupCard 均调用此 Hook，确保标签排序、删减规则统一在一处维护。
 */
import React, { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useRecipeStore } from "@/lib/recipes/store";
import {
  Recipe,
  STRENGTH_LABELS,
  CardTagSlot,
  codexFamilyLabel,
  localizedTagName,
} from "@/lib/recipes/types";
import {
  useCardTagSettings,
  DEFAULT_CARD_TAG_SETTINGS,
  getFlavorTagConfig,
  FLAVOR_TAG_DEFAULT_COLORS,
} from "@/lib/settings/card-tags";

export const METHOD_LABELS: Record<string, string> = {
  stirred: "搅拌",
  shaken: "摇荡",
  built: "直调",
  blended: "冰沙",
  thrown: "抛接",
};

export const tagStyles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillBorder: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 11,
    lineHeight: 15,
  },
  pillSmall: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  pillTextSmall: {
    fontSize: 10,
    lineHeight: 14,
  },
});

/**
 * 共享配方标签渲染 Hook
 *
 * @param recipe - 要渲染标签的配方（普通卡片传自身，折叠卡片传组头）
 * @param onTagPress - 可选的标签点击回调
 * @returns row1Nodes, row2Nodes, hasRow2 供卡片直接渲染
 */
export function useRecipeTagRows(
  recipe: Recipe,
  onTagPress?: (type: string, value: string) => void,
) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { getCategory } = useRecipeStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const [cardTagSettings] = useCardTagSettings();

  const category = getCategory(recipe.categoryId);
  const customColors = cardTagSettings.recipeCardColors ?? {};
  const flavorConfigs = cardTagSettings.flavorTagConfigs ?? {};
  const hidden = cardTagSettings.recipeCardSlotHidden ?? [];
  const row1Slots: CardTagSlot[] =
    cardTagSettings.recipeCardRow1Slots ?? DEFAULT_CARD_TAG_SETTINGS.recipeCardRow1Slots;
  const slotOrder = cardTagSettings.recipeCardSlotOrder ?? DEFAULT_CARD_TAG_SETTINGS.recipeCardSlotOrder;
  const row2Slots: CardTagSlot[] = slotOrder.filter(
    (s) => s !== "flavors" && !row1Slots.includes(s) && !hidden.includes(s),
  );

  const costTotal = useMemo(() => {
    if (recipe.ingredients.length === 0) return null;
    const est = estimateRecipeCostSmart(recipe.ingredients, bottles, preps);
    return est.estimatedCount > 0 ? est.total : null;
  }, [recipe.ingredients, bottles, preps]);

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleTagPress = (type: string, value: string) => {
    if (!onTagPress) return;
    haptic();
    onTagPress(type, value);
  };

  /** 渲染单个槽位 badge（不含 flavors） */
  const renderSlot = (slot: CardTagSlot): React.ReactNode => {
    if (hidden.includes(slot)) return null;

    if (slot === "category") {
      if (!category) return null;
      const color = customColors.category ?? category.color;
      return (
        <Pressable
          key="category"
          onPress={() => handleTagPress("category", category.id)}
          hitSlop={4}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={[tagStyles.pill, { backgroundColor: color + "22" }]}>
            <Text style={[tagStyles.pillText, { fontWeight: "600", color }]}>
              {localizedTagName(category.name, category.nameEn, lang)}
            </Text>
          </View>
        </Pressable>
      );
    }

    if (slot === "codexFamily") {
      if (!recipe.codexFamily) return null;
      const color = customColors.codexFamily ?? colors.primary;
      return (
        <Pressable
          key="codexFamily"
          onPress={() => handleTagPress("codexFamily", recipe.codexFamily)}
          hitSlop={4}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <View
            style={[
              tagStyles.pill,
              tagStyles.pillBorder,
              { borderColor: color + "66", backgroundColor: color + "12" },
            ]}
          >
            <Text style={[tagStyles.pillText, { color }]}>
              {codexFamilyLabel(recipe.codexFamily, lang)}
            </Text>
          </View>
        </Pressable>
      );
    }

    if (slot === "baseSpirit") {
      if (!recipe.baseSpirit) return null;
      const color = customColors.baseSpirit;
      if (color) {
        return (
          <Pressable
            key="baseSpirit"
            onPress={() => handleTagPress("baseSpirit", recipe.baseSpirit)}
            hitSlop={4}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[tagStyles.pill, { backgroundColor: color + "22" }]}>
              <Text style={[tagStyles.pillText, { color }]}>
                {localizedTagName(recipe.baseSpirit, "", lang)}
              </Text>
            </View>
          </Pressable>
        );
      }
      return (
        <Pressable
          key="baseSpirit"
          onPress={() => handleTagPress("baseSpirit", recipe.baseSpirit)}
          hitSlop={4}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <View
            style={[
              tagStyles.pill,
              tagStyles.pillBorder,
              { backgroundColor: colors.background, borderColor: colors.border },
            ]}
          >
            <Text style={[tagStyles.pillText, { color: colors.muted }]}>
              {localizedTagName(recipe.baseSpirit, "", lang)}
            </Text>
          </View>
        </Pressable>
      );
    }

    if (slot === "strength") {
      if (!recipe.strength) return null;
      const color = customColors.strength;
      const label =
        lang === "en"
          ? t(`strength.${recipe.strength}` as "strength.light")
          : STRENGTH_LABELS[recipe.strength];
      if (!label) return null;
      const semanticColor =
        color ??
        (recipe.strength === "light"
          ? "#34C759"
          : recipe.strength === "strong"
            ? "#FF3B30"
            : "#FF9500");
      return (
        <Pressable
          key="strength"
          onPress={() => handleTagPress("strength", recipe.strength)}
          hitSlop={4}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={[tagStyles.pill, { backgroundColor: semanticColor + "20" }]}>
            <Text style={[tagStyles.pillText, { color: semanticColor }]}>{label}</Text>
          </View>
        </Pressable>
      );
    }

    if (slot === "rating") {
      if (!recipe.rating) return null;
      const color = customColors.rating ?? "#F5A623";
      return (
        <View
          key="rating"
          style={[
            tagStyles.pill,
            tagStyles.pillBorder,
            {
              flexDirection: "row",
              alignItems: "center",
              gap: 2,
              backgroundColor: colors.background,
              borderColor: colors.border,
            },
          ]}
        >
          <IconSymbol name="star.fill" size={10} color={color} />
          <Text style={[tagStyles.pillText, { color: colors.muted }]}>{recipe.rating}/10</Text>
        </View>
      );
    }

    if (slot === "cost") {
      if (costTotal === null) return null;
      const color = customColors.cost;
      if (color) {
        return (
          <View key="cost" style={[tagStyles.pill, { backgroundColor: color + "22" }]}>
            <Text style={[tagStyles.pillText, { color }]}>≈¥{costTotal.toFixed(1)}</Text>
          </View>
        );
      }
      return (
        <View
          key="cost"
          style={[
            tagStyles.pill,
            tagStyles.pillBorder,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Text style={[tagStyles.pillText, { color: colors.muted }]}>
            ≈¥{costTotal.toFixed(1)}
          </Text>
        </View>
      );
    }

    return null;
  };

  /** 渲染风味标签 badge */
  const renderFlavorBadge = (f: string, small = false) => {
    const cfg = getFlavorTagConfig(f, flavorConfigs);
    const tagColor =
      customColors.flavors ?? cfg.color ?? FLAVOR_TAG_DEFAULT_COLORS[f] ?? "#FF9500";
    const pillStyle = small ? tagStyles.pillSmall : tagStyles.pill;
    const textStyle = small ? tagStyles.pillTextSmall : tagStyles.pillText;
    return (
      <Pressable
        key={`flavor:${f}`}
        onPress={() => handleTagPress("flavor", f)}
        hitSlop={4}
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[pillStyle, { backgroundColor: tagColor + (small ? "18" : "22") }]}>
          <Text style={[textStyle, { fontWeight: "500", color: tagColor + (small ? "CC" : "") }]}>
            {f}
          </Text>
        </View>
      </Pressable>
    );
  };

  // ── 计算两排内容 ──────────────────────────────────────────────
  const visibleFlavors = recipe.flavors.filter(
    (f) => getFlavorTagConfig(f, flavorConfigs).visible,
  );
  const methodLabel = METHOD_LABELS[recipe.method] ?? "";
  const hasRow2 = row2Slots.length > 0 || visibleFlavors.length > 0 || !!methodLabel;

  // ── 构建节点数组 ──────────────────────────────────────────────
  const row1Nodes: React.ReactNode[] = [];
  for (const slot of row1Slots) {
    if (hidden.includes(slot)) continue;
    const node = renderSlot(slot);
    if (node) row1Nodes.push(node);
  }

  const row2Nodes: React.ReactNode[] = [];
  for (const slot of row2Slots) {
    const node = renderSlot(slot);
    if (node) row2Nodes.push(node);
  }
  for (const f of visibleFlavors) {
    row2Nodes.push(renderFlavorBadge(f, true));
  }
  if (methodLabel) {
    row2Nodes.push(
      <View
        key="method"
        style={[
          tagStyles.pillSmall,
          tagStyles.pillBorder,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[tagStyles.pillTextSmall, { color: colors.muted }]}>{methodLabel}</Text>
      </View>,
    );
  }

  return { row1Nodes, row2Nodes, hasRow2 };
}
