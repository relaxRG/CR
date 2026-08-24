import React, { Profiler } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { primitive } = vi.hoisted(() => ({
  primitive: (name: string) => ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement(name, props, children),
}));

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Modal: primitive("modal"),
  Platform: { OS: "ios" },
  Pressable: primitive("pressable"),
  ScrollView: primitive("scroll"),
  StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 },
  Text: primitive("text"),
  TextInput: primitive("input"),
  TouchableOpacity: primitive("touchable"),
  View: primitive("view"),
}));
vi.mock("expo-haptics", () => ({ ImpactFeedbackStyle: { Light: "light" }, impactAsync: vi.fn() }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({ background: "#fff", surface: "#fff", border: "#ddd", foreground: "#111", muted: "#667", primary: "#06f", error: "#d33", success: "#087" }) }));
vi.mock("@/components/ui/icon-symbol", () => ({ IconSymbol: primitive("icon") }));
vi.mock("@/components/store/store-visual-primitives", () => ({ StoreMetric: primitive("metric"), StoreSectionHeader: primitive("section") }));
vi.mock("@/lib/theme/store-visual-system", () => ({ STORE_TEXT: { caption: {} }, storeTone: (_colors: unknown, tone: string) => tone }));
vi.mock("@/components/months/BoundedBusinessMonthNavigator", () => ({ BoundedBusinessMonthNavigator: primitive("month-nav") }));
vi.mock("@/hooks/use-report-month-navigation", () => ({ useReportMonthNavigation: () => ({ month: "2026-08", bounds: { min: "2025-01", max: "2026-12" }, selectMonth: vi.fn() }) }));
vi.mock("@/lib/store/revenue-store", () => ({ REVENUE_CATEGORY_LABELS: { food_cost: "食材", spirit_cost: "烈酒", wine_cost: "葡萄酒", petty_cash: "备用金", labor_cost: "人力", rent: "租金", utilities: "水电", operations: "运营" } }));

const analyticsByDate = Array.from({ length: 365 }, (_, index) => ({
  date: `2026-${String(Math.floor(index / 30) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
  amounts: { revenue: 1000 + index, food_cost: 200, spirit_cost: 100, wine_cost: 50, petty_cash: 30, labor_cost: 250, rent: 60, utilities: 20, operations: 15 },
}));
vi.mock("@/components/providers/StoreReportReadModelProvider", () => ({ useStoreReportReadModel: () => ({ model: { analyticsByDate } }) }));

import StoreAnalyticsScreen from "@/components/store/analytics";

describe("经营分析工作区渲染性能回归", () => {
  it("365日数据下连续30次时间维度切换的平均Profiler更新成本低于16ms", () => {
    const updates: number[] = [];
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Profiler id="store-analytics" onRender={(_id, phase, actualDuration) => { if (phase === "update") updates.push(actualDuration); }}><StoreAnalyticsScreen /></Profiler>);
    });
    const buttons = renderer!.root.findAll((node) => String(node.type) === "pressable");
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < 30; index += 1) {
      act(() => buttons[index % 2]!.props.onPress());
    }
    const averageDuration = updates.reduce((sum, duration) => sum + duration, 0) / updates.length;
    console.info(`[store-analytics-benchmark] updates=${updates.length} averageDurationMs=${averageDuration.toFixed(3)}`);
    expect(updates).toHaveLength(30);
    expect(averageDuration).toBeLessThan(16);
  });
});
