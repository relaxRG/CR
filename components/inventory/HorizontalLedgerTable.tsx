import React, { ReactNode, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useColors } from "@/hooks/use-colors";
import { expandStoreTableColumns, getStoreTableViewport, resolveStoreTableTypography, STORE_TABLE_METRICS } from "@/lib/store/table-display";

export interface HorizontalLedgerColumn<Row> {
  key: string;
  label: string;
  width: number;
  /** 手机端使用的最小可读宽度；桌面与平板仍使用 width 和弹性权重。 */
  compactWidth?: number;
  /** 手机端固定在左侧的身份列；其余列可横向浏览。 */
  pinned?: boolean;
  /** 桌面宽屏下分配剩余宽度的权重。 */
  flexWeight?: number;
  align?: "left" | "center" | "right";
  render: (row: Row) => ReactNode;
  onPress?: (row: Row) => void;
  testID?: (row: Row) => string;
  /** 可选：点击表头时使用的排序键；未提供则维持纯展示列。 */
  sortKey?: string;
}

export interface HorizontalLedgerGroup<Row> {
  id: string;
  label: string;
  color: string;
  rows: Row[];
}

interface HorizontalLedgerTableProps<Row> {
  columns: HorizontalLedgerColumn<Row>[];
  groups: HorizontalLedgerGroup<Row>[];
  rowKey: (row: Row) => string;
  emptyLabel?: string;
  footer?: ReactNode;
  testID?: string;
  sort?: { key: string; direction: "asc" | "desc" };
  onSort?: (key: string) => void;
  /** 保留点击表头排序，但可隐藏箭头辅助图标以降低表头噪声。 */
  showHeaderSortIndicators?: boolean;
  selection?: {
    selectedRowKeys: readonly string[];
    onToggleRow: (row: Row) => void;
    onToggleAll: () => void;
    allSelected: boolean;
    testIDPrefix?: string;
  };
}

/**
 * 所有库存分类共用的Excel式横向台账。
 * 表格只在自身范围内横向滚动；名称列可单独绑定详情卡片，避免全行误触。
 */
