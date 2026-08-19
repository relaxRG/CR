import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("总月报工资区颜色语义", () => {
  const source = read("app/monthly-summary.tsx");

  it("应发与已预支使用主文字/中性色，不把常规金额误标为告警", () => {
    expect(source).toContain('color: colors.foreground }]}>¥{formatMoney(grossAmt)}</Text>');
    expect(source).toContain('color: colors.muted }]}>\n                                      {advAmt > 0 ? `-¥${formatMoney(advAmt)}` : "0"}');
  });

  it("待发金额只在未发且存在余额时使用告警色，已发和零金额不制造红绿噪音", () => {
    expect(source).toContain('color: finalAmt <= 0 ? colors.muted : (isPaid ? colors.foreground : colors.error)');
    expect(source).toContain('{isPaid ? "✓ 已发" : "未发"}');
  });

  it("保留原有付款与复制付款交互，不以颜色改造代替业务功能", () => {
    expect(source).toContain('if (!isPaid) handleOpenPaymentModal(payment.id, emp.realName, finalAmt);');
    expect(source).toContain('handleCopy([');
    expect(source).toContain('`金额：${finalAmt.toFixed(0)}`');
  });
});


describe("总月报营业收入与财务颜色语义", () => {
  const source = read("app/monthly-summary.tsx");

  it("营业收入固定按菜品大类呈现，并将手续费作为独立区块", () => {
    expect(source).toContain("本营业收入 · 菜品大类");
    expect(source).toContain(">手续费</Text>");
    expect(source).toContain("presentation.dishRevenueItems");
    expect(source).toContain("presentation.feeItems");
  });

  it("净利润是唯一按正负颜色变化的主金额，日常收入、支出和费用金额使用中性色", () => {
    expect(source).toContain('netProfit >= 0 ? colors.success : colors.error');
    expect(source).toContain('color: colors.foreground }}>{formatStoreMoney(totalRevenue)}</Text>');
    expect(source).toContain('color: colors.foreground }}>{formatStoreMoney(totalExpenses)}</Text>');
    expect(source).not.toContain('color: sec.sign > 0 ? colors.success : colors.error');
  });

  it("嵌入报表页不重复处理顶部安全区，滚动内容使用紧凑顶部和安全底部预留", () => {
    expect(source).toContain('edges={embedded ? [] : undefined}');
    expect(source).toContain('paddingTop: 12');
    expect(source).toContain('paddingBottom: 16 + insets.bottom');
  });
});
