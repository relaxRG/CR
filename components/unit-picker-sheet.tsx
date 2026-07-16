import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { UNIT_PRESET_GROUPS } from "@/lib/units";

interface UnitPickerSheetProps {
  visible: boolean;
  selectedUnit: string;
  onSelect: (unit: string) => void;
  onClose: () => void;
}

/**
 * Bottom sheet for selecting a measurement unit.
 * Groups units by category (liquid, spoon, count, ratio, fuzzy).
 * Tapping a unit calls onSelect and closes the sheet.
 */
export function UnitPickerSheet({
  visible,
  selectedUnit,
  onSelect,
  onClose,
}: UnitPickerSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop */}
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.4)" }]}
        onPress={onClose}
      />

      {/* Sheet */}
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.background,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {/* Handle bar */}
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        {/* Title */}
        <Text style={[styles.title, { color: colors.foreground }]}>
          {t("form.ingredient.unit.select")}
        </Text>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 8 }}
        >
          {/* "No unit" option */}
          <View style={styles.groupContainer}>
            <Pressable
              onPress={() => { onSelect(""); onClose(); }}
              style={({ pressed }) => [
                styles.unitChip,
                {
                  backgroundColor:
                    selectedUnit === ""
                      ? colors.primary
                      : colors.surface,
                  borderColor:
                    selectedUnit === "" ? colors.primary : colors.border,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[
                  styles.unitChipText,
                  {
                    color:
                      selectedUnit === "" ? colors.background : colors.foreground,
                  },
                ]}
              >
                {t("form.ingredient.unit.none")}
              </Text>
            </Pressable>
          </View>

          {UNIT_PRESET_GROUPS.map((group) => (
            <View key={group.labelKey} style={styles.groupContainer}>
              {/* Group label */}
              <Text style={[styles.groupLabel, { color: colors.muted }]}>
                {t(group.labelKey as Parameters<typeof t>[0])}
              </Text>
              {/* Unit chips */}
              <View style={styles.chipsRow}>
                {group.units.map((unit) => {
                  const isSelected = selectedUnit === unit;
                  return (
                    <Pressable
                      key={unit}
                      onPress={() => { onSelect(unit); onClose(); }}
                      style={({ pressed }) => [
                        styles.unitChip,
                        {
                          backgroundColor: isSelected
                            ? colors.primary
                            : colors.surface,
                          borderColor: isSelected ? colors.primary : colors.border,
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.unitChipText,
                          {
                            color: isSelected
                              ? colors.background
                              : colors.foreground,
                          },
                        ]}
                      >
                        {unit}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "75%",
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 16,
  },
  groupContainer: {
    marginBottom: 12,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  unitChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 48,
    alignItems: "center",
  },
  unitChipText: {
    fontSize: 14,
    fontWeight: "500",
  },
});
