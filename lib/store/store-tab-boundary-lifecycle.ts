export type StoreTabKey = "monthly" | "labor" | "petty" | "inventory" | "shop";

type BoundaryCleanup = () => void;
type BoundaryMount = (tab: StoreTabKey) => void | BoundaryCleanup;

/**
 * StoreTabBoundary 的无 UI 生命周期内核。
 * 每次激活新 Tab 前先释放旧 Tab 的订阅、轮询与临时缓存；同一 Tab 重复选择不重挂载。
 */
export function createStoreTabBoundaryLifecycle(mount: BoundaryMount) {
  let activeTab: StoreTabKey | null = null;
  let activeCleanup: BoundaryCleanup | null = null;
  let disposed = false;

  const releaseActive = () => {
    const cleanup = activeCleanup;
    activeCleanup = null;
    if (cleanup) cleanup();
  };

  return {
    activate(tab: StoreTabKey) {
      if (disposed) throw new Error("StoreTabBoundary lifecycle 已释放，不能再次激活。");
      if (activeTab === tab) return false;
      releaseActive();
      activeTab = tab;
      activeCleanup = mount(tab) ?? null;
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseActive();
      activeTab = null;
    },
    snapshot(): Readonly<{ activeTab: StoreTabKey | null; disposed: boolean }> {
      return Object.freeze({ activeTab, disposed });
    },
  };
}
