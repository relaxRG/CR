import { describe, expect, it } from "vitest";
import {
  finalizeModuleMonth,
  getCurrentModuleArchive,
  getModuleMonthCloseStatus,
  isModuleMonthWritable,
  openModuleAdjustment,
  summarizeModuleMonth,
} from "@/lib/month-close/module-month-close";

describe("模块独立月度归档", () => {
  const month = "2026-07";

  it("工资归档只锁工资，不锁葡萄酒或烈酒", () => {
    const result = finalizeModuleMonth([], [], {
      module: "payroll",
      month,
      snapshot: { employees: 8, total: 41892.17 },
      paymentSummary: { payable: 41892.17, paid: 0, remaining: 41892.17 },
      now: 1,
    });

    expect(result.archive).not.toBeNull();
    expect(getModuleMonthCloseStatus(result.archives, [], "payroll", month)).toBe("frozen_unpaid");
    expect(isModuleMonthWritable(result.archives, [], "payroll", month)).toBe(false);
    expect(getModuleMonthCloseStatus(result.archives, [], "wine", month)).toBe("draft");
    expect(isModuleMonthWritable(result.archives, [], "wine", month)).toBe(true);
    expect(getModuleMonthCloseStatus(result.archives, [], "spirits", month)).toBe("draft");
  });

  it("模块付款状态独立计算待付、部分付款与已结清", () => {
    const unpaid = finalizeModuleMonth([], [], {
      module: "wine", month, snapshot: { bottles: 30 },
      paymentSummary: { payable: 15199, paid: 0, remaining: 15199 }, now: 1,
    }).archives;
    expect(getModuleMonthCloseStatus(unpaid, [], "wine", month)).toBe("frozen_unpaid");

    const partial = finalizeModuleMonth([], [], {
      module: "spirits", month, snapshot: { bottles: 134 },
      paymentSummary: { payable: 10000, paid: 3500, remaining: 6500 }, now: 2,
    }).archives;
    expect(getModuleMonthCloseStatus(partial, [], "spirits", month)).toBe("frozen_partial");

    const settled = finalizeModuleMonth([], [], {
      module: "food", month, snapshot: { ingredients: 26 },
      paymentSummary: { payable: 9000, paid: 9000, remaining: 0 }, now: 3,
    }).archives;
    expect(getModuleMonthCloseStatus(settled, [], "food", month)).toBe("frozen_paid");
  });

  it("一个月份可同时存在不同模块的不同结算状态", () => {
    const payroll = finalizeModuleMonth([], [], {
      module: "payroll", month, snapshot: { employees: 8 },
      paymentSummary: { payable: 40000, paid: 10000, remaining: 30000 }, now: 1,
    }).archives;
    const wine = finalizeModuleMonth(payroll, [], {
      module: "wine", month, snapshot: { bottles: 20 },
      paymentSummary: { payable: 0, paid: 0, remaining: 0 }, now: 2,
    }).archives;

    expect(summarizeModuleMonth(wine, [], "payroll", month).status).toBe("frozen_partial");
    expect(summarizeModuleMonth(wine, [], "wine", month).status).toBe("frozen_paid");
    expect(summarizeModuleMonth(wine, [], "food", month).status).toBe("draft");
  });

  it("调整只打开目标模块，且重新归档只替换该模块版本", () => {
    const wineV1 = finalizeModuleMonth([], [], {
      module: "wine", month, snapshot: { closingCost: 12000 },
      paymentSummary: { payable: 12000, paid: 12000, remaining: 0 }, now: 1,
    }).archives;
    const spiritsV1 = finalizeModuleMonth(wineV1, [], {
      module: "spirits", month, snapshot: { closingCost: 8000 },
      paymentSummary: { payable: 8000, paid: 0, remaining: 8000 }, now: 2,
    }).archives;

    const session = openModuleAdjustment(spiritsV1, [], "wine", month, "补录供应商发票", 3);
    expect(session?.module).toBe("wine");
    expect(getModuleMonthCloseStatus(spiritsV1, [session!], "wine", month)).toBe("adjusting");
    expect(getModuleMonthCloseStatus(spiritsV1, [session!], "spirits", month)).toBe("frozen_unpaid");

    const v2 = finalizeModuleMonth(spiritsV1, [session!], {
      module: "wine", month, snapshot: { closingCost: 12500 },
      paymentSummary: { payable: 12500, paid: 12000, remaining: 500 }, now: 4,
    });
    expect(v2.archive?.version).toBe(2);
    expect(getCurrentModuleArchive(v2.archives, "wine", month)?.paymentSummary.remaining).toBe(500);
    expect(getCurrentModuleArchive(v2.archives, "spirits", month)?.version).toBe(1);
  });

  it("同一模块同一月份不允许重复归档或重复开启调整", () => {
    const first = finalizeModuleMonth([], [], {
      module: "petty_cash", month, snapshot: { closing: 3000 },
      paymentSummary: { payable: 0, paid: 0, remaining: 0 }, now: 1,
    });
    const duplicate = finalizeModuleMonth(first.archives, [], {
      module: "petty_cash", month, snapshot: { closing: 3333 },
      paymentSummary: { payable: 0, paid: 0, remaining: 0 }, now: 2,
    });
    expect(duplicate.archive).toBeNull();

    const session = openModuleAdjustment(first.archives, [], "petty_cash", month, "月末对账修正", 3);
    expect(session).not.toBeNull();
    const duplicateSession = openModuleAdjustment(first.archives, [session!], "petty_cash", month, "重复调整", 4);
    expect(duplicateSession).toBeNull();
  });

  it("付款汇总按分归一，避免小数尾差和超付状态错误", () => {
    const result = finalizeModuleMonth([], [], {
      module: "food", month, snapshot: {},
      paymentSummary: { payable: 0.3, paid: 0.1 + 0.2, remaining: 999 }, now: 1,
    });
    expect(result.archive?.paymentSummary).toEqual({ payable: 0.3, paid: 0.3, remaining: 0 });
  });
});
