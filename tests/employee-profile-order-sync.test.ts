import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildFinalScheduleByDept } from "../lib/labor/month-close";
import { sortEmployeesByProfileOrder, sortEmployeesWithinProfileGroup } from "../lib/labor/employee-profile-order";
import type { Employee, ShiftEntry } from "../lib/labor/types";

const deptOrder = ["front", "kitchen", "other", "parttime"] as const;

function employee(id: string, dept: Employee["dept"], sortOrder: number, code: string): Employee {
  return {
    id,
    code,
    realName: code,
    phone: "",
    dept,
    type: "fulltime",
    baseSalary: 5600,
    stdHoursPerDay: 8,
    restDaysPerMonth: 8,
    hourlyRate: 30,
    overtimeHourlyRate: 50,
    notes: "",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    sortOrder,
  };
}

const shifts: ShiftEntry[] = [
  { employeeId: "front-b", date: "2026-08-01", shift: "晚班", hoursValue: 8 },
  { employeeId: "front-a", date: "2026-08-01", shift: "晚班", hoursValue: 8 },
];

describe("员工档案排序同步", () => {
  it("按员工档案的部门顺序与组内 sortOrder 生成唯一全局顺序", () => {
    const employees = [
      employee("kitchen-a", "kitchen", 1, "K01"),
      employee("front-a", "front", 2, "F02"),
      employee("front-b", "front", 1, "F01"),
      employee("other-a", "other", 0, "O01"),
    ];

    expect(sortEmployeesByProfileOrder(employees, [...deptOrder]).map((item) => item.id))
      .toEqual(["front-b", "front-a", "kitchen-a", "other-a"]);
  });

  it("员工档案调整顺序后，排班网格、考勤概况和预支选择器共用同一结果", () => {
    const employees = [
      employee("front-a", "front", 1, "F01"),
      employee("front-b", "front", 2, "F02"),
      employee("kitchen-a", "kitchen", 0, "K01"),
    ];

    const before = sortEmployeesByProfileOrder(employees, [...deptOrder]);
    expect(before.map((item) => item.id)).toEqual(["front-a", "front-b", "kitchen-a"]);

    // 模拟员工档案中将 F02 上移后，Store 仅更新 sortOrder 而不依赖数组原始位置。
    const reordered = employees.map((item) => item.id === "front-a"
      ? { ...item, sortOrder: 2 }
      : item.id === "front-b"
        ? { ...item, sortOrder: 1 }
        : item,
    );
    const profileOrder = sortEmployeesByProfileOrder(reordered, [...deptOrder]);
    const scheduleRows = sortEmployeesWithinProfileGroup(reordered.filter((item) => item.dept === "front"));
    const attendanceCards = profileOrder.filter((item) => item.dept === "front");
    const advanceChoices = profileOrder.filter((item) => item.active && !item.archived);

    expect(profileOrder.map((item) => item.id)).toEqual(["front-b", "front-a", "kitchen-a"]);
    expect(scheduleRows.map((item) => item.id)).toEqual(["front-b", "front-a"]);
    expect(attendanceCards.map((item) => item.id)).toEqual(["front-b", "front-a"]);
    expect(advanceChoices.map((item) => item.id)).toEqual(["front-b", "front-a", "kitchen-a"]);
  });

  it("新建月结冻结排班的 employeeIds 按当时员工档案组内顺序保存", () => {
    const employees = [
      employee("front-a", "front", 2, "F02"),
      employee("front-b", "front", 1, "F01"),
      employee("kitchen-a", "kitchen", 0, "K01"),
    ];

    const snapshot = buildFinalScheduleByDept(employees, shifts, "2026-08");
    expect(snapshot.front?.employeeIds).toEqual(["front-b", "front-a"]);
    expect(snapshot.kitchen?.employeeIds).toEqual(["kitchen-a"]);
  });

  it("离职员工保留归档时间顺序，不受在职员工档案重排影响", () => {
    const employees = [
      { ...employee("old", "front", 2, "F02"), archived: true, archivedAt: "2026-07-01T00:00:00.000Z" },
      { ...employee("new", "front", 1, "F01"), archived: true, archivedAt: "2026-08-01T00:00:00.000Z" },
    ];
    const archivedIds = [...employees]
      .filter((item) => item.archived)
      .sort((left, right) => (right.archivedAt ?? right.createdAt).localeCompare(left.archivedAt ?? left.createdAt))
      .map((item) => item.id);

    expect(sortEmployeesByProfileOrder(employees, [...deptOrder]).map((item) => item.id)).toEqual(["new", "old"]);
    expect(archivedIds).toEqual(["new", "old"]);
    expect(readFileSync(`${new URL("..", import.meta.url).pathname}/app/labor-archived.tsx`, "utf8"))
      .toContain("按归档时间倒序");
  });

  it("所有在职员工列表页面都显式使用统一排序工具，禁止退回到数组原始顺序", () => {
    const sourcePaths = [
      "app/labor.tsx",
      "app/labor-attendance.tsx",
      "app/labor-advances.tsx",
      "app/labor-employees.tsx",
      "app/monthly-summary.tsx",
      "lib/labor/export.ts",
      "lib/labor/import.ts",
      "lib/labor/month-close.ts",
    ];
    const root = new URL("..", import.meta.url).pathname;
    const sources = sourcePaths.map((path) => readFileSync(`${root}/${path}`, "utf8"));

    expect(sources[0]).toContain("sortEmployeesWithinProfileGroup");
    for (const source of sources.slice(1, 5)) expect(source).toContain("sortEmployeesByProfileOrder");
    expect(sources[5]).toContain("sortEmployeesWithinProfileGroup");
    expect(sources[6]).toContain("sortEmployeesWithinProfileGroup");
    expect(sources[7]).toContain("sortEmployeesWithinProfileGroup");
  });
});
