import React, { Profiler } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const employees = Array.from({ length: 500 }, (_, index) => ({ id: `employee-${index}`, active: true, archived: false, dept: index % 2 ? "front" : "kitchen", type: "fulltime" }));
const paySlips = Array.from({ length: 12 }, (_, monthIndex) => Array.from({ length: 500 }, (_, employeeIndex) => ({ id: `slip-${monthIndex}-${employeeIndex}`, month: `2026-${String(monthIndex + 1).padStart(2, "0")}`, employeeId: `employee-${employeeIndex}`, finalSalary: 5000 + employeeIndex, pettyLaborPaid: 100, advanceAmount: 50 }))).flat();

vi.mock("react-native", async () => {
  const ReactModule = await import("react");
  const primitive = (name: string) => ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => ReactModule.createElement(name, props, children);
  return { Alert: { alert: vi.fn() }, Clipboard: {}, FlatList: primitive("flat-list"), InteractionManager: {}, KeyboardAvoidingView: primitive("keyboard"), Modal: primitive("modal"), Platform: { OS: "ios", select: (values: Record<string, unknown>) => values.ios ?? values.default }, Pressable: primitive("pressable"), ScrollView: primitive("scroll"), StyleSheet: { create: <T,>(value: T) => value, hairlineWidth: 1 }, Text: primitive("text"), TextInput: primitive("input"), TouchableOpacity: primitive("touchable"), View: primitive("view"), useWindowDimensions: () => ({ width: 390, height: 844 }) };
});
vi.mock("expo-haptics", () => ({ ImpactFeedbackStyle: { Light: "light" }, impactAsync: vi.fn() }));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), useLocalSearchParams: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/lib/utils", () => ({ formatMoney: (value: number) => String(value) }));
vi.mock("@/lib/theme/numeric-color-tokens", () => ({ numericColor: () => "#06f", NUMERIC_TONE: {} }));
vi.mock("@/lib/theme/responsive-pager", () => ({ getResponsivePagerIndex: () => 0, getResponsivePagerOffset: () => 0 }));
vi.mock("@/lib/labor/schedule-guards", () => ({ getNonWritableScheduleMonths: () => [] }));
vi.mock("@/lib/labor/employee-profile-order", () => ({ sortEmployeesByProfileOrder: (items: unknown[]) => items, sortEmployeesWithinProfileGroup: (items: unknown[]) => items }));
vi.mock("@/lib/labor/month-close-operation-gate", () => ({ createMonthCloseOperationGate: () => ({}) }));
vi.mock("@/lib/labor/holiday-pay", () => ({ applyHolidayRestAllocation: vi.fn() }));
vi.mock("@/lib/labor/holiday-work", () => ({ getHolidayAllocationKey: vi.fn(), getHolidayWorkInfo: vi.fn() }));
vi.mock("@/lib/labor/payroll-sync-guards", () => ({ shouldAutoSyncPayrollMonth: () => false }));
vi.mock("@/lib/labor/payroll-extras", () => ({ resolveDraftPayrollExtrasForDisplay: vi.fn(), resolvePersistedPayrollExtrasForDisplay: vi.fn() }));
vi.mock("@/lib/labor/payroll-draft-reconciliation", () => ({ getDraftPayrollCumulativeTaxInputs: vi.fn(), hasDraftPayrollReconciliationDelta: () => false }));
vi.mock("@/lib/labor/payroll-monitor", () => ({ checkControlFieldsIntegrity: vi.fn(), checkAdvanceCrossMonthPollution: vi.fn() }));
vi.mock("@/lib/labor/payroll-reconciliation", () => ({ reconcilePaySlip: vi.fn() }));
vi.mock("@/lib/labor/comp-off-cashout-settlement", () => ({ createCompOffCashOutSettlementSnapshot: vi.fn(), getCompOffCashOutSettlementAmount: vi.fn(), settleCompOffCashOut: vi.fn() }));
vi.mock("@/lib/labor/comp-off-settlement", () => ({ getCompOffDemandDays: vi.fn(), getCompOffSource: vi.fn(), getExpiringCompOffEntries: vi.fn(), getOvertimeCompOffValidation: vi.fn(), planCompOffBalanceConsumption: vi.fn() }));
vi.mock("@/hooks/use-colors", () => ({ useColors: () => ({}) }));
vi.mock("@/hooks/use-debounce-fn", () => ({ useThrottleFn: (fn: unknown) => fn }));
vi.mock("@/lib/inventory-core/month-browser", () => ({ deriveInventoryMonthBounds: () => ({}) }));
vi.mock("@/lib/labor/store", () => ({ useEmployeeStore: () => ({ employees }), usePaySlipStore: () => ({ paySlips }), useAttendanceStore: () => ({}) }));
vi.mock("@/lib/months/global-business-month", () => ({ useGlobalBusinessMonth: () => ({ selectMonth: vi.fn(), month: "2026-12" }) }));
vi.mock("@/components/labor/LaborCompareToggle", async () => { const ReactModule = await import("react"); return { LaborCompareToggle: ({ onChange }: { onChange: (value: "none" | "lastMonth") => void }) => ReactModule.createElement("compare-toggle", null, ReactModule.createElement("compare-button", { onPress: () => onChange("lastMonth") }), ReactModule.createElement("compare-button", { onPress: () => onChange("none") })) }; });
vi.mock("@/components/store/store-visual-primitives", async () => { const ReactModule = await import("react"); return { StoreMetric: () => ReactModule.createElement("metric"), StoreSectionHeader: () => ReactModule.createElement("section"), StoreSegmentedTabs: () => ReactModule.createElement("tabs"), StoreToolbarAction: () => ReactModule.createElement("toolbar") }; });
vi.mock("@/components/ui/icon-symbol", async () => { const ReactModule = await import("react"); return { IconSymbol: () => ReactModule.createElement("icon") }; });
vi.mock("@/lib/theme/store-visual-system", () => ({ STORE_TEXT: { caption: {}, body: {} }, STORE_VISUAL_SYSTEM: { density: { phoneMax: 480 }, weight: { emphasis: "700" } }, storeTone: () => "#06f" }));
vi.mock("@/lib/backup/local-backup", () => ({ createSnapshot: vi.fn() }));
vi.mock("@/components/labor/PayrollReconciliationPanel", async () => { const ReactModule = await import("react"); return { PayrollReconciliationPanel: () => ReactModule.createElement("payroll-panel") }; });
vi.mock("@/components/screen-container", async () => { const ReactModule = await import("react"); return { ScreenContainer: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement("screen", null, children) }; });
vi.mock("@/components/months/BoundedBusinessMonthNavigator", async () => { const ReactModule = await import("react"); return { BoundedBusinessMonthNavigator: () => ReactModule.createElement("month-nav") }; });
vi.mock("@/components/forms/MoneyInput", async () => { const ReactModule = await import("react"); return { MoneyInput: () => ReactModule.createElement("money-input") }; });
vi.mock("@/components/floating-tab-bar", () => ({ fabBottom: () => 0 }));
vi.mock("@/hooks/use-can", () => ({ useCan: () => ({ allowed: true }) }));
vi.mock("@/lib/labor/advance-store", () => ({ useSalaryAdvanceStore: () => ({}), useAdvanceCategoryStore: () => ({}) }));
vi.mock("@/lib/store/petty-store", () => ({ PETTY_CODE_LABELS: {}, usePettyCashStore: () => ({ records: [] }) }));
vi.mock("@/lib/store/petty-labor-link-store", () => ({ usePettyLaborLinkStore: () => ({}), matchEmployeeFromDescription: vi.fn(), extractKeywords: vi.fn() }));

