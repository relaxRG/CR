import { subtractMoney, sumMoney } from "@/lib/finance/money";
import type { PaySlip } from "./types";

export interface PayrollReconciliation {
  extrasTotal: number;
  grossSalary: number;
  deductionsTotal: number;
  finalSalary: number;
  storedGrossVariance: number;
  storedFinalVariance: number;
}

export function calculatePayrollExtras(input: Pick<PaySlip, "workKPIBonus" | "revenueKPIBonus" | "mealAllowance" | "transportAllowance" | "otherAllowance" | "rewardPenalty" | "compOffCashOut">): number {
  return sumMoney([
    input.workKPIBonus,
    input.revenueKPIBonus,
    input.mealAllowance,
    input.transportAllowance,
    input.otherAllowance,
    input.rewardPenalty,
    input.compOffCashOut,
  ]);
}

export function calculateGrossSalary(input: Pick<PaySlip, "attendanceSalary" | "workKPIBonus" | "revenueKPIBonus" | "mealAllowance" | "transportAllowance" | "otherAllowance" | "rewardPenalty" | "compOffCashOut">): number {
  return sumMoney([input.attendanceSalary, calculatePayrollExtras(input)]);
}

export function calculateFinalSalary(input: Pick<PaySlip, "attendanceSalary" | "workKPIBonus" | "revenueKPIBonus" | "mealAllowance" | "transportAllowance" | "otherAllowance" | "rewardPenalty" | "compOffCashOut" | "socialInsuranceDeduction" | "housingFundDeduction" | "incomeTax" | "advanceAmount" | "pettyLaborPaid">): number {
  return subtractMoney(calculateGrossSalary(input), [
    input.socialInsuranceDeduction,
    input.housingFundDeduction,
    input.incomeTax,
    input.advanceAmount,
    input.pettyLaborPaid,
  ]);
}

/** 将已保存薪资单与唯一按分公式对账；非0差额必须在UI中显式提示并触发重算。 */
export function reconcilePaySlip(slip: Pick<PaySlip, "attendanceSalary" | "workKPIBonus" | "revenueKPIBonus" | "mealAllowance" | "transportAllowance" | "otherAllowance" | "rewardPenalty" | "compOffCashOut" | "socialInsuranceDeduction" | "housingFundDeduction" | "incomeTax" | "advanceAmount" | "pettyLaborPaid" | "grossSalary" | "finalSalary">): PayrollReconciliation {
  const extrasTotal = calculatePayrollExtras(slip);
  const grossSalary = calculateGrossSalary(slip);
  const deductionsTotal = sumMoney([
    slip.socialInsuranceDeduction,
    slip.housingFundDeduction,
    slip.incomeTax,
    slip.advanceAmount,
    slip.pettyLaborPaid,
  ]);
  const finalSalary = calculateFinalSalary(slip);
  return {
    extrasTotal,
    grossSalary,
    deductionsTotal,
    finalSalary,
    storedGrossVariance: subtractMoney(slip.grossSalary, [grossSalary]),
    storedFinalVariance: subtractMoney(slip.finalSalary, [finalSalary]),
  };
}
