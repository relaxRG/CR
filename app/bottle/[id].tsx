import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { StarRating } from "@/components/star-rating";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useBottleStore } from "@/lib/bottles/store";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";

export default function BottleDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getBottle, deleteBottle, setBottleRating } = useBottleStore();
  const { categoryLabel } = useBottleTaxonomy();
  const bottle = getBottle(id);

  if (!bottle) {
    return (
      <ScreenContainer className="items-center justify-center px-8">
        <Text className="text-base text-muted">{t("bottle.notFound")}</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.primary, fontSize: 15 }}>{t("common.back")}</Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  const handleDelete = () => {
    const doDelete = () => {
      deleteBottle(bottle.id);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.back();
    };
    if (Platform.OS === "web") {
      if (window.confirm(t("tags.delete.confirm", { name: bottle.nameZh }))) doDelete();
    } else {
      Alert.alert(t("bottle.delete.title"), t("tags.delete.confirm", { name: bottle.nameZh }), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.delete"), style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const rows: { label: string; value: string }[] = [
    { label: t("bottle.nameEn"), value: bottle.nameEn || "—" },
    {
      label: t("bottle.category"),
      value: categoryLabel(bottle.category, lang),
    },
    ...(bottle.style ? [{ label: t("bottle.style"), value: bottle.style }] : []),
    { label: t("bottle.brand"), value: bottle.brand || "—" },
    { label: t("bottle.origin"), value: bottle.origin || "—" },
    { label: t("bottle.volume"), value: bottle.volume || "—" },
    { label: t("bottle.abv"), value: `${bottle.abv}% vol` },
    {
      label: t("bottle.price"),
      value: bottle.priceCny > 0 ? `¥${bottle.priceCny}` : t("bottles.price.unknown"),
    },
  ];

  return (
    <ScreenContainer>
      {/* Header */}
      <View className="flex-row items-center px-4 pt-1 pb-2">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={26} color={colors.foreground} />
        </Pressable>
        <View className="flex-1" />
        <Pressable
          onPress={() =>
            router.push({ pathname: "/bottle-form", params: { id: bottle.id } })
          }
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }, { marginRight: 18 }]}
        >
          <IconSymbol name="pencil" size={22} color={colors.primary} />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="trash.fill" size={22} color={colors.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text className="text-3xl font-bold text-foreground" style={{ lineHeight: 40 }}>
          {lang === "en" && bottle.nameEn ? bottle.nameEn : bottle.nameZh}
        </Text>
        {(lang === "en" ? bottle.nameZh : bottle.nameEn) ? (
          <Text className="text-base text-muted mt-1">
            {lang === "en" ? bottle.nameZh : bottle.nameEn}
          </Text>
        ) : null}

        <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
          {t("bottle.info")}
        </Text>
        <View className="bg-surface rounded-xl px-4">
          {rows.map((row, idx) => (
            <View
              key={row.label}
              className="flex-row items-center justify-between py-2.5"
              style={
                idx < rows.length - 1
                  ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }
                  : undefined
              }
            >
              <Text className="text-[15px] text-foreground">{row.label}</Text>
              <Text className="text-[15px] text-muted" style={{ maxWidth: "65%" }}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Rating */}
        <View className="flex-row items-center justify-between bg-surface rounded-xl mt-2 px-4 py-3">
          <Text className="text-[15px] text-foreground">
            {t("rating.title")}
            {bottle.rating ? ` ${bottle.rating}/10` : ""}
          </Text>
          <StarRating value={bottle.rating} size={17} onChange={(v) => setBottleRating(bottle.id, v)} />
        </View>

        {bottle.notes ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {t("bottle.notes")}
            </Text>
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 22 }}>
                {bottle.notes}
              </Text>
            </View>
          </>
        ) : null}

        <Text className="text-xs text-muted mt-4 px-1" style={{ lineHeight: 18 }}>
          {t("bottle.priceNote")}
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}
