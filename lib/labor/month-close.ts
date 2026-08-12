import type {
  DeptCategory,
  Employee,
  FinalScheduleSnapshot,
  FrozenPayrollSnapshot,
  MonthCloseArchive,
  PayrollAdjustment,
  PaySlip,
  ShiftEntry,
} from "./types";

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function buildFrozenPayrollSnapshot(employee: Employee, slip: PaySlip): FrozenPayrollSnapshot {
  return {
    employeeId: employee.id,
    employeeName: employee.code || employee.realName,
    grossSalary: roundMoney(slip.grossSalary ?? 0),
    finalSalary: roundMoney(slip.finalSalary ?? 0),
    attendanceSalary: roundMoney(slip.attendanceSalary ?? 0),
    mealAllowance: roundMoney(slip.mealAllowance ?? 0),
    transportAllowance: roundMoney(slip.transportAllowance ?? 0),
    otherAllowance: roundMoney(slip.otherAllowance ?? 0),
    workKPIBonus: roundMoney(slip.workKPIBonus ?? 0),
    revenueKPIBonus: roundMoney(slip.revenueKPIBonus ?? 0),
    rewardPenalty: roundMoney(slip.rewardPenalty ?? 0),
    socialInsuranceDeduction: roundMoney(slip.socialInsuranceDeduction ?? 0),
    housingFundDeduction: roundMoney(slip.housingFundDeduction ?? 0),
    incomeTax: roundMoney(slip.incomeTax ?? 0),
    advanceAmount: roundMoney(slip.advanceAmount ?? 0),
    pettyLaborPaid: roundMoney(slip.pettyLaborPaid ?? 0),
  };
}

export function buildFinalScheduleByDept(
  employees: Employee[],
  shifts: ShiftEntry[],
  month: string,
): Partial<Record<DeptCategory, FinalScheduleSnapshot>> {
  const categories: DeptCategory[] = ["front", "kitchen", "company"];
  const employeeIdsByDept = new Map<DeptCategory, string[]>();
  const deptByEmployeeId = new Map<string, DeptCategory>();
  const entriesByDept = new Map<DeptCategory, ShiftEntry[]>();

  for (const category of categories) {
    employeeIdsByDept.set(category, []);
    entriesByDept.set(category, []);
  }
  for (const employee of employees) {
    if (!employee.active || employee.archived) continue;
    const category = employee.dept as DeptCategory;
    if (!employeeIdsByDept.has(category)) continue;
    employeeIdsByDept.get(category)!.push(employee.id);
    deptByEmployeeId.set(employee.id, category);
  }
  for (const shift of shifts) {
    if (!shift.date.startsWith(month)) continue;
    const category = deptByEmployeeId.get(shift.employeeId);
    if (category) entriesByDept.get(category)!.push({ ...shift });
  }

  const result: Partial<Record<DeptCategory, FinalScheduleSnapshot>> = {};
  for (const category of categories) {
    const employeeIds = employeeIdsByDept.get(category)!;
    if (employeeIds.length === 0) continue;
    const entries = entriesByDept.get(category)!;
    result[category] = { deptCategory: category, entries, employeeIds, entryCount: entries.length };
  }
  return result;
}

/**
 * 按员工和当月薪资单一次索引后构造冻结薪资快照，避免每位员工重复线性查找薪资单。
 */
export function buildFrozenPayrollByEmployee(
  employees: Employee[],
  paySlips: PaySlip[],
  month: string,
): Record<string, FrozenPayrollSnapshot> {
  const slipByEmployeeId = new Map<string, PaySlip>();
  for (const slip of paySlips) {
    if (slip.month === month) slipByEmployeeId.set(slip.employeeId, slip);
  }
  const result: Record<string, FrozenPayrollSnapshot> = {};
  for (const employee of employees) {
    if (!employee.active || employee.archived) continue;
    const slip = slipByEmployeeId.get(employee.id);
    if (slip) result[employee.id] = buildFrozenPayrollSnapshot(employee, slip);
  }
  return result;
}

const DIFF_FIELDS: Array<{ key: keyof FrozenPayrollSnapshot; label: string }> = [
  { key: "attendanceSalary", label: "考勤工资" },
  { key: "mealAllowance", label: "餐补" },
  { key: "transportAllowance", label: "交通补贴" },
  { key: "otherAllowance", label: "其他补贴" },
  { key: "workKPIBonus", label: "工作绩效" },
  { key: "revenueKPIBonus", label: "业绩绩效" },
  { key: "rewardPenalty", label: "奖惩小计" },
  { key: "socialInsuranceDeduction", label: "社保扣除" },
  { key: "housingFundDeduction", label: "公积金扣除" },
  { key: "incomeTax", label: "个税" },
  { key: "advanceAmount", label: "已预支" },
  { key: "pettyLaborPaid", label: "备用金已付" },
];

export function calculateArchiveAdjustments(
  archive: MonthCloseArchive,
  currentSnapshots: Record<string, FrozenPayrollSnapshot>,
  createdAt = Date.now(),
): PayrollAdjustment[] {
  const employeeIds = new Set([...Object.keys(archive.payrollByEmployee), ...Object.keys(currentSnapshots)]);
  const result: PayrollAdjustment[] = [];

  for (const employeeId of employeeIds) {
    const before = archive.payrollByEmployee[employeeId];
    const after = currentSnapshots[employeeId];
    if (!before || !after) continue;
    const detailParts = DIFF_FIELDS.flatMap(({ key, label }) => {
      const diff = roundMoney(((after[key] as number | undefined) ?? 0) - ((before[key] as number | undefined) ?? 0));
      return Math.abs(diff) >= 0.01 ? [`${label}: ¥${before[key] ?? 0} → ¥${after[key] ?? 0}`] : [];
    });
    const amount = roundMoney(after.finalSalary - before.finalSalary);
    if (Math.abs(amount) < 0.01 && detailParts.length === 0) continue;
    result.push({
      id: `adj-${archive.id}-${employeeId}-${createdAt}`,
      archiveId: archive.id,
      createdAt,
      employeeId,
      employeeName: after.employeeName || before.employeeName,
      amount,
      details: detailParts.join("；"),
      settled: false,
    });
  }
  return result;
}

export function getCurrentMonthCloseArchive(archives: MonthCloseArchive[], month: string): MonthCloseArchive | null {
  let current: MonthCloseArchive | null = null;
  for (const archive of archives) {
    if (archive.month !== month || archive.status !== "frozen") continue;
    if (!current || archive.version > current.version) current = archive;
  }
  return current;
}

export function getMonthCloseStatus(archives: MonthCloseArchive[], adjustingMonths: Set<string>, month: string): "draft" | "frozen" | "adjusting" {
  if (adjustingMonths.has(month)) return "adjusting";
  return getCurrentMonthCloseArchive(archives, month) ? "frozen" : "draft";
}
