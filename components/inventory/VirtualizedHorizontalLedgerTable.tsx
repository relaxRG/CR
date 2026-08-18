import React, { ReactNode, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { HorizontalLedgerColumn, HorizontalLedgerGroup } from "@/components/inventory/HorizontalLedgerTable";

type LedgerRow<Row> =
  | { kind: "group"; group: HorizontalLedgerGroup<Row> }
  | { kind: "row"; groupId: string; row: Row; index: number };

type WindowEntry<Row> = LedgerRow<Row> & { offset: number; height: number };

interface VirtualizedHorizontalLedgerTableProps<Row> {
  columns: HorizontalLedgerColumn<Row>[];
  groups: HorizontalLedgerGroup<Row>[];
  rowKey: (row: Row) => string;
  emptyLabel?: string;
  footer?: ReactNode;
  testID?: string;
  sort?: { key: string; direction: "asc" | "desc" };
  onSort?: (key: string) => void;
}

const ROW_HEIGHT = 48;
const GROUP_HEIGHT = 30;
const OVERSCAN_PX = ROW_HEIGHT * 24;

/**
 * 长台账专用窗口化组件。
 * 横向容器只负责列浏览；纵向 ScrollView 仅挂载可视区域及上下缓冲行，
 * 以避免 React Native Web 在横向嵌套 FlatList 下预渲染全部台账行。
 */
export function VirtualizedHorizontalLedgerTable<Row>({
  columns,
  groups,
  rowKey,
  emptyLabel = "暂无台账数据",
  footer,
  testID,
  sort,
  onSort,
}: VirtualizedHorizontalLedgerTableProps<Row>) {
  const colors = useColors();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const lastReportedOffset = useRef(0);
  const totalWidth = useMemo(() => columns.reduce((sum, column) => sum + column.width, 0), [columns]);
  const entries = useMemo<WindowEntry<Row>[]>(() => {
    let offset = 0;
    const output: WindowEntry<Row>[] = [];
    groups.forEach((group) => {
      output.push({ kind: "group", group, offset, height: GROUP_HEIGHT });
      offset += GROUP_HEIGHT;
      group.rows.forEach((row, index) => {
        output.push({ kind: "row", groupId: group.id, row, index, offset, height: ROW_HEIGHT });
        offset += ROW_HEIGHT;
      });
    });
    return output;
  }, [groups]);
  const totalHeight = entries.length ? entries[entries.length - 1].offset + entries[entries.length - 1].height : 0;
  const visibleEntries = useMemo(() => {
    const from = Math.max(0, scrollTop - OVERSCAN_PX);
    const until = scrollTop + viewportHeight + OVERSCAN_PX;
    return entries.filter((entry) => entry.offset + entry.height >= from && entry.offset <= until);
  }, [entries, scrollTop, viewportHeight]);
  // 浏览器可借助 content-visibility 让离屏行不参与绘制，避免滚动时 React 重建；
  // 原生端维持窗口化，避免长台账常驻全部原生视图。
  const renderedEntries = Platform.OS === "web" ? entries : visibleEntries;
  const firstOffset = Platform.OS === "web" ? 0 : visibleEntries[0]?.offset ?? 0;
  const lastEnd = Platform.OS === "web"
    ? totalHeight
    : visibleEntries.length
      ? visibleEntries[visibleEntries.length - 1].offset + visibleEntries[visibleEntries.length - 1].height
      : firstOffset;
  const containment = Platform.OS === "web" ? { contentVisibility: "auto", containIntrinsicSize: `auto ${ROW_HEIGHT}px` } as any : undefined;

  if (!groups.some((group) => group.rows.length > 0)) {
    return (
      <View style={[S.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{emptyLabel}</Text>
      </View>
    );
  }

  const handleLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0 && Math.abs(height - viewportHeight) > 2) setViewportHeight(height);
  };
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Web 使用浏览器离屏绘制，不在每个滚动事件触发 React 渲染。
    if (Platform.OS === "web") return;
    const next = event.nativeEvent.contentOffset.y;
    if (Math.abs(next - lastReportedOffset.current) < ROW_HEIGHT / 2) return;
    lastReportedOffset.current = next;
    setScrollTop(next);
  };

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator
      testID={testID}
      style={S.horizontalScroller}
    >
      <View style={{ width: totalWidth, flex: 1 }}>
        <View style={[S.header, { backgroundColor: colors.primary }]}>
          {columns.map((column) => {
            const isSortable = Boolean(onSort && column.sortKey);
            const active = sort?.key === column.sortKey;
            const header = (
              <View style={[S.headerCell, { width: column.width, alignItems: alignment(column.align) }]}>
                <View style={S.headerLabel}>
                  <Text style={S.headerText} numberOfLines={1}>{column.label}</Text>
                  {isSortable && <Text style={[S.sortMark, { color: active ? "#fff" : "#DCEBFF" }]}>{active ? (sort?.direction === "asc" ? "↑" : "↓") : "↕"}</Text>}
                </View>
              </View>
            );
            return isSortable ? (
              <Pressable
                key={column.key}
                testID={testID ? `${testID}-sort-${column.sortKey}` : undefined}
                onPress={() => onSort?.(column.sortKey!)}
                accessibilityRole="button"
                accessibilityLabel={`按${column.label}排序`}
                style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}
              >
                {header}
              </Pressable>
            ) : <React.Fragment key={column.key}>{header}</React.Fragment>;
          })}
        </View>
        <ScrollView
          testID={testID ? `${testID}-virtual-list` : undefined}
          style={S.list}
          onLayout={handleLayout}
          onScroll={handleScroll}
          scrollEventThrottle={48}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          <View style={{ height: firstOffset }} />
          {renderedEntries.map((entry) => entry.kind === "group" ? (
            <View key={`group-${entry.group.id}`} style={[S.groupHeader, { height: GROUP_HEIGHT, backgroundColor: entry.group.color + "20" }, containment]}>
              <View style={[S.groupDot, { backgroundColor: entry.group.color }]} />
              <Text style={{ color: entry.group.color, fontSize: 11, fontWeight: "800" }}>{entry.group.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 10 }}>({entry.group.rows.length})</Text>
            </View>
          ) : (
            <View key={`row-${entry.groupId}-${rowKey(entry.row)}`} style={[S.row, { height: ROW_HEIGHT, backgroundColor: entry.index % 2 === 0 ? colors.surface : colors.background, borderBottomColor: colors.border }, containment]}>
              {columns.map((column) => {
                const content = <View style={[S.cell, { width: column.width, alignItems: alignment(column.align) }]}>{column.render(entry.row)}</View>;
                return column.onPress ? (
                  <Pressable
                    key={column.key}
                    testID={column.testID?.(entry.row)}
                    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                    onPress={() => column.onPress?.(entry.row)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1 })}
                  >
                    {content}
                  </Pressable>
                ) : <React.Fragment key={column.key}>{content}</React.Fragment>;
              })}
            </View>
          ))}
          <View style={{ height: Math.max(0, totalHeight - lastEnd) }} />
          {footer}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function alignment(align: HorizontalLedgerColumn<unknown>["align"]) {
  if (align === "right") return "flex-end" as const;
  if (align === "center") return "center" as const;
  return "flex-start" as const;
}

const S = StyleSheet.create({
  horizontalScroller: { flex: 1 },
  list: { flex: 1 },
  header: { flexDirection: "row", minHeight: 40 },
  headerCell: { justifyContent: "center", paddingHorizontal: 7, paddingVertical: 8 },
  headerText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  headerLabel: { flexDirection: "row", alignItems: "center", gap: 2 },
  sortMark: { fontSize: 10, fontWeight: "800" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { justifyContent: "center", paddingHorizontal: 7, paddingVertical: 7 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
});
