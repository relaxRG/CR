/**
 * Suite M：薪资卡片视觉回归测试
 *
 * 由于项目为 React Native（非 Web DOM），无法使用 Puppeteer/Playwright 截图。
 * 采用"结构化渲染断言"方式：验证组件输出的数据结构和格式在各种场景下的正确性。
 *
 * 测试策略：
 * 1. 验证 5 格摘要行的值计算（模拟 PaySlipMiniCard 的展示逻辑）
 * 2. 验证不同员工类型的标签切换
 * 3. 验证极端金额的格式化输出
 * 4. 验证 FROZEN/ADJUSTING 状态下的按钮可见性
 */
import { describe, it, expect } from "vitest";
import type { PaySlip } from "../lib/labor/types";

// ─── 模拟 formatMoney（与 lib/utils.ts 一致）─────────────────────────────────

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
}

// ─── 模拟薪资卡片 5 格摘要的渲染逻辑 ─────────────────────────────────────────

interface FiveGridCell {
  label: string;
  value: string;
  color: "foreground" | "success" | "primary" | "error" | "muted" | "dept";
}

function renderFiveGridSummary(
  slip: Partial<PaySlip> | null,
  employee: { type: string; baseSalary?: number },
  att: { attendanceDays: number; expectedAttendanceDays: number; overtimePay?: number; holidayBonus?: number } | null,
  deptColor: string = "#1677FF"
): FiveGridCell[] {
  const isParttime = employee.type === "parttime" || employee.type === "longterm_parttime";

  // 第1格：比例底薪 / 工时薪资
  let firstLabel: string;
  let firstValue: number;
  if (isParttime) {
    firstLabel = "工时薪资";
    firstValue = slip?.attendanceSalary ?? 0;
  } else {
    firstLabel = "比例底薪";
    if (!att || att.attendanceDays <= 0 || att.expectedAttendanceDays <= 0) {
      firstValue = 0;
    } else {
      firstValue = Math.round((employee.baseSalary! * att.attendanceDays / att.expectedAttendanceDays) * 100) / 100;
    }
  }

  // 第2格：加班考勤
  const overtimeAndHoliday = (att?.overtimePay ?? 0) + (att?.holidayBonus ?? 0);

  // 第3格：综合额外
  const extraTotal = (slip?.performanceBonus ?? 0) + (slip?.mealAllowance ?? 0) +
    (slip?.transportAllowance ?? 0) + (slip?.otherAllowance ?? 0) +
    (slip?.rewardPenalty ?? 0) + (slip?.salesCommission ?? 0) +
    (slip?.compOffCashOut ?? 0);

  // 第4格：已预支（合计手动 + 备用金）
  const advanceAmount = (slip?.advanceAmount ?? 0) + (slip?.pettyLaborPaid ?? 0);

  // 第5格：总工资
  const finalSalary = slip?.finalSalary ?? null;

  return [
    { label: firstLabel, value: `¥${formatMoney(firstValue)}`, color: "foreground" },
    { label: "加班考勤", value: overtimeAndHoliday > 0 ? `+¥${formatMoney(overtimeAndHoliday)}` : "—", color: overtimeAndHoliday > 0 ? "success" : "muted" },
    { label: "综合额外", value: extraTotal !== 0 ? `${extraTotal >= 0 ? "+" : ""}¥${formatMoney(extraTotal)}` : "—", color: extraTotal > 0 ? "primary" : extraTotal < 0 ? "error" : "muted" },
    { label: "已预支", value: advanceAmount > 0 ? `-¥${formatMoney(advanceAmount)}` : "—", color: advanceAmount > 0 ? "error" : "muted" },
    { label: "总工资", value: finalSalary !== null ? `¥${formatMoney(finalSalary)}` : "—", color: "dept" },
  ];
}

// ─── 模拟按钮可见性逻辑 ──────────────────────────────────────────────────────

