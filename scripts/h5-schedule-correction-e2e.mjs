#!/usr/bin/env node
/**
 * 移动端 H5 排班纠错 E2E 烟雾测试。
 *
 * 前置：
 *   1. npx expo export --platform web --output-dir dist-web
 *   2. Chromium 已以 remote debugging port 9222 启动（Manus 浏览器环境默认满足）
 *
 * 此脚本启动带 SPA fallback 的静态服务，并在 375/390/430pt 下验证：
 *   - /labor 可加载且无根级横向溢出；
 *   - “编辑”入口可进入编辑模式；
 *   - 编辑模式中存在独立“清空本月”入口；
 *   - 正常模式仍包含独立的“生成薪资单”入口。
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8093);
const route = `http://localhost:${port}/labor`;
const contentTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
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

async function getPageTarget() {
  const targets = await (await fetch("http://localhost:9222/json")).json();
  const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
  if (!target) throw new Error("未找到可用 Chromium 页面。请启动带 remote debugging port 9222 的浏览器。");
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
    pending.set(requestId, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, call };
}

function hasTextExpression(text) {
  return `(() => [...document.querySelectorAll('*')].some((el) => el.children.length === 0 && el.textContent?.trim() === ${JSON.stringify(text)}))()`;
}

function clickTextExpression(text) {
  return `(() => {
    const element = [...document.querySelectorAll('*')].find((el) => el.children.length === 0 && el.textContent?.trim() === ${JSON.stringify(text)});
    if (!element) return false;
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  })()`;
}

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

try {
  const { socket, call } = await openCdp(await getPageTarget());
  const report = [];
  await call("Page.enable");

  for (const width of [375, 390, 430]) {
    await call("Emulation.setDeviceMetricsOverride", {
      width, height: 844, deviceScaleFactor: 3, mobile: true,
    });
    await call("Page.navigate", { url: route });
    await sleep(1000);

    const initial = await call("Runtime.evaluate", {
      expression: `(() => ({
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        hasEdit: ${hasTextExpression("✐ 编辑")},
        hasGenerate: Boolean(document.querySelector('[aria-label="生成薪资单"]')),
      }))()`,
      returnByValue: true,
    });
    const initialState = initial.result.value;
    if (initialState.rootScrollWidth > initialState.rootClientWidth || initialState.bodyScrollWidth > initialState.rootClientWidth) {
      throw new Error(`${width}pt 出现根级横向溢出：${JSON.stringify(initialState)}`);
    }
    if (!initialState.hasEdit || !initialState.hasGenerate) {
      throw new Error(`${width}pt 未渲染正常模式排班工具栏：${JSON.stringify(initialState)}`);
    }

    const clicked = await call("Runtime.evaluate", { expression: clickTextExpression("✐ 编辑"), returnByValue: true });
    if (!clicked.result.value) throw new Error(`${width}pt 无法点击编辑入口`);
    await sleep(200);
    const editMode = await call("Runtime.evaluate", {
      expression: `(() => ({
        hasClearMonth: ${hasTextExpression("清空本月")},
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
      }))()`,
      returnByValue: true,
    });
    const editState = editMode.result.value;
    if (!editState.hasClearMonth) throw new Error(`${width}pt 编辑模式未显示独立“清空本月”入口`);
    if (editState.rootScrollWidth > editState.rootClientWidth) {
      throw new Error(`${width}pt 编辑模式工具栏造成根级横向溢出：${JSON.stringify(editState)}`);
    }
    report.push({ width, normalMode: initialState, editMode: editState });
  }

  await call("Emulation.clearDeviceMetricsOverride");
  socket.close();
  console.log(JSON.stringify({ passed: true, route, report }, null, 2));
} finally {
  server.close();
}
