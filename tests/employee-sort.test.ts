/**
 * 员工排序功能自动化测试
 * 覆盖：分组顺序 Store、员工 sortOrder、全局联动
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_DEPT_ORDER } from "@/lib/labor/store";
import type { EmployeeDept } from "@/lib/labor/types";

// ── 工具函数（模拟排序页面逻辑）──────────────────────────────────────────────

function moveDept(order: EmployeeDept[], index: number, direction: "up" | "down"): EmployeeDept[] {
  const next = [...order];
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= next.length) return next;
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

function moveEmployee<T extends { id: string }>(
  list: T[], index: number, direction: "up" | "down"
): T[] {
  const next = [...list];
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= next.length) return next;
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return next;
}

function buildSortOrderMap(orderedIds: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  orderedIds.forEach((id, i) => { map[id] = i + 1; });
  return map;
}

// ── 测试：DEFAULT_DEPT_ORDER ──────────────────────────────────────────────────

describe("DEFAULT_DEPT_ORDER", () => {
  it("默认分组顺序包含 4 个分组", () => {
    expect(DEFAULT_DEPT_ORDER).toHaveLength(4);
  });

  it("默认分组顺序为 front, kitchen, other, parttime", () => {
    expect(DEFAULT_DEPT_ORDER).toEqual(["front", "kitchen", "other", "parttime"]);
  });

  it("所有分组键都是有效的 EmployeeDept 值", () => {
    const validDepts: EmployeeDept[] = ["front", "kitchen", "other", "parttime"];
    DEFAULT_DEPT_ORDER.forEach((dept) => {
      expect(validDepts).toContain(dept);
    });
  });
});

// ── 测试：分组顺序移动逻辑 ────────────────────────────────────────────────────

describe("分组顺序移动逻辑", () => {
  let order: EmployeeDept[];

  beforeEach(() => {
    order = ["front", "kitchen", "other", "parttime"];
  });

  it("向上移动第一个分组不改变顺序", () => {
    const result = moveDept(order, 0, "up");
    expect(result).toEqual(["front", "kitchen", "other", "parttime"]);
  });

  it("向下移动最后一个分组不改变顺序", () => {
    const result = moveDept(order, 3, "down");
    expect(result).toEqual(["front", "kitchen", "other", "parttime"]);
  });

  it("向上移动第二个分组", () => {
    const result = moveDept(order, 1, "up");
    expect(result).toEqual(["kitchen", "front", "other", "parttime"]);
  });

  it("向下移动第二个分组", () => {
    const result = moveDept(order, 1, "down");
    expect(result).toEqual(["front", "other", "kitchen", "parttime"]);
  });

  it("连续移动：将 parttime 移到第一位", () => {
    let result = order;
    result = moveDept(result, 3, "up"); // parttime -> index 2
    result = moveDept(result, 2, "up"); // parttime -> index 1
    result = moveDept(result, 1, "up"); // parttime -> index 0
    expect(result[0]).toBe("parttime");
  });

  it("移动操作不修改原数组（不可变）", () => {
    const original = [...order];
    moveDept(order, 1, "up");
    expect(order).toEqual(original);
  });

  it("两次对称移动恢复原始顺序", () => {
    const after = moveDept(order, 1, "down");
    const restored = moveDept(after, 2, "up");
    expect(restored).toEqual(order);
  });
});

// ── 测试：员工顺序移动逻辑 ────────────────────────────────────────────────────

describe("员工顺序移动逻辑", () => {
  const employees = [
    { id: "e1", code: "A01", realName: "张三" },
    { id: "e2", code: "A02", realName: "李四" },
    { id: "e3", code: "A03", realName: "王五" },
    { id: "e4", code: "A04", realName: "赵六" },
  ];

  it("向上移动第一个员工不改变顺序", () => {
    const result = moveEmployee(employees, 0, "up");
    expect(result.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("向下移动最后一个员工不改变顺序", () => {
    const result = moveEmployee(employees, 3, "down");
    expect(result.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });

  it("向上移动第二个员工", () => {
    const result = moveEmployee(employees, 1, "up");
    expect(result.map((e) => e.id)).toEqual(["e2", "e1", "e3", "e4"]);
  });

  it("向下移动第二个员工", () => {
    const result = moveEmployee(employees, 1, "down");
    expect(result.map((e) => e.id)).toEqual(["e1", "e3", "e2", "e4"]);
  });

  it("移动操作不修改原数组（不可变）", () => {
    const original = employees.map((e) => e.id);
    moveEmployee(employees, 1, "up");
    expect(employees.map((e) => e.id)).toEqual(original);
  });

  it("连续移动：将最后一个员工移到第一位", () => {
    let list = [...employees];
    list = moveEmployee(list, 3, "up");
    list = moveEmployee(list, 2, "up");
    list = moveEmployee(list, 1, "up");
    expect(list[0].id).toBe("e4");
    expect(list.map((e) => e.id)).toEqual(["e4", "e1", "e2", "e3"]);
  });
});

// ── 测试：sortOrder 映射生成 ──────────────────────────────────────────────────

describe("sortOrder 映射生成", () => {
  it("按顺序生成 sortOrder（从 1 开始）", () => {
    const ids = ["e3", "e1", "e2"];
    const map = buildSortOrderMap(ids);
    expect(map).toEqual({ e3: 1, e1: 2, e2: 3 });
  });

  it("空数组生成空映射", () => {
    expect(buildSortOrderMap([])).toEqual({});
  });

  it("单个员工的 sortOrder 为 1", () => {
    expect(buildSortOrderMap(["e1"])).toEqual({ e1: 1 });
  });

  it("sortOrder 值唯一且连续", () => {
    const ids = ["e1", "e2", "e3", "e4", "e5"];
    const map = buildSortOrderMap(ids);
    const values = Object.values(map).sort((a, b) => a - b);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });
});

// ── 测试：isDirty 检测逻辑 ────────────────────────────────────────────────────

describe("isDirty 检测逻辑", () => {
  const defaultOrder: EmployeeDept[] = ["front", "kitchen", "other", "parttime"];

  function isDirtyDeptOrder(local: EmployeeDept[], saved: EmployeeDept[]): boolean {
    return local.join(",") !== saved.join(",");
  }

  function isDirtyEmpOrder(localIds: string[], originalIds: string[]): boolean {
    return localIds.join(",") !== originalIds.join(",");
  }

  it("未修改时 isDirty 为 false", () => {
    expect(isDirtyDeptOrder(defaultOrder, defaultOrder)).toBe(false);
  });

  it("修改分组顺序后 isDirty 为 true", () => {
    const modified = moveDept(defaultOrder, 0, "down");
    expect(isDirtyDeptOrder(modified, defaultOrder)).toBe(true);
  });

  it("未修改员工顺序时 isDirty 为 false", () => {
    const ids = ["e1", "e2", "e3"];
    expect(isDirtyEmpOrder(ids, ids)).toBe(false);
  });

  it("修改员工顺序后 isDirty 为 true", () => {
    const original = ["e1", "e2", "e3"];
    const modified = ["e2", "e1", "e3"];
    expect(isDirtyEmpOrder(modified, original)).toBe(true);
  });

  it("恢复原始顺序后 isDirty 为 false", () => {
    let order = [...defaultOrder];
    order = moveDept(order, 1, "down");
    order = moveDept(order, 2, "up");
    expect(isDirtyDeptOrder(order, defaultOrder)).toBe(false);
  });
});

// ── 测试：分组过滤逻辑 ────────────────────────────────────────────────────────

describe("分组过滤逻辑", () => {
  const DEPT_GROUP_DEFS = {
    front:    { filter: (e: any) => e.dept === "front" && e.type !== "parttime" },
    kitchen:  { filter: (e: any) => e.dept === "kitchen" && e.type !== "parttime" },
    other:    { filter: (e: any) => e.dept === "other" && e.type !== "parttime" },
    parttime: { filter: (e: any) => e.type === "parttime" },
  };

  const employees = [
    { id: "e1", dept: "front",   type: "fulltime" },
    { id: "e2", dept: "kitchen", type: "fulltime" },
    { id: "e3", dept: "other",   type: "fulltime" },
    { id: "e4", dept: "front",   type: "parttime" },       // 临时兼职（前厅部门）
    { id: "e5", dept: "kitchen", type: "longterm_parttime" }, // 长期兼职（后厨部门）
  ];

  it("前厅分组只包含全职/长期兼职前厅员工", () => {
    const result = employees.filter(DEPT_GROUP_DEFS.front.filter);
    expect(result.map((e) => e.id)).toEqual(["e1"]);
  });

  it("临时兼职分组包含所有 parttime 员工（不论部门）", () => {
    const result = employees.filter(DEPT_GROUP_DEFS.parttime.filter);
    expect(result.map((e) => e.id)).toEqual(["e4"]);
  });

  it("长期兼职不进入临时兼职分组（按部门归属）", () => {
    const parttimeResult = employees.filter(DEPT_GROUP_DEFS.parttime.filter);
    expect(parttimeResult.map((e) => e.id)).not.toContain("e5");
    const kitchenResult = employees.filter(DEPT_GROUP_DEFS.kitchen.filter);
    expect(kitchenResult.map((e) => e.id)).toContain("e5");
  });

  it("按 deptOrder 顺序生成分组列表", () => {
    const deptOrder: EmployeeDept[] = ["parttime", "front", "kitchen", "other"];
    const groups = deptOrder.map((k) => ({ key: k, ...DEPT_GROUP_DEFS[k] }));
    expect(groups[0].key).toBe("parttime");
    expect(groups[1].key).toBe("front");
  });
});
