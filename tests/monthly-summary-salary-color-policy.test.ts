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
