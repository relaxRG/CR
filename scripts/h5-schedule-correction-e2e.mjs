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
 *   - 正常模式仍包含独立的“生成薪资单”入口；
 *   - 月报页显示唯一“月度归档并确认发薪”主按钮；
 *   - 冻结归档与差额调整中的月报操作区均可在移动视口正常展示；
 *   - 薪资统计、考勤概况、绩效汇总、时段成本分析与月度经营报告在
 *     375/390/430pt 下均不存在根级横向溢出。
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

  // 月报唯一归档入口：写入最小可用夹具后重新导航，验证 DRAFT / FROZEN / ADJUSTING 三态。
  await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 844, deviceScaleFactor: 3, mobile: true });
  const seed = await call("Runtime.evaluate", { expression: `(() => {
    const month = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    const employee = { id: 'h5-e2e-employee', code: 'E2E', realName: 'H5测试', phone: '', dept: 'front', type: 'fulltime', baseSalary: 10000, restDaysPerMonth: 4, hourlyRate: 0, overtimeHourlyRate: 50, notes: '', active: true, createdAt: new Date().toISOString() };
    const employees = [
      employee,
      ...Array.from({ length: 4 }, (_, i) => ({ ...employee, id: 'h5-front-' + i, code: 'F' + i, realName: '前厅测试' + i, dept: 'front' })),
      ...Array.from({ length: 3 }, (_, i) => ({ ...employee, id: 'h5-kitchen-' + i, code: 'K' + i, realName: '后厨测试' + i, dept: 'kitchen' })),
    ];
    const slip = { id: 'h5-e2e-slip', employeeId: employee.id, month, attendanceDays: 27, attendanceSalary: 10000, performanceBonus: 0, salesCommission: 0, mealAllowance: 0, transportAllowance: 0, otherAllowance: 0, rewardPenalty: 0, advanceAmount: 0, grossSalary: 10000, socialInsuranceDeduction: 0, housingFundDeduction: 0, incomeTax: 0, finalSalary: 10000, employerSocialInsurance: 0, employerHousingFund: 0, totalEmployerCost: 10000, notes: '', updatedAt: new Date().toISOString() };
    localStorage.setItem('labor_employees_v1', JSON.stringify(employees));
    localStorage.setItem('labor_payslips_v1', JSON.stringify([slip]));
    localStorage.removeItem('labor_month_close_archives_v1');
    localStorage.removeItem('labor_month_adjustment_sessions_v1');
    return month;
  })()`, returnByValue: true });
  const closeMonth = seed.result.value;
  await call("Page.navigate", { url: `http://localhost:${port}/monthly-summary` });
  await sleep(900);
  const draftClose = await call("Runtime.evaluate", { expression: `(() => ({
    hasClose: ${hasTextExpression("月度归档并确认发薪")},
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`, returnByValue: true });
  if (!draftClose.result.value.hasClose) throw new Error('月报 DRAFT 未显示唯一月度归档主按钮');
  if (draftClose.result.value.rootScrollWidth > draftClose.result.value.rootClientWidth) throw new Error('月报 DRAFT 出现根级横向溢出');

  await call("Runtime.evaluate", { expression: `(() => {
    const month = ${JSON.stringify(closeMonth)};
    const archive = { id: 'h5-close-v1', month, version: 1, status: 'frozen', createdAt: Date.now(), closedBy: 'manager', summary: { totalEmployees: 1, totalGrossSalary: 10000, totalFinalSalary: 10000, totalDeductions: 0 }, scheduleByDept: {}, payrollByEmployee: {}, adjustments: [] };
    localStorage.setItem('labor_month_close_archives_v1', JSON.stringify([archive]));
  })()`, returnByValue: true });
  await call("Page.navigate", { url: `http://localhost:${port}/monthly-summary` });
  await sleep(900);
  const frozenClose = await call("Runtime.evaluate", { expression: `(() => ({
    hasArchive: ${hasTextExpression("查看月度归档")},
    hasAdjust: ${hasTextExpression("进入差额调整")},
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`, returnByValue: true });
  if (!frozenClose.result.value.hasArchive || !frozenClose.result.value.hasAdjust) throw new Error('月报 FROZEN 未显示归档查看与差额调整入口');
  if (frozenClose.result.value.rootScrollWidth > frozenClose.result.value.rootClientWidth) throw new Error('月报 FROZEN 出现根级横向溢出');

  await call("Runtime.evaluate", { expression: `(() => {
    const month = ${JSON.stringify(closeMonth)};
    localStorage.setItem('labor_month_adjustment_sessions_v1', JSON.stringify([{ id: 'h5-adjust', month, baseArchiveId: 'h5-close-v1', baseVersion: 1, status: 'open', reason: 'H5验证', settleMethod: 'next_month', createdAt: Date.now(), createdBy: 'manager', baseline: { shifts: [], attendances: [], paySlips: [] } }]));
  })()`, returnByValue: true });
  await call("Page.navigate", { url: `http://localhost:${port}/monthly-summary` });
  await sleep(900);
  const adjustingClose = await call("Runtime.evaluate", { expression: `(() => ({
    hasDiscard: ${hasTextExpression("放弃调整")},
    hasReclose: ${hasTextExpression("重新归档并确认")},
    rootClientWidth: document.documentElement.clientWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
  }))()`, returnByValue: true });
  if (!adjustingClose.result.value.hasDiscard || !adjustingClose.result.value.hasReclose) throw new Error('月报 ADJUSTING 未显示放弃调整与重新归档入口');
  if (adjustingClose.result.value.rootScrollWidth > adjustingClose.result.value.rootClientWidth) throw new Error('月报 ADJUSTING 出现根级横向溢出');
  report.push({ width: 375, monthClose: { draft: draftClose.result.value, frozen: frozenClose.result.value, adjusting: adjustingClose.result.value } });

  // 核心薪资与报表页：路由级视觉烟雾测试。
  // 此处只验证根级布局，因为页面业务内容和数字状态已由 Vitest 的金额/颜色回归夹具覆盖。
  const reportRoutes = [
    ["/labor", "薪资统计"],
    ["/labor-attendance", "考勤概况"],
    [`/labor-kpi-allowance?employeeId=h5-e2e-employee&month=${closeMonth}`, "绩效汇总"],
    ["/period-analysis", "时段成本分析"],
    ["/monthly-report", "月度经营报告"],
  ];
  for (const [path, label] of reportRoutes) {
    const viewports = [];
    for (const width of [375, 390, 430]) {
      await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
      await call("Page.navigate", { url: `http://localhost:${port}${path}` });
      await sleep(700);
      const layout = await call("Runtime.evaluate", { expression: `(() => ({
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        hasVisibleText: document.body.innerText.trim().length > 0,
      }))()`, returnByValue: true });
      const state = layout.result.value;
      if (!state.hasVisibleText) throw new Error(`${label} ${width}pt 页面未加载内容`);
      if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) {
        throw new Error(`${label} ${width}pt 出现根级横向溢出：${JSON.stringify(state)}`);
      }
      viewports.push({ width, ...state });
    }
    report.push({ reportPage: label, viewports });
  }

  // 员工档案顶部筛选栏：验证“后厨 3”文字与人数徽标分别完整可见、边界不相交。
  const employeeFilterViewports = [];
  for (const width of [375, 390, 430]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 3, mobile: true });
    await call("Page.navigate", { url: `http://localhost:${port}/labor-employees` });
    await sleep(700);
    const layout = await call("Runtime.evaluate", { expression: `(() => {
      const elements = [...document.querySelectorAll('*')];
      const chip = elements.find((node) => node.textContent?.replace(/\\s/g, '') === '后厨3');
      const label = chip && [...chip.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent?.trim() === '后厨');
      const badge = chip && [...chip.querySelectorAll('*')].find((node) => node.children.length === 0 && node.textContent?.trim() === '3');
      const chipRect = chip?.getBoundingClientRect();
      const labelRect = label?.getBoundingClientRect();
      const badgeBox = badge && [badge, ...function* () { let node = badge.parentElement; while (node) { yield node; node = node.parentElement; } }()].find((node) => node.textContent?.trim() === '3' && node.getBoundingClientRect().width >= 20);
      const badgeRect = badgeBox?.getBoundingClientRect();
      return {
        rootClientWidth: document.documentElement.clientWidth,
        rootScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        foundChip: Boolean(chip && label && badge),
        hasOverlap: Boolean(labelRect && badgeRect && labelRect.right > badgeRect.left),
        fitsChip: Boolean(chipRect && labelRect && badgeRect && labelRect.left >= chipRect.left && badgeRect.right <= chipRect.right),
      };
    })()`, returnByValue: true });
    const state = layout.result.value;
    if (!state.foundChip || state.hasOverlap || !state.fitsChip) throw new Error(`员工筛选“后厨 3”在 ${width}pt 未完整独立显示：${JSON.stringify(state)}`);
    if (state.rootScrollWidth > state.rootClientWidth || state.bodyScrollWidth > state.rootClientWidth) throw new Error(`员工筛选栏在 ${width}pt 造成根级横向溢出：${JSON.stringify(state)}`);
    employeeFilterViewports.push({ width, ...state });
  }
  report.push({ reportPage: "员工档案筛选标签", viewports: employeeFilterViewports });

  await call("Emulation.clearDeviceMetricsOverride");
  socket.close();
  console.log(JSON.stringify({ passed: true, route, report }, null, 2));
} finally {
  server.close();
}
