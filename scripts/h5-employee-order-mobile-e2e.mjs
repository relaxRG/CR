#!/usr/bin/env node
/**
 * 移动端员工排序与考勤概况 E2E 回归。
 * 以逆序存储的 120 名员工夹具验证：页面按 sortOrder 重排、长列表滚动可响应、无根级横向溢出。
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8097);
const route = `http://localhost:${port}/labor-attendance`;
const viewports = [320, 375, 430];
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

if (!existsSync(join(root, "index.html"))) {
  throw new Error("未找到 dist-web/index.html。请先导出 H5 产物。");
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const candidate = normalize(join(root, pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getTarget() {
  const response = await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建专用 H5 测试标签页：HTTP ${response.status}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("专用 H5 测试标签页缺少 CDP 连接地址。");
  return target;
}

async function openCdp(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP_TIMEOUT:${method}`));
    }, 20_000);
    pending.set(requestId, (message) => {
      clearTimeout(timeout);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, call };
}

const seedExpression = `(() => {
  const now = new Date().toISOString();
  const employees = Array.from({ length: 120 }, (_, index) => {
    const ordinal = index + 1;
    const label = String(ordinal).padStart(3, '0');
    return {
      id: 'employee-' + label, code: 'E' + label, realName: '排序员工 ' + label,
      phone: '', dept: 'front', type: 'fulltime', baseSalary: 5600,
      stdHoursPerDay: 8, restDaysPerMonth: 8, hourlyRate: 30, overtimeHourlyRate: 50,
      notes: '', active: true, createdAt: now, sortOrder: ordinal,
    };
  }).reverse();
  localStorage.setItem('labor_employees_v1', JSON.stringify(employees));
  localStorage.setItem('labor_dept_order_v1', JSON.stringify(['front', 'kitchen', 'other', 'parttime']));
  localStorage.setItem('labor_attendance_v1', '[]');
  localStorage.setItem('labor_payslips_v1', '[]');
  return employees.length;
})()`;

const measureExpression = `(() => new Promise((resolve) => {
  const names = [...document.querySelectorAll('*')]
    .filter((element) => element.children.length === 0 && /^排序员工 \\d{3}$/.test(element.textContent?.trim() ?? ''))
    .map((element) => element.textContent.trim());
  const rootWidth = document.documentElement.clientWidth;
  const rootScrollWidth = document.documentElement.scrollWidth;
  const bodyScrollWidth = document.body.scrollWidth;
  const scroller = [...document.querySelectorAll('*')]
    .map((element) => ({ element, style: getComputedStyle(element) }))
    .find(({ element, style }) => (style.overflowY === 'auto' || style.overflowY === 'scroll') && element.scrollHeight > element.clientHeight + 24)?.element;
  const target = scroller ?? document.scrollingElement ?? document.documentElement;
  const start = performance.now();
  const frameGaps = [];
  let previous = start;
  let count = 0;
  function step(now) {
    frameGaps.push(now - previous);
    previous = now;
    target.scrollTop = Math.min(target.scrollHeight, target.scrollTop + 320);
    count += 1;
    if (count < 24) requestAnimationFrame(step);
    else {
      resolve({
        names, rootWidth, rootScrollWidth, bodyScrollWidth,
        scrollable: Boolean(scroller), scrollHeight: target.scrollHeight, scrollTop: target.scrollTop,
        frameCount: frameGaps.length, maxFrameGapMs: Math.max(...frameGaps), elapsedMs: performance.now() - start,
      });
    }
  }
  requestAnimationFrame(step);
}))()`;

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

let socket;
try {
  const target = await getTarget();
  const cdp = await openCdp(target);
  socket = cdp.socket;
  const { call } = cdp;
  await call("Page.enable");
  const report = [];

  for (const width of viewports) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: route });
    await sleep(450);
    const seeded = await call("Runtime.evaluate", { expression: seedExpression, returnByValue: true });
    if (seeded.result.value !== 120) throw new Error("未能写入完整员工长列表夹具");
    await call("Page.navigate", { url: route });
    await sleep(1_400);

    const measured = await call("Runtime.evaluate", { expression: measureExpression, awaitPromise: true, returnByValue: true });
    const state = measured.result.value;
    const expectedPrefix = ["排序员工 001", "排序员工 002", "排序员工 003", "排序员工 004", "排序员工 005"];
    if (state.names.length !== 120) throw new Error(`${width}pt 考勤概况未完整渲染 120 名员工：${state.names.length}`);
    if (JSON.stringify(state.names.slice(0, 5)) !== JSON.stringify(expectedPrefix)) {
      throw new Error(`${width}pt 员工排序未按档案 sortOrder 渲染：${JSON.stringify(state.names.slice(0, 5))}`);
    }
    if (state.rootScrollWidth > state.rootWidth || state.bodyScrollWidth > state.rootWidth) {
      throw new Error(`${width}pt 员工长列表出现根级横向溢出：${JSON.stringify(state)}`);
    }
    if (!state.scrollable || state.scrollTop <= 0) {
      throw new Error(`${width}pt 员工长列表未找到可滚动容器或滚动未生效：${JSON.stringify(state)}`);
    }
    // 24 个动画帧下 120 张卡片滚动的最大帧间隔低于 100ms，避免可感知的主线程卡顿。
    if (state.maxFrameGapMs > 100) {
      throw new Error(`${width}pt 长列表滚动帧间隔过大：${state.maxFrameGapMs.toFixed(1)}ms`);
    }
    report.push({
      width,
      renderedEmployees: state.names.length,
      rootWidth: state.rootWidth,
      rootScrollWidth: state.rootScrollWidth,
      bodyScrollWidth: state.bodyScrollWidth,
      scrollable: state.scrollable,
      scrollHeight: state.scrollHeight,
      scrollTop: state.scrollTop,
      frameCount: state.frameCount,
      maxFrameGapMs: state.maxFrameGapMs,
      elapsedMs: state.elapsedMs,
      firstFive: state.names.slice(0, 5),
    });
  }

  console.log(JSON.stringify({ script: 'h5-employee-order-mobile-e2e', report }, null, 2));
} finally {
  socket?.close();
  await new Promise((resolve) => server.close(resolve));
}
