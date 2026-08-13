#!/usr/bin/env node
/**
 * 库存 / 店铺二级分段导航 H5 回归。
 *
 * 前置：npx expo export --platform web --output-dir dist-web
 * 在 375 / 390 / 430pt 下验证：
 * - 主导航顺序固定为 报表、员工、备用金、库存、店铺；
 * - 库存分段顺序固定为 烈酒、葡萄酒、水果、食材、啤酒、冰块；
 * - 店铺分段顺序固定为 杯具、餐具、日用品、设备；
 * - 切换分段时当前内容卡片同步切换，且页面无根级横向溢出。
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8094);
const route = `http://localhost:${port}/store`;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
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

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getDedicatedTestTarget() {
  const response = await fetch("http://localhost:9222/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建专用H5测试标签页：HTTP ${response.status}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("专用H5测试标签页缺少CDP连接地址。");
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
    const resolver = pending.get(message.id);
    if (resolver) { pending.delete(message.id); resolver(message); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`CDP_TIMEOUT:${method}`));
    }, 15_000);
    pending.set(requestId, (message) => {
      clearTimeout(timeout);
      return message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, call };
}

function clickTextExpression(text) {
  return `(() => {
    const element = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent?.trim() === ${JSON.stringify(text)});
    if (!element) return false;
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`;
}

function clickTestIdExpression(testId) {
  return `(() => {
    const element = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    if (!element) return false;
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`;
}

function layoutExpression(tabTestId, activeCardTestId) {
  return `(() => {
    const tabs = document.querySelector('[data-testid=${JSON.stringify(tabTestId)}]');
    const activeCard = document.querySelector('[data-testid=${JSON.stringify(activeCardTestId)}]');
    return {
      rootClientWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      tabLabels: tabs?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      activeCardText: activeCard?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    };
  })()`;
}

function assertNoRootOverflow(label, state) {
  if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) {
    throw new Error(`${label}出现根级横向溢出：${JSON.stringify(state)}`);
  }
}

async function click(call, expression, error) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (!result.result.value) throw new Error(error);
}

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

try {
  const { socket, call } = await openCdp(await getDedicatedTestTarget());
  const report = [];
  await call("Page.enable");

  for (const width of [375, 390, 430]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 3, mobile: true,
    });
    await call("Page.navigate", { url: route });
    await sleep(900);

    const mainTabs = await call("Runtime.evaluate", {
      expression: `(() => document.querySelector('[data-testid="store-main-tabs"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? '')()`,
      returnByValue: true,
    });
    if (mainTabs.result.value !== "报表 员工 备用金 库存 店铺") {
      throw new Error(`${width}pt 主导航顺序错误：${JSON.stringify(mainTabs.result.value)}`);
    }

    await click(call, clickTestIdExpression("store-main-tab-inventory"), `${width}pt 未找到库存主导航`);
    await sleep(250);
    const inventoryInitial = await call("Runtime.evaluate", {
      expression: layoutExpression("inventory-segmented-tabs", "inventory-active-category-card"),
      returnByValue: true,
    });
    const inventoryState = inventoryInitial.result.value;
    assertNoRootOverflow(`${width}pt 库存初始页`, inventoryState);
    if (inventoryState.tabLabels !== "烈酒 葡萄酒 水果 食材 啤酒 冰块") {
      throw new Error(`${width}pt 库存分段顺序错误：${JSON.stringify(inventoryState)}`);
    }

    await click(call, clickTestIdExpression("inventory-segment-fruit"), `${width}pt 未找到水果分段`);
    await sleep(150);
    const fruitActive = await call("Runtime.evaluate", {
      expression: layoutExpression("inventory-segmented-tabs", "inventory-active-category-card"),
      returnByValue: true,
    });
    const fruitState = fruitActive.result.value;
    assertNoRootOverflow(`${width}pt 水果分段`, fruitState);
    if (!fruitState.activeCardText.includes("水果") || !fruitState.activeCardText.includes("进入水果管理")) {
      throw new Error(`${width}pt 切换水果分段后内容区未同步：${JSON.stringify(fruitState)}`);
    }

    await click(call, clickTestIdExpression("store-main-tab-shop"), `${width}pt 未找到店铺主导航`);
    await sleep(250);
    const shopInitial = await call("Runtime.evaluate", {
      expression: layoutExpression("shop-segmented-tabs", "shop-active-category-card"),
      returnByValue: true,
    });
    const shopState = shopInitial.result.value;
    assertNoRootOverflow(`${width}pt 店铺初始页`, shopState);
    if (shopState.tabLabels !== "杯具 餐具 日用品 设备") {
      throw new Error(`${width}pt 店铺分段顺序错误：${JSON.stringify(shopState)}`);
    }

    await click(call, clickTestIdExpression("shop-segment-equipment"), `${width}pt 未找到设备分段`);
    await sleep(150);
    const equipmentActive = await call("Runtime.evaluate", {
      expression: layoutExpression("shop-segmented-tabs", "shop-active-category-card"),
      returnByValue: true,
    });
    const equipmentState = equipmentActive.result.value;
    assertNoRootOverflow(`${width}pt 设备分段`, equipmentState);
    if (!equipmentState.activeCardText.includes("设备") || !equipmentState.activeCardText.includes("进入设备管理")) {
      throw new Error(`${width}pt 切换设备分段后内容区未同步：${JSON.stringify(equipmentState)}`);
    }

    report.push({ width, inventory: { initial: inventoryState, fruit: fruitState }, shop: { initial: shopState, equipment: equipmentState } });
  }

  await call("Emulation.clearDeviceMetricsOverride");
  socket.close();
  console.log(JSON.stringify({ passed: true, route, report }, null, 2));
} finally {
  server.close();
}
