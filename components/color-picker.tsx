import { useEffect, useMemo, useState } from "react";
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";

/* ---------- 颜色换算工具 ---------- */

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to2 = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return `#${s.toUpperCase()}`;
}

/* ---------- 预设色板(iOS 系统色 + 扩展) ---------- */

export const PRESET_COLORS = [
  "#007AFF", "#FF3B30", "#34C759", "#5856D6", "#FF9500", "#AF52DE", "#00C7BE", "#FF2D55",
  "#5AC8FA", "#FFCC00", "#8E8E93", "#A2845E", "#D2691E", "#2E8B57", "#800020", "#4B0082",
  "#708090", "#DAA520", "#C71585", "#191970", "#556B2F", "#B22222", "#20B2AA", "#F4A460",
] as const;

/* ---------- 滑条 ---------- */

function GradientTrack({ hues, height = 26 }: { hues: string[]; height?: number }) {
  // 用多段色块模拟渐变(避免依赖 linear-gradient 原生模块)
  return (
    <View style={[styles.trackRow, { height }]} pointerEvents="none">
      {hues.map((c, i) => (
        <View key={i} style={{ flex: 1, backgroundColor: c }} />
      ))}
    </View>
  );
}

function SliderRow({
  value,
  onChange,
  trackColors,
  thumbColor,
}: {
  value: number; // 0-1
  onChange: (v: number) => void;
  trackColors: string[];
  thumbColor: string;
}) {
  const colors = useColors();
  const [width, setWidth] = useState(0);

  const setFromX = (x: number) => {
    if (width <= 0) return;
    onChange(Math.max(0, Math.min(1, x / width)));
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onBegin((e) => runOnJS(setFromX)(e.x))
        .onUpdate((e) => runOnJS(setFromX)(e.x)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [width],
  );

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.sliderWrap}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={styles.trackClip}>
          <GradientTrack hues={trackColors} />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            {
              left: Math.max(0, Math.min(width - 22, value * width - 11)),
              backgroundColor: thumbColor,
              borderColor: colors.background,
            },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

/* ---------- 主组件 ---------- */

export function ColorPickerPanel({
  value,
  onChange,
}: {
  /** 当前颜色(HEX) */
  value: string;
  /** 选定颜色回调(HEX 大写) */
  onChange: (hex: string) => void;
}) {
  const colors = useColors();
  const { t } = useI18n();
  const initial = hexToHsv(value) ?? { h: 210, s: 0.85, v: 0.95 };
  const [h, setH] = useState(initial.h);
  const [s, setS] = useState(initial.s);
  const [v, setV] = useState(initial.v);
  const [hexInput, setHexInput] = useState(value.toUpperCase());
  const [expanded, setExpanded] = useState(false);

  const current = hsvToHex(h, s, v);

  // 外部 value 变化时同步(如切换编辑对象)
  useEffect(() => {
    const parsed = hexToHsv(value);
    if (parsed && value.toUpperCase() !== current) {
      setH(parsed.h);
      setS(parsed.s);
      setV(parsed.v);
    }
    setHexInput(value.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (hex: string) => {
    onChange(hex);
    setHexInput(hex);
  };

  const applyHsv = (nh: number, ns: number, nv: number) => {
    setH(nh);
    setS(ns);
    setV(nv);
    commit(hsvToHex(nh, ns, nv));
  };

  const hueTrack = useMemo(
    () => Array.from({ length: 24 }, (_, i) => hsvToHex((i / 23) * 359.9, 1, 1)),
    [],
  );
  const satTrack = useMemo(
    () => Array.from({ length: 16 }, (_, i) => hsvToHex(h, i / 15, v)),
    [h, v],
  );
  const valTrack = useMemo(
    () => Array.from({ length: 16 }, (_, i) => hsvToHex(h, s, i / 15)),
    [h, s],
  );

  return (
    <View>
      {/* 预设色板 */}
      <View style={styles.presetWrap}>
        {PRESET_COLORS.map((c) => (
          <Pressable key={c} onPress={() => commit(c)} hitSlop={2}>
            <View
              style={[
                styles.presetDot,
                { backgroundColor: c },
                value.toUpperCase() === c && { borderWidth: 2, borderColor: colors.foreground },
              ]}
            />
          </Pressable>
        ))}
        {/* 自定义取色开关 */}
        <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={2}>
          <View
            style={[
              styles.presetDot,
              styles.customDot,
              { borderColor: expanded ? colors.primary : colors.border },
            ]}
          >
            <IconSymbol name={expanded ? "chevron.up" : "plus"} size={14} color={colors.muted} />
          </View>
        </Pressable>
      </View>

      {expanded ? (
        <View style={[styles.customPanel, { borderColor: colors.border }]}>
          {/* 当前颜色预览 + HEX 输入 */}
          <View style={styles.hexRow}>
            <View style={[styles.previewSwatch, { backgroundColor: current, borderColor: colors.border }]} />
            <TextInput
              value={hexInput}
              onChangeText={setHexInput}
              onSubmitEditing={() => {
                const hex = normalizeHex(hexInput);
                if (hex) {
                  const parsed = hexToHsv(hex);
                  if (parsed) {
                    setH(parsed.h);
                    setS(parsed.s);
                    setV(parsed.v);
                  }
                  commit(hex);
                } else {
                  setHexInput(current);
                }
              }}
              onBlur={() => {
                const hex = normalizeHex(hexInput);
                if (hex) {
                  const parsed = hexToHsv(hex);
                  if (parsed) {
                    setH(parsed.h);
                    setS(parsed.s);
                    setV(parsed.v);
                  }
                  commit(hex);
                } else {
                  setHexInput(current);
                }
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              placeholder="#RRGGBB"
              placeholderTextColor={colors.muted}
              style={[
                styles.hexInput,
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
              ]}
            />
            <Text style={[styles.hexLabel, { color: colors.muted }]}>{t("color.hexHint")}</Text>
          </View>

          {/* 色相 / 饱和度 / 明度 滑条 */}
          <Text style={[styles.sliderLabel, { color: colors.muted }]}>{t("color.hue")}</Text>
          <SliderRow value={h / 360} onChange={(x) => applyHsv(x * 359.9, s, v)} trackColors={hueTrack} thumbColor={hsvToHex(h, 1, 1)} />
          <Text style={[styles.sliderLabel, { color: colors.muted }]}>{t("color.saturation")}</Text>
          <SliderRow value={s} onChange={(x) => applyHsv(h, x, v)} trackColors={satTrack} thumbColor={current} />
          <Text style={[styles.sliderLabel, { color: colors.muted }]}>{t("color.brightness")}</Text>
          <SliderRow value={v} onChange={(x) => applyHsv(h, s, x)} trackColors={valTrack} thumbColor={current} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  presetWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  presetDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  customDot: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  customPanel: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hexRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  previewSwatch: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hexInput: {
    width: 110,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "web" ? 8 : 6,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  hexLabel: {
    flex: 1,
    fontSize: 11,
    lineHeight: 14,
  },
  sliderLabel: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 8,
    marginBottom: 4,
  },
  sliderWrap: {
    height: 26,
    justifyContent: "center",
  },
  trackClip: {
    borderRadius: 13,
    overflow: "hidden",
    height: 26,
  },
  trackRow: {
    flexDirection: "row",
  },
  thumb: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
