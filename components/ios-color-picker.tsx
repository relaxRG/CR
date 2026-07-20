/**
 * iOS 系统风格颜色选择器（专项B）
 * 三模式：网格 | 光谱 | 滑块（RGB + Hex）
 * 底部：当前色预览 + 常用色圆点 + ＋保存
 * 接口：value (hex string) + onChange (hex string)
 * 使用方式：底部抽屉内嵌，不含 Modal 包装（由调用方控制显隐）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputEndEditingEventData,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/use-colors";

// ─── 颜色工具 ────────────────────────────────────────────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  const n = parseInt(clean, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = h / 6;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, q, p, p, t, v],
    [t, v, v, q, p, p],
    [p, p, t, v, v, q],
  ].map((arr) => arr[i % 6] ?? 0);
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function hueToHex(h: number): string {
  const { r, g, b } = hsvToRgb(h, 1, 1);
  return rgbToHex(r, g, b);
}

// ─── 预设网格色板（120色，12列×10行）────────────────────────────────────────
const GRID_COLORS: string[] = (() => {
  const cols: string[] = [];
  // 行1-9：色相 × 饱和度/明度变化
  const hues = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  const svPairs = [
    [1, 1], [0.8, 1], [0.6, 1], [0.4, 1], [0.2, 1],
    [1, 0.8], [0.8, 0.8], [0.6, 0.8], [0.4, 0.8], [0.2, 0.8],
  ];
  for (const [s, v] of svPairs) {
    for (const h of hues) {
      const { r, g, b } = hsvToRgb(h / 360, s, v);
      cols.push(rgbToHex(r, g, b));
    }
  }
  return cols;
})();

// 网格单元固定尺寸
const GRID_CELL_SIZE = 24;
const GRID_GAP = 5;

// ─── 常用色存储 key ──────────────────────────────────────────────────────────
const RECENT_KEY = "iosColorPicker.recent.v1";
const MAX_RECENT = 12;

async function loadRecent(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
async function saveRecent(colors: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(RECENT_KEY, JSON.stringify(colors));
  } catch { /* ignore */ }
}

