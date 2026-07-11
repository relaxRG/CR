import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  Modal,
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
import { IconSymbol } from "@/components/ui/icon-symbol";
import { LabChangeChips } from "@/components/lab-change-chips";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useLabStore } from "@/lib/lab/store";
import { getLabTemplate } from "@/lib/lab/templates";
import { LabBatch, LabVerdict } from "@/lib/lab/types";
import { useBottleStore } from "@/lib/bottles/store";
import { useHomemadeStore } from "@/lib/homemade/store";
import { useRecipeStore } from "@/lib/recipes/store";
import { estimateRecipeAbv } from "@/lib/recipes/abv";
import { estimateRecipeCostSmart } from "@/lib/recipes/smart-cost";
import { inferBaseSpiritFromIngredients } from "@/lib/recipes/parser";
import { inferCodexFamily } from "@/lib/recipes/lineage";

const VERDICT_META: Record<Exclude<LabVerdict, "">, { color: string; icon: "checkmark.circle.fill" | "arrow.triangle.2.circlepath" | "xmark.circle.fill" }> = {
  keeper: { color: "#22C55E", icon: "checkmark.circle.fill" },
  iterate: { color: "#3B82F6", icon: "arrow.triangle.2.circlepath" },
  reject: { color: "#EF4444", icon: "xmark.circle.fill" },
};

