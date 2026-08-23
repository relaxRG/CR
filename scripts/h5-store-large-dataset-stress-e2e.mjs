import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8103);
const origin = `http://localhost:${port}`;
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};
const testKeys = [
  "labor_employees_v1", "labor_shifts_v1", "labor_comp_off_entries_v1", "labor_unexplained_rest_alerts_v1",
  "spirits.items.v3", "spirits.purchases.v3", "spirits.ledger.v3", "spirits.refPrices.v1", "spirits.suppliers.v1",
  "spirits.groups.v1", "spirits.matchMemory.v1", "spirits.selfBuyConfig.v1", "spirits.customCategories.v1", "spirits.groupMatchMemory.v1",
];

if (!existsSync(join(root, "index.html"))) throw new Error("未找到 dist-web/index.html；请先执行 Expo Web 导出。");

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const candidate = normalize(join(root, pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function newTarget() {
  const response = await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建浏览器压力标签页：HTTP ${response.status}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("压力标签页缺少 CDP 地址。");
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
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const resolve = waiting.get(message.id);
    if (resolve) { waiting.delete(message.id); resolve(message); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { waiting.delete(id); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 30_000);
    waiting.set(id, (message) => {
      clearTimeout(timeout);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, call };
}

const evaluate = async (call, expression, awaitPromise = false) => {
  const result = await call("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
  return result.result.value;
};
const frameSample = `(() => new Promise((resolve) => {
  const gaps = []; let previous = performance.now(); let count = 0;
  const step = (now) => { gaps.push(now - previous); previous = now; count += 1; count < 60 ? requestAnimationFrame(step) : resolve({ frameCount: gaps.length, maxFrameGapMs: Math.max(...gaps), averageFrameGapMs: gaps.reduce((sum, value) => sum + value, 0) / gaps.length }); };
  requestAnimationFrame(step);
}))()`;
const memoryMetric = (metrics) => metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
const snapshot = async (call, route, loadStartedAt) => {
  const frames = await evaluate(call, frameSample, true);
  const state = await evaluate(call, `(() => ({
    path: location.pathname,
    contentLength: document.body.innerText.length,
    domNodes: document.getElementsByTagName('*').length,
    rootWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`);
  return { route, loadMs: performance.now() - loadStartedAt, frames, heapBytes: memoryMetric(await call("Performance.getMetrics")), ...state };
};
const click = (testId) => `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]'); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true; })()`;

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
let socket;
let target;
try {
  target = await newTarget();
  const cdp = await openCdp(target);
  socket = cdp.socket;
  const { call } = cdp;
  await call("Page.enable");
  await call("Performance.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

  await call("Page.navigate", { url: `${origin}/` });
  await sleep(450);
  await evaluate(call, `(() => {
    const month = "2026-08"; const now = new Date().toISOString();
    const employees = Array.from({ length: 500 }, (_, index) => ({
      id: "stress-employee-" + index, code: "S" + String(index + 1).padStart(4, "0"), realName: "压力员工" + (index + 1), phone: "1380000" + String(index).padStart(4, "0"),
      dept: "front", customDeptId: "dept_front", type: "fulltime", baseSalary: 5000, stdHoursPerDay: 8, restDaysPerMonth: 4,
      hourlyRate: 30, overtimeHourlyRate: 45, notes: "browser stress fixture", active: true, createdAt: now,
    }));
    const shifts = Array.from({ length: 10_000 }, (_, index) => ({ employeeId: employees[index % employees.length].id, date: month + "-" + String((index % 31) + 1).padStart(2, "0"), shift: index % 2 ? "午班" : "晚班", hoursValue: 8 }));
    const compOff = Array.from({ length: 10_000 }, (_, index) => ({ id: "stress-comp-off-" + index, employeeId: employees[index % employees.length].id, earnedMonth: month, source: "overtime", hoursDeducted: 8, days: 1, expiresMonth: "2026-11", status: "available", notes: "stress", createdAt: now }));
    const alerts = Array.from({ length: 10_000 }, (_, index) => ({ id: "stress-alert-" + index, employeeId: employees[index % employees.length].id, date: month + "-" + String((index % 31) + 1).padStart(2, "0"), month, status: "pending", createdAt: now }));
    const items = Array.from({ length: 1_000 }, (_, index) => ({ id: "stress-item-" + index, name: "压力酒款" + (index + 1), nameEn: "Stress Bottle " + (index + 1), category: "Gin", unit: "瓶", refPrice: 100, supplier: "压力供应商", active: true, createdAt: now, updatedAt: now }));
    const purchases = Array.from({ length: 10_000 }, (_, index) => ({ id: "stress-purchase-" + index, month, date: month + "-" + String((index % 31) + 1).padStart(2, "0"), itemId: items[index % items.length].id, rawName: items[index % items.length].name, unit: "瓶", quantity: 1 + (index % 12), unitPrice: 80 + (index % 50), amount: (1 + (index % 12)) * (80 + (index % 50)), supplier: "压力供应商", group: "测试集团", category: "Gin", source: "manual", createdAt: now }));
    const ledger = items.map((item, index) => ({ id: "stress-ledger-" + index, month, itemId: item.id, openingQty: 20, openingUnitCost: 100, purchaseQty: 10, purchaseCost: 1000, consumeQty: 3, consumeCost: 300, closingQty: 27, closingUnitCost: 100, closingCost: 2700, isClosed: false, updatedAt: now }));
    localStorage.setItem("business.global-active-month.v1", JSON.stringify(month));
    localStorage.setItem("labor_employees_v1", JSON.stringify(employees));
    localStorage.setItem("labor_shifts_v1", JSON.stringify(shifts));
    localStorage.setItem("labor_comp_off_entries_v1", JSON.stringify(compOff));
    localStorage.setItem("labor_unexplained_rest_alerts_v1", JSON.stringify(alerts));
    localStorage.setItem("spirits.items.v3", JSON.stringify(items));
    localStorage.setItem("spirits.purchases.v3", JSON.stringify(purchases));
    localStorage.setItem("spirits.ledger.v3", JSON.stringify(ledger));
    localStorage.setItem("spirits.refPrices.v1", JSON.stringify([]));
    localStorage.setItem("spirits.suppliers.v1", JSON.stringify([{ id: "stress-supplier", name: "压力供应商", createdAt: now, updatedAt: now }]));
    localStorage.setItem("spirits.groups.v1", JSON.stringify([]));
    localStorage.setItem("spirits.matchMemory.v1", JSON.stringify({}));
    localStorage.setItem("spirits.selfBuyConfig.v1", JSON.stringify({}));
    localStorage.setItem("spirits.customCategories.v1", JSON.stringify([]));
    localStorage.setItem("spirits.groupMatchMemory.v1", JSON.stringify({}));
  })()`);

  const runs = [];
  let startedAt = performance.now();
  await call("Page.navigate", { url: `${origin}/labor` });
  await sleep(1800);
  runs.push(await snapshot(call, "/labor", startedAt));

  startedAt = performance.now();
  await call("Page.navigate", { url: `${origin}/spirits-inventory` });
  await sleep(1800);
  runs.push(await snapshot(call, "/spirits-inventory?tab=summary", startedAt));

  if (!await evaluate(call, click("spirits-tab-purchase"))) throw new Error("未找到烈酒当月进货页签。");
  await sleep(900);
  runs.push(await snapshot(call, "/spirits-inventory?tab=purchase", performance.now() - 900));

  if (!await evaluate(call, click("spirits-tab-ledger"))) throw new Error("未找到烈酒库存管理页签。");
  await sleep(900);
  runs.push(await snapshot(call, "/spirits-inventory?tab=ledger", performance.now() - 900));

  runs.forEach((run) => {
    if (!run.contentLength || run.rootScrollWidth > run.rootWidth) throw new Error(`压力页面异常：${JSON.stringify(run)}`);
  });
  console.log(JSON.stringify({
    script: "h5-store-large-dataset-stress-e2e", viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
    scenario: { employees: 500, shifts: 10_000, compOffEntries: 10_000, alerts: 10_000, inventoryItems: 1_000, inventoryPurchases: 10_000 },
    runs,
  }, null, 2));
} finally {
  if (socket) {
    const cleanupTarget = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json()).catch(() => []);
    const testPage = cleanupTarget.find((page) => page.id === target?.id);
    if (testPage?.webSocketDebuggerUrl) {
      const cleanupSocket = new WebSocket(testPage.webSocketDebuggerUrl);
      await new Promise((resolve) => cleanupSocket.addEventListener("open", resolve, { once: true }));
      cleanupSocket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: `(${JSON.stringify(testKeys)}).forEach((key) => localStorage.removeItem(key))` } }));
      await sleep(100);
      cleanupSocket.close();
    }
    socket.close();
  }
  if (target?.id) await fetch(`http://127.0.0.1:9222/json/close/${target.id}`).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
