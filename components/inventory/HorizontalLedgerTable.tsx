import React, { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/use-colors";

export interface HorizontalLedgerColumn<Row> {
  key: string;
  label: string;
  width: number;
  align?: "left" | "center" | "right";
  render: (row: Row) => ReactNode;
  onPress?: (row: Row) => void;
  testID?: (row: Row) => string;
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
  rowTone?: (row: Row, index: number) => "default" | "negative";
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
  rowTone,
}: HorizontalLedgerTableProps<Row>) {
  const colors = useColors();
  const hasRows = groups.some((group) => group.rows.length > 0);

  if (!hasRows) {
    return (
      <View style={[S.empty, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={{ color: colors.muted, fontSize: 13 }}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator testID={testID} style={{ flexGrow: 0 }}>
      <View>
        <View style={[S.header, { backgroundColor: colors.primary }]}>
          {columns.map((column) => (
            <View key={column.key} style={[S.headerCell, { width: column.width, alignItems: alignment(column.align) }]}>
              <Text style={S.headerText} numberOfLines={1}>{column.label}</Text>
            </View>
          ))}
        </View>

        {groups.map((group) => (
          <React.Fragment key={group.id}>
            <View style={[S.groupHeader, { backgroundColor: group.color + "20" }]}>
              <View style={[S.groupDot, { backgroundColor: group.color }]} />
              <Text style={{ color: group.color, fontSize: 11, fontWeight: "800" }}>{group.label}</Text>
              <Text style={{ color: colors.muted, fontSize: 10 }}>({group.rows.length})</Text>
            </View>
            {group.rows.map((row, index) => {
              const tone = rowTone?.(row, index) ?? "default";
              const backgroundColor = tone === "negative"
                ? "#FEF2F2"
                : index % 2 === 0 ? colors.surface : colors.background;
              return (
                <View key={rowKey(row)} style={[S.row, { backgroundColor, borderBottomColor: colors.border }]}>
                  {columns.map((column) => {
                    const content = (
                      <View style={[S.cell, { width: column.width, alignItems: alignment(column.align) }]}>
                        {column.render(row)}
                      </View>
                    );
                    return column.onPress ? (
                      <Pressable
                        key={column.key}
                        testID={column.testID?.(row)}
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
  header: { flexDirection: "row", minHeight: 40 },
  headerCell: { justifyContent: "center", paddingHorizontal: 7, paddingVertical: 8 },
  headerText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 30, paddingHorizontal: 10 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { justifyContent: "center", paddingHorizontal: 7, paddingVertical: 7 },
  empty: { minHeight: 120, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
});
