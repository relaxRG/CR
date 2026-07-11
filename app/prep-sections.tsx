import React, { useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Stack, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useHomemadeStore } from "@/lib/homemade/store";

/**
 * Prep Sections Manager — manage homemade sections (process families)
 * and the prep types inside each section:
 * add / rename / delete / reorder (priority) / move type across sections.
 */
export default function PrepSectionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, lang } = useI18n();
  const {
    preps,
    sections,
    types,
    addSection,
    renameSection,
    deleteSection,
    reorderSections,
    addType,
    renameType,
    moveType,
    deleteType,
    reorderTypes,
  } = useHomemadeStore();

  const [newSecName, setNewSecName] = useState("");
  const [editingSec, setEditingSec] = useState<string | null>(null);
  const [editSecName, setEditSecName] = useState("");
  /** section key → new type name input */
  const [newTypeName, setNewTypeName] = useState<Record<string, string>>({});
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editTypeName, setEditTypeName] = useState("");
  /** type key showing the "move to section" picker */
  const [movePickerType, setMovePickerType] = useState<string | null>(null);

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
    const created = lang === "en" ? addSection(name, "") : addSection("", name);
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

  const moveSection = (index: number, dir: -1 | 1) => {
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
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Header */}
      <View className="flex-row items-center px-4 pt-2 pb-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="xmark" size={22} color={colors.foreground} />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-foreground text-center mr-6">
          {t("psm.title")}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xs text-muted mb-3" style={{ lineHeight: 18 }}>
          {t("psm.hint")}
        </Text>

        {/* Add new section */}
        <View className="flex-row items-center mb-4" style={{ gap: 8 }}>
          <TextInput
            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2.5 text-base text-foreground"
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

        {sections.map((sec, secIdx) => {
          const inSection = types.filter((x) => x.section === sec.key);
          const secLabel = lang === "en" ? sec.en : sec.zh;
          return (
            <View
              key={sec.key}
              className="bg-surface border border-border rounded-2xl mb-4 overflow-hidden"
            >
              {/* Section header row */}
              <View
                className="flex-row items-center px-4 py-3"
                style={{ backgroundColor: colors.primary + "0D" }}
              >
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
                    <Text className="text-base font-semibold text-foreground">{secLabel}</Text>
                    <Text className="text-xs text-muted mt-0.5">
                      {t("psm.typeCount", { n: inSection.length })}
                    </Text>
                  </View>
                )}
                <View className="flex-row items-center" style={{ gap: 14, marginLeft: 8 }}>
                  <Pressable
                    onPress={() => moveSection(secIdx, -1)}
                    hitSlop={6}
                    disabled={secIdx === 0}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol
                      name="chevron.up"
                      size={18}
                      color={secIdx === 0 ? colors.border : colors.muted}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => moveSection(secIdx, 1)}
                    hitSlop={6}
                    disabled={secIdx === sections.length - 1}
                    style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                  >
                    <IconSymbol
                      name="chevron.down"
                      size={18}
                      color={secIdx === sections.length - 1 ? colors.border : colors.muted}
                    />
                  </Pressable>
                  {editingSec === sec.key ? (
                    <Pressable onPress={commitSecEdit} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                      <IconSymbol name="checkmark" size={20} color={colors.primary} />
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
                      <IconSymbol name="pencil" size={18} color={colors.muted} />
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
                    <IconSymbol name="trash.fill" size={18} color={colors.error} />
                  </Pressable>
                </View>
              </View>

              {/* Types in this section */}
              {inSection.map((typ, typIdx) => {
                const typLabel = lang === "en" ? typ.en : typ.zh;
                const n = countOfType(typ.key);
                return (
                  <View key={typ.key}>
                    <View
                      className="bg-border"
                      style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
                    />
                    <View className="flex-row items-center px-4 py-2.5">
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
                          <IconSymbol
                            name="chevron.up"
                            size={16}
                            color={typIdx === 0 ? colors.border : colors.muted}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => moveTypeRow(sec.key, typIdx, 1)}
                          hitSlop={6}
                          disabled={typIdx === inSection.length - 1}
                          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                        >
                          <IconSymbol
                            name="chevron.down"
                            size={16}
                            color={typIdx === inSection.length - 1 ? colors.border : colors.muted}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            setMovePickerType(movePickerType === typ.key ? null : typ.key)
                          }
                          hitSlop={6}
                          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                        >
                          <IconSymbol name="folder.fill" size={16} color={colors.primary} />
                        </Pressable>
                        {editingType === typ.key ? (
                          <Pressable onPress={commitTypeEdit} hitSlop={6} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
                            <IconSymbol name="checkmark" size={18} color={colors.primary} />
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
                            <IconSymbol name="pencil" size={16} color={colors.muted} />
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
                          <IconSymbol name="trash.fill" size={16} color={colors.error} />
                        </Pressable>
                      </View>
                    </View>
                    {movePickerType === typ.key ? (
                      <View className="flex-row flex-wrap px-4 pb-2.5" style={{ gap: 6 }}>
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
                              style={({ pressed }) => [
                                styles.moveChip,
                                { borderColor: colors.border, backgroundColor: colors.background },
                                pressed && { opacity: 0.6 },
                              ]}
                            >
                              <IconSymbol name="arrow.right" size={11} color={colors.primary} />
                              <Text className="text-xs text-foreground" style={{ lineHeight: 16 }}>
                                {lang === "en" ? s.en : s.zh}
                              </Text>
                            </Pressable>
                          ))}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {/* Add type inside section */}
              <View
                className="bg-border"
                style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 }}
              />
              <View className="flex-row items-center px-4 py-2.5" style={{ gap: 8 }}>
                <TextInput
                  className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground"
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
                  hitSlop={6}
                  style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                >
                  <IconSymbol
                    name="plus.circle.fill"
                    size={22}
                    color={(newTypeName[sec.key] ?? "").trim() ? colors.primary : colors.border}
                  />
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </ScreenContainer>
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
  moveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
});
