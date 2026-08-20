import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useState } from "react";

import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { useSync } from "@/lib/cf-sync/provider";
import type { FreshBaselineResult } from "@/lib/data/fresh-business-baseline";

/**
 * 数据管理只提供可恢复备份入口与受确认保护的“全新业务基线”。
 * 禁止在页面内维护业务键清单、局部删除清单或直接调用 AsyncStorage.clear()。
 */
export default function DataManagerScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const { createFreshBusinessBaseline, isGroupSwitching } = useSync();
  const [baselineRunning, setBaselineRunning] = useState(false);
  const [baselineResult, setBaselineResult] = useState<FreshBaselineResult | null>(null);

  const zh = lang === "zh";
  const tap = () => {
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const runFreshBaseline = async () => {
    setBaselineRunning(true);
    try {
      const result = await createFreshBusinessBaseline();
      setBaselineResult(result);
      if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        zh ? "已创建全新业务基线" : "Fresh business baseline created",
        zh
          ? `已验证备份 ${result.backup.keyCount} 项业务数据，并创建新的空同步组。旧同步组仍保留为归档，不会回流到本机。`
          : `A verified backup contains ${result.backup.keyCount} business records. A new empty sync group is now active; the old group remains archived and cannot flow back.`,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      Alert.alert(
        zh ? "未完成切换" : "Baseline not completed",
        zh
          ? `没有继续清空或创建新组。请先检查网络、旧组成员资格和备份，再重试。\n\n${code}`
          : `No further clearing or new-group creation was completed. Check network, old membership, and backup before retrying.\n\n${code}`,
      );
    } finally {
      setBaselineRunning(false);
    }
  };

  const requestFreshBaseline = () => {
    tap();
    const firstMessage = zh
      ? "这不是普通更新：系统会先验证本机业务备份，然后让当前设备退出旧同步组、清空本机业务数据与业务图片，最后创建新的空主同步组。旧云端组和备份不会被删除。"
      : "This is not a normal update: the app verifies a local business backup, leaves the old group, clears this device's business data and business photos, then creates a new empty owner group. The archived cloud group and backup are not deleted.";
    const finalMessage = zh
      ? "最后确认：当前设备将从零开始。其他设备不会自动加入新组，必须使用新的配对码重新加入。"
      : "Final confirmation: this device will start from zero. Other devices will not join automatically and must use a new pair code.";

    const confirmFinal = () => {
      if (Platform.OS === "web") {
        if (window.confirm(finalMessage)) void runFreshBaseline();
        return;
      }
      Alert.alert(
        zh ? "最终确认" : "Final confirmation",
        finalMessage,
        [
          { text: zh ? "取消" : "Cancel", style: "cancel" },
          { text: zh ? "开始全新基线" : "Start fresh baseline", style: "destructive", onPress: () => void runFreshBaseline() },
        ],
      );
    };

    if (Platform.OS === "web") {
      if (window.confirm(firstMessage)) confirmFinal();
      return;
    }
    Alert.alert(
      zh ? "创建全新业务基线" : "Create fresh business baseline",
      firstMessage,
      [
        { text: zh ? "取消" : "Cancel", style: "cancel" },
        { text: zh ? "继续" : "Continue", style: "destructive", onPress: confirmFinal },
      ],
    );
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel={zh ? "返回" : "Back"}
          >
            <IconSymbol name="chevron.left" size={20} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>{zh ? "返回" : "Back"}</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>{zh ? "数据管理" : "Data management"}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            {zh ? "备份、设备同步与全新业务基线" : "Backup, device sync, and fresh business baseline"}
          </Text>
        </View>

        <SectionLabel color={colors.muted} title={zh ? "备份与恢复" : "Backup and recovery"} />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ActionRow
            color="#0EA5E9"
            icon="externaldrive.fill"
            title={zh ? "备份与恢复" : "Backup and recovery"}
            description={zh ? "查看可恢复快照、导出与恢复记录" : "View recoverable snapshots, exports, and restore records"}
            foreground={colors.foreground}
            muted={colors.muted}
            onPress={() => { tap(); router.push("/backup"); }}
          />
        </View>

        <SectionLabel color={colors.muted} title={zh ? "设备与同步" : "Device and sync"} />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ActionRow
            color="#5856D6"
            icon="laptopcomputer.and.iphone"
            title={zh ? "设备管理" : "Device manager"}
            description={zh ? "查看当前同步组、设备身份与配对状态" : "Review the active group, identity, and pairing state"}
            foreground={colors.foreground}
            muted={colors.muted}
            onPress={() => { tap(); router.push("/device-manager"); }}
          />
        </View>

        <SectionLabel color={colors.muted} title={zh ? "危险操作" : "Danger zone"} />
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ActionRow
            color={colors.error}
            icon="arrow.counterclockwise"
            title={baselineRunning || isGroupSwitching
              ? (zh ? "正在创建全新业务基线…" : "Creating fresh business baseline…")
              : (zh ? "开始全新业务基线" : "Start fresh business baseline")}
            description={zh
              ? "验证备份后退出旧组，清空本机业务数据并创建新的空同步组"
              : "Verify backup, leave old group, clear this device's business data, and create a new empty sync group"}
            foreground={colors.error}
            muted={colors.muted}
            disabled={baselineRunning || isGroupSwitching}
            onPress={requestFreshBaseline}
            testID="fresh-business-baseline-start"
          />
        </View>

        <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <IconSymbol name="shield.fill" size={16} color={colors.primary} />
          <Text style={[styles.noticeText, { color: colors.muted }]}>
            {zh
              ? "普通 App 更新不会触发此操作。旧同步组和验证后的本地快照会保留为归档；新组只在你完成两次确认后创建，其他设备必须重新配对。"
              : "A normal app update never triggers this operation. The old sync group and verified local snapshot remain archived; the new group is created only after two confirmations and every other device must pair again."}
          </Text>
        </View>

        {baselineResult ? (
          <View style={[styles.result, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="fresh-business-baseline-result">
            <Text style={[styles.resultTitle, { color: colors.foreground }]}>{zh ? "最近一次完成结果" : "Latest completed result"}</Text>
            <Text style={[styles.resultText, { color: colors.muted }]}>{zh ? `已验证备份槽位：${baselineResult.backup.slot}` : `Verified backup slot: ${baselineResult.backup.slot}`}</Text>
            <Text style={[styles.resultText, { color: colors.muted }]}>{zh ? `已清理业务键：${baselineResult.removedBusinessKeyCount}` : `Business keys cleared: ${baselineResult.removedBusinessKeyCount}`}</Text>
            <Text style={[styles.resultText, { color: colors.muted }]}>{zh ? `新同步组：${baselineResult.newGroupId}` : `New sync group: ${baselineResult.newGroupId}`}</Text>
          </View>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function SectionLabel({ title, color }: { title: string; color: string }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={[styles.sectionLabelText, { color }]}>{title}</Text>
    </View>
  );
}

function ActionRow({
  color,
  icon,
  title,
  description,
  foreground,
  muted,
  disabled = false,
  onPress,
  testID,
}: {
  color: string;
  icon: string;
  title: string;
  description: string;
  foreground: string;
  muted: string;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [styles.row, (pressed || disabled) && { opacity: disabled ? 0.55 : 0.7 }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: color }]}>
        {disabled ? <ActivityIndicator size="small" color="#FFFFFF" /> : <IconSymbol name={icon as any} size={18} color="#FFFFFF" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: foreground }]}>{title}</Text>
        <Text style={[styles.rowDesc, { color: muted }]}>{description}</Text>
      </View>
      <IconSymbol name="chevron.right" size={18} color={muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  backBtn: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  backText: { fontSize: 16, marginLeft: 2 },
  title: { fontSize: 28, fontWeight: "600" },
  subtitle: { fontSize: 13, marginTop: 4 },
  sectionLabel: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  sectionLabelText: { fontSize: 13, fontWeight: "500" },
  card: { marginHorizontal: 16, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 16, fontWeight: "500", marginBottom: 2 },
  rowDesc: { fontSize: 13, lineHeight: 18 },
  notice: { marginHorizontal: 16, marginTop: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, flexDirection: "row", gap: 10 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 19 },
  result: { marginHorizontal: 16, marginTop: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  resultTitle: { fontSize: 15, fontWeight: "600", marginBottom: 6 },
  resultText: { fontSize: 13, lineHeight: 19 },
});
