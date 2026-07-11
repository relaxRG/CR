import { router } from "expo-router";
import React, { useState } from "react";
import { Alert, Platform } from "react-native";

import { RecipeCard } from "@/components/recipe-card";
import { RatingSheet } from "@/components/rating-sheet";
import { SwipeableRow } from "@/components/swipeable-row";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { displayNames } from "@/lib/utils";
import { useRecipeStore } from "@/lib/recipes/store";
import { Recipe } from "@/lib/recipes/types";

/** 酒单行:左滑=编辑/删除,右滑=评分(iOS 邮件式交互) */
export function SwipeableRecipeRow({
  recipe,
  isFirst = true,
  isLast = true,
  onTagPress,
}: {
  recipe: Recipe;
  isFirst?: boolean;
  isLast?: boolean;
  onTagPress?: (type: string, value: string) => void;
}) {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { setRating, deleteRecipe } = useRecipeStore();
  const [ratingVisible, setRatingVisible] = useState(false);

  const confirmDelete = () => {
    const name = displayNames(recipe.nameEn, recipe.name, lang).primary;
    const doDelete = () => deleteRecipe(recipe.id);
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(t("detail.delete.msg", { name }))) {
        doDelete();
      }
      return;
    }
    Alert.alert(t("detail.delete.title"), t("detail.delete.msg", { name }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: doDelete },
    ]);
  };

  return (
    <>
    <SwipeableRow
      leftActions={[
        {
          key: "rate",
          label: t("rating.title"),
          icon: recipe.rating ? "star.fill" : "star",
          color: colors.warning,
          onPress: () => setRatingVisible(true),
        },
      ]}
      rightActions={[
        {
          key: "edit",
          label: t("common.edit"),
          icon: "pencil",
          color: colors.primary,
          onPress: () =>
            router.push({ pathname: "/recipe-form", params: { id: recipe.id } }),
        },
        {
          key: "delete",
          label: t("common.delete"),
          icon: "trash.fill",
          color: colors.error,
          onPress: confirmDelete,
        },
      ]}
    >
      <RecipeCard recipe={recipe} isFirst={isFirst} isLast={isLast} onTagPress={onTagPress} />
    </SwipeableRow>
    <RatingSheet
      visible={ratingVisible}
      title={displayNames(recipe.nameEn, recipe.name, lang).primary}
      value={recipe.rating}
      onChange={(v) => setRating(recipe.id, v)}
      onClose={() => setRatingVisible(false)}
    />
    </>
  );
}
