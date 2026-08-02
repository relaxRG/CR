/**
 * QRScanner — 解耦 QR 码扫描组件
 *
 * 对外接口固定：onScanned(code) / onClose()
 * 内部当前使用 expo-camera CameraView + onBarcodeScanned
 * 未来替换摄像头层（如 react-native-vision-camera）只需改此文件
 *
 * Web 平台：expo-camera 不支持 Web，直接返回 null（pair-device.tsx 已用 Platform.OS !== "web" 守卫）
 */
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";

export interface QRScannerProps {
  onScanned: (code: string) => void;
  onClose: () => void;
  lang?: "zh" | "en";
}

// ─── 仅在原生平台加载 expo-camera ────────────────────────────────────────────
// Web 端 expo-camera 会调用 createPermissionHook（仅 native 可用），必须延迟加载
let CameraView: React.ComponentType<{
  style?: object;
  facing?: "back" | "front";
  barcodeScannerSettings?: { barcodeTypes: string[] };
  onBarcodeScanned?: ((result: { data: string }) => void) | undefined;
}> | null = null;

let useCameraPermissions: (() => [
  { granted: boolean } | null,
  () => Promise<{ granted: boolean }>,
]) | null = null;

if (Platform.OS !== "web") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cam = require("expo-camera") as {
    CameraView: NonNullable<typeof CameraView>;
    useCameraPermissions: NonNullable<typeof useCameraPermissions>;
  };
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
}

// ─── 原生扫码器内部组件 ────────────────────────────────────────────────────
function NativeScanner({ onScanned, onClose, lang }: QRScannerProps & { lang: "zh" | "en" }) {
  const [permission, requestPermission] = useCameraPermissions!();
  const [scanned, setScanned] = useState(false);
  const scannedRef = useRef(false);

  useEffect(() => {
    if (!permission?.granted) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const handleBarcode = ({ data }: { data: string }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScanned(true);
    onScanned(data);
  };

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <Modal animationType="slide" transparent={false} onRequestClose={onClose}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>
            {lang === "zh"
              ? "需要摄像头权限才能扫描二维码"
              : "Camera permission is required to scan QR codes"}
          </Text>
          <Pressable
            onPress={() => void requestPermission()}
            style={({ pressed }) => [styles.permissionBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.permissionBtnText}>
              {lang === "zh" ? "授权摄像头" : "Grant Camera Access"}
            </Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.cancelBtnText}>
              {lang === "zh" ? "取消" : "Cancel"}
            </Text>
          </Pressable>
        </View>
      </Modal>
    );
  }

  const Cam = CameraView!;
  return (
    <Modal animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <Cam
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanned ? undefined : handleBarcode}
        />
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.closeBtnText}>
                {lang === "zh" ? "取消" : "Cancel"}
              </Text>
            </Pressable>
            <Text style={styles.topTitle}>
              {lang === "zh" ? "扫描配对码" : "Scan Pair Code"}
            </Text>
            <View style={{ width: 60 }} />
          </View>
          <View style={styles.viewfinderWrap}>
            <View style={styles.viewfinder}>
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          </View>
          <View style={styles.bottomBar}>
            <Text style={styles.hint}>
              {lang === "zh"
                ? "将邀请方设备上的二维码对准取景框"
                : "Point the camera at the QR code on the inviting device"}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── 公开组件：Web 平台返回 null ──────────────────────────────────────────
export function QRScanner({ onScanned, onClose, lang = "zh" }: QRScannerProps) {
  if (Platform.OS === "web") return null;
  return <NativeScanner onScanned={onScanned} onClose={onClose} lang={lang} />;
}

const CORNER_SIZE = 24;
const CORNER_THICKNESS = 3;
const CORNER_COLOR = "#FFFFFF";
const VIEWFINDER_SIZE = 240;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  topTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  closeBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  closeBtnText: { color: "#FFFFFF", fontSize: 16 },
  viewfinderWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  viewfinder: { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE, position: "relative" },
  corner: { position: "absolute", width: CORNER_SIZE, height: CORNER_SIZE, borderColor: CORNER_COLOR },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICKNESS, borderLeftWidth: CORNER_THICKNESS },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICKNESS, borderRightWidth: CORNER_THICKNESS },
  bottomBar: {
    paddingHorizontal: 32,
    paddingVertical: 40,
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  hint: { color: "rgba(255,255,255,0.85)", fontSize: 14, textAlign: "center", lineHeight: 20 },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
    paddingHorizontal: 32,
  },
  permissionText: { color: "#FFFFFF", fontSize: 16, textAlign: "center", lineHeight: 24, marginBottom: 32 },
  permissionBtn: {
    backgroundColor: "#0A84FF",
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginBottom: 16,
  },
  permissionBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  cancelBtn: { paddingVertical: 12 },
  cancelBtnText: { color: "rgba(255,255,255,0.7)", fontSize: 15 },
});
