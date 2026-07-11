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
import { useHomemadeStore } from "@/lib/homemade/store";
import { PREP_GROUPS, PrepGroup, prepGroupOfSection } from "@/lib/homemade/types";

/**
 * 自制库分区/类型管理板块(嵌入 Tags 页)。
 * 与 app/prep-sections.tsx 独立页保持一致的交互:
 * 分区增删改排序 + 分区内类型增删改排序/跨分区移动。
 */
export function PrepTaxonomyManager() {
  const colors = useColors();
  const { t, lang } = useI18n();
  const {
    preps,
    sections,
    types,
    addSection,
    renameSection,
    moveSection: moveSectionGroup,
    deleteSection,
    reorderSections,
    addType,
    renameType,
    moveType,
    deleteType,
    reorderTypes,
  } = useHomemadeStore();

  const [newSecName, setNewSecName] = useState("");
  const [newSecGroup, setNewSecGroup] = useState<PrepGroup>("non_alcoholic");
  const [editingSec, setEditingSec] = useState<string | null>(null);
  const [editSecName, setEditSecName] = useState("");
  const [newTypeName, setNewTypeName] = useState<Record<string, string>>({});
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editTypeName, setEditTypeName] = useState("");
  const [movePickerType, setMovePickerType] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const countOfType = (key: string) => preps.filter((p) => p.type === key).length;

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

  const handleAddSection = () => {
    const name = newSecName.trim();
    if (!name) return;
    const created =
      lang === "en" ? addSection(name, "", newSecGroup) : addSection("", name, newSecGroup);
    if (created) {
      setNewSecName("");
      haptic();
    }
  };

  const commitSecEdit = () => {
    if (editingSec && editSecName.trim()) {
      if (lang === "en") renameSection(editingSec, editSecName, "");
      else renameSection(editingSec, "", editSecName);
    }
    setEditingSec(null);
    setEditSecName("");
  };

  const moveSectionOrder = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= sections.length) return;
    const keys = sections.map((s) => s.key);
    const [moved] = keys.splice(index, 1);
    keys.splice(to, 0, moved);
    reorderSections(keys);
    haptic();
  };

  const handleAddType = (sectionKey: string) => {
    const name = (newTypeName[sectionKey] ?? "").trim();
    if (!name) return;
    const created =
      lang === "en" ? addType(name, "", sectionKey) : addType("", name, sectionKey);
    if (created) {
      setNewTypeName((prev) => ({ ...prev, [sectionKey]: "" }));
      haptic();
    }
  };

  const commitTypeEdit = () => {
    if (editingType && editTypeName.trim()) {
      if (lang === "en") renameType(editingType, editTypeName, "");
      else renameType(editingType, "", editTypeName);
    }
    setEditingType(null);
    setEditTypeName("");
  };

  const moveTypeRow = (sectionKey: string, index: number, dir: -1 | 1) => {
    const inSection = types.filter((x) => x.section === sectionKey);
    const to = index + dir;
    if (to < 0 || to >= inSection.length) return;
    const keys = inSection.map((x) => x.key);
    const [moved] = keys.splice(index, 1);
    keys.splice(to, 0, moved);
    reorderTypes(sectionKey, keys);
    haptic();
  };

  return (
    <View>
      {/* Add new section */}
      <View className="bg-surface border border-border rounded-2xl p-4 mb-4">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <TextInput
            className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
            placeholder={t("psm.newSection")}
            placeholderTextColor={colors.muted}
            value={newSecName}
            onChangeText={setNewSecName}
            returnKeyType="done"
            onSubmitEditing={handleAddSection}
            style={{ lineHeight: 20 }}
          />
          <Pressable
            onPress={handleAddSection}
            disabled={!newSecName.trim()}
            style={({ pressed }) => [
              styles.addBtn,
              { backgroundColor: newSecName.trim() ? colors.primary : colors.border },
              pressed && newSecName.trim() && { transform: [{ scale: 0.95 }], opacity: 0.9 },
            ]}
          >
            <IconSymbol name="plus" size={22} color={newSecName.trim() ? "#FFFFFF" : colors.muted} />
          </Pressable>
        </View>
        <Text className="text-xs text-muted mt-2.5" style={{ lineHeight: 16 }}>
          {t("psm.hint")}
        </Text>
        {/* 新分区归属:含酒精 / 无酒精 */}
        <View className="flex-row items-center mt-2.5" style={{ gap: 8 }}>
          {PREP_GROUPS.map((g) => {
            const active = newSecGroup === g.key;
            return (
              <Pressable
                key={g.key}
                onPress={() => setNewSecGroup(g.key)}
                style={[
                  styles.groupChip,
                  {
                    backgroundColor: active ? colors.primary : colors.background,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 16,
                    fontWeight: "500",
                    color: active ? "#FFFFFF" : colors.foreground,
                  }}
                >
                  {lang === "en" ? g.en : g.zh}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {sections.map((sec, secIdx) => {
        const inSection = types.filter((x) => x.section === sec.key);
        const secLabel = lang === "en" ? sec.en : sec.zh;
        const isOpen = !!expanded[sec.key];
        const secGroup = prepGroupOfSection(sections, sec.key);
        return (
          <View
            key={sec.key}
            className="bg-surface border border-border rounded-2xl mb-3 overflow-hidden"
          >
            {/* Section header row */}
            <View
              className="flex-row items-center px-4 py-3"
              style={{ backgroundColor: colors.primary + "0D" }}
            >
              <Pressable
                onPress={() => setExpanded((p) => ({ ...p, [sec.key]: !isOpen }))}
                hitSlop={6}
                style={({ pressed }) => [{ marginRight: 8 }, pressed && { opacity: 0.6 }]}
              >
                <IconSymbol
                  name={isOpen ? "chevron.down" : "chevron.right"}
                  size={16}
                  color={colors.muted}
                />
              </Pressable>
              {editingSec === sec.key ? (
                <TextInput
                  className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-base text-foreground"
                  value={editSecName}
                  onChangeText={setEditSecName}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={commitSecEdit}
                  onBlur={commitSecEdit}
                  style={{ lineHeight: 20 }}
                />
              ) : (
                <View className="flex-1">
                  <View className="flex-row items-center" style={{ gap: 6 }}>
                    <Text className="text-base font-semibold text-foreground">{secLabel}</Text>
                    <Pressable
                      onPress={() => {
                        const next: PrepGroup =
                          secGroup === "alcoholic" ? "non_alcoholic" : "alcoholic";
                        moveSectionGroup(sec.key, next);
                        haptic();
                      }}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.secGroupTag,
                        {
                          backgroundColor:
                            (secGroup === "alcoholic" ? colors.warning : colors.success) + "22",
                        },
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          lineHeight: 14,
                          fontWeight: "600",
                          color: secGroup === "alcoholic" ? colors.warning : colors.success,
                        }}
                      >
                        {lang === "en"
                          ? PREP_GROUPS.find((g) => g.key === secGroup)?.en
                          : PREP_GROUPS.find((g) => g.key === secGroup)?.zh}
                      </Text>
                    </Pressable>
                  </View>
                  <Text className="text-xs text-muted mt-0.5">
                    {t("psm.typeCount", { n: inSection.length })}
                  </Text>
                </View>
              )}
              <View className="flex-row items-center" style={{ gap: 12, marginLeft: 8 }}>
                <Pressable
                  onPress={() => moveSectionOrder(secIdx, -1)}
                  hitSlop={6}
                  disabled={secIdx === 0}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol name="chevron.up" size={17} color={secIdx === 0 ? colors.border : colors.muted} />
                </Pressable>
                <Pressable
                  onPress={() => moveSectionOrder(secIdx, 1)}
                  hitSlop={6}
                  disabled={secIdx === sections.length - 1}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol
                    name="chevron.down"
                    size={17}
                    color={secIdx === sections.length - 1 ? colors.border : colors.muted}
                  />
                </Pressable>
                {editingSec === sec.key ? (
                  <Pressable onPress={commitSecEdit} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                    <IconSymbol name="checkmark" size={19} color={colors.primary} />
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => {
                      setEditingSec(sec.key);
                      setEditSecName(secLabel);
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
                      t("psm.deleteSection"),
                      t("psm.deleteSection.confirm", { name: secLabel }),
                      () => deleteSection(sec.key),
                    )
                  }
                  hitSlop={6}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol name="trash.fill" size={17} color={colors.error} />
                </Pressable>
              </View>
            </View>

            {isOpen ? (
              <>
                {inSection.map((typ, typIdx) => {
                  const typLabel = lang === "en" ? typ.en : typ.zh;
                  const n = countOfType(typ.key);
                  const showMove = movePickerType === typ.key;
                  return (
                    <View key={typ.key}>
                      <View
                        className="bg-border"
                        style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
                      />
                      <View className="px-4 py-2.5">
                        <View className="flex-row items-center">
                          {editingType === typ.key ? (
                            <TextInput
                              className="flex-1 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-foreground"
                              value={editTypeName}
                              onChangeText={setEditTypeName}
                              autoFocus
                              returnKeyType="done"
                              onSubmitEditing={commitTypeEdit}
                              onBlur={commitTypeEdit}
                              style={{ lineHeight: 18 }}
                            />
                          ) : (
                            <View className="flex-1">
                              <Text className="text-sm font-medium text-foreground">{typLabel}</Text>
                              {n > 0 ? (
                                <Text className="text-xs text-muted mt-0.5">
                                  {t("psm.prepCount", { n })}
                                </Text>
                              ) : null}
                            </View>
                          )}
                          <View className="flex-row items-center" style={{ gap: 12, marginLeft: 8 }}>
                            <Pressable
                              onPress={() => moveTypeRow(sec.key, typIdx, -1)}
                              hitSlop={6}
                              disabled={typIdx === 0}
                              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                            >
                              <IconSymbol name="chevron.up" size={15} color={typIdx === 0 ? colors.border : colors.muted} />
                            </Pressable>
                            <Pressable
                              onPress={() => moveTypeRow(sec.key, typIdx, 1)}
                              hitSlop={6}
                              disabled={typIdx === inSection.length - 1}
                              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                            >
                              <IconSymbol
                                name="chevron.down"
                                size={15}
                                color={typIdx === inSection.length - 1 ? colors.border : colors.muted}
                              />
                            </Pressable>
                            <Pressable
                              onPress={() => setMovePickerType(showMove ? null : typ.key)}
                              hitSlop={6}
                              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                            >
                              <IconSymbol name="folder.fill" size={15} color={showMove ? colors.primary : colors.muted} />
                            </Pressable>
                            {editingType === typ.key ? (
                              <Pressable onPress={commitTypeEdit} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                                <IconSymbol name="checkmark" size={17} color={colors.primary} />
                              </Pressable>
                            ) : (
                              <Pressable
                                onPress={() => {
                                  setEditingType(typ.key);
                                  setEditTypeName(typLabel);
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
                                  t("psm.deleteType"),
                                  t("psm.deleteType.confirm", { name: typLabel, n: String(n) }),
                                  () => deleteType(typ.key),
                                )
                              }
                              hitSlop={6}
                              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                            >
                              <IconSymbol name="trash.fill" size={15} color={colors.error} />
                            </Pressable>
                          </View>
                        </View>
                        {showMove ? (
                          <View className="flex-row flex-wrap mt-2.5 pt-2.5 border-t border-border" style={{ gap: 8 }}>
                            {sections
                              .filter((s) => s.key !== sec.key)
                              .map((s) => (
                                <Pressable
                                  key={s.key}
                                  onPress={() => {
                                    moveType(typ.key, s.key);
                                    setMovePickerType(null);
                                    haptic();
                                  }}
                                  style={[
                                    styles.groupChip,
                                    { backgroundColor: colors.background, borderColor: colors.border },
                                  ]}
                                >
                                  <Text style={[styles.groupChipText, { color: colors.foreground }]}>
                                    {lang === "en" ? s.en : s.zh}
                                  </Text>
                                </Pressable>
                              ))}
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
                {/* Add type row */}
                <View
                  className="bg-border"
                  style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
                />
                <View className="flex-row items-center px-4 py-2.5" style={{ gap: 8 }}>
                  <TextInput
                    className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                    placeholder={t("psm.newType")}
                    placeholderTextColor={colors.muted}
                    value={newTypeName[sec.key] ?? ""}
                    onChangeText={(v) => setNewTypeName((prev) => ({ ...prev, [sec.key]: v }))}
                    returnKeyType="done"
                    onSubmitEditing={() => handleAddType(sec.key)}
                    style={{ lineHeight: 18 }}
                  />
                  <Pressable
                    onPress={() => handleAddType(sec.key)}
                    disabled={!(newTypeName[sec.key] ?? "").trim()}
                    style={({ pressed }) => [
                      styles.addBtnSm,
                      {
                        backgroundColor: (newTypeName[sec.key] ?? "").trim()
                          ? colors.primary
                          : colors.border,
                      },
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <IconSymbol
                      name="plus"
                      size={16}
                      color={(newTypeName[sec.key] ?? "").trim() ? "#FFFFFF" : colors.muted}
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
  secGroupTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 7,
  },
});