export default function LabProjectScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const {
    getProject,
    batchesOf,
    deleteProject,
    deleteBatch,
    setProjectStatus,
    markFinalized,
  } = useLabStore();
  const { bottles } = useBottleStore();
  const { preps } = useHomemadeStore();
  const { addRecipe, getRecipe } = useRecipeStore();

  const project = getProject(params.id);
  const batches = batchesOf(params.id);
  const [tplSheetOpen, setTplSheetOpen] = useState(false);
  const [compareSel, setCompareSel] = useState<string[] | null>(null);

  const tpl = project?.templateId ? getLabTemplate(project.templateId) : undefined;
  const baseRecipe = project?.baseRecipeId ? getRecipe(project.baseRecipeId) : undefined;
  const finalRecipe = project?.finalizedRecipeId ? getRecipe(project.finalizedRecipeId) : undefined;

  /** 每批次自动指标 */
  const metrics = useMemo(() => {
    const map = new Map<string, { abv: number | null; cost: number | null }>();
    for (const b of batches) {
      const abv = estimateRecipeAbv(b.spec.ingredients, b.spec.method, bottles, preps);
      const cost = estimateRecipeCostSmart(b.spec.ingredients, bottles, preps);
      map.set(b.id, {
        abv: abv.abv,
        cost: cost.estimatedCount > 0 ? cost.total : null,
      });
    }
    return map;
  }, [batches, bottles, preps]);

  if (!project) {
    return (
      <ScreenContainer className="items-center justify-center">
        <Text className="text-base text-muted">{t("detail.notFound")}</Text>
      </ScreenContainer>
    );
  }

  const toggleCompare = (batchId: string) => {
    setCompareSel((sel) => {
      if (!sel) return sel;
      if (sel.includes(batchId)) return sel.filter((x) => x !== batchId);
      if (sel.length >= 4) return sel;
      return [...sel, batchId];
    });
  };

  const handleFinalize = (batch: LabBatch) => {
    Alert.alert(t("lab.finalize"), t("lab.finalize.confirm", { n: batch.seq }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("lab.finalize"),
        onPress: () => {
          const ings = batch.spec.ingredients.filter((i) => i.name.trim());
          const abvEst = estimateRecipeAbv(ings, batch.spec.method, bottles, preps);
          const baseSpirit = inferBaseSpiritFromIngredients(ings);
          const codex = inferCodexFamily({
            name: project.name,
            nameEn: "",
            ingredients: ings,
            method: batch.spec.method,
            baseSpirit,
            glass: batch.spec.glass,
          });
          const recipe = addRecipe({
            name: project.name,
            nameEn: "",
            categoryId: null,
            baseSpirit,
            glass: batch.spec.glass,
            method: batch.spec.method,
            ice: batch.spec.ice,
            strength: abvEst.strength ?? "medium",
            strengthBand: abvEst.band ?? "",
            abv: abvEst.abv,
            rating: batch.score,
            variantOf: "",
            codexFamily: codex ?? "",
            flavors: [],
            source: t("lab.recipe.sourceNote", { name: project.name }),
            story: project.goal,
            flavorDesc: batch.tastingNote,
            ingredients: ings,
            steps: "",
            garnish: batch.spec.garnish,
            notes: "",
          });
          markFinalized(project.id, recipe.id);
          if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          Alert.alert(t("lab.finalize.done"), "", [
            {
              text: t("lab.finalize.view"),
              onPress: () =>
                router.push({ pathname: "/recipe/[id]", params: { id: recipe.id } }),
            },
            { text: t("common.back"), style: "cancel" },
          ]);
        },
      },
    ]);
  };

  const handleDeleteProject = () => {
    Alert.alert(
      t("lab.delete.project"),
      t("lab.delete.project.confirm", { name: project.name, n: batches.length }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            deleteProject(project.id);
            router.back();
          },
        },
      ],
    );
  };

  const statusLabel = t(`lab.status.${project.status}` as "lab.status.testing");

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      {/* Header */}
      <View className="px-5 pt-2 pb-2 flex-row items-center" style={{ gap: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <IconSymbol name="chevron.left" size={26} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text className="text-xl font-bold text-foreground" numberOfLines={1} style={{ lineHeight: 26 }}>
            {project.name}
          </Text>
        </View>
        <Pressable onPress={handleDeleteProject} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <IconSymbol name="trash.fill" size={18} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 + insets.bottom }}>
        {/* 状态与目标 */}
        <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
          <View
            className="rounded-md px-2"
            style={{ backgroundColor: colors.primary + "1A", paddingVertical: 3 }}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.primary, lineHeight: 16 }}>
              {statusLabel}
            </Text>
          </View>
          {tpl ? (
            <Pressable
              onPress={() => setTplSheetOpen(true)}
              style={({ pressed }) => [
                styles.tplBadge,
                { borderColor: colors.border, backgroundColor: colors.surface },
                pressed && { opacity: 0.7 },
              ]}
            >
              <IconSymbol name="book.fill" size={12} color={colors.muted} />
              <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                {lang === "en" ? tpl.name.en : tpl.name.zh}
              </Text>
              <IconSymbol name="chevron.right" size={10} color={colors.muted} />
            </Pressable>
          ) : null}
          {baseRecipe ? (
            <Pressable
              onPress={() => router.push({ pathname: "/recipe/[id]", params: { id: baseRecipe.id } })}
              style={({ pressed }) => [
                styles.tplBadge,
                { borderColor: colors.border, backgroundColor: colors.surface },
                pressed && { opacity: 0.7 },
              ]}
            >
              <IconSymbol name="link" size={12} color={colors.muted} />
              <Text className="text-xs text-muted" style={{ lineHeight: 16 }} numberOfLines={1}>
                {baseRecipe.name}
              </Text>
            </Pressable>
          ) : null}
          {finalRecipe ? (
            <Pressable
              onPress={() => router.push({ pathname: "/recipe/[id]", params: { id: finalRecipe.id } })}
              style={({ pressed }) => [
                styles.tplBadge,
                { borderColor: "#22C55E55", backgroundColor: "#22C55E14" },
                pressed && { opacity: 0.7 },
              ]}
            >
              <IconSymbol name="checkmark.circle.fill" size={12} color="#22C55E" />
              <Text className="text-xs font-medium" style={{ color: "#22C55E", lineHeight: 16 }}>
                {t("lab.finalized.badge")}
              </Text>
              <IconSymbol name="chevron.right" size={10} color="#22C55E" />
            </Pressable>
          ) : null}
        </View>
        {project.goal ? (
          <View className="mt-3 bg-surface border border-border rounded-xl px-3.5 py-3">
            <Text className="text-xs font-medium text-muted mb-1" style={{ lineHeight: 16 }}>
              {t("lab.goal")}
            </Text>
            <Text className="text-sm text-foreground" style={{ lineHeight: 20 }}>
              {project.goal}
            </Text>
          </View>
        ) : null}

        {/* 时间线标题与操作 */}
        <View className="flex-row items-center mt-6 mb-2" style={{ gap: 8 }}>
          <Text className="text-lg font-bold text-foreground" style={{ flex: 1 }}>
            {t("lab.timeline")}
          </Text>
          {batches.length >= 2 ? (
            <Pressable
              onPress={() => {
                if (compareSel) {
                  setCompareSel(null);
                } else {
                  setCompareSel(batches.slice(-2).map((b) => b.id));
                }
              }}
              style={({ pressed }) => [
                styles.compareBtn,
                {
                  backgroundColor: compareSel ? colors.primary : colors.surface,
                  borderColor: compareSel ? colors.primary : colors.border,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <IconSymbol
                name="rectangle.split.2x1"
                size={13}
                color={compareSel ? "#FFFFFF" : colors.muted}
              />
              <Text
                className="text-xs font-medium"
                style={{ color: compareSel ? "#FFFFFF" : colors.muted, lineHeight: 16 }}
              >
                {t("lab.compare")}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {compareSel ? (
          <Text className="text-xs text-muted mb-2" style={{ lineHeight: 16 }}>
            {t("lab.compare.hint")}
          </Text>
        ) : null}

        {/* 批次时间线(倒序:最新在上) */}
        {batches.length === 0 ? (
          <View className="items-center py-8" style={{ gap: 8 }}>
            <IconSymbol name="flask.fill" size={32} color={colors.muted} />
            <Text className="text-sm text-muted">{t("lab.noBatch")}</Text>
          </View>
        ) : (
          [...batches].reverse().map((b) => {
            const m = metrics.get(b.id);
            const verdict = b.verdict ? VERDICT_META[b.verdict] : null;
            const selected = compareSel?.includes(b.id) ?? false;
            return (
              <Pressable
                key={b.id}
                onPress={() => {
                  if (compareSel) {
                    toggleCompare(b.id);
                  } else {
                    router.push({
                      pathname: "/lab/batch-form",
                      params: { projectId: project.id, batchId: b.id },
                    });
                  }
                }}
                onLongPress={() => {
                  Alert.alert(`v${b.seq}`, "", [
                    {
                      text: t("lab.delete.batch"),
                      style: "destructive",
                      onPress: () =>
                        Alert.alert(
                          t("lab.delete.batch"),
                          t("lab.delete.batch.confirm", { n: b.seq }),
                          [
                            { text: t("common.cancel"), style: "cancel" },
                            {
                              text: t("common.delete"),
                              style: "destructive",
                              onPress: () => deleteBatch(b.id),
                            },
                          ],
                        ),
                    },
                    { text: t("common.cancel"), style: "cancel" },
                  ]);
                }}
                style={({ pressed }) => [
                  styles.batchCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: selected ? colors.primary : colors.border,
                    borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  {compareSel ? (
                    <IconSymbol
                      name={selected ? "checkmark.circle.fill" : "circle"}
                      size={18}
                      color={selected ? colors.primary : colors.muted}
                    />
                  ) : null}
                  <Text className="text-base font-bold" style={{ color: colors.primary, lineHeight: 22 }}>
                    v{b.seq}
                  </Text>
                  {b.score !== null ? (
                    <View className="flex-row items-center" style={{ gap: 3 }}>
                      <IconSymbol name="star.fill" size={13} color="#F59E0B" />
                      <Text className="text-sm font-semibold text-foreground" style={{ lineHeight: 18 }}>
                        {b.score}
                      </Text>
                    </View>
                  ) : null}
                  {verdict ? (
                    <View className="flex-row items-center" style={{ gap: 3 }}>
                      <IconSymbol name={verdict.icon} size={13} color={verdict.color} />
                      <Text className="text-xs font-medium" style={{ color: verdict.color, lineHeight: 16 }}>
                        {t(`lab.verdict.${b.verdict}` as "lab.verdict.keeper")}
                      </Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                    {new Date(b.createdAt).toLocaleDateString(lang === "en" ? "en-US" : "zh-CN", {
                      month: "numeric",
                      day: "numeric",
                    })}
                  </Text>
                </View>

                <View className="mt-2">
                  <LabChangeChips changes={b.changes} isBaseline={b.seq === 1} />
                </View>

                {/* 配料摘要 */}
                <Text className="text-xs text-muted mt-2" style={{ lineHeight: 17 }} numberOfLines={2}>
                  {b.spec.ingredients
                    .filter((i) => i.name.trim())
                    .map((i) => `${i.name}${i.amount ? ` ${i.amount}` : ""}`)
                    .join(" · ")}
                </Text>

                {/* 指标行 */}
                <View className="flex-row items-center mt-2" style={{ gap: 12 }}>
                  {m?.abv !== null && m?.abv !== undefined ? (
                    <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                      ≈{m.abv}% ABV
                    </Text>
                  ) : null}
                  {m?.cost !== null && m?.cost !== undefined ? (
                    <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                      ≈¥{m.cost.toFixed(1)}
                    </Text>
                  ) : null}
                  {b.tastingNote ? (
                    <Text
                      className="text-xs text-muted"
                      style={{ lineHeight: 16, flex: 1 }}
                      numberOfLines={1}
                    >
                      “{b.tastingNote}”
                    </Text>
                  ) : null}
                </View>

                {/* keeper 定稿按钮 */}
                {!compareSel && b.verdict === "keeper" && !project.finalizedRecipeId ? (
                  <Pressable
                    onPress={() => handleFinalize(b)}
                    style={({ pressed }) => [
                      styles.finalizeBtn,
                      { backgroundColor: "#22C55E" },
                      pressed && { transform: [{ scale: 0.97 }], opacity: 0.9 },
                    ]}
                  >
                    <IconSymbol name="checkmark.circle.fill" size={15} color="#FFFFFF" />
                    <Text className="text-sm font-semibold" style={{ color: "#FFFFFF", lineHeight: 18 }}>
                      {t("lab.finalize")}
                    </Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })
        )}

        {/* 归档/恢复 */}
        {batches.length > 0 ? (
          <Pressable
            onPress={() =>
              setProjectStatus(
                project.id,
                project.status === "archived"
                  ? batches.length > 0
                    ? "testing"
                    : "ideation"
                  : "archived",
              )
            }
            style={({ pressed }) => [styles.archiveBtn, pressed && { opacity: 0.6 }]}
          >
            <Text className="text-sm text-muted" style={{ lineHeight: 20 }}>
              {project.status === "archived" ? t("lab.unarchive") : t("lab.archive")}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* 底部主操作 */}
      <View
        className="px-5 pt-2"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        {compareSel ? (
          <Pressable
            disabled={compareSel.length < 2}
            onPress={() =>
              router.push({
                pathname: "/lab/compare",
                params: { projectId: project.id, ids: compareSel.join(",") },
              })
            }
            style={({ pressed }) => [
              styles.mainBtn,
              { backgroundColor: compareSel.length >= 2 ? colors.primary : colors.border },
              pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
            ]}
          >
            <Text className="text-base font-semibold" style={{ color: "#FFFFFF", lineHeight: 20 }}>
              {t("lab.compare.title")}
              {compareSel.length >= 2 ? ` (${compareSel.length})` : ""}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: "/lab/batch-form", params: { projectId: project.id } });
            }}
            style={({ pressed }) => [
              styles.mainBtn,
              { backgroundColor: colors.primary },
              pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
            ]}
          >
            <IconSymbol name="plus" size={18} color="#FFFFFF" />
            <Text className="text-base font-semibold" style={{ color: "#FFFFFF", lineHeight: 20 }}>
              {batches.length === 0 ? t("lab.batch.first") : t("lab.batch.new")}
            </Text>
          </Pressable>
        )}
      </View>

      {/* 框架指引浮层 */}
      <Modal
        visible={tplSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setTplSheetOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setTplSheetOpen(false)} />
        <View
          className="rounded-t-3xl"
          style={{
            backgroundColor: colors.background,
            maxHeight: "78%",
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <View className="items-center pt-2.5 pb-1">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          {tpl ? (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}>
              <Text className="text-xl font-bold text-foreground mt-1" style={{ lineHeight: 28 }}>
                {lang === "en" ? tpl.name.en : tpl.name.zh}
              </Text>
              <View
                className="mt-2 rounded-xl px-3.5 py-3"
                style={{ backgroundColor: colors.primary + "12" }}
              >
                <Text className="text-xs font-medium mb-0.5" style={{ color: colors.primary, lineHeight: 16 }}>
                  {t("lab.formula")}
                </Text>
                <Text className="text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
                  {lang === "en" ? tpl.formula.en : tpl.formula.zh}
                </Text>
              </View>
              <Text className="text-sm text-muted mt-2" style={{ lineHeight: 20 }}>
                {lang === "en" ? tpl.summary.en : tpl.summary.zh}
              </Text>

              <Text className="text-sm font-semibold text-foreground mt-4 mb-2">{t("lab.slots")}</Text>
              {tpl.slots.map((s, i) => (
                <View
                  key={i}
                  className="bg-surface border border-border rounded-xl px-3.5 py-3 mb-2"
                >
                  <View className="flex-row items-center" style={{ gap: 8 }}>
                    <Text className="text-sm font-semibold text-foreground" style={{ lineHeight: 20 }}>
                      {lang === "en" ? s.role.en : s.role.zh}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Text className="text-sm text-muted" style={{ lineHeight: 20 }}>
                      {lang === "en" ? s.defaultName.en : s.defaultName.zh} {s.defaultAmount}
                    </Text>
                  </View>
                  <Text className="text-xs text-muted mt-1" style={{ lineHeight: 17 }}>
                    {t("lab.slot.range")}: {lang === "en" ? s.amountRange.en : s.amountRange.zh}
                  </Text>
                  <Text className="text-xs text-muted mt-0.5" style={{ lineHeight: 17 }}>
                    {t("lab.slot.swap")}: {lang === "en" ? s.swapHint.en : s.swapHint.zh}
                  </Text>
                </View>
              ))}

              <Text className="text-sm font-semibold text-foreground mt-3 mb-2">{t("lab.tips")}</Text>
              {tpl.tips.map((tip, i) => (
                <View key={i} className="flex-row mb-1.5" style={{ gap: 8 }}>
                  <Text className="text-sm" style={{ color: colors.primary, lineHeight: 20 }}>
                    ·
                  </Text>
                  <Text className="text-sm text-muted" style={{ lineHeight: 20, flex: 1 }}>
                    {lang === "en" ? tip.en : tip.zh}
                  </Text>
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tplBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 200,
  },
  compareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  batchCard: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  finalizeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 9,
    marginTop: 10,
  },
  archiveBtn: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 4,
  },
  mainBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    paddingVertical: 13,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
});
