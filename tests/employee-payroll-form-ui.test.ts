import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const formSource = readFileSync(resolve(process.cwd(), "app/labor-employee-form.tsx"), "utf8");
const profileSource = readFileSync(resolve(process.cwd(), "app/labor-employee-profile.tsx"), "utf8");

describe("员工薪资设置 UI：日薪计薪天数与时薪输入边界", () => {
  it("全职不再提供“正常时薪（参考）”的人工填写控件", () => {
    expect(formSource).not.toContain("正常时薪（参考）");
    expect(profileSource).not.toContain("正常时薪（参考）");
    expect(formSource).toContain("全职不再提供“正常时薪”人工填写项");
  });

  it("日薪分母明确展示为只读的自然月计薪天数", () => {
    expect(formSource).toContain('FormRow label="日薪计薪天数"');
    expect(formSource).toContain("天（自然月天数，自动计算）");
    expect(formSource).toContain("calcDailyRate(base, daysInMonth, rest)");
    expect(formSource).not.toContain("customDivDays");
    expect(formSource).not.toContain("当月工作天数");
  });

  it("全职日薪参考时薪只读推导，并可一键带入实际加班时薪", () => {
    expect(formSource).toContain("日薪参考时薪（日薪 ÷ 平均灵活工时；只读且不参与实际薪资计算）");
    expect(formSource).toContain("setOvertimeRate(String(autoHourlyRatePreview))");
    expect(formSource).toContain("采用日薪参考");
    expect(formSource).toContain("日薪参考：¥{formatMoney(autoHourlyRatePreview)}/小时");
  });

  it("全职保存日薪参考值、兼职保留人工时薪，并允许实际加班时薪为 0", () => {
    expect(formSource).toContain("hourlyRate: isFulltime ? autoHourlyRatePreview : (Number(hourlyRate) || 0)");
    expect(formSource).toContain("overtimeRate.trim() === \"\"");
    expect(formSource).toContain("overtimeHourlyRate: overtimeRateValue");
    expect(formSource).toContain("支持显式填写 0");
  });

  it("员工详情页只展示真正参与计算的加班时薪", () => {
    expect(profileSource).toContain('InfoRow label="加班时薪（实际计算）"');
    expect(profileSource).not.toContain("正常时薪（参考）");
  });
});
