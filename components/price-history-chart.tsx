/**
 * 价格历史折线图组件
 * - SVG 折线图（react-native-svg）
 * - 涨跌标注（红色上箭头 / 绿色下箭头）
 * - 供应商颜色区分
 * - 支持多供应商对比模式
 */
import React, { useCallback, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { useColors } from "@/hooks/use-colors";
import { PriceHistoryEntry } from "@/lib/food/types";

// 供应商颜色池
const SUPPLIER_COLORS = [
  "#0a7ea4", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6",
  "#EC4899", "#14B8A6", "#F97316", "#6366F1", "#84CC16",
];

function getSupplierColor(supplier: string, allSuppliers: string[]): string {
  const idx = allSuppliers.indexOf(supplier);
  return SUPPLIER_COLORS[idx % SUPPLIER_COLORS.length];
}

interface PriceChartProps {
  /** 价格历史（按时间升序） */
  history: PriceHistoryEntry[];
  /** 图表宽度 */
  width?: number;
  /** 图表高度 */
  height?: number;
  /** 单位（如 kg、个） */
  unit?: string;
  /** 是否显示供应商图例 */
  showLegend?: boolean;
}

export const PriceHistoryChart = React.memo(function PriceHistoryChart({
  history,
  width = 320,
  height = 160,
  showLegend = true,
}: PriceChartProps) {
  const colors = useColors();

  // 按日期升序排列
  const sorted = useMemo(
    () => [...history].sort((a, b) => a.date.localeCompare(b.date)),
    [history]
  );

  const suppliers = useMemo(
    () => Array.from(new Set(sorted.map((e) => e.supplier))).filter(Boolean),
    [sorted]
  );

  const prices = sorted.map((e) => e.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 1;

  // 图表内边距
  const PAD_LEFT = 42;
  const PAD_RIGHT = 16;
  const PAD_TOP = 20;
  const PAD_BOTTOM = 28;
  const chartW = width - PAD_LEFT - PAD_RIGHT;
  const chartH = height - PAD_TOP - PAD_BOTTOM;

  // 坐标映射
  const toX = useCallback(
    (i: number) => PAD_LEFT + (sorted.length <= 1 ? chartW / 2 : (i / (sorted.length - 1)) * chartW),
    [chartW, sorted.length],
  );
  const toY = useCallback(
    (price: number) => PAD_TOP + chartH - ((price - minPrice) / priceRange) * chartH,
    [chartH, minPrice, priceRange],
  );

  // 折线路径（按供应商分组）
  const linesBySupplier = useMemo(() => {
    const map: Record<string, { x: number; y: number; entry: PriceHistoryEntry; idx: number }[]> = {};
    sorted.forEach((entry, i) => {
      if (!map[entry.supplier]) map[entry.supplier] = [];
      map[entry.supplier].push({ x: toX(i), y: toY(entry.price), entry, idx: i });
    });
    return map;
  }, [sorted, toX, toY]);

  // Y 轴刻度（3条）
  const yTicks = [minPrice, (minPrice + maxPrice) / 2, maxPrice];

  if (sorted.length === 0) {
    return (
      <View style={[S.empty, { borderColor: colors.border }]}>
        <Text style={[S.emptyText, { color: colors.muted }]}>暂无价格历史</Text>
      </View>
    );
  }

  return (
    <View>
      <Svg width={width} height={height}>
        {/* Y 轴网格线 */}
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return (
            <React.Fragment key={i}>
              <Line
                x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y}
                stroke={colors.border} strokeWidth={0.5} strokeDasharray="3,3"
              />
              <SvgText
                x={PAD_LEFT - 4} y={y + 4}
                fontSize={9} fill={colors.muted} textAnchor="end"
              >
                {tick % 1 === 0 ? tick.toFixed(0) : tick.toFixed(1)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* 每个供应商的折线 */}
        {Object.entries(linesBySupplier).map(([supplier, points]) => {
          const color = getSupplierColor(supplier, suppliers);
          const polyPoints = points.map((p) => `${p.x},${p.y}`).join(" ");
          return (
            <React.Fragment key={supplier}>
              {/* 折线 */}
              <Polyline
                points={polyPoints}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {/* 数据点 */}
              {points.map((p, pi) => {
                const prev = sorted[p.idx - 1];
                const delta = prev ? p.entry.price - prev.price : null;
                return (
                  <React.Fragment key={pi}>
                    <Circle cx={p.x} cy={p.y} r={3.5} fill={color} />
                    {/* 价格标注（首尾 + 涨跌点） */}
                    {(pi === 0 || pi === points.length - 1 || (delta != null && Math.abs(delta) > priceRange * 0.05)) && (
                      <SvgText
                        x={p.x}
                        y={p.y - 7}
                        fontSize={9}
                        fill={delta == null ? colors.muted : delta > 0 ? "#EF4444" : delta < 0 ? "#22C55E" : colors.muted}
                        textAnchor="middle"
                        fontWeight="600"
                      >
                        ¥{p.entry.price % 1 === 0 ? p.entry.price.toFixed(0) : p.entry.price.toFixed(1)}
                      </SvgText>
                    )}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}

        {/* X 轴日期标注（最多显示4个） */}
        {sorted.map((entry, i) => {
          const step = Math.max(1, Math.floor(sorted.length / 4));
          if (i % step !== 0 && i !== sorted.length - 1) return null;
          const x = toX(i);
          const label = entry.date.slice(5); // MM-DD
          return (
            <SvgText
              key={i}
              x={x} y={height - 6}
              fontSize={9} fill={colors.muted} textAnchor="middle"
            >
              {label}
            </SvgText>
          );
        })}
      </Svg>

      {/* 供应商图例 */}
      {showLegend && suppliers.length > 1 && (
        <View style={S.legend}>
          {suppliers.map((s) => (
            <View key={s} style={S.legendItem}>
              <View style={[S.legendDot, { backgroundColor: getSupplierColor(s, suppliers) }]} />
              <Text style={[S.legendText, { color: colors.muted }]} numberOfLines={1}>{s}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
});

// ─── 供应商价格对比条形图 ─────────────────────────────────────────────────────

interface SupplierCompareProps {
  /** 各供应商最新价格 { supplierName: latestPrice } */
  supplierPrices: { supplier: string; latestPrice: number; date: string; count: number }[];
  unit?: string;
  width?: number;
}

export function SupplierPriceCompare({ supplierPrices, unit = "", width = 320 }: SupplierCompareProps) {
  const colors = useColors();
  if (supplierPrices.length === 0) return null;

  const allSuppliers = supplierPrices.map((s) => s.supplier);
  const maxPrice = Math.max(...supplierPrices.map((s) => s.latestPrice));
  const minPrice = Math.min(...supplierPrices.map((s) => s.latestPrice));
  const sorted = [...supplierPrices].sort((a, b) => a.latestPrice - b.latestPrice);

  return (
    <View style={S.compareWrap}>
      {sorted.map((item) => {
        const color = getSupplierColor(item.supplier, allSuppliers);
        const barWidth = maxPrice > 0 ? (item.latestPrice / maxPrice) * (width - 140) : 0;
        const isCheapest = item.latestPrice === minPrice;
        const isMostExpensive = item.latestPrice === maxPrice && supplierPrices.length > 1;
        return (
          <View key={item.supplier} style={S.compareRow}>
            {/* 供应商名 */}
            <Text style={[S.compareSupplier, { color: colors.foreground }]} numberOfLines={1}>
              {item.supplier}
            </Text>
            {/* 条形 */}
            <View style={[S.compareBarBg, { backgroundColor: colors.border + "44" }]}>
              <View style={[S.compareBar, { width: barWidth, backgroundColor: color }]} />
            </View>
            {/* 价格 + 标签 */}
            <View style={S.comparePriceWrap}>
              <Text style={[S.comparePrice, { color: color }]}>
                ¥{item.latestPrice % 1 === 0 ? item.latestPrice.toFixed(0) : item.latestPrice.toFixed(1)}
              </Text>
              {isCheapest && supplierPrices.length > 1 && (
                <View style={[S.badge, { backgroundColor: "#22C55E22" }]}>
                  <Text style={[S.badgeText, { color: "#22C55E" }]}>最低</Text>
                </View>
              )}
              {isMostExpensive && (
                <View style={[S.badge, { backgroundColor: "#EF444422" }]}>
                  <Text style={[S.badgeText, { color: "#EF4444" }]}>最高</Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
      {/* 价差提示 */}
      {supplierPrices.length > 1 && (
        <Text style={[S.diffText, { color: colors.muted }]}>
          价差 ¥{(maxPrice - minPrice).toFixed(1)}/{unit || "单位"}
          （{((maxPrice - minPrice) / minPrice * 100).toFixed(0)}%）
        </Text>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  empty: { height: 80, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1 },
  emptyText: { fontSize: 13 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 4, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11 },
  compareWrap: { gap: 10 },
  compareRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  compareSupplier: { width: 80, fontSize: 12, fontWeight: "500" },
  compareBarBg: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  compareBar: { height: 10, borderRadius: 5 },
  comparePriceWrap: { flexDirection: "row", alignItems: "center", gap: 4, width: 80, justifyContent: "flex-end" },
  comparePrice: { fontSize: 13, fontWeight: "700" },
  badge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  diffText: { fontSize: 11, textAlign: "right", marginTop: 4 },
});
