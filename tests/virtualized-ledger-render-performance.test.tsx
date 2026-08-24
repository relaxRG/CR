import React, { Profiler } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const primitive = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => ReactModule.createElement("native-node", props, children);
  const scroll = ReactModule.forwardRef(({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({ scrollTo: vi.fn() }));
    return ReactModule.createElement("scroll-node", props, children);
  });
  return {
    Platform: { OS: "ios" },
    Pressable: primitive,
    ScrollView: scroll,
    StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 },
    Text: primitive,
    View: primitive,
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
});

vi.mock("@/hooks/use-colors", () => ({
  useColors: () => ({ background: "#fff", border: "#ddd", foreground: "#111", muted: "#667", primary: "#06f", surface: "#fff" }),
}));

import { VirtualizedHorizontalLedgerTable } from "@/components/inventory/VirtualizedHorizontalLedgerTable";

type Row = { id: string; name: string; amount: number };

const rows: Row[] = Array.from({ length: 800 }, (_, index) => ({ id: `row-${index}`, name: `酒款 ${index}`, amount: index + 1 }));
const groups = [{ id: "spirits", label: "烈酒", color: "#2563EB", rows }];
const columns = [
  { key: "name", label: "商品名称", width: 150, compactWidth: 130, pinned: true, render: (row: Row) => <>{row.name}</> },
  { key: "amount", label: "金额", width: 100, render: (row: Row) => <>{row.amount}</> },
];

describe("虚拟化横向台账渲染性能回归", () => {
  it("800行台账连续30次滚动时，每次更新平均保持在16ms帧预算内", () => {
    const commits: number[] = [];
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Profiler id="virtualized-ledger" onRender={(_id, phase, actualDuration) => {
          if (phase === "update") commits.push(actualDuration);
        }}>
          <VirtualizedHorizontalLedgerTable columns={columns} groups={groups} rowKey={(row) => row.id} testID="performance-ledger" />
        </Profiler>,
      );
    });

    const scrollTargets = renderer!.root.findAll((node) => String(node.type) === "scroll-node" && typeof node.props.onScroll === "function");
    expect(scrollTargets.length).toBeGreaterThan(0);
    const target = scrollTargets[0]!;
    for (let index = 1; index <= 30; index += 1) {
      act(() => target.props.onScroll({ nativeEvent: { contentOffset: { y: index * 72 } } }));
    }

    const totalDuration = commits.reduce((sum, duration) => sum + duration, 0);
    const averageDuration = totalDuration / commits.length;
    console.info(`[virtualized-ledger-benchmark] updates=${commits.length} averageDurationMs=${averageDuration.toFixed(3)}`);
    expect(commits).toHaveLength(30);
    expect(averageDuration).toBeLessThan(16);
  });
});
