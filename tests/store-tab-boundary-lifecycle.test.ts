import { describe, expect, it, vi } from "vitest";
import { createStoreTabBoundaryLifecycle, type StoreTabKey } from "@/lib/store/store-tab-boundary-lifecycle";

describe("StoreTabBoundary 动态切换生命周期", () => {
  it("切换 Tab 时先完整执行旧边界 cleanup，再挂载新边界", () => {
    const events: string[] = [];
    const cleanupByTab = new Map<StoreTabKey, ReturnType<typeof vi.fn>>();
    const mount = vi.fn((tab: StoreTabKey) => {
      events.push(`mount:${tab}`);
      const cleanup = vi.fn(() => events.push(`cleanup:${tab}`));
      cleanupByTab.set(tab, cleanup);
      return cleanup;
    });
    const lifecycle = createStoreTabBoundaryLifecycle(mount);

    expect(lifecycle.activate("shop")).toBe(true);
    expect(lifecycle.activate("petty")).toBe(true);
    expect(events).toEqual(["mount:shop", "cleanup:shop", "mount:petty"]);
    expect(cleanupByTab.get("shop")).toHaveBeenCalledTimes(1);
    expect(lifecycle.snapshot()).toEqual({ activeTab: "petty", disposed: false });
  });

  it("重复选择同一 Tab 不重挂载、不重复释放订阅", () => {
    const mount = vi.fn(() => vi.fn());
    const lifecycle = createStoreTabBoundaryLifecycle(mount);

    lifecycle.activate("inventory");
    expect(lifecycle.activate("inventory")).toBe(false);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("卸载 StoreTabBoundary 时会释放最后一个活跃边界，且禁止后续激活", () => {
    const cleanup = vi.fn();
    const lifecycle = createStoreTabBoundaryLifecycle(() => cleanup);
    lifecycle.activate("monthly");

    lifecycle.dispose();
    lifecycle.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(lifecycle.snapshot()).toEqual({ activeTab: null, disposed: true });
    expect(() => lifecycle.activate("labor")).toThrow("已释放");
  });
});