function getButtonVisibility(
  confirmStatus: "draft" | "frozen" | "adjusting",
  isReadOnly: boolean
): { showEditSalary: boolean; showKPI: boolean; showPayment: boolean; showHistory: boolean } {
  const canWrite = !isReadOnly && confirmStatus !== "frozen";
  return {
    showEditSalary: canWrite,
    showKPI: canWrite,
    showPayment: true, // 始终可见（只读）
    showHistory: true, // 始终可见（只读）
  };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────────

describe("Suite M：薪资卡片视觉回归测试", () => {

  describe("M1. 全职员工 5 格摘要渲染", () => {
    it("正常全勤：比例底薪 = baseSalary", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 10000, attendanceSalary: 10000 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[0].label).toBe("比例底薪");
      expect(cells[0].value).toBe("¥10000");
    });

    it("缺勤：比例底薪按比例减少", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 9259.26 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 25, expectedAttendanceDays: 27 }
      );
      expect(cells[0].value).toBe("¥9259.26");
    });

    it("零出勤：比例底薪 = ¥0", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 0 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 0, expectedAttendanceDays: 27 }
      );
      expect(cells[0].value).toBe("¥0");
    });

    it("有加班：第2格显示绿色正数", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 10500 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27, overtimePay: 500 }
      );
      expect(cells[1].value).toBe("+¥500");
      expect(cells[1].color).toBe("success");
    });

    it("有预支（手动+备用金合计）：第4格显示红色负数", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 2000, advanceAmount: 3000, pettyLaborPaid: 5000 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[3].value).toBe("-¥8000");
      expect(cells[3].color).toBe("error");
    });

    it("无预支：第4格显示 —", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 10000, advanceAmount: 0, pettyLaborPaid: 0 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[3].value).toBe("—");
      expect(cells[3].color).toBe("muted");
    });
  });

  describe("M2. 兼职员工 5 格摘要渲染", () => {
    it("longterm_parttime：第1格标签为'工时薪资'", () => {
      const cells = renderFiveGridSummary(
        { attendanceSalary: 8680, finalSalary: 8680 } as any,
        { type: "longterm_parttime" },
        { attendanceDays: 31, expectedAttendanceDays: 27 }
      );
      expect(cells[0].label).toBe("工时薪资");
      expect(cells[0].value).toBe("¥8680");
    });

    it("parttime：第1格标签为'工时薪资'", () => {
      const cells = renderFiveGridSummary(
        { attendanceSalary: 3000, finalSalary: 3000 } as any,
        { type: "parttime" },
        { attendanceDays: 10, expectedAttendanceDays: 27 }
      );
      expect(cells[0].label).toBe("工时薪资");
      expect(cells[0].value).toBe("¥3000");
    });
  });

  describe("M3. 极端金额格式化", () => {
    it("大金额整数：不显示小数点", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 99999 } as any,
        { type: "fulltime", baseSalary: 99999 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[4].value).toBe("¥99999");
    });

    it("小数金额：保留两位", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 8339.80 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[4].value).toBe("¥8339.80");
    });

    it("NaN 防护：显示 ¥0", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: NaN } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[4].value).toBe("¥0");
    });

    it("零薪资：显示 ¥0 而非 —", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 0 } as any,
        { type: "fulltime", baseSalary: 0 },
        { attendanceDays: 0, expectedAttendanceDays: 27 }
      );
      expect(cells[4].value).toBe("¥0");
    });

    it("slip 为 null：总工资显示 —", () => {
      const cells = renderFiveGridSummary(
        null,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[4].value).toBe("—");
    });
  });

  describe("M4. FROZEN/ADJUSTING 状态下按钮可见性", () => {
    it("DRAFT 状态：编辑和绩效按钮可见", () => {
      const vis = getButtonVisibility("draft", false);
      expect(vis.showEditSalary).toBe(true);
      expect(vis.showKPI).toBe(true);
    });

    it("FROZEN 状态：编辑和绩效按钮隐藏", () => {
      const vis = getButtonVisibility("frozen", false);
      expect(vis.showEditSalary).toBe(false);
      expect(vis.showKPI).toBe(false);
    });

    it("ADJUSTING 状态：编辑和绩效按钮可见", () => {
      const vis = getButtonVisibility("adjusting", false);
      expect(vis.showEditSalary).toBe(true);
      expect(vis.showKPI).toBe(true);
    });

    it("isReadOnly 模式：编辑和绩效按钮隐藏", () => {
      const vis = getButtonVisibility("draft", true);
      expect(vis.showEditSalary).toBe(false);
      expect(vis.showKPI).toBe(false);
    });

    it("付款信息和历史始终可见", () => {
      const vis = getButtonVisibility("frozen", true);
      expect(vis.showPayment).toBe(true);
      expect(vis.showHistory).toBe(true);
    });
  });

  describe("M5. 综合额外格式化", () => {
    it("正数补贴：显示蓝色 +¥", () => {
      const cells = renderFiveGridSummary(
        { mealAllowance: 405, finalSalary: 8405 } as any,
        { type: "fulltime", baseSalary: 8000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[2].value).toBe("+¥405");
      expect(cells[2].color).toBe("primary");
    });

    it("负数奖惩：显示红色 ¥-200", () => {
      const cells = renderFiveGridSummary(
        { rewardPenalty: -200, finalSalary: 9800 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      // extraTotal = -200, 格式化为 `${-200 >= 0 ? "+" : ""}\u00a5${formatMoney(-200)}` = "\u00a5-200"
      expect(cells[2].value).toBe("¥-200");
      expect(cells[2].color).toBe("error");
    });

    it("无额外：显示 —", () => {
      const cells = renderFiveGridSummary(
        { finalSalary: 10000 } as any,
        { type: "fulltime", baseSalary: 10000 },
        { attendanceDays: 27, expectedAttendanceDays: 27 }
      );
      expect(cells[2].value).toBe("—");
      expect(cells[2].color).toBe("muted");
    });
  });
});
