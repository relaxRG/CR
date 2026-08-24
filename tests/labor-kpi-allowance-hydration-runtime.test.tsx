import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { labor, router } = vi.hoisted(() => ({
  labor: {
    employees: [] as Array<Record<string, unknown>>,
  },
  router: { back: vi.fn(), push: vi.fn() },
}));

function primitive(name: string) {
  return ({ children }: { children?: React.ReactNode }) => React.createElement(name, null, children);
}

vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  ScrollView: primitive("ScrollView"),
  StyleSheet: { create: <T,>(value: T) => value },
  Text: primitive("Text"),
  TextInput: primitive("TextInput"),
  TouchableOpacity: primitive("TouchableOpacity"),
  View: primitive("View"),
}));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ employeeId: "e-1", month: "2026-08" }),
  useRouter: () => router,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/hooks/use-colors", () => ({
  useColors: () => ({ background: "#fff", surface: "#eee", border: "#ddd", foreground: "#111", muted: "#666", primary: "#06f", success: "#080", warning: "#f80", error: "#c00" }),
}));
vi.mock("@/components/screen-container", () => ({ ScreenContainer: primitive("ScreenContainer") }));
vi.mock("@/components/ui/icon-symbol", () => ({ IconSymbol: primitive("IconSymbol") }));
vi.mock("@/lib/labor/store", () => ({
  useEmployeeStore: () => ({ employees: labor.employees }),
  usePaySlipStore: () => ({ paySlips: [], getPaySlip: vi.fn(() => null), upsertPaySlip: vi.fn(), buildPaySlipDraft: vi.fn() }),
  useAttendanceStore: () => ({ getAttendance: vi.fn(() => null), records: [] }),
  useGlobalPayrollSettingsStore: () => ({ settings: {} }),
  useMonthCloseStore: () => ({ isMonthWritable: () => true }),
}));
import LaborKPIAllowanceEditPage from "@/app/labor-kpi-allowance-edit";
import LaborKPIAllowancePage from "@/app/labor-kpi-allowance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("绩效补贴编辑页真实水合稳定性", () => {
  let renderer: ReactTestRenderer | null = null;
  let consoleError: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    labor.employees = [];
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = null;
    consoleError?.mockRestore();
    consoleError = null;
  });

  async function expectEmployeeHydrationToStayHookSafe(Page: React.ComponentType) {
    await act(async () => { renderer = create(<Page />); });
    expect(renderer?.toJSON()).not.toBeNull();

    labor.employees = [{
      id: "e-1",
      realName: "测试员工",
      allowanceRules: [],
      workKPIRules: [],
      revenueKPIRules: [],
    }];
    await act(async () => { renderer?.update(<Page />); });

    expect(renderer?.toJSON()).not.toBeNull();
    const errors = consoleError?.mock.calls.flat().join(" ") ?? "";
    expect(errors).not.toContain("Rendered more hooks than during the previous render");
    expect(errors).not.toContain("Rendered fewer hooks than expected");
  }

  it("编辑页在员工从缺失状态水合为有效档案后保持稳定Hook顺序", async () => {
    await expectEmployeeHydrationToStayHookSafe(LaborKPIAllowanceEditPage);
  });

  it("只读页在员工从缺失状态水合为有效档案后保持稳定Hook顺序", async () => {
    await expectEmployeeHydrationToStayHookSafe(LaborKPIAllowancePage);
  });
});
