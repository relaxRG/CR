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
const cdpPort = Number(process.env.H5_CDP_PORT ?? 9222);
const route = `http://localhost:${port}/store`;
// 极窄屏、主流窄屏与大屏手机均需覆盖分类切换和滚动边界。
const MOBILE_VIEWPORTS = [320, 360, 375, 390, 412, 430];
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

async function cdpFetch(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(`http://127.0.0.1:${cdpPort}${path}`, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getDedicatedTestTarget() {
  const response = await cdpFetch("/json/new?about:blank", { method: "PUT" });
  if (!response.ok) throw new Error(`无法创建专用H5测试标签页：HTTP ${response.status}`);
  const target = await response.json();
  if (!target?.webSocketDebuggerUrl) throw new Error("专用H5测试标签页缺少CDP连接地址。");
  return target;
}

async function openCdp(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    sleep(8_000).then(() => { throw new Error("CDP_SOCKET_OPEN_TIMEOUT"); }),
  ]);
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

function layoutExpression(tabTestId, workspaceTestId) {
  return `(() => {
    const tabs = document.querySelector('[data-testid=${JSON.stringify(tabTestId)}]');
    const workspace = document.querySelector('[data-testid=${JSON.stringify(workspaceTestId)}]');
    return {
      rootClientWidth: document.documentElement.clientWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      tabLabels: tabs?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
      workspaceFound: Boolean(workspace),
      workspaceText: workspace?.innerText.replace(/\\s+/g, ' ').trim() ?? '',
    };
  })()`;
}

function assertNoRootOverflow(label, state) {
  if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) {
    throw new Error(`${label}出现根级横向溢出：${JSON.stringify(state)}`);
  }
}

function horizontalScrollExpression(testId) {
  return `(() => {
    const element = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    if (!element) return { found: false };
    const clientWidth = element.clientWidth;
    const scrollWidth = element.scrollWidth;
    const clientHeight = element.clientHeight;
    const scrollHeight = element.scrollHeight;
    const expectedEnd = Math.max(0, scrollWidth - clientWidth);
    element.scrollLeft = expectedEnd;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
    const reachedEnd = element.scrollLeft;
    element.scrollLeft = 0;
    return { found: true, clientWidth, scrollWidth, clientHeight, scrollHeight, expectedEnd, reachedEnd };
  })()`;
}

function assertHorizontalScroller(label, state) {
  if (!state.found) throw new Error(`${label}缺少横向滚动容器`);
  if (state.scrollHeight > state.clientHeight + 1) {
    throw new Error(`${label}出现垂直内容裁切：${JSON.stringify(state)}`);
  }
  if (state.expectedEnd > 1 && state.reachedEnd < 1) {
    throw new Error(`${label}内容超出宽度但无法横向滚动：${JSON.stringify(state)}`);
  }
}

async function click(call, expression, error) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (!result.result.value) throw new Error(error);
}

server.keepAliveTimeout = 1_000;
server.headersTimeout = 5_000;
server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

