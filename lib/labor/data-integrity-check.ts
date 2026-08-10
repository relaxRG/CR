/**
 * 数据一致性检查与清洗工具
 *
 * 用于检测和修复 PaySlip 中 pettyLaborPaid/pettyLaborLinkIds 与
 * 实际 PettyCashLaborLink 记录之间的不一致。
 *
 * 使用场景：
 * - App 启动时静默检查（不阻塞 UI）
 * - 管理员手动触发（设置页面）
 * - 版本升级后首次启动
 */

import type { PaySlip } from "./types";

/** 备用金关联记录的最小接口 */
interface LinkRecord {
  id: string;
  amount: number;
  employeeId: string;
  month: string;
}

/** 检查结果 */
export interface IntegrityCheckResult {
  /** 检查的薪资单数量 */
  totalSlipsChecked: number;
  /** 发现问题的薪资单数量 */
  issuesFound: number;
  /** 具体问题列表 */
  issues: IntegrityIssue[];
}

export interface IntegrityIssue {
  slipId: string;
  employeeId: string;
  month: string;
  type: "orphan_link_ids" | "amount_mismatch" | "missing_link_ids";
  description: string;
  /** 当前值 */
  currentValue: number;
  /** 应该的值 */
  expectedValue: number;
}

/**
 * 检查所有 PaySlip 中 pettyLaborPaid 与 pettyLaborLinkIds 的一致性
 *
 * @param paySlips 所有薪资单
 * @param links 所有备用金关联记录
 * @returns 检查结果
 */
export function checkPettyLaborIntegrity(
  paySlips: PaySlip[],
  links: LinkRecord[]
): IntegrityCheckResult {
  const linkMap = new Map(links.map((l) => [l.id, l]));
  const issues: IntegrityIssue[] = [];

  const slipsWithPetty = paySlips.filter(
    (s) => (s.pettyLaborPaid ?? 0) > 0 || (s.pettyLaborLinkIds?.length ?? 0) > 0
  );

  for (const slip of slipsWithPetty) {
    const linkIds = slip.pettyLaborLinkIds ?? [];
    const recordedPaid = slip.pettyLaborPaid ?? 0;

    // 检查孤立的 linkId（link 已被删除但 slip 中仍引用）
    const orphanIds = linkIds.filter((id) => !linkMap.has(id));
    if (orphanIds.length > 0) {
      const validLinks = linkIds.filter((id) => linkMap.has(id));
      const expectedPaid = validLinks.reduce((sum, id) => sum + (linkMap.get(id)?.amount ?? 0), 0);
      issues.push({
        slipId: slip.id,
        employeeId: slip.employeeId,
        month: slip.month,
        type: "orphan_link_ids",
        description: `${orphanIds.length} 条关联记录已被删除，pettyLaborPaid 可能偏高`,
        currentValue: recordedPaid,
        expectedValue: expectedPaid,
      });
      continue;
    }

    // 检查金额不一致（linkIds 对应的金额合计 ≠ pettyLaborPaid）
    const calculatedPaid = linkIds.reduce((sum, id) => sum + (linkMap.get(id)?.amount ?? 0), 0);
    if (Math.abs(calculatedPaid - recordedPaid) > 0.01) {
      issues.push({
        slipId: slip.id,
        employeeId: slip.employeeId,
        month: slip.month,
        type: "amount_mismatch",
        description: `pettyLaborPaid (¥${recordedPaid}) ≠ linkIds 合计 (¥${calculatedPaid})`,
        currentValue: recordedPaid,
        expectedValue: calculatedPaid,
      });
    }

    // 检查有 pettyLaborPaid > 0 但无 linkIds（旧版数据）
    if (recordedPaid > 0 && linkIds.length === 0) {
      issues.push({
        slipId: slip.id,
        employeeId: slip.employeeId,
        month: slip.month,
        type: "missing_link_ids",
        description: `pettyLaborPaid = ¥${recordedPaid} 但无对应 linkIds（可能是旧版数据）`,
        currentValue: recordedPaid,
        expectedValue: recordedPaid, // 保留原值（无法确定正确值）
      });
    }
  }

  return {
    totalSlipsChecked: slipsWithPetty.length,
    issuesFound: issues.length,
    issues,
  };
}

/**
 * 修复 PaySlip 中的 pettyLaborPaid 不一致
 * 仅修复 orphan_link_ids 和 amount_mismatch 类型的问题
 *
 * @param paySlips 所有薪资单
 * @param links 所有备用金关联记录
 * @returns 修复后的薪资单列表（仅包含被修改的）
 */
export function repairPettyLaborData(
  paySlips: PaySlip[],
  links: LinkRecord[]
): PaySlip[] {
  const linkMap = new Map(links.map((l) => [l.id, l]));
  const repaired: PaySlip[] = [];

  for (const slip of paySlips) {
    const linkIds = slip.pettyLaborLinkIds ?? [];
    const recordedPaid = slip.pettyLaborPaid ?? 0;

    if (recordedPaid === 0 && linkIds.length === 0) continue;

    // 移除孤立的 linkId
    const validLinkIds = linkIds.filter((id) => linkMap.has(id));
    const correctPaid = validLinkIds.reduce((sum, id) => sum + (linkMap.get(id)?.amount ?? 0), 0);

    // 检查是否需要修复
    const needsRepair =
      validLinkIds.length !== linkIds.length || // 有孤立 linkId
      Math.abs(correctPaid - recordedPaid) > 0.01; // 金额不一致

    if (needsRepair) {
      // 重新计算 finalSalary
      const oldDeduction = recordedPaid;
      const newDeduction = correctPaid;
      const finalSalaryDelta = oldDeduction - newDeduction; // 正值 = 之前多扣了
      const newFinalSalary = Math.round(((slip.finalSalary ?? 0) + finalSalaryDelta) * 100) / 100;

      repaired.push({
        ...slip,
        pettyLaborPaid: correctPaid,
        pettyLaborLinkIds: validLinkIds,
        finalSalary: newFinalSalary,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  return repaired;
}
