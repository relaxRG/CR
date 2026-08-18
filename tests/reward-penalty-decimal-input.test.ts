import { describe, expect, it } from "vitest";
import {
  formatEditableMoney,
  moneyDraftToAmount,
  normalizeMoneyDraft,
  roundMoneyToCents,
} from "@/lib/labor/money-input";

describe("奖惩金额两位小数输入", () => {
  it("保留编辑中的小数点，使38.能够继续输入为38.5", () => {
    expect(normalizeMoneyDraft("38.")).toBe("38.");
    expect(normalizeMoneyDraft(`${normalizeMoneyDraft("38.")}5`)).toBe("38.5");
    expect(moneyDraftToAmount("38.")).toBe(38);
    expect(moneyDraftToAmount("38.5")).toBe(38.5);
  });

  it("接受逗号小数点、拒绝非数值字符并限制为两位小数", () => {
    expect(normalizeMoneyDraft("￥38,56元")).toBe("38.56");
    expect(normalizeMoneyDraft("38.567")).toBe("38.56");
    expect(normalizeMoneyDraft("12.3.4")).toBe("12.34");
  });

  it("保存时按分规范化，奖惩汇总不出现浮点误差", () => {
    const rewards = [38.55, 0.1, -0.2].map(roundMoneyToCents);
    expect(roundMoneyToCents(rewards.reduce((sum, value) => sum + value, 0))).toBe(38.45);
    // UI先通过normalizeMoneyDraft截断为38.55；直接传入持久化边界时按分四舍五入。
    expect(moneyDraftToAmount(normalizeMoneyDraft("38.555"))).toBe(38.55);
    expect(moneyDraftToAmount("38.555")).toBe(38.56);
    expect(formatEditableMoney(-38.5)).toBe("38.5");
  });

  it("空草稿和孤立小数点保持零金额，惩罚符号由独立切换控制", () => {
    expect(moneyDraftToAmount("")).toBe(0);
    expect(moneyDraftToAmount(".")).toBe(0);
    expect(moneyDraftToAmount("0.")).toBe(0);
    expect(-moneyDraftToAmount("38.25")).toBe(-38.25);
  });
});
