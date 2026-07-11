import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { ColorPickerPanel } from "@/components/color-picker";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useCardTagSettings, DEFAULT_CARD_TAG_SETTINGS, CardTagSettings } from "@/lib/settings/card-tags";
import { CardTagSlot, CARD_TAG_SLOT_LABELS } from "@/lib/recipes/types";

export default function CardTagSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const zh = lang === "zh";
  const [settings, setSettings] = useCardTagSettings();

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const toggle = (key: keyof CardTagSettings) => {
    tap();
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setMax = (n: number) => {
    tap();
    setSettings((prev) => ({ ...prev, maxTagsPerCard: n }));
  };

  const reset = () => {
    tap();
    setSettings(DEFAULT_CARD_TAG_SETTINGS);
  };

  /* ---- Recipe card slot management ---- */

  const order = settings.recipeCardSlotOrder ?? DEFAULT_CARD_TAG_SETTINGS.recipeCardSlotOrder;
  const hidden = settings.recipeCardSlotHidden ?? [];
  const customColors = settings.recipeCardColors ?? {};

  const isHidden = (slot: CardTagSlot) => hidden.includes(slot);
  const allHidden = order.every((s) => hidden.includes(s));

  const toggleSlot = (slot: CardTagSlot) => {
    tap();
    setSettings((prev) => {
      const h = prev.recipeCardSlotHidden ?? [];
      return {
        ...prev,
        recipeCardSlotHidden: h.includes(slot) ? h.filter((x) => x !== slot) : [...h, slot],
      };
    });
  };

  const showAll = () => {
    tap();
    setSettings((prev) => ({ ...prev, recipeCardSlotHidden: [] }));
  };

  const hideAll = () => {
    tap();
    setSettings((prev) => ({ ...prev, recipeCardSlotHidden: [...order] }));
  };

  const moveSlot = (slot: CardTagSlot, dir: -1 | 1) => {
    tap();
    setSettings((prev) => {
      const arr = [...(prev.recipeCardSlotOrder ?? DEFAULT_CARD_TAG_SETTINGS.recipeCardSlotOrder)];
      const i = arr.indexOf(slot);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...prev, recipeCardSlotOrder: arr };
    });
  };

  const setSlotColor = (slot: CardTagSlot, hex: string) => {
    setSettings((prev) => ({
      ...prev,
      recipeCardColors: { ...(prev.recipeCardColors ?? {}), [slot]: hex },
    }));
  };

  const clearSlotColor = (slot: CardTagSlot) => {
    tap();
    setSettings((prev) => {
      const next = { ...(prev.recipeCardColors ?? {}) };
      delete next[slot];
      return { ...prev, recipeCardColors: next };
    });
  };

  /** Move slot between row 1 and row 2 */
  const moveToRow = (slot: CardTagSlot, targetRow: 1 | 2) => {
    tap();
    setSettings((prev) => {
      const r1 = prev.recipeCardRow1Slots ?? DEFAULT_CARD_TAG_SETTINGS.recipeCardRow1Slots;
      if (targetRow === 1) {
        return { ...prev, recipeCardRow1Slots: r1.includes(slot) ? r1 : [...r1, slot] };
      } else {
        return { ...prev, recipeCardRow1Slots: r1.filter((s) => s !== slot) };
      }
    });
  };

  const row1Slots = settings.recipeCardRow1Slots ?? DEFAULT_CARD_TAG_SETTINGS.recipeCardRow1Slots;

  /* ---- Shared sub-components ---- */

  const ROW_H = 50;

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={{ marginBottom: 20 }}>
      <Text style={[styles.sectionLabel, { color: colors.muted }]}>{title}</Text>
      <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );

  const ToggleRow = ({
    label,
    sub,
    value,
    onToggle,
    last,
  }: {
    label: string;
    sub?: string;
    value: boolean;
    onToggle: () => void;
    last?: boolean;
  }) => (
    <>
      <View style={[styles.row, { height: sub ? 56 : ROW_H }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowLabel, { color: colors.foreground }]}>{label}</Text>
          {sub ? <Text style={[styles.rowSub, { color: colors.muted }]}>{sub}</Text> : null}
        </View>
        <Switch
          value={value}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#FFFFFF"
        />
      </View>
      {!last && <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: 16 }]} />}
    </>
  );

  const MAX_OPTIONS = [1, 2, 3, 4, 5, 0];

  /* ---- Slot row with reorder + toggle + color ---- */
  const [expandedColorSlot, setExpandedColorSlot] = React.useState<CardTagSlot | null>(null);

  const SlotRow = ({ slot, isFirst, isLast, rowNum }: { slot: CardTagSlot; isFirst: boolean; isLast: boolean; rowNum: 1 | 2 }) => {
    const label = CARD_TAG_SLOT_LABELS[slot];
    const name = zh ? label.zh : label.en;
    const slotHidden = isHidden(slot);
    const color = customColors[slot];
    const pickerOpen = expandedColorSlot === slot;

    return (
      <>
        <View style={[styles.slotRow, { opacity: slotHidden ? 0.45 : 1 }]}>
          {/* Reorder arrows */}
          <View style={styles.arrowCol}>
            <Pressable
              onPress={() => moveSlot(slot, -1)}
              disabled={isFirst}
              hitSlop={6}
              style={({ pressed }) => [{ opacity: isFirst ? 0.2 : pressed ? 0.5 : 1 }]}
            >
              <IconSymbol name="chevron.up" size={14} color={colors.muted} />
            </Pressable>
            <Pressable
              onPress={() => moveSlot(slot, 1)}
              disabled={isLast}
              hitSlop={6}
              style={({ pressed }) => [{ opacity: isLast ? 0.2 : pressed ? 0.5 : 1 }]}
            >
              <IconSymbol name="chevron.down" size={14} color={colors.muted} />
            </Pressable>
          </View>

          {/* Slot name */}
          <Text style={[styles.slotName, { color: slotHidden ? colors.muted : colors.foreground }]}>
            {name}
          </Text>

          {/* Color swatch */}
          <Pressable
            onPress={() => setExpandedColorSlot(pickerOpen ? null : slot)}
            hitSlop={6}
            style={({ pressed }) => [styles.colorSwatch, pressed && { opacity: 0.7 }]}
          >
            <View
              style={[
                styles.swatchCircle,
                {
                  backgroundColor: color ?? colors.border,
                  borderColor: color ? "transparent" : colors.border,
                },
              ]}
            />
            {color ? (
              <Pressable
                onPress={(e) => { e.stopPropagation(); clearSlotColor(slot); }}
                hitSlop={6}
              >
                <IconSymbol name="xmark.circle.fill" size={14} color={colors.muted} />
              </Pressable>
            ) : null}
          </Pressable>

          {/* Show/hide toggle */}
          <Pressable
            onPress={() => toggleSlot(slot)}
            hitSlop={10}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, paddingLeft: 8 }]}
          >
            <IconSymbol
              name={slotHidden ? "eye.slash" : "eye"}
              size={20}
              color={slotHidden ? colors.muted : colors.primary}
            />
          </Pressable>

          {/* Move to other row */}
          <Pressable
            onPress={() => moveToRow(slot, rowNum === 1 ? 2 : 1)}
            hitSlop={10}
            style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, paddingLeft: 8 }]}
          >
            <IconSymbol
              name={rowNum === 1 ? "arrow.down.to.line" : "arrow.up.to.line"}
              size={18}
              color={colors.muted}
            />
          </Pressable>
        </View>

        {/* Color picker (inline expand) */}
        {pickerOpen ? (
          <View style={[styles.colorPickerWrap, { borderTopColor: colors.border, backgroundColor: colors.surface }]}>
            <ColorPickerPanel
              value={color ?? "#007AFF"}
              onChange={(hex) => setSlotColor(slot, hex)}
            />
          </View>
        ) : null}

        {!isLast && <View style={[styles.divider, { backgroundColor: colors.border, marginLeft: 48 }]} />}
      </>
    );
  };

  return (
    <ScreenContainer>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={({ pressed }) => [pressed && { opacity: 0.6 }]}>
          <IconSymbol name="chevron.left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          {zh ? "卡片标签显示" : "Card Tag Display"}
        </Text>
        <Pressable onPress={reset} hitSlop={8}>
          <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "500" }}>
            {zh ? "重置" : "Reset"}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>

        {/* ---- Recipe card slots ---- */}
        <View style={{ marginBottom: 8 }}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionLabel, { color: colors.muted, marginBottom: 0, flex: 1 }]}>
              {zh ? "配方卡片标签" : "Recipe Card Tags"}
            </Text>
            <Pressable onPress={allHidden ? showAll : hideAll} hitSlop={8}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>
                {allHidden
                  ? (zh ? "全部显示" : "Show All")
                  : (zh ? "全部隐藏" : "Hide All")}
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.hint, { color: colors.muted, marginBottom: 10 }]}>
            {zh
              ? "点击 ↓↑ 将标签移到另一排，上下箭头调整排内顺序，色块自定义颜色，眼睛图标显示/隐藏"
              : "Tap ↓↑ to move between rows, arrows to reorder within row, swatch for color, eye to toggle"}
          </Text>

          {/* Row 1 — Identity tags */}
          <Text style={[styles.rowGroupLabel, { color: colors.muted }]}>
            {zh ? "第一排（身份标签）" : "Row 1 — Identity"}
          </Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 12 }]}>
            {(() => {
              const r1 = order.filter((s) => row1Slots.includes(s));
              if (r1.length === 0) {
                return (
                  <View style={{ padding: 16 }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>
                      {zh ? "暂无标签，点击第二排标签的 ↑ 移入" : "Empty — tap ↑ on a row-2 tag to move here"}
                    </Text>
                  </View>
                );
              }
              return r1.map((slot, i) => (
                <SlotRow key={slot} slot={slot} isFirst={i === 0} isLast={i === r1.length - 1} rowNum={1} />
              ));
            })()}
          </View>

          {/* Row 2 — Experience tags */}
          <Text style={[styles.rowGroupLabel, { color: colors.muted }]}>
            {zh ? "第二排（体验标签）" : "Row 2 — Experience"}
          </Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border, marginBottom: 20 }]}>
            {(() => {
              const r2 = order.filter((s) => s !== "flavors" && !row1Slots.includes(s));
              if (r2.length === 0) {
                return (
                  <View style={{ padding: 16 }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>
                      {zh ? "暂无标签，点击第一排标签的 ↓ 移入" : "Empty — tap ↓ on a row-1 tag to move here"}
                    </Text>
                  </View>
                );
              }
              return r2.map((slot, i) => (
                <SlotRow key={slot} slot={slot} isFirst={i === 0} isLast={i === r2.length - 1} rowNum={2} />
              ));
            })()}
          </View>
        </View>

        {/* Bottle card fields */}
        <Section title={zh ? "酒款卡片信息" : "Bottle Card Fields"}>
          <ToggleRow label={zh ? "风味标签" : "Flavor Tags"} sub={zh ? "AI 识别或手动添加的风味词" : "AI-detected or manual flavor tags"} value={settings.showBottleFlavorTags} onToggle={() => toggle("showBottleFlavorTags")} />
          <ToggleRow label={zh ? "风格子分类" : "Style"} value={settings.showBottleStyle} onToggle={() => toggle("showBottleStyle")} />
          <ToggleRow label={zh ? "度数 ABV" : "ABV"} value={settings.showBottleAbv} onToggle={() => toggle("showBottleAbv")} />
          <ToggleRow label={zh ? "容量规格" : "Volume"} value={settings.showBottleVolume} onToggle={() => toggle("showBottleVolume")} />
          <ToggleRow label={zh ? "产地" : "Origin"} value={settings.showBottleOrigin} onToggle={() => toggle("showBottleOrigin")} />
          <ToggleRow label={zh ? "评分" : "Rating"} value={settings.showBottleRating} onToggle={() => toggle("showBottleRating")} last />
        </Section>

        {/* Homemade card */}
        <Section title={zh ? "自制卡片信息" : "Homemade Card Fields"}>
          <ToggleRow label={zh ? "风味标签" : "Flavor Tags"} value={settings.showHomemadeTags} onToggle={() => toggle("showHomemadeTags")} last />
        </Section>

        {/* Max tags per card */}
        <View style={{ marginBottom: 20 }}>
          <Text style={[styles.sectionLabel, { color: colors.muted }]}>
            {zh ? "每张卡片最多显示几个标签" : "Max tags per card"}
          </Text>
          <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border, flexDirection: "row", flexWrap: "wrap", padding: 12, gap: 8 }]}>
            {MAX_OPTIONS.map((n) => {
              const active = settings.maxTagsPerCard === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => setMax(n)}
                  style={[
                    styles.maxChip,
                    { backgroundColor: active ? colors.primary : "transparent", borderColor: active ? colors.primary : colors.border },
                  ]}
                >
                  <Text style={{ fontSize: 14, fontWeight: "600", color: active ? "#FFF" : colors.foreground }}>
                    {n === 0 ? (zh ? "全部" : "All") : n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: colors.muted }]}>
            {zh ? '设为"全部"则显示所有风味标签，不受数量限制' : 'Set to "All" to show all flavor tags with no limit'}
          </Text>
        </View>

      </ScrollView>
    </ScreenContainer>
  );
}

import React from "react";

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 6,
    marginLeft: 4,
  },
  group: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "400",
  },
  rowSub: {
    fontSize: 12,
    marginTop: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  maxChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 48,
    alignItems: "center",
  },
  hint: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
    lineHeight: 17,
  },
  rowGroupLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
    marginLeft: 4,
  },
  slotRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  arrowCol: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    width: 20,
  },
  slotName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "400",
  },
  colorSwatch: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  swatchCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
  },
  colorPickerWrap: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
