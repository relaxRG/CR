import React, { Profiler, type ProfilerOnRenderCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const primitive = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement("native-node", null, children);
  return { View: primitive, Text: primitive, StyleSheet: { create: <T,>(value: T) => value } };
});

vi.mock("@/hooks/use-colors", () => ({
  useColors: () => ({ border: "#D1D5DB", muted: "#6B7280" }),
}));

vi.mock("react-native-svg", async () => {
  const ReactModule = await import("react");
  const primitive = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement("svg-node", null, children);
  return { default: primitive, Circle: primitive, Line: primitive, Polyline: primitive, Text: primitive };
});

import { PriceHistoryChart } from "@/components/price-history-chart";

const history = [
  { id: "p1", itemId: "gin", price: 100, supplier: "A", date: "2026-01-01", source: "manual" as const },
  { id: "p2", itemId: "gin", price: 105, supplier: "A", date: "2026-02-01", source: "manual" as const },
  { id: "p3", itemId: "gin", price: 98, supplier: "B", date: "2026-03-01", source: "manual" as const },
];

function Harness({ onCommit }: { onCommit: ProfilerOnRenderCallback }) {
  const [unrelatedTick, setUnrelatedTick] = useState(0);
  return (
    <>
      <Profiler id="price-history" onRender={onCommit}>
        <PriceHistoryChart history={history} width={320} height={160} />
      </Profiler>
      <button onClick={() => setUnrelatedTick((value) => value + 1)}>{unrelatedTick}</button>
    </>
  );
}

describe("价格历史图 Hook 稳定化渲染回归", () => {
  it("记录30次无关父组件更新的真实Profiler提交次数与耗时", () => {
    const commits: Array<{ phase: string; actualDuration: number }> = [];
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Harness onCommit={(_id, phase, actualDuration) => commits.push({ phase, actualDuration })} />);
    });
    const button = renderer!.root.findByType("button");

    for (let index = 0; index < 30; index += 1) {
      act(() => button.props.onClick());
    }

    const updateCommits = commits.filter((commit) => commit.phase === "update");
    const totalUpdateDuration = updateCommits.reduce((sum, commit) => sum + commit.actualDuration, 0);
    console.info(`[hook-render-benchmark] updates=${updateCommits.length} totalDurationMs=${totalUpdateDuration.toFixed(3)}`);
    expect(updateCommits).toHaveLength(30);
    expect(updateCommits.every((commit) => Number.isFinite(commit.actualDuration) && commit.actualDuration >= 0)).toBe(true);
    // React Profiler会记录父树提交，即使memo子树被跳过；因此使用实际耗时而非提交数判断子树是否重算。
    if (process.env.HOOK_RENDER_BASELINE !== "1") {
      expect(totalUpdateDuration).toBeLessThan(5);
    }
  });
});
