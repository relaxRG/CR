/**
 * 薪资类金额输入规则：只允许非负数文本（奖励/惩罚的正负由独立按钮控制），
 * 最多两位小数；保留编辑中的尾随小数点，避免输入“38.”时被立即回写成“38”。
 */
export function normalizeMoneyDraft(value: string): string {
  const compact = value.replace(/[，,]/g, ".").replace(/[^0-9.]/g, "");
  const firstDot = compact.indexOf(".");
  if (firstDot < 0) return compact.replace(/^0+(?=\d)/, "");

  const integer = compact.slice(0, firstDot).replace(/^0+(?=\d)/, "") || "0";
  const fraction = compact.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  return `${integer}.${fraction}`;
}

export function moneyDraftToAmount(draft: string): number {
  if (!draft || draft === "." || draft === "0.") return 0;
  const parsed = Number(draft);
  return Number.isFinite(parsed) ? roundMoneyToCents(parsed) : 0;
}

export function roundMoneyToCents(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

/** 供失焦、保存和重新打开编辑器时使用的稳定显示文本。 */
export function formatEditableMoney(value: number): string {
  const rounded = roundMoneyToCents(Math.abs(value));
  return rounded === 0 ? "" : String(rounded);
}
