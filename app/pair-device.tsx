/**
 * 配对码输入页面（方案 C+）
 * 新设备输入 6 位配对码加入现有设备组
 */
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { pairWithCode } from "@/lib/cf-sync/client";
import { QRScanner } from "@/components/qr-scanner";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useSync } from "@/lib/cf-sync/provider";

export default function PairDeviceScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const { restartSync, deviceInfo, recoverJoinToAnotherGroup, switchToAnotherGroup, isGroupSwitching } = useSync();
  const params = useLocalSearchParams<{ switch?: string; handoffDeviceId?: string }>();
  const isSwitchMode = params.switch === "1" && !!deviceInfo;
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [showScanner, setShowScanner] = useState(false);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const describeJoinError = (raw: string) => {
    const codeValue = raw.replace(/^Error:\s*/, "");
    const messages: Record<string, { zh: string; en: string }> = {
      PAIR_CODE_UNAVAILABLE: { zh: "目标配对码已过期、已使用或不存在。请在目标主设备上重新生成配对码。", en: "The target code is expired, used, or unavailable. Generate a new code on the target owner device." },
      TARGET_GROUP_SAME_AS_SOURCE: { zh: "目标同步组与当前同步组相同，无需切换。", en: "The target is already your current sync group." },
      OWNER_HANDOFF_REQUIRED: { zh: "当前设备是原同步组主设备，请先选择其他活跃设备完成主设备交接。", en: "This device owns the current group. Select another active device to receive owner role first." },
      OWNER_HANDOFF_INVALID: { zh: "所选的新主设备已失效，请刷新设备列表后重试。", en: "The selected handoff device is unavailable. Refresh the device list and retry." },
      DEVICE_AUTH_UNAUTHORIZED: { zh: "设备身份已失效，请返回设备管理并使用安全恢复加入。", en: "This device membership is unavailable. Return to Device Manager and use recovery join." },
    };
    return messages[codeValue]?.[lang === "zh" ? "zh" : "en"] ?? codeValue;
  };

  const completeSwitchSuccess = () => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    Alert.alert(
      lang === "zh" ? "已安全切换同步组" : "Sync Group Switched",
      lang === "zh"
        ? "目标组数据已完整下载并替换本机同步数据。当前组数据不会上传到目标组。"
        : "Target data was download-replaced. Current-group data was not uploaded.",
      [{ text: "OK", onPress: () => router.back() }],
    );
  };

  const confirmRecoveryJoin = async (code: string) => {
    try {
      setLoading(true);
      await recoverJoinToAnotherGroup(code);
      completeSwitchSuccess();
    } catch (error) {
      Alert.alert(
        lang === "zh" ? "恢复加入失败" : "Recovery Join Failed",
        lang === "zh"
          ? `未能安全加入目标组：${String(error)}。本机保持写入保护，请检查网络或使用新的目标配对码后重试。`
          : `Could not safely join the target group: ${String(error)}. Local writes remain protected; check the network or use a new target code and retry.`,
      );
    } finally {
      setLoading(false);
    }
  };

  const joinWithCode = async (rawCode: string) => {
    const trimmed = rawCode.trim();
    if (trimmed.length !== 6 || !/^\d{6}$/.test(trimmed)) {
      Alert.alert(
        lang === "zh" ? "格式错误" : "Invalid Code",
        lang === "zh" ? "请输入 6 位数字配对码" : "Please enter a 6-digit numeric code",
      );
      return;
    }
    Keyboard.dismiss();
    try {
      setLoading(true);
      tap();
      if (isSwitchMode) {
        await switchToAnotherGroup(trimmed, params.handoffDeviceId || undefined);
      } else {
        await pairWithCode(trimmed);
        // 新设备配对后重启当前成员资格同步；启动路径不会自动创建主设备。
        void restartSync();
      }
      if (isSwitchMode) {
        completeSwitchSuccess();
      } else {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          lang === "zh" ? "配对成功" : "Paired Successfully",
          lang === "zh" ? "设备已加入同步组，数据将自动同步" : "Device joined the sync group. Data will sync automatically.",
          [{ text: "OK", onPress: () => router.back() }],
        );
      }
    } catch (e: unknown) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      const codeValue = String(e).replace(/^Error:\s*/, "");
      // 只有Worker明确说明来源成员资格失效，才允许用户选择恢复加入；网络、超时和其他401绝不自动降级。
      if (isSwitchMode && codeValue.includes("SOURCE_MEMBERSHIP_UNAVAILABLE")) {
        Alert.alert(
          lang === "zh" ? "原同步组凭据已失效" : "Original Group Membership Is Unavailable",
          lang === "zh"
            ? "系统无法验证原同步组身份。仍可安全加入目标组：本机将先保留加密备份，再只下载目标组数据；旧组数据不会上传。"
            : "The original group membership cannot be verified. You can still safely join the target group: an encrypted backup is retained and only target-group data is downloaded; old data is never uploaded.",
          [
            { text: lang === "zh" ? "取消" : "Cancel", style: "cancel" },
            { text: lang === "zh" ? "确认恢复加入" : "Confirm Recovery Join", onPress: () => void confirmRecoveryJoin(trimmed) },
          ],
        );
        return;
      }
      Alert.alert(
        lang === "zh" ? (isSwitchMode ? "切换失败" : "配对失败") : (isSwitchMode ? "Switch Failed" : "Pairing Failed"),
        describeJoinError(codeValue),
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePair = async () => joinWithCode(code);

  /** 扫码成功回调：提取 6 位数字并自动加入或安全切组 */
  const handleScanned = async (data: string) => {
    setShowScanner(false);
    const match = data.match(/\d{6}/);
    if (!match) {
      Alert.alert(
        lang === "zh" ? "无效二维码" : "Invalid QR Code",
        lang === "zh" ? "未识别到有效的 6 位配对码" : "No valid 6-digit pair code found",
      );
      return;
    }
    const scannedCode = match[0];
    setCode(scannedCode);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await joinWithCode(scannedCode);
  };

  return (
    <ScreenContainer className="px-6">
      {/* QR 扫码器 Modal */}
      {showScanner && (
        <QRScanner
          lang={lang}
          onScanned={handleScanned}
          onClose={() => setShowScanner(false)}
          onFallback={() => {
            setShowScanner(false);
            setTimeout(() => inputRef.current?.focus(), 100);
          }}
        />
      )}

      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => { tap(); router.back(); }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {lang === "zh" ? (isSwitchMode ? "加入其他同步组" : "加入设备组") : (isSwitchMode ? "Join Another Group" : "Join Device Group")}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Description */}
      <View style={styles.descBox}>
        <Text style={[styles.descTitle, { color: colors.foreground }]}>
          {lang === "zh" ? (isSwitchMode ? "输入目标组配对码" : "输入配对码") : (isSwitchMode ? "Enter Target Group Code" : "Enter Pair Code")}
        </Text>
        <Text style={[styles.descText, { color: colors.muted }]}>
          {lang === "zh"
            ? (isSwitchMode ? "本机将先创建加密快照，再仅下载并替换为目标组数据。当前组数据不会上传到目标组。" : "在主设备的「设备管理」页面生成配对码，然后在此输入 6 位数字")
            : (isSwitchMode ? "This device creates an encrypted snapshot, then download-replaces with target data. Current data is never uploaded to the target group." : "Generate a pair code on the owner device in Device Manager, then enter the 6-digit code here")}
        </Text>
      </View>

      {/* Code input */}
      <Pressable
        onPress={() => inputRef.current?.focus()}
        style={[styles.codeInputWrap, { borderColor: code.length > 0 ? colors.primary : colors.border }]}
      >
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={colors.border}
          style={[styles.codeInput, { color: colors.foreground }]}
          returnKeyType="done"
          onSubmitEditing={handlePair}
          autoFocus
        />
      </Pressable>

      {/* 扫码按钮（仅移动端） */}
      {Platform.OS !== "web" && (
        <Pressable
          onPress={() => { tap(); setShowScanner(true); }}
          style={({ pressed }) => [
            styles.scanBtn,
            { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[styles.scanBtnText, { color: colors.primary }]}>
            {lang === "zh" ? "扫描二维码" : "Scan QR Code"}
          </Text>
          <Text style={[styles.scanBtnHint, { color: colors.muted }]}>
            {lang === "zh" ? "扫描邀请方设备上的二维码" : "Scan the QR code on the inviting device"}
          </Text>
        </Pressable>
      )}

      {/* Submit button */}
      <Pressable
        onPress={handlePair}
        disabled={loading || isGroupSwitching || code.length !== 6}
        style={({ pressed }) => [
          styles.submitBtn,
          {
                            backgroundColor: code.length === 6 && !isGroupSwitching ? colors.primary : colors.border,

            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
                  {loading || isGroupSwitching ? (

          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>
            {lang === "zh" ? (isSwitchMode ? "安全加入目标组" : "加入设备组") : (isSwitchMode ? "Safely Join Target Group" : "Join Group")}
          </Text>
        )}
      </Pressable>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
  },
  backBtn: { paddingVertical: 8 },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 22 },
  descBox: { marginTop: 32, marginBottom: 32 },
  descTitle: { fontSize: 24, fontWeight: "700", lineHeight: 30, marginBottom: 12 },
  descText: { fontSize: 15, lineHeight: 22 },
  codeInputWrap: {
    borderWidth: 2,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    marginBottom: 24,
  },
  codeInput: {
    fontSize: 40,
    fontWeight: "700",
    letterSpacing: 12,
    lineHeight: 48,
    textAlign: "center",
    width: "100%",
  },
  scanBtn: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: "center",
    marginBottom: 16,
  },
  scanBtnText: { fontSize: 16, fontWeight: "600", lineHeight: 22 },
  scanBtnHint: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  submitBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    lineHeight: 22,
  },
});
