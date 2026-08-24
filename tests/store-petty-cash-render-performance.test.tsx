import React, { Profiler } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const records = Array.from({ length: 500 }, (_, index) => ({ id: `petty-${index}`, date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`, code: index % 5 === 0 ? "N0" : "A1", amount: index + 10, description: `流水 ${index}`, paymentMethod: "微信" }));

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const primitive = (name: string) => ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => ReactModule.createElement(name, props, children);
  return { ActivityIndicator: primitive("activity"), Alert: { alert: vi.fn() }, FlatList: primitive("flat-list"), Modal: primitive("modal"), Platform: { OS: "ios" }, Pressable: primitive("pressable"), ScrollView: primitive("scroll"), StyleSheet: { create: <T,>(value: T) => value }, Text: primitive("text"), TextInput: primitive("input"), View: primitive("view") };
});
vi.mock("react-native-svg", async () => { const ReactModule = await import("react"); const node = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement("svg", null, children); return { default: node, Path: node, Text: node }; });
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("expo-haptics", () => ({ ImpactFeedbackStyle: { Light: "light" }, impactAsync: vi.fn() }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ background: "#fff", surface: "#fff", border: "#ddd", foreground: "#111", muted: "#667", primary: "#06f", error: "#d33", success: "#087" }) }));
vi.mock("@/lib/store/petty-store", () => ({
  PETTY_CODE_LABELS: { A1: "采购", N0: "收入" }, PETTY_GROUPS: [{ label: "采购", codes: ["A1"] }],
  usePettyCashStore: () => ({ records, addRecord: vi.fn(), batchAddRecords: vi.fn(), updateRecord: vi.fn(), deleteRecord: vi.fn(), setPeriod: vi.fn(), calcPeriod: () => ({ expense: 500, inflow: 1000, otherIncome: 0, openingBalance: 500, closingBalance: 1000, openingAutoValue: 0 }), periods: {} }),
}));
vi.mock("@/lib/month-close/module-month-close-store", () => ({ useModuleMonthCloseStore: () => ({ getStatus: () => "open", isWritable: () => true }) }));
vi.mock("@/lib/months/global-business-month", () => ({ useGlobalBusinessMonth: () => ({ month: "2026-08", selectMonth: vi.fn() }) }));
vi.mock("@/components/months/BoundedBusinessMonthNavigator", async () => { const ReactModule = await import("react"); return { BoundedBusinessMonthNavigator: () => ReactModule.createElement("month-nav") }; });
vi.mock("@/lib/inventory-core/month-browser", () => ({ deriveInventoryMonthBounds: () => ({ min: "2026-01", max: "2026-12" }) }));
vi.mock("@/components/performance/mobile-virtual-list", () => ({ MOBILE_VIRTUAL_LIST_PROPS: {} }));
vi.mock("@/components/ui/icon-symbol", async () => { const ReactModule = await import("react"); return { IconSymbol: () => ReactModule.createElement("icon") }; });
vi.mock("@/components/store/store-visual-primitives", async () => {
  const ReactModule = await import("react");
  return {
    StoreSegmentedTabs: ({ items, onChange }: { items: readonly { key: string; label: string }[]; onChange: (key: "ledger" | "calendar" | "stats") => void }) => ReactModule.createElement("segmented-tabs", null, items.map((item) => ReactModule.createElement("tab", { key: item.key, onPress: () => onChange(item.key as "ledger" | "calendar" | "stats") }, item.label))),
    StoreToolbarAction: () => ReactModule.createElement("toolbar-action"),
  };
});
vi.mock("@/lib/theme/store-visual-system", () => ({ storeCategoryColor: () => "#06f", storeTone: () => "#06f", storeToneSurface: () => "#eef" }));

import StorePettyCashScreen from "@/components/store/petty-cash";

describe("备用金工作区渲染性能回归", () => {
  it("500条账本在连续30次三视图切换中的平均Profiler更新成本低于16ms", () => {
    const updates: number[] = [];
    let renderer: ReturnType<typeof create>;
    act(() => { renderer = create(<Profiler id="store-petty" onRender={(_id, phase, actualDuration) => { if (phase === "update") updates.push(actualDuration); }}><StorePettyCashScreen /></Profiler>); });
    const tabs = renderer!.root.findAll((node) => String(node.type) === "tab");
    expect(tabs).toHaveLength(3);
    for (let index = 0; index < 30; index += 1) act(() => tabs[index % 3]!.props.onPress());
    const averageDuration = updates.reduce((sum, duration) => sum + duration, 0) / updates.length;
    console.info(`[store-petty-benchmark] updates=${updates.length} averageDurationMs=${averageDuration.toFixed(3)}`);
    expect(updates.length).toBeGreaterThanOrEqual(29);
    expect(averageDuration).toBeLessThan(16);
  });
});
