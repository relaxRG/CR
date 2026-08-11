/**
 * 系统深浅色模式热切换 H5 E2E。
 * 前置：npx expo export --platform web --output-dir dist-web；Chromium 监听 9222。
 * 验证 prefers-color-scheme light → dark → light 时，ThemeProvider 无需页面重载即更新 data-theme 与 dark class。
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = join(process.cwd(), "dist-web");
const port = Number(process.env.H5_THEME_E2E_PORT ?? 8094);
const route = `http://localhost:${port}/cocktail`;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const resolve = pending.get(message.id);
    if (resolve) { pending.delete(message.id); resolve(message); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  return { socket, call };
}

async function setSystemScheme(call, scheme) {
  await call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: scheme }],
  });
}

async function readTheme(call) {
  const result = await call("Runtime.evaluate", {
    expression: `(() => ({
      theme: document.documentElement.dataset.theme,
      darkClass: document.documentElement.classList.contains('dark'),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))()`,
    returnByValue: true,
  });
  return result.result.value ?? {};
}

async function waitForTheme(call, expectedTheme, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let current = await readTheme(call);
  while (current.theme !== expectedTheme && Date.now() < deadline) {
    await sleep(100);
    current = await readTheme(call);
  }
  return current;
}

server.listen(port, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));

try {
  const { socket, call } = await openCdp(await getPageTarget());
  await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 844, deviceScaleFactor: 3, mobile: true });

  await setSystemScheme(call, "light");
  await call("Page.navigate", { url: route });
  const lightInitial = await waitForTheme(call, "light", 15000);
  if (lightInitial.theme !== "light" || lightInitial.darkClass) {
    throw new Error(`初始浅色系统主题未生效：${JSON.stringify(lightInitial)}`);
  }

  await setSystemScheme(call, "dark");
  const darkHot = await waitForTheme(call, "dark", 3000);
  if (darkHot.theme !== "dark" || !darkHot.darkClass) {
    throw new Error(`系统切换深色后未热更新：${JSON.stringify(darkHot)}`);
  }

  await setSystemScheme(call, "light");
  const lightHot = await waitForTheme(call, "light", 3000);
  if (lightHot.theme !== "light" || lightHot.darkClass) {
    throw new Error(`系统切回浅色后未热更新：${JSON.stringify(lightHot)}`);
  }

  for (const state of [lightInitial, darkHot, lightHot]) {
    if (state.scrollWidth > state.clientWidth) {
      throw new Error(`主题热切换造成根级横向溢出：${JSON.stringify(state)}`);
    }
  }

  console.log(JSON.stringify({ width: 375, lightInitial, darkHot, lightHot }, null, 2));
  socket.close();
} finally {
  server.close();
}