let testTarget;
let testSocket;
try {
  testTarget = await getDedicatedTestTarget();
  const { socket, call } = await openCdp(testTarget);
  testSocket = socket;
  const report = [];
  await call("Page.enable");

  const verifyPillSet = async (label, tabIds) => {
    const states = [];
    for (const tabId of tabIds) {
      await click(call, clickTestIdExpression(tabId), `${label} 未找到 ${tabId} 胶囊`);
      await sleep(140);
      const layout = await call("Runtime.evaluate", { expression: `(() => {
        const tab = document.querySelector('[data-testid="${tabId}"]');
        const background = tab ? getComputedStyle(tab).backgroundColor : null;
        return {
          found: Boolean(tab),
          selected: Boolean(background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)'),
          rootClientWidth: document.documentElement.clientWidth,
          rootScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
      })()`, returnByValue: true });
      const state = layout.result.value;
      if (!state.found || !state.selected) throw new Error(`${label} ${tabId} 未显示选中态：${JSON.stringify(state)}`);
      assertNoRootOverflow(`${label} ${tabId}`, state);
      states.push({ tabId, ...state });
    }
    return states;
  };
  const inventoryInnerTabs = {
    spirits: ["spirits-tab-summary", "spirits-tab-ledger", "spirits-tab-purchase", "spirits-tab-analysis"],
    wine: ["wine-workspace-tab-summary", "wine-workspace-tab-ledger", "wine-workspace-tab-purchase", "wine-workspace-tab-supplier"],
    fruit: ["fruit-inventory-tab-summary", "fruit-inventory-tab-ledger", "fruit-inventory-tab-purchase"],
    food: ["food-tab-summary", "food-tab-ledger", "food-tab-purchase"],
    beer: ["beer-inventory-tab-summary", "beer-inventory-tab-ledger", "beer-inventory-tab-purchase"],
    ice: ["ice-inventory-tab-summary", "ice-inventory-tab-ledger", "ice-inventory-tab-purchase", "ice-inventory-tab-costLink"],
  };
  const shopInnerTabs = {
    glassware: ["glassware-inventory-tab-summary", "glassware-inventory-tab-ledger", "glassware-inventory-tab-purchase", "glassware-inventory-tab-loss"],
    tableware: ["tableware-inventory-tab-summary", "tableware-inventory-tab-ledger", "tableware-inventory-tab-purchase", "tableware-inventory-tab-loss"],
    daily: ["daily-inventory-tab-summary", "daily-inventory-tab-ledger", "daily-inventory-tab-purchase", "daily-inventory-tab-batch"],
    equipment: ["equipment-tab-ledger", "equipment-tab-purchase", "equipment-tab-maintenance", "equipment-tab-depreciation"],
  };

  for (const width of MOBILE_VIEWPORTS) {
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
    const mainTabsScroller = await call("Runtime.evaluate", {
      expression: horizontalScrollExpression("store-main-tabs"), returnByValue: true,
    });
    assertHorizontalScroller(`${width}pt 主导航`, mainTabsScroller.result.value);

    await click(call, clickTestIdExpression("store-main-tab-inventory"), `${width}pt 未找到库存主导航`);
    await sleep(250);
    await click(call, clickTestIdExpression("inventory-segment-spirits"), `${width}pt 未找到烈酒分段`);
    await sleep(120);
    const inventoryInitial = await call("Runtime.evaluate", {
      expression: layoutExpression("inventory-segmented-tabs", "inventory-workspace-spirits"),
      returnByValue: true,
    });
    const inventoryState = inventoryInitial.result.value;
    assertNoRootOverflow(`${width}pt 库存初始页`, inventoryState);
    if (inventoryState.tabLabels !== "烈酒 葡萄酒 水果 食材 啤酒 冰块" || !inventoryState.workspaceFound) {
      throw new Error(`${width}pt 库存分段顺序或初始工作区错误：${JSON.stringify(inventoryState)}`);
    }
    const inventoryTabsScroller = await call("Runtime.evaluate", {
      expression: horizontalScrollExpression("inventory-segmented-tabs"), returnByValue: true,
    });
    assertHorizontalScroller(`${width}pt 库存分类标签`, inventoryTabsScroller.result.value);
    await click(call, clickTestIdExpression("spirits-tab-ledger"), `${width}pt 未找到烈酒库存管理页签`);
    await sleep(120);
    const spiritsToolbarScroller = await call("Runtime.evaluate", {
      expression: horizontalScrollExpression("spirits-inventory-action-toolbar"), returnByValue: true,
    });
    assertHorizontalScroller(`${width}pt 烈酒库存操作栏`, spiritsToolbarScroller.result.value);
    const spiritsInnerStates = await verifyPillSet(`${width}pt 烈酒二级页签`, inventoryInnerTabs.spirits);

    const inventoryMonthBeforeCategoryChange = await call("Runtime.evaluate", {
      expression: `document.querySelector('[data-testid="inventory-month-navigator"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`,
      returnByValue: true,
    });
    const inventoryCategoryStates = {};
    for (const [key, label] of [["wine", "葡萄酒"], ["fruit", "水果"], ["food", "食材"], ["beer", "啤酒"], ["ice", "冰块"]]) {
      await click(call, clickTestIdExpression(`inventory-segment-${key}`), `${width}pt 未找到${label}分段`);
      await sleep(150);
      const active = await call("Runtime.evaluate", {
        expression: layoutExpression("inventory-segmented-tabs", `inventory-workspace-${key}`),
        returnByValue: true,
      });
      const state = active.result.value;
      assertNoRootOverflow(`${width}pt ${label}分段`, state);
      if (!state.workspaceFound) {
        throw new Error(`${width}pt 切换${label}分段后原有业务工作区未同步：${JSON.stringify(state)}`);
      }
      const inventoryMonthAfterCategoryChange = await call("Runtime.evaluate", {
        expression: `document.querySelector('[data-testid="inventory-month-navigator"]')?.innerText.replace(/\\s+/g, ' ').trim() ?? ''`,
        returnByValue: true,
      });
      if (inventoryMonthBeforeCategoryChange.result.value !== inventoryMonthAfterCategoryChange.result.value) {
        throw new Error(`${width}pt 切换${label}分类后月份状态发生错位`);
      }
      inventoryCategoryStates[key] = { ...state, innerTabs: await verifyPillSet(`${width}pt ${label}二级页签`, inventoryInnerTabs[key]) };
    }
    await click(call, clickTestIdExpression("inventory-month-navigator-picker"), `${width}pt 未找到库存快速选月`);
    await sleep(120);
    const inventoryPicker = await call("Runtime.evaluate", {
      expression: `document.body.innerText.includes('选择库存月份')`,
      returnByValue: true,
    });
    if (!inventoryPicker.result.value) throw new Error(`${width}pt 库存快速选月面板未打开`);
    await call("Runtime.evaluate", { expression: `document.querySelector('[aria-label="关闭月份选择"]')?.click()` });
    await sleep(80);

    await click(call, clickTestIdExpression("store-main-tab-shop"), `${width}pt 未找到店铺主导航`);
    await sleep(250);
    await click(call, clickTestIdExpression("shop-segment-glassware"), `${width}pt 未找到杯具分段`);
    await sleep(120);
    const shopInitial = await call("Runtime.evaluate", {
      expression: layoutExpression("shop-segmented-tabs", "shop-workspace-glassware"),
      returnByValue: true,
    });
    const shopState = shopInitial.result.value;
    assertNoRootOverflow(`${width}pt 店铺初始页`, shopState);
    if (shopState.tabLabels !== "杯具 餐具 日用品 设备" || !shopState.workspaceFound) {
      throw new Error(`${width}pt 店铺分段顺序或初始工作区错误：${JSON.stringify(shopState)}`);
    }
    const shopTabsScroller = await call("Runtime.evaluate", {
      expression: horizontalScrollExpression("shop-segmented-tabs"), returnByValue: true,
    });
    assertHorizontalScroller(`${width}pt 店铺分类标签`, shopTabsScroller.result.value);
    const glasswareInnerStates = await verifyPillSet(`${width}pt 杯具二级页签`, shopInnerTabs.glassware);

    const shopCategoryStates = {};
    for (const [key, label] of [["tableware", "餐具"], ["daily", "日用品"], ["equipment", "设备"]]) {
      await click(call, clickTestIdExpression(`shop-segment-${key}`), `${width}pt 未找到${label}分段`);
      await sleep(150);
      const active = await call("Runtime.evaluate", {
        expression: layoutExpression("shop-segmented-tabs", `shop-workspace-${key}`),
        returnByValue: true,
      });
      const state = active.result.value;
      assertNoRootOverflow(`${width}pt ${label}分段`, state);
      if (!state.workspaceFound) {
        throw new Error(`${width}pt 切换${label}分段后原有业务工作区未同步：${JSON.stringify(state)}`);
      }
      shopCategoryStates[key] = { ...state, innerTabs: await verifyPillSet(`${width}pt ${label}二级页签`, shopInnerTabs[key]) };
    }
    const legacyEntry = await call("Runtime.evaluate", {
      expression: `document.body.innerText.includes('进入烈酒管理') || document.body.innerText.includes('进入设备管理')`,
      returnByValue: true,
    });
    if (legacyEntry.result.value) throw new Error(`${width}pt 仍保留已删除的中间管理页跳转入口`);

    report.push({ width, inventory: { initial: { ...inventoryState, innerTabs: spiritsInnerStates }, ...inventoryCategoryStates }, shop: { initial: { ...shopState, innerTabs: glasswareInnerStates }, ...shopCategoryStates } });
  }

  await call("Emulation.clearDeviceMetricsOverride");
  console.log(JSON.stringify({ passed: true, route, report }, null, 2));
} finally {
  if (testTarget?.id) {
    await cdpFetch(`/json/close/${testTarget.id}`).catch(() => {});
  }
  testSocket?.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
