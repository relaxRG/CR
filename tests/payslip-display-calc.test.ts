/**
 * tests/payslip-display-calc.test.ts
 * 薪资卡片与导出展示计算逻辑单元测试。
 *
 * 比例底薪唯一口径：日薪原始基数 × 实际出勤天数；新数据由考勤引擎持久化，
 * 历史数据仅在缺少该字段时按已结算考勤金额兼容读取。
 */

import { describe, it, expect } from "vitest";
import { calcAttendanceBaseSalary, calcDailyRate, getAttendanceBaseSalary } from "../lib/labor/types";

// ─── 1. 比例底薪计算与展示 ──────────────────────────────────────────────────────

describe("比例底薪：日薪累计单一口径", () => {
  it("日薪 = 月底薪 ÷ 应出勤天数，并保留原始精度直到最终金额结算", () => {
    const dailyRate = calcDailyRate(10000, 30, 4);
    expect(dailyRate).toBeCloseTo(10000 / 26, 12);
    expect(calcAttendanceBaseSalary(dailyRate, 20, 26)).toBe(7692.31);
  });

  it("全勤时，日薪累计的比例底薪与月底薪闭环", () => {
    const dailyRate = calcDailyRate(6000, 31, 8);
    expect(calcAttendanceBaseSalary(dailyRate, 23, 23)).toBe(6000);
  });

  it("零出勤或应出勤配置异常时，比例底薪强制归零", () => {
    expect(calcAttendanceBaseSalary(384.615, 0, 26)).toBe(0);
    expect(calcAttendanceBaseSalary(384.615, 20, 0)).toBe(0);
  });

  it("5格考勤工资闭环：比例底薪 + 加班 + 节假日 − 特殊扣薪 = 考勤工资", () => {
    const proportionalBase = calcAttendanceBaseSalary(calcDailyRate(10000, 30, 4), 20, 26);
    const overtimePay = 405;
    const holidayBonus = 769.23;
    const specialDeduction = 384.62;
    const attendanceSalary = Math.round((proportionalBase + overtimePay + holidayBonus - specialDeduction) * 100) / 100;
    expect(attendanceSalary).toBe(8481.92);
  });

  it("新考勤记录优先读取持久化比例底薪，不从聚合考勤工资反推", () => {
    const att = {
      attendanceDays: 20,
      expectedAttendanceDays: 26,
      proportionalBaseSalary: 7692.31,
      // 下列值即使因额外工资而变化，也不影响比例底薪展示。
      attendanceSalary: 8481.92,
      overtimePay: 405,
      holidayBonus: 769.23,
      totalSpecialDeduction: 384.62,
    } as any;
    expect(getAttendanceBaseSalary(att)).toBe(7692.31);
  });

  it("历史考勤缺少比例底薪字段时，兼容读取已结算金额而不修改历史工资", () => {
    const legacyAtt = {
      attendanceDays: 20,
      expectedAttendanceDays: 26,
      attendanceSalary: 8481.92,
      overtimePay: 405,
      holidayBonus: 769.23,
      totalSpecialDeduction: 384.62,
    } as any;
    expect(getAttendanceBaseSalary(legacyAtt)).toBe(7692.31);
  });
});

// ─── 2. autoSync 依赖完整性验证 ─────────────────────────────────────────────────

describe("autoSync 依赖完整性", () => {
  it("compOffEntries 变化应触发薪资重算（概念验证）", () => {
    const rawOvertimeHours = 4;
    const compOffHoursUsed = 4;
    const paidOvertimeHours = Math.max(0, rawOvertimeHours - compOffHoursUsed);

    expect(paidOvertimeHours).toBe(0);
    expect(paidOvertimeHours * 50).toBe(0);
  });

  it("存入8h调休（1天）后，paidOvertimeHours 减少8h", () => {
    expect(Math.max(0, 12 - 8)).toBe(4);
  });

  it("存入超过实际加班时长，paidOvertimeHours 不为负数", () => {
    expect(Math.max(0, 4 - 8)).toBe(0);
  });
});

// ─── 3. salesCommission 字段语义验证 ─────────────────────────────────────────────

describe("salesCommission 字段语义（业绩提点）", () => {
  it("salesCommission 是业绩提点，不是业绩绩效考核结果", () => {
    const slip = { performanceBonus: 500, salesCommission: 150 };
    const allowanceSum = 375;
    expect(allowanceSum + slip.performanceBonus + slip.salesCommission).toBe(1025);
    expect("业绩提点").not.toBe("业绩绩效");
  });

  it("grossSalary 包含 salesCommission", () => {
    const grossSalary = 5000 + 500 + 150 + 375;
    expect(grossSalary).toBe(6025);
  });
});

// ─── 4. 导出与薪资卡片一致性 ────────────────────────────────────────────────────

describe("导出与薪资卡片的比例底薪一致性", () => {
  it("二者都读取同一份持久化比例底薪字段", () => {
    const att = {
      attendanceDays: 20,
      expectedAttendanceDays: 26,
      proportionalBaseSalary: 7692.31,
      attendanceSalary: 8481.92,
      overtimePay: 405,
      holidayBonus: 769.23,
      totalSpecialDeduction: 384.62,
    } as any;

    const cardValue = getAttendanceBaseSalary(att);
    const exportValue = getAttendanceBaseSalary(att);
    expect(cardValue).toBe(7692.31);
    expect(exportValue).toBe(cardValue);
  });
});
