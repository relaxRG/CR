import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import {
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenContainer } from "@/components/screen-container";
import { StarRating } from "@/components/star-rating";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useNetwork } from "@/hooks/use-network";
import { useI18n } from "@/lib/i18n";
import { displayNames } from "@/lib/utils";
import { formatAmountAsMl } from "@/lib/bottles/cost";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import { estimateGarnishCost } from "@/lib/recipes/garnish-split";
import { buildAutoAddDrafts } from "@/lib/recipes/auto-add";
import { parseSource } from "@/lib/recipes/source-parse";
import { useIceSettings } from "@/lib/ice/store";
import { estimateIceCost } from "@/lib/ice/cost";
import { analyzeStructure, structuralFormula } from "@/lib/recipes/structure";
import { VariantBadge } from "@/components/variant-badge";
import { CodexFamilyBadge } from "@/components/codex-family-badge";
import { LabOriginBadge } from "@/components/lab-origin-badge";
import {
  garnishDisplayText,
  ingredientDisplayName,
  stepsDisplayText,
} from "@/lib/recipes/ingredient-display";
import { useBottleStore } from "@/lib/bottles/store";
import {
  applyEnrichedToBottle,
  enrichQueryName,
  matchEnrichedItem,
} from "@/lib/bottles/enrich";
import { type Bottle } from "@/lib/bottles/types";
import { useHomemadeStore } from "@/lib/homemade/store";
import { trpc } from "@/lib/trpc";
import { smartLinkIngredient, smartLinkDisplayName } from "@/lib/recipes/smart-link";
import { useRecipeStore } from "@/lib/recipes/store";
import { useMenuStore } from "@/lib/menu/store";
import {
  STRENGTH_LABELS,
  STRENGTH_BAND_LABELS,
  codexFamilyLabel,
  localizedTagName,
} from "@/lib/recipes/types";

