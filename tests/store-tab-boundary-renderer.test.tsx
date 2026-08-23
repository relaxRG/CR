import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const events = vi.hoisted((): string[] => []);
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/performance/app-performance-marks", () => ({
  markAppPerformance: vi.fn(),
}));

vi.mock("@/components/providers/StoreTabProviders", () => {
  const provider = (name: string) => function MockStoreTabProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
      events.push(`mount:${name}`);
      return () => { events.push(`cleanup:${name}`); };
    }, []);
    return <>{children}</>;
  };
  return {
    StoreReportProviders: provider("monthly"),
    StoreLaborProviders: provider("labor"),
    StorePettyProviders: provider("petty"),
    StoreInventoryProviders: provider("inventory"),
    StoreShopProviders: provider("shop"),
  };
});

import { StoreTabBoundary } from "@/components/providers/StoreTabBoundary";

describe("StoreTabBoundary 渲染器级清理", () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = null;
    events.splice(0, events.length);
  });

  it("切换 Tab 时真实卸载旧 Provider effect，并且最终卸载不会遗留最后一个边界", async () => {
    await act(async () => {
      renderer = create(<StoreTabBoundary tab="monthly"><React.Fragment /></StoreTabBoundary>);
    });
    expect(events).toEqual(["mount:monthly"]);

    await act(async () => {
      renderer?.update(<StoreTabBoundary tab="inventory"><React.Fragment /></StoreTabBoundary>);
    });
    expect(events).toEqual(["mount:monthly", "cleanup:monthly", "mount:inventory"]);

    await act(async () => { renderer?.unmount(); });
    renderer = null;
    expect(events).toEqual(["mount:monthly", "cleanup:monthly", "mount:inventory", "cleanup:inventory"]);
  });
});
