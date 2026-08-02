/**
 * 供应商月度进货趋势折线图
 * 使用 react-native-svg 绘制，支持多供应商多月份折线
 */
import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { useColors } from "@/hooks/use-colors";
import { WineMonthlySnapshot } from "@/lib/wine/types";

interface Props {
  snapshots: WineMonthlySnapshot[];
  /** 最多显示几个供应商（按累计金额排序），默认 5 */
  topN?: number;
}

/** 固定调色板（与 App 主色系协调） */
const PALETTE = [
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#84CC16", // lime
];

const CHART_H = 180;
const CHART_PADDING_LEFT = 52;
const CHART_PADDING_RIGHT = 16;
const CHART_PADDING_TOP = 16;
const CHART_PADDING_BOTTOM = 32;

export function WineSupplierTrendChart({ snapshots, topN = 5 }: Props) {
  const colors = useColors();

  // 按时间升序排列快照
  const sortedSnaps = useMemo(
    () => [...snapshots].sort((a, b) => a.importedAt.localeCompare(b.importedAt)),
    [snapshots]
  );

  // 收集所有供应商，按累计金额取 topN
  const topSuppliers = useMemo(() => {
    const cumul: Record<string, number> = {};
    sortedSnaps.forEach((snap) => {
      Object.entries(snap.supplierTotals).forEach(([sup, amt]) => {
        cumul[sup] = (cumul[sup] ?? 0) + amt;
      });
    });
    return Object.entries(cumul)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([sup]) => sup);
  }, [sortedSnaps, topN]);

  // 每个供应商的月度金额序列
  const series = useMemo(
    () =>
      topSuppliers.map((sup) => ({
        name: sup,
        data: sortedSnaps.map((snap) => snap.supplierTotals[sup] ?? 0),
      })),
    [topSuppliers, sortedSnaps]
  );

  const months = sortedSnaps.map((s) => s.monthLabel);
  const n = months.length;

  if (n === 0 || topSuppliers.length === 0) {
    return (
      <View style={[styles.empty, { borderColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.muted }]}>暂无多月份数据，导入更多月份后显示趋势图</Text>
      </View>
    );
  }

  // 计算 Y 轴范围
  const allValues = series.flatMap((s) => s.data);
  const maxVal = Math.max(...allValues, 1);
  const yMax = Math.ceil(maxVal / 1000) * 1000;

  // 图表宽度（根据月份数量动态调整，最小 280）
  const chartWidth = Math.max(280, n * 80 + CHART_PADDING_LEFT + CHART_PADDING_RIGHT);
  const innerW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
  const innerH = CHART_H - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  // 坐标转换
  const xOf = (i: number) =>
    CHART_PADDING_LEFT + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yOf = (v: number) =>
    CHART_PADDING_TOP + innerH - (v / yMax) * innerH;

  // Y 轴刻度
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    v: yMax * t,
    y: yOf(yMax * t),
  }));

  return (
    <View style={styles.wrap}>
      {/* 图例 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.legend}>
        {topSuppliers.map((sup, i) => (
          <View key={sup} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
            <Text style={[styles.legendLabel, { color: colors.foreground }]} numberOfLines={1}>
              {sup}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* 折线图 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={chartWidth} height={CHART_H + 4}>
          {/* 背景网格线 */}
          {yTicks.map((tick, i) => (
            <React.Fragment key={i}>
              <Line
                x1={CHART_PADDING_LEFT}
                y1={tick.y}
                x2={chartWidth - CHART_PADDING_RIGHT}
                y2={tick.y}
                stroke={colors.border}
                strokeWidth={1}
                strokeDasharray={i === 0 ? undefined : "3,3"}
              />
              <SvgText
                x={CHART_PADDING_LEFT - 4}
                y={tick.y + 4}
                fontSize={9}
                fill={colors.muted}
                textAnchor="end"
              >
                {tick.v >= 10000
                  ? `${(tick.v / 10000).toFixed(1)}万`
                  : tick.v >= 1000
                  ? `${(tick.v / 1000).toFixed(0)}k`
                  : tick.v.toFixed(0)}
              </SvgText>
            </React.Fragment>
          ))}

          {/* X 轴月份标签 */}
          {months.map((m, i) => (
            <SvgText
              key={i}
              x={xOf(i)}
              y={CHART_H - 4}
              fontSize={9}
              fill={colors.muted}
              textAnchor="middle"
            >
              {m.replace(/\d{4}年/, "").replace("月", "月")}
            </SvgText>
          ))}

          {/* 折线 + 数据点 */}
          {series.map((s, si) => {
            const color = PALETTE[si % PALETTE.length];
            // 构建 path
            const pts = s.data.map((v, i) => ({ x: xOf(i), y: yOf(v) }));
            const d = pts
              .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
              .join(" ");
            return (
              <React.Fragment key={s.name}>
                <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={color} stroke="#fff" strokeWidth={1.5} />
                ))}
              </React.Fragment>
            );
          })}
        </Svg>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  legend: { marginBottom: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 14, gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, maxWidth: 80 },
  empty: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
    marginTop: 8,
  },
  emptyText: { fontSize: 12, textAlign: "center", lineHeight: 18 },
});