export function HorizontalLedgerTable<Row>({
  columns,
  groups,
  rowKey,
  emptyLabel = "暂无台账数据",
  footer,
  testID,
  sort,
  onSort,
  showHeaderSortIndicators = true,
  selection,
}: HorizontalLedgerTableProps<Row>) {
  const colors = useColors();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const typography = useMemo(() => resolveStoreTableTypography(windowWidth, fontScale), [windowWidth, fontScale]);
  const responsiveColumns = useMemo(() => {
    const baseColumns = getStoreTableViewport(windowWidth) === "phone"
      ? columns.map((column) => ({ ...column, width: column.compactWidth ?? column.width }))
      : columns;
    return expandStoreTableColumns(baseColumns, Math.max(0, windowWidth - 32));
  }, [columns, windowWidth]);
  const selectionWidth = selection ? 38 : 0;
  const totalWidth = responsiveColumns.reduce((total, column) => total + column.width, selectionWidth);
  const hasRows = groups.some((group) => group.rows.length > 0);

  if (!hasRows) {
    return (
      <View style={[S.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <ScrollView horizontal nestedScrollEnabled directionalLockEnabled showsHorizontalScrollIndicator testID={testID} style={{ flexGrow: 0 }}>
      <View style={{ width: totalWidth, minWidth: "100%" }}>
        <View style={[S.header, { minHeight: typography.headerHeight, backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
          {selection && (
            <Pressable
              testID={selection.testIDPrefix ? `${selection.testIDPrefix}-select-all` : undefined}
              onPress={selection.onToggleAll}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selection.allSelected }}
              style={[S.selectionCell, { minHeight: typography.rowHeight, width: selectionWidth }]}
            >
              <Text style={{ color: colors.primary, fontSize: 15, fontWeight: "600" }}>{selection.allSelected ? "✓" : "○"}</Text>
            </Pressable>
          )}
          {responsiveColumns.map((column) => {
            const isSortable = Boolean(onSort && column.sortKey);
            const active = sort?.key === column.sortKey;
            const header = (
              <View style={[S.headerCell, { width: column.width, alignItems: alignment(column.align) }]}>
                <View style={S.headerLabel}>
                  <Text style={[S.headerText, { fontSize: typography.headerFontSize, color: active ? colors.primary : colors.foreground }]} numberOfLines={1}>{column.label}</Text>
                  {isSortable && showHeaderSortIndicators && <Text style={[S.sortMark, { color: active ? colors.primary : colors.muted }]}>{active ? (sort?.direction === "asc" ? "↑" : "↓") : "↕"}</Text>}
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

        {groups.map((group) => (
          <React.Fragment key={group.id}>
            <View style={[S.groupHeader, { minHeight: typography.groupHeight, backgroundColor: group.color + "10", borderBottomColor: colors.border }]}>
              <View style={[S.groupDot, { backgroundColor: group.color }]} />
              <Text style={{ color: colors.foreground, fontSize: typography.bodyFontSize, fontWeight: "600" }}>{group.label}</Text>
              <Text style={{ color: colors.muted, fontSize: Math.max(12, typography.bodyFontSize - 1) }}>({group.rows.length})</Text>
            </View>
            {group.rows.map((row, index) => {
              const backgroundColor = index % 2 === 0 ? colors.surface : colors.background;
              const key = rowKey(row);
              const selected = selection?.selectedRowKeys.includes(key) ?? false;
              return (
                <View key={key} style={[S.row, { minHeight: typography.rowHeight, backgroundColor: selected ? colors.primary + "0d" : backgroundColor, borderBottomColor: colors.border }]}>
                  {selection && (
                    <Pressable
                      testID={selection.testIDPrefix ? `${selection.testIDPrefix}-select-${key}` : undefined}
                      onPress={() => selection.onToggleRow(row)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      style={[S.selectionCell, { minHeight: typography.rowHeight, width: selectionWidth }]}
                    >
                      <Text style={{ color: selected ? colors.primary : colors.muted, fontSize: 16, fontWeight: "600" }}>{selected ? "✓" : "○"}</Text>
                    </Pressable>
                  )}
                  {responsiveColumns.map((column) => {
                    const content = (
                      <View style={[S.cell, { width: column.width, alignItems: alignment(column.align) }]}>
                        {column.render(row)}
                      </View>
                    );
                    return column.onPress ? (
                      <Pressable
                        key={column.key}
                        testID={column.testID?.(row)}
                        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        onPress={() => column.onPress?.(row)}
                        accessibilityRole="button"
                        style={({ pressed }) => ({ opacity: pressed ? 0.62 : 1 })}
                      >
                        {content}
                      </Pressable>
                    ) : <React.Fragment key={column.key}>{content}</React.Fragment>;
                  })}
                </View>
              );
            })}
          </React.Fragment>
        ))}
        {footer}
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
  header: { flexDirection: "row", minHeight: STORE_TABLE_METRICS.headerHeight, borderBottomWidth: StyleSheet.hairlineWidth },
  headerCell: { justifyContent: "center", paddingHorizontal: 9, paddingVertical: 8 },
  headerText: { fontSize: STORE_TABLE_METRICS.bodyFontSize, fontWeight: "600" },
  headerLabel: { flexDirection: "row", alignItems: "center", gap: 3 },
  sortMark: { fontSize: 11, fontWeight: "600" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: STORE_TABLE_METRICS.groupHeight, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", minHeight: STORE_TABLE_METRICS.rowHeight, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { justifyContent: "center", paddingHorizontal: 9, paddingVertical: 6 },
  selectionCell: { alignItems: "center", justifyContent: "center", minHeight: STORE_TABLE_METRICS.rowHeight },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
});
