import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useBottleStore } from "@/lib/bottles/store";
import { useBottleTaxonomy } from "@/lib/bottles/taxonomy";

/**
 * 酒库分类与风格子分类管理板块(嵌入 Tags 页)。
 * 每个大分类一张卡片:分类行(改名/删除/上下移/分组切换)+ 该分类下的风格子分类
 * (添加/改名/删除/上下移)。与 prep-sections 管理交互保持一致。
 */
export function BottleTaxonomyManager() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const { bottles } = useBottleStore();
  const {
    categories,
    addCategory,
    renameCategory,
    deleteCategory,
    reorderCategories,
    stylesOf,
    addStyle,
    renameStyle,
    deleteStyle,
    reorderStyles,
  } = useBottleTaxonomy();

  const [newCatName, setNewCatName] = useState("");
  const [newCatGroup, setNewCatGroup] = useState<"spirits" | "bottles" | "materials">("spirits");
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editCatZh, setEditCatZh] = useState("");
  const [editCatEn, setEditCatEn] = useState("");
  /** category zh → new style name input */
  const [newStyleName, setNewStyleName] = useState<Record<string, string>>({});
  const [editingStyle, setEditingStyle] = useState<string | null>(null);
  const [editStyleName, setEditStyleName] = useState("");
  const [editStyleZh, setEditStyleZh] = useState("");
  /** 展开显示风格列表的分类 id 集合 */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const confirm = (title: string, message: string, onOk: () => void) => {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(message)) onOk();
      return;
    }
    Alert.alert(title, message, [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: onOk },
    ]);
  };

  const countOfCategory = (zh: string) => bottles.filter((b) => b.category === zh).length;
  const countOfStyle = (catZh: string, name: string) =>
    bottles.filter((b) => b.category === catZh && b.style === name).length;

  const handleAddCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    const created =
      lang === "en" ? addCategory(name, name, newCatGroup) : addCategory(name, "", newCatGroup);
    if (created) {
      setNewCatName("");
      haptic();
    }
  };

  const commitCatEdit = () => {
    if (editingCat && (editCatZh.trim() || editCatEn.trim())) {
      renameCategory(editingCat, editCatZh, editCatEn);
    }
    setEditingCat(null);
    setEditCatZh("");
    setEditCatEn("");
  };

  const moveCat = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= categories.length) return;
    const ids = categories.map((c) => c.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved);
    reorderCategories(ids);
    haptic();
  };

  const handleAddStyle = (catZh: string) => {
    const name = (newStyleName[catZh] ?? "").trim();
    if (!name) return;
    const created = addStyle(catZh, name);
    if (created) {
      setNewStyleName((prev) => ({ ...prev, [catZh]: "" }));
      haptic();
    }
  };

  const commitStyleEdit = () => {
    if (editingStyle && editStyleName.trim()) {
      renameStyle(editingStyle, editStyleName, editStyleZh);
    }
    setEditingStyle(null);
    setEditStyleName("");
    setEditStyleZh("");
  };

  const moveStyleRow = (catZh: string, index: number, dir: -1 | 1) => {
    const inCat = stylesOf(catZh);
    const to = index + dir;
    if (to < 0 || to >= inCat.length) return;
    const ids = inCat.map((s) => s.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(to, 0, moved);
    // 重建全量顺序:保持其他分类位置,替换本分类内顺序
    reorderStyles(ids);
    haptic();
  };

  return (
    <View>
      {/* Add new category */}
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <TextInput
            className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
            placeholder={t("tags.new.placeholder", { s: t("tags.section.bottleCat") })}
            placeholderTextColor={colors.muted}
            value={newCatName}
            onChangeText={setNewCatName}
            returnKeyType="done"
            onSubmitEditing={handleAddCategory}
            style={{ lineHeight: 20 }}
          />
          <Pressable
            onPress={handleAddCategory}
            disabled={!newCatName.trim()}
            style={({ pressed }) => [
              styles.addBtn,
              { backgroundColor: newCatName.trim() ? colors.primary : colors.border },
              pressed && newCatName.trim() && { transform: [{ scale: 0.95 }], opacity: 0.9 },
            ]}
          >
            <IconSymbol name="plus" size={22} color={newCatName.trim() ? "#FFFFFF" : colors.muted} />
          </Pressable>
        </View>
        {/* 新分类归属分组 */}
        <View className="flex-row mt-3" style={{ gap: 8 }}>
          {(["spirits", "bottles", "materials"] as const).map((g) => {
            const active = newCatGroup === g;
            return (
              <Pressable
                key={g}
                onPress={() => setNewCatGroup(g)}
                style={[
                  styles.groupChip,
                  {
                    backgroundColor: active ? colors.primary : colors.background,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={[styles.groupChipText, { color: active ? "#FFFFFF" : colors.foreground }]}>
                  {t(
                    g === "materials"
                      ? "tags.group.materials"
                      : g === "spirits"
                        ? "tags.group.spirits"
                        : "tags.group.bottles",
                  )}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {categories.map((cat, ci) => {
        const catStyles = stylesOf(cat.zh);
        const isOpen = !!expanded[cat.id];
        const isEditingC = editingCat === cat.id;
        const nBottles = countOfCategory(cat.zh);
        const label = lang === "en" ? cat.en : cat.zh;
        return (
          <View
            key={cat.id}
            className="bg-surface border border-border rounded-2xl mb-3 overflow-hidden"
          >
            {/* Category header row */}
            <View
              className="flex-row items-center px-4 py-3"
              style={{ backgroundColor: colors.primary + "0D" }}
            >
              <Pressable
                onPress={() => setExpanded((p) => ({ ...p, [cat.id]: !isOpen }))}
                hitSlop={6}
                style={({ pressed }) => [{ marginRight: 8 }, pressed && { opacity: 0.6 }]}
              >
                <IconSymbol
                  name={isOpen ? "chevron.down" : "chevron.right"}
                  size={16}
                  color={colors.muted}
                />
              </Pressable>
              {isEditingC ? (
                <View className="flex-1" style={{ gap: 4 }}>
                  <TextInput
                    className="bg-background border border-border rounded-lg px-2 py-1 text-[15px] text-foreground"
                    value={editCatZh}
                    onChangeText={setEditCatZh}
                    autoFocus
                    returnKeyType="done"
                    placeholder={t("tags.edit.zh")}
                    placeholderTextColor={colors.muted}
                    onSubmitEditing={commitCatEdit}
                    style={{ lineHeight: 20 }}
                  />
                  <TextInput
                    className="bg-background border border-border rounded-lg px-2 py-1 text-[15px] text-foreground"
                    value={editCatEn}
                    onChangeText={setEditCatEn}
                    returnKeyType="done"
                    placeholder={t("tags.edit.en")}
                    placeholderTextColor={colors.muted}
                    onSubmitEditing={commitCatEdit}
                    style={{ lineHeight: 20 }}
                  />
                </View>
              ) : (
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">
                    {label}
                    <Text className="text-xs text-muted font-normal">
                      {"  "}
                      {lang === "en" ? cat.zh : cat.en}
                    </Text>
                  </Text>
                  <Text className="text-xs text-muted mt-0.5">
                    {t(
                      cat.group === "materials"
                        ? "tags.group.materials"
                        : cat.group === "spirits"
                          ? "tags.group.spirits"
                          : "tags.group.bottles",
                    )}{" "}
                    ·{" "}
                    {t("tags.bottleCount", { n: nBottles })} · {catStyles.length} styles
                  </Text>
                </View>
              )}
              <View className="flex-row items-center" style={{ gap: 12, marginLeft: 8 }}>
                <Pressable
                  onPress={() => moveCat(ci, -1)}
                  hitSlop={6}
                  disabled={ci === 0}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol name="chevron.up" size={17} color={ci === 0 ? colors.border : colors.muted} />
                </Pressable>
                <Pressable
                  onPress={() => moveCat(ci, 1)}
                  hitSlop={6}
                  disabled={ci === categories.length - 1}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol
                    name="chevron.down"
                    size={17}
                    color={ci === categories.length - 1 ? colors.border : colors.muted}
                  />
                </Pressable>
                {isEditingC ? (
                  <Pressable onPress={commitCatEdit} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                    <IconSymbol name="checkmark" size={19} color={colors.primary} />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => {
                      setEditingCat(cat.id);
                      setEditCatZh(cat.zh);
                      setEditCatEn(cat.en);
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol name="pencil" size={17} color={colors.muted} />
                  </Pressable>
                )}
                <Pressable
                  onPress={() =>
                    confirm(
                      t("tags.delete.title", { s: t("tags.section.bottleCat") }),
                      nBottles > 0
                        ? lang === "zh"
                          ? `「${cat.zh}」下有 ${nBottles} 款酒,删除分类后这些酒款保留原分类名,可在编辑时重新归类。`
                          : `"${label}" has ${nBottles} bottles. They keep the old category text until re-assigned.`
                        : t("tags.delete.confirm", { name: label }),
                      () => deleteCategory(cat.id),
                    )
                  }
                  hitSlop={6}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol name="trash.fill" size={17} color={colors.error} />
                </Pressable>
              </View>
            </View>

            {/* Styles inside this category */}
            {isOpen ? (
              <>
                {catStyles.map((sty, si) => {
                  const isEditingS = editingStyle === sty.id;
                  const n = countOfStyle(cat.zh, sty.name);
                  return (
                    <View key={sty.id}>
                      <View
                        className="bg-border"
                        style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
                      />
                      <View className="flex-row items-center px-4 py-2.5">
                        {isEditingS ? (
                          <View className="flex-1" style={{ gap: 4 }}>
                            <TextInput
                              className="bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground"
                              value={editStyleName}
                              onChangeText={setEditStyleName}
                              autoFocus
                              returnKeyType="done"
                              placeholder={t("tags.edit.en")}
                              placeholderTextColor={colors.muted}
                              onSubmitEditing={commitStyleEdit}
                              style={{ lineHeight: 18 }}
                            />
                            <TextInput
                              className="bg-background border border-border rounded-lg px-2 py-1 text-sm text-foreground"
                              value={editStyleZh}
                              onChangeText={setEditStyleZh}
                              returnKeyType="done"
                              placeholder={t("tags.edit.zh")}
                              placeholderTextColor={colors.muted}
                              onSubmitEditing={commitStyleEdit}
                              style={{ lineHeight: 18 }}
                            />
                          </View>
                        ) : (
                          <View className="flex-1">
                            <Text className="text-sm font-medium text-foreground">
                              {lang === "zh" && sty.zh ? sty.zh : sty.name}
                              {sty.zh ? (
                                <Text className="text-xs text-muted font-normal">
                                  {"  "}
                                  {lang === "zh" ? sty.name : sty.zh}
                                </Text>
                              ) : null}
                            </Text>
                            {n > 0 ? (
                              <Text className="text-xs text-muted mt-0.5">
                                {t("tags.bottleCount", { n })}
                              </Text>
                            ) : null}
                          </View>
                        )}
                        <View className="flex-row items-center" style={{ gap: 12, marginLeft: 8 }}>
                          <Pressable
                            onPress={() => moveStyleRow(cat.zh, si, -1)}
                            hitSlop={6}
                            disabled={si === 0}
                            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                          >
                            <IconSymbol name="chevron.up" size={15} color={si === 0 ? colors.border : colors.muted} />
                          </Pressable>
                          <Pressable
                            onPress={() => moveStyleRow(cat.zh, si, 1)}
                            hitSlop={6}
                            disabled={si === catStyles.length - 1}
                            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                          >
                            <IconSymbol
                              name="chevron.down"
                              size={15}
                              color={si === catStyles.length - 1 ? colors.border : colors.muted}
                            />
                          </Pressable>
                          {isEditingS ? (
                            <Pressable onPress={commitStyleEdit} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                              <IconSymbol name="checkmark" size={17} color={colors.primary} />
                            </Pressable>
                          ) : (
                            <Pressable
                              onPress={() => {
                                setEditingStyle(sty.id);
                                setEditStyleName(sty.name);
                                setEditStyleZh(sty.zh);
                              }}
                              hitSlop={6}
                              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                            >
                              <IconSymbol name="pencil" size={15} color={colors.muted} />
                            </Pressable>
                          )}
                          <Pressable
                            onPress={() =>
                              confirm(
                                t("tags.delete.title", { s: t("tags.section.bottleStyle") }),
                                t("tags.delete.confirm", {
                                  name: lang === "zh" && sty.zh ? sty.zh : sty.name,
                                }),
                                () => deleteStyle(sty.id),
                              )
                            }
                            hitSlop={6}
                            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                          >
                            <IconSymbol name="trash.fill" size={15} color={colors.error} />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })}
                {/* Add style row */}
                <View
                  className="bg-border"
                  style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
                />
                <View className="flex-row items-center px-4 py-2.5" style={{ gap: 8 }}>
                  <TextInput
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                    placeholder={t("tags.new.placeholder", { s: t("tags.section.bottleStyle") })}
                    placeholderTextColor={colors.muted}
                    value={newStyleName[cat.zh] ?? ""}
                    onChangeText={(v) => setNewStyleName((prev) => ({ ...prev, [cat.zh]: v }))}
                    returnKeyType="done"
                    onSubmitEditing={() => handleAddStyle(cat.zh)}
                    style={{ lineHeight: 18 }}
                  />
                  <Pressable
                    onPress={() => handleAddStyle(cat.zh)}
                    disabled={!(newStyleName[cat.zh] ?? "").trim()}
                    style={({ pressed }) => [
                      styles.addBtnSm,
                      {
                        backgroundColor: (newStyleName[cat.zh] ?? "").trim()
                          ? colors.primary
                          : colors.border,
                      },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <IconSymbol
                      name="plus"
                      size={16}
                      color={(newStyleName[cat.zh] ?? "").trim() ? "#FFFFFF" : colors.muted}
                    />
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnSm: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  groupChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  groupChipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 17,
  },
});
