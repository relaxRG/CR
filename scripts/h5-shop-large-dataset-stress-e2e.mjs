import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_SHOP_E2E_PORT ?? 8104);
const origin = `http://localhost:${port}`;
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const cleanKeys = ["glassware.inventory.v1", "store.shop.category.v2"];

if (!existsSync(join(root, "index.html"))) throw new Error("未找到 dist-web/index.html；请先导出 Web 构建。");
const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const candidate = normalize(join(root, pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createTarget() {
  const response = await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" });
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("无法创建浏览器测试标签页。");
  return target;
}
async function openCdp(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const awaiting = new Map();
  socket.addEventListener("message", (event) => { const message = JSON.parse(event.data); const handler = awaiting.get(message.id); if (handler) { awaiting.delete(message.id); handler(message); } });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { awaiting.delete(id); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 45_000);
    awaiting.set(id, (message) => { clearTimeout(timeout); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, call };
}
const evaluate = async (call, expression, awaitPromise = false) => (await call("Runtime.evaluate", { expression, awaitPromise, returnByValue: true })).result.value;
const press = (testId) => `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]'); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true; })()`;
const frameSample = `(() => new Promise((resolve) => { const samples = []; let previous = performance.now(); let count = 0; const step = (now) => { samples.push(now - previous); previous = now; count += 1; count < 60 ? requestAnimationFrame(step) : resolve({ frameCount: samples.length, maxFrameGapMs: Math.max(...samples), averageFrameGapMs: samples.reduce((sum, value) => sum + value, 0) / samples.length }); }; requestAnimationFrame(step); }))()`;
const heap = (metrics) => metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
let socket;
let target;
try {
  target = await createTarget();
  const { call, socket: cdpSocket } = await openCdp(target);
  socket = cdpSocket;
  await call("Page.enable");
  await call("Performance.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  const fixture = `(() => {
    const month = "2026-08"; const now = new Date().toISOString();
    const items = Array.from({ length: 1000 }, (_, index) => ({ id: "shop-stress-item-" + index, name: "压力杯具" + (index + 1), category: "highball", spec: "300ml", unit: "个", currentStock: 30, latestCostPrice: 20 + (index % 80), supplier: "压力供应商", notes: "h5 stress fixture", active: true, createdAt: now, updatedAt: now }));
    const purchases = Array.from({ length: 10000 }, (_, index) => ({ id: "shop-stress-purchase-" + index, itemId: items[index % items.length].id, itemName: items[index % items.length].name, quantity: 1 + (index % 8), unitPrice: 20 + (index % 80), totalAmount: (1 + (index % 8)) * (20 + (index % 80)), supplier: "压力供应商", date: month + "-" + String((index % 31) + 1).padStart(2, "0"), notes: "stress", createdAt: now }));
    const consumes = Array.from({ length: 10000 }, (_, index) => ({ id: "shop-stress-consume-" + index, itemId: items[index % items.length].id, itemName: items[index % items.length].name, quantity: 1 + (index % 5), unitCost: 20 + (index % 80), totalCost: (1 + (index % 5)) * (20 + (index % 80)), reason: index % 7 === 0 ? "loss" : "normal", date: month + "-" + String((index % 31) + 1).padStart(2, "0"), notes: "stress", createdAt: now }));
    const snapshotItems = items.map((item, index) => ({ itemId: item.id, name: item.name, category: item.category, unit: item.unit, openingQty: 0, openingUnitCost: 0, openingCost: 0, purchaseQty: 0, purchaseCost: 0, consumeQty: 0, consumeCost: 0, closingQty: 20 + (index % 10), closingUnitCost: item.latestCostPrice, closingCost: 0, lossQty: 0, lossCost: 0 }));
    const state = { items, purchases, consumes, snapshots: [{ id: "shop-stress-prev", month: "2026-07", category: "glassware", items: snapshotItems, totalPurchaseCost: 0, totalConsumeCost: 0, totalClosingCost: 0, totalLossCost: 0, notes: "stress", createdAt: now }], operationReceipts: [] };
    localStorage.setItem("glassware.inventory.v1", JSON.stringify(state));
    localStorage.setItem("store.shop.category.v2", JSON.stringify("glassware"));
  })()`;
  await call("Page.addScriptToEvaluateOnNewDocument", { source: fixture });
  const startedAt = performance.now();
  await call("Page.navigate", { url: `${origin}/store` });
  await sleep(4000);
  if (!await evaluate(call, press("store-main-tab-shop"))) throw new Error("未找到门店店铺页签。");
  await sleep(500);
  if (!await evaluate(call, press("shop-segment-glassware"))) throw new Error("未找到杯具分类页签。");
  await sleep(500);
  if (!await evaluate(call, press("glassware-inventory-tab-ledger"))) throw new Error("未找到杯具库存管理页签。");
  await sleep(1200);
  const frames = await evaluate(call, frameSample, true);
  const state = await evaluate(call, `(() => ({ path: location.pathname, fixtureVisible: document.body.innerText.includes("压力杯具"), tableMounted: Boolean(document.querySelector('[data-testid="glassware-horizontal-ledger-table"]')), visibleLedgerRows: document.querySelectorAll('[data-testid^="glassware-ledger-name-"]').length, domNodes: document.getElementsByTagName('*').length, rootWidth: document.documentElement.clientWidth, rootScrollWidth: document.documentElement.scrollWidth, storedBytes: localStorage.getItem("glassware.inventory.v1")?.length ?? 0, textPreview: document.body.innerText.slice(0, 300) }))()`);
  const result = { script: "h5-shop-large-dataset-stress-e2e", scenario: { shopItems: 1000, shopPurchases: 10000, shopConsumes: 10000, previousSnapshotItems: 1000 }, viewport: { width: 390, height: 844, deviceScaleFactor: 3 }, elapsedMs: performance.now() - startedAt, frames, heapBytes: heap(await call("Performance.getMetrics")), ...state };
  if (!result.tableMounted || result.visibleLedgerRows === 0 || result.rootScrollWidth > result.rootWidth) throw new Error(`店铺压力数据未正确渲染：${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (target?.id) await fetch(`http://127.0.0.1:9222/json/close/${target.id}`).catch(() => {});
  if (socket) socket.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
