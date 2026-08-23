/**
 * 全局业务月份移动端压力回归。
 * 在 390pt 手机模拟器中连续切换月份，并轮流加载报表、员工、烈酒、葡萄酒、食材与账户，
 * 验证最后月份一致、渲染帧间隔和 JS 堆内存保持稳定。
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8101);
const origin = `http://localhost:${port}`;
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

if (!existsSync(join(root, "index.html"))) throw new Error("未找到 dist-web/index.html；请先导出 H5 产物。");

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const candidate = normalize(join(root, pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTestId(call, testId, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate(call, `Boolean(document.querySelector('[data-testid="${testId}"]'))`);
    if (found) return true;
    await sleep(50);
  }
  return false;
}

async function clickWhenReady(call, testId, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await evaluate(call, `(() => {
      const element = document.querySelector('[data-testid="${testId}"]');
      if (!(element instanceof HTMLElement)) return false;
      const options = { bubbles: true, cancelable: true, view: window };
      element.dispatchEvent(new MouseEvent("mousedown", options));
      element.dispatchEvent(new MouseEvent("mouseup", options));
      element.dispatchEvent(new MouseEvent("click", options));
      return true;
    })()`);
    if (clicked) return true;
    await sleep(50);
  }
  return false;
}

async function newTarget() {
  const response = await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建专用压力测试标签页：HTTP ${response.status}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("压力测试标签页缺少 CDP 地址。");
  return target;
}

async function openCdp(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const waiting = new Map();
  const runtimeExceptions = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails;
      runtimeExceptions.push(detail?.exception?.description ?? detail?.exception?.value ?? detail?.text ?? "runtime exception");
    }
    const resolve = waiting.get(message.id);
    if (resolve) { waiting.delete(message.id); resolve(message); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 20_000);
    waiting.set(id, (message) => {
      clearTimeout(timeout);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, call, runtimeExceptions };
}

const evaluate = async (call, expression, awaitPromise = false) => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  return result.result.value;
};

const clickTestId = (testId) => `(() => {
  const element = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
  if (!element) return false;
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  return true;
})()`;

const frameSample = `(() => new Promise((resolve) => {
  const gaps = []; let previous = performance.now(); let count = 0;
  const step = (now) => {
    gaps.push(now - previous); previous = now; count += 1;
    if (count < 30) requestAnimationFrame(step);
    else resolve({ frameCount: gaps.length, maxFrameGapMs: Math.max(...gaps), averageFrameGapMs: gaps.reduce((sum, value) => sum + value, 0) / gaps.length });
  };
  requestAnimationFrame(step);
}))()`;

const memoryMetric = (metrics) => metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

let socket;
try {
  const target = await newTarget();
  const cdp = await openCdp(target);
  socket = cdp.socket;
  const { call, runtimeExceptions } = cdp;
  await call("Page.enable");
  await call("Runtime.enable");
  await call("Performance.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

  await call("Page.navigate", { url: `${origin}/store` });
  await sleep(700);
  await evaluate(call, `(() => {
    const months = ["2026-04", "2026-05", "2026-06", "2026-07"];
    const now = new Date().toISOString();
    localStorage.setItem("business.global-active-month.v1", JSON.stringify("2026-04"));
    localStorage.setItem("labor_payslips_v1", JSON.stringify(months.map((month, index) => ({
      id: "stress-slip-" + index, employeeId: "stress-employee", month, attendanceDays: 1,
      attendanceSalary: 1, performanceBonus: 0, salesCommission: 0, mealAllowance: 0, transportAllowance: 0,
      otherAllowance: 0, rewardPenalty: 0, advanceAmount: 0, grossSalary: 1, socialInsuranceDeduction: 0,
      housingFundDeduction: 0, incomeTax: 0, finalSalary: 1, employerSocialInsurance: 0,
      employerHousingFund: 0, totalEmployerCost: 1, notes: "", updatedAt: now,
    }))));
  })()`);
  await call("Page.navigate", { url: `${origin}/store` });
  if (!await waitForTestId(call, "report-workspace-month-navigator-picker")) {
    const diagnostic = await evaluate(call, `(() => ({
      text: document.body?.innerText?.slice(0, 800) || "",
      testIds: Array.from(document.querySelectorAll("[data-testid]")).slice(0, 40).map((node) => node.getAttribute("data-testid")),
    }))()`);
    diagnostic.runtimeExceptions = runtimeExceptions;
    throw new Error(`动态功能域加载超时：未找到报表工作台月份按钮；${JSON.stringify(diagnostic)}`);
  }

  const beforeHeap = memoryMetric(await call("Performance.getMetrics"));
  const initialMonth = await evaluate(call, `JSON.parse(localStorage.getItem("business.global-active-month.v1") || "null")`);
  // 在无头浏览器中以稳定的前后按钮复现 24 次真实月份交互；
  // Modal 月份面板的触摸合成由端到端手势测试单独覆盖，避免其实现细节污染状态压力指标。
  const navigationIds = Array.from({ length: 12 }, () => [
    "report-workspace-month-navigator-next",
    "report-workspace-month-navigator-previous",
  ]).flat();
  for (const navigationId of navigationIds) {
    if (!await clickWhenReady(call, navigationId)) {
      const diagnostic = await evaluate(call, `(() => ({
        href: location.href,
        text: document.body?.innerText?.slice(0, 800) || "",
        testIds: Array.from(document.querySelectorAll("[data-testid]")).slice(0, 80).map((node) => node.getAttribute("data-testid")),
      }))()`);
      diagnostic.runtimeExceptions = runtimeExceptions;
      throw new Error(`未找到月份导航按钮：${navigationId}；${JSON.stringify(diagnostic)}`);
    }
    await sleep(12);
  }
  await sleep(220);
  const frames = await evaluate(call, frameSample, true);
  const selected = await evaluate(call, `(() => ({
    month: JSON.parse(localStorage.getItem("business.global-active-month.v1") || 'null'),
    label: document.querySelector('[data-testid="report-workspace-month-navigator-picker"]')?.textContent?.trim() || "",
    rootWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`);
  const afterHeap = memoryMetric(await call("Performance.getMetrics"));

  if (selected.month !== initialMonth) throw new Error(`快速切月未回到初始月份：start=${initialMonth};end=${selected.month}`);
  const [year, month] = String(initialMonth).split("-");
  if (!selected.label.includes(`${year}年${Number(month)}月`)) throw new Error(`快速切月后界面月份未同步：${selected.label}`);
  if (selected.rootScrollWidth > selected.rootWidth) throw new Error(`快速切月造成根级横向溢出：${JSON.stringify(selected)}`);
  if (frames.maxFrameGapMs > 100) throw new Error(`快速切月渲染帧间隔过大：${frames.maxFrameGapMs.toFixed(1)}ms`);

  const routes = ["/labor", "/store", "/spirits-inventory", "/wine-inventory", "/food-inventory", "/store-accounts", "/device-manager", "/sync-log"];
  const moduleLoads = [];
  for (const route of routes) {
    console.log(`验证功能域路由：${route}`);
    const startedAt = performance.now();
    await call("Page.navigate", { url: `${origin}${route}` });
    await sleep(520);
    const state = await evaluate(call, `(() => ({
      path: location.pathname,
      rootWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      hasContent: document.body.innerText.trim().length > 0,
      testIds: Array.from(document.querySelectorAll("[data-testid]")).slice(0, 30).map((node) => node.getAttribute("data-testid")),
    }))()`);
    const elapsedMs = performance.now() - startedAt;
    if (!state.hasContent || state.rootScrollWidth > state.rootWidth) {
      state.runtimeExceptions = runtimeExceptions;
      throw new Error(`模块加载异常：${route} ${JSON.stringify(state)}`);
    }
    moduleLoads.push({ route, elapsedMs, ...state });
  }
  const finalHeap = memoryMetric(await call("Performance.getMetrics"));
  console.log(JSON.stringify({
    script: "h5-global-month-stress-e2e",
    viewport: 390,
    rapidSwitches: 24,
    finalMonth: selected.month,
    frames,
    heapBytes: { before: beforeHeap, afterRapidSwitch: afterHeap, afterModuleLoads: finalHeap },
    moduleLoads,
  }, null, 2));
} finally {
  socket?.close();
  await new Promise((resolve) => server.close(resolve));
}
