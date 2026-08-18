import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8097);
const reportPath = process.env.WINE_PERF_REPORT ?? "/tmp/cocktail-r-wine-workbench-performance.json";
const viewports = [320, 375, 430];
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

if (!existsSync(join(root, "index.html"))) {
  throw new Error("未找到 dist-web/index.html。请先执行：npx expo export --platform web --output-dir dist-web");
}

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const candidate = normalize(join(root, pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTarget() {
  const response = await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建性能测试页面：HTTP ${response.status}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("性能测试页面缺少 DevTools 地址。");
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
    const complete = pending.get(message.id);
    if (complete) { pending.delete(message.id); complete(message); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP_TIMEOUT:${method}`));
    }, 15_000);
    pending.set(requestId, (message) => {
      clearTimeout(timer);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, call };
}

const seedLongLedgerExpression = `(() => {
  const now = new Date().toISOString();
  const month = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
  const types = ['Red', 'White', 'Sparkling'];
  const suppliers = ['EMW', 'Interprocom', 'Vinehoo', '君荟'];
  const items = Array.from({ length: 360 }, (_, offset) => {
    const seq = offset + 1;
    const unitCost = 48 + (offset % 17);
    const initQty = 3 + (offset % 6);
    const purchaseQty = offset % 3 === 0 ? 2 : 0;
    const endQty = initQty + purchaseQty - 1;
    return {
      seq,
      wineType: types[offset % types.length],
      supplier: suppliers[offset % suppliers.length],
      name: '性能测试葡萄酒 ' + String(seq).padStart(3, '0'),
      initUnitCost: unitCost,
      initQty,
      initCost: initQty * unitCost,
      purchaseQty,
      purchaseCost: purchaseQty * unitCost,
      endQty,
      unitCost,
      endCost: endQty * unitCost,
      consumeBottles: 1,
      consumeQty: unitCost,
    };
  });
  localStorage.setItem('wine.snapshots.v2', JSON.stringify({ snapshots: [{
    id: 'perf-wine-snapshot', monthLabel: month, importedAt: now,
    supplierTotals: Object.fromEntries(suppliers.map((supplier) => [supplier, 1000])),
    totalPurchase: 4000, totalConsume: 4000,
    totalEndCost: items.reduce((sum, item) => sum + item.endCost, 0),
    items, purchaseOrders: [],
  }] }));
  localStorage.setItem('wine.manual-purchases.v1', JSON.stringify({ purchases: Array.from({ length: 180 }, (_, offset) => ({
    id: 'perf-purchase-' + offset,
    date: month + '-' + String((offset % 28) + 1).padStart(2, '0'),
    supplier: suppliers[offset % suppliers.length],
    bottleId: null,
    productName: '性能采购酒款 ' + offset,
    unitPrice: 50 + (offset % 19),
    quantity: 1 + (offset % 6),
    amount: (50 + (offset % 19)) * (1 + (offset % 6)),
    notes: '', createdAt: now,
  })) }));
  return { itemCount: items.length, purchaseCount: 180 };
})()`;

const scrollFrameSampleExpression = `(() => new Promise((resolve) => {
  const list = document.querySelector('[data-testid="wine-horizontal-ledger-table-virtual-list"]');
  const scroller = list && (getComputedStyle(list).overflowY === 'auto' || getComputedStyle(list).overflowY === 'scroll')
    ? list
    : [...document.querySelectorAll('*')].map((element) => ({ element, style: getComputedStyle(element) }))
      .find(({ element, style }) => (style.overflowY === 'auto' || style.overflowY === 'scroll') && element.scrollHeight > element.clientHeight + 100)?.element;
  if (!scroller) { resolve({ foundScroller: false }); return; }
  const gaps = [];
  let count = 0;
  let last = performance.now();
  const start = last;
  const step = (now) => {
    gaps.push(now - last);
    last = now;
    const maxTop = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = count % 2 === 0 ? Math.min(maxTop, scroller.scrollTop + 300) : Math.max(0, scroller.scrollTop - 120);
    count += 1;
    if (count < 120) requestAnimationFrame(step);
    else {
      // 前六帧只用于浏览器首次布局和离屏内容预热；性能指标只统计持续交互阶段。
      const measuredGaps = gaps.slice(6);
      const sorted = [...measuredGaps].sort((a, b) => a - b);
      resolve({
        foundScroller: true,
        frameCount: measuredGaps.length,
        warmupMaxFrameGapMs: Math.max(...gaps.slice(0, 6)),
        averageFrameGapMs: measuredGaps.reduce((sum, gap) => sum + gap, 0) / measuredGaps.length,
        p95FrameGapMs: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
        maxFrameGapMs: Math.max(...measuredGaps),
        elapsedMs: performance.now() - start,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        finalScrollTop: scroller.scrollTop,
        domNodeCount: document.querySelectorAll('*').length,
      });
    }
  };
  requestAnimationFrame(step);
}))()`;

function clickExpression(testId) {
  return `(() => { const element = document.querySelector('[data-testid=${JSON.stringify(testId)}]'); if (!element) return false; element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true; })()`;
}

function metricSnapshot(metrics) {
  const index = Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
  return {
    jsHeapUsedSize: index.JSHeapUsedSize ?? null,
    jsHeapTotalSize: index.JSHeapTotalSize ?? null,
    nodes: index.Nodes ?? null,
    documents: index.Documents ?? null,
    frames: index.Frames ?? null,
  };
}

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

let socket;
try {
  const target = await getTarget();
  const cdp = await openCdp(target);
  socket = cdp.socket;
  const { call } = cdp;
  await call("Page.enable");
  await call("Performance.enable");
  const results = [];

  for (const width of viewports) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: `http://localhost:${port}/wine-inventory` });
    await sleep(550);
    await call("Runtime.evaluate", { expression: seedLongLedgerExpression, returnByValue: true });
    await call("Page.reload", { ignoreCache: true });
    await sleep(900);

    // 先完成一次离屏内容预热，性能样本只衡量用户开始连续滚动后的稳定阶段。
    await call("Runtime.evaluate", { expression: `(() => { const list = document.querySelector('[data-testid="wine-horizontal-ledger-table-virtual-list"]'); if (!list) return false; list.scrollTop = Math.min(1600, list.scrollHeight); return true; })()`, returnByValue: true });
    await sleep(280);
    await call("Runtime.evaluate", { expression: `(() => { const list = document.querySelector('[data-testid="wine-horizontal-ledger-table-virtual-list"]'); if (!list) return false; list.scrollTop = 0; return true; })()`, returnByValue: true });
    await sleep(280);
    const before = metricSnapshot((await call("Performance.getMetrics")).metrics);
    const frame = (await call("Runtime.evaluate", { expression: scrollFrameSampleExpression, awaitPromise: true, returnByValue: true })).result.value;
    if (!frame?.foundScroller || frame.scrollHeight <= frame.clientHeight + 100) {
      throw new Error(`葡萄酒 ${width}pt 未找到可滚动的虚拟化长列表：${JSON.stringify(frame)}`);
    }
    if (frame.averageFrameGapMs > 17 || frame.p95FrameGapMs > 20 || frame.maxFrameGapMs > 34) {
      throw new Error(`葡萄酒 ${width}pt 长列表滚动帧率不达标：${JSON.stringify(frame)}`);
    }

    for (let cycle = 0; cycle < 12; cycle += 1) {
      for (const tab of ["wine-tab-purchase", "wine-tab-supplier", "wine-tab-summary", "wine-tab-ledger"]) {
        const clicked = (await call("Runtime.evaluate", { expression: clickExpression(tab), returnByValue: true })).result.value;
        if (!clicked) throw new Error(`葡萄酒 ${width}pt 找不到页签 ${tab}`);
        await sleep(42);
      }
    }
    await sleep(180);
    const after = metricSnapshot((await call("Performance.getMetrics")).metrics);
    const heapGrowth = before.jsHeapUsedSize !== null && after.jsHeapUsedSize !== null ? after.jsHeapUsedSize - before.jsHeapUsedSize : null;
    const nodeGrowth = before.nodes !== null && after.nodes !== null ? after.nodes - before.nodes : null;
    if (heapGrowth !== null && heapGrowth > 12 * 1024 * 1024) {
      throw new Error(`葡萄酒 ${width}pt 反复切换后堆内存增长异常：${heapGrowth} bytes`);
    }
    if (nodeGrowth !== null && nodeGrowth > 180) {
      throw new Error(`葡萄酒 ${width}pt 反复切换后 DOM 节点增长异常：${nodeGrowth}`);
    }
    results.push({ width, fixture: { ledgerRows: 360, purchaseRows: 180 }, frame, memory: { before, after, heapGrowth, nodeGrowth } });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    passCriteria: {
      averageFrameGapMs: "<= 17ms（60Hz 浏览器稳定滚动基线；采样已排除首屏预热帧）",
      p95FrameGapMs: "<= 20ms",
      maxFrameGapMs: "<= 34ms",
      heapGrowth: "<= 12 MiB / 12 次页签循环",
      nodeGrowth: "<= 180 个 DOM 节点 / 12 次页签循环",
    },
    results,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  socket?.close();
  server.close();
}
