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
    performanceBonus: roundMoney(slip.performanceBonus ?? 0),
    workKPIBonus: roundMoney(slip.workKPIBonus ?? 0),
    revenueKPIBonus: roundMoney(slip.revenueKPIBonus ?? 0),
    salesCommission: roundMoney(slip.salesCommission ?? 0),
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
  const result: Partial<Record<DeptCategory, FinalScheduleSnapshot>> = {};
  const activeEmployees = employees.filter((employee) => employee.active && !employee.archived);
  const monthShifts = shifts.filter((shift) => shift.date.startsWith(month));
  const categories: DeptCategory[] = ["front", "kitchen", "company"];

  for (const category of categories) {
    const employeeIds = activeEmployees.filter((employee) => employee.dept === category).map((employee) => employee.id);
    if (employeeIds.length === 0) continue;
    const entries = monthShifts.filter((shift) => employeeIds.includes(shift.employeeId));
    result[category] = {
      deptCategory: category,
      entries: entries.map((entry) => ({ ...entry })),
      employeeIds,
      entryCount: entries.length,
    };
  }
  return result;
}

const DIFF_FIELDS: Array<{ key: keyof FrozenPayrollSnapshot; label: string }> = [
  { key: "attendanceSalary", label: "考勤工资" },
  { key: "mealAllowance", label: "餐补" },
  { key: "transportAllowance", label: "交通补贴" },
  { key: "otherAllowance", label: "其他补贴" },
  { key: "performanceBonus", label: "绩效奖金" },
  { key: "salesCommission", label: "业绩提点" },
  { key: "rewardPenalty", label: "奖惩" },
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
  return archives
    .filter((archive) => archive.month === month && archive.status === "frozen")
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

export function getMonthCloseStatus(archives: MonthCloseArchive[], adjustingMonths: Set<string>, month: string): "draft" | "frozen" | "adjusting" {
  if (adjustingMonths.has(month)) return "adjusting";
  return getCurrentMonthCloseArchive(archives, month) ? "frozen" : "draft";
}
