import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { VariantBadge } from "@/components/variant-badge";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { displayNames } from "@/lib/utils";
import { useRecipeStore } from "@/lib/recipes/store";
import { Recipe } from "@/lib/recipes/types";
import { useRecipeTagRows } from "@/lib/recipes/recipe-tag-renderer";

export function RecipeCard({
  recipe,
  isFirst = true,
  isLast = true,
  onTagPress,
}: {
  recipe: Recipe;
  isFirst?: boolean;
  isLast?: boolean;
  /** Called when a filterable tag badge is tapped. type = "flavor"|"baseSpirit"|"codexFamily"|"strength"|"category" */
  onTagPress?: (type: string, value: string) => void;
}) {
  const colors = useColors();
  const { lang } = useI18n();
  const { toggleFavorite, toggleMade } = useRecipeStore();

  const { row1Nodes, row2Nodes, hasRow2 } = useRecipeTagRows(recipe, onTagPress);

  const ingredientSummary = recipe.ingredients
    .map((i) => i.name)
    .filter(Boolean)
    .slice(0, 4)
    .join(" · ");

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleFavorite = () => {
    haptic();
    toggleFavorite(recipe.id);
  };

  const handleMade = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(
        recipe.made ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
      );
    }
    toggleMade(recipe.id);
  };

  return (
    <Pressable
      onPress={() => router.push(`/recipe/${recipe.id}`)}
      style={({ pressed }) => [styles.pressable, pressed && { opacity: 0.7 }]}
    >
      <View
        className="bg-surface px-4 py-3"
        style={[
          isFirst && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
          isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
        ]}
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-2">
            {(() => {
              const dn = displayNames(recipe.nameEn, recipe.name, lang);
              return (
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
              );
            })()}
            <View className="mt-0.5">
              <VariantBadge recipe={recipe} mode="compact" />
            </View>

            {/* ── 第一排：身份标签（category/codexFamily/baseSpirit，用户可配置）── */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-1.5"
              style={{ height: 24 }}
              contentContainerStyle={{ alignItems: "center", gap: 6 }}
            >
              {row1Nodes}
            </ScrollView>

            {/* ── 第二排：体验标签（strength/rating/cost）+ 风味标签 + 制作方法 ── */}
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
          <View className="flex-row items-center" style={{ gap: 14 }}>
            <Pressable
              onPress={handleMade}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <IconSymbol
                name={recipe.made ? "checkmark.circle.fill" : "checkmark.circle"}
                size={24}
                color={recipe.made ? colors.success : colors.muted}
              />
            </Pressable>
            <Pressable
              onPress={handleFavorite}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <IconSymbol
                name={recipe.favorite ? "star.fill" : "star"}
                size={24}
                color={recipe.favorite ? colors.primary : colors.muted}
              />
            </Pressable>
          </View>
        </View>
        <Text className="text-sm text-muted mt-2" numberOfLines={1} style={{ height: 20 }}>
          {ingredientSummary || " "}
        </Text>
      </View>
      {!isLast ? (
        <View className="bg-surface">
          <View
            className="bg-border"
            style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginBottom: 0,
  },
});
