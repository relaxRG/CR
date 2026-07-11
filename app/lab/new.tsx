import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useLabStore } from "@/lib/lab/store";
import { LAB_TEMPLATES, specFromTemplate } from "@/lib/lab/templates";
import { LabSpec } from "@/lib/lab/types";
import { useRecipeStore } from "@/lib/recipes/store";
import { genId } from "@/lib/recipes/types";

export default function LabNewScreen() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { addProject } = useLabStore();
  const { recipes } = useRecipeStore();

  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [baseRecipeId, setBaseRecipeId] = useState("");
  const [recipeQuery, setRecipeQuery] = useState("");
  const [recipePickerOpen, setRecipePickerOpen] = useState(false);

  const selectedTpl = templateId ? LAB_TEMPLATES.find((x) => x.id === templateId) : undefined;
  const baseRecipe = baseRecipeId ? recipes.find((r) => r.id === baseRecipeId) : undefined;

  const recipeCandidates = useMemo(() => {
    const q = recipeQuery.trim().toLowerCase();
    return recipes
      .filter(
        (r) =>
          q === "" ||
          r.name.toLowerCase().includes(q) ||
          (r.nameEn ?? "").toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [recipes, recipeQuery]);

  const handleCreate = () => {
    if (!name.trim()) {
      Alert.alert(t("lab.name.required"));
      return;
    }
    let initialSpec: LabSpec | null = null;
    if (baseRecipe) {
      initialSpec = {
        ingredients: baseRecipe.ingredients.map((i) => ({ ...i, id: genId() })),
        method: baseRecipe.method,
        glass: baseRecipe.glass,
        ice: baseRecipe.ice,
        garnish: baseRecipe.garnish,
      };
    } else if (selectedTpl) {
      initialSpec = specFromTemplate(selectedTpl, lang as "zh" | "en", genId);
    }
    const project = addProject(
      { name, goal, templateId, baseRecipeId },
      initialSpec,
    );
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    router.replace({ pathname: "/lab/[id]", params: { id: project.id } });
  };

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View className="px-5 pt-2 pb-3 flex-row items-center justify-between">
          <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <Text className="text-base" style={{ color: colors.primary, lineHeight: 22 }}>
              {t("common.cancel")}
            </Text>
          </Pressable>
          <Text className="text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
            {t("lab.new.title")}
          </Text>
          <Pressable onPress={handleCreate} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
            <Text
              className="text-base font-semibold"
              style={{ color: name.trim() ? colors.primary : colors.muted, lineHeight: 22 }}
            >
              {t("lab.new.create")}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* 名称 */}
          <Text className="text-sm font-medium text-muted mt-2 mb-1.5">{t("lab.new.name")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
            placeholder={t("lab.new.name.ph")}
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            style={{ lineHeight: 20 }}
          />

          {/* 概念目标 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-1.5">{t("lab.new.goal")}</Text>
          <TextInput
            className="bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
            placeholder={t("lab.new.goal.ph")}
            placeholderTextColor={colors.muted}
            value={goal}
            onChangeText={setGoal}
            multiline
            style={{ lineHeight: 20, minHeight: 72, textAlignVertical: "top" }}
          />

          {/* 经典框架选择 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-0.5">{t("lab.new.template")}</Text>
          <Text className="text-xs text-muted mb-2" style={{ lineHeight: 16 }}>
            {t("lab.new.template.desc")}
          </Text>
          <Pressable
            onPress={() => setTemplateId("")}
            style={({ pressed }) => [
              styles.tplRow,
              {
                backgroundColor: colors.surface,
                borderColor: templateId === "" ? colors.primary : colors.border,
                borderWidth: templateId === "" ? 1.5 : StyleSheet.hairlineWidth,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text className="text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
                {t("lab.new.template.none")}
              </Text>
              <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                {t("lab.new.template.none.desc")}
              </Text>
            </View>
            {templateId === "" ? (
              <IconSymbol name="checkmark.circle.fill" size={20} color={colors.primary} />
            ) : null}
          </Pressable>
          {LAB_TEMPLATES.map((tpl) => {
            const active = templateId === tpl.id;
            return (
              <Pressable
                key={tpl.id}
                onPress={() => {
                  setTemplateId(active ? "" : tpl.id);
                  if (!active) setBaseRecipeId("");
                }}
                style={({ pressed }) => [
                  styles.tplRow,
                  {
                    backgroundColor: colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                    borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text className="text-base font-semibold text-foreground" style={{ lineHeight: 22 }}>
                    {lang === "en" ? tpl.name.en : tpl.name.zh}
                  </Text>
                  <Text className="text-xs text-muted" style={{ lineHeight: 16 }}>
                    {lang === "en" ? tpl.formula.en : tpl.formula.zh}
                  </Text>
                  {active ? (
                    <Text className="text-xs text-muted mt-1" style={{ lineHeight: 17 }}>
                      {lang === "en" ? tpl.summary.en : tpl.summary.zh}
                    </Text>
                  ) : null}
                </View>
                {active ? (
                  <IconSymbol name="checkmark.circle.fill" size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}

          {/* 从现有配方发起 */}
          <Text className="text-sm font-medium text-muted mt-5 mb-0.5">{t("lab.new.fromRecipe")}</Text>
          <Text className="text-xs text-muted mb-2" style={{ lineHeight: 16 }}>
            {t("lab.new.fromRecipe.desc")}
          </Text>
          <Pressable
            onPress={() => setRecipePickerOpen((v) => !v)}
            style={({ pressed }) => [
              styles.tplRow,
              { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              className="text-base text-foreground"
              style={{ lineHeight: 22, flex: 1 }}
              numberOfLines={1}
            >
              {baseRecipe ? baseRecipe.name : t("lab.new.fromRecipe.none")}
            </Text>
            <IconSymbol
              name={recipePickerOpen ? "chevron.up" : "chevron.down"}
              size={16}
              color={colors.muted}
            />
          </Pressable>
          {recipePickerOpen ? (
            <View
              className="rounded-xl border overflow-hidden mt-1"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            >
              <TextInput
                className="px-3 py-2.5 text-base text-foreground"
                placeholder={t("compare.pickerSearch")}
                placeholderTextColor={colors.muted}
                value={recipeQuery}
                onChangeText={setRecipeQuery}
                returnKeyType="done"
                style={{ lineHeight: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}
              />
              <Pressable
                onPress={() => {
                  setBaseRecipeId("");
                  setRecipePickerOpen(false);
                }}
                style={({ pressed }) => [styles.pickRow, pressed && { opacity: 0.6 }]}
              >
                <Text className="text-sm text-muted" style={{ lineHeight: 20 }}>
                  {t("lab.new.fromRecipe.none")}
                </Text>
              </Pressable>
              {recipeCandidates.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    setBaseRecipeId(r.id);
                    setTemplateId("");
                    setRecipePickerOpen(false);
                    if (!name.trim()) setName(r.name);
                  }}
                  style={({ pressed }) => [
                    styles.pickRow,
                    { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text className="text-sm text-foreground" style={{ lineHeight: 20 }} numberOfLines={1}>
                    {r.name}
                    {r.nameEn ? `  ${r.nameEn}` : ""}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tplRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 8,
  },
  pickRow: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
