import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("网络请求与第三方依赖生命周期护栏", () => {
  it("让通用 API 请求具备默认超时、外部取消传播且不记录成功请求的敏感调试日志", () => {
    const api = source("lib/_core/api.ts");

    expect(api).toContain("const DEFAULT_API_TIMEOUT_MS = 15_000");
    expect(api).toContain("fetchWithRequestTimeout");
    expect(api).toContain('options.signal?.addEventListener("abort"');
    expect(api).toContain('options.signal?.removeEventListener("abort"');
    expect(api).not.toContain('console.log("[API] Full URL:"');
    expect(api).not.toContain('console.log("[API] Authorization header added")');
  });

  it("让 AI 请求共享相同的在途任务、支持取消并在断路器打开后快速失败", () => {
    const smartRouter = source("lib/api/smart-router.ts");

    expect(smartRouter).toContain("const inFlightCalls = new Map");
    expect(smartRouter).toContain("const key = options.signal ? null");
    expect(smartRouter).toContain("function waitForRetry(signal?: AbortSignal)");
    expect(smartRouter).toContain('if (isCircuitOpen("cf")) throw new OfflineError');
    expect(smartRouter).toContain('options.signal?.removeEventListener("abort"');
  });

  it("让大文件 PDF 解析拥有超时和调用方取消传播", () => {
    const pdfImport = source("lib/spirits/pdf-import.ts");

    expect(pdfImport).toContain("timeoutMs?: number; signal?: AbortSignal");
    expect(pdfImport).toContain("options.timeoutMs ?? 45_000");
    expect(pdfImport).toContain("signal: controller.signal");
    expect(pdfImport).toContain('options.signal?.removeEventListener("abort"');
  });

  it("不再把未使用的视频与 WebView 原生依赖带入发布配置", () => {
    const packageJson = source("package.json");
    const appConfig = source("app.config.ts");

    expect(packageJson).not.toContain('"expo-video"');
    expect(packageJson).not.toContain('"react-native-webview"');
    expect(appConfig).not.toContain('"expo-video"');
  });
});
