import React from "react";
import { Text, View } from "react-native";

import { useI18n } from "@/lib/i18n";
import { LAB_CHANGE_COLORS, LabChange } from "@/lib/lab/types";

/**
 * 变量维度 chip 行:展示批次相对上一版的差异标记。
 * amount=蓝、product=紫、technique=橙、add=绿、remove=红、其他=灰。
 */
export function LabChangeChips({
  changes,
  isBaseline,
  max,
}: {
  changes: LabChange[];
  /** v1 起始版本(无 parent) */
  isBaseline: boolean;
  /** 最多展示数量,超出显示 +n;不传则全部展示 */
  max?: number;
}) {
  const { t } = useI18n();
  if (isBaseline) {
    return (
      <View className="flex-row flex-wrap" style={{ gap: 6 }}>
        <Chip color="#6B7280" label={t("lab.changes.base")} />
      </View>
    );
  }
  if (changes.length === 0) {
    return (
      <View className="flex-row flex-wrap" style={{ gap: 6 }}>
        <Chip color="#9CA3AF" label={t("lab.changes.none")} subtle />
      </View>
    );
  }
  const shown = max ? changes.slice(0, max) : changes;
  const rest = changes.length - shown.length;
  return (
    <View className="flex-row flex-wrap" style={{ gap: 6 }}>
      {shown.map((c, i) => {
        const color = LAB_CHANGE_COLORS[c.type];
        const typeLabel = t(`lab.change.${c.type}` as "lab.change.amount");
        let detail = "";
        if (c.type === "amount") detail = `${c.ingredientName} ${c.from}→${c.to}`;
        else if (c.type === "product") detail = `${c.from}→${c.to}`;
        else if (c.type === "add") detail = c.to;
        else if (c.type === "remove") detail = c.from;
        else detail = c.from && c.to ? `${c.from}→${c.to}` : c.to || c.from;
        return <Chip key={i} color={color} label={`${typeLabel} · ${detail}`} />;
      })}
      {rest > 0 ? <Chip color="#9CA3AF" label={`+${rest}`} subtle /> : null}
    </View>
  );
}

function Chip({ color, label, subtle }: { color: string; label: string; subtle?: boolean }) {
  return (
    <View
      className="flex-row items-center rounded-md px-1.5"
      style={{
        backgroundColor: color + (subtle ? "14" : "1F"),
        paddingVertical: 2,
        gap: 4,
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color }} />
      <Text
        className="text-[11px] font-medium"
        style={{ color, lineHeight: 15 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}
