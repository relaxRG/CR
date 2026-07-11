import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";

export interface QuickChipOption {
  value: string;
  label: string;
  color?: string;
}

export interface QuickParentOption extends QuickChipOption {
  /** 该大分类下的子选项;为空则无子分类行 */
  children?: QuickChipOption[];
}

/** 快捷筛选选中状态:大分类 → 子分类值集合(空数组=仅选大分类) */
export type QuickSelection = Record<string, string[]>;

/**
 * 快捷筛选 chip 行(与 Filter 面板完全独立):
 * - 点大分类 chip = 选中并在下方展开其子分类行;再点 = 取消选中并收起
 * - 子分类可多选,细化该大分类的筛选范围
 * - 选中/展开状态由父级持久化,明确删除(再点/清除)前一直保留
 */
export function QuickFilterChips({
  parents,
  selection,
  onChange,
  leading,
  allLabel,
}: {
  parents: QuickParentOption[];
  selection: QuickSelection;
  onChange: (next: QuickSelection) => void;
  /** 行首自定义元素(如 Filter 面板入口按钮) */
  leading?: React.ReactNode;
  /** “全部”chip 文案;点击清空全部快捷选择 */
  allLabel: string;
}) {
  const colors = useColors();
  const selectedParents = Object.keys(selection);
  const noneSelected = selectedParents.length === 0;

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const toggleParent = (value: string) => {
    haptic();
    const next: QuickSelection = { ...selection };
    if (next[value]) delete next[value];
    else next[value] = [];
    onChange(next);
  };

  const toggleChild = (parent: string, child: string) => {
    haptic();
    const cur = selection[parent] ?? [];
    const nextChildren = cur.includes(child)
      ? cur.filter((c) => c !== child)
      : [...cur, child];
    onChange({ ...selection, [parent]: nextChildren });
  };

  const chipStyle = (active: boolean, tint?: string) => [
    styles.chip,
    {
      backgroundColor: active ? (tint ?? colors.primary) : colors.surface,
      borderColor: active ? (tint ?? colors.primary) : colors.border,
    },
  ];
  const chipTextStyle = (active: boolean) => [
    styles.chipText,
    { color: active ? "#FFFFFF" : colors.muted },
  ];

  return (
    <View>
      {/* 大分类行 */}
      <View style={styles.rowWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {leading}
          <Pressable
            style={chipStyle(noneSelected)}
            onPress={() => {
              haptic();
              onChange({});
            }}
          >
            <Text style={chipTextStyle(noneSelected)}>{allLabel}</Text>
          </Pressable>
          {parents.map((p) => {
            const active = !!selection[p.value];
            const childCount = selection[p.value]?.length ?? 0;
            return (
              <Pressable
                key={p.value}
                style={chipStyle(active, p.color)}
                onPress={() => toggleParent(p.value)}
              >
                <View style={styles.chipInner}>
                  <Text style={chipTextStyle(active)}>
                    {p.label}
                    {childCount > 0 ? ` · ${childCount}` : ""}
                  </Text>
                  {p.children && p.children.length > 0 ? (
                    <IconSymbol
                      name={active ? "chevron.up" : "chevron.down"}
                      size={12}
                      color={active ? "#FFFFFF" : colors.muted}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* 子分类行:每个已选大分类展开一行 */}
      {parents
        .filter((p) => selection[p.value] && (p.children?.length ?? 0) > 0)
        .map((p) => {
          const sel = selection[p.value] ?? [];
          const tint = p.color ?? colors.primary;
          return (
            <View key={`sub-${p.value}`} style={styles.subRowWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.row}
              >
                <View style={[styles.subLabelWrap, { borderColor: tint + "55" }]}>
                  <Text style={[styles.subLabel, { color: tint }]}>{p.label}</Text>
                </View>
                {p.children!.map((c) => {
                  const active = sel.includes(c.value);
                  return (
                    <Pressable
                      key={c.value}
                      style={[
                        styles.subChip,
                        {
                          backgroundColor: active ? tint : colors.surface,
                          borderColor: active ? tint : colors.border,
                        },
                      ]}
                      onPress={() => toggleChild(p.value, c.value)}
                    >
                      {active ? <IconSymbol name="checkmark" size={11} color="#FFFFFF" /> : null}
                      <Text
                        style={[
                          styles.subChipText,
                          { color: active ? "#FFFFFF" : colors.foreground },
                        ]}
                      >
                        {c.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: {
    marginBottom: 8,
  },
  subRowWrap: {
    marginBottom: 8,
  },
  row: {
    paddingHorizontal: 20,
    gap: 8,
    alignItems: "center",
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  subLabelWrap: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  subChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  subChipText: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
});
