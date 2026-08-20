import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const scheduleScript = readFileSync("scripts/h5-schedule-correction-e2e.mjs", "utf8");
const storeSegmentedScript = readFileSync("scripts/h5-store-segmented-nav-e2e.mjs", "utf8");

describe("H5 静态导出与真实浏览器回归稳定性", () => {
  it("所有 H5 回归都使用 CI 静态导出，避免 NativeWind 并发渲染写入本地 CSS 缓存", () => {
    const h5Scripts = Object.entries(packageJson.scripts).filter(([name]) => name.startsWith("test:h5:"));
    expect(h5Scripts.length).toBeGreaterThan(0);
    for (const [, command] of h5Scripts) {
      expect(command).toContain("CI=true npx expo export --platform web --output-dir dist-web");
    }
  });

  it("排班 H5 回归使用可配置的独立 CDP 端口，并为 HTTP、WebSocket 与服务器清理提供超时保护", () => {
    expect(scheduleScript).toContain('const cdpPort = Number(process.env.H5_CDP_PORT ?? 9222);');
    expect(scheduleScript).toContain("async function cdpFetch(path, options = {})");
    expect(scheduleScript).toContain("CDP_HTTP_FAILED");
    expect(scheduleScript).toContain("CDP_SOCKET_OPEN_TIMEOUT");
    expect(scheduleScript).toContain("server.closeAllConnections?.();");
    expect(scheduleScript).toContain("await new Promise((resolve) => server.close(resolve));");
    expect(scheduleScript).toContain("cdpFetch(`/json/close/${testTarget.id}`)");
  });

  it("员工薪资工作台在六种手机宽度下真实点击三枚胶囊，并验证选中态与分页同步", () => {
    expect(scheduleScript).toContain("员工薪资工作台三页胶囊切换");
    expect(scheduleScript).toContain('"labor-workspace-tab-${spec.key}"');
    expect(scheduleScript).toContain("tabFound: Boolean(tab)");
    expect(scheduleScript).toContain('Math.abs(state.pagerScrollLeft - state.expectedOffset) > 1');
  });

  it("库存与店铺胶囊导航使用可配置的独立 CDP 端口并完整释放测试资源", () => {
    expect(storeSegmentedScript).toContain('const cdpPort = Number(process.env.H5_CDP_PORT ?? 9222);');
    expect(storeSegmentedScript).toContain("async function cdpFetch(path, options = {})");
    expect(storeSegmentedScript).toContain("CDP_SOCKET_OPEN_TIMEOUT");
    expect(storeSegmentedScript).toContain("server.closeAllConnections?.();");
    expect(storeSegmentedScript).toContain("await new Promise((resolve) => server.close(resolve));");
    expect(storeSegmentedScript).toContain("cdpFetch(`/json/close/${testTarget.id}`)");
  });

  it("共享胶囊选择器以 28pt 真实高度验证对齐，不再沿用旧的 40pt 页面容器高度", () => {
    expect(scheduleScript).toContain("summaryTab.summaryHeight < 28");
    expect(scheduleScript).toContain("state.activeHeight < 28");
    expect(scheduleScript).not.toContain("summaryTab.summaryHeight < 40");
    expect(scheduleScript).not.toContain("state.activeHeight < 40");
  });
});
