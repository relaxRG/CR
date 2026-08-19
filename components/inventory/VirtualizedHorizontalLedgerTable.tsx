import React, { startTransition, type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { HorizontalLedgerColumn, HorizontalLedgerGroup } from "@/components/inventory/HorizontalLedgerTable";
import { expandStoreTableColumns, getStoreTableViewport, STORE_TABLE_METRICS } from "@/lib/store/table-display";

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
  /** 当月进货等逐笔台账不需要额外分组行时关闭。 */
  showGroupHeaders?: boolean;
}

const ROW_HEIGHT = STORE_TABLE_METRICS.rowHeight;
const GROUP_HEIGHT = STORE_TABLE_METRICS.groupHeight;
const OVERSCAN_PX = ROW_HEIGHT * 12;

/**
 * 长台账的“固定身份列 + 横向指标区”实现。
 * 手机与平板固定带 pinned 标记的列；桌面宽屏展开所有列并按权重消化余量。
 * 两个纵向列表共享滚动位置，避免固定区与指标区出现行错位。
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
  showGroupHeaders = true,
}: VirtualizedHorizontalLedgerTableProps<Row>) {
  const colors = useColors();
  const { width: windowWidth } = useWindowDimensions();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const lastReportedOffset = useRef(0);
  const pinnedScrollRef = useRef<ScrollView>(null);
  const dataScrollRef = useRef<ScrollView>(null);
  const responsiveColumns = useMemo(() => {
    const baseColumns = getStoreTableViewport(windowWidth) === "phone"
      ? columns.map((column) => ({ ...column, width: column.compactWidth ?? column.width }))
      : columns;
    return expandStoreTableColumns(baseColumns, Math.max(0, windowWidth - 32));
  }, [columns, windowWidth]);
  const usePinnedColumns = getStoreTableViewport(windowWidth) !== "desktop" && responsiveColumns.some((column) => column.pinned);
  const pinnedColumns = usePinnedColumns ? responsiveColumns.filter((column) => column.pinned) : [];
  const scrollColumns = usePinnedColumns ? responsiveColumns.filter((column) => !column.pinned) : responsiveColumns;
  const pinnedWidth = useMemo(() => pinnedColumns.reduce((sum, column) => sum + column.width, 0), [pinnedColumns]);
  const dataWidth = useMemo(() => scrollColumns.reduce((sum, column) => sum + column.width, 0), [scrollColumns]);
  const entries = useMemo<WindowEntry<Row>[]>(() => {
    let offset = 0;
    const output: WindowEntry<Row>[] = [];
    groups.forEach((group) => {
      if (showGroupHeaders) {
        output.push({ kind: "group", group, offset, height: GROUP_HEIGHT });
        offset += GROUP_HEIGHT;
      }
      group.rows.forEach((row, index) => {
        output.push({ kind: "row", groupId: group.id, row, index, offset, height: ROW_HEIGHT });
        offset += ROW_HEIGHT;
      });
    });
    return output;
  }, [groups, showGroupHeaders]);
  const totalHeight = entries.length ? entries[entries.length - 1].offset + entries[entries.length - 1].height : 0;
  const visibleEntries = useMemo(() => {
    const from = Math.max(0, scrollTop - OVERSCAN_PX);
    const until = scrollTop + viewportHeight + OVERSCAN_PX;
    return entries.filter((entry) => entry.offset + entry.height >= from && entry.offset <= until);
  }, [entries, scrollTop, viewportHeight]);
  const renderedEntries = visibleEntries;
  const firstOffset = visibleEntries[0]?.offset ?? 0;
  const lastEnd = visibleEntries.length
    ? visibleEntries[visibleEntries.length - 1].offset + visibleEntries[visibleEntries.length - 1].height
    : firstOffset;
  const containment = Platform.OS === "web" ? { contentVisibility: "auto", containIntrinsicSize: `auto ${ROW_HEIGHT}px` } as any : undefined;

  const syncVerticalPosition = useCallback((y: number, source: "data" | "pinned") => {
    if (source === "data") pinnedScrollRef.current?.scrollTo({ y, animated: false });
    else dataScrollRef.current?.scrollTo({ y, animated: false });
  }, []);
  const handleLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0 && Math.abs(height - viewportHeight) > 2) setViewportHeight(height);
  };
  const handleScroll = (source: "data" | "pinned") => (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y;
    syncVerticalPosition(next, source);
    if (Math.abs(next - lastReportedOffset.current) < ROW_HEIGHT / 2) return;
    lastReportedOffset.current = next;
    startTransition(() => setScrollTop(next));
  };

  if (!groups.some((group) => group.rows.length > 0)) {
    return (
      <View style={[S.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.muted, fontSize: STORE_TABLE_METRICS.bodyFontSize }}>{emptyLabel}</Text>
      </View>
    );
  }

  const renderHeader = (sourceColumns: HorizontalLedgerColumn<Row>[]) => (
    <View style={[S.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      {sourceColumns.map((column) => {
        const isSortable = Boolean(onSort && column.sortKey);
        const active = sort?.key === column.sortKey;
        const header = (
          <View style={[S.headerCell, { width: column.width, alignItems: alignment(column.align) }]}>
            <View style={S.headerLabel}>
              <Text style={[S.headerText, { color: active ? colors.primary : colors.foreground }]} numberOfLines={1}>{column.label}</Text>
              {isSortable && <Text style={[S.sortMark, { color: active ? colors.primary : colors.muted }]}>{active ? (sort?.direction === "asc" ? "↑" : "↓") : "↕"}</Text>}
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
  );

  const renderEntry = (entry: WindowEntry<Row>, sourceColumns: HorizontalLedgerColumn<Row>[], isPinned: boolean) => entry.kind === "group" ? (
    <View
      key={`${isPinned ? "pinned" : "data"}-group-${entry.group.id}`}
      style={[S.groupHeader, { height: GROUP_HEIGHT, backgroundColor: entry.group.color + "10", borderBottomColor: colors.border, width: sourceColumns.reduce((sum, column) => sum + column.width, 0) }, containment]}
    >
      {isPinned ? <><View style={[S.groupDot, { backgroundColor: entry.group.color }]} /><Text style={{ color: colors.foreground, fontSize: STORE_TABLE_METRICS.bodyFontSize, fontWeight: "600" }}>{entry.group.label}</Text><Text style={{ color: colors.muted, fontSize: 11 }}>({entry.group.rows.length})</Text></> : null}
    </View>
  ) : (
    <View
      key={`${isPinned ? "pinned" : "data"}-row-${entry.groupId}-${rowKey(entry.row)}`}
      style={[S.row, { height: ROW_HEIGHT, width: sourceColumns.reduce((sum, column) => sum + column.width, 0), backgroundColor: entry.index % 2 === 0 ? colors.surface : colors.background, borderBottomColor: colors.border }, containment]}
    >
      {sourceColumns.map((column) => {
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
  );

  const renderVerticalList = (sourceColumns: HorizontalLedgerColumn<Row>[], source: "data" | "pinned") => (
    <ScrollView
      ref={source === "data" ? dataScrollRef : pinnedScrollRef}
      testID={source === "data" && testID ? `${testID}-virtual-list` : undefined}
      style={S.list}
      onLayout={source === "data" ? handleLayout : undefined}
      onScroll={handleScroll(source)}
      scrollEventThrottle={48}
      showsVerticalScrollIndicator={source === "data"}
      nestedScrollEnabled
    >
      <View style={{ height: firstOffset }} />
      {renderedEntries.map((entry) => renderEntry(entry, sourceColumns, source === "pinned"))}
      <View style={{ height: Math.max(0, totalHeight - lastEnd) }} />
      {source === "data" ? footer : null}
    </ScrollView>
  );

  if (!usePinnedColumns) {
    return (
      <ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator testID={testID} style={S.horizontalScroller}>
        <View style={{ width: dataWidth, flex: 1 }}>
          {renderHeader(scrollColumns)}
          {renderVerticalList(scrollColumns, "data")}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={S.pinnedRoot}>
      <View style={[S.pinnedPanel, { width: pinnedWidth, borderRightColor: colors.border }]}>
        {renderHeader(pinnedColumns)}
        {renderVerticalList(pinnedColumns, "pinned")}
      </View>
      <ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator testID={testID} style={S.horizontalScroller}>
        <View style={{ width: dataWidth, flex: 1 }}>
          {renderHeader(scrollColumns)}
          {renderVerticalList(scrollColumns, "data")}
        </View>
      </ScrollView>
    </View>
  );
}

function alignment(align: HorizontalLedgerColumn<unknown>["align"]) {
  if (align === "right") return "flex-end" as const;
  if (align === "center") return "center" as const;
  return "flex-start" as const;
}

const S = StyleSheet.create({
  pinnedRoot: { flex: 1, flexDirection: "row", minWidth: 0 },
  pinnedPanel: { borderRightWidth: StyleSheet.hairlineWidth, zIndex: 2 },
  horizontalScroller: { flex: 1, minWidth: 0 },
  list: { flex: 1 },
  header: { flexDirection: "row", minHeight: STORE_TABLE_METRICS.headerHeight, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCell: { justifyContent: "center", paddingHorizontal: 9, paddingVertical: 8 },
  headerText: { fontSize: STORE_TABLE_METRICS.bodyFontSize, fontWeight: "600" },
  headerLabel: { flexDirection: "row", alignItems: "center", gap: 3 },
  sortMark: { fontSize: 11, fontWeight: "600" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { justifyContent: "center", paddingHorizontal: 9, paddingVertical: 6 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
});