import { LaborOverviewCard } from "@/components/labor/LaborWorkspaceScreen";

describe("人力总览渲染性能回归", () => {
  it("500名员工与12个月薪资单下连续30次比较切换的平均Profiler更新成本低于16ms", () => {
    const updates: number[] = [];
    let renderer: ReturnType<typeof create>;
    const colors = { surface: "#fff", border: "#ddd", foreground: "#111", muted: "#667", primary: "#06f", error: "#d33", success: "#087" };
    act(() => { renderer = create(<Profiler id="labor-overview" onRender={(_id, phase, actualDuration) => { if (phase === "update") updates.push(actualDuration); }}><LaborOverviewCard month="2026-12" colors={colors} /></Profiler>); });
    const controls = renderer!.root.findAll((node) => String(node.type) === "compare-button");
    expect(controls).toHaveLength(2);
    for (let index = 0; index < 30; index += 1) act(() => controls[index % 2]!.props.onPress());
    const averageDuration = updates.reduce((sum, duration) => sum + duration, 0) / updates.length;
    console.info(`[labor-overview-benchmark] updates=${updates.length} averageDurationMs=${averageDuration.toFixed(3)}`);
    expect(updates).toHaveLength(30);
    expect(averageDuration).toBeLessThan(16);
  });
});
