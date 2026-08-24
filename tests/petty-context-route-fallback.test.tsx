import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined) },
}));
vi.mock("@/lib/sync/engine", () => ({
  notifySyncChange: vi.fn(),
  registerStoreReload: vi.fn(() => () => undefined),
}));

import { PettyCashProvider, usePettyCashStore } from "@/lib/store/petty-store";

describe("备用金Context路由边界降级", () => {
  it("在Provider短暂缺失时返回安全空值而不是抛出，并可随后挂载真实Provider", () => {
    const observed: { current: ReturnType<typeof usePettyCashStore> | null } = { current: null };
    function Capture() {
      observed.current = usePettyCashStore();
      return null;
    }

    let renderer: ReturnType<typeof create>;
    expect(() => {
      act(() => { renderer = create(<Capture />); });
    }).not.toThrow();
    expect(observed.current?.records).toEqual([]);
    expect(observed.current?.calcPeriod("2026-04").closingBalance).toBe(0);

    act(() => {
      renderer!.update(
        <PettyCashProvider>
          <Capture />
        </PettyCashProvider>,
      );
    });
    expect(observed.current).not.toBeNull();
  });
});
