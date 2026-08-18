import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8098);
const route = `http://localhost:${port}/dish-analysis`;
const viewports = [320, 360, 375, 390, 412, 430];
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

if (!existsSync(join(root, "index.html"))) throw new Error("未找到 dist-web/index.html，请先执行 expo export");

const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]);
  const candidate = normalize(join(root, pathname));
  const file = candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "index.html");
  response.setHeader("Content-Type", contentTypes[extname(file)] ?? "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createTarget() {
  const response = await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建专用测试页面：${response.status}`);
  return response.json();
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
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP_TIMEOUT:${method}`)); }, 15000);
    pending.set(requestId, (message) => {
      clearTimeout(timer);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, call };
}

const monthlyReports = [{
  id: "report-2026-07",
  rawMonth: "2026/07",
  monthLabel: "2026年7月",
  dishCategories: [{
    name: "Food", salesQty: 3485, salesQtyPct: 0.7,
    salesAmount: 10000, salesAmountPct: 0.7,
    revenue: 9500, revenuePct: 0.7,
    discountAmount: 500, discountPct: 0.05,
  }],
}];
const dishSnapshots = [{
  id: "dish-2026-07",
  month: "2026-07",
  monthLabel: "2026年7月",
  importedAt: "2026-08-18T00:00:00.000Z",
  categories: [{
    name: "3485", salesQty: 0, salesQtyPct: 0,
    salesAmount: 10000, salesAmountPct: 1,
    revenue: 9500, revenuePct: 1, discount: 500,
  }],
  subCategories: [{
    category: "Food", subCategory: "小食", salesQty: 1, salesQtyPct: 1,
    salesAmount: 100, salesAmountPct: 1, revenue: 100, revenuePct: 1, discount: 0,
  }],
  items: [], specs: [], dailyPayments: [],
  importedReports: {
    categories: true, subCategories: true, items: false, specs: false,
    revenueStatement: false, dailyPayments: false, timeSlotsByOrder: false, timeSlotsByCheckout: false,
  },
}];

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

let target;
let socket;
try {
  target = await createTarget();
  const connection = await openCdp(target);
  socket = connection.socket;
  const { call } = connection;
  await call("Page.enable");
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.setItem("monthly_reports_v1", ${JSON.stringify(JSON.stringify(monthlyReports))});
      localStorage.setItem("dish_analysis.snapshots.v1", ${JSON.stringify(JSON.stringify(dishSnapshots))});
    `,
  });

  const report = [];
  for (const width of viewports) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: route });
    await sleep(1100);
    const before = (await call("Runtime.evaluate", {
      expression: `(() => {
        const root = document.documentElement;
        const reset = document.querySelector('[data-testid="dish-analysis-reset-current-month"]');
        return {
          rootClientWidth: root.clientWidth,
          rootScrollWidth: root.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          resetFound: Boolean(reset),
          resetWidth: reset?.getBoundingClientRect().width ?? 0,
          rendersIncorrectCategory: document.body.innerText.includes("3485"),
        };
      })()`,
      returnByValue: true,
    })).result.value;

    if (!before.resetFound || before.resetWidth < 36 || !before.rendersIncorrectCategory) {
      throw new Error(`${width}pt 未正确加载同月经营分析或重置热区不足：${JSON.stringify(before)}`);
    }
    if (before.rootScrollWidth > before.rootClientWidth || before.bodyScrollWidth > before.rootClientWidth) {
      throw new Error(`${width}pt 菜品分析页出现根级横向溢出：${JSON.stringify(before)}`);
    }

    // react-native-web 的 Alert 为无 UI 实现；点击后可验证真实 Pressable 已进入单飞锁定，避免重复触发确认/写入。
    await call("Runtime.evaluate", {
      expression: `document.querySelector('[data-testid="dish-analysis-reset-current-month"]')?.click();`,
    });
    await sleep(120);
    const afterFirstTap = (await call("Runtime.evaluate", {
      expression: `(() => {
        const reset = document.querySelector('[data-testid="dish-analysis-reset-current-month"]');
        return { ariaDisabled: reset?.getAttribute("aria-disabled"), disabled: Boolean(reset?.disabled) };
      })()`,
      returnByValue: true,
    })).result.value;
    if (afterFirstTap.ariaDisabled !== "true" && !afterFirstTap.disabled) {
      throw new Error(`${width}pt 首次点击后未进入重置单飞锁：${JSON.stringify(afterFirstTap)}`);
    }
    report.push({ width, ...before, afterFirstTap });
  }

  console.log(JSON.stringify({ name: "菜品分析按月重置移动端回归", viewports: report }, null, 2));
} finally {
  if (socket) socket.close();
  if (target?.id) await fetch(`http://localhost:9222/json/close/${target.id}`).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
