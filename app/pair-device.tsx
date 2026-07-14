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
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useI18n } from "@/lib/i18n";
import { pairWithCode } from "@/lib/cf-sync/client";

export default function PairDeviceScreen() {
  const colors = useColors();
  const router = useRouter();
  const { lang } = useI18n();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const tap = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePair = async () => {
    const trimmed = code.trim();
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
      await pairWithCode(trimmed);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert(
        lang === "zh" ? "配对成功 🎉" : "Paired Successfully 🎉",
        lang === "zh"
          ? "设备已加入同步组，数据将自动同步"
          : "Device joined the sync group. Data will sync automatically.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (e: unknown) {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      Alert.alert(
        lang === "zh" ? "配对失败" : "Pairing Failed",
        String(e),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer className="px-6">
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => { tap(); router.back(); }}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={{ color: colors.primary, fontSize: 16 }}>
            {lang === "zh" ? "取消" : "Cancel"}
          </Text>
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {lang === "zh" ? "加入设备组" : "Join Device Group"}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Description */}
      <View style={styles.descBox}>
        <Text style={[styles.descTitle, { color: colors.foreground }]}>
          {lang === "zh" ? "输入配对码" : "Enter Pair Code"}
        </Text>
        <Text style={[styles.descText, { color: colors.muted }]}>
          {lang === "zh"
            ? "在主设备的「设备管理」页面生成配对码，然后在此输入 6 位数字"
            : "Generate a pair code on the owner device in Device Manager, then enter the 6-digit code here"}
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

      {/* Submit button */}
      <Pressable
        onPress={handlePair}
        disabled={loading || code.length !== 6}
        style={({ pressed }) => [
          styles.submitBtn,
          {
            backgroundColor: code.length === 6 ? colors.primary : colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitBtnText}>
            {lang === "zh" ? "加入设备组" : "Join Group"}
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

