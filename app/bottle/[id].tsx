import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Alert, Platform, Pressable, ScrollView, ScrollView as HScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

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

  const chipStyle = (primary?: boolean) => ({
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginRight: 6,
    backgroundColor: primary ? (colors.primary + "22") : colors.surface,
    borderWidth: 1,
    borderColor: primary ? (colors.primary + "55") : colors.border,
  });
  const chipTextStyle = (primary?: boolean) => ({
    fontSize: 13,
    color: primary ? colors.primary : colors.foreground,
    fontWeight: primary ? ("600" as const) : ("400" as const),
  });

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
        <Text style={{ fontSize: 28, fontWeight: "700", lineHeight: 34 }} className="text-foreground">
          {lang === "en" && bottle.nameEn ? bottle.nameEn : bottle.nameZh}
        </Text>
        {(lang === "en" ? bottle.nameZh : bottle.nameEn) ? (
          <Text className="text-base text-muted mt-1">
            {lang === "en" ? bottle.nameZh : bottle.nameEn}
          </Text>
        ) : null}

        {/* 标签分区行：分类 + 风格子标签 */}
        <HScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: "row", alignItems: "center", marginTop: 10, marginBottom: 2 }}
        >
          <View style={chipStyle(true)}>
            <Text style={chipTextStyle(true)}>
              {categoryLabel(bottle.category, lang)}
            </Text>
          </View>
          {bottle.style ? (
            <View style={chipStyle(false)}>
              <Text style={chipTextStyle(false)}>{bottle.style}</Text>
            </View>
          ) : null}
        </HScrollView>

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

        {/* 风味标签 */}
        {bottle.flavorTags && bottle.flavorTags.length > 0 ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "风味" : "Flavor"}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 4 }}>
              {bottle.flavorTags.map((tag) => (
                <View
                  key={tag}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 5,
                    borderRadius: 16,
                    backgroundColor: colors.primary + "14",
                    borderWidth: 1,
                    borderColor: colors.primary + "44",
                  }}
                >
                  <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "500" }}>{tag}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* 故事 / 介绍 */}
        {bottle.story ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "故事与介绍" : "Story"}
            </Text>
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 24 }}>
                {bottle.story}
              </Text>
            </View>
          </>
        ) : null}

        {/* 风格描述 */}
        {bottle.styleDesc ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "风格描述" : "Style Description"}
            </Text>
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 24 }}>
                {bottle.styleDesc}
              </Text>
            </View>
          </>
        ) : null}

        {/* 深度资料：蒸馏厂 / 搭配 / 用途 / 季节 */}
        {(bottle.distilleryInfo || bottle.pairingNotes || bottle.usageNotes || bottle.seasonality) ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "深度资料" : "Deep Info"}
            </Text>
            <View className="bg-surface rounded-xl px-4">
              {[
                bottle.distilleryInfo && { label: lang === "zh" ? "蒸馏厂" : "Distillery", value: bottle.distilleryInfo },
                bottle.pairingNotes && { label: lang === "zh" ? "搭配建议" : "Pairing", value: bottle.pairingNotes },
                bottle.usageNotes && { label: lang === "zh" ? "调酒用途" : "Usage", value: bottle.usageNotes },
                bottle.seasonality && { label: lang === "zh" ? "季节性" : "Seasonality", value: bottle.seasonality },
              ].filter(Boolean).map((row, idx, arr) => row && (
                <View
                  key={row.label}
                  style={idx < arr.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 12 } : { paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: 4, letterSpacing: 0.3 }}>
                    {row.label.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 22 }}>
                    {row.value}
                  </Text>
                </View>
              ))}
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
