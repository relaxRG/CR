import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_E2E_PORT ?? 8102);
const route = `http://localhost:${port}/dev/money-input-lab`;
const viewports = [320, 360, 375, 390, 412, 430];
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

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

function setInputExpression(testId, value) {
  return `(() => {
    const el = document.querySelector('[data-testid="${testId}"]');
    if (!el) throw new Error('missing:${testId}');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
    return el.value;
  })()`;
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

    await call("Runtime.evaluate", { expression: setInputExpression("money-input-allowance", "38."), awaitPromise: true });
    await sleep(40);
    const interim = (await call("Runtime.evaluate", { expression: `document.querySelector('[data-testid="money-input-allowance"]')?.value`, returnByValue: true })).result.value;
    if (interim !== "38.") throw new Error(`${width}pt 小数点被截断：${interim}`);

    await call("Runtime.evaluate", { expression: setInputExpression("money-input-allowance", "38.567"), awaitPromise: true });
    await call("Runtime.evaluate", { expression: setInputExpression("money-input-deduction", "-12.25"), awaitPromise: true });
    await call("Runtime.evaluate", { expression: setInputExpression("money-input-rate", "1.5"), awaitPromise: true });
    await sleep(80);

    const state = (await call("Runtime.evaluate", {
      expression: `(() => {
        const root = document.documentElement;
        const byId = (id) => document.querySelector('[data-testid="' + id + '"]');
        return {
          rootClientWidth: root.clientWidth,
          rootScrollWidth: root.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          allowanceDraft: byId('money-input-allowance')?.value,
          allowanceValue: byId('money-input-allowance-value')?.textContent,
          deductionValue: byId('money-input-deduction-value')?.textContent,
          rateValue: byId('money-input-rate-value')?.textContent,
          inputHeight: byId('money-input-allowance')?.getBoundingClientRect().height,
        };
      })()`,
      returnByValue: true,
    })).result.value;

    if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) {
      throw new Error(`${width}pt 金额输入页出现根级横向溢出：${JSON.stringify(state)}`);
    }
    if (state.allowanceDraft !== "38.56" || state.allowanceValue !== "¥38.56" || state.deductionValue !== "¥-12.25" || state.rateValue !== "1.50x") {
      throw new Error(`${width}pt 金额输入精度回归失败：${JSON.stringify(state)}`);
    }
    if (!state.inputHeight || state.inputHeight < 44) throw new Error(`${width}pt 金额输入热区不足：${JSON.stringify(state)}`);
    report.push({ width, ...state });
  }

  console.log(JSON.stringify({ name: "金额输入小数端到端回归", viewports: report }, null, 2));
} finally {
  if (socket) socket.close();
  if (target?.id) await fetch(`http://localhost:9222/json/close/${target.id}`).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
