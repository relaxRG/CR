import type { Employee, EmployeeDept } from "./types";

/**
 * 员工档案中的排序是员工相关界面的唯一排序来源：
 * 先按员工排序页保存的部门顺序，再按该分组内的 sortOrder，最后使用稳定字段兜底。
 * 函数始终返回新数组，禁止直接修改 Store 的员工数组。
 */
export function sortEmployeesByProfileOrder<T extends Pick<Employee, "id" | "code" | "dept" | "sortOrder">>(
  employees: readonly T[],
  deptOrder: readonly EmployeeDept[],
): T[] {
  const deptIndex = new Map(deptOrder.map((dept, index) => [dept, index]));
  const fallbackDeptIndex = deptOrder.length;

  return [...employees].sort((left, right) => {
    const leftDept = deptIndex.get(left.dept) ?? fallbackDeptIndex;
    const rightDept = deptIndex.get(right.dept) ?? fallbackDeptIndex;
    if (leftDept !== rightDept) return leftDept - rightDept;

    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const codeOrder = (left.code ?? "").localeCompare(right.code ?? "");
    if (codeOrder !== 0) return codeOrder;
    return left.id.localeCompare(right.id);
  });
}

/** 在已经按部门筛选的员工集合中复用档案内排序。 */
export function sortEmployeesWithinProfileGroup<T extends Pick<Employee, "id" | "code" | "dept" | "sortOrder">>(
  employees: readonly T[],
): T[] {
  return [...employees].sort((left, right) => {
    const leftOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    const codeOrder = (left.code ?? "").localeCompare(right.code ?? "");
    if (codeOrder !== 0) return codeOrder;
    return left.id.localeCompare(right.id);
  });
}
