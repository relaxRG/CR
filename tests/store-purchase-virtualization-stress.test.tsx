import React, { Profiler } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const purchaseItems = Array.from({ length: 10_000 }, (_, index) => ({
  id: `purchase-${index}`, category: index % 3 === 0 ? "cocktail" : index % 3 === 1 ? "wine" : "food", name: `采购项 ${index}`, quantity: "1", unit: "瓶", supplier: "供应商", purchaseType: "supplier", link: "", price: index + 10, notes: "", done: index % 4 === 0, createdAt: "2026-08-01T00:00:00.000Z",
}));

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const primitive = (name: string) => ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => ReactModule.createElement(name, props, children);
  const flatList = ReactModule.forwardRef(({ data = [], renderItem, ...props }: { data?: unknown[]; renderItem?: (value: { item: unknown; index: number }) => React.ReactNode; [key: string]: unknown }, ref) => {
    ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: vi.fn() }));
    return ReactModule.createElement("flat-list", props, data.slice(0, 20).map((item, index) => ReactModule.createElement(ReactModule.Fragment, { key: String((item as { id?: string }).id ?? index) }, renderItem?.({ item, index }))));
  });
  return { Alert: { alert: vi.fn() }, FlatList: flatList, Linking: { openURL: vi.fn() }, Modal: primitive("modal"), Platform: { OS: "ios" }, Pressable: primitive("pressable"), ScrollView: primitive("scroll"), StyleSheet: { create: <T,>(value: T) => value }, Text: primitive("text"), TextInput: primitive("input"), View: primitive("view") };
});
vi.mock("expo-haptics", () => ({ ImpactFeedbackStyle: { Light: "light" }, impactAsync: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn(async () => JSON.stringify(purchaseItems)), setItem: vi.fn(async () => undefined) } }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ background: "#fff", surface: "#fff", border: "#ddd", foreground: "#111", muted: "#667", primary: "#06f", success: "#087" }) }));
vi.mock("@/hooks/use-persisted-state", async () => { const ReactModule = await import("react"); return { usePersistedState: <T,>(_key: string, initial: T) => ReactModule.useState(initial) }; });
vi.mock("@/hooks/use-scroll-preservation", () => ({ useScrollPreservation: () => ({ listRef: { current: null }, onScroll: vi.fn() }) }));
vi.mock("@/lib/sync/engine", () => ({ notifySyncChange: vi.fn(), registerStoreReload: () => () => {} }));
vi.mock("@/components/ui/icon-symbol", async () => { const ReactModule = await import("react"); return { IconSymbol: () => ReactModule.createElement("icon") }; });
vi.mock("@/components/performance/mobile-virtual-list", () => ({ MOBILE_VIRTUAL_LIST_PROPS: {} }));

import StorePurchaseScreen from "@/components/store/purchase";

describe("采购清单10,000条虚拟化极限压力测试", () => {
  it("10,000条采购数据下连续30次分类切换保持可视窗口渲染且平均更新成本低于32ms", async () => {
    const updates: number[] = [];
    let renderer: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Profiler id="store-purchase" onRender={(_id, phase, actualDuration) => { if (phase === "update") updates.push(actualDuration); }}><StorePurchaseScreen /></Profiler>);
      await Promise.resolve();
    });
    const flatList = renderer!.root.findAll((node) => String(node.type) === "flat-list")[0];
    expect(flatList?.children.length).toBeLessThanOrEqual(20);
    const categoryButtons = renderer!.root.findAll((node) => String(node.type) === "pressable").slice(0, 3);
    expect(categoryButtons).toHaveLength(3);
    for (let index = 0; index < 30; index += 1) {
      await act(async () => { categoryButtons[index % 3]!.props.onPress(); });
    }
    const averageDuration = updates.reduce((sum, duration) => sum + duration, 0) / updates.length;
    console.info(`[store-purchase-10k-stress] sourceRows=10000 visibleRows=${flatList?.children.length ?? 0} updates=${updates.length} averageDurationMs=${averageDuration.toFixed(3)}`);
    expect(updates.length).toBeGreaterThanOrEqual(29);
    expect(averageDuration).toBeLessThan(32);
  });
});
