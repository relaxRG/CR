import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const laborSource = readFileSync(resolve(process.cwd(), "app/labor.tsx"), "utf8");

describe("薪资生成确认与排班纠错清空 UI 守卫", () => {
  it("生成薪资单在执行前必须经过独立的二次确认，不承担清空排班职责", () => {
    expect(laborSource).toContain('Alert.alert(\n      "确认生成薪资单"');
    expect(laborSource).toContain('text: "确认生成", onPress: continueGeneratePayroll');
    expect(laborSource).toContain("此操作不会清空错误排班");
    expect(laborSource).toContain("const continueGeneratePayroll = useCallback");
  });

  it("强制清空本月排班只能在可写月份执行，并要求两次破坏性确认", () => {
    expect(laborSource).toContain("const handleForceClearCurrentMonthSchedule = useCallback");
    expect(laborSource).toContain('"强制清空本月排班"');
    expect(laborSource).toContain('"最后确认"');
    expect(laborSource).toContain('"确认清空"');
    expect(laborSource).toContain("if (!isMonthWritable(currentMonth))");
    expect(laborSource).toContain("batchDeleteShifts(entriesToClear.map");
  });

  it("清空排班后立即用空排班重算派生考勤薪资，同时保留独立人工结算字段", () => {
    expect(laborSource).toContain("calcFromShifts(employee.id, currentMonth, employee, [], specialStatuses, [])");
    expect(laborSource).toContain("upsertAttendance(emptyAttendance)");
    expect(laborSource).toContain("buildPaySlipDraft(");
    expect(laborSource).toContain("existingSlip?.performanceBonus ?? 0");
    expect(laborSource).toContain("correctedSlip.holidayBonusAllocation = undefined");
    expect(laborSource).toContain("correctedSlip.compOffUsage = undefined");
  });

  it("调休在写入排班前必须校验来源余额，避免无余额时被错误计作带薪出勤", () => {
    expect(laborSource).toContain("const availableDays = ss.id === \"ss_comp_off_holiday\"");
    expect(laborSource).toContain("if (availableDays < 1)");
    expect(laborSource).toContain('Alert.alert("调休余额不足"');
  });

  it("编辑模式提供独立且明确的清空本月入口，而非将其塞入生成薪资单按钮", () => {
    expect(laborSource).toContain('accessibilityLabel="强制清空本月排班并重算考勤工资"');
    expect(laborSource).toContain(">清空本月</Text>");
  });
});
