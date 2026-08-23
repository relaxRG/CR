import React, { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthCloseArchive } from "@/lib/labor/types";

const { storage, storageApi, notifySyncChange } = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    storage: values,
    storageApi: {
      multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, values.get(key) ?? null] as [string, string | null])),
      setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
      multiSet: vi.fn(async (pairs: [string, string][]) => { pairs.forEach(([key, value]) => values.set(key, value)); }),
    },
    notifySyncChange: vi.fn(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({ default: storageApi }));
vi.mock("@/lib/sync/engine", () => ({
  notifySyncChange,
  registerStoreReload: vi.fn(() => vi.fn()),
}));

import {
  ReportMonthCloseProvider,
  useReportMonthCloseStore,
} from "@/lib/labor/report-month-close-provider";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CloseStore = ReturnType<typeof useReportMonthCloseStore>;
const summary: MonthCloseArchive["summary"] = {
  totalEmployees: 1,
  totalGrossSalary: 10000,
  totalFinalSalary: 10000,
  totalDeductions: 0,
};

function seedFacts() {
  storage.set("labor_month_close_archives_v1", "[]");
  storage.set("labor_month_adjustment_sessions_v1", "[]");
  storage.set("labor_employees_v1", JSON.stringify([{
    id: "e-1", code: "E1", realName: "员工一", phone: "", dept: "front", type: "fulltime",
    baseSalary: 10000, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 50, notes: "", active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  }]));
  storage.set("labor_shifts_v1", JSON.stringify([{ employeeId: "e-1", date: "2026-08-01", shift: "正常班", hoursValue: 8 }]));
  storage.set("labor_attendances_v1", "[]");
  storage.set("labor_payslips_v1", JSON.stringify([{
    id: "p-1", employeeId: "e-1", month: "2026-08", attendanceDays: 27, attendanceSalary: 10000,
    workKPIBonus: 0, revenueKPIBonus: 0, mealAllowance: 0, transportAllowance: 0, otherAllowance: 0,
    rewardPenalty: 0, advanceAmount: 0, grossSalary: 10000, socialInsuranceDeduction: 0,
    housingFundDeduction: 0, incomeTax: 0, finalSalary: 10000, notes: "", employerSocialInsurance: 0,
    employerHousingFund: 0, totalEmployerCost: 10000, updatedAt: "2026-08-31T00:00:00.000Z",
  }]));
}

function Capture({ onValue }: { onValue: (value: CloseStore) => void }) {
  const value = useReportMonthCloseStore();
  useEffect(() => { onValue(value); }, [onValue, value]);
  return null;
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("报告月结受控命令渲染器行为", () => {
  let renderer: ReactTestRenderer | null = null;
  let latest: CloseStore | null = null;

  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    seedFacts();
  });

  afterEach(async () => {
    if (renderer) await act(async () => { renderer?.unmount(); });
    renderer = null;
    latest = null;
  });

  async function mount() {
    await act(async () => {
      renderer = create(<ReportMonthCloseProvider><Capture onValue={(value) => { latest = value; }} /></ReportMonthCloseProvider>);
    });
    await flush();
    expect(latest?.ready).toBe(true);
    return latest!;
  }

  it("归档命令在确认时读取事实快照、持久化唯一归档并通知同步", async () => {
    const store = await mount();
    let archive: MonthCloseArchive | null = null;
    await act(async () => { archive = await store.finalizeMonthClose("2026-08", summary); });

    expect(archive).toEqual(expect.objectContaining({ month: "2026-08", version: 1, status: "frozen" }));
    const persisted = JSON.parse(storage.get("labor_month_close_archives_v1") ?? "[]") as MonthCloseArchive[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.payrollByEmployee["e-1"]?.finalSalary).toBe(10000);
    expect(notifySyncChange).toHaveBeenCalledWith("labor_month_close_archives_v1");
  });

  it("同月执行中的第二次归档会被操作守卫拒绝，首个命令完成后不残留锁", async () => {
    const store = await mount();
    const delayedRead: { release: (() => void) | null } = { release: null };
    storageApi.multiGet.mockImplementationOnce(() => new Promise<[string, string | null][]>((resolve) => {
      delayedRead.release = () => resolve([
        ["labor_employees_v1", storage.get("labor_employees_v1") ?? null],
        ["labor_shifts_v1", storage.get("labor_shifts_v1") ?? null],
        ["labor_attendances_v1", storage.get("labor_attendances_v1") ?? null],
        ["labor_payslips_v1", storage.get("labor_payslips_v1") ?? null],
      ]);
    }));

    await act(async () => {
      const first = store.finalizeMonthClose("2026-08", summary);
      await expect(store.finalizeMonthClose("2026-08", summary)).resolves.toBeNull();
      const release = delayedRead.release;
      if (!release) throw new Error("延迟事实读取未启动");
      release();
      await expect(first).resolves.toEqual(expect.objectContaining({ month: "2026-08" }));
    });
  });

  it("事实快照读取失败时命令安全返回空结果且释放操作守卫", async () => {
    const store = await mount();
    storageApi.multiGet.mockRejectedValueOnce(new Error("storage offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await act(async () => {
      await expect(store.finalizeMonthClose("2026-08", summary)).resolves.toBeNull();
      await expect(store.finalizeMonthClose("2026-08", summary)).resolves.toEqual(expect.objectContaining({ month: "2026-08" }));
    });
    expect(warning).toHaveBeenCalledWith("报告月结归档命令失败", expect.any(Error));
    warning.mockRestore();
  });
});