export default function RecipeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n();
  const { getRecipe, getCategory, toggleFavorite, toggleMade, setRating, deleteRecipe, tags } =
    useRecipeStore();
  const { bottles, addBottle, updateBottle } = useBottleStore();
  const { preps } = useHomemadeStore();
  const recipe = getRecipe(id);
  const { groups, addEntry } = useMenuStore();
  const [menuModalVisible, setMenuModalVisible] = React.useState(false);

  // 联网补全:零价空壳条目(多为自动添加)→ LLM 知识补全资料并更新入库
  const enrichMutation = trpc.lookup.enrich.useMutation();
  const { isOnline } = useNetwork();
  const [enrichMsg, setEnrichMsg] = React.useState<string | null>(null);

  // 缺失原材料自动入库:成本估算发现装饰/配料在库中无匹配时,智能归类后即时添加(每配方一次)
  const autoAddedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!recipe || autoAddedRef.current === recipe.id) return;
    const names: string[] = [];
    if (recipe.garnish) {
      names.push(...estimateGarnishCost(recipe.garnish, bottles, preps).unmatchedNames);
    }
    for (const ing of recipe.ingredients) {
      if (!smartLinkIngredient(ing.name, bottles, preps)) names.push(ing.name);
    }
    if (names.length === 0) {
      autoAddedRef.current = recipe.id;
      return;
    }
    const drafts = buildAutoAddDrafts(names, bottles, preps);
    if (drafts.length > 0) {
      for (const d of drafts) addBottle(d);
    }
    autoAddedRef.current = recipe.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe?.id, recipe?.garnish, bottles.length]);

  if (!recipe) {
    return (
      <ScreenContainer className="items-center justify-center px-8">
        <Text className="text-base text-muted">{t("detail.notFound")}</Text>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <Text className="text-base mt-3" style={{ color: colors.primary }}>
            {t("common.back")}
          </Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  const category = getCategory(recipe.categoryId);
  const tagLabel = (kind: string, name: string) => {
    if (!name) return name;
    const hit = tags.find((tg) => tg.kind === kind && tg.name === name);
    return hit ? displayNames(hit.nameEn ?? "", hit.name, lang).primary : name;
  };
  // Smart cost: same 5-level matching as ingredient linking (bottles + homemade preps)
  const costEst = estimateRecipeCostSmart(recipe.ingredients, bottles, preps);
  const { ice: iceSettings } = useIceSettings();
  const iceCost = estimateIceCost(recipe.method, recipe.ice, iceSettings);
  // 装饰成本:连接词智能拆分(「或」取高、「与/及」累加),形态折叠计价
  const garnishCost = recipe.garnish
    ? estimateGarnishCost(recipe.garnish, bottles, preps)
    : null;
  const grandTotal = costEst.total + iceCost.total + (garnishCost?.total ?? 0);

  // 本配方链接到的零价酒款(缺失资料,可联网补全)
  const missingBottles: Bottle[] = [];
  {
    const seen = new Set<string>();
    const consider = (link: ReturnType<typeof smartLinkIngredient>) => {
      if (link?.kind === "bottle" && link.bottle.priceCny <= 0 && !seen.has(link.bottle.id)) {
        seen.add(link.bottle.id);
        missingBottles.push(link.bottle);
      }
    };
    for (const it of costEst.items) consider(it.link);
    if (garnishCost) {
      for (const g of garnishCost.groups) for (const it of g.items) consider(it.est.link);
    }
  }

  const handleEnrichMissing = async () => {
    const targets = missingBottles.slice(0, 8);
    if (targets.length === 0 || enrichMutation.isPending) return;
    if (!isOnline) {
      setEnrichMsg(t("offline.aiUnavailable"));
      return;
    }
    setEnrichMsg(null);
    const names = targets.map(enrichQueryName);
    try {
      const res = await enrichMutation.mutateAsync({ names });
      let updated = 0;
      targets.forEach((b, i) => {
        const item = matchEnrichedItem(res.items, names, i);
        if (!item) return;
        const draft = applyEnrichedToBottle(b, item);
        if (!draft) return;
        updateBottle(b.id, draft);
        updated++;
      });
      if (updated > 0 && Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setEnrichMsg(updated > 0 ? t("lookup.enrichDone") : t("lookup.enrichNone"));
    } catch {
      setEnrichMsg(t("smartImport.fail.msg"));
    }
  };

  const handleFavorite = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    toggleFavorite(recipe.id);
  };

  const handleMade = () => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    toggleMade(recipe.id);
  };

  const confirmDelete = () => {
    const delName = displayNames(recipe.nameEn, recipe.name, lang).primary;
    const doDelete = () => {
      deleteRecipe(recipe.id);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      router.back();
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && window.confirm(t("detail.delete.msg", { name: delName }))) {
        doDelete();
      }
      return;
    }
    Alert.alert(t("detail.delete.title"), t("detail.delete.msg", { name: delName }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: doDelete },
    ]);
  };

  const metaItems = [
    { label: t("detail.meta.spirit"), value: tagLabel("spirit", recipe.baseSpirit) },
    { label: t("detail.meta.glass"), value: tagLabel("glass", recipe.glass) || "—" },
    {
      label: t("detail.meta.method"),
      value: recipe.method ? localizedTagName(recipe.method, "", lang) : "—",
    },
    ...(recipe.ice
      ? [{ label: t("detail.meta.ice"), value: localizedTagName(recipe.ice, "", lang) }]
      : []),
    {
      label: t("detail.meta.strength"),
      value:
        recipe.abv !== null && recipe.abv !== undefined
          ? `${STRENGTH_LABELS[recipe.strength]} ≈${recipe.abv}%`
          : recipe.strengthBand
            ? `${STRENGTH_LABELS[recipe.strength]} · ${STRENGTH_BAND_LABELS[recipe.strengthBand][lang]}`
            : STRENGTH_LABELS[recipe.strength],
    },
  ];

  return (
    <>
    <ScreenContainer>
      {/* Header bar */}
      <View className="flex-row items-center justify-between px-4 py-1">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={26} color={colors.foreground} />
        </Pressable>
        <View className="flex-row items-center" style={{ gap: 18 }}>
          <Pressable
            onPress={handleMade}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol
              name={recipe.made ? "checkmark.circle.fill" : "checkmark.circle"}
              size={24}
              color={recipe.made ? colors.success : colors.muted}
            />
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setMenuModalVisible(true);
            }}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="storefront.fill" size={22} color={colors.muted} />
          </Pressable>
          <Pressable
            onPress={handleFavorite}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol
              name={recipe.favorite ? "star.fill" : "star"}
              size={24}
              color={recipe.favorite ? colors.primary : colors.muted}
            />
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: "/recipe-form", params: { id: recipe.id } })}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="pencil" size={23} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={confirmDelete}
            hitSlop={8}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <IconSymbol name="trash.fill" size={22} color={colors.error} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 + insets.bottom }}>
        {(() => {
          const dn = displayNames(recipe.nameEn, recipe.name, lang);
          return (
            <>
              <Text className="text-3xl font-bold text-foreground mt-2">{dn.primary}</Text>
              {dn.secondary ? (
                <Text className="text-base text-muted mt-1">{dn.secondary}</Text>
              ) : null}
            </>
          );
        })()}
        {(category || recipe.codexFamily || recipe.flavors.length > 0 || recipe.drinkDuration || recipe.occasion) ? (
          <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
            {category ? (
              <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: category.color + "22" }}>
                <Text className="text-xs font-medium" style={{ color: category.color }}>
                  {displayNames(category.nameEn ?? "", category.name, lang).primary}
                </Text>
              </View>
            ) : null}
            {recipe.codexFamily ? (
              <CodexFamilyBadge family={recipe.codexFamily} />
            ) : null}
            {recipe.drinkDuration ? (
              <View className="px-2.5 py-1 rounded-full bg-surface border border-border">
                <Text className="text-xs text-muted">{tagLabel("duration", recipe.drinkDuration)}</Text>
              </View>
            ) : null}
            {recipe.occasion ? (
              <View className="px-2.5 py-1 rounded-full bg-surface border border-border">
                <Text className="text-xs text-muted">{tagLabel("occasion", recipe.occasion)}</Text>
              </View>
            ) : null}
            {recipe.flavors.map((tag) => (
              <View
                key={tag}
                className="px-2.5 py-1 rounded-full bg-surface border border-border"
              >
                <Text className="text-xs text-muted">{tagLabel("flavor", tag)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {/* Variant of 经典标注:点按弹出完整谱系论证资料浮层 */}
        <VariantBadge recipe={recipe} mode="full" />
        {/* 源自研发项目回链:点按跳回项目迭代历史 */}
        <LabOriginBadge recipeId={recipe.id} />

        {/* Meta grid */}
        <View className="flex-row mt-5 bg-surface rounded-xl overflow-hidden">
          {metaItems.map((m, idx) => (
            <View
              key={m.label}
              className="flex-1 items-center py-3"
              style={idx > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border } : undefined}
            >
              <Text className="text-xs text-muted">{m.label}</Text>
              <Text className="text-sm font-medium text-foreground mt-1" numberOfLines={1}>
                {m.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Rating */}
        <View className="flex-row items-center justify-between bg-surface rounded-xl mt-3 px-4 py-3">
          <Text className="text-sm font-medium text-foreground">
            {t("rating.title")}
            {recipe.rating ? ` ${recipe.rating}/10` : ""}
          </Text>
          <StarRating
            value={recipe.rating}
            size={17}
            onChange={(v) => setRating(recipe.id, v)}
          />
        </View>

        {/* Ingredients */}
        <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.ingredients")}</Text>
        <View className="bg-surface rounded-xl px-4">
          {recipe.ingredients.length === 0 ? (
            <Text className="text-sm text-muted py-4">{t("detail.noIngredients")}</Text>
          ) : (
            recipe.ingredients.map((ing, idx) => (
              (() => {
                const link = smartLinkIngredient(ing.name, bottles, preps);
                const smart = smartLinkDisplayName(link, lang as "zh" | "en");
                const primaryName =
                  smart?.primary ?? ingredientDisplayName(ing.name, lang as "zh" | "en", bottles, preps);
                const inner = (
                  <View
                    className="flex-row items-center justify-between py-3"
                    style={
                      idx > 0
                        ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }
                        : undefined
                    }
                  >
                    <View className="flex-1 pr-3">
                      <View className="flex-row items-center" style={{ gap: 5 }}>
                        <Text
                          className="text-base"
                          style={{ color: link ? colors.primary : colors.foreground, flexShrink: 1 }}
                        >
                          {primaryName}
                        </Text>
                        {link ? (
                          <IconSymbol
                            name={link.kind === "prep" ? "sparkles" : "chevron.right"}
                            size={link.kind === "prep" ? 12 : 11}
                            color={colors.primary}
                          />
                        ) : null}
                      </View>
                      {smart?.secondary ? (
                        <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                          {smart.secondary}
                        </Text>
                      ) : null}
                    </View>
                    <Text className="text-base text-muted">{formatAmountAsMl(ing.amount)}</Text>
                  </View>
                );
                return link ? (
                  <Pressable
                    key={ing.id}
                    onPress={() =>
                      link.kind === "prep"
                        ? router.push({ pathname: "/homemade/[id]", params: { id: link.prep.id } })
                        : router.push({ pathname: "/bottle/[id]", params: { id: link.bottle.id } })
                    }
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    {inner}
                  </Pressable>
                ) : (
                  <View key={ing.id}>{inner}</View>
                );
              })()
            ))
          )}
        </View>

        {/* Steps */}
        {recipe.steps ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.steps")}</Text>
            <View className="bg-surface rounded-xl p-4">
              <Text className="text-base text-foreground leading-relaxed">
                {stepsDisplayText(recipe.steps, lang as "zh" | "en")}
              </Text>
            </View>
          </>
        ) : null}

        {/* Garnish */}
        {recipe.garnish ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.garnish")}</Text>
            <View className="bg-surface rounded-xl p-4">
              <Text className="text-base text-foreground">
                {garnishDisplayText(recipe.garnish, lang as "zh" | "en", bottles, preps)}
              </Text>
            </View>
          </>
        ) : null}

        {/* Structural formula (auto-analyzed, after steps & garnish) */}
        {recipe.ingredients.length > 0 ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>
              {t("detail.structure")}
            </Text>
            <View className="bg-surface rounded-xl p-4">
              <Text className="text-base text-foreground font-medium" style={{ lineHeight: 24 }}>
                {structuralFormula(recipe.ingredients, lang as "zh" | "en", formatAmountAsMl)}
              </Text>
              <View className="mt-3 pt-3 border-t border-border" style={{ gap: 6 }}>
                {analyzeStructure(recipe.ingredients).map((it) => (
                  <View key={it.ingredient.id} className="flex-row items-center justify-between">
                    <Text className="text-sm text-muted" numberOfLines={1}>
                      {lang === "en" ? it.label.en : it.label.zh}
                    </Text>
                    <Text className="text-sm text-foreground ml-2 flex-1 text-right" numberOfLines={1}>
                      {ingredientDisplayName(it.ingredient.name, lang as "zh" | "en")}
                    </Text>
                  </View>
                ))}
              </View>
              <Text className="text-xs text-muted mt-3" style={{ lineHeight: 16 }}>
                {t("detail.structure.hint")}
              </Text>
            </View>
          </>
        ) : null}

        {/* Flavor description */}
        {recipe.flavorDesc ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.flavorDesc")}</Text>
            <View className="bg-surface rounded-xl p-4">
              <Text className="text-base text-foreground leading-relaxed">{recipe.flavorDesc}</Text>
            </View>
          </>
        ) : null}

        {/* Notes */}
        {recipe.notes ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.notes")}</Text>
            <View
              className="rounded-xl p-4"
              style={{ backgroundColor: colors.primary + "14" }}
            >
              <Text className="text-base text-foreground leading-relaxed">{recipe.notes}</Text>
            </View>
          </>
        ) : null}

        {/* Story */}
        {recipe.story ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.story")}</Text>
            <View className="bg-surface rounded-xl p-4">
              <Text className="text-base text-foreground leading-relaxed">{recipe.story}</Text>
            </View>
          </>
        ) : null}

        {/* Source */}
        {recipe.source ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.source")}</Text>
            <View className="bg-surface rounded-xl p-4">
              {(() => {
                const ps = parseSource(recipe.source);
                const rows = [
                  { label: t("detail.source.venue"), value: ps.venue },
                  { label: t("detail.source.creator"), value: ps.creator },
                  { label: t("detail.source.season"), value: ps.season },
                  { label: t("detail.source.year"), value: ps.year },
                ].filter((r) => r.value);
                if (rows.length === 0) {
                  return <Text className="text-sm text-muted leading-relaxed">{recipe.source}</Text>;
                }
                return (
                  <View style={{ gap: 8 }}>
                    {rows.map((r) => (
                      <View key={r.label} className="flex-row items-start justify-between">
                        <Text className="text-sm text-muted" style={{ width: 110 }}>
                          {r.label}
                        </Text>
                        <Text className="text-sm text-foreground flex-1 text-right" style={{ lineHeight: 19 }}>
                          {r.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
          </>
        ) : null}

        {/* Cost estimate — kept last per information hierarchy */}
        {recipe.ingredients.length > 0 ? (
          <>
            <Text className="text-[13px] text-muted uppercase mt-6 mb-2 px-4" style={styles.groupHeader}>{t("detail.cost")}</Text>
            <View className="bg-surface rounded-xl px-4 pb-1">
              <View
                className="flex-row items-center justify-between py-3.5"
                style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
              >
                <Text className="text-sm text-muted">
                  {t("detail.cost.total", { a: costEst.estimatedCount, b: costEst.totalCount })}
                </Text>
                <Text className="text-xl font-bold" style={{ color: colors.primary }}>
                  {costEst.estimatedCount > 0 || iceCost.total > 0 || (garnishCost?.total ?? 0) > 0
                    ? `¥${grandTotal.toFixed(1)}`
                    : "—"}
                </Text>
              </View>
              {missingBottles.length > 0 ? (
                <Pressable
                  onPress={handleEnrichMissing}
                  disabled={enrichMutation.isPending}
                  style={({ pressed }) => [
                    {
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      paddingVertical: 9,
                      borderRadius: 9,
                      marginTop: 10,
                      backgroundColor: colors.primary + "14",
                    },
                    (pressed || enrichMutation.isPending) && { opacity: 0.6 },
                  ]}
                >
                  {enrichMutation.isPending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <IconSymbol name="globe" size={14} color={colors.primary} />
                  )}
                  <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
                    {t("lookup.enrichMissing")} ({missingBottles.length})
                  </Text>
                </Pressable>
              ) : null}
              {enrichMsg ? (
                <Text className="text-xs text-muted mt-1.5 text-center">{enrichMsg}</Text>
              ) : null}
              {costEst.items.map((item, idx) => {
                const cLink = item.link;
                const cSmart = smartLinkDisplayName(cLink, lang as "zh" | "en");
                const cName =
                  cSmart?.primary ??
                  ingredientDisplayName(item.ingredient.name, lang as "zh" | "en", bottles, preps);
                const linkedBottle = cLink?.kind === "bottle" ? cLink.bottle : null;
                const linkedPrep = cLink?.kind === "prep" ? cLink.prep : null;
                const row = (
                <View
                  className="flex-row items-center justify-between py-2.5"
                  style={
                    idx > 0
                      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }
                      : undefined
                  }
                >
                  <View className="flex-1 pr-3">
                    <View className="flex-row items-center" style={{ gap: 4 }}>
                      <Text
                        className="text-sm"
                        numberOfLines={1}
                        style={{ color: cLink ? colors.primary : colors.foreground, flexShrink: 1 }}
                      >
                        {cName}
                      </Text>
                      {cLink ? (
                        <IconSymbol name="chevron.right" size={10} color={colors.primary} />
                      ) : null}
                    </View>
                    {linkedBottle && item.cost !== null ? (
                      <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                        {item.wholeBottle
                          ? `${displayNames(linkedBottle.nameEn, linkedBottle.nameZh, lang).primary} ${t("detail.cost.wholeBottle", { p: String(linkedBottle.priceCny), v: linkedBottle.volume })}`
                          : `${displayNames(linkedBottle.nameEn, linkedBottle.nameZh, lang).primary} ¥${linkedBottle.priceCny}/${linkedBottle.volume} × ${item.amountMl?.toFixed(0)}ml`}
                      </Text>
                    ) : linkedPrep && item.cost !== null ? (
                      <Text className="text-xs mt-0.5" numberOfLines={1} style={{ color: colors.primary }}>
                        {t("detail.cost.homemade", {
                          name: displayNames(linkedPrep.name, linkedPrep.nameAlt, lang).primary,
                          p: item.amountMl && item.amountMl > 0 ? ((item.cost / item.amountMl) * 30).toFixed(1) : item.cost.toFixed(1),
                        })}
                      </Text>
                    ) : (
                      <Text className="text-xs text-muted mt-0.5">
                        {item.reason === "no_match"
                          ? t("detail.cost.noBottle")
                          : item.reason === "no_amount"
                            ? t("detail.cost.noAmount")
                            : item.reason === "no_price"
                              ? t("detail.cost.noPrice")
                              : t("detail.cost.noVolume")}
                      </Text>
                    )}
                  </View>
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: item.cost !== null ? colors.foreground : colors.muted }}
                  >
                    {item.cost !== null ? `¥${item.cost.toFixed(1)}` : "—"}
                  </Text>
                </View>
                );
                return cLink ? (
                  <Pressable
                    key={item.ingredient.id}
                    onPress={() =>
                      cLink.kind === "prep"
                        ? router.push({ pathname: "/homemade/[id]", params: { id: cLink.prep.id } })
                        : router.push({ pathname: "/bottle/[id]", params: { id: cLink.bottle.id } })
                    }
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    {row}
                  </Pressable>
                ) : (
                  <View key={item.ingredient.id}>{row}</View>
                );
              })}
              {garnishCost && garnishCost.groups.length > 0
                ? garnishCost.groups.flatMap((g, gi) =>
                    g.items.map((it, ii) => {
                      const isOr = g.group.mode === "or";
                      const counted = isOr ? it.chosen : it.est.cost !== null;
                      const gLink = it.est.link;
                      const gSmart = smartLinkDisplayName(gLink, lang as "zh" | "en");
                      const gName =
                        gSmart?.primary ??
                        ingredientDisplayName(it.part.name, lang as "zh" | "en", bottles, preps);
                      const fi = it.est.formInfo;
                      const gBottle = gLink?.kind === "bottle" ? gLink.bottle : null;
                      const inner = (
                        <View
                          className="flex-row items-center justify-between py-2.5"
                          style={{
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: colors.border,
                            opacity: isOr && !it.chosen ? 0.55 : 1,
                          }}
                        >
                          <View className="flex-1 pr-3">
                            <View className="flex-row items-center" style={{ gap: 4 }}>
                              <Text
                                className="text-[11px] px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: colors.surface, color: colors.muted, overflow: "hidden" }}
                              >
                                {t("detail.cost.garnish")}
                              </Text>
                              <Text
                                className="text-sm"
                                numberOfLines={1}
                                style={{ color: gLink ? colors.primary : colors.foreground, flexShrink: 1 }}
                              >
                                {it.part.amount ? `${it.part.amount} ` : ""}
                                {gName}
                              </Text>
                              {gLink ? (
                                <IconSymbol name="chevron.right" size={10} color={colors.primary} />
                              ) : null}
                            </View>
                            {fi && gBottle ? (
                              <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                                {t("detail.cost.form", {
                                  name: displayNames(gBottle.nameEn, gBottle.nameZh, lang).primary,
                                  p: fi.piecePrice.toFixed(2),
                                  f: fi.factor < 1 ? `1/${Math.round(1 / fi.factor)}` : String(fi.factor),
                                  c: String(fi.count),
                                })}
                              </Text>
                            ) : null}
                            {isOr ? (
                              <Text
                                className="text-xs mt-0.5"
                                style={{ color: it.chosen ? colors.warning : colors.muted }}
                              >
                                {it.chosen
                                  ? t("detail.cost.garnish.orChosen")
                                  : t("detail.cost.garnish.orSkipped")}
                              </Text>
                            ) : !gLink ? (
                              <Text className="text-xs text-muted mt-0.5">
                                {t("detail.cost.autoAdded")}
                              </Text>
                            ) : it.est.cost === null ? (
                              <Text className="text-xs text-muted mt-0.5">
                                {it.est.reason === "no_price"
                                  ? t("detail.cost.noPrice")
                                  : it.est.reason === "no_amount"
                                    ? t("detail.cost.noAmount")
                                    : t("detail.cost.noVolume")}
                              </Text>
                            ) : null}
                          </View>
                          <Text
                            className="text-sm font-semibold"
                            style={{
                              color:
                                it.est.cost !== null && counted ? colors.foreground : colors.muted,
                              textDecorationLine: isOr && !it.chosen ? "line-through" : "none",
                            }}
                          >
                            {it.est.cost !== null ? `¥${it.est.cost.toFixed(1)}` : "—"}
                          </Text>
                        </View>
                      );
                      const key = `garnish-${gi}-${ii}`;
                      return gLink ? (
                        <Pressable
                          key={key}
                          onPress={() =>
                            gLink.kind === "prep"
                              ? router.push({ pathname: "/homemade/[id]", params: { id: gLink.prep.id } })
                              : router.push({ pathname: "/bottle/[id]", params: { id: gLink.bottle.id } })
                          }
                          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                        >
                          {inner}
                        </Pressable>
                      ) : (
                        <View key={key}>{inner}</View>
                      );
                    }),
                  )
                : null}
              {iceCost.items.map((it, idx2) => (
                <Pressable
                  key={`ice-${it.use}-${idx2}`}
                  onPress={() => router.push("/ice-settings")}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <View
                    className="flex-row items-center justify-between py-2.5"
                    style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
                  >
                    <View className="flex-1 pr-3">
                      <View className="flex-row items-center" style={{ gap: 4 }}>
                        <Text className="text-sm" numberOfLines={1} style={{ color: colors.primary }}>
                          {displayNames(it.kind.nameEn, it.kind.nameZh, lang).primary}
                        </Text>
                        <IconSymbol name="chevron.right" size={10} color={colors.primary} />
                      </View>
                      <Text className="text-xs text-muted mt-0.5" numberOfLines={1}>
                        {t(
                          it.use === "shake"
                            ? "detail.cost.ice.shake"
                            : it.use === "stir"
                              ? "detail.cost.ice.stir"
                              : "detail.cost.ice.serve",
                        )}
                      </Text>
                    </View>
                    <Text className="text-sm font-semibold text-foreground">¥{it.cost.toFixed(1)}</Text>
                  </View>
                </Pressable>
              ))}
              <Text className="text-[11px] text-muted py-2.5" style={{ lineHeight: 15 }}>
                {t("detail.cost.note")}
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </ScreenContainer>
    {/* 门店酒单分组选择 Modal */}
      {menuModalVisible && (
        <Modal
          transparent
          animationType="slide"
          visible={menuModalVisible}
          onRequestClose={() => setMenuModalVisible(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)" }}
            onPress={() => setMenuModalVisible(false)}
          />
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: insets.bottom + 16,
              paddingTop: 16,
              paddingHorizontal: 20,
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              maxHeight: 420,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.foreground, marginBottom: 4 }}>
              {lang === "en" ? "Add to Store Menu" : "加入门店酒单"}
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 16 }}>
              {lang === "en" ? "Select a group" : "选择分组"}
            </Text>
            {groups.length === 0 ? (
              <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 20 }}>
                {lang === "en" ? "No groups yet. Create one in Store Menu." : "暂无分组，请先在门店酒单中创建分组。"}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 280 }}>
                {groups.map((g) => {
                  const alreadyIn = g.entries.some((e) => e.recipeId === recipe.id);
                  return (
                    <Pressable
                      key={g.id}
                      onPress={() => {
                        if (alreadyIn) return;
                        addEntry(g.id, recipe.id);
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        setMenuModalVisible(false);
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        paddingVertical: 14,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                        borderBottomColor: colors.border,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <View>
                        <Text style={{ fontSize: 15, color: colors.foreground }}>{g.name}</Text>
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                          {g.entries.length} {lang === "en" ? "drinks" : "款"}
                        </Text>
                      </View>
                      {alreadyIn ? (
                        <IconSymbol name="checkmark.circle.fill" size={20} color={colors.success} />
                      ) : (
                        <IconSymbol name="plus.circle" size={20} color={colors.primary} />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  groupHeader: {
    letterSpacing: 0.4,
    lineHeight: 18,
  },
});
