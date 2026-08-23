/**
 * 营业时间设置页
 * - 按星期设置营业时段（开始/结束时间）
 * - 临近关门预警时长配置（如关门前1.5小时）
 * - 数据持久化到 AsyncStorage
 * - 供加班预警和经营分析使用
 */
import React, { useMemo } from "react";
import {
  Alert, Platform, Pressable, ScrollView, StyleSheet,
  Switch, Text, TextInput, TouchableOpacity, View
} from "react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/use-colors";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { ScreenContainer } from "@/components/screen-container";
import { useScheduleStore } from "@/lib/store/period-analysis/schedule-store";
import { DEFAULT_BUSINESS_HOURS, type BusinessHoursConfig as SharedBusinessHoursConfig } from "@/lib/store/period-analysis/schedule-types";


const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
// 0=周一, 1=周二, ..., 6=周日

export interface DayHours {
  open: boolean;       // 是否营业
  openTime: string;    // "11:00"
  closeTime: string;   // "24:00"
}

export interface BusinessHoursConfig {
  /** 每天的营业时间（0=周一...6=周日） */
  days: DayHours[];
  /** 临近关门预警时长（分钟，如 90 = 关门前1.5小时） */
  closingAlertMinutes: number;
  /** 是否启用加班预警 */
  overtimeAlertEnabled: boolean;
  /** 更新时间 */
  updatedAt: string;
}

function toScreenClosingTime(value: string): string {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!matched) return "24:00";
  const hour = Number(matched[1]);
  return `${String(hour >= 24 ? hour - 24 : hour).padStart(2, "0")}:${matched[2]}`;
}

function toSharedClosingTime(value: string): string {
  const matched = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!matched) return "24:00";
  const hour = Number(matched[1]);
  return `${String(hour < 12 ? hour + 24 : hour).padStart(2, "0")}:${matched[2]}`;
}

