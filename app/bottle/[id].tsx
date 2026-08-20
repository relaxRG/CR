import { useLocalSearchParams, useRouter } from "expo-router";
import { formatMoney } from "@/lib/utils";
import React from "react";
import { Alert, Platform, Pressable, ScrollView, ScrollView as HScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { StarRating } from "@/components/star-rating";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useCan } from "@/hooks/use-can";
import { useBottleStore } from "@/lib/bottles/store";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";
import { isPerishableWholeBottle } from "@/lib/recipes/smart-cost";
import { bottleGroupOf, getEffectiveCostPrice, getSupplierChannelPurchaseNames, resolveCostChannelId } from "@/lib/bottles/types";

export default function BottleDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { t, lang } = useI18n();
  const editDecision = useCan("bottles.edit");
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getBottle, deleteBottle, setBottleRating } = useBottleStore();
  const { categoryLabel } = useBottleTaxonomy();
  const bottle = getBottle(id);

  // 计算当前条目实际所属库
  const effectiveGroup = bottle
    ? (bottle.libraryOverride && bottle.libraryOverride !== "homemade"
        ? bottle.libraryOverride
        : bottleGroupOf(bottle.category))
    : "bottles";

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

  const supplierChannels = bottle.supplierChannels ?? [];
  const costChannelId = resolveCostChannelId(supplierChannels, bottle.costChannelId);
  const costChannel = supplierChannels.find((channel) => channel.id === costChannelId);
  const effectiveCostPrice = getEffectiveCostPrice(bottle);
  const latestPriceDate = supplierChannels
    .flatMap((channel) => channel.priceHistory ?? [])
    .map((record) => record.date)
    .sort()
    .at(-1);

  const rows: { label: string; value: string }[] = [
    { label: t("bottle.nameEn"), value: bottle.nameEn || "—" },
    {
      label: t("bottle.category"),
      value: categoryLabel(bottle.category, lang),
    },
    ...(bottle.style ? [{
      label: effectiveGroup === "spirits"
        ? (lang === "zh" ? "蒸馏风格" : "Distillation Style")
        : effectiveGroup === "bottles"
          ? (lang === "zh" ? "产品风格" : "Product Style")
          : t("bottle.style"),
      value: bottle.style,
    }] : []),
    { label: t("bottle.brand"), value: bottle.brand || "—" },
    { label: t("bottle.origin"), value: bottle.origin || "—" },
    { label: t("bottle.volume"), value: bottle.volume || "—" },
    { label: t("bottle.abv"), value: `${bottle.abv}% vol` },
  ];

  // 原料库专属：单位成本展示行
  if (effectiveGroup === "materials" && bottle.priceCny > 0 && bottle.packQty && bottle.packQty > 0 && bottle.packUnit) {
    const u = bottle.packUnit.toLowerCase();
    const baseUnit: "ml" | "g" | "piece" =
      ["ml", "cl", "l", "dl", "oz"].includes(u) ? "ml"
      : ["g", "kg", "斤", "两"].includes(u) ? "g"
      : "piece";
    let qty = bottle.packQty;
    if (u === "cl") qty *= 10;
    else if (u === "l") qty *= 1000;
    else if (u === "kg") qty *= 1000;
    const unitCost = bottle.priceCny / qty;
    if (isFinite(unitCost) && unitCost > 0) {
      const unitLabel = baseUnit === "ml"
        ? (lang === "zh" ? "每毫升成本" : "Cost per ml")
        : baseUnit === "g"
          ? (lang === "zh" ? "每克成本" : "Cost per g")
          : (lang === "zh" ? `每${bottle.packUnit}成本` : `Cost per ${bottle.packUnit}`);
      const decimals = baseUnit === "piece" ? 2 : 4;
      rows.push({ label: unitLabel, value: `¥${unitCost.toFixed(decimals)}` });
    }
  }

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
        {editDecision.allowed && (
          <>
            <Pressable
              onPress={() => router.push({ pathname: "/bottle-channels", params: { id: bottle.id } })}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.6 }, { marginRight: 18 }]}
            >
              <IconSymbol name="building.2" size={22} color="#F59E0B" />
            </Pressable>
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
          </>
        )}
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
          {/* 归属徽章：所属库=自制库的酒款条目，可点跳自制库列表（Bug 1 修复） */}
          {bottle.libraryOverride === "homemade" ? (
            <Pressable
              onPress={() => router.push("/(tabs)/homemade")}
              hitSlop={4}
              style={({ pressed }) => [{
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 20,
                marginRight: 6,
                backgroundColor: "#34C75922",
                borderWidth: 1,
                borderColor: "#34C75988",
              }, pressed && { opacity: 0.6 }]}
            >
              <Text style={{ fontSize: 13, color: "#34C759", fontWeight: "500" }}>
                {lang === "zh" ? "自制库 ›" : "Homemade ›"}
              </Text>
            </Pressable>
          ) : null}
          {bottle.style ? (
            <View style={chipStyle(false)}>
              <Text selectable style={chipTextStyle(false)}>{bottle.style}</Text>
            </View>
          ) : null}
          {/* 开瓶易失效标签：手动设置时显示橙色，自动推断为 true 时显示灰色 */}
          {isPerishableWholeBottle(bottle) ? (
            <View style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
              marginRight: 6,
              backgroundColor: bottle.perishableOnOpen !== undefined ? "#F59E0B22" : colors.surface,
              borderWidth: 1,
              borderColor: bottle.perishableOnOpen !== undefined ? "#F59E0B88" : colors.border,
            }}>
              <Text style={{
                fontSize: 13,
                color: bottle.perishableOnOpen !== undefined ? "#F59E0B" : colors.muted,
                fontWeight: "500",
              }}>
                {lang === "zh" ? "开瓶易失效" : "Perishable"}
                {bottle.perishableOnOpen !== undefined ? (lang === "zh" ? " ·手动" : " ·manual") : ""}
              </Text>
            </View>
          ) : bottle.perishableOnOpen === false ? (
            // 用户手动关闭了易失效标记，显示灰色「已手动关闭」提示
            <View style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
              marginRight: 6,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 13, color: colors.muted, fontWeight: "400" }}>
                {lang === "zh" ? "不易失效 ·手动" : "Not Perishable ·manual"}
              </Text>
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

        {/* 中国参考价：位于基础信息与评分之间，供应渠道是唯一可编辑事实来源。 */}
        <View testID="bottle-china-reference-price-card" className="bg-surface rounded-xl mt-2 px-4 py-3">
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <View>
              <Text style={{ fontSize: 15, color: colors.foreground, fontWeight: "500" }}>中国参考价</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                {costChannel ? `成本基准：${costChannel.name}` : "尚未选择成本计算基准"}
              </Text>
            </View>
            <Text style={{ fontSize: 22, color: colors.foreground, fontWeight: "600" }}>
              {effectiveCostPrice > 0 ? `¥${formatMoney(effectiveCostPrice)}` : "未设置"}
              {costChannel ? <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "400" }}>/{costChannel.unit}</Text> : null}
            </Text>
          </View>
          {costChannel ? (
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }} numberOfLines={1}>
              {getSupplierChannelPurchaseNames(costChannel).length > 0
                ? `采购名称：${getSupplierChannelPurchaseNames(costChannel).map((entry) => entry.name).join("、")}`
                : "尚未记录该渠道采购名称"}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {supplierChannels.length > 0 ? `${supplierChannels.length} 个供货渠道${latestPriceDate ? ` · 最近报价 ${latestPriceDate}` : ""}` : "尚无供应渠道，可录入供应商或自采电商"}
            </Text>
            <Pressable
              testID="bottle-manage-supplier-channels"
              onPress={() => router.push({ pathname: "/bottle-channels", params: { id: bottle.id } })}
              style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1, paddingVertical: 3 }]}
            >
              <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "500" }}>管理供应渠道</Text>
            </Pressable>
          </View>
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
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 22 }} selectable>
                {bottle.notes}
              </Text>
            </View>
          </>
        ) : null}

        {/* 风味标签 */}
        {bottle.flavorTags && bottle.flavorTags.length > 0 ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {effectiveGroup === "spirits" || effectiveGroup === "bottles"
                ? (lang === "zh" ? "风味特征" : "Flavor Profile")
                : (lang === "zh" ? "风味" : "Flavor")}
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
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 24 }} selectable>
                {bottle.story}
              </Text>
            </View>
          </>
        ) : null}

        {/* 风格描述 */}
        {bottle.styleDesc ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {effectiveGroup === "spirits"
                ? (lang === "zh" ? "桶型与陈年工艺" : "Cask & Aging")
                : effectiveGroup === "bottles"
                  ? (lang === "zh" ? "甜度与口感描述" : "Sweetness & Taste")
                  : (lang === "zh" ? "风格描述" : "Style Description")}
            </Text>
            <View className="bg-surface rounded-xl px-4 py-3">
              <Text className="text-[15px] text-foreground" style={{ lineHeight: 24 }} selectable>
                {bottle.styleDesc}
              </Text>
            </View>
          </>
        ) : null}

        {/* 深度资料：蒸馏厂 / 搭配 / 用途 / 季节 */}
        {/* 基酒库深度资料：蒸馏厂/可替代/搭配 */}
        {effectiveGroup === "spirits" && (bottle.distilleryInfo || bottle.substituteFor || bottle.pairsWith) ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "蒸馏厂与工艺" : "Distillery & Craft"}
            </Text>
            <View className="bg-surface rounded-xl px-4">
              {[
                bottle.distilleryInfo && { label: lang === "zh" ? "蒸馏厂与工艺" : "Distillery & Craft", value: bottle.distilleryInfo },
                bottle.substituteFor && { label: lang === "zh" ? "可替代酒款" : "Substitute For", value: bottle.substituteFor },
                bottle.pairsWith && { label: lang === "zh" ? "搭配使用的酒款" : "Pairs Well With", value: bottle.pairsWith },
              ].filter(Boolean).map((row, idx, arr) => row && (
                <View
                  key={row.label}
                  style={idx < arr.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 12 } : { paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: 4, letterSpacing: 0.3 }}>
                    {row.label.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 22 }} selectable>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* 酒款库深度资料：调酒用途/搭配建议/可替代/搭配酒款 */}
        {effectiveGroup === "bottles" && (bottle.usageNotes || bottle.pairingNotes || bottle.substituteFor || bottle.pairsWith) ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "口感与调酒用途" : "Taste & Usage"}
            </Text>
            <View className="bg-surface rounded-xl px-4">
              {[
                bottle.usageNotes && { label: lang === "zh" ? "调酒用途" : "Cocktail Usage", value: bottle.usageNotes },
                bottle.pairingNotes && { label: lang === "zh" ? "搭配建议" : "Pairing Notes", value: bottle.pairingNotes },
                bottle.substituteFor && { label: lang === "zh" ? "可替代酒款" : "Substitute For", value: bottle.substituteFor },
                bottle.pairsWith && { label: lang === "zh" ? "搭配使用的酒款" : "Pairs Well With", value: bottle.pairsWith },
              ].filter(Boolean).map((row, idx, arr) => row && (
                <View
                  key={row.label}
                  style={idx < arr.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 12 } : { paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: 4, letterSpacing: 0.3 }}>
                    {row.label.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 22 }} selectable>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* 原材料库/软饮库深度资料：调酒用途/季节性 */}
        {(effectiveGroup === "materials" || effectiveGroup === "softdrinks") && (bottle.usageNotes || bottle.seasonality) ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "调酒用途" : "Usage Notes"}
            </Text>
            <View className="bg-surface rounded-xl px-4">
              {[
                bottle.usageNotes && { label: lang === "zh" ? "调酒用途" : "Usage Notes", value: bottle.usageNotes },
                bottle.seasonality && { label: lang === "zh" ? "季节性" : "Seasonality", value: bottle.seasonality },
              ].filter(Boolean).map((row, idx, arr) => row && (
                <View
                  key={row.label}
                  style={idx < arr.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, paddingVertical: 12 } : { paddingVertical: 12 }}
                >
                  <Text style={{ fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: 4, letterSpacing: 0.3 }}>
                    {row.label.toUpperCase()}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.foreground, lineHeight: 22 }} selectable>
                    {row.value}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* 双语描述：英文简介 / 英文故事（国际场合使用） */}
        {(bottle.notesEn || bottle.storyEn) ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={{ letterSpacing: 0.4, lineHeight: 18 }}>
              {lang === "zh" ? "英文描述（国际场合）" : "English Description"}
            </Text>
            <View className="bg-surface rounded-xl px-4">
              {[
                bottle.notesEn && { label: lang === "zh" ? "英文简介" : "EN Notes", value: bottle.notesEn },
                bottle.storyEn && { label: lang === "zh" ? "英文故事" : "EN Story", value: bottle.storyEn },
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



        {supplierChannels.length === 0 ? (
          <Text className="text-xs text-muted mt-4 px-1" style={{ lineHeight: 18 }}>
            {t("bottle.priceNote")}
          </Text>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}
