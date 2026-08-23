import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("全 App 工作台性能护栏", () => {
  it("将独立员工与考勤页面的高数量卡片交给窗口化 FlatList", () => {
    const employees = source("app/labor-employees.tsx");
    const attendance = source("app/labor-attendance.tsx");

    expect(employees).toContain("<FlatList<EmployeeListRow>");
    expect(employees).toContain("initialNumToRender={12}");
    expect(employees).toContain("removeClippedSubviews={Platform.OS !== \"web\"}");
    expect(employees).not.toContain("<DeptSection");

    expect(attendance).toContain("<FlatList<AttendanceListRow>");
    expect(attendance).toContain("initialNumToRender={10}");
    expect(attendance).toContain("const attMap = useMemo");
    expect(attendance).toContain("const slipMap = useMemo");
    expect(attendance).toContain("const compOffByEmp = useMemo");
  });

  it("让排班选人器和考勤概况复用月度索引，避免打开面板时反复扫描所有班次和调休流水", () => {
    const schedule = source("components/labor/LaborWorkspaceScreen.tsx");

    expect(schedule).toContain("const monthShiftEntriesByEmployeeSession = useMemo");
    expect(schedule).toContain("const attendanceByEmployee = useMemo");
    expect(schedule).toContain("const availableCompOffDaysByEmployee = useMemo");
    expect(schedule).toContain("const paySlipByEmployee = useMemo");
    expect(schedule).toContain("<FlatList");
    expect(schedule).toContain("assignedEmployeeIds.has(emp.id)");
    expect(schedule).not.toContain("monthShifts.some((s) => s.employeeId === emp.id && s.shift === tpl.session)");
  });

  it("将葡萄酒的产区和品种分组扁平化为虚拟列表行，避免大分组内部全量渲染", () => {
    const wine = source("app/(tabs)/wine.tsx");

    expect(wine).toContain("type WineGroupedRow");
    expect(wine).toContain("const createGroupedRows = useCallback");
    expect(wine).toContain("data={byRegionRows}");
    expect(wine).toContain("data={byGrapeRows}");
    expect(wine).not.toContain("function GroupSection");
  });

  it("仅挂载当前研发子页，而不是用 display:none 保留后台计算和订阅", () => {
    const lab = source("app/(tabs)/lab.tsx");

    expect(lab).toContain('tab === "list" && listSubTab === "sale" &&');
    expect(lab).toContain('tab === "list" && listSubTab === "purchase" &&');
    expect(lab).toContain('tab === "plan" &&');
    expect(lab).toContain('tab === "rd" &&');
    expect(lab).not.toContain("styles.hidden");
  });
});