function toScreenConfig(source: SharedBusinessHoursConfig): BusinessHoursConfig {
  return {
    days: Array.from({ length: 7 }, (_, mondayIndex) => {
      const weekday = ((mondayIndex + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      const day = source.weekdayClosingTimes.find((item) => item.weekday === weekday);
      return {
        open: day?.open !== false,
        openTime: day?.openingTime ?? source.openingTime,
        closeTime: toScreenClosingTime(day?.closingTime ?? "24:00"),
      };
    }),
    closingAlertMinutes: source.closingAlertMinutes ?? 90,
    overtimeAlertEnabled: source.overtimeAlertEnabled !== false,
    updatedAt: source.updatedAt,
  };
}

function toSharedConfig(next: BusinessHoursConfig, current: SharedBusinessHoursConfig): SharedBusinessHoursConfig {
  const weekdayClosingTimes = next.days.map((day, mondayIndex) => ({
    weekday: ((mondayIndex + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    open: day.open,
    openingTime: day.openTime,
    closingTime: toSharedClosingTime(day.closeTime),
  }));
  const firstOpen = weekdayClosingTimes.find((day) => day.open)?.openingTime;
  return {
    ...current,
    openingTime: firstOpen ?? current.openingTime,
    weekdayClosingTimes,
    overtimeAlertEnabled: next.overtimeAlertEnabled,
    closingAlertMinutes: next.closingAlertMinutes,
    updatedAt: next.updatedAt,
  };
}

export default function StoreHoursScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { businessHours, updateBusinessHours } = useScheduleStore();
  const config = useMemo(() => toScreenConfig(businessHours ?? DEFAULT_BUSINESS_HOURS), [businessHours]);
  const tap = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  const save = (next: BusinessHoursConfig) => {
    const updated = { ...next, updatedAt: new Date().toISOString() };
    updateBusinessHours(toSharedConfig(updated, businessHours ?? DEFAULT_BUSINESS_HOURS));
  };

  const updateDay = (idx: number, patch: Partial<DayHours>) => {
    const next = { ...config, days: config.days.map((d, i) => i === idx ? { ...d, ...patch } : d) };
    save(next);
  };

  const handleSave = () => {
    save(config);
    Alert.alert("已保存", "营业时间设置已更新");
    router.back();
  };

  // 批量设置工作日/周末
  const applyPreset = (preset: "weekday" | "weekend" | "all") => {
    tap();
    const next = { ...config, days: config.days.map((d, i) => {
      const isWeekend = i >= 5; // 周六=5, 周日=6
      if (preset === "weekday" && isWeekend) return d;
      if (preset === "weekend" && !isWeekend) return d;
      return { ...d, openTime: "11:00", closeTime: preset === "weekend" ? "01:00" : "24:00" };
    })};
    save(next);
  };

  return (
    <ScreenContainer>
      {/* 导航栏 */}
      <View style={[S.navbar, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[S.navTitle, { color: colors.foreground }]}>营业时间设置</Text>
        <Pressable onPress={handleSave}>
          <Text style={{ fontSize: 17, fontWeight: "700", color: colors.primary }}>保存</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 + insets.bottom }}>
        {/* 说明卡片 */}
        <View style={[S.infoCard, { backgroundColor: colors.primary + "0a", borderColor: colors.primary + "22" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <IconSymbol name="clock.fill" size={16} color={colors.primary} />
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.primary }}>营业时间配置</Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 18 }}>
            设置每天的营业时段，用于：{"\n"}
            • 临近关门时段营业额预警{"\n"}
            • 加班合理性分析（营业额 vs 加班时长）{"\n"}
            • 经营分析时段对比
          </Text>
        </View>

        {/* 快捷预设 */}
        <View style={[S.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>快捷预设</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
            {[
              { key: "weekday" as const, label: "工作日 11:00–24:00" },
              { key: "weekend" as const, label: "周末 11:00–01:00" },
              { key: "all" as const, label: "全部统一" },
            ].map((p) => (
              <TouchableOpacity key={p.key} onPress={() => applyPreset(p.key)}
                style={[S.presetBtn, { borderColor: colors.primary + "44", backgroundColor: colors.primary + "08" }]}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 每天营业时间 */}
        <View style={[S.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>每天营业时间</Text>
          {config.days.map((day, idx) => {
            const isWeekend = idx >= 5;
            const dayColor = isWeekend ? colors.error : colors.primary;
            return (
              <View key={idx} style={[S.dayRow, { borderTopColor: colors.border }]}>
                {/* 星期标签 */}
                <View style={[S.dayLabel, { backgroundColor: dayColor + "15" }]}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: dayColor }}>{WEEKDAY_LABELS[idx]}</Text>
                </View>
                {/* 营业开关 */}
                <Switch
                  value={day.open}
                  onValueChange={(v) => { tap(); updateDay(idx, { open: v }); }}
                  trackColor={{ false: colors.border, true: dayColor + "66" }}
                  thumbColor={day.open ? dayColor : colors.muted}
                />
                {/* 时间输入 */}
                {day.open ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" }}>
                    <TextInput
                      value={day.openTime}
                      onChangeText={(v) => updateDay(idx, { openTime: v })}
                      placeholder="11:00"
                      placeholderTextColor={colors.muted}
                      style={[S.timeInput, { color: colors.foreground, borderColor: colors.border }]}
                    />
                    <Text style={{ color: colors.muted, fontSize: 14 }}>—</Text>
                    <TextInput
                      value={day.closeTime}
                      onChangeText={(v) => updateDay(idx, { closeTime: v })}
                      placeholder="24:00"
                      placeholderTextColor={colors.muted}
                      style={[S.timeInput, { color: colors.foreground, borderColor: isWeekend ? colors.error + "66" : colors.border }]}
                    />
                  </View>
                ) : (
                  <Text style={{ fontSize: 13, color: colors.muted, flex: 1, textAlign: "right" }}>休息日</Text>
                )}
              </View>
            );
          })}
        </View>

        {/* 临近关门预警设置 */}
        <View style={[S.card, { borderColor: "#FF3B30" + "44", backgroundColor: "#FF3B30" + "06" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <IconSymbol name="exclamationmark.triangle.fill" size={16} color="#FF3B30" />
            <Text style={[S.sectionTitle, { color: "#FF3B30" }]}>临近关门预警</Text>
          </View>

          {/* 预警开关 */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <Text style={{ fontSize: 14, color: colors.foreground }}>启用加班预警</Text>
            <Switch
              value={config.overtimeAlertEnabled}
              onValueChange={(v) => { tap(); save({ ...config, overtimeAlertEnabled: v }); }}
              trackColor={{ false: colors.border, true: "#FF3B3066" }}
              thumbColor={config.overtimeAlertEnabled ? "#FF3B30" : colors.muted}
            />
          </View>

          {/* 预警时长 */}
          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 13, color: colors.muted }}>关门前多少分钟触发预警</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {[30, 60, 90, 120].map((min) => (
                <TouchableOpacity key={min} onPress={() => { tap(); save({ ...config, closingAlertMinutes: min }); }}
                  style={[S.minuteChip, {
                    backgroundColor: config.closingAlertMinutes === min ? "#FF3B30" : colors.surface,
                    borderColor: config.closingAlertMinutes === min ? "#FF3B30" : colors.border,
                  }]}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: config.closingAlertMinutes === min ? "#fff" : colors.muted }}>
                    {min >= 60 ? `${min / 60}h` : `${min}min`}
                  </Text>
                </TouchableOpacity>
              ))}
              <TextInput
                value={String(config.closingAlertMinutes)}
                onChangeText={(v) => save({ ...config, closingAlertMinutes: Number(v) || 90 })}
                placeholder="90"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                style={[S.timeInput, { color: colors.foreground, borderColor: colors.border }]}
              />
              <Text style={{ fontSize: 12, color: colors.muted, alignSelf: "center" }}>分钟</Text>
            </View>
          </View>

          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 10, lineHeight: 16 }}>
            当员工加班时段与临近关门时段重叠时，系统将分析该时段营业额，
            判断加班是否合理并给出预警提示。
          </Text>
        </View>

        {/* 法定参考 */}
        <View style={[S.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[S.sectionTitle, { color: colors.foreground }]}>法定工作时间参考</Text>
          {[
            { label: "标准工作制", desc: "每天8小时，每周40小时" },
            { label: "综合计算工时制", desc: "以周/月/年为周期，平均每天不超过8小时" },
            { label: "不定时工作制", desc: "经批准可不受固定工时限制" },
            { label: "加班上限", desc: "每月不超过36小时" },
          ].map((item, i) => (
            <View key={i} style={[{ paddingVertical: 8 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{item.label}</Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{item.desc}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const S = StyleSheet.create({
  navbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  navTitle: { fontSize: 17, fontWeight: "600" },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sectionTitle: { fontSize: 15, fontWeight: "700" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  dayLabel: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, minWidth: 44, alignItems: "center" },
  timeInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, textAlign: "center", width: 70 },
  presetBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  minuteChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
});
