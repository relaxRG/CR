import React, { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

const persistedSetter = vi.fn();

vi.mock("@/hooks/use-persisted-state", () => ({
  usePersistedState: () => ["2026-04", persistedSetter],
}));

import {
  BUSINESS_MONTH_PERSIST_DEBOUNCE_MS,
  GlobalBusinessMonthProvider,
  useGlobalBusinessMonth,
} from "@/lib/months/global-business-month";

describe("全局业务月份高频选择", () => {
  afterEach(() => {
    vi.useRealTimers();
    persistedSetter.mockReset();
  });

  it("在React提交下一帧前连续交替选择月份时保留完整顺序并只持久化最后一次选择", () => {
    vi.useFakeTimers();
    const latest: { current: ReturnType<typeof useGlobalBusinessMonth> | null } = { current: null };

    function Capture() {
      const value = useGlobalBusinessMonth();
      useEffect(() => { latest.current = value; }, [value]);
      return null;
    }

    act(() => {
      create(
        <GlobalBusinessMonthProvider>
          <Capture />
        </GlobalBusinessMonthProvider>,
      );
    });

    expect(latest.current?.month).toBe("2026-04");
    act(() => {
      for (let index = 0; index < 12; index += 1) {
        latest.current?.selectMonth("2026-05");
        latest.current?.selectMonth("2026-04");
      }
    });

    expect(latest.current?.month).toBe("2026-04");
    act(() => { vi.advanceTimersByTime(BUSINESS_MONTH_PERSIST_DEBOUNCE_MS); });
    expect(persistedSetter).toHaveBeenCalledTimes(1);
    expect(persistedSetter).toHaveBeenLastCalledWith("2026-04");
  });
});