// ─── 滑块行 ─────────────────────────────────────────────────────────────────
function SliderRow({
  value,
  onChange,
  trackColors,
  thumbColor,
}: {
  value: number;
  onChange: (v: number) => void;
  trackColors: string[];
  thumbColor: string;
}) {
  const [width, setWidth] = useState(0);
  const handleLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const handleTouch = useCallback(
    (e: GestureResponderEvent) => {
      if (width <= 0) return;
      const x = e.nativeEvent.locationX;
      onChange(Math.max(0, Math.min(1, x / width)));
    },
    [width, onChange],
  );
  const segments = trackColors.length - 1;
  return (
    <View style={sliderStyles.wrap} onLayout={handleLayout}>
      <View style={sliderStyles.trackClip}>
        <View style={sliderStyles.trackRow}>
          {trackColors.slice(0, segments).map((c, i) => (
            <View
              key={i}
              style={{ flex: 1, height: 26, backgroundColor: c }}
            />
          ))}
        </View>
      </View>
      {/* Gesture capture layer */}
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouch}
        onResponderMove={handleTouch}
      />
      {/* Thumb */}
      <View
        style={[
          sliderStyles.thumb,
          {
            left: Math.max(0, Math.min(1, value)) * Math.max(0, width - 22),
            backgroundColor: thumbColor,
            borderColor: "#FFFFFF",
          },
        ]}
        pointerEvents="none"
      />
    </View>
  );
}
const sliderStyles = StyleSheet.create({
  wrap: { height: 26, justifyContent: "center", marginBottom: 2 },
  trackClip: { borderRadius: 13, overflow: "hidden", height: 26 },
  trackRow: { flexDirection: "row", height: 26 },
  thumb: {
    position: "absolute",
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 3,
    top: 2,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});

// ─── 光谱选择器（二维 SV 面板 + 色相条）────────────────────────────────────
function SpectrumPicker({
  h, s, v,
  onHsvChange,
}: {
  h: number; s: number; v: number;
  onHsvChange: (h: number, s: number, v: number) => void;
}) {
  const [panelSize, setPanelSize] = useState({ w: 0, h: 0 });
  const hueTrack = useMemo(
    () => Array.from({ length: 13 }, (_, i) => hueToHex(i / 12)),
    [],
  );
  const handleSVTouch = useCallback(
    (e: GestureResponderEvent) => {
      if (panelSize.w <= 0 || panelSize.h <= 0) return;
      const nx = Math.max(0, Math.min(1, e.nativeEvent.locationX / panelSize.w));
      const ny = Math.max(0, Math.min(1, e.nativeEvent.locationY / panelSize.h));
      onHsvChange(h, nx, 1 - ny);
    },
    [panelSize, h, onHsvChange],
  );
  return (
    <View style={{ gap: 12 }}>
      {/* SV 面板 */}
      <View
        style={[specStyles.svPanel, { backgroundColor: hueToHex(h) }]}
        onLayout={(e) => setPanelSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleSVTouch}
        onResponderMove={handleSVTouch}
      >
      {/* White gradient overlay */}
      {/* 白色渐变：从左(白)到右(透明)，用多段色块模拟 */}
      <View style={[StyleSheet.absoluteFill, { flexDirection: "row" }]} pointerEvents="none">
        {Array.from({ length: 20 }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: `rgba(255,255,255,${(1 - i / 19).toFixed(2)})` }} />
        ))}
      </View>
      {/* Black gradient overlay */}
      {/* 黑色渐变：从上(透明)到下(黑)，用多段色块模拟 */}
      <View style={[StyleSheet.absoluteFill, { flexDirection: "column" }]} pointerEvents="none">
        {Array.from({ length: 20 }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${(i / 19).toFixed(2)})` }} />
        ))}
      </View>
        {/* Cursor */}
        <View
          style={[
            specStyles.cursor,
            {
              left: s * (panelSize.w - 16),
              top: (1 - v) * (panelSize.h - 16),
            },
          ]}
          pointerEvents="none"
        />
      </View>
      {/* 色相滑块 */}
      <SliderRow
        value={h}
        onChange={(nh) => onHsvChange(nh, s, v)}
        trackColors={hueTrack}
        thumbColor={hueToHex(h)}
      />
    </View>
  );
}
const specStyles = StyleSheet.create({
  svPanel: {
    height: 180,
    borderRadius: 12,
    overflow: "hidden",
  },
  whiteOverlay: {
  },
  blackOverlay: {
  },
  cursor: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
});

// ─── 主组件 ──────────────────────────────────────────────────────────────────
type Mode = "grid" | "spectrum" | "sliders";

interface IOSColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

export function IOSColorPicker({ value, onChange }: IOSColorPickerProps) {
  const colors = useColors();
  const [mode, setMode] = useState<Mode>("grid");
  const [recent, setRecent] = useState<string[]>([]);
  const [, setGridWidth] = useState(0);

  // HSV state（滑块/光谱模式用）
  const initHsv = useMemo(() => {
    const rgb = hexToRgb(value);
    if (!rgb) return { h: 0, s: 1, v: 1 };
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [h, setH] = useState(initHsv.h);
  const [s, setS] = useState(initHsv.s);
  const [v, setV] = useState(initHsv.v);

  // 当外部 value 变化时同步 HSV
  useEffect(() => {
    const rgb = hexToRgb(value);
    if (!rgb) return;
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    setH(hsv.h); setS(hsv.s); setV(hsv.v);
  }, [value]);

  // Hex 输入框
  const [hexInput, setHexInput] = useState(value.toUpperCase());
  useEffect(() => { setHexInput(value.toUpperCase()); }, [value]);

  // RGB 滑块
  const currentRgb = useMemo(() => hsvToRgb(h, s, v), [h, s, v]);
  const currentHex = useMemo(() => rgbToHex(currentRgb.r, currentRgb.g, currentRgb.b), [currentRgb]);

  // 加载常用色
  useEffect(() => { loadRecent().then(setRecent); }, []);

  const commit = useCallback((hex: string) => {
    onChange(hex);
    const rgb = hexToRgb(hex);
    if (rgb) {
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      setH(hsv.h); setS(hsv.s); setV(hsv.v);
    }
  }, [onChange]);

  const applyHsv = useCallback((nh: number, ns: number, nv: number) => {
    setH(nh); setS(ns); setV(nv);
    const { r, g, b } = hsvToRgb(nh, ns, nv);
    onChange(rgbToHex(r, g, b));
  }, [onChange]);

  const saveToRecent = useCallback(async () => {
    const next = [currentHex, ...recent.filter((c) => c !== currentHex)].slice(0, MAX_RECENT);
    setRecent(next);
    await saveRecent(next);
  }, [currentHex, recent]);

  const commitHex = useCallback((raw: string) => {
    const clean = raw.replace("#", "").toUpperCase();
    if (clean.length === 6 && /^[0-9A-F]+$/.test(clean)) {
      commit("#" + clean);
    } else {
      setHexInput(value.toUpperCase());
    }
  }, [commit, value]);

  // 色相渐变轨道
  const hueTrack = useMemo(() => Array.from({ length: 13 }, (_, i) => hueToHex(i / 12)), []);
  const satTrack = useMemo(() => [hsvToRgb(h, 0, v), hsvToRgb(h, 1, v)].map(({ r, g, b }) => rgbToHex(r, g, b)), [h, v]);
  const valTrack = useMemo(() => [rgbToHex(0, 0, 0), hueToHex(h)], [h]);
  const rTrack = useMemo(() => [rgbToHex(0, currentRgb.g, currentRgb.b), rgbToHex(255, currentRgb.g, currentRgb.b)], [currentRgb]);
  const gTrack = useMemo(() => [rgbToHex(currentRgb.r, 0, currentRgb.b), rgbToHex(currentRgb.r, 255, currentRgb.b)], [currentRgb]);
  const bTrack = useMemo(() => [rgbToHex(currentRgb.r, currentRgb.g, 0), rgbToHex(currentRgb.r, currentRgb.g, 255)], [currentRgb]);

  const MODES: { key: Mode; label: string }[] = [
    { key: "grid", label: "网格" },
    { key: "spectrum", label: "光谱" },
    { key: "sliders", label: "滑块" },
  ];

  return (
    <View style={pickerStyles.root}>
      {/* Segmented 模式切换 */}
      <View style={[pickerStyles.seg, { backgroundColor: colors.border + "55" }]}>
        {MODES.map((m) => (
          <Pressable
            key={m.key}
            onPress={() => setMode(m.key)}
            style={[
              pickerStyles.segTab,
              mode === m.key && { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
            ]}
          >
            <Text style={[pickerStyles.segText, { color: mode === m.key ? colors.foreground : colors.muted }]}>
              {m.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* 内容区 */}
      {mode === "grid" && (
        <View
          style={pickerStyles.gridWrap}
          onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}
        >
          {GRID_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => commit(c)}
              style={[
                {
                  width: GRID_CELL_SIZE,
                  height: GRID_CELL_SIZE,
                  borderRadius: 5,
                  backgroundColor: c,
                },
                value.toUpperCase() === c && pickerStyles.gridCellActive,
              ]}
            />
          ))}
        </View>
      )}

      {mode === "spectrum" && (
        <SpectrumPicker h={h} s={s} v={v} onHsvChange={applyHsv} />
      )}

      {mode === "sliders" && (
        <View style={{ gap: 10 }}>
          {/* Hex 输入 */}
          <View style={pickerStyles.hexRow}>
            <View style={[pickerStyles.swatch, { backgroundColor: currentHex, borderColor: colors.border }]} />
            <TextInput
              value={hexInput}
              onChangeText={setHexInput}
              onEndEditing={(e: NativeSyntheticEvent<TextInputEndEditingEventData>) => commitHex(e.nativeEvent.text)}
              onSubmitEditing={() => commitHex(hexInput)}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              placeholder="#RRGGBB"
              placeholderTextColor={colors.muted}
              style={[pickerStyles.hexInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
            />
          </View>
          {/* R 滑块 */}
          <Text style={[pickerStyles.sliderLabel, { color: colors.muted }]}>R  {currentRgb.r}</Text>
          <SliderRow value={currentRgb.r / 255} onChange={(x) => { const nr = Math.round(x * 255); applyHsv(...Object.values(rgbToHsv(nr, currentRgb.g, currentRgb.b)) as [number, number, number]); }} trackColors={rTrack} thumbColor={currentHex} />
          {/* G 滑块 */}
          <Text style={[pickerStyles.sliderLabel, { color: colors.muted }]}>G  {currentRgb.g}</Text>
          <SliderRow value={currentRgb.g / 255} onChange={(x) => { const ng = Math.round(x * 255); applyHsv(...Object.values(rgbToHsv(currentRgb.r, ng, currentRgb.b)) as [number, number, number]); }} trackColors={gTrack} thumbColor={currentHex} />
          {/* B 滑块 */}
          <Text style={[pickerStyles.sliderLabel, { color: colors.muted }]}>B  {currentRgb.b}</Text>
          <SliderRow value={currentRgb.b / 255} onChange={(x) => { const nb = Math.round(x * 255); applyHsv(...Object.values(rgbToHsv(currentRgb.r, currentRgb.g, nb)) as [number, number, number]); }} trackColors={bTrack} thumbColor={currentHex} />
        </View>
      )}

      {/* 底部：常用色 + 预览 + 保存 */}
      <View style={[pickerStyles.footer, { borderTopColor: colors.border }]}>
        <View style={[pickerStyles.previewSwatch, { backgroundColor: currentHex, borderColor: colors.border }]} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
          {recent.map((c) => (
            <Pressable
              key={c}
              onPress={() => commit(c)}
              style={[
                pickerStyles.recentDot,
                { backgroundColor: c },
                value.toUpperCase() === c.toUpperCase() && { borderWidth: 2.5, borderColor: colors.foreground },
              ]}
            />
          ))}
        </ScrollView>
        <Pressable
          onPress={saveToRecent}
          style={({ pressed }) => [pickerStyles.saveBtn, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
        >
          <Text style={[pickerStyles.saveBtnText, { color: colors.muted }]}>＋</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * 底部抽屉包装版（带 Modal + 标题栏）
 */
export function IOSColorPickerSheet({
  visible,
  value,
  onChange,
  onClose,
  title = "选择颜色",
}: {
  visible: boolean;
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const colors = useColors();
  if (!visible) return null;
  return (
    <View style={[inlineStyles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[inlineStyles.header, { borderBottomColor: colors.border }]}>
        <Text style={[inlineStyles.headerTitle, { color: colors.foreground }]}>{title}</Text>
        <Pressable
          onPress={onClose}
          style={({ pressed }) => [inlineStyles.closeBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={[inlineStyles.closeBtnText, { color: colors.primary }]}>完成</Text>
        </Pressable>
      </View>
      <View style={inlineStyles.body}>
        <IOSColorPicker value={value} onChange={onChange} />
      </View>
    </View>
  );
}

const inlineStyles = StyleSheet.create({
  container: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  closeBtn: { paddingVertical: 4, paddingHorizontal: 2 },
  closeBtnText: { fontSize: 15, fontWeight: "500" },
  body: { padding: 14 },
});

const pickerStyles = StyleSheet.create({
  root: { gap: 16 },
  seg: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 2,
    gap: 2,
  },
  segTab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 8,
  },
  segText: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  gridWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  gridCellActive: {
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  hexRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  hexInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "web" ? 8 : 6,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
  },
  sliderLabel: { fontSize: 11, lineHeight: 14, marginTop: 4 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  previewSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  recentDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  saveBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { fontSize: 16, lineHeight: 20 },
});

