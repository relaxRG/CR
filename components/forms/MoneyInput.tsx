import React, { useEffect, useState } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { formatEditableMoney, moneyDraftToAmount, normalizeMoneyDraft } from "@/lib/labor/money-input";

type MoneyInputProps = Omit<TextInputProps, "value" | "onChangeText" | "keyboardType" | "inputMode"> & {
  value: number;
  onValueChange: (value: number) => void;
  /** 默认两位小数；费率等输入可传入更高精度。 */
  maximumFractionDigits?: number;
  /** 对绩效等可正可负金额启用负号输入。 */
  allowNegative?: boolean;
};

function normalizeDraft(value: string, maximumFractionDigits: number, allowNegative: boolean): string {
  const sign = allowNegative && value.trimStart().startsWith("-") ? "-" : "";
  const unsigned = value.replace(/-/g, "");
  const normalized = normalizeMoneyDraft(unsigned);
  if (!normalized) return sign;
  const [integer, fraction] = normalized.split(".");
  return `${sign}${integer}${normalized.includes(".") ? `.${(fraction ?? "").slice(0, maximumFractionDigits)}` : ""}`;
}

function draftToValue(draft: string): number {
  if (draft === "-" || draft === "" || draft === "." || draft === "-.") return 0;
  const negative = draft.startsWith("-");
  const value = moneyDraftToAmount(negative ? draft.slice(1) : draft);
  return negative ? -value : value;
}

export function MoneyInput({
  value,
  onValueChange,
  maximumFractionDigits = 2,
  allowNegative = false,
  onBlur,
  ...props
}: MoneyInputProps) {
  const [draft, setDraft] = useState(() => `${value < 0 ? "-" : ""}${formatEditableMoney(value)}`);
  const [lastCommittedValue, setLastCommittedValue] = useState(value);

  // 仅接受外部真实更新；本控件刚刚回写同一个数值时保留“38.”等编辑草稿。
  useEffect(() => {
    if (value !== lastCommittedValue) {
      setDraft(`${value < 0 ? "-" : ""}${formatEditableMoney(value)}`);
      setLastCommittedValue(value);
    }
  }, [value, lastCommittedValue]);

  return (
    <TextInput
      {...props}
      value={draft}
      keyboardType="decimal-pad"
      inputMode="decimal"
      onChangeText={(next) => {
        const normalized = normalizeDraft(next, maximumFractionDigits, allowNegative);
        const nextValue = draftToValue(normalized);
        setDraft(normalized);
        setLastCommittedValue(nextValue);
        onValueChange(nextValue);
      }}
      onBlur={(event) => {
        setDraft(`${value < 0 ? "-" : ""}${formatEditableMoney(value)}`);
        setLastCommittedValue(value);
        onBlur?.(event);
      }}
    />
  );
}
