export type SyncDevicePlatform = "ios" | "android" | "web" | "macos" | "unknown";

/**
 * 平台分类的纯函数。桌面硬件类型优先于iOS运行时，防止Apple Silicon Mac被误判为iPad。
 */
export function resolveSyncDevicePlatform(input: {
  nativePlatform: string;
  deviceType?: number | null;
  desktopType?: number;
  osName?: string | null;
  modelName?: string | null;
}): SyncDevicePlatform {
  const modelName = input.modelName?.toLowerCase() ?? "";
  const osName = input.osName?.toLowerCase() ?? "";
  if (input.deviceType === input.desktopType || osName.includes("mac") || /mac(book|mini|studio|pro)/.test(modelName)) {
    return "macos";
  }
  if (input.nativePlatform === "ios") return "ios";
  if (input.nativePlatform === "android") return "android";
  if (input.nativePlatform === "web") return "web";
  return "unknown";
}
