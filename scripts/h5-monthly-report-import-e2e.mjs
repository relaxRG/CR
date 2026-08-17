import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8097);
const route = `http://localhost:${port}/monthly-report-import`;
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
  const report = [];

  for (const width of viewports) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: route });
    await sleep(900);
    const state = (await call("Runtime.evaluate", {
      expression: `(() => {
        const root = document.documentElement;
        const picker = document.querySelector('[data-testid="monthly-report-pick-files"]');
        const retired = document.querySelector('[data-testid*="meituan"]');
        const rect = picker?.getBoundingClientRect();
        const text = document.body.innerText;
        return {
          rootClientWidth: root.clientWidth,
          rootScrollWidth: root.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          picker: rect ? { height: rect.height, width: rect.width } : null,
          hasManualHint: text.includes("从收银系统自行导出"),
          retiredEntryFound: Boolean(retired),
        };
      })()`,
      returnByValue: true,
    })).result.value;

    if (!state.picker) throw new Error(`${width}pt 未显示通用手动文件选择入口：${JSON.stringify(state)}`);
    if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) {
      throw new Error(`${width}pt 月度报表导入页出现根级横向溢出：${JSON.stringify(state)}`);
    }
    if (state.picker.height < 44 || state.picker.width <= 0) {
      throw new Error(`${width}pt 手动文件选择热区不足：${JSON.stringify(state)}`);
    }
    if (!state.hasManualHint || state.retiredEntryFound) {
      throw new Error(`${width}pt 手动导入回退状态不正确：${JSON.stringify(state)}`);
    }
    report.push({ width, ...state });
  }

  console.log(JSON.stringify({ name: "月度报表手动导入移动端回归", viewports: report }, null, 2));
} finally {
  if (socket) socket.close();
  if (target?.id) await fetch(`http://localhost:9222/json/close/${target.id}`).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
