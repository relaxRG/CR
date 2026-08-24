import React, { Profiler } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const primitive = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => ReactModule.createElement("native-node", props, children);
  const scroll = ReactModule.forwardRef(({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
    return ReactModule.createElement("scroll-node", props, children);
  });
  return { Platform: { OS: "ios" }, Pressable: primitive, ScrollView: scroll, StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 }, Text: primitive, View: primitive, useWindowDimensions: () => ({ width: 390, height: 844 }) };
});
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ background: "#fff", border: "#ddd", foreground: "#111", muted: "#667", primary: "#06f", surface: "#fff" }) }));

import { VirtualizedHorizontalLedgerTable } from "@/components/inventory/VirtualizedHorizontalLedgerTable";

type SpiritRow = { id: string; name: string; opening: number; closing: number };
const rows: SpiritRow[] = Array.from({ length: 500 }, (_, index) => ({ id: `spirit-${index}`, name: `烈酒 ${index}`, opening: index % 12, closing: (index + 3) % 12 }));
const columns = [
  { key: "name", label: "商品名称", width: 150, compactWidth: 130, pinned: true, render: (row: SpiritRow) => <>{row.name}</> },
  { key: "opening", label: "期初库存", width: 80, render: (row: SpiritRow) => <>{row.opening}</> },
  { key: "closing", label: "期末库存", width: 80, render: (row: SpiritRow) => <>{row.closing}</> },
];

describe("烈酒库存工作区台账渲染性能回归", () => {
  it("500条烈酒记录连续30次滚动时的平均Profiler更新成本低于16ms", () => {
    const updates: number[] = [];
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Profiler id="spirits-ledger" onRender={(_id, phase, actualDuration) => { if (phase === "update") updates.push(actualDuration); }}><VirtualizedHorizontalLedgerTable columns={columns} groups={[{ id: "spirits", label: "烈酒", color: "#2563EB", rows }]} rowKey={(row) => row.id} /></Profiler>);
    });
    const scrollTarget = renderer!.root.findAll((node) => String(node.type) === "scroll-node" && typeof node.props.onScroll === "function")[0];
    expect(scrollTarget).toBeDefined();
    for (let index = 1; index <= 30; index += 1) act(() => scrollTarget!.props.onScroll({ nativeEvent: { contentOffset: { y: index * 72 } } }));
    const averageDuration = updates.reduce((sum, duration) => sum + duration, 0) / updates.length;
    console.info(`[spirits-ledger-benchmark] updates=${updates.length} averageDurationMs=${averageDuration.toFixed(3)}`);
    expect(updates).toHaveLength(30);
    expect(averageDuration).toBeLessThan(16);
  });
});
