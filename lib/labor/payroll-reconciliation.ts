import { subtractMoney, sumMoney } from "@/lib/finance/money";
import { getCompOffCashOutSettlementAmount } from "./comp-off-cashout-settlement";
import type { PaySlip } from "./types";

export interface PayrollReconciliation {
  extrasTotal: number;
  grossSalary: number;
  deductionsTotal: number;
  finalSalary: number;
  storedGrossVariance: number;
  storedFinalVariance: number;
}

type PayrollExtraInput = Pick<PaySlip,
  "workKPIBonus" | "revenueKPIBonus" | "mealAllowance" | "transportAllowance" | "otherAllowance" | "rewardPenalty" | "compOffCashOutSettlement"
>;

type PayrollGrossInput = Pick<PaySlip, "attendanceSalary"> & PayrollExtraInput;

type PayrollFinalInput = PayrollGrossInput & Pick<PaySlip,
  "socialInsuranceDeduction" | "housingFundDeduction" | "incomeTax" | "advanceAmount" | "pettyLaborPaid"
>;

/** 所有加项均由专属结算器给出；调休兑现只能来自已验证的事件账本快照。 */
export function calculatePayrollExtras(input: PayrollExtraInput): number {
  return sumMoney([
    input.workKPIBonus,
    input.revenueKPIBonus,
    input.mealAllowance,
    input.transportAllowance,
    input.otherAllowance,
    input.rewardPenalty,
    getCompOffCashOutSettlementAmount(input),
  ]);
}

export function calculateGrossSalary(input: PayrollGrossInput): number {
  return sumMoney([input.attendanceSalary, calculatePayrollExtras(input)]);
}

export function calculateFinalSalary(input: PayrollFinalInput): number {
  return subtractMoney(calculateGrossSalary(input), [
    input.socialInsuranceDeduction,
    input.housingFundDeduction,
    input.incomeTax,
    input.advanceAmount,
    input.pettyLaborPaid,
  ]);
}

/** 将已保存薪资单与唯一按分公式对账；非零差额必须在 UI 中显式提示并触发重算。 */
export function reconcilePaySlip(slip: Pick<PaySlip,
  "attendanceSalary" | "workKPIBonus" | "revenueKPIBonus" | "mealAllowance" | "transportAllowance" | "otherAllowance" | "rewardPenalty" | "compOffCashOutSettlement" |
  "socialInsuranceDeduction" | "housingFundDeduction" | "incomeTax" | "advanceAmount" | "pettyLaborPaid" | "grossSalary" | "finalSalary"
>): PayrollReconciliation {
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
